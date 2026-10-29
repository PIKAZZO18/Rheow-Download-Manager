use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH,
    CONTENT_RANGE, RANGE,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProbeResult {
    pub url: String,
    pub filename: String,
    pub category: String,
    pub total_size: i64,
    pub supports_range: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[allow(dead_code)]
pub async fn probe_url(
    url: &str,
    cookie: Option<&str>,
    referer: Option<&str>,
) -> Result<ProbeResult, String> {
    probe_url_with_timeout(url, cookie, referer, 30).await
}

pub async fn probe_url_with_timeout(
    url: &str,
    cookie: Option<&str>,
    referer: Option<&str>,
    timeout_seconds: u64,
) -> Result<ProbeResult, String> {
    let timeout = std::time::Duration::from_secs(timeout_seconds.clamp(5, 300));
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Rheow/1.0")
        .connect_timeout(timeout)
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
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

    let mut total_size: i64 = -1;
    let mut supports_range = false;
    let mut filename_candidate: Option<String> = None;
    let mut etag = None;
    let mut last_modified = None;

    // 1. Try HEAD request
    if let Ok(resp) = client.head(url).headers(headers.clone()).send().await {
        if resp.status().is_success() {
            if let Some(len) = resp.headers().get(CONTENT_LENGTH) {
                if let Ok(s) = len.to_str() {
                    total_size = s.parse::<i64>().unwrap_or(-1);
                }
            }
            if let Some(ar) = resp.headers().get(ACCEPT_RANGES) {
                if let Ok(s) = ar.to_str() {
                    supports_range = s.to_lowercase().contains("bytes");
                }
            }
            if let Some(e) = resp.headers().get("etag") {
                etag = e.to_str().ok().map(|s| s.to_string());
            }
            if let Some(lm) = resp.headers().get("last-modified") {
                last_modified = lm.to_str().ok().map(|s| s.to_string());
            }
            if let Some(cd) = resp.headers().get(CONTENT_DISPOSITION) {
                if let Ok(s) = cd.to_str() {
                    filename_candidate = extract_filename_from_cd(s);
                }
            }
        }
    }

    // 2. Fallback to GET Range: bytes=0-0. Also used when HEAD did not
    // advertise range support, because many servers only reveal it on GET.
    if total_size <= 0 || !supports_range {
        let mut range_headers = headers.clone();
        range_headers.insert(RANGE, HeaderValue::from_static("bytes=0-0"));

        if let Ok(resp) = client.get(url).headers(range_headers).send().await {
            if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                // 206
                supports_range = true;
                if let Some(cr) = resp.headers().get(CONTENT_RANGE) {
                    if let Ok(s) = cr.to_str() {
                        if let Some(total_str) = s.split('/').last() {
                            let parsed = total_str.parse::<i64>().unwrap_or(-1);
                            if parsed > 0 {
                                total_size = parsed;
                            }
                        }
                    }
                }
            } else if resp.status().is_success() {
                // 200
                if let Some(len) = resp.headers().get(CONTENT_LENGTH) {
                    if let Ok(s) = len.to_str() {
                        total_size = s.parse::<i64>().unwrap_or(-1);
                    }
                }
                if let Some(ar) = resp.headers().get(ACCEPT_RANGES) {
                    if let Ok(s) = ar.to_str() {
                        supports_range = s.to_lowercase().contains("bytes");
                    }
                }
            }

            if etag.is_none() {
                etag = resp
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
            }
            if last_modified.is_none() {
                last_modified = resp
                    .headers()
                    .get("last-modified")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
            }
            if filename_candidate.is_none() {
                if let Some(cd) = resp.headers().get(CONTENT_DISPOSITION) {
                    if let Ok(s) = cd.to_str() {
                        filename_candidate = extract_filename_from_cd(s);
                    }
                }
            }
        }
    }

    let filename = filename_candidate.unwrap_or_else(|| extract_filename_from_url(url));

    let category = determine_category(&filename);

    Ok(ProbeResult {
        url: url.to_string(),
        filename,
        category,
        total_size,
        supports_range,
        etag,
        last_modified,
    })
}

fn extract_filename_from_cd(cd: &str) -> Option<String> {
    for part in cd.split(';') {
        let trimmed = part.trim();
        if trimmed.starts_with("filename*=") {
            if let Some(val) = trimmed.strip_prefix("filename*=") {
                let clean = val.trim_matches('"').trim_matches('\'');
                let parts: Vec<&str> = clean.split("''").collect();
                if let Some(last) = parts.last() {
                    return Some(sanitize_filename(last));
                }
            }
        } else if trimmed.starts_with("filename=") {
            if let Some(val) = trimmed.strip_prefix("filename=") {
                let clean = val.trim_matches('"').trim_matches('\'');
                return Some(sanitize_filename(clean));
            }
        }
    }
    None
}

fn extract_filename_from_url(url_str: &str) -> String {
    if let Ok(parsed) = reqwest::Url::parse(url_str) {
        if let Some(segments) = parsed.path_segments() {
            if let Some(last) = segments.last() {
                if !last.is_empty() {
                    return sanitize_filename(last);
                }
            }
        }
    }
    format!("download_{}", chrono::Utc::now().format("%Y%m%d_%H%M%S"))
}

pub fn determine_category(filename: &str) -> String {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" | "tgz" => {
            "Compressed".to_string()
        }
        "exe" | "msi" | "dmg" | "pkg" | "deb" | "rpm" | "apk" => "Programs".to_string(),
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "wmv" => "Video".to_string(),
        "pdf" | "docx" | "doc" | "xlsx" | "xls" | "pptx" | "txt" | "epub" => {
            "Documents".to_string()
        }
        "mp3" | "flac" | "wav" | "aac" | "ogg" | "m4a" => "Music".to_string(),
        _ => "Other".to_string(),
    }
}

fn sanitize_filename(name: &str) -> String {
    name.replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_")
}
