use crate::db::Database;
use crate::engine::EngineManager;
use crate::settings::UpdaterSettings;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const STATUS_EVENT: &str = "rheow-update-status";
const PROGRESS_EVENT: &str = "rheow-update-progress";
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const PAUSE_TIMEOUT: Duration = Duration::from_secs(15);
const AUTO_CHECK_DELAY: Duration = Duration::from_secs(10);
const AUTO_CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const PROGRESS_EMIT_INTERVAL_MS: u64 = 150;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    NeedsPause,
    Installing,
    UpToDate,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub phase: UpdatePhase,
    pub current_version: String,
    pub info: Option<UpdateInfo>,
    pub progress: Option<UpdateProgress>,
    pub active_downloads: usize,
    pub error: Option<String>,
    pub manual: bool,
    pub settings: UpdaterSettings,
    pub dismissed: bool,
}

struct UpdaterInner {
    phase: UpdatePhase,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    info: Option<UpdateInfo>,
    progress: Option<UpdateProgress>,
    error: Option<String>,
    manual: bool,
}

impl Default for UpdaterInner {
    fn default() -> Self {
        Self {
            phase: UpdatePhase::Idle,
            update: None,
            bytes: None,
            info: None,
            progress: None,
            error: None,
            manual: false,
        }
    }
}

/// Owns the updater lifecycle. React only reads `UpdateState` and calls the
/// commands below; all network, signature verification, pausing, and database
/// backup work happens here so it still runs while the window is hidden.
#[derive(Clone)]
pub struct UpdaterState {
    db: Arc<Database>,
    engine: Arc<EngineManager>,
    inner: Arc<tokio::sync::Mutex<UpdaterInner>>,
}

impl UpdaterState {
    pub fn new(db: Arc<Database>, engine: Arc<EngineManager>) -> Self {
        Self {
            db,
            engine,
            inner: Arc::new(tokio::sync::Mutex::new(UpdaterInner::default())),
        }
    }

    pub async fn snapshot(&self, app: &AppHandle) -> UpdateState {
        let active_downloads = self.engine.active_downloads_count().await;
        let settings = self.db.get_updater_settings();
        let inner = self.inner.lock().await;

        let dismissed = inner.info.as_ref().is_some_and(|info| {
            settings.dismissed_version.as_deref() == Some(info.version.as_str())
        });

        UpdateState {
            phase: inner.phase,
            current_version: app.package_info().version.to_string(),
            info: inner.info.clone(),
            progress: inner.progress.clone(),
            active_downloads,
            error: inner.error.clone(),
            manual: inner.manual,
            settings,
            dismissed,
        }
    }

    async fn emit(&self, app: &AppHandle) {
        let _ = app.emit(STATUS_EVENT, self.snapshot(app).await);
    }

    /// Checks the configured endpoint. Manual checks report errors; automatic
    /// checks stay quiet so a laptop that boots offline is not greeted with an
    /// error banner.
    pub async fn check(&self, app: &AppHandle, manual: bool) -> UpdateState {
        {
            let mut inner = self.inner.lock().await;
            if matches!(
                inner.phase,
                UpdatePhase::Checking
                    | UpdatePhase::Downloading
                    | UpdatePhase::Installing
                    | UpdatePhase::Ready
                    | UpdatePhase::NeedsPause
            ) {
                drop(inner);
                return self.snapshot(app).await;
            }

            inner.phase = UpdatePhase::Checking;
            inner.manual = manual;
            inner.error = None;
            inner.progress = None;
        }
        self.emit(app).await;

        let result = async {
            let updater = app
                .updater_builder()
                .timeout(CHECK_TIMEOUT)
                .build()
                .map_err(|error| error.to_string())?;
            updater.check().await.map_err(|error| error.to_string())
        }
        .await;

        {
            let mut inner = self.inner.lock().await;
            match result {
                Ok(Some(update)) => {
                    let published_at = update.date.and_then(|date| {
                        chrono::DateTime::from_timestamp(date.unix_timestamp(), 0)
                            .map(|value| value.to_rfc3339())
                    });
                    inner.info = Some(UpdateInfo {
                        version: update.version.clone(),
                        notes: update.body.clone().unwrap_or_default(),
                        published_at,
                    });
                    inner.update = Some(update);
                    inner.bytes = None;
                    inner.phase = UpdatePhase::Available;
                    inner.error = None;
                    inner.progress = None;
                }
                Ok(None) => {
                    inner.phase = UpdatePhase::UpToDate;
                    inner.update = None;
                    inner.bytes = None;
                    inner.info = None;
                    inner.error = None;
                    inner.progress = None;
                }
                Err(error) => {
                    inner.phase = if manual {
                        UpdatePhase::Error
                    } else {
                        UpdatePhase::Idle
                    };
                    inner.error = Some(error);
                    inner.progress = None;
                }
            }
            inner.manual = manual;
        }

        let mut settings = self.db.get_updater_settings();
        settings.last_check_at = Some(chrono::Utc::now().to_rfc3339());
        let _ = self.db.save_updater_settings(&settings);

        self.emit(app).await;
        self.snapshot(app).await
    }

