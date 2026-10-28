#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod disk;
mod engine;
mod server;
mod settings;
mod system;
mod updater;

use chrono::{Datelike, Local, Timelike};
use db::{Database, DownloadRecord};
use disk::{get_system_partitions, PartitionInfo};
use engine::probe::ProbeResult;
use engine::EngineManager;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_notification::{Action, ActionPerformed, ActionType, NotificationExt};
use tauri_plugin_window_state::StateFlags;

struct AppState {
    db: Arc<Database>,
    engine: Arc<EngineManager>,
    /// Mirrors the persisted `close_to_tray` preference so the window event
    /// handler can decide synchronously without touching SQLite.
    close_to_tray: Arc<AtomicBool>,
    scheduler_settings: Arc<tokio::sync::Mutex<settings::SchedulerSettings>>,
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
            let scale_val = if scale > 0.0 { scale } else { 1.0 };
            let logical_width = (size.width as f64) / scale_val;
            let logical_height = (size.height as f64) / scale_val;
            if logical_width < 990.0 || logical_height < 590.0 {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 1200.0,
                    height: 750.0,
                }));
                let _ = window.center();
            }
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Builds the tray icon and its context menu. The returned handle is managed
/// by the app in `setup` so the icon stays alive for the whole process.
fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon<tauri::Wry>> {
    let show_item = MenuItem::with_id(app, "tray_show", "Show Rheow", true, None::<&str>)?;
    let pause_item = MenuItem::with_id(app, "tray_pause_all", "Pause All", true, None::<&str>)?;
    let resume_item = MenuItem::with_id(app, "tray_resume_all", "Resume All", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show_item, &pause_item, &resume_item, &separator, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::<tauri::Wry>::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Rheow")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => show_main_window(app),
            "tray_pause_all" => {
                let app = app.clone();
                let engine = app.state::<AppState>().engine.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = engine.pause_all_downloads(&app).await {
                        log::warn!("Tray pause all failed: {error}");
                    }
                });
            }
            "tray_resume_all" => {
                let app = app.clone();
                let engine = app.state::<AppState>().engine.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = engine.resume_all_downloads(&app).await {
                        log::warn!("Tray resume all failed: {error}");
                    }
                });
            }
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)
}

#[tauri::command]
fn get_partitions() -> Result<Vec<PartitionInfo>, String> {
    Ok(get_system_partitions())
}

#[tauri::command]
async fn probe_download(
    url: String,
    cookie: Option<String>,
    referer: Option<String>,
    timeout_seconds: Option<u64>,
) -> Result<ProbeResult, String> {
    let timeout = timeout_seconds.unwrap_or(30);
    engine::probe::probe_url_with_timeout(&url, cookie.as_deref(), referer.as_deref(), timeout)
        .await
}

#[tauri::command]
async fn get_default_destination(
    app: AppHandle,
    state: State<'_, AppState>,
    category: String,
    filename: String,
    base_path: Option<String>,
    category_subfolders: Option<HashMap<String, String>>,
) -> Result<String, String> {
    // Priority: explicit UI value (if not empty and not dummy C:\Downloads) -> saved settings -> OS Downloads folder.
    let saved = state.db.get_engine_settings().unwrap_or_default();
    let os_downloads = app
        .path()
        .download_dir()
        .ok()
        .unwrap_or_else(settings::default_downloads_dir);

    let base = base_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("C:\\Downloads"))
        .or_else(|| {
            let saved_path = saved.default_download_path.trim().to_string();
            (!saved_path.is_empty() && !saved_path.eq_ignore_ascii_case("C:\\Downloads")).then_some(saved_path)
        });

    let downloads_dir = base
        .map(PathBuf::from)
        .unwrap_or(os_downloads);

    // The UI sends its current (possibly unsaved) mapping so the preview matches
    // what will be persisted; older callers fall back to the stored settings.
    let overrides = category_subfolders.unwrap_or(saved.category_subfolders);

    let target = engine::prealloc::resolve_category_destination(
        &downloads_dir,
        &category,
        &filename,
        &overrides,
    )
    .map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
struct LoadedSettings {
    settings: settings::EngineSettings,
    /// False when the database had no saved row, letting the UI migrate its
    /// legacy localStorage values exactly once.
    stored: bool,
}

#[tauri::command]
async fn load_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LoadedSettings, String> {
    let stored = state.db.get_engine_settings();
    let present = stored.is_some();
    let mut settings = stored.unwrap_or_default().sanitized();

    // Resolve the real OS user downloads folder on the user's computer
    let os_downloads = app
        .path()
        .download_dir()
        .ok()
        .unwrap_or_else(settings::default_downloads_dir);

    // If first time open (no saved settings yet), or if path is empty,
    // or if it was the legacy hardcoded 'C:\Downloads', default to the user's computer Downloads directory.
    let is_legacy_default = settings.default_download_path.trim().eq_ignore_ascii_case("C:\\Downloads");
    if !present || settings.default_download_path.trim().is_empty() || is_legacy_default {
        settings.default_download_path = os_downloads.to_string_lossy().to_string();
    }

    // The registry is the source of truth: the user may have removed the
    // startup entry from Task Manager without opening Rheow.
    settings.autostart_enabled = app
        .autolaunch()
        .is_enabled()
        .unwrap_or(settings.autostart_enabled);

    // Keep running when window is closed defaults to true when application is launched
    settings.close_to_tray = true;

    Ok(LoadedSettings {
        settings,
        stored: present,
    })
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: settings::EngineSettings,
) -> Result<(), String> {
    let settings = settings.sanitized();

    // Keep the startup registration in sync before persisting the preference.
    // `load_settings` re-reads the actual registry state on every open, so a
    // failed registration cannot leave the UI claiming autostart is enabled.
    let autolaunch = app.autolaunch();
    let registered = autolaunch.is_enabled().unwrap_or(false);
    if settings.autostart_enabled != registered {
        if settings.autostart_enabled {
            autolaunch
                .enable()
                .map_err(|error| format!("Could not enable launch at sign-in: {error}"))?;
        } else {
            autolaunch
                .disable()
                .map_err(|error| format!("Could not disable launch at sign-in: {error}"))?;
        }
    }

    state
        .db
        .save_engine_settings(&settings)
        .map_err(|e| e.to_string())?;
    state
        .close_to_tray
        .store(settings.close_to_tray, Ordering::Relaxed);

    let global_rate = if settings.speed_limiter_mode == "global" {
        settings.global_speed_limit_kb.unwrap_or(0) * 1024
    } else {
        0
    };
    state.engine.global_limiter.set_rate(global_rate);

    Ok(())
}

