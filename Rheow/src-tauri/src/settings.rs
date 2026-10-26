use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

/// Categories whose destination subfolder can be customized from Settings.
pub const CATEGORY_KEYS: [&str; 6] = [
    "Compressed",
    "Programs",
    "Video",
    "Documents",
    "Music",
    "Other",
];

/// Engine-related preferences shared by the Tauri commands, the SQLite layer,
/// and the download engine. Field names are serialized as camelCase so the
/// React settings object can be sent through `invoke` unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineSettings {
    pub max_connections: u32,
    pub default_download_path: String,
    pub connection_timeout_seconds: u64,
    pub max_retries: u32,
    pub preallocate_disk_space: bool,
    pub open_folder_on_finish_default: bool,
    pub confirm_delete_prompt: bool,
    pub delete_file_from_disk_default: bool,
    /// Desktop integration preferences. `autostart_enabled` mirrors the
    /// Windows startup registration, `close_to_tray` keeps the app (and its
    /// downloads) alive when the main window is closed, and `start_minimized`
    /// only applies when Windows starts the app with `--hidden`.
    pub autostart_enabled: bool,
    pub close_to_tray: bool,
    pub start_minimized: bool,
    /// Optional per-category override for the destination folder. A relative
    /// value is joined to `default_download_path`, an absolute value is used
    /// as-is, and an empty value writes straight into the base folder.
    pub category_subfolders: HashMap<String, String>,
    /// Speed limiter mode: "per_download" (Hero Active / individual download limiter)
    /// or "global" (enforces total speed limit across all concurrent downloads).
    pub speed_limiter_mode: String,
    /// Global speed limit in KB/s when `speed_limiter_mode` is "global".
    pub global_speed_limit_kb: Option<i64>,
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            max_connections: 8,
            default_download_path: default_downloads_dir().to_string_lossy().to_string(),
            connection_timeout_seconds: 30,
            max_retries: 10,
            preallocate_disk_space: true,
            open_folder_on_finish_default: true,
            confirm_delete_prompt: true,
            delete_file_from_disk_default: false,
            autostart_enabled: false,
            close_to_tray: true,
            start_minimized: false,
            category_subfolders: HashMap::new(),
            speed_limiter_mode: "per_download".to_string(),
            global_speed_limit_kb: None,
        }
    }
}

impl EngineSettings {
    /// Settings come from a user-editable JSON object, so clamp them to sane
    /// values before handing them to the engine.
    pub fn sanitized(&self) -> Self {
        Self {
            max_connections: self.max_connections.clamp(1, 32),
            default_download_path: self.default_download_path.clone(),
            connection_timeout_seconds: self.connection_timeout_seconds.clamp(5, 300),
            max_retries: self.max_retries.min(50),
            preallocate_disk_space: self.preallocate_disk_space,
            open_folder_on_finish_default: self.open_folder_on_finish_default,
            confirm_delete_prompt: self.confirm_delete_prompt,
            delete_file_from_disk_default: self.delete_file_from_disk_default,
            autostart_enabled: self.autostart_enabled,
            close_to_tray: self.close_to_tray,
            start_minimized: self.start_minimized,
            category_subfolders: sanitize_category_subfolders(&self.category_subfolders),
            speed_limiter_mode: if self.speed_limiter_mode == "global" {
                "global".to_string()
            } else {
                "per_download".to_string()
            },
            global_speed_limit_kb: self.global_speed_limit_kb.filter(|&k| k > 0),
        }
    }

    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.sanitized().connection_timeout_seconds)
    }

    pub fn retry_limit(&self) -> u32 {
        self.sanitized().max_retries
    }
}

/// Keeps only known categories, trims values, and rejects relative paths that
/// would escape the configured download root. Empty values are preserved on
/// purpose: they mean "no category subfolder".
fn sanitize_category_subfolders(raw: &HashMap<String, String>) -> HashMap<String, String> {
    raw.iter()
        .filter_map(|(category, value)| {
            let category = category.trim();
            if !CATEGORY_KEYS.contains(&category) {
                return None;
            }

            let value = value.trim();
            let path = Path::new(value);
            if !value.is_empty()
                && !path.is_absolute()
                && path.components().any(|c| matches!(c, Component::ParentDir))
            {
                return None;
            }

            Some((
                category.to_string(),
                value.chars().take(260).collect::<String>(),
            ))
        })
        .collect()
}

pub fn default_downloads_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|p| p.join("Downloads"))
        .unwrap_or_else(|| PathBuf::from("C:\\Downloads"))
}

/// Settings for automated queue scheduling.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct SchedulerSettings {
    pub enabled: bool,
    pub start_time: String,
    pub stop_time: Option<String>,
    pub days: Vec<u8>,
    pub action_on_finish: String,
    pub max_concurrent_queue: usize,
}

impl Default for SchedulerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            start_time: "02:00".to_string(),
            stop_time: Some("06:00".to_string()),
            days: Vec::new(),
            action_on_finish: "none".to_string(),
            max_concurrent_queue: 2,
        }
    }
}

impl SchedulerSettings {
    pub fn sanitized(&self) -> Self {
        let valid_actions = ["none", "shutdown", "sleep", "quit"];
        let action = if valid_actions.contains(&self.action_on_finish.as_str()) {
            self.action_on_finish.clone()
        } else {
            "none".to_string()
        };

        let start_time = sanitize_time(&self.start_time).unwrap_or_else(|| "02:00".to_string());
        let stop_time = self.stop_time.as_ref().and_then(|t| sanitize_time(t));

        let mut days = self.days.clone();
        days.retain(|&d| (1..=7).contains(&d));
        days.sort_unstable();
        days.dedup();

        Self {
            enabled: self.enabled,
            start_time,
            stop_time,
            days,
            action_on_finish: action,
            max_concurrent_queue: self.max_concurrent_queue.clamp(1, 10),
        }
    }
}

