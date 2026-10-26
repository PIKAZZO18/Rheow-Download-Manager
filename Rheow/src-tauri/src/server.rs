use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Header that non-browser clients (the extension, native host, CLI tools)
/// must send. Browsers cannot attach custom headers to a cross-origin request
/// without a CORS preflight, and the preflight is rejected unless the request
/// comes from an extension origin.
const CLIENT_HEADER: &str = "x-rheow-client";
const CLIENT_ID: &str = "rheow-extension";

const BRIDGE_HOST: &str = "127.0.0.1";
const BRIDGE_PORT: u16 = 41789;

/// Accepted values of the HTTP `Host` header. Rejecting anything else blocks
/// DNS-rebinding attacks where a public domain resolves to 127.0.0.1.
const ALLOWED_HOSTS: [&str; 2] = ["127.0.0.1:41789", "localhost:41789"];

const MAX_BODY_BYTES: usize = 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(10);

static BRIDGE_RUNNING: AtomicBool = AtomicBool::new(false);
static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);
static LAST_REQUEST: Mutex<Option<BridgeLastRequest>> = Mutex::new(None);
/// Set the first time an authorized client reaches the bridge. Only the Rheow
/// extension (or a trusted non-browser client) can pass `authorize`, so this is
/// a reliable "extension is installed and talking to us" signal for onboarding.
static EXTENSION_CONNECTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
pub struct BridgeLastRequest {
    pub method: String,
    pub path: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BridgeStatus {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub endpoint: String,
    pub request_count: u64,
    pub extension_connected: bool,
    pub last_request: Option<BridgeLastRequest>,
}

/// Snapshot for the Settings > Browser panel. The listener binds before this
/// flag is set, so "running" also means the port was actually claimed.
pub fn bridge_status() -> BridgeStatus {
    BridgeStatus {
        running: BRIDGE_RUNNING.load(Ordering::Relaxed),
        host: BRIDGE_HOST.to_string(),
        port: BRIDGE_PORT,
        endpoint: format!("http://{}:{}", BRIDGE_HOST, BRIDGE_PORT),
        request_count: REQUEST_COUNT.load(Ordering::Relaxed),
        extension_connected: EXTENSION_CONNECTED.load(Ordering::Relaxed),
        last_request: LAST_REQUEST.lock().ok().and_then(|last| last.clone()),
    }
}

fn record_request(method: &str, path: &str) {
    EXTENSION_CONNECTED.store(true, Ordering::Relaxed);
    REQUEST_COUNT.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut last) = LAST_REQUEST.lock() {
        *last = Some(BridgeLastRequest {
            method: method.to_string(),
            path: path.to_string(),
            at: chrono::Utc::now().to_rfc3339(),
        });
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserAddPayload {
    pub url: String,
    pub filename: Option<String>,
    pub cookie: Option<String>,
    pub referer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserBatchAddPayload {
    pub urls: Vec<String>,
    #[serde(default)]
    pub referer: Option<String>,
}

#[derive(Debug, Default)]
struct RequestHead {
    origin: Option<String>,
    host: Option<String>,
    client: Option<String>,
    content_type: Option<String>,
}

impl RequestHead {
    fn from_header_block(block: &str) -> Self {
        let mut head = Self::default();

        for line in block.lines().skip(1) {
            if let Some((name, value)) = line.split_once(':') {
                let name = name.trim().to_ascii_lowercase();
                let value = value.trim().to_string();
                match name.as_str() {
                    "origin" => head.origin = Some(value),
                    "host" => head.host = Some(value),
                    "x-rheow-client" => head.client = Some(value),
                    "content-type" => head.content_type = Some(value),
                    _ => {}
                }
            }
        }

        head
    }

    fn is_json(&self) -> bool {
        self.content_type
            .as_deref()
            .map(|value| value.to_ascii_lowercase().starts_with("application/json"))
            .unwrap_or(false)
    }
}

fn is_trusted_origin(origin: &str) -> bool {
    origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://")
}

/// Returns `None` when the request must be rejected. `Some(None)` means the
/// request carried no `Origin` header, so no CORS header is needed in the
/// response. `Some(Some(origin))` is the origin to echo back.
fn authorize(head: &RequestHead) -> Option<Option<String>> {
    let host_ok = head
        .host
        .as_deref()
        .map(|host| {
            ALLOWED_HOSTS
                .iter()
                .any(|allowed| host.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false);

    if !host_ok {
        return None;
    }

    match head.origin.as_deref() {
        Some(origin) if !origin.is_empty() => {
            if is_trusted_origin(origin) {
                Some(Some(origin.to_string()))
            } else {
                None
            }
        }
        _ => {
            // No Origin header: only allow clients that explicitly identify
            // themselves as the Rheow bridge client.
            if head.client.as_deref() == Some(CLIENT_ID) {
                Some(None)
            } else {
                None
            }
        }
    }
}

fn cors_headers(origin: &Option<String>) -> String {
    match origin {
        Some(origin) => format!(
            "Access-Control-Allow-Origin: {}\r\nVary: Origin\r\n",
            origin
        ),
        None => String::new(),
    }
}

fn json_response(status: &str, origin: &Option<String>, body: &str) -> String {
    format!(
        "HTTP/1.1 {}\r\n\
Content-Type: application/json\r\n\
{}Content-Length: {}\r\n\
Connection: close\r\n\r\n{}",
        status,
        cors_headers(origin),
        body.len(),
        body
    )
}

fn empty_response(status: &str) -> String {
    format!(
        "HTTP/1.1 {}\r\n\
Content-Length: 0\r\n\
Connection: close\r\n\r\n",
        status
    )
}

fn preflight_response(origin: &Option<String>) -> String {
    format!(
        "HTTP/1.1 204 No Content\r\n\
{}Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, {}\r\n\
Access-Control-Max-Age: 600\r\n\
Content-Length: 0\r\n\
Connection: close\r\n\r\n",
        cors_headers(origin),
        CLIENT_HEADER
    )
}

pub fn start_http_server(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::from(([127, 0, 0, 1], BRIDGE_PORT));
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[Rheow HTTP Bridge] Failed to bind {}: {}", addr, e);
                return;
            }
        };

        BRIDGE_RUNNING.store(true, Ordering::Relaxed);
        println!("[Rheow HTTP Bridge] Listening on http://{}", addr);

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(res) => res,
                Err(_) => continue,
            };

            let app_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut raw_data = Vec::with_capacity(4096);
                let mut buf = [0u8; 1024];
                let mut header_end: Option<usize> = None;
                let mut content_length: usize = 0;

                loop {
                    let n = match tokio::time::timeout(READ_TIMEOUT, socket.read(&mut buf)).await
                    {
                        Ok(Ok(n)) if n > 0 => n,
                        _ => break,
                    };
                    raw_data.extend_from_slice(&buf[..n]);

                    if header_end.is_none() {
                        if let Some(pos) = raw_data.windows(4).position(|w| w == b"\r\n\r\n") {
                            let end = pos + 4;
                            header_end = Some(end);
                            let header_str = String::from_utf8_lossy(&raw_data[..pos]);
                            for line in header_str.lines() {
                                let lower = line.to_ascii_lowercase();
                                if lower.starts_with("content-length:") {
                                    if let Some(val) = line.split(':').nth(1) {
                                        content_length = val.trim().parse::<usize>().unwrap_or(0);
                                    }
                                }
                            }

                            if content_length > MAX_BODY_BYTES {
                                let _ = socket
                                    .write_all(empty_response("413 Payload Too Large").as_bytes())
                                    .await;
                                return;
                            }
                        }
                    }

                    if let Some(h_end) = header_end {
                        if raw_data.len() >= h_end + content_length {
                            break;
                        }
                    }

                    if raw_data.len() > MAX_BODY_BYTES {
                        let _ = socket
                            .write_all(empty_response("413 Payload Too Large").as_bytes())
                            .await;
                        return;
                    }
                }

                let h_end = match header_end {
                    Some(idx) => idx,
                    None => return,
                };

                let header_part = String::from_utf8_lossy(&raw_data[..h_end]);
                let mut lines = header_part.lines();
                let request_line = match lines.next() {
                    Some(l) => l,
                    None => return,
                };

                let parts: Vec<&str> = request_line.split_whitespace().collect();
                if parts.len() < 2 {
                    return;
                }

                let method = parts[0];
                let path = parts[1].split('?').next().unwrap_or(parts[1]);
                let head = RequestHead::from_header_block(&header_part);

                // Every endpoint, including the health check, is gated. This
                // stops random websites from probing for a local Rheow install
                // or injecting downloads.
                let allowed_origin = match authorize(&head) {
                    Some(origin) => origin,
                    None => {
                        eprintln!(
                            "[Rheow HTTP Bridge] Rejected {} {} (host={:?}, origin={:?}, client_header={})",
                            method,
                            path,
                            head.host,
                            head.origin,
                            head.client.is_some()
                        );
                        let _ = socket.write_all(empty_response("403 Forbidden").as_bytes()).await;
                        return;
                    }
                };

                if method == "OPTIONS" {
                    let _ = socket
                        .write_all(preflight_response(&allowed_origin).as_bytes())
                        .await;
                    return;
                }

                // Only count real API traffic, not CORS preflights.
                record_request(method, path);

                if method == "GET" && path.starts_with("/api/health") {
                    let body = r#"{"status":"ok","app":"Rheow","version":"0.1.0"}"#;
                    let _ = socket
                        .write_all(json_response("200 OK", &allowed_origin, body).as_bytes())
                        .await;
                    return;
                }

                if method == "POST" && path.starts_with("/api/add_download") {
                    if !head.is_json() {
                        let _ = socket
                            .write_all(empty_response("415 Unsupported Media Type").as_bytes())
                            .await;
                        return;
                    }

                    let body_start = h_end;
                    let body_end = (h_end + content_length).min(raw_data.len());
                    let body_bytes = &raw_data[body_start..body_end];
                    let body_str = String::from_utf8_lossy(body_bytes);

                    match serde_json::from_str::<BrowserAddPayload>(body_str.trim()) {
                        Ok(payload) => {
                            let _ = app_clone.emit("browser-add-download", payload);
                            if let Some(window) = app_clone.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }

                            let body = r#"{"success":true}"#;
                            let _ = socket
                                .write_all(
                                    json_response("200 OK", &allowed_origin, body).as_bytes(),
                                )
                                .await;
                            return;
                        }
                        Err(e) => {
                            eprintln!(
                                "[Rheow HTTP Bridge] Failed to parse payload: {}. Body: '{}'",
                                e, body_str
                            );
                        }
                    }

                    let _ = socket
                        .write_all(empty_response("400 Bad Request").as_bytes())
                        .await;
                    return;
                }

                if method == "POST" && path.starts_with("/api/add_batch") {
                    if !head.is_json() {
                        let _ = socket
                            .write_all(empty_response("415 Unsupported Media Type").as_bytes())
                            .await;
                        return;
                    }

                    let body_start = h_end;
                    let body_end = (h_end + content_length).min(raw_data.len());
                    let body_bytes = &raw_data[body_start..body_end];
                    let body_str = String::from_utf8_lossy(body_bytes);

                    match serde_json::from_str::<BrowserBatchAddPayload>(body_str.trim()) {
                        Ok(mut payload) => {
                            // Keep valid http/https URLs, deduplicate and cap at 500
                            let mut unique_urls = Vec::new();
                            let mut seen = std::collections::HashSet::new();
                            for u in payload.urls {
                                let trimmed = u.trim();
                                if (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
                                    && seen.insert(trimmed.to_string())
                                {
                                    unique_urls.push(trimmed.to_string());
                                    if unique_urls.len() >= 500 {
                                        break;
                                    }
                                }
                            }

                            if unique_urls.is_empty() {
                                let body = r#"{"error":"No valid URLs provided"}"#;
                                let _ = socket
                                    .write_all(
                                        json_response("400 Bad Request", &allowed_origin, body).as_bytes(),
                                    )
                                    .await;
                                return;
                            }

                            payload.urls = unique_urls;
                            let count = payload.urls.len();
                            let _ = app_clone.emit("browser-add-batch", payload);
                            if let Some(window) = app_clone.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }

                            let body = format!(r#"{{"success":true,"count":{}}}"#, count);
                            let _ = socket
                                .write_all(
                                    json_response("200 OK", &allowed_origin, &body).as_bytes(),
                                )
                                .await;
                            return;
                        }
                        Err(e) => {
                            eprintln!(
                                "[Rheow HTTP Bridge] Failed to parse batch payload: {}. Body: '{}'",
                                e, body_str
                            );
                        }
                    }

                    let _ = socket
                        .write_all(empty_response("400 Bad Request").as_bytes())
                        .await;
                    return;
                }

                let _ = socket
                    .write_all(empty_response("404 Not Found").as_bytes())
                    .await;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{authorize, is_trusted_origin, RequestHead};

    fn head(origin: Option<&str>, host: &str, client: Option<&str>) -> RequestHead {
        RequestHead {
            origin: origin.map(|s| s.to_string()),
            host: Some(host.to_string()),
            client: client.map(|s| s.to_string()),
            content_type: None,
        }
    }

    #[test]
    fn accepts_extension_origin() {
        let request = head(Some("chrome-extension://abcdef"), "127.0.0.1:41789", None);
        assert_eq!(
            authorize(&request),
            Some(Some("chrome-extension://abcdef".to_string()))
        );
    }

    #[test]
    fn rejects_web_origin() {
        let request = head(Some("https://evil.example"), "127.0.0.1:41789", None);
        assert!(authorize(&request).is_none());
    }

    #[test]
    fn rejects_null_origin() {
        let request = head(Some("null"), "127.0.0.1:41789", None);
        assert!(authorize(&request).is_none());
    }

    #[test]
    fn accepts_identified_non_browser_client() {
        let request = head(None, "127.0.0.1:41789", Some("rheow-extension"));
        assert_eq!(authorize(&request), Some(None));
    }

    #[test]
    fn rejects_unidentified_non_browser_client() {
        let request = head(None, "127.0.0.1:41789", None);
        assert!(authorize(&request).is_none());
    }

    #[test]
    fn rejects_dns_rebinding_host() {
        let request = head(Some("chrome-extension://abcdef"), "evil.example", None);
        assert!(authorize(&request).is_none());
    }

    #[test]
    fn accepts_localhost_alias() {
        let request = head(None, "localhost:41789", Some("rheow-extension"));
        assert_eq!(authorize(&request), Some(None));
    }

    #[test]
    fn trusted_origin_requires_extension_scheme() {
        assert!(is_trusted_origin("chrome-extension://id"));
        assert!(is_trusted_origin("moz-extension://id"));
        assert!(!is_trusted_origin("http://127.0.0.1:1420"));
        assert!(!is_trusted_origin("https://chrome-extension.example"));
    }

    #[test]
    fn parses_browser_batch_add_payload() {
        let json = r#"{"urls":["https://example.com/file1.zip","https://example.com/file2.zip"],"referer":"https://example.com"}"#;
        let payload: super::BrowserBatchAddPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.urls.len(), 2);
        assert_eq!(payload.referer.as_deref(), Some("https://example.com"));

        // Referer is optional
        let json_no_referer = r#"{"urls":["https://example.com/file1.zip"]}"#;
        let payload_no_referer: super::BrowserBatchAddPayload = serde_json::from_str(json_no_referer).unwrap();
        assert_eq!(payload_no_referer.urls.len(), 1);
        assert_eq!(payload_no_referer.referer, None);
    }
}