#[derive(serde::Serialize)]
struct BrowserIntegrationStatus {
    bridge: server::BridgeStatus,
    extension_path: Option<String>,
    extension_setup_path: Option<String>,
    extension_version: Option<String>,
}

#[derive(serde::Serialize)]
struct ExtensionSetupInfo {
    path: String,
    version: Option<String>,
    copied: bool,
}

#[derive(serde::Serialize)]
struct BrowserLaunchInfo {
    browser: String,
    extensions_url: String,
}

/// The extension ships as a bundle resource in installed builds. During
/// development it lives next to the crate, so try both locations.
fn find_extension_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("extension"));
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("extension"),
    );

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("extension"));
        }
    }

    candidates
        .into_iter()
        .find(|dir| dir.join("manifest.json").is_file())
}

fn manifest_version(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join("manifest.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|manifest| {
            manifest
                .get("version")
                .and_then(|version| version.as_str())
                .map(str::to_string)
        })
}

/// Recursively copy the extension, creating directories as needed.
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// True when the destination is missing a file or holds an older copy.
fn extension_needs_sync(src: &Path, dst: &Path) -> bool {
    let entries = match std::fs::read_dir(src) {
        Ok(entries) => entries,
        Err(_) => return false,
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            return true;
        };
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            if extension_needs_sync(&entry.path(), &target) {
                return true;
            }
            continue;
        }

        let (Ok(source_meta), Ok(target_meta)) =
            (entry.metadata(), std::fs::metadata(&target))
        else {
            return true;
        };

        let newer = match (source_meta.modified(), target_meta.modified()) {
            (Ok(source_time), Ok(target_time)) => source_time > target_time,
            _ => false,
        };
        if source_meta.len() != target_meta.len() || newer {
            return true;
        }
    }

    false
}

/// Copies the bundled extension to a stable, user-writable folder so Chrome's
/// "Load unpacked" dialog never has to reach into Program Files. Returns the
/// folder and whether anything was (re)copied.
fn prepare_extension_copy(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    let source = find_extension_dir(app)
        .ok_or_else(|| "Bundled browser extension was not found".to_string())?;
    let local_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Cannot resolve app data folder: {error}"))?;
    let destination = local_dir.join("browser-extension");

    let copied = extension_needs_sync(&source, &destination);
    if copied {
        copy_dir_all(&source, &destination)
            .map_err(|error| format!("Failed to copy browser extension: {error}"))?;
    }

    Ok((destination, copied))
}

fn prepare_extension_info(app: &AppHandle) -> Result<ExtensionSetupInfo, String> {
    let (path, copied) = prepare_extension_copy(app)?;
    Ok(ExtensionSetupInfo {
        version: manifest_version(&path),
        path: display_path(&path),
        copied,
    })
}

fn display_path(path: &Path) -> String {
    let raw = path.to_string_lossy();

    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw.to_string()
    }
}

fn default_browser_prog_id() -> Option<String> {
    let mut command = std::process::Command::new("reg");
    command.args([
        "query",
        r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
        "/v",
        "ProgId",
    ]);

    // The app is a GUI process, so hide the console window `reg` would
    // otherwise flash on screen.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let output = command.output().ok()?;
    parse_prog_id(&String::from_utf8_lossy(&output.stdout))
}

fn parse_prog_id(stdout: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        if parts.next()? == "ProgId" {
            // `reg query` prints: ProgId    REG_SZ    ChromeHTML
            parts.last().map(str::to_string)
        } else {
            None
        }
    })
}

