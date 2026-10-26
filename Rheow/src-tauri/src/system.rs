use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum ExplorerAction {
    /// Open the directory directly
    OpenDirectory(PathBuf),
    /// Highlight the item inside its parent folder
    HighlightItem(PathBuf),
}

/// Resolves what action to take when opening an Explorer window for `path`.
pub fn resolve_explorer_action(path: &str) -> ExplorerAction {
    let clean = path.trim().trim_matches('"').trim();
    if clean.is_empty() {
        return ExplorerAction::OpenDirectory(crate::settings::default_downloads_dir());
    }

    #[cfg(target_os = "windows")]
    let clean_path = clean.replace('/', "\\");
    #[cfg(not(target_os = "windows"))]
    let clean_path = clean.to_string();

    let p = PathBuf::from(&clean_path);

    if p.exists() {
        if p.is_dir() {
            ExplorerAction::OpenDirectory(p)
        } else {
            ExplorerAction::HighlightItem(p)
        }
    } else {
        // Target does not exist yet (in progress, queued, or deleted).
        // Try opening its parent directory.
        let folder = p.parent().unwrap_or(&p).to_path_buf();
        if !folder.exists() {
            let _ = std::fs::create_dir_all(&folder);
        }

        if folder.exists() {
            ExplorerAction::OpenDirectory(folder)
        } else {
            let fallback = crate::settings::default_downloads_dir();
            if !fallback.exists() {
                let _ = std::fs::create_dir_all(&fallback);
            }
            ExplorerAction::OpenDirectory(fallback)
        }
    }
}

/// Formats the raw argument for Windows Explorer file selection.
///
/// Under Windows Explorer command-line rules, `/select,` must precede the path
/// and cannot be wrapped inside double quotes. If a path contains spaces,
/// quotes must wrap only the path portion: `/select,"C:\path with spaces\file.ext"`.
#[cfg(target_os = "windows")]
pub fn format_explorer_raw_select_arg(path: &Path) -> String {
    format!("/select,\"{}\"", path.to_string_lossy())
}

/// Safely open a folder or highlight an item in the file manager.
///
/// On Windows:
/// Uses `raw_arg` when highlighting a file so that Rust's process launcher does
/// not enclose `/select,` inside quotes when the path has spaces. Wrapping `/select,`
/// in quotes breaks Windows Explorer's command line parsing, causing it to fall
/// back to opening the user's Documents folder.
pub fn open_folder_or_select(path: &str) -> Result<(), String> {
    let action = resolve_explorer_action(path);

    match action {
        ExplorerAction::OpenDirectory(dir) => {
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("explorer")
                    .arg(&dir)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            #[cfg(not(target_os = "windows"))]
            {
                std::process::Command::new("xdg-open")
                    .arg(&dir)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
        }
        ExplorerAction::HighlightItem(item) => {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let mut cmd = std::process::Command::new("explorer");
                cmd.raw_arg(format_explorer_raw_select_arg(&item));
                cmd.spawn().map_err(|e| e.to_string())?;
                Ok(())
            }
            #[cfg(not(target_os = "windows"))]
            {
                let folder = item.parent().unwrap_or(&item);
                std::process::Command::new("xdg-open")
                    .arg(folder)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
        }
    }
}

/// Safely open a file using the operating system's default handler.
pub fn open_file_native(path: &str) -> Result<(), String> {
    let clean = path.trim().trim_matches('"').trim();
    #[cfg(target_os = "windows")]
    let clean_path = clean.replace('/', "\\");
    #[cfg(not(target_os = "windows"))]
    let clean_path = clean.to_string();

    let p = Path::new(&clean_path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", clean_path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_format_explorer_raw_select_arg() {
        #[cfg(target_os = "windows")]
        {
            let p = Path::new(r"D:\TES DOWNLOAD\Video\movie.mkv");
            let arg = format_explorer_raw_select_arg(p);
            assert_eq!(arg, r#"/select,"D:\TES DOWNLOAD\Video\movie.mkv""#);
            // Verify that /select, is NOT inside quotes
            assert!(arg.starts_with(r#"/select,""#));
            assert!(arg.ends_with('"'));
        }
    }

    #[test]
    fn test_resolve_explorer_action_existing_file() {
        let temp_dir = std::env::temp_dir().join(format!("rheow_sys_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("test file with spaces.bin");
        fs::write(&file_path, b"data").unwrap();

        let action = resolve_explorer_action(&file_path.to_string_lossy());
        assert_eq!(action, ExplorerAction::HighlightItem(file_path.clone()));

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_explorer_action_existing_directory() {
        let temp_dir = std::env::temp_dir().join(format!("rheow_sys_dir_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();

        let action = resolve_explorer_action(&temp_dir.to_string_lossy());
        assert_eq!(action, ExplorerAction::OpenDirectory(temp_dir.clone()));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_explorer_action_nonexistent_file_opens_parent_dir() {
        let temp_dir = std::env::temp_dir().join(format!("rheow_sys_nonexist_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let target_file = temp_dir.join("not_downloaded_yet.zip");

        let action = resolve_explorer_action(&target_file.to_string_lossy());
        assert_eq!(action, ExplorerAction::OpenDirectory(temp_dir.clone()));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_explorer_action_empty_path_falls_back_to_downloads() {
        let action = resolve_explorer_action("");
        match action {
            ExplorerAction::OpenDirectory(p) => {
                assert!(!p.as_os_str().is_empty());
            }
            _ => panic!("Expected OpenDirectory for empty path"),
        }
    }
}