    /// Downloads the available package into memory. The updater plugin
    /// verifies the minisign signature before returning the bytes, so the
    /// package is never written to disk in an unverified state.
    pub async fn download(&self, app: &AppHandle) -> UpdateState {
        let update = {
            let mut inner = self.inner.lock().await;
            if !matches!(inner.phase, UpdatePhase::Available | UpdatePhase::Error) {
                drop(inner);
                return self.snapshot(app).await;
            }
            let Some(update) = inner.update.clone() else {
                inner.phase = UpdatePhase::Error;
                inner.error = Some("No update is available to download.".to_string());
                drop(inner);
                self.emit(app).await;
                return self.snapshot(app).await;
            };

            inner.phase = UpdatePhase::Downloading;
            inner.error = None;
            inner.bytes = None;
            inner.progress = Some(UpdateProgress {
                downloaded: 0,
                total: None,
                percent: 0.0,
            });
            update
        };
        self.emit(app).await;

        let downloaded = Arc::new(AtomicU64::new(0));
        let total = Arc::new(AtomicU64::new(0));
        let last_emit = Arc::new(AtomicU64::new(0));
        let started = Instant::now();

        let progress_app = app.clone();
        let progress_downloaded = downloaded.clone();
        let progress_total = total.clone();
        let progress_last_emit = last_emit.clone();

        let result = update
            .download(
                move |chunk_len, content_length| {
                    let current = progress_downloaded
                        .fetch_add(chunk_len as u64, Ordering::Relaxed)
                        + chunk_len as u64;
                    if let Some(content_length) = content_length {
                        progress_total.store(content_length, Ordering::Relaxed);
                    }

                    let now = started.elapsed().as_millis() as u64;
                    let previous = progress_last_emit.load(Ordering::Relaxed);
                    let finished = content_length.is_some_and(|total| current >= total);
                    if finished || now.saturating_sub(previous) >= PROGRESS_EMIT_INTERVAL_MS {
                        progress_last_emit.store(now, Ordering::Relaxed);
                        let total_bytes = progress_total.load(Ordering::Relaxed);
                        let total_option = (total_bytes > 0).then_some(total_bytes);
                        let percent = total_option
                            .map(|total| (current as f64 / total as f64 * 100.0).min(100.0))
                            .unwrap_or(0.0);
                        let _ = progress_app.emit(
                            PROGRESS_EVENT,
                            UpdateProgress {
                                downloaded: current,
                                total: total_option,
                                percent,
                            },
                        );
                    }
                },
                || {},
            )
            .await;

        let downloaded_bytes = downloaded.load(Ordering::Relaxed);
        let total_bytes = total.load(Ordering::Relaxed);
        let total_option = (total_bytes > 0).then_some(total_bytes);

        {
            let mut inner = self.inner.lock().await;
            match result {
                Ok(bytes) => {
                    inner.bytes = Some(bytes);
                    inner.phase = UpdatePhase::Ready;
                    inner.progress = Some(UpdateProgress {
                        downloaded: downloaded_bytes,
                        total: total_option,
                        percent: 100.0,
                    });
                    inner.error = None;
                }
                Err(error) => {
                    inner.phase = UpdatePhase::Error;
                    inner.error = Some(error.to_string());
                    inner.progress = None;
                }
            }
        }

        self.emit(app).await;
        self.snapshot(app).await
    }