/// Picks a Chromium-based browser that supports the bundled MV3 extension.
/// The user's default browser wins; Edge/Chrome are the fallbacks because Edge
/// ships with Windows.
fn find_supported_browser() -> Option<(String, PathBuf, String)> {
    let prog_id = default_browser_prog_id()
        .unwrap_or_default()
        .to_lowercase();
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let program_files_x86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from);
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);

    let mut chrome_paths = Vec::new();
    let mut edge_paths = Vec::new();
    let mut brave_paths = Vec::new();
    let mut vivaldi_paths = Vec::new();
    let mut opera_paths = Vec::new();

    if let Some(base) = &program_files {
        chrome_paths.push(base.join(r"Google\Chrome\Application\chrome.exe"));
        edge_paths.push(base.join(r"Microsoft\Edge\Application\msedge.exe"));
        brave_paths.push(base.join(r"BraveSoftware\Brave-Browser\Application\brave.exe"));
        vivaldi_paths.push(base.join(r"Vivaldi\Application\vivaldi.exe"));
    }
    if let Some(base) = &program_files_x86 {
        chrome_paths.push(base.join(r"Google\Chrome\Application\chrome.exe"));
        edge_paths.push(base.join(r"Microsoft\Edge\Application\msedge.exe"));
        brave_paths.push(base.join(r"BraveSoftware\Brave-Browser\Application\brave.exe"));
    }
    if let Some(base) = &local_app_data {
        chrome_paths.push(base.join(r"Google\Chrome\Application\chrome.exe"));
        brave_paths.push(base.join(r"BraveSoftware\Brave-Browser\Application\brave.exe"));
        vivaldi_paths.push(base.join(r"Vivaldi\Application\vivaldi.exe"));
        opera_paths.push(base.join(r"Programs\Opera\opera.exe"));
        opera_paths.push(base.join(r"Programs\Opera\launcher.exe"));
    }

    let candidates = [
        (vec!["chromehtml"], "Google Chrome", "chrome", chrome_paths),
        (
            vec!["msedgehtm", "microsoftedge"],
            "Microsoft Edge",
            "edge",
            edge_paths,
        ),
        (vec!["bravehtml"], "Brave", "brave", brave_paths),
        (vec!["vivaldihtm"], "Vivaldi", "vivaldi", vivaldi_paths),
        (vec!["operastable"], "Opera", "opera", opera_paths),
    ];

    for (prog_ids, name, scheme, paths) in &candidates {
        if prog_ids.iter().any(|id| prog_id.contains(id)) {
            if let Some(path) = paths.iter().find(|path| path.is_file()) {
                return Some((
                    name.to_string(),
                    path.clone(),
                    format!("{scheme}://extensions"),
                ));
            }
        }
    }

    // Fallback order: Edge ships with Windows, Chrome is the most common
    // alternative, then the remaining Chromium browsers.
    for fallback in [
        "Microsoft Edge",
        "Google Chrome",
        "Brave",
        "Vivaldi",
        "Opera",
    ] {
        if let Some((_, name, scheme, paths)) =
            candidates.iter().find(|(_, name, _, _)| *name == fallback)
        {
            if let Some(path) = paths.iter().find(|path| path.is_file()) {
                return Some((
                    name.to_string(),
                    path.clone(),
                    format!("{scheme}://extensions"),
                ));
            }
        }
    }

    None
}

#[tauri::command]
fn prepare_browser_extension(app: AppHandle) -> Result<ExtensionSetupInfo, String> {
    prepare_extension_info(&app)
}

#[tauri::command]
fn open_extension_folder(app: AppHandle) -> Result<ExtensionSetupInfo, String> {
    let info = prepare_extension_info(&app)?;
    system::open_folder_or_select(&info.path)?;
    Ok(info)
}