fn sanitize_time(raw: &str) -> Option<String> {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    if h < 24 && m < 60 {
        Some(format!("{:02}:{:02}", h, m))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_category_subfolders() {
        let mut raw = HashMap::new();
        raw.insert("Video".to_string(), "  Media\\Video  ".to_string());
        raw.insert("Music".to_string(), "".to_string());
        raw.insert("Unknown".to_string(), "elsewhere".to_string());
        raw.insert("Documents".to_string(), "..\\escape".to_string());

        let settings = EngineSettings {
            category_subfolders: raw,
            ..Default::default()
        }
        .sanitized();

        assert_eq!(
            settings.category_subfolders.get("Video").map(String::as_str),
            Some("Media\\Video")
        );
        assert_eq!(
            settings.category_subfolders.get("Music").map(String::as_str),
            Some("")
        );
        assert!(!settings.category_subfolders.contains_key("Unknown"));
        assert!(!settings.category_subfolders.contains_key("Documents"));
    }

    #[test]
    fn old_settings_json_without_category_map_still_loads() {
        let parsed: EngineSettings = serde_json::from_str(
            r#"{"maxConnections":4,"defaultDownloadPath":"D:\\Downloads"}"#,
        )
        .expect("old settings JSON should deserialize");

        assert_eq!(parsed.max_connections, 4);
        assert!(parsed.category_subfolders.is_empty());
    }

    #[test]
    fn old_settings_json_without_desktop_fields_uses_defaults() {
        let parsed: EngineSettings = serde_json::from_str(
            r#"{"maxConnections":4,"defaultDownloadPath":"D:\\Downloads"}"#,
        )
        .expect("old settings JSON should deserialize");

        assert!(!parsed.autostart_enabled);
        assert!(parsed.close_to_tray);
        assert!(!parsed.start_minimized);
    }

    #[test]
    fn desktop_fields_roundtrip_as_camel_case() {
        let settings = EngineSettings {
            autostart_enabled: true,
            close_to_tray: false,
            start_minimized: true,
            ..Default::default()
        };

        let json = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(json.get("autostartEnabled"), Some(&serde_json::json!(true)));
        assert_eq!(json.get("closeToTray"), Some(&serde_json::json!(false)));
        assert_eq!(json.get("startMinimized"), Some(&serde_json::json!(true)));

        let parsed: EngineSettings =
            serde_json::from_value(json).expect("settings should deserialize");
        assert!(parsed.autostart_enabled);
        assert!(!parsed.close_to_tray);
        assert!(parsed.start_minimized);
    }

    #[test]
    fn speed_limiter_fields_roundtrip_and_sanitize() {
        let settings = EngineSettings {
            speed_limiter_mode: "global".to_string(),
            global_speed_limit_kb: Some(2048),
            ..Default::default()
        };

        let json = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(json.get("speedLimiterMode"), Some(&serde_json::json!("global")));
        assert_eq!(json.get("globalSpeedLimitKb"), Some(&serde_json::json!(2048)));

        let parsed: EngineSettings =
            serde_json::from_value(json).expect("settings should deserialize");
        assert_eq!(parsed.speed_limiter_mode, "global");
        assert_eq!(parsed.global_speed_limit_kb, Some(2048));

        // Unknown mode falls back to per_download, negative kb clamped to None
        let invalid = EngineSettings {
            speed_limiter_mode: "invalid_mode".to_string(),
            global_speed_limit_kb: Some(-100),
            ..Default::default()
        }
        .sanitized();

        assert_eq!(invalid.speed_limiter_mode, "per_download");
        assert_eq!(invalid.global_speed_limit_kb, None);
    }

    #[test]
    fn scheduler_settings_roundtrip_and_sanitize() {
        let settings = SchedulerSettings {
            enabled: true,
            start_time: "03:30".to_string(),
            stop_time: Some("07:15".to_string()),
            days: vec![1, 2, 3, 4, 5],
            action_on_finish: "shutdown".to_string(),
            max_concurrent_queue: 3,
        };

        let json = serde_json::to_value(&settings).expect("scheduler settings should serialize");
        assert_eq!(json.get("enabled"), Some(&serde_json::json!(true)));
        assert_eq!(json.get("startTime"), Some(&serde_json::json!("03:30")));
        assert_eq!(json.get("actionOnFinish"), Some(&serde_json::json!("shutdown")));
        assert_eq!(json.get("maxConcurrentQueue"), Some(&serde_json::json!(3)));

        let parsed: SchedulerSettings =
            serde_json::from_value(json).expect("scheduler settings should deserialize");
        assert_eq!(parsed, settings);

        // Sanitize handles invalid times, actions, and concurrency bounds
        let invalid = SchedulerSettings {
            enabled: true,
            start_time: "99:99".to_string(),
            stop_time: Some("invalid".to_string()),
            days: vec![0, 2, 2, 8],
            action_on_finish: "explode".to_string(),
            max_concurrent_queue: 50,
        }
        .sanitized();

        assert_eq!(invalid.start_time, "02:00");
        assert_eq!(invalid.stop_time, None);
        assert_eq!(invalid.days, vec![2]);
        assert_eq!(invalid.action_on_finish, "none");
        assert_eq!(invalid.max_concurrent_queue, 10);
    }
}