    /// Pauses active downloads (when the user agreed), waits for their
    /// checkpoints to flush, backs up the database, and hands the verified
    /// installer to the updater plugin. On Windows the plugin exits the process
    /// after launching the NSIS installer; the installer restarts Rheow.
    pub async fn install(&self, app: &AppHandle, pause_all: bool) -> UpdateState {
        if cfg!(debug_assertions) {
            return self
                .fail(
                    app,
                    "Updates cannot be installed from a development build.".to_string(),
                )
                .await;
        }

        let (update, bytes) = {
            let mut inner = self.inner.lock().await;
            if !matches!(inner.phase, UpdatePhase::Ready | UpdatePhase::NeedsPause) {
                drop(inner);
                return self.snapshot(app).await;
            }

            let Some(update) = inner.update.clone() else {
                drop(inner);
                return self
                    .fail(app, "No verified update is ready to install.".to_string())
                    .await;
            };
            let Some(bytes) = inner.bytes.clone() else {
                drop(inner);
                return self
                    .fail(
                        app,
                        "The update package is missing. Download it again.".to_string(),
                    )
                    .await;
            };

            let active_downloads = self.engine.active_downloads_count().await;
            if active_downloads > 0 && !pause_all {
                inner.phase = UpdatePhase::NeedsPause;
                inner.error = None;
                drop(inner);
                self.emit(app).await;
                return self.snapshot(app).await;
            }

            inner.phase = UpdatePhase::Installing;
            inner.error = None;
            (update, bytes)
        };
        self.emit(app).await;

        let queue_was_running = self.engine.is_queue_running();
        let paused_ids = self.active_download_ids().await;

        // Stop the queue even when nothing is active: a queued download must not
        // start writing checkpoints while the database is being snapshotted.
        self.engine.set_queue_running(false);
        let _ = app.emit(
            "queue-status-changed",
            serde_json::json!({ "isRunning": false }),
        );

        if pause_all {
            if let Err(error) = self.engine.pause_all_downloads(app).await {
                return self
                    .fail_and_resume(
                        app,
                        format!("Update cancelled: failed to pause downloads: {error}"),
                        &paused_ids,
                        queue_was_running,
                    )
                    .await;
            }

            if !self.wait_for_downloads_to_stop(PAUSE_TIMEOUT).await {
                return self
                    .fail_and_resume(
                        app,
                        "Update cancelled: downloads did not pause in time.".to_string(),
                        &paused_ids,
                        queue_was_running,
                    )
                    .await;
            }
        }

        let current_version = app.package_info().version.to_string();
        if let Err(error) = self.db.backup_before_update(&current_version) {
            return self
                .fail_and_resume(
                    app,
                    format!("Update cancelled: {error}"),
                    &paused_ids,
                    queue_was_running,
                )
                .await;
        }

        if let Err(error) = update.install(&bytes) {
            return self
                .fail_and_resume(
                    app,
                    format!("Update cancelled: failed to start the installer: {error}"),
                    &paused_ids,
                    queue_was_running,
                )
                .await;
        }

        // `install` exits the process on Windows, so this is only reached if a
        // future platform returns without exiting.
        self.snapshot(app).await
    }