/// Handles of the visible top-level windows owned by the given executable.
/// Captured before launching so the helper can tell the new window apart from
/// windows the user already had open.
#[cfg(target_os = "windows")]
fn browser_window_handles(executable: &Path) -> Vec<isize> {
    use std::ffi::c_void;

    extern "system" {
        fn EnumWindows(
            callback: extern "system" fn(*mut c_void, isize) -> i32,
            lparam: isize,
        ) -> i32;
        fn IsWindowVisible(hwnd: *mut c_void) -> i32;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, pid: *mut u32) -> u32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn QueryFullProcessImageNameW(
            process: *mut c_void,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    extern "system" fn collect(hwnd: *mut c_void, lparam: isize) -> i32 {
        unsafe {
            if IsWindowVisible(hwnd) != 0 {
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, &mut pid);
                if pid != 0 {
                    (*(lparam as *mut Vec<(isize, u32)>)).push((hwnd as isize, pid));
                }
            }
        }
        1
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    let target = executable.to_string_lossy().to_string();
    let mut windows: Vec<(isize, u32)> = Vec::new();
    unsafe {
        EnumWindows(collect, &mut windows as *mut _ as isize);
    }

    let mut checked: HashMap<u32, bool> = HashMap::new();
    windows
        .into_iter()
        .filter_map(|(hwnd, pid)| {
            let belongs = *checked.entry(pid).or_insert_with(|| unsafe {
                let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if process.is_null() {
                    return false;
                }
                let mut buffer = [0u16; 1024];
                let mut len = buffer.len() as u32;
                let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut len);
                CloseHandle(process);
                ok != 0
                    && String::from_utf16_lossy(&buffer[..len as usize])
                        .eq_ignore_ascii_case(&target)
            });
            belongs.then_some(hwnd)
        })
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn browser_window_handles(_executable: &Path) -> Vec<isize> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn navigate_browser_to_extensions(executable: PathBuf, existing: Vec<isize>, url: String) {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeybdInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    union InputUnion {
        ki: KeybdInput,
        // MOUSEINPUT is 32 bytes on x64. Keep the union the same size so
        // SendInput receives correctly sized INPUT records.
        _pad: [usize; 4],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Input {
        input_type: u32,
        union: InputUnion,
    }

    extern "system" {
        fn SendInput(c_inputs: u32, p_inputs: *const Input, cb_size: i32) -> u32;
        fn GetForegroundWindow() -> *mut c_void;
        fn Sleep(ms: u32);
    }

    const INPUT_KEYBOARD: u32 = 1;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_UNICODE: u32 = 0x0004;
    const VK_CONTROL: u16 = 0x11;
    const VK_L: u16 = 0x4C;
    const VK_RETURN: u16 = 0x0D;

    fn key(vk: u16, up: bool) -> Input {
        Input {
            input_type: INPUT_KEYBOARD,
            union: InputUnion {
                ki: KeybdInput {
                    w_vk: vk,
                    w_scan: 0,
                    dw_flags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        }
    }

    fn character(code_unit: u16, up: bool) -> Input {
        Input {
            input_type: INPUT_KEYBOARD,
            union: InputUnion {
                ki: KeybdInput {
                    w_vk: 0,
                    w_scan: code_unit,
                    dw_flags: KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        }
    }

    std::thread::spawn(move || unsafe {
        // Chromium ignores `chrome://` URLs on the command line, so wait for
        // the window this launch created and drive its address bar instead.
        let mut target = 0isize;
        for _ in 0..100 {
            if let Some(hwnd) = browser_window_handles(&executable)
                .into_iter()
                .find(|handle| !existing.contains(handle))
            {
                target = hwnd;
                break;
            }
            Sleep(100);
        }

        if target == 0 {
            return;
        }

        // Only type while that exact window is in front. If the user switched
        // to another app or another browser window, send nothing at all.
        let mut focused = false;
        for _ in 0..30 {
            if GetForegroundWindow() as isize == target {
                focused = true;
                break;
            }
            Sleep(100);
        }

        if !focused {
            return;
        }

        let size = std::mem::size_of::<Input>() as i32;

        Sleep(400);
        let focus = [
            key(VK_CONTROL, false),
            key(VK_L, false),
            key(VK_L, true),
            key(VK_CONTROL, true),
        ];
        SendInput(focus.len() as u32, focus.as_ptr(), size);

        Sleep(250);
        let mut address = Vec::with_capacity(url.len() * 2);
        for code_unit in url.encode_utf16() {
            address.push(character(code_unit, false));
            address.push(character(code_unit, true));
        }
        SendInput(address.len() as u32, address.as_ptr(), size);

        Sleep(250);
        let enter = [key(VK_RETURN, false), key(VK_RETURN, true)];
        SendInput(enter.len() as u32, enter.as_ptr(), size);
    });
}

#[cfg(not(target_os = "windows"))]
fn navigate_browser_to_extensions(_executable: PathBuf, _existing: Vec<isize>, _url: String) {}

#[tauri::command]
fn open_browser_for_extension() -> Result<BrowserLaunchInfo, String> {
    let (browser, executable, extensions_url) = find_supported_browser().ok_or_else(|| {
        "Chrome, Edge, Brave, Vivaldi, or Opera was not found on this computer".to_string()
    })?;

    let existing = browser_window_handles(&executable);

    // Chromium blocks `chrome://` URLs passed on the command line, so the
    // helper types the address into the window it just opened.
    std::process::Command::new(&executable)
        .arg("--new-window")
        .spawn()
        .map_err(|error| format!("Failed to open the browser: {error}"))?;

    navigate_browser_to_extensions(executable, existing, extensions_url.clone());

    Ok(BrowserLaunchInfo {
        browser,
        extensions_url,
    })
}

/// Read-only counterpart of `open_browser_for_extension`, used to label the
/// button with the detected default browser before the user clicks it.
#[tauri::command]
fn detect_browser_for_extension() -> Option<BrowserLaunchInfo> {
    find_supported_browser().map(|(browser, _executable, extensions_url)| BrowserLaunchInfo {
        browser,
        extensions_url,
    })
}

#[tauri::command]
fn get_browser_integration_status(app: AppHandle) -> BrowserIntegrationStatus {
    let bundled_dir = find_extension_dir(&app);
    let setup = prepare_extension_info(&app).ok();
    let extension_version = setup
        .as_ref()
        .and_then(|info| info.version.clone())
        .or_else(|| bundled_dir.as_deref().and_then(manifest_version));

    BrowserIntegrationStatus {
        bridge: server::bridge_status(),
        extension_path: bundled_dir.as_deref().map(display_path),
        extension_setup_path: setup.map(|info| info.path),
        extension_version,
    }
}

fn open_path(path: &str) {
    let _ = system::open_file_native(path);
}

fn reveal_path(path: &str) {
    let _ = system::open_folder_or_select(path);
}

/// Toast actions carry the destination path, but fall back to the database so
/// a toast restored from the Action Center still resolves the file.
fn notification_destination(performed: &ActionPerformed, db: &Database) -> Option<String> {
    let notification = performed.notification()?;

    let direct = notification
        .extra()
        .get("destination_path")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| notification.data().get("destination_path").cloned());

    if direct.is_some() {
        return direct;
    }

    let id = notification
        .extra()
        .get("download_id")
        .and_then(|value| value.as_str())
        .or_else(|| notification.data().get("download_id").map(String::as_str))?;

    db.get_download_by_id(id)
        .ok()
        .flatten()
        .map(|record| record.destination_path)
}

fn notification_download_id(performed: &ActionPerformed) -> Option<String> {
    let notification = performed.notification()?;

    notification
        .extra()
        .get("download_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| notification.data().get("download_id").cloned())
}

#[tauri::command]
async fn add_and_start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    filename: String,
    category: String,
    destination_path: String,
    total_size: i64,
    segment_count: usize,
    open_folder_on_finish: bool,
    cookie: Option<String>,
    referer: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    speed_limit_kb: Option<i64>,
    download_later: Option<bool>,
    supports_range: Option<bool>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let is_later = download_later.unwrap_or(false);
    let initial_status = if is_later { "queued" } else { "downloading" };

    let record = DownloadRecord {
        id: id.clone(),
        url: url.clone(),
        filename,
        category,
        destination_path: destination_path.clone(),
        total_size,
        downloaded_size: 0,
        speed: 0.0,
        eta_seconds: 0,
        status: initial_status.to_string(),
        etag: etag.clone(),
        last_modified: last_modified.clone(),
        open_folder_on_finish,
        created_at: chrono::Utc::now().to_rfc3339(),
        completed_at: None,
        cookie: cookie.clone(),
        referer: referer.clone(),
        speed_limit_kb,
        segment_count: Some(segment_count as i64),
        supports_range: supports_range.unwrap_or(true),
    };

    state.db.insert_download(&record).map_err(|e| e.to_string())?;

    if !is_later {
        let engine = state.engine.clone();
        let download_id = id.clone();
        let count = if segment_count > 0 {
            segment_count
        } else {
            state
                .db
                .get_engine_settings()
                .unwrap_or_default()
                .sanitized()
                .max_connections as usize
        };
        let app_clone = app.clone();

        tokio::spawn(async move {
            let _ = engine.start_download(
                app_clone,
                download_id,
                url,
                destination_path,
                total_size,
                count,
                cookie,
                referer,
                etag,
                last_modified,
                speed_limit_kb,
            ).await;
        });
    } else {
        // Item is added to queue (Download Later)
        let _ = app.emit(
            "download-status-changed",
            serde_json::json!({
                "id": &id,
                "status": "queued"
            }),
        );
        let queued_count = state.db.get_next_queued_downloads(1000).unwrap_or_default().len();
        let _ = app.emit("queue-status-changed", serde_json::json!({
            "queuedCount": queued_count
        }));

        if state.engine.is_queue_running() {
            let engine = state.engine.clone();
            let app_clone = app.clone();
            tokio::spawn(async move {
                engine.process_next_queued(app_clone).await;
            });
        }
    }

    Ok(id)
}

#[tauri::command]
async fn check_resume_support(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let record = state
        .db
        .get_download_by_id(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Download not found".to_string())?;

    let timeout = 15;
    let probe = engine::probe::probe_url_with_timeout(
        &record.url,
        record.cookie.as_deref(),
        record.referer.as_deref(),
        timeout,
    )
    .await
    .map_err(|e| e.to_string())?;

    let supports_range = probe.supports_range;
    state
        .db
        .update_supports_range(&id, supports_range)
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "download-resume-checked",
        serde_json::json!({
            "id": &id,
            "supports_range": supports_range
        }),
    );

    Ok(supports_range)
}

#[tauri::command]
async fn resume_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.engine.resume_download(&app, &id).await
}

/// Bulk resume goes through the queue so a large selection cannot open more
/// parallel connections than the engine allows.
#[tauri::command]
async fn resume_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    state.engine.queue_downloads(&app, ids).await
}

#[tauri::command]
async fn pause_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.engine.pause_download(&app, &id).await
}

#[tauri::command]
async fn cancel_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.engine.cancel_download(&app, &id).await
}

#[tauri::command]
async fn delete_download(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    delete_file: Option<bool>,
) -> Result<(), String> {
    state.engine.delete_download(&app, &id, delete_file.unwrap_or(false)).await
}

#[tauri::command]
async fn redownload(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.engine.redownload(&app, &id).await
}

#[tauri::command]
async fn set_download_speed_limit(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    speed_limit_kb: Option<i64>,
) -> Result<(), String> {
    state
        .engine
        .set_download_speed_limit(&id, speed_limit_kb)
        .await?;

    let _ = app.emit(
        "download-speed-limit-changed",
        serde_json::json!({
            "id": id,
            "speed_limit_kb": speed_limit_kb,
        }),
    );

    Ok(())
}

#[tauri::command]
async fn pause_all_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.engine.pause_all_downloads(&app).await
}

