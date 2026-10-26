pub mod limiter;
pub mod prealloc;
pub mod probe;
pub mod segment_worker;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{mpsc, Mutex, Notify};

use crate::db::Database;
use limiter::TokenBucketLimiter;
use segment_worker::{run_segment_worker, SegmentConfig, SegmentProgressUpdate};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SegmentState {
    pub id: usize,
    pub segment_index: usize,
    pub start_offset: u64,
    pub end_offset: u64,
    pub current_offset: u64,
    pub is_completed: bool,
    pub progress_percentage: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgressPayload {
    pub id: String,
    pub total_size: i64,
    pub downloaded_size: i64,
    pub progress_percentage: f64,
    pub speed_bytes_per_second: f64,
    pub eta: String,
    pub status: String,
    pub segments: Vec<SegmentState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_range: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct ActiveDownload {
    pub cancel_flag: Arc<AtomicBool>,
    /// Signalled once the background task has fully stopped writing to disk.
    pub finished: Arc<Notify>,
    pub limiter: Arc<TokenBucketLimiter>,
}

pub struct EngineManager {
    pub active_downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,
    pub db: Arc<Database>,
    pub queue_running: Arc<AtomicBool>,
    pub max_concurrent_downloads: Arc<AtomicUsize>,
    pub global_limiter: Arc<TokenBucketLimiter>,
}

enum FinishKind {
    Completed,
    Paused,
    Failed(String),
}

impl EngineManager {
    pub fn new(db: Arc<Database>) -> Self {
        let settings = db.get_engine_settings().unwrap_or_default().sanitized();
        let initial_global_rate = if settings.speed_limiter_mode == "global" {
            settings.global_speed_limit_kb.unwrap_or(0) * 1024
        } else {
            0
        };
        let scheduler = db.get_scheduler_settings();
        let concurrent = scheduler.max_concurrent_queue;

        Self {
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
            db,
            queue_running: Arc::new(AtomicBool::new(false)),
            max_concurrent_downloads: Arc::new(AtomicUsize::new(concurrent)),
            global_limiter: Arc::new(TokenBucketLimiter::new(initial_global_rate)),
        }
    }

    /// Reconciles state left behind by a crash or a forced exit. A row still
    /// marked `downloading` has no worker behind it any more, so it is demoted
    /// to `paused` (progress and segment checkpoints are kept) instead of
    /// looking active forever. The queue is kicked afterwards so items that
    /// were already queued keep moving after the restart.
    pub async fn recover_after_restart(self: &Arc<Self>, app: &AppHandle) {
        match self.db.demote_downloading_to_paused() {
            Ok(ids) if !ids.is_empty() => {
                eprintln!(
                    "[Rheow] recovered {} interrupted download(s) as paused",
                    ids.len()
                );
                for id in ids {
                    let _ = app.emit(
                        "download-status-changed",
                        serde_json::json!({
                            "id": id,
                            "status": "paused"
                        }),
                    );
                }
            }
            Ok(_) => {}
            Err(err) => {
                eprintln!(
                    "[Rheow] failed to reconcile interrupted downloads: {}",
                    err
                );
            }
        }

        self.process_next_queued(app.clone()).await;
    }

    pub fn set_queue_running(&self, running: bool) {
        self.queue_running.store(running, Ordering::Relaxed);
    }

    pub fn is_queue_running(&self) -> bool {
        self.queue_running.load(Ordering::Relaxed)
    }

    pub fn set_max_concurrent_downloads(&self, count: usize) {
        self.max_concurrent_downloads.store(count.clamp(1, 10), Ordering::Relaxed);
    }

    pub fn get_max_concurrent_downloads(&self) -> usize {
        self.max_concurrent_downloads.load(Ordering::Relaxed)
    }

    pub async fn active_downloads_count(&self) -> usize {
        self.active_downloads.lock().await.len()
    }

    #[allow(dead_code)]
    pub async fn is_active(&self, id: &str) -> bool {
        let map = self.active_downloads.lock().await;
        map.contains_key(id)
    }

    /// Starts a download. If the same id is still winding down after a
    /// pause/cancel, we wait until it has stopped touching the file; if it is
    /// genuinely running we leave it alone.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_download(
        self: &Arc<Self>,
        app: AppHandle,
        id: String,
        url: String,
        destination_path: String,
        total_size: i64,
        segment_count: usize,
        cookie: Option<String>,
        referer: Option<String>,
        etag: Option<String>,
        last_modified: Option<String>,
        speed_limit_kb: Option<i64>,
    ) -> Result<(), String> {
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(Notify::new());
        let initial_rate = speed_limit_kb.filter(|&k| k > 0).unwrap_or(0) * 1024;
        let limiter = Arc::new(TokenBucketLimiter::new(initial_rate));

        loop {
            let stopping = {
                let map = self.active_downloads.lock().await;
                match map.get(&id) {
                    Some(active) if !active.cancel_flag.load(Ordering::Relaxed) => {
                        return Ok(()); // Already running.
                    }
                    Some(active) => Some(active.finished.clone()),
                    None => None,
                }
            };

            match stopping {
                Some(notify) => {
                    // Wait for the old task to release the destination file.
                    notify.notified().await;
                }
                None => {
                    let mut map = self.active_downloads.lock().await;
                    if map.contains_key(&id) {
                        continue;
                    }
                    map.insert(
                        id.clone(),
                        ActiveDownload {
                            cancel_flag: cancel_flag.clone(),
                            finished: finished.clone(),
                            limiter: limiter.clone(),
                        },
                    );
                    break;
                }
            }
        }

        let _ = self
            .db
            .update_status_and_completion(&id, "downloading", None);
        let _ = app.emit(
            "download-status-changed",
            serde_json::json!({
                "id": &id,
                "status": "downloading"
            }),
        );

        let db_clone = self.db.clone();
        let app_clone = app.clone();
        let download_id = id.clone();
        let self_clone = self.clone();
        let task_limiter = limiter.clone();
        let global_limiter = self.global_limiter.clone();

        tokio::spawn(async move {
            let result = execute_download(
                &app_clone,
                db_clone.clone(),
                &download_id,
                url,
                PathBuf::from(destination_path),
                total_size,
                segment_count,
                cookie,
                referer,
                etag,
                last_modified,
                task_limiter,
                global_limiter,
                cancel_flag,
            )
            .await;

            if let Err(err) = result {
                eprintln!("[Rheow] download {} aborted: {}", download_id, err);

                // Only surface the failure if the task did not already settle
                // into a terminal state, and the row still exists.
                let current = db_clone
                    .get_download_by_id(&download_id)
                    .ok()
                    .flatten()
                    .map(|r| r.status);

                if let Some(status) = current {
                    if status != "error"
                        && status != "paused"
                        && status != "cancelled"
                        && status != "completed"
                    {
                        let _ = db_clone.update_status(&download_id, "error");
                        let _ = app_clone.emit(
                            "download-status-changed",
                            serde_json::json!({
                                "id": download_id.clone(),
                                "status": "error",
                                "error": err,
                            }),
                        );
                    }
                }
            }

            {
                let mut map = self_clone.active_downloads.lock().await;
                map.remove(&download_id);
            }
            finished.notify_one();

            // Pick up the next queued item now that a slot is free.
            let q_engine = self_clone.clone();
            let q_app = app_clone.clone();
            tokio::spawn(async move {
                q_engine.process_next_queued(q_app).await;
            });
        });

        Ok(())
    }

    pub async fn pause_download(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<(), String> {
        {
            let map = self.active_downloads.lock().await;
            if let Some(active) = map.get(id) {
                active.cancel_flag.store(true, Ordering::Relaxed);
            }
        }
        let _ = self.db.update_status(id, "paused");
        let _ = self.db.update_progress(id, -1, 0.0, 0);
        let _ = app.emit(
            "download-status-changed",
            serde_json::json!({
                "id": id,
                "status": "paused"
            }),
        );

        let self_clone = self.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            self_clone.process_next_queued(app_clone).await;
        });

        Ok(())
    }

    pub async fn resume_download(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<(), String> {
        let record = self
            .db
            .get_download_by_id(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Download not found".to_string())?;

        if record.status == "completed" {
            return Err("Download already completed".to_string());
        }

        let engine = self.clone();
        let app_clone = app.clone();
        let download_id = id.to_string();
        let url = record.url.clone();
        let destination_path = record.destination_path.clone();
        let total_size = record.total_size;
        let etag = record.etag.clone();
        let last_modified = record.last_modified.clone();
        let cookie = record.cookie.clone();
        let referer = record.referer.clone();
        let speed_limit_kb = record.speed_limit_kb;
        let segment_count = record.segment_count.unwrap_or(8) as usize;

        tokio::spawn(async move {
            let _ = engine
                .start_download(
                    app_clone,
                    download_id,
                    url,
                    destination_path,
                    total_size,
                    segment_count,
                    cookie,
                    referer,
                    etag,
                    last_modified,
                    speed_limit_kb,
                )
                .await;
        });

        Ok(())
    }

    /// Moves the given downloads into the queue and lets the worker start them
    /// as slots free up. Bulk resume uses this so a large selection cannot open
    /// more parallel connections than `max_concurrent_downloads` allows.
    pub async fn queue_downloads(
        self: &Arc<Self>,
        app: &AppHandle,
        ids: Vec<String>,
    ) -> Result<(), String> {
        let mut queued = 0usize;

        for id in ids {
            let record = match self.db.get_download_by_id(&id).map_err(|e| e.to_string())? {
                Some(record) => record,
                None => continue,
            };

            if record.status == "completed" {
                continue;
            }

            self.db
                .update_status(&id, "queued")
                .map_err(|e| e.to_string())?;
            let _ = app.emit(
                "download-status-changed",
                serde_json::json!({ "id": id, "status": "queued" }),
            );
            queued += 1;
        }

        if queued > 0 {
            self.process_next_queued(app.clone()).await;
        }

        Ok(())
    }

    pub async fn cancel_download(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<(), String> {        {
            let map = self.active_downloads.lock().await;
            if let Some(active) = map.get(id) {
                active.cancel_flag.store(true, Ordering::Relaxed);
            }
        }
        let _ = self.db.update_status(id, "cancelled");
        let _ = self.db.update_progress(id, -1, 0.0, 0);
        let _ = app.emit(
            "download-status-changed",
            serde_json::json!({
                "id": id,
                "status": "cancelled"
            }),
        );

        let self_clone = self.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            self_clone.process_next_queued(app_clone).await;
        });

        Ok(())
    }

    pub async fn delete_download(self: &Arc<Self>, app: &AppHandle, id: &str, delete_file: bool) -> Result<(), String> {
        {
            let map = self.active_downloads.lock().await;
            if let Some(active) = map.get(id) {
                active.cancel_flag.store(true, Ordering::Relaxed);
            }
        }
        if delete_file {
            if let Ok(Some(record)) = self.db.get_download_by_id(id) {
                let clean_path = record.destination_path.trim().replace('/', "\\");
                let p = std::path::PathBuf::from(&clean_path);
                if p.exists() {
                    let mut removed = false;
                    for _ in 0..10 {
                        if let Ok(metadata) = std::fs::metadata(&p) {
                            let mut perms = metadata.permissions();
                            if perms.readonly() {
                                perms.set_readonly(false);
                                let _ = std::fs::set_permissions(&p, perms);
                            }
                        }
                        if std::fs::remove_file(&p).is_ok() || !p.exists() {
                            removed = true;
                            break;
                        }
                        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                    }
                    if !removed && p.exists() {
                        log::warn!("Failed to delete physical destination file: {}", clean_path);
                    }
                }
            }
        }
        let _ = self.db.delete_download(id);
        let _ = app.emit(
            "download-status-changed",
            serde_json::json!({
                "id": id,
                "status": "deleted"
            }),
        );

        let self_clone = self.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            self_clone.process_next_queued(app_clone).await;
        });

        Ok(())
    }

    pub async fn redownload(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<(), String> {
        {
            let map = self.active_downloads.lock().await;
            if let Some(active) = map.get(id) {
                active.cancel_flag.store(true, Ordering::Relaxed);
            }
        }

        let record = self
            .db
            .get_download_by_id(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Download not found".to_string())?;

        let p = std::path::Path::new(&record.destination_path);
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }

        self.db.reset_for_redownload(id).map_err(|e| e.to_string())?;

        let _ = app.emit(
            "download-status-changed",
            serde_json::json!({
                "id": id,
                "status": "queued",
                "downloaded_bytes": 0,
                "progress": 0,
                "speed": 0,
                "eta": "Queued"
            }),
        );

        let self_clone = self.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            self_clone.process_next_queued(app_clone).await;
        });

        Ok(())
    }

    pub async fn pause_all_downloads(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        self.queue_running.store(false, Ordering::Relaxed);

        let active_ids: Vec<String> = {
            let map = self.active_downloads.lock().await;
            for active in map.values() {
                active.cancel_flag.store(true, Ordering::Relaxed);
            }
            map.keys().cloned().collect()
        };

        let all_downloads = self.db.get_all_downloads().unwrap_or_default();
        for item in all_downloads {
            if item.status == "downloading" || active_ids.contains(&item.id) {
                if item.status == "cancelled" {
                    continue;
                }
                let _ = self.db.update_status(&item.id, "paused");
                let _ = self.db.update_progress(&item.id, -1, 0.0, 0);
                let _ = app.emit(
                    "download-status-changed",
                    serde_json::json!({
                        "id": item.id,
                        "status": "paused"
                    }),
                );
            }
        }

        Ok(())
    }

    pub async fn set_download_speed_limit(
        &self,
        id: &str,
        speed_limit_kb: Option<i64>,
    ) -> Result<(), String> {
        let rate_bytes = match speed_limit_kb {
            Some(kb) if kb > 0 => kb * 1024,
            _ => 0,
        };

        {
            let map = self.active_downloads.lock().await;
            if let Some(active) = map.get(id) {
                active.limiter.set_rate(rate_bytes);
            }
        }

        self.db
            .update_speed_limit(id, speed_limit_kb)
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn resume_all_downloads(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        self.queue_running.store(true, Ordering::Relaxed);

        // Turn paused or cancelled items back into queued items so the queue
        // worker processes them.
        let paused_items = self.db.get_paused_downloads().unwrap_or_default();
        for item in paused_items {
            let _ = self.db.update_status(&item.id, "queued");
            let _ = app.emit(
                "download-status-changed",
                serde_json::json!({
                    "id": item.id,
                    "status": "queued"
                }),
            );
        }

        let self_clone = self.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            self_clone.process_next_queued(app_clone).await;
        });

        Ok(())
    }

    pub fn process_next_queued(
        self: &Arc<Self>,
        app: AppHandle,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        let this = self.clone();
        Box::pin(async move {
            if !this.queue_running.load(Ordering::Relaxed) {
                return;
            }

            let active_count = this.active_downloads.lock().await.len();
            let max_concurrent = this.max_concurrent_downloads.load(Ordering::Relaxed);

            if active_count >= max_concurrent {
                return;
            }

            let slots = max_concurrent - active_count;
            let next_items = match this.db.get_next_queued_downloads(slots) {
                Ok(items) => items,
                Err(_) => return,
            };

            for record in next_items {
                let engine = this.clone();
                let app_clone = app.clone();
                let download_id = record.id.clone();
                let url = record.url.clone();
                let destination_path = record.destination_path.clone();
                let total_size = record.total_size;
                let etag = record.etag.clone();
                let last_modified = record.last_modified.clone();
                let cookie = record.cookie.clone();
                let referer = record.referer.clone();
                let speed_limit_kb = record.speed_limit_kb;
                let segment_count = record.segment_count.unwrap_or(8) as usize;

                tokio::spawn(async move {
                    let _ = engine
                        .start_download(
                            app_clone,
                            download_id,
                            url,
                            destination_path,
                            total_size,
                            segment_count,
                            cookie,
                            referer,
                            etag,
                            last_modified,
                            speed_limit_kb,
                        )
                        .await;
                });
            }
        })
    }
}

