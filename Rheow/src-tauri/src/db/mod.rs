pub mod schema;

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::settings::{EngineSettings, SchedulerSettings, UpdaterSettings};

const ENGINE_SETTINGS_KEY: &str = "engine_settings";
const SCHEDULER_SETTINGS_KEY: &str = "scheduler_settings";
const UPDATER_SETTINGS_KEY: &str = "updater_settings";
const UPDATE_BACKUP_LIMIT: usize = 2;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub category: String,
    pub destination_path: String,
    pub total_size: i64,
    pub downloaded_size: i64,
    pub speed: f64,
    pub eta_seconds: i64,
    pub status: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub open_folder_on_finish: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub cookie: Option<String>,
    pub referer: Option<String>,
    pub speed_limit_kb: Option<i64>,
    pub segment_count: Option<i64>,
    pub supports_range: bool,
}

impl Default for DownloadRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            url: String::new(),
            filename: String::new(),
            category: "Other".to_string(),
            destination_path: String::new(),
            total_size: 0,
            downloaded_size: 0,
            speed: 0.0,
            eta_seconds: 0,
            status: "downloading".to_string(),
            etag: None,
            last_modified: None,
            open_folder_on_finish: true,
            created_at: String::new(),
            completed_at: None,
            cookie: None,
            referer: None,
            speed_limit_kb: None,
            segment_count: Some(8),
            supports_range: true,
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SegmentRecord {
    pub id: i64,
    pub download_id: String,
    pub segment_index: i32,
    pub start_offset: i64,
    pub end_offset: i64,
    pub current_offset: i64,
    pub is_completed: bool,
}

pub struct Database {
    pub conn: Mutex<Connection>,
    /// Path of the SQLite file. `:memory:` databases have no parent and cannot
    /// be backed up before an update.
    path: PathBuf,
}

fn map_download_row(row: &rusqlite::Row) -> rusqlite::Result<DownloadRecord> {
    let open_flag: i32 = row.get(12).unwrap_or(1);
    let supports_range_flag: i32 = row.get(19).unwrap_or(1);
    Ok(DownloadRecord {
        id: row.get(0)?,
        url: row.get(1)?,
        filename: row.get(2)?,
        category: row.get(3)?,
        destination_path: row.get(4)?,
        total_size: row.get(5).unwrap_or(0),
        downloaded_size: row.get(6).unwrap_or(0),
        speed: row.get(7).unwrap_or(0.0),
        eta_seconds: row.get(8).unwrap_or(0),
        status: row.get(9)?,
        etag: row.get(10).ok(),
        last_modified: row.get(11).ok(),
        open_folder_on_finish: open_flag == 1,
        created_at: row
            .get(13)
            .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339()),
        completed_at: row.get(14).ok(),
        cookie: row.get(15).ok(),
        referer: row.get(16).ok(),
        speed_limit_kb: row.get(17).ok(),
        segment_count: row.get(18).ok(),
        supports_range: supports_range_flag == 1,
    })
}

impl Database {
    pub fn new(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(schema::CREATE_DOWNLOADS_TABLE)?;
        conn.execute_batch(schema::CREATE_SEGMENTS_TABLE)?;
        conn.execute_batch(schema::CREATE_SETTINGS_TABLE)?;

        // Safe migrations for preexisting databases
        let _ = conn.execute("ALTER TABLE downloads ADD COLUMN cookie TEXT", []);
        let _ = conn.execute("ALTER TABLE downloads ADD COLUMN referer TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE downloads ADD COLUMN speed_limit_kb INTEGER",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE downloads ADD COLUMN segment_count INTEGER DEFAULT 8",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE downloads ADD COLUMN supports_range INTEGER DEFAULT 1",
            [],
        );

        let db = Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        };

        // Older builds seeded fictional rows into real databases. Remove them
        // once (idempotent) so they never show up again, including the fake
        // "queued" row that could otherwise be downloaded by the queue worker.
        let _ = db.purge_legacy_demo_rows();