#[tauri::command]
async fn resume_all_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.engine.resume_all_downloads(&app).await
}

#[tauri::command]
async fn start_queue(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.engine.set_queue_running(true);
    let _ = app.emit("queue-status-changed", serde_json::json!({ "isRunning": true }));
    let engine = state.engine.clone();
    tokio::spawn(async move {
        engine.process_next_queued(app).await;
    });
    Ok(())
}

#[tauri::command]
async fn pause_queue(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.engine.set_queue_running(false);
    let _ = app.emit("queue-status-changed", serde_json::json!({ "isRunning": false }));
    Ok(())
}

#[tauri::command]
async fn get_queue_status(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.engine.is_queue_running())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueDetails {
    is_running: bool,
    active_count: usize,
    queued_count: usize,
    max_concurrent: usize,
}

#[tauri::command]
async fn get_queue_details(
    state: State<'_, AppState>,
) -> Result<QueueDetails, String> {
    let queued = state.db.get_next_queued_downloads(1000).unwrap_or_default().len();
    let active = state.engine.active_downloads_count().await;
    Ok(QueueDetails {
        is_running: state.engine.is_queue_running(),
        active_count: active,
        queued_count: queued,
        max_concurrent: state.engine.get_max_concurrent_downloads(),
    })
}

#[tauri::command]
async fn set_queue_max_concurrent(
    app: AppHandle,
    state: State<'_, AppState>,
    count: usize,
) -> Result<(), String> {
    state.engine.set_max_concurrent_downloads(count);
    let mut sched = state.scheduler_settings.lock().await;
    sched.max_concurrent_queue = count.clamp(1, 10);
    let _ = state.db.save_scheduler_settings(&sched);
    let _ = app.emit("queue-status-changed", serde_json::json!({
        "maxConcurrent": count
    }));
    Ok(())
}

#[tauri::command]
async fn get_scheduler_settings(
    state: State<'_, AppState>,
) -> Result<settings::SchedulerSettings, String> {
    let guard = state.scheduler_settings.lock().await;
    Ok(guard.clone())
}

#[tauri::command]
async fn save_scheduler_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: settings::SchedulerSettings,
) -> Result<(), String> {
    let sanitized = settings.sanitized();
    state.db.save_scheduler_settings(&sanitized).map_err(|e| e.to_string())?;
    state.engine.set_max_concurrent_downloads(sanitized.max_concurrent_queue);
    {
        let mut guard = state.scheduler_settings.lock().await;
        *guard = sanitized.clone();
    }
    let _ = app.emit("scheduler-settings-changed", &sanitized);
    Ok(())
}

#[tauri::command]
async fn get_all_downloads(state: State<'_, AppState>) -> Result<Vec<DownloadRecord>, String> {
    state.db.get_all_downloads().map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_destination_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let path_str = folder.and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string());
        let _ = tx.send(path_str);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_file(path: String) -> Result<(), String> {
    system::open_file_native(&path)
}

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    system::open_folder_or_select(&path)
}

