use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};

/// Built-in subfolder for a category when the user has not overridden it.
pub fn default_subfolder(category: &str) -> &'static str {
    match category {
        "Compressed" => "Compressed",
        "Programs" => "Programs",
        "Video" => "Video",
        "Documents" => "Documents",
        "Music" => "Music",
        _ => "General",
    }
}

pub fn resolve_category_destination(
    base_dir: &Path,
    category: &str,
    filename: &str,
    overrides: &HashMap<String, String>,
) -> std::io::Result<PathBuf> {
    // 1. Resolve the destination folder: user override (relative or absolute),
    //    no subfolder at all, or the built-in category name.
    let target_dir = match overrides.get(category) {
        Some(value) => {
            let value = value.trim();
            if value.is_empty() {
                base_dir.to_path_buf()
            } else {
                let path = Path::new(value);
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    base_dir.join(path)
                }
            }
        }
        None => base_dir.join(default_subfolder(category)),
    };

    // 2. Requirement: If folder exists, use it directly. If not, auto-create it!
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)?;
    }

    // 3. Resolve filename collision safely (e.g. filename (1).ext)
    let final_path = resolve_collision(&target_dir, filename);

    Ok(final_path)
}

fn resolve_collision(dir: &Path, filename: &str) -> PathBuf {
    let mut candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    let mut counter = 1;
    while candidate.exists() {
        let new_name = format!("{} ({}){}", stem, counter, ext);
        candidate = dir.join(new_name);
        counter += 1;
    }

    candidate
}

pub fn preallocate_file(path: &Path, total_size: i64) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if total_size <= 0 {
        File::create(path)?;
        return Ok(());
    }

    let file = File::options().create(true).write(true).open(path)?;
    if file.metadata()?.len() != total_size as u64 {
        file.set_len(total_size as u64)?;
    }
    Ok(())
}

/// Discards any previous bytes before allocating the full file size.
/// Used when a resume attempt is rejected because the remote file changed.
pub fn truncate_and_preallocate(path: &Path, total_size: i64) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let file = File::options()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)?;

    if total_size > 0 {
        file.set_len(total_size as u64)?;
    }
    Ok(())
}

/// Prepares a brand-new destination file. When preallocation is disabled the
/// file is created empty and grows as segments write to their offsets.
pub fn create_destination(
    path: &Path,
    total_size: i64,
    preallocate: bool,
) -> std::io::Result<()> {
    if preallocate {
        truncate_and_preallocate(path, total_size)
    } else {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        File::options()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;
        Ok(())
    }
}

/// Opens an existing destination file for a resumed download.
pub fn ensure_destination(
    path: &Path,
    total_size: i64,
    preallocate: bool,
) -> std::io::Result<()> {
    if preallocate {
        preallocate_file(path, total_size)
    } else {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        File::options().create(true).write(true).open(path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "rheow-prealloc-{}-{}-{}",
            tag,
            std::process::id(),
            nanos
        ))
    }

    #[test]
    fn resolves_builtin_relative_absolute_and_empty_subfolders() {
        let base = unique_dir("base");
        let absolute = unique_dir("absolute");
        let mut overrides = HashMap::new();

        // Built-in default for a category without an override.
        let default_path =
            resolve_category_destination(&base, "Other", "note.bin", &overrides).unwrap();
        assert_eq!(default_path, base.join("General").join("note.bin"));

        // Relative override is joined to the base folder and created.
        overrides.insert("Video".to_string(), "Media\\Films".to_string());
        let relative_path =
            resolve_category_destination(&base, "Video", "movie.mp4", &overrides).unwrap();
        assert_eq!(relative_path, base.join("Media\\Films").join("movie.mp4"));
        assert!(relative_path.parent().unwrap().is_dir());

        // Absolute override ignores the base folder.
        overrides.insert(
            "Music".to_string(),
            absolute.to_string_lossy().to_string(),
        );
        let absolute_path =
            resolve_category_destination(&base, "Music", "song.mp3", &overrides).unwrap();
        assert_eq!(absolute_path, absolute.join("song.mp3"));
        assert!(absolute_path.parent().unwrap().is_dir());

        // Empty override means "write directly into the base folder".
        overrides.insert("Documents".to_string(), "   ".to_string());
        let flat_path =
            resolve_category_destination(&base, "Documents", "report.pdf", &overrides).unwrap();
        assert_eq!(flat_path, base.join("report.pdf"));

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&absolute);
    }
}