        Ok(db)
    }

    /// Deletes the demo rows inserted by old builds. A row is only removed when
    /// both its id and URL match the known fictional entries, so a genuine
    /// download is never touched.
    pub fn purge_legacy_demo_rows(&self) -> Result<usize> {
        const LEGACY_DEMO_ROWS: &[(&str, &str)] = &[
            (
                "row-spiderman",
                "https://drive.usercontent.google.com/download?id=spiderman2026",
            ),
            (
                "row-1",
                "https://updates.cdprojektred.com/patches/cyberpunk_2077_patch_2.12.zip",
            ),
            (
                "row-4",
                "https://download.blender.org/source/Blender_4.1_Release_Candidate.tar.xz",
            ),
            (
                "row-5",
                "https://cdn.frontendmasters.com/courses/Tailwind_v4_Masterclass_4K.mp4",
            ),
            (
                "row-7",
                "https://github.com/EpicGames/UnrealEngine/UnrealEngine_5.4_Linux_Source.zip",
            ),
            (
                "d76aeaa2-d641-4a50-b7f4-c9babe48a7cc",
                "https://www.sqlite.org/2024/sqlite-tools-win-x64-3460100.zip",
            ),
            (
                "c2664de6-7de0-4992-b534-a45946f7111e",
                "https://www.python.org/ftp/python/3.12.0/python-3.12.0-embed-amd64.zip",
            ),
            (
                "2f61d2c1-c502-4b98-a832-693c606c97dd",
                "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi",
            ),
            (
                "991e7c35-2315-4eec-bced-e2f48cae1b70",
                "https://ftp.mozilla.org/pub/firefox/releases/130.0/win64/en-US/Firefox%20Setup%20130.0.exe",
            ),
            (
                "7a157f16-3b3c-41e9-ba11-721b9fa6f27f",
                "https://dl.google.com/go/go1.23.2.windows-amd64.zip",
            ),
        ];

        let conn = self.conn.lock().unwrap();
        let mut removed = 0usize;

        for (id, url) in LEGACY_DEMO_ROWS {
            let deleted = conn.execute(
                "DELETE FROM downloads WHERE id = ?1 AND url = ?2",
                params![id, url],
            )?;
            if deleted > 0 {
                conn.execute(
                    "DELETE FROM download_segments WHERE download_id = ?1",
                    params![id],
                )?;
                removed += deleted;
            }
        }

        Ok(removed)
    }

    pub fn insert_download(&self, record: &DownloadRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT OR REPLACE INTO downloads (
                id, url, filename, category, destination_path, total_size,
                downloaded_size, speed, eta_seconds, status, etag, last_modified,
                open_folder_on_finish, created_at, completed_at, cookie, referer,
                speed_limit_kb, segment_count, supports_range
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)"#,
            params![
                record.id,
                record.url,
                record.filename,
                record.category,
                record.destination_path,
                record.total_size,
                record.downloaded_size,
                record.speed,
                record.eta_seconds,
                record.status,
                record.etag,
                record.last_modified,
                if record.open_folder_on_finish { 1 } else { 0 },
                record.created_at,
                record.completed_at,
                record.cookie,
                record.referer,
                record.speed_limit_kb,
                record.segment_count,
                if record.supports_range { 1 } else { 0 },
            ],
        )?;
        Ok(())
    }

    pub fn get_all_downloads(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, url, filename, category, destination_path, total_size,
                      downloaded_size, speed, eta_seconds, status, etag, last_modified,
                      open_folder_on_finish, created_at, completed_at, cookie, referer,
                      speed_limit_kb, segment_count, supports_range
               FROM downloads ORDER BY created_at DESC"#,
        )?;

        let rows = stmt.query_map([], map_download_row)?;
        let mut list = Vec::new();
        for r in rows {
            if let Ok(item) = r {
                list.push(item);
            }
        }
        Ok(list)
    }

    pub fn get_download_by_id(&self, id: &str) -> Result<Option<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, url, filename, category, destination_path, total_size,
                      downloaded_size, speed, eta_seconds, status, etag, last_modified,
                      open_folder_on_finish, created_at, completed_at, cookie, referer,
                      speed_limit_kb, segment_count, supports_range
               FROM downloads WHERE id = ?1"#,
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(map_download_row(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn update_supports_range(&self, id: &str, supports_range: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET supports_range = ?1 WHERE id = ?2",
            params![if supports_range { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn update_status_and_completion(
        &self,
        id: &str,
        status: &str,
        completed_at: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET status = ?1, completed_at = ?2 WHERE id = ?3",
            params![status, completed_at, id],
        )?;
        Ok(())
    }

    /// Updates the URL and authentication headers (cookie, referer) as well as
    /// the fresh validator tokens (etag, last_modified) for an expired or
    /// refreshed download link. Checkpoints and downloaded bytes are strictly
    /// preserved so the download can resume seamlessly.
    pub fn update_download_url(
        &self,
        id: &str,
        url: &str,
        cookie: Option<&str>,
        referer: Option<&str>,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"UPDATE downloads SET
                url = ?1,
                cookie = COALESCE(?2, cookie),
                referer = COALESCE(?3, referer),
                etag = ?4,
                last_modified = ?5,
                status = 'paused'
               WHERE id = ?6"#,
            params![url, cookie, referer, etag, last_modified, id],
        )?;
        Ok(())
    }

    pub fn update_progress(
        &self,
        id: &str,
        downloaded_size: i64,
        speed: f64,
        eta_seconds: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if downloaded_size >= 0 {
            conn.execute(
                "UPDATE downloads SET downloaded_size = ?1, speed = ?2, eta_seconds = ?3 WHERE id = ?4",
                params![downloaded_size, speed, eta_seconds, id],
            )?;
        } else {
            conn.execute(
                "UPDATE downloads SET speed = ?1, eta_seconds = ?2 WHERE id = ?3",
                params![speed, eta_seconds, id],
            )?;
        }
        Ok(())
    }

    pub fn update_speed_limit(&self, id: &str, speed_limit_kb: Option<i64>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET speed_limit_kb = ?1 WHERE id = ?2",
            params![speed_limit_kb, id],
        )?;
        Ok(())
    }

    /// Demotes rows that were left mid-flight (crash, forced exit, power loss)
    /// back to `paused`. Returns the ids that changed so the caller can emit UI
    /// events. Progress and segment checkpoints are intentionally preserved.
    pub fn demote_downloading_to_paused(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM downloads WHERE status = 'downloading'")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<String>>>()?
        };

        if !ids.is_empty() {
            conn.execute(
                "UPDATE downloads SET status = 'paused', speed = 0, eta_seconds = 0 WHERE status = 'downloading'",
                [],
            )?;
        }

        Ok(ids)
    }

    /// Refresh the remote-file metadata discovered by the probe so later resume
    /// attempts can validate the server state against it. `downloaded_size` is
    /// intentionally left untouched.
    pub fn update_metadata(
        &self,
        id: &str,
        total_size: i64,
        etag: Option<String>,
        last_modified: Option<String>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET total_size = ?1, etag = ?2, last_modified = ?3 WHERE id = ?4",
            params![total_size, etag, last_modified, id],
        )?;
        Ok(())
    }

    /// Persists the engine preferences as a single JSON blob.
    pub fn save_engine_settings(&self, settings: &EngineSettings) -> Result<()> {
        let json = serde_json::to_string(settings)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![ENGINE_SETTINGS_KEY, json],
        )?;
        Ok(())
    }

    /// Returns `None` when no settings have been saved yet, allowing the
    /// frontend to migrate its existing localStorage values on first launch.
    pub fn get_engine_settings(&self) -> Option<EngineSettings> {
        let stored: Option<String> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![ENGINE_SETTINGS_KEY],
                |row| row.get(0),
            )
            .ok()
        };

        stored.and_then(|json| serde_json::from_str::<EngineSettings>(&json).ok())
    }

    /// Persists the scheduler configuration as a single JSON blob.
    pub fn save_scheduler_settings(&self, settings: &SchedulerSettings) -> Result<()> {
        let json = serde_json::to_string(settings)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SCHEDULER_SETTINGS_KEY, json],
        )?;
        Ok(())
    }

    /// Reads scheduler configuration from SQLite or returns sanitized defaults.
    pub fn get_scheduler_settings(&self) -> SchedulerSettings {
        let stored: Option<String> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![SCHEDULER_SETTINGS_KEY],
                |row| row.get(0),
            )
            .ok()
        };

        stored
            .and_then(|json| serde_json::from_str::<SchedulerSettings>(&json).ok())
            .unwrap_or_default()
            .sanitized()
    }

    /// Persists the updater preferences as a single JSON blob.
    pub fn save_updater_settings(&self, settings: &UpdaterSettings) -> Result<()> {
        let json = serde_json::to_string(settings)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![UPDATER_SETTINGS_KEY, json],
        )?;
        Ok(())
    }

    /// Reads updater preferences, falling back to auto-check enabled.
    pub fn get_updater_settings(&self) -> UpdaterSettings {
        let stored: Option<String> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![UPDATER_SETTINGS_KEY],
                |row| row.get(0),
            )
            .ok()
        };

        stored
            .and_then(|json| serde_json::from_str::<UpdaterSettings>(&json).ok())
            .unwrap_or_default()
    }

    /// Creates a consistent SQLite snapshot next to the live database and
    /// verifies it before returning. The last two snapshots are kept.
    ///
    /// The caller must pause active downloads before calling this so no worker
    /// is writing checkpoints while `VACUUM INTO` runs.
    pub fn backup_before_update(&self, from_version: &str) -> std::result::Result<PathBuf, String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "Cannot back up an in-memory database".to_string())?;
        let backup_dir = parent.join("backups");
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup directory: {e}"))?;

        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
        let backup_path = backup_dir.join(format!("rheow-{from_version}-{stamp}.db"));

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "VACUUM INTO ?1",
                params![backup_path.to_string_lossy().to_string()],
            )
            .map_err(|e| format!("Failed to back up database: {e}"))?;
        }

        let integrity = Connection::open(&backup_path)
            .and_then(|conn| {
                conn.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            })
            .map_err(|e| format!("Failed to verify database backup: {e}"))?;

        if integrity != "ok" {
            let _ = std::fs::remove_file(&backup_path);
            return Err(format!(
                "Database backup failed integrity check: {integrity}"
            ));
        }

        prune_update_backups(&backup_dir, UPDATE_BACKUP_LIMIT);
        Ok(backup_path)
    }

    pub fn get_next_queued_downloads(&self, limit: usize) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, url, filename, category, destination_path, total_size,
                      downloaded_size, speed, eta_seconds, status, etag, last_modified,
                      open_folder_on_finish, created_at, completed_at, cookie, referer,
                      speed_limit_kb, segment_count, supports_range
               FROM downloads WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?1"#,
        )?;

        let rows = stmt.query_map(params![limit as i64], map_download_row)?;
        let mut list = Vec::new();
        for r in rows {
            if let Ok(item) = r {
                list.push(item);
            }
        }
        Ok(list)
    }

    pub fn get_paused_downloads(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, url, filename, category, destination_path, total_size,
                      downloaded_size, speed, eta_seconds, status, etag, last_modified,
                      open_folder_on_finish, created_at, completed_at, cookie, referer,
                      speed_limit_kb, segment_count, supports_range
               FROM downloads WHERE status = 'paused' ORDER BY created_at ASC"#,
        )?;

        let rows = stmt.query_map([], map_download_row)?;
        let mut list = Vec::new();
        for r in rows {
            if let Ok(item) = r {
                list.push(item);
            }
        }
        Ok(list)
    }

    pub fn delete_download(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
        conn.execute(
            "DELETE FROM download_segments WHERE download_id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn reset_for_redownload(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET downloaded_size = 0, status = 'queued', completed_at = NULL, speed = 0, eta_seconds = 0 WHERE id = ?1",
            params![id],
        )?;
        conn.execute(
            "DELETE FROM download_segments WHERE download_id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn save_segments(
        &self,
        download_id: &str,
        segments: &[(usize, u64, u64, u64, bool)],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM download_segments WHERE download_id = ?1",
            params![download_id],
        )?;
        {
            let mut stmt = tx.prepare(
                r#"INSERT INTO download_segments (
                    download_id, segment_index, start_offset, end_offset, current_offset, is_completed
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#
            )?;
            for seg in segments {
                stmt.execute(params![
                    download_id,
                    seg.0 as i32,
                    seg.1 as i64,
                    seg.2 as i64,
                    seg.3 as i64,
                    if seg.4 { 1 } else { 0 },
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_segments(&self, download_id: &str) -> Result<Vec<SegmentRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, download_id, segment_index, start_offset, end_offset, current_offset, is_completed
               FROM download_segments WHERE download_id = ?1 ORDER BY segment_index ASC"#
        )?;

        let rows = stmt.query_map(params![download_id], |row| {
            let completed_flag: i32 = row.get(6)?;
            Ok(SegmentRecord {
                id: row.get(0)?,
                download_id: row.get(1)?,
                segment_index: row.get(2)?,
                start_offset: row.get(3)?,
                end_offset: row.get(4)?,
                current_offset: row.get(5)?,
                is_completed: completed_flag == 1,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            if let Ok(seg) = r {
                list.push(seg);
            }
        }
        Ok(list)
    }
}

/// Keeps only the newest `keep` update backups. Deletion failures are ignored:
/// a stale backup is harmless, while failing the install would not be.
fn prune_update_backups(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let is_backup = path.extension().and_then(|ext| ext.to_str()) == Some("db")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("rheow-"));
            if !is_backup {
                return None;
            }

            let modified = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            Some((modified, path))
        })
        .collect();

    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, status: &str) -> DownloadRecord {
        DownloadRecord {
            id: id.to_string(),
            url: "https://example.com/file.zip".to_string(),
            filename: "file.zip".to_string(),
            category: "Compressed".to_string(),
            destination_path: "C:\\Downloads\\file.zip".to_string(),
            total_size: 1000,
            downloaded_size: 250,
            speed: 12.5,
            eta_seconds: 30,
            status: status.to_string(),
            etag: None,
            last_modified: None,
            open_folder_on_finish: false,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            completed_at: None,
            cookie: None,
            referer: None,
            speed_limit_kb: None,
            segment_count: Some(8),
            supports_range: true,
            ..Default::default()
        }
    }

    #[test]
    fn demotes_only_interrupted_downloads() {
        let db = Database::new(std::path::Path::new(":memory:")).unwrap();
        db.insert_download(&record("active", "downloading"))
            .unwrap();
        db.insert_download(&record("done", "completed")).unwrap();
        db.insert_download(&record("waiting", "queued")).unwrap();

        let recovered = db.demote_downloading_to_paused().unwrap();
        assert_eq!(recovered, vec!["active".to_string()]);

        let active = db.get_download_by_id("active").unwrap().unwrap();
        assert_eq!(active.status, "paused");
        assert_eq!(active.speed, 0.0);
        assert_eq!(active.eta_seconds, 0);
        // Progress survives so the resume path can pick up where it stopped.
        assert_eq!(active.downloaded_size, 250);

        assert_eq!(
            db.get_download_by_id("done").unwrap().unwrap().status,
            "completed"
        );
        assert_eq!(
            db.get_download_by_id("waiting").unwrap().unwrap().status,
            "queued"
        );

        // Idempotent: a second pass finds nothing left to recover.
        assert!(db.demote_downloading_to_paused().unwrap().is_empty());
    }

    #[test]
    fn resets_download_for_redownload() {
        let db = Database::new(std::path::Path::new(":memory:")).unwrap();
        db.insert_download(&record("dl-1", "completed")).unwrap();
        db.save_segments("dl-1", &[(0, 0, 500, 500, true)]).unwrap();

        assert_eq!(db.get_segments("dl-1").unwrap().len(), 1);

        db.reset_for_redownload("dl-1").unwrap();

        let rec = db.get_download_by_id("dl-1").unwrap().unwrap();
        assert_eq!(rec.status, "queued");
        assert_eq!(rec.downloaded_size, 0);
        assert_eq!(rec.speed, 0.0);
        assert_eq!(rec.eta_seconds, 0);
        assert!(rec.completed_at.is_none());
        assert!(db.get_segments("dl-1").unwrap().is_empty());
    }

    #[test]
    fn updates_download_url_and_preserves_progress() {
        let db = Database::new(std::path::Path::new(":memory:")).unwrap();
        db.insert_download(&record("dl-expired", "error")).unwrap();
        db.save_segments("dl-expired", &[(0, 0, 1000, 250, false)])
            .unwrap();

        let before = db.get_download_by_id("dl-expired").unwrap().unwrap();
        assert_eq!(before.status, "error");
        assert_eq!(before.downloaded_size, 250);
        assert_eq!(before.url, "https://example.com/file.zip");

        db.update_download_url(
            "dl-expired",
            "https://cdn.example.com/refreshed-token/file.zip",
            Some("session=xyz"),
            Some("https://example.com/page"),
            Some("\"new-etag\""),
            Some("Wed, 21 Oct 2026 07:28:00 GMT"),
        )
        .unwrap();

        let after = db.get_download_by_id("dl-expired").unwrap().unwrap();
        assert_eq!(after.status, "paused");
        assert_eq!(
            after.url,
            "https://cdn.example.com/refreshed-token/file.zip"
        );
        assert_eq!(after.cookie.as_deref(), Some("session=xyz"));
        assert_eq!(after.referer.as_deref(), Some("https://example.com/page"));
        assert_eq!(after.etag.as_deref(), Some("\"new-etag\""));
        assert_eq!(
            after.last_modified.as_deref(),
            Some("Wed, 21 Oct 2026 07:28:00 GMT")
        );
        // Existing bytes and segments are intact!
        assert_eq!(after.downloaded_size, 250);
        let segs = db.get_segments("dl-expired").unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].current_offset, 250);
    }

    #[test]
    fn test_supports_range_persistence_and_update() {
        let db = Database::new(std::path::Path::new(":memory:")).unwrap();
        let mut rec = record("dl-range-test", "queued");
        rec.supports_range = true;
        db.insert_download(&rec).unwrap();

        let loaded = db.get_download_by_id("dl-range-test").unwrap().unwrap();
        assert!(loaded.supports_range);

        // Update to false
        db.update_supports_range("dl-range-test", false).unwrap();
        let updated = db.get_download_by_id("dl-range-test").unwrap().unwrap();
        assert!(!updated.supports_range);
    }

    #[test]
    fn updater_settings_roundtrip() {
        let db = Database::new(std::path::Path::new(":memory:")).unwrap();

        // Defaults keep automatic checks enabled.
        let defaults = db.get_updater_settings();
        assert!(defaults.auto_check);
        assert!(defaults.last_check_at.is_none());
        assert!(defaults.dismissed_version.is_none());
        assert!(defaults.pending_notes_version.is_none());
        assert!(defaults.pending_notes.is_none());

        let settings = UpdaterSettings {
            auto_check: false,
            last_check_at: Some("2026-10-27T10:00:00Z".to_string()),
            dismissed_version: Some("1.0.2".to_string()),
            pending_notes_version: Some("1.0.2".to_string()),
            pending_notes: Some("- Added update notes".to_string()),
        };
        db.save_updater_settings(&settings).unwrap();
        assert_eq!(db.get_updater_settings(), settings);
    }

    #[test]
    fn backup_before_update_creates_verified_snapshot() {
        let dir = std::env::temp_dir().join(format!("rheow-backup-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let db = Database::new(&dir.join("rheow.db")).unwrap();
        db.insert_download(&record("dl-backup", "paused")).unwrap();

        let backup = db.backup_before_update("1.0.0").unwrap();
        assert!(backup.exists());
        assert_eq!(backup.parent().unwrap().file_name().unwrap(), "backups");

        let conn = Connection::open(&backup).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM downloads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_retention_keeps_newest_two() {
        let dir =
            std::env::temp_dir().join(format!("rheow-backup-prune-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        for (index, seconds) in [(0, 1u64), (1, 2), (2, 3)] {
            let path = dir.join(format!("rheow-1.0.0-{index}.db"));
            std::fs::write(&path, b"not a real database").unwrap();
            let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
            file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))
                .unwrap();
        }

        prune_update_backups(&dir, 2);

        assert!(!dir.join("rheow-1.0.0-0.db").exists());
        assert!(dir.join("rheow-1.0.0-1.db").exists());
        assert!(dir.join("rheow-1.0.0-2.db").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