#[tauri::command]
async fn open_browser_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn update_download_url(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    url: String,
    cookie: Option<String>,
    referer: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    auto_resume: Option<bool>,
) -> Result<(), String> {
    // 1. If etag and last_modified were not supplied, probe the new URL
    let (final_etag, final_last_modified) = if etag.is_none() && last_modified.is_none() {
        let settings = state.db.get_engine_settings().unwrap_or_default().sanitized();
        if let Ok(probe) = engine::probe::probe_url_with_timeout(
            &url,
            cookie.as_deref(),
            referer.as_deref(),
            settings.connect_timeout().as_secs(),
        ).await {
            (probe.etag, probe.last_modified)
        } else {
            (None, None)
        }
    } else {
        (etag, last_modified)
    };

    // 2. Signal any active worker for this download to gracefully halt
    {
        let map = state.engine.active_downloads.lock().await;
        if let Some(active) = map.get(&id) {
            active.cancel_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    // 3. Update database row with new link and refreshed validators
    state.db.update_download_url(
        &id,
        &url,
        cookie.as_deref(),
        referer.as_deref(),
        final_etag.as_deref(),
        final_last_modified.as_deref(),
    ).map_err(|e| e.to_string())?;

    // 4. Emit status changed event
    let _ = app.emit(
        "download-status-changed",
        serde_json::json!({
            "id": id,
            "status": "paused",
            "url": url,
        }),
    );

    // 5. Resume download immediately if requested (default: true)
    if auto_resume.unwrap_or(true) {
        state.engine.resume_download(&app, &id).await?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn get_clipboard_text_win() -> Option<String> {
    use std::ffi::c_void;
    extern "system" {
        fn OpenClipboard(hWndNewOwner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn GetClipboardData(uFormat: u32) -> *mut c_void;
        fn GlobalLock(hMem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(hMem: *mut c_void) -> i32;
    }
    const CF_UNICODETEXT: u32 = 13;

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            CloseClipboard();
            return None;
        }
        let ptr = GlobalLock(handle) as *const u16;
        if ptr.is_null() {
            CloseClipboard();
            return None;
        }
        let mut len = 0;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        let s = String::from_utf16_lossy(slice);
        GlobalUnlock(handle);
        CloseClipboard();
        Some(s)
    }
}

/// Writes Unicode text to the Windows clipboard. Returns false when another
/// process holds the clipboard or the allocation fails, so the UI can tell the
/// user to type the address manually instead of pretending the copy worked.
#[cfg(target_os = "windows")]
fn set_clipboard_text_win(text: &str) -> bool {
    use std::ffi::c_void;
    extern "system" {
        fn OpenClipboard(hWndNewOwner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(uFormat: u32, hMem: *mut c_void) -> *mut c_void;
        fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> *mut c_void;
        fn GlobalLock(hMem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(hMem: *mut c_void) -> i32;
        fn GlobalFree(hMem: *mut c_void) -> *mut c_void;
    }
    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = wide.len() * std::mem::size_of::<u16>();

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return false;
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            return false;
        }

        let handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if handle.is_null() {
            CloseClipboard();
            return false;
        }

        let ptr = GlobalLock(handle) as *mut u16;
        if ptr.is_null() {
            GlobalFree(handle);
            CloseClipboard();
            return false;
        }

        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
        GlobalUnlock(handle);

        // Ownership of the block transfers to the clipboard on success.
        if SetClipboardData(CF_UNICODETEXT, handle).is_null() {
            GlobalFree(handle);
            CloseClipboard();
            return false;
        }

        CloseClipboard();
        true
    }
}

#[cfg(not(target_os = "windows"))]
fn set_clipboard_text_win(_text: &str) -> bool {
    false
}

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        get_clipboard_text_win().ok_or_else(|| "Clipboard is empty or does not contain text".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported platform".to_string())
    }
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    if set_clipboard_text_win(&text) {
        Ok(())
    } else {
        Err("Could not write to the clipboard".to_string())
    }
}

fn execute_post_completion_action(action: &str, app: &AppHandle) {
    match action {
        "shutdown" => {
            eprintln!("[Rheow Scheduler] Executing post-completion shutdown...");
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("shutdown")
                    .args([
                        "/s",
                        "/t",
                        "60",
                        "/c",
                        "Rheow Scheduler: All downloads completed. Computer will shut down in 60 seconds.",
                    ])
                    .spawn();
            }
        }
        "sleep" => {
            eprintln!("[Rheow Scheduler] Executing post-completion sleep...");
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("rundll32.exe")
                    .args(["powrprof.dll,SetSuspendState", "0,1,0"])
                    .spawn();
            }
        }
        "quit" => {
            eprintln!("[Rheow Scheduler] Executing post-completion quit...");
            app.exit(0);
        }
        _ => {}
    }
}

async fn run_scheduler_loop(
    app: AppHandle,
    engine: Arc<EngineManager>,
    db: Arc<Database>,
    settings_state: Arc<tokio::sync::Mutex<settings::SchedulerSettings>>,
) {
    let mut last_minute_checked: Option<(u32, u32)> = None;
    let mut was_active_in_window = false;

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let settings = {
            let guard = settings_state.lock().await;
            guard.clone()
        };

        if !settings.enabled {
            was_active_in_window = false;
            continue;
        }

        let now = Local::now();
        let hour = now.hour();
        let minute = now.minute();
        let current_hm = format!("{:02}:{:02}", hour, minute);
        let weekday = now.weekday().number_from_monday() as u8;

        let is_active_day = settings.days.is_empty() || settings.days.contains(&weekday);
        if !is_active_day {
            continue;
        }

        let current_hm_str = current_hm.as_str();
        let is_new_minute = last_minute_checked != Some((hour, minute));

        // 1. Check START TIME
        if is_new_minute && current_hm_str == settings.start_time.as_str() {
            last_minute_checked = Some((hour, minute));
            was_active_in_window = true;
            eprintln!(
                "[Rheow Scheduler] Start time reached ({}), running queue...",
                current_hm
            );

            engine.set_queue_running(true);
            engine.process_next_queued(app.clone()).await;

            let _ = app.emit(
                "scheduler-event",
                serde_json::json!({
                    "type": "started",
                    "time": current_hm,
                    "message": "Scheduled download queue has started automatically."
                }),
            );
        }

        // 2. Check STOP TIME
        if is_new_minute && settings.stop_time.as_deref() == Some(current_hm_str) {
            last_minute_checked = Some((hour, minute));
            was_active_in_window = false;
            eprintln!(
                "[Rheow Scheduler] Stop time reached ({}), pausing queue...",
                current_hm
            );

            engine.set_queue_running(false);
            let _ = engine.pause_all_downloads(&app).await;

            let _ = app.emit(
                "scheduler-event",
                serde_json::json!({
                    "type": "stopped",
                    "time": current_hm,
                    "message": "Scheduled time ended. Queue has been paused."
                }),
            );

            execute_post_completion_action(&settings.action_on_finish, &app);
        }

        // 3. Check ALL COMPLETED during active scheduled session
        if was_active_in_window {
            let active_count = engine.active_downloads_count().await;
            let queued_items = db.get_next_queued_downloads(1).unwrap_or_default();
            if active_count == 0 && queued_items.is_empty() {
                was_active_in_window = false;
                eprintln!("[Rheow Scheduler] All queued downloads completed during scheduled window.");

                let _ = app.emit(
                    "scheduler-event",
                    serde_json::json!({
                        "type": "all_completed",
                        "time": current_hm,
                        "message": "All downloads in the scheduled queue have completed."
                    }),
                );

                execute_post_completion_action(&settings.action_on_finish, &app);
            }
        }
    }
}