    pub async fn save_settings(
        &self,
        app: &AppHandle,
        settings: UpdaterSettings,
    ) -> Result<UpdaterSettings, String> {
        let current = self.db.get_updater_settings();
        let sanitized = UpdaterSettings {
            auto_check: settings.auto_check,
            last_check_at: current.last_check_at,
            dismissed_version: settings.dismissed_version,
        };
        self.db
            .save_updater_settings(&sanitized)
            .map_err(|error| error.to_string())?;
        self.emit(app).await;

        if !current.auto_check && sanitized.auto_check {
            let state = self.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = state.check(&app, false).await;
            });
        }

        Ok(sanitized)
    }

    pub async fn dismiss(&self, app: &AppHandle, version: String) -> Result<(), String> {
        let mut settings = self.db.get_updater_settings();
        settings.dismissed_version = Some(version);
        self.db
            .save_updater_settings(&settings)
            .map_err(|error| error.to_string())?;
        self.emit(app).await;
        Ok(())
    }

    async fn active_download_ids(&self) -> Vec<String> {
        let active = self.engine.active_downloads.lock().await;
        active.keys().cloned().collect()
    }

    async fn wait_for_downloads_to_stop(&self, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.engine.active_downloads_count().await == 0 {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    async fn fail(&self, app: &AppHandle, message: String) -> UpdateState {
        {
            let mut inner = self.inner.lock().await;
            inner.phase = UpdatePhase::Error;
            inner.error = Some(message);
            inner.progress = None;
        }
        self.emit(app).await;
        self.snapshot(app).await
    }

    async fn fail_and_resume(
        &self,
        app: &AppHandle,
        message: String,
        paused_ids: &[String],
        queue_was_running: bool,
    ) -> UpdateState {
        for id in paused_ids {
            let _ = self.engine.resume_download(app, id).await;
        }

        self.engine.set_queue_running(queue_was_running);
        let _ = app.emit(
            "queue-status-changed",
            serde_json::json!({ "isRunning": queue_was_running }),
        );
        if queue_was_running {
            let engine = self.engine.clone();
            let app_for_queue = app.clone();
            tauri::async_runtime::spawn(async move {
                engine.process_next_queued(app_for_queue).await;
            });
        }

        self.fail(app, message).await
    }
}

/// First check runs shortly after startup, then once a day. Development builds
/// skip the background loop so `tauri dev` never offers to replace itself.
pub async fn run_background_loop(state: UpdaterState, app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    tokio::time::sleep(AUTO_CHECK_DELAY).await;
    loop {
        if state.db.get_updater_settings().auto_check {
            let _ = state.check(&app, false).await;
        }
        tokio::time::sleep(AUTO_CHECK_INTERVAL).await;
    }
}

#[tauri::command]
pub async fn get_update_state(
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> Result<UpdateState, String> {
    Ok(state.snapshot(&app).await)
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, UpdaterState>,
    manual: bool,
) -> Result<UpdateState, String> {
    Ok(state.check(&app, manual).await)
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> Result<UpdateState, String> {
    Ok(state.download(&app).await)
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, UpdaterState>,
    pause_all: bool,
) -> Result<UpdateState, String> {
    Ok(state.install(&app, pause_all).await)
}

#[tauri::command]
pub async fn get_updater_settings(
    state: State<'_, UpdaterState>,
) -> Result<UpdaterSettings, String> {
    Ok(state.db.get_updater_settings())
}

#[tauri::command]
pub async fn save_updater_settings(
    app: AppHandle,
    state: State<'_, UpdaterState>,
    settings: UpdaterSettings,
) -> Result<UpdaterSettings, String> {
    state.save_settings(&app, settings).await
}

#[tauri::command]
pub async fn dismiss_update(
    app: AppHandle,
    state: State<'_, UpdaterState>,
    version: String,
) -> Result<(), String> {
    state.dismiss(&app, version).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_serializes_for_the_frontend() {
        let phases = [
            (UpdatePhase::Idle, "\"idle\""),
            (UpdatePhase::NeedsPause, "\"needsPause\""),
            (UpdatePhase::UpToDate, "\"upToDate\""),
        ];

        for (phase, expected) in phases {
            assert_eq!(serde_json::to_string(&phase).unwrap(), expected);
        }
    }

    #[test]
    fn progress_serializes_camel_case() {
        let progress = UpdateProgress {
            downloaded: 1024,
            total: Some(2048),
            percent: 50.0,
        };
        let value = serde_json::to_value(progress).unwrap();
        assert_eq!(value["downloaded"], 1024);
        assert_eq!(value["total"], 2048);
        assert_eq!(value["percent"], 50.0);
    }
}