/// Runs one download to a terminal state. Returns `Err` only for unexpected
/// setup failures; expected outcomes (completed/paused/error) are persisted and
/// emitted here.
#[allow(clippy::too_many_arguments)]
async fn execute_download(
    app: &AppHandle,
    db: Arc<Database>,
    id: &str,
    url: String,
    path: PathBuf,
    total_size: i64,
    segment_count: usize,
    cookie: Option<String>,
    referer: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    limiter: Arc<TokenBucketLimiter>,
    global_limiter: Arc<TokenBucketLimiter>,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let settings = db.get_engine_settings().unwrap_or_default().sanitized();
    let connect_timeout = settings.connect_timeout();
    let max_retries = settings.retry_limit();
    let preallocate = settings.preallocate_disk_space;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Rheow/1.0")
        .connect_timeout(connect_timeout)
        .build()
        .map_err(|e| e.to_string())?;

    let limiter_clone = limiter.clone();
    let global_limiter_clone = global_limiter.clone();

    // ------------------------------------------------------------------
    // 1. Refresh remote metadata and validate any saved resume checkpoints.
    // ------------------------------------------------------------------
    let stored_total_size = total_size;
    let stored_etag = etag.clone();
    let stored_last_modified = last_modified.clone();
    let stored_supports_range = db
        .get_download_by_id(id)
        .ok()
        .flatten()
        .map(|r| r.supports_range)
        .unwrap_or(true);

    let probe = probe::probe_url_with_timeout(
        &url,
        cookie.as_deref(),
        referer.as_deref(),
        connect_timeout.as_secs(),
    )
    .await
    .ok();

    let mut total_size = total_size;
    let mut supports_range = stored_supports_range;

    if let Some(probe) = &probe {
        supports_range = probe.supports_range;
        let _ = db.update_supports_range(id, supports_range);
        if probe.total_size > 0 {
            total_size = probe.total_size;
        }
    }

    let probed_etag = probe.as_ref().and_then(|p| p.etag.clone());
    let probed_last_modified = probe.as_ref().and_then(|p| p.last_modified.clone());

    let etag = probed_etag.clone().or(stored_etag.clone());
    let last_modified = probed_last_modified
        .clone()
        .or(stored_last_modified.clone());

    let mut existing_segments = db.get_segments(id).unwrap_or_default();

    if !existing_segments.is_empty() {
        let file_missing = !path.exists();
        let highest_written = existing_segments
            .iter()
            .map(|seg| seg.current_offset.max(0) as u64)
            .max()
            .unwrap_or(0);
        let file_size_mismatch = if file_missing {
            true
        } else {
            match std::fs::metadata(&path) {
                Ok(_meta) if total_size <= 0 => false,
                Ok(meta) if preallocate => meta.len() != total_size as u64,
                // Without preallocation the file only grows as far as the
                // furthest written byte, so require that the checkpointed data
                // still fits inside the existing file.
                Ok(meta) => meta.len() > total_size as u64 || meta.len() < highest_written,
                Err(_) => true,
            }
        };

        let resume_valid = resume_check(
            stored_total_size,
            stored_etag.as_deref(),
            stored_last_modified.as_deref(),
            probe.is_some(),
            total_size,
            probed_etag.as_deref(),
            probed_last_modified.as_deref(),
            !file_size_mismatch,
        );

        if !resume_valid {
            eprintln!(
                "[Rheow] resume for {} rejected (stored size {}, probed size {}, file valid {}); restarting from zero",
                id, stored_total_size, total_size, !file_size_mismatch
            );
            let _ = db.save_segments(id, &[]);
            existing_segments.clear();
        }
    }

    // A server without Range support cannot honour byte offsets, so any saved
    // checkpoints are useless. Start over with a single stream.
    if !supports_range && !existing_segments.is_empty() {
        eprintln!(
            "[Rheow] server for {} does not support ranges; discarding resume checkpoints",
            id
        );
        let _ = db.save_segments(id, &[]);
        existing_segments.clear();
    }

    let _ = db.update_metadata(id, total_size, etag.clone(), last_modified.clone());

    if existing_segments.is_empty() {
        prealloc::create_destination(&path, total_size, preallocate).map_err(|e| {
            format!(
                "Failed to prepare destination file {}: {}",
                path.display(),
                e
            )
        })?;
    } else {
        prealloc::ensure_destination(&path, total_size, preallocate)
            .map_err(|e| format!("Failed to open destination file {}: {}", path.display(), e))?;
    }

    // ------------------------------------------------------------------
    // 2. Unknown size: the only correct strategy is a single sequential GET.
    // ------------------------------------------------------------------
    if total_size <= 0 {
        return run_single_stream(
            app,
            db,
            id,
            &url,
            &path,
            &client,
            cookie,
            referer,
            etag,
            last_modified,
            limiter_clone,
            global_limiter_clone,
            max_retries,
            cancel_flag,
        )
        .await;
    }

    // ------------------------------------------------------------------
    // 3. Known size: split into verified byte ranges.
    // ------------------------------------------------------------------
    let requested_connections = if segment_count > 0 {
        segment_count
    } else {
        settings.max_connections as usize
    };
    let connections = if supports_range {
        requested_connections.min(total_size as usize).max(1)
    } else {
        1
    };

    let (tx, mut rx) = mpsc::channel::<SegmentProgressUpdate>(256);

    let mut segment_atoms: Vec<Arc<AtomicU64>> = Vec::new();
    let mut segment_configs: Vec<SegmentConfig> = Vec::new();
    let mut initial_downloaded: i64 = 0;

    if !existing_segments.is_empty() {
        // Resume from saved SQLite segment checkpoints.
        for seg in &existing_segments {
            let start = seg.start_offset as u64;
            let end = seg.end_offset as u64;
            let cur = (seg.current_offset as u64).min(end + 1);
            if cur > start {
                initial_downloaded += (cur - start) as i64;
            }

            segment_atoms.push(Arc::new(AtomicU64::new(cur)));
            segment_configs.push(SegmentConfig {
                index: seg.segment_index as usize,
                start_offset: start,
                end_offset: end,
            });
        }
    } else {
        // Fresh download: ceil-divide so no segment is empty.
        let mut init_db_segments = Vec::new();

        for (index, start, end) in plan_segments(total_size as u64, connections) {
            init_db_segments.push((index, start, end, start, false));
            segment_atoms.push(Arc::new(AtomicU64::new(start)));
            segment_configs.push(SegmentConfig {
                index,
                start_offset: start,
                end_offset: end,
            });
        }

        let _ = db.save_segments(id, &init_db_segments);
    }

    if segment_configs.is_empty() {
        return Err("No byte ranges could be generated for this download".to_string());
    }

    // Snapshot the ranges before moving them into the worker tasks.
    let configs_snapshot = segment_configs.clone();
    let atoms_snapshot = segment_atoms.clone();

    let mut worker_handles = Vec::new();
    for (idx, cfg) in segment_configs.into_iter().enumerate() {
        let worker_client = client.clone();
        let worker_url = url.clone();
        let worker_path = path.clone();
        let worker_atom = segment_atoms[idx].clone();
        let worker_cancel = cancel_flag.clone();
        let worker_cookie = cookie.clone();
        let worker_referer = referer.clone();
        let worker_etag = etag.clone();
        let worker_limiter = limiter_clone.clone();
        let worker_global_limiter = global_limiter_clone.clone();
        let worker_tx = tx.clone();

        worker_handles.push(tokio::spawn(async move {
            run_segment_worker(
                worker_client,
                worker_url,
                worker_path,
                cfg,
                worker_atom,
                worker_cancel,
                worker_cookie,
                worker_referer,
                worker_etag,
                max_retries,
                Some(worker_limiter),
                Some(worker_global_limiter),
                worker_tx,
            )
            .await
        }));
    }

    drop(tx); // Close the original sender so rx ends once every worker is done.

    let mut last_calc_time = Instant::now();
    let mut last_save_time = Instant::now();
    let mut last_calc_bytes: i64 = initial_downloaded;
    let mut downloaded_bytes: i64 = initial_downloaded;
    let mut smoothed_speed: f64 = 0.0;

    while let Some(update) = rx.recv().await {
        downloaded_bytes += update.bytes_read as i64;
        let elapsed = last_calc_time.elapsed().as_secs_f64();

        if elapsed < 0.25 {
            continue;
        }

        let delta_bytes = downloaded_bytes - last_calc_bytes;
        let instant_speed = (delta_bytes as f64) / elapsed;
        smoothed_speed = if smoothed_speed <= 0.0 {
            instant_speed
        } else {
            smoothed_speed * 0.70 + instant_speed * 0.30
        };
        let current_speed = smoothed_speed;
        last_calc_bytes = downloaded_bytes;
        last_calc_time = Instant::now();

        let remaining_sec = if current_speed > 0.0 && total_size > downloaded_bytes {
            ((total_size - downloaded_bytes) as f64 / current_speed) as u64
        } else {
            0
        };

        let eta = if remaining_sec > 0 {
            format_eta(remaining_sec)
        } else {
            "--:--:--".to_string()
        };

        emit_progress(
            app,
            id,
            total_size,
            downloaded_bytes,
            current_speed,
            eta,
            "downloading",
            build_segment_states(&configs_snapshot, &atoms_snapshot),
            None,
            Some(supports_range),
        );

        // Periodic checkpoint save every 2 seconds.
        if last_save_time.elapsed().as_secs() >= 2 {
            save_segment_checkpoints(&db, id, &configs_snapshot, &atoms_snapshot);
            let _ = db.update_progress(
                id,
                downloaded_bytes,
                current_speed,
                remaining_sec as i64,
            );
            last_save_time = Instant::now();
        }
    }

    // ------------------------------------------------------------------
    // 4. Verify every worker actually delivered its full byte range.
    // ------------------------------------------------------------------
    let mut errors = Vec::new();
    for handle in worker_handles {
        match handle.await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => errors.push(err),
            Err(err) => errors.push(format!("Segment worker crashed: {}", err)),
        }
    }

    for (idx, cfg) in configs_snapshot.iter().enumerate() {
        let cur = atoms_snapshot[idx].load(Ordering::Relaxed);
        if cur <= cfg.end_offset {
            errors.push(format!(
                "Segment {} stopped at byte {} of {}",
                cfg.index,
                cur,
                cfg.end_offset + 1
            ));
        }
    }

    let actual_downloaded: i64 = configs_snapshot
        .iter()
        .enumerate()
        .map(|(idx, cfg)| {
            atoms_snapshot[idx]
                .load(Ordering::Relaxed)
                .saturating_sub(cfg.start_offset) as i64
        })
        .sum();

    save_segment_checkpoints(&db, id, &configs_snapshot, &atoms_snapshot);

    let cancelled = cancel_flag.load(Ordering::Relaxed);
    let segments = build_segment_states(&configs_snapshot, &atoms_snapshot);

    let kind = if errors.is_empty() {
        FinishKind::Completed
    } else if cancelled {
        FinishKind::Paused
    } else {
        FinishKind::Failed(errors.join("; "))
    };

    finish_download(
        app,
        &db,
        id,
        kind,
        total_size,
        actual_downloaded,
        segments,
    );
    Ok(())
}

