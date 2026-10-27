use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PartitionInfo {
    pub letter: String,
    pub name: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
    pub free_display: String,
    pub used_display: String,
    pub usage_percentage: f64,
}

const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;

/// Turns the bitmask returned by `GetLogicalDrives` into drive letters.
fn drive_letters(mask: u32) -> Vec<char> {
    (0..26u8)
        .filter(|index| mask & (1 << index) != 0)
        .map(|index| (b'A' + index) as char)
        .collect()
}

/// Explorer-style display name: the real volume label when the drive has one,
/// otherwise a type-based fallback such as `Local Disk (D:)` or `USB Drive (E:)`.
fn partition_display_name(label: &str, letter: char, drive_type: u32) -> String {
    let label = label.trim();
    if !label.is_empty() {
        format!("{label} ({letter}:)")
    } else if drive_type == DRIVE_REMOVABLE {
        format!("USB Drive ({letter}:)")
    } else {
        format!("Local Disk ({letter}:)")
    }
}

#[cfg(windows)]
pub fn get_system_partitions() -> Vec<PartitionInfo> {
    extern "system" {
        fn GetLogicalDrives() -> u32;
        fn GetDriveTypeW(lpRootPathName: *const u16) -> u32;
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let mut list = Vec::new();
    unsafe {
        let drives = GetLogicalDrives();
        for letter in drive_letters(drives) {
            let root_str = format!("{}:\\\0", letter);
            let wide: Vec<u16> = root_str.encode_utf16().collect();
            let drive_type = GetDriveTypeW(wide.as_ptr());

            // Local and removable volumes only; network and optical drives are
            // not reliable download destinations.
            if drive_type != DRIVE_FIXED && drive_type != DRIVE_REMOVABLE {
                continue;
            }

            let mut free_avail: u64 = 0;
            let mut total: u64 = 0;
            let mut free_total: u64 = 0;
            if GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_avail,
                &mut total,
                &mut free_total,
            ) == 0
                || total == 0
            {
                continue;
            }

            let used = total.saturating_sub(free_avail);
            let usage_pct = (used as f64 / total as f64) * 100.0;
            let drive_label =
                partition_display_name(&volume_label(wide.as_ptr()), letter, drive_type);

            let free_display = format!("{} free", format_disk_size(free_avail));
            let used_display = format!(
                "{} / {} used",
                format_disk_size(used),
                format_disk_size(total)
            );

            list.push(PartitionInfo {
                letter: format!("{}:", letter),
                name: drive_label,
                total_bytes: total,
                free_bytes: free_avail,
                used_bytes: used,
                free_display,
                used_display,
                usage_percentage: usage_pct.min(100.0),
            });
        }
    }
    list
}

/// Reads the volume label Explorer shows next to the drive letter. Empty when
/// the volume has no label or cannot be queried (for example BitLocker locked).
#[cfg(windows)]
fn volume_label(root: *const u16) -> String {
    extern "system" {
        fn GetVolumeInformationW(
            lpRootPathName: *const u16,
            lpVolumeNameBuffer: *mut u16,
            nVolumeNameSize: u32,
            lpVolumeSerialNumber: *mut u32,
            lpMaximumComponentLength: *mut u32,
            lpFileSystemFlags: *mut u32,
            lpFileSystemNameBuffer: *mut u16,
            nFileSystemNameSize: u32,
        ) -> i32;
    }

    let mut buffer = [0u16; 261];
    let ok = unsafe {
        GetVolumeInformationW(
            root,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return String::new();
    }

    let len = buffer
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len]).trim().to_string()
}

#[cfg(not(windows))]
pub fn get_system_partitions() -> Vec<PartitionInfo> {
    vec![
        PartitionInfo {
            letter: "C:".to_string(),
            name: "Local Disk (C:)".to_string(),
            total_bytes: 1_000_000_000_000,
            free_bytes: 348_000_000_000,
            used_bytes: 652_000_000_000,
            free_display: "348 GB free".to_string(),
            used_display: "652 GB / 1.0 TB used".to_string(),
            usage_percentage: 65.2,
        }
    ]
}

fn format_disk_size(bytes: u64) -> String {
    let gb = bytes as f64 / (1024.0 * 1024.0 * 1024.0);
    if gb >= 950.0 {
        let tb = gb / 1024.0;
        format!("{:.1} TB", tb)
    } else if gb >= 1.0 {
        format!("{:.0} GB", gb)
    } else {
        let mb = bytes as f64 / (1024.0 * 1024.0);
        format!("{:.0} MB", mb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_letters_lists_every_lettered_volume() {
        // C:, D:, E:, and F: set in the bitmask returned by GetLogicalDrives.
        let mask = (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
        assert_eq!(drive_letters(mask), vec!['C', 'D', 'E', 'F']);
    }

    #[test]
    fn partition_name_uses_the_real_volume_label() {
        assert_eq!(partition_display_name("OS", 'C', DRIVE_FIXED), "OS (C:)");
        assert_eq!(
            partition_display_name("New Volume", 'D', DRIVE_FIXED),
            "New Volume (D:)"
        );
        assert_eq!(
            partition_display_name("  Backup  ", 'E', DRIVE_FIXED),
            "Backup (E:)"
        );
    }

    #[test]
    fn partition_name_falls_back_when_the_label_is_missing() {
        assert_eq!(
            partition_display_name("", 'E', DRIVE_FIXED),
            "Local Disk (E:)"
        );
        assert_eq!(
            partition_display_name("   ", 'F', DRIVE_REMOVABLE),
            "USB Drive (F:)"
        );
    }
}
