use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_RANGE, RANGE};
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use super::limiter::TokenBucketLimiter;

#[derive(Clone)]
pub struct SegmentConfig {
    pub index: usize,
    pub start_offset: u64,
    pub end_offset: u64,
}

#[allow(dead_code)]
pub struct SegmentProgressUpdate {
    pub segment_index: usize,
    pub bytes_read: u64,
    pub current_offset: u64,
}

struct WorkerFailure {
    message: String,
    retryable: bool,
}

impl WorkerFailure {
    fn retryable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: true,
        }
    }

    fn fatal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }
}

/// Downloads one byte range, retrying transient network failures from the last
/// successfully written offset. Fatal failures (bad range support, 4xx, etc.)
/// are surfaced immediately so a dead URL does not spin for `max_retries`.
#[allow(clippy::too_many_arguments)]
pub async fn run_segment_worker(
    client: reqwest::Client,
    url: String,
    file_path: PathBuf,
    config: SegmentConfig,
    current_offset_atomic: Arc<AtomicU64>,
    cancel_flag: Arc<AtomicBool>,
    cookie: Option<String>,
    referer: Option<String>,
    etag: Option<String>,
    max_retries: u32,
    limiter: Option<Arc<TokenBucketLimiter>>,
    global_limiter: Option<Arc<TokenBucketLimiter>>,
    progress_tx: mpsc::Sender<SegmentProgressUpdate>,
) -> Result<(), String> {
    let attempts = max_retries.min(50) + 1;
    let mut last_error = String::new();

    for attempt in 0..attempts {
        if cancel_flag.load(Ordering::Relaxed) {
            return Ok(());
        }

        match run_segment_once(
            &client,
            &url,
            &file_path,
            &config,
            &current_offset_atomic,
            &cancel_flag,
            cookie.as_deref(),
            referer.as_deref(),
            etag.as_deref(),
            limiter.as_deref(),
            global_limiter.as_deref(),
            &progress_tx,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(failure) => {
                if !failure.retryable {
                    return Err(failure.message);
                }

                last_error = failure.message;
                if attempt + 1 >= attempts {
                    break;
                }

                // 250ms, 500ms, 1s, 2s, then 4s between attempts.
                let delay_ms = 250u64
                    .saturating_mul(1u64 << attempt.min(4))
                    .min(4000);
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }

    Err(format!(
        "{} (gave up after {} attempts)",
        last_error, attempts
    ))
}

#[allow(clippy::too_many_arguments)]
async fn run_segment_once(
    client: &reqwest::Client,
    url: &str,
    file_path: &Path,
    config: &SegmentConfig,
    current_offset_atomic: &AtomicU64,
    cancel_flag: &AtomicBool,
    cookie: Option<&str>,
    referer: Option<&str>,
    etag: Option<&str>,
    limiter: Option<&TokenBucketLimiter>,
    global_limiter: Option<&TokenBucketLimiter>,
    progress_tx: &mpsc::Sender<SegmentProgressUpdate>,
) -> Result<(), WorkerFailure> {
    let current = current_offset_atomic.load(Ordering::Relaxed);
    if current > config.end_offset {
        return Ok(());
    }

    let mut headers = HeaderMap::new();
    let range_str = format!("bytes={}-{}", current, config.end_offset);
    if let Ok(val) = HeaderValue::from_str(&range_str) {
        headers.insert(RANGE, val);
    }

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
    if let Some(e) = etag {
        if let Ok(val) = HeaderValue::from_str(e) {
            headers.insert("If-Range", val);
        }
    }

    let resp = client
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| {
            WorkerFailure::retryable(format!(
                "Segment {} request failed: {}",
                config.index, e
            ))
        })?;

    let expected_len = config.end_offset.saturating_sub(current) + 1;

    if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        // Verify the server honoured the exact offset we asked for. Some CDNs
        // silently clamp or reorder ranges; writing that data would corrupt the
        // output file.
        if let Some(range_header) = resp.headers().get(CONTENT_RANGE) {
            if let Ok(range) = range_header.to_str() {
                let start = range
                    .strip_prefix("bytes ")
                    .and_then(|r| r.split('-').next())
                    .and_then(|s| s.trim().parse::<u64>().ok());
                if let Some(server_start) = start {
                    if server_start != current {
                        return Err(WorkerFailure::fatal(format!(
                            "Segment {} requested offset {} but server returned offset {}",
                            config.index, current, server_start
                        )));
                    }
                }
            }
        }
    } else if resp.status().is_success() {
        // Some servers ignore Range and reply 200 with the whole file. That is
        // only safe if the body is exactly the byte span we requested.
        if resp.content_length() != Some(expected_len) {
            return Err(WorkerFailure::fatal(format!(
                "Segment {} was ignored by the server (HTTP 200 without a matching range); refusing to write misaligned data",
                config.index
            )));
        }
    } else {
        let status = resp.status();
        let message = format!("Segment {} returned HTTP {}", config.index, status);
        return Err(if status.is_server_error()
            || status == reqwest::StatusCode::REQUEST_TIMEOUT
            || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        {
            WorkerFailure::retryable(message)
        } else {
            WorkerFailure::fatal(message)
        });
    }

    let mut stream = resp.bytes_stream();
    let mut file = File::options()
        .write(true)
        .create(true)
        .open(file_path)
        .map_err(|e| {
            WorkerFailure::retryable(format!(
                "Failed to open destination file for segment {}: {}",
                config.index, e
            ))
        })?;

    file.seek(SeekFrom::Start(current)).map_err(|e| {
        WorkerFailure::fatal(format!("Failed to seek segment {}: {}", config.index, e))
    })?;

    while let Some(chunk_result) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let chunk = chunk_result.map_err(|e| {
            WorkerFailure::retryable(format!(
                "Stream error in segment {}: {}",
                config.index, e
            ))
        })?;
        if chunk.is_empty() {
            continue;
        }

        let cur = current_offset_atomic.load(Ordering::Relaxed);
        let remaining = (config.end_offset + 1).saturating_sub(cur);
        if remaining == 0 {
            break;
        }
        let to_write_len = (chunk.len() as u64).min(remaining) as usize;

        // Speed throttling
        if let Some(gl) = global_limiter {
            gl.consume_with_cancel(to_write_len, Some(cancel_flag)).await;
        }
        if let Some(l) = limiter {
            l.consume_with_cancel(to_write_len, Some(cancel_flag)).await;
        }

        file.write_all(&chunk[..to_write_len]).map_err(|e| {
            WorkerFailure::retryable(format!(
                "Disk write error in segment {}: {}",
                config.index, e
            ))
        })?;

        let len_u64 = to_write_len as u64;
        let new_offset = current_offset_atomic.fetch_add(len_u64, Ordering::Relaxed) + len_u64;

        let _ = progress_tx
            .send(SegmentProgressUpdate {
                segment_index: config.index,
                bytes_read: len_u64,
                current_offset: new_offset,
            })
            .await;

        if new_offset > config.end_offset {
            break;
        }

        if to_write_len < chunk.len() {
            // The requested range is fully written; ignore trailing bytes.
            break;
        }
    }

    file.flush().map_err(|e| {
        WorkerFailure::retryable(format!(
            "Failed to flush segment {}: {}",
            config.index, e
        ))
    })?;

    Ok(())
}
