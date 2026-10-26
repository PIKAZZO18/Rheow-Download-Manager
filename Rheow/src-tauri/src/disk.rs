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
        for i in 0..26 {
            if (drives & (1 << i)) != 0 {
                let letter = (b'A' + i) as char;
                let root_str = format!("{}:\\\0", letter);
                let wide: Vec<u16> = root_str.encode_utf16().collect();
                let drive_type = GetDriveTypeW(wide.as_ptr());

                // DRIVE_FIXED = 3, DRIVE_REMOVABLE = 2
                if drive_type == 3 || drive_type == 2 {
                    let mut free_avail: u64 = 0;
                    let mut total: u64 = 0;
                    let mut free_total: u64 = 0;
                    if GetDiskFreeSpaceExW(
                        wide.as_ptr(),
                        &mut free_avail,
                        &mut total,
                        &mut free_total,
                    ) != 0 && total > 0 {
                        let used = total.saturating_sub(free_avail);
                        let usage_pct = (used as f64 / total as f64) * 100.0;

                        let drive_label = if letter == 'C' {
                            format!("Local SSD ({}:)", letter)
                        } else {
                            format!("Local Disk ({}:)", letter)
                        };

                        let free_display = format!("{} free", format_disk_size(free_avail));
                        let used_display = format!("{} / {} used", format_disk_size(used), format_disk_size(total));

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
            }
        }
    }
    list
}

#[cfg(not(windows))]
pub fn get_system_partitions() -> Vec<PartitionInfo> {
    vec![
        PartitionInfo {
            letter: "C:".to_string(),
            name: "Local SSD (C:)".to_string(),
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