/// Failure classification for the sequential path. A stream that dies halfway
/// cannot be resumed without Range support, so a retry always restarts from
/// byte zero.
enum StreamFailure {
    Retryable(String),
    Fatal(String),
}

/// Sequential download for responses without a usable `Content-Length`.
/// Transient failures (connection drops, 5xx, truncated body) restart the
/// stream from scratch, honouring `max_retries`.
#[allow(clippy::too_many_arguments)]
async fn run_single_stream(
    app: &AppHandle,
    db: Arc<Database>,
    id: &str,
    url: &str,
    path: &PathBuf,
    client: &reqwest::Client,
    cookie: Option<String>,
    referer: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    limiter: Arc<TokenBucketLimiter>,
    global_limiter: Arc<TokenBucketLimiter>,
    max_retries: u32,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let attempts = max_retries.min(50) + 1;
    let mut last_error = String::new();

    for attempt in 0..attempts {
        if cancel_flag.load(Ordering::Relaxed) {
            return Ok(());
        }

        match run_single_stream_once(
            app,
            &db,
            id,
            url,
            path,
            client,
            cookie.as_deref(),
            referer.as_deref(),
            etag.as_deref(),
            last_modified.as_deref(),
            Some(&limiter),
            Some(&global_limiter),
            &cancel_flag,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(StreamFailure::Fatal(message)) => return Err(message),
            Err(StreamFailure::Retryable(message)) => {
                last_error = message;

                if attempt + 1 >= attempts {
                    break;
                }

                // Restart cleanly: drop the partial bytes and reset the row so
                // the UI does not show progress from an abandoned attempt.
                if let Ok(file) = File::options().write(true).open(path) {
                    let _ = file.set_len(0);
                }
                let _ = db.update_progress(id, 0, 0.0, 0);

                // 250ms, 500ms, 1s, 2s, then 4s between attempts.
                let delay_ms = 250u64
                    .saturating_mul(1u64 << attempt.min(4))
                    .min(4000);
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
        }
    }

    Err(format!(
        "{} (gave up after {} attempts)",
        last_error, attempts
    ))
}

#[allow(clippy::too_many_arguments)]
async fn run_single_stream_once(
    app: &AppHandle,
    db: &Arc<Database>,
    id: &str,
    url: &str,
    path: &PathBuf,
    client: &reqwest::Client,
    cookie: Option<&str>,
    referer: Option<&str>,
    etag: Option<&str>,
    last_modified: Option<&str>,
    limiter: Option<&TokenBucketLimiter>,
    global_limiter: Option<&TokenBucketLimiter>,
    cancel_flag: &AtomicBool,
) -> Result<(), StreamFailure> {
    let mut headers = HeaderMap::new();
    if let Some(c) = cookie {
        if let Ok(val) = HeaderValue::from_str(c) {
            headers.insert("Cookie", val);
        }
    }
    if let Some(r) = referer {
        if let Ok(val) = HeaderValue::from_str(r) {
            headers.insert("Referer", val);
        }
    }

    let resp = client
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| StreamFailure::Retryable(format!("Request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let message = format!("Server returned HTTP {}", status);
        return Err(if status.is_server_error()
            || status == reqwest::StatusCode::REQUEST_TIMEOUT
            || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        {
            StreamFailure::Retryable(message)
        } else {
            StreamFailure::Fatal(message)
        });
    }

    let declared_total = resp.content_length().unwrap_or(0) as i64;

    let mut file = File::create(path).map_err(|e| {
        StreamFailure::Fatal(format!(
            "Failed to create destination file {}: {}",
            path.display(),
            e
        ))
    })?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: i64 = 0;
    let mut last_calc_time = Instant::now();
    let mut last_save_time = Instant::now();
    let mut last_calc_bytes: i64 = 0;
    let mut smoothed_speed: f64 = 0.0;

    while let Some(chunk_result) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let chunk = chunk_result
            .map_err(|e| StreamFailure::Retryable(format!("Stream error: {}", e)))?;
        if let Some(gl) = global_limiter {
            gl.consume_with_cancel(chunk.len(), Some(cancel_flag)).await;
        }
        if let Some(l) = limiter {
            l.consume_with_cancel(chunk.len(), Some(cancel_flag)).await;
        }

        file.write_all(&chunk)
            .map_err(|e| StreamFailure::Retryable(format!("Disk write error: {}", e)))?;
        downloaded += chunk.len() as i64;

        let elapsed = last_calc_time.elapsed().as_secs_f64();
        if elapsed >= 0.25 {
            let instant_speed = (downloaded - last_calc_bytes) as f64 / elapsed;
            smoothed_speed = if smoothed_speed <= 0.0 {
                instant_speed
            } else {
                smoothed_speed * 0.70 + instant_speed * 0.30
            };
            last_calc_bytes = downloaded;
            last_calc_time = Instant::now();

            let remaining_sec = if declared_total > downloaded && smoothed_speed > 0.0 {
                ((declared_total - downloaded) as f64 / smoothed_speed) as u64
            } else {
                0
            };
            let eta = if remaining_sec > 0 {
                format_eta(remaining_sec)
            } else {
                "--:--:--".to_string()
            };

            emit_progress(
                app,
                id,
                declared_total,
                downloaded,
                smoothed_speed,
                eta,
                "downloading",
                Vec::new(),
                None,
                Some(false),
            );
        }

        if last_save_time.elapsed().as_secs() >= 2 {
            let _ = db.update_progress(id, downloaded, smoothed_speed, 0);
            last_save_time = Instant::now();
        }
    }

    file.flush()
        .map_err(|e| StreamFailure::Retryable(format!("Failed to flush file: {}", e)))?;

    if cancel_flag.load(Ordering::Relaxed) {
        finish_download(
            app,
            db,
            id,
            FinishKind::Paused,
            declared_total,
            downloaded,
            Vec::new(),
        );
        return Ok(());
    }

    if declared_total > 0 && downloaded != declared_total {
        // The body was cut short. Restarting from byte zero is the only safe
        // recovery on a server that did not honour Range.
        return Err(StreamFailure::Retryable(format!(
            "Stream ended at {} of {} bytes",
            downloaded, declared_total
        )));
    }

    let final_total = if declared_total > 0 {
        declared_total
    } else {
        downloaded
    };
    let _ = db.update_metadata(
        id,
        final_total,
        etag.map(str::to_string),
        last_modified.map(str::to_string),
    );
    finish_download(
        app,
        db,
        id,
        FinishKind::Completed,
        final_total,
        final_total,
        Vec::new(),
    );

    Ok(())
}

fn finish_download(
    app: &AppHandle,
    db: &Arc<Database>,
    id: &str,
    kind: FinishKind,
    total_size: i64,
    downloaded_size: i64,
    segments: Vec<SegmentState>,
) {
    // The row may have been deleted while the download was running.
    let record = match db.get_download_by_id(id) {
        Ok(Some(record)) => record,
        _ => return,
    };

    let (status, error): (&str, Option<String>) = match kind {
        FinishKind::Completed => ("completed", None),
        FinishKind::Paused => {
            let status = if record.status == "cancelled" {
                "cancelled"
            } else {
                "paused"
            };
            (status, None)
        }
        FinishKind::Failed(message) => ("error", Some(message)),
    };

    if status == "completed" {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = db.update_status_and_completion(id, "completed", Some(&now));
        let _ = db.update_progress(id, total_size.max(downloaded_size), 0.0, 0);

        if record.open_folder_on_finish {
            let _ = crate::system::open_folder_or_select(&record.destination_path);
        }

        let _ = app
            .notification()
            .builder()
            .title("Rheow Download Completed")
            .body(&format!("'{}' has finished downloading.", record.filename))
            .action_type_id("download-completed")
            .extra("destination_path", serde_json::Value::String(record.destination_path.clone()))
            .extra("download_id", serde_json::Value::String(id.to_string()))
            .show();
    } else {
        let _ = db.update_status(id, status);
        let _ = db.update_progress(id, downloaded_size.max(0), 0.0, 0);

        if status == "error" {
            let _ = app
                .notification()
                .builder()
                .title("Rheow Download Failed")
                .body(&format!(
                    "'{}' failed: {}",
                    record.filename,
                    error.as_deref().unwrap_or("Network error")
                ))
                .action_type_id("download-failed")
                .extra("download_id", serde_json::Value::String(id.to_string()))
                .show();
        }
    }

    emit_progress(
        app,
        id,
        total_size,
        downloaded_size,
        0.0,
        if status == "completed" {
            "Finished".to_string()
        } else {
            "--:--:--".to_string()
        },
        status,
        segments,
        error.clone(),
        Some(record.supports_range),
    );

    let _ = app.emit(
        "download-status-changed",
        serde_json::json!({
            "id": id,
            "status": status,
            "error": error,
            "supports_range": record.supports_range,
        }),
    );
}

/// Decides whether previously saved segment offsets can still be trusted.
/// `probe_available=false` means the server could not be reached; in that case
/// we keep the checkpoints and let the download workers surface the failure.
#[allow(clippy::too_many_arguments)]
fn resume_check(
    stored_total: i64,
    stored_etag: Option<&str>,
    stored_last_modified: Option<&str>,
    probe_available: bool,
    probed_total: i64,
    probed_etag: Option<&str>,
    probed_last_modified: Option<&str>,
    file_valid: bool,
) -> bool {
    if !file_valid {
        return false;
    }

    if !probe_available {
        return true;
    }

    if stored_total > 0 && probed_total > 0 && stored_total != probed_total {
        return false;
    }

    if matches!((stored_etag, probed_etag), (Some(a), Some(b)) if a != b) {
        return false;
    }

    if matches!(
        (stored_last_modified, probed_last_modified),
        (Some(a), Some(b)) if a != b
    ) {
        return false;
    }

    // We had a validator before but the server no longer exposes one, so the
    // file identity cannot be proven. Restarting is the safe choice.
    let validators_lost = (stored_etag.is_some() || stored_last_modified.is_some())
        && probed_etag.is_none()
        && probed_last_modified.is_none();

    !validators_lost
}

/// Splits `total_size` bytes into contiguous, non-empty ranges.
/// Uses ceil division so the final range absorbs any remainder.
fn plan_segments(total_size: u64, connections: usize) -> Vec<(usize, u64, u64)> {
    if total_size == 0 || connections == 0 {
        return Vec::new();
    }

    let connections = connections.min(total_size as usize).max(1);
    let part_size = (total_size + connections as u64 - 1) / connections as u64;
    let mut ranges = Vec::new();

    for index in 0..connections {
        let start = index as u64 * part_size;
        if start >= total_size {
            break;
        }
        let end = ((index as u64 + 1) * part_size).min(total_size) - 1;
        ranges.push((index, start, end));
    }

    ranges
}

fn build_segment_states(
    configs: &[SegmentConfig],
    atoms: &[Arc<AtomicU64>],
) -> Vec<SegmentState> {
    configs
        .iter()
        .enumerate()
        .map(|(idx, cfg)| {
            let cur = atoms[idx].load(Ordering::Relaxed);
            let total_seg = cfg.end_offset.saturating_sub(cfg.start_offset) + 1;
            let downloaded_seg = cur.saturating_sub(cfg.start_offset);
            let pct = if total_seg > 0 {
                (downloaded_seg as f64 / total_seg as f64) * 100.0
            } else {
                0.0
            };

            SegmentState {
                id: cfg.index,
                segment_index: cfg.index,
                start_offset: cfg.start_offset,
                end_offset: cfg.end_offset,
                current_offset: cur,
                is_completed: cur > cfg.end_offset,
                progress_percentage: pct.min(100.0),
            }
        })
        .collect()
}

fn save_segment_checkpoints(
    db: &Database,
    id: &str,
    configs: &[SegmentConfig],
    atoms: &[Arc<AtomicU64>],
) {
    let data: Vec<(usize, u64, u64, u64, bool)> = configs
        .iter()
        .enumerate()
        .map(|(idx, cfg)| {
            let cur = atoms[idx].load(Ordering::Relaxed);
            (
                cfg.index,
                cfg.start_offset,
                cfg.end_offset,
                cur,
                cur > cfg.end_offset,
            )
        })
        .collect();
    let _ = db.save_segments(id, &data);
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: &AppHandle,
    id: &str,
    total_size: i64,
    downloaded_size: i64,
    speed: f64,
    eta: String,
    status: &str,
    segments: Vec<SegmentState>,
    error: Option<String>,
    supports_range: Option<bool>,
) {
    let progress_percentage = if total_size > 0 {
        ((downloaded_size as f64 / total_size as f64) * 100.0).min(100.0)
    } else if status == "completed" {
        100.0
    } else {
        0.0
    };

    let payload = DownloadProgressPayload {
        id: id.to_string(),
        total_size,
        downloaded_size,
        progress_percentage,
        speed_bytes_per_second: speed,
        eta,
        status: status.to_string(),
        segments,
        supports_range,
        error,
    };

    let _ = app.emit("download-progress", payload);
}

fn format_eta(seconds: u64) -> String {
    let hrs = seconds / 3600;
    let mins = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hrs > 0 {
        format!("{:02}:{:02}:{:02}", hrs, mins, secs)
    } else {
        format!("{:02}:{:02}", mins, secs)
    }
}

#[cfg(test)]
mod tests {
    use super::{format_eta, plan_segments, resume_check};

    fn assert_contiguous(total: u64, ranges: &[(usize, u64, u64)]) {
        assert!(!ranges.is_empty());
        assert_eq!(ranges[0].1, 0, "must start at byte 0");
        assert_eq!(
            ranges.last().unwrap().2,
            total - 1,
            "must end at the last byte"
        );
        for pair in ranges.windows(2) {
            assert_eq!(
                pair[1].1,
                pair[0].2 + 1,
                "ranges must be contiguous without gaps"
            );
        }
        for (_, start, end) in ranges {
            assert!(end >= start, "ranges must not be empty");
        }
    }

    #[test]
    fn splits_evenly() {
        let ranges = plan_segments(1000, 4);
        assert_eq!(ranges.len(), 4);
        assert_contiguous(1000, &ranges);
        assert_eq!(ranges[0], (0, 0, 249));
    }

    #[test]
    fn never_creates_empty_ranges() {
        let ranges = plan_segments(10, 8);
        assert_eq!(ranges.len(), 5);
        assert_contiguous(10, &ranges);
    }

    #[test]
    fn handles_tiny_files() {
        let ranges = plan_segments(1, 32);
        assert_eq!(ranges, vec![(0, 0, 0)]);
    }

    #[test]
    fn caps_connections_to_file_size() {
        let ranges = plan_segments(3, 32);
        assert_eq!(ranges.len(), 3);
        assert_contiguous(3, &ranges);
    }

    #[test]
    fn formats_eta() {
        assert_eq!(format_eta(0), "00:00");
        assert_eq!(format_eta(65), "01:05");
        assert_eq!(format_eta(3661), "01:01:01");
    }

    #[test]
    fn resume_accepts_unchanged_file() {
        assert!(resume_check(
            100,
            Some("\"abc\""),
            None,
            true,
            100,
            Some("\"abc\""),
            None,
            true
        ));
    }

    #[test]
    fn resume_rejects_changed_etag() {
        assert!(!resume_check(
            100,
            Some("\"abc\""),
            None,
            true,
            100,
            Some("\"xyz\""),
            None,
            true
        ));
    }

    #[test]
    fn resume_rejects_changed_size() {
        assert!(!resume_check(
            100,
            None,
            None,
            true,
            101,
            None,
            None,
            true
        ));
    }

    #[test]
    fn resume_rejects_missing_file() {
        assert!(!resume_check(
            100,
            Some("\"abc\""),
            None,
            true,
            100,
            Some("\"abc\""),
            None,
            false
        ));
    }

    #[test]
    fn resume_rejects_lost_validators() {
        assert!(!resume_check(
            100,
            Some("\"abc\""),
            None,
            true,
            100,
            None,
            None,
            true
        ));
    }

    #[test]
    fn resume_keeps_checkpoints_when_offline() {
        assert!(resume_check(
            100,
            Some("\"abc\""),
            None,
            false,
            0,
            None,
            None,
            true
        ));
    }
}