fn dirs_downloads() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|p| p.join("Downloads"))
}

fn main() {
    let app_data_dir = dirs_downloads()
        .and_then(|p| p.parent().map(|u| u.join("AppData").join("Roaming").join("Rheow")))
        .unwrap_or_else(|| PathBuf::from("."));

    let _ = std::fs::create_dir_all(&app_data_dir);
    let db_path = app_data_dir.join("rheow.db");

    let db = Arc::new(Database::new(&db_path).expect("Failed to initialize Rheow SQLite database"));
    let engine = Arc::new(EngineManager::new(db.clone()));

    // Read desktop preferences before the builder starts so the tray/close
    // behaviour and the initial window visibility are correct from frame one.
    // "Keep running when window is closed" defaults to true on app launch.
    let mut startup_settings = db.get_engine_settings().unwrap_or_default().sanitized();
    startup_settings.close_to_tray = true;
    let close_to_tray = Arc::new(AtomicBool::new(startup_settings.close_to_tray));
    let close_to_tray_for_events = close_to_tray.clone();
    let start_hidden = startup_settings.start_minimized
        && std::env::args().any(|argument| argument == "--hidden");

    let startup_scheduler = db.get_scheduler_settings();
    let scheduler_settings = Arc::new(tokio::sync::Mutex::new(startup_scheduler));
    let scheduler_settings_for_state = scheduler_settings.clone();

    tauri::Builder::default()
        // Single-instance must be the first plugin: a second process has to be
        // detected before any other plugin or setup work runs.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Rheow")
                .arg("--hidden")
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Never restore visibility: a window hidden to the tray must
                // not come back hidden after a normal launch.
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            server::start_http_server(app.handle().clone());

            // Keep the tray handle alive for the whole process lifetime.
            let tray = build_tray(app.handle())?;
            app.manage(tray);

            if !start_hidden {
                show_main_window(app.handle());
            }

            // Downloads that were still running when the app last exited have
            // no worker any more. Demote them to paused and let the queue move
            // on, so nothing stays stuck on "downloading" forever.
            let handle = app.handle().clone();
            let app_state = app.state::<AppState>();
            let engine = app_state.engine.clone();
            let db = app_state.db.clone();

            // The updater owns its own state so React can stay a thin renderer.
            // It is managed here, after AppState, because it needs the database
            // and the engine to pause downloads and back up the database.
            let updater_state = updater::UpdaterState::new(db.clone(), engine.clone());
            app.manage(updater_state.clone());
            let updater_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                updater::run_background_loop(updater_state, updater_app).await;
            });

            let engine_for_recover = engine.clone();
            let handle_for_recover = handle.clone();
            tauri::async_runtime::spawn(async move {
                engine_for_recover.recover_after_restart(&handle_for_recover).await;
            });

            // Start background queue scheduler loop
            let scheduler_app = app.handle().clone();
            let scheduler_engine = engine.clone();
            let scheduler_db = db.clone();
            let scheduler_settings_clone = scheduler_settings.clone();
            tauri::async_runtime::spawn(async move {
                run_scheduler_loop(
                    scheduler_app,
                    scheduler_engine,
                    scheduler_db,
                    scheduler_settings_clone,
                )
                .await;
            });

            // Register notification action types:
            // "download-completed" with 2 actions: open_file, open_folder
            // "download-failed" with 2 actions: retry, refresh_link
            let action_types = vec![
                ActionType::builder("download-completed")
                    .actions(vec![
                        Action::builder("open_file", "Open File").build(),
                        Action::builder("open_folder", "Open Folder").build(),
                    ])
                    .build(),
                ActionType::builder("download-failed")
                    .actions(vec![
                        Action::builder("retry", "Retry").build(),
                        Action::builder("refresh_link", "Refresh Link").build(),
                    ])
                    .build(),
            ];
            let _ = app.handle().notification().register_action_types(action_types);

            // Register notification action listener
            let action_handle = handle.clone();
            let action_engine = engine.clone();
            let action_db = db.clone();

            let _ = app.handle().notification().on_action(move |performed| {
                match performed.action_id() {
                    "tap" => show_main_window(&action_handle),
                    "open_file" => {
                        if let Some(path) = notification_destination(performed, &action_db) {
                            open_path(&path);
                        }
                    }
                    "open_folder" => {
                        if let Some(path) = notification_destination(performed, &action_db) {
                            reveal_path(&path);
                        }
                    }
                    "retry" => {
                        if let Some(id) = notification_download_id(performed) {
                            let app_handle = action_handle.clone();
                            let eng = action_engine.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = eng.resume_download(&app_handle, &id).await;
                            });
                        }
                    }
                    "refresh_link" => {
                        if let Some(id) = notification_download_id(performed) {
                            show_main_window(&action_handle);
                            let _ = action_handle.emit("trigger-refresh-link", id);
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .on_window_event(move |window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_to_tray_for_events.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(AppState {
            db,
            engine,
            close_to_tray,
            scheduler_settings: scheduler_settings_for_state,
        })
        .invoke_handler(tauri::generate_handler![
            get_partitions,
            probe_download,
            get_default_destination,
            load_settings,
            save_settings,
            get_browser_integration_status,
            prepare_browser_extension,
            open_extension_folder,
            open_browser_for_extension,
            detect_browser_for_extension,
            copy_text_to_clipboard,
            add_and_start_download,
            resume_download,
            resume_downloads,
            pause_download,
            set_download_speed_limit,
            cancel_download,
            delete_download,
            redownload,
            pause_all_downloads,
            resume_all_downloads,
            start_queue,
            pause_queue,
            get_queue_status,
            get_queue_details,
            set_queue_max_concurrent,
            get_scheduler_settings,
            save_scheduler_settings,
            get_all_downloads,
            pick_destination_folder,
            open_file,
            open_folder,
            open_browser_url,
            update_download_url,
            read_clipboard_text,
            check_resume_support,
            updater::get_update_state,
            updater::check_for_update,
            updater::download_update,
            updater::install_update,
            updater::get_updater_settings,
            updater::save_updater_settings,
            updater::dismiss_update,
            updater::acknowledge_update_notes
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rheow application");
}

#[cfg(test)]
mod notification_action_tests {
    use super::*;

    fn action_performed(action_id: &str, extra: serde_json::Value) -> ActionPerformed {
        serde_json::from_value(serde_json::json!({
            "actionId": action_id,
            "inputValue": null,
            "notification": {
                "id": 1,
                "tag": null,
                "title": "Rheow Download Completed",
                "body": "body",
                "group": null,
                "groupSummary": false,
                "data": {},
                "extra": extra,
                "attachments": [],
                "actionTypeId": "download-completed",
                "schedule": null,
                "sound": null
            }
        }))
        .expect("ActionPerformed payload should deserialize")
    }

    fn record(id: &str, destination: &str) -> DownloadRecord {
        DownloadRecord {
            id: id.to_string(),
            url: "https://example.com/file.bin".to_string(),
            filename: "file.bin".to_string(),
            category: "Other".to_string(),
            destination_path: destination.to_string(),
            total_size: 1024,
            downloaded_size: 1024,
            speed: 0.0,
            eta_seconds: 0,
            status: "completed".to_string(),
            etag: None,
            last_modified: None,
            open_folder_on_finish: false,
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            cookie: None,
            referer: None,
            speed_limit_kb: None,
            segment_count: Some(1),
            supports_range: true,
            ..Default::default()
        }
    }

    fn test_db() -> (PathBuf, Database) {
        let dir = std::env::temp_dir().join(format!(
            "rheow-notification-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db = Database::new(&dir.join("test.db")).expect("test database");
        (dir, db)
    }

    #[test]
    fn reads_destination_and_download_id_from_extra() {
        let performed = action_performed(
            "open_file",
            serde_json::json!({
                "destination_path": r"D:\TES DOWNLOAD\Other\notify-action.bin",
                "download_id": "download-1"
            }),
        );

        assert_eq!(performed.action_id(), "open_file");
        assert_eq!(
            notification_download_id(&performed).as_deref(),
            Some("download-1")
        );
    }

    #[test]
    fn destination_falls_back_to_the_database() {
        let (dir, db) = test_db();
        let destination = r"D:\TES DOWNLOAD\Other\fallback.bin";
        db.insert_download(&record("download-2", destination))
            .expect("insert download");

        let performed = action_performed(
            "open_file",
            serde_json::json!({ "download_id": "download-2" }),
        );

        assert_eq!(
            notification_destination(&performed, &db).as_deref(),
            Some(destination)
        );

        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_payload_resolves_to_none() {
        let (dir, db) = test_db();
        let performed = action_performed("open_file", serde_json::json!({}));

        assert_eq!(notification_destination(&performed, &db), None);
        assert_eq!(notification_download_id(&performed), None);

        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod browser_detection_tests {
    use super::parse_prog_id;

    #[test]
    fn parses_prog_id_from_reg_output() {
        let output = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice\r\n    ProgId    REG_SZ    ChromeHTML\r\n\r\n";
        assert_eq!(parse_prog_id(output).as_deref(), Some("ChromeHTML"));
    }

    #[test]
    fn missing_prog_id_returns_none() {
        assert_eq!(parse_prog_id("no registry value here"), None);
    }
}
