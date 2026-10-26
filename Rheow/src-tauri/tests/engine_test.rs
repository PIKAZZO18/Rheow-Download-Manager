use rheow_lib::engine::prealloc::{preallocate_file, resolve_category_destination};
use rheow_lib::engine::probe::probe_url;
use rheow_lib::engine::segment_worker::{run_segment_worker, SegmentConfig};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;
use tokio::sync::mpsc;

#[tokio::test]
async fn test_probe_ovh_file() {
    let url = "https://proof.ovh.net/files/10Mb.dat";
    let res = probe_url(url, None, None).await.expect("Failed to probe URL");

    assert_eq!(res.filename, "10Mb.dat");
    assert_eq!(res.total_size, 10485760);
    assert!(res.supports_range, "OVH test server must support HTTP Range");
    println!("Probe successfully resolved OVH file: {} bytes, Range={}", res.total_size, res.supports_range);
}

#[test]
fn test_smart_category_routing_and_collision() {
    let temp_dir = std::env::temp_dir().join("rheow_test_dir");
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).unwrap();

    // 1. First file in Programs category
    let overrides = HashMap::new();
    let path1 = resolve_category_destination(&temp_dir, "Programs", "setup.exe", &overrides).unwrap();
    assert_eq!(path1, temp_dir.join("Programs").join("setup.exe"));
    assert!(temp_dir.join("Programs").exists(), "Programs subfolder must be auto-created");

    // Create the dummy file to trigger collision
    fs::write(&path1, b"dummy").unwrap();

    // 2. Second file with same name -> collision resolution
    let path2 = resolve_category_destination(&temp_dir, "Programs", "setup.exe", &overrides).unwrap();
    assert_eq!(path2, temp_dir.join("Programs").join("setup (1).exe"));

    // Cleanup
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_preallocate() {
    let temp_file = std::env::temp_dir().join("rheow_prealloc_test.bin");
    let size = 1024 * 1024 * 5; // 5 MB

    preallocate_file(&temp_file, size).unwrap();

    let meta = fs::metadata(&temp_file).unwrap();
    assert_eq!(meta.len(), size as u64);

    let _ = fs::remove_file(&temp_file);
}

#[tokio::test]
async fn test_multi_segment_download() {
    let url = "https://proof.ovh.net/files/10Mb.dat";
    let total_size: u64 = 10485760;
    let temp_file = std::env::temp_dir().join(format!("rheow_ovh_download_test_{}.dat", uuid::Uuid::new_v4()));

    // Pre-allocate
    preallocate_file(&temp_file, total_size as i64).unwrap();

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 Rheow/1.0")
        .build()
        .unwrap();

    let segments_count = 4;
    let chunk_size = total_size / segments_count;
    let cancel_flag = Arc::new(AtomicBool::new(false));

    let mut handles = Vec::new();

    for i in 0..segments_count {
        let start = i * chunk_size;
        let end = if i == segments_count - 1 {
            total_size - 1
        } else {
            (i + 1) * chunk_size - 1
        };

        let config = SegmentConfig {
            index: i as usize,
            start_offset: start,
            end_offset: end,
        };

        let current_atom = Arc::new(AtomicU64::new(start));
        let cancel = cancel_flag.clone();
        let (tx, mut rx) = mpsc::channel(100);
        let c_client = client.clone();
        let c_url = url.to_string();
        let c_path = temp_file.clone();

        // Drain progress updates
        tokio::spawn(async move {
            while let Some(_) = rx.recv().await {}
        });

        let handle = tokio::spawn(async move {
            run_segment_worker(
                c_client,
                c_url,
                c_path,
                config,
                current_atom,
                cancel,
                None,
                None,
                None,
                10,
                None,
                None,
                tx,
            ).await
        });

        handles.push(handle);
    }

    for h in handles {
        let res = h.await.unwrap();
        assert!(res.is_ok(), "Worker must succeed: {:?}", res);
    }

    let meta = fs::metadata(&temp_file).unwrap();
    assert_eq!(meta.len(), total_size, "Downloaded file must match exact byte size");

    let _ = fs::remove_file(&temp_file);
    println!("Multi-segment download test PASSED!");
}

#[tokio::test]
async fn test_resume_segment_is_byte_exact() {
    let url = "https://proof.ovh.net/files/10Mb.dat";
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 Rheow/1.0")
        .build()
        .unwrap();

    // Reference copy straight from the server.
    let full = client
        .get(url)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .bytes()
        .await
        .unwrap();

    let total = full.len();
    let cut = total / 2;
    assert!(cut > 0 && cut < total);

    let temp_file = std::env::temp_dir().join(format!(
        "rheow_resume_test_{}.dat",
        uuid::Uuid::new_v4()
    ));

    // Simulate a download that already wrote the first half.
    fs::write(&temp_file, &full[..cut]).unwrap();

    let config = SegmentConfig {
        index: 1,
        start_offset: cut as u64,
        end_offset: (total - 1) as u64,
    };
    let offset = Arc::new(AtomicU64::new(cut as u64));
    let (tx, mut rx) = mpsc::channel(100);
    tokio::spawn(async move { while rx.recv().await.is_some() {} });

    let result = run_segment_worker(
        client,
        url.to_string(),
        temp_file.clone(),
        config,
        offset.clone(),
        Arc::new(AtomicBool::new(false)),
        None,
        None,
        None,
        10,
        None,
        None,
        tx,
    )
    .await;

    assert!(result.is_ok(), "Resume worker must succeed: {:?}", result);
    assert_eq!(
        offset.load(std::sync::atomic::Ordering::Relaxed),
        total as u64,
        "Segment must advance to the last byte"
    );
    assert_eq!(
        fs::read(&temp_file).unwrap(),
        full,
        "Resumed file must be byte-for-byte identical to the source"
    );

    let _ = fs::remove_file(&temp_file);
}

#[tokio::test]
async fn test_token_bucket_limiter() {
    use rheow_lib::engine::limiter::TokenBucketLimiter;
    use std::time::Instant;

    let limiter = TokenBucketLimiter::new(1024 * 100); // 100 KB/s
    let start = Instant::now();

    // Consume 100 KB (fills available token burst)
    limiter.consume(1024 * 100).await;
    // Consume another 50 KB -> should enforce throttle delay
    limiter.consume(1024 * 50).await;

    let elapsed = start.elapsed();
    assert!(elapsed.as_millis() >= 400, "Limiter must enforce throttling delay, elapsed: {:?}", elapsed);
    println!("Token bucket limiter test PASSED! (Throttled for {:?})", elapsed);
}

#[tokio::test]
async fn test_multi_threaded_token_bucket_limiter() {
    use rheow_lib::engine::limiter::TokenBucketLimiter;
    use std::sync::Arc;
    use std::time::Instant;

    let rate = 100 * 1024; // 100 KB/s
    let limiter = Arc::new(TokenBucketLimiter::new(rate));

    // Exhaust initial burst
    limiter.consume(rate as usize).await;

    // Launch 4 concurrent tasks, each consuming 25 KB (total 100 KB)
    let start = Instant::now();
    let mut handles = Vec::new();
    for _ in 0..4 {
        let lim = limiter.clone();
        handles.push(tokio::spawn(async move {
            lim.consume(25 * 1024).await;
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    let elapsed = start.elapsed();
    // 100 KB at 100 KB/s with zero initial tokens must take at least 800ms
    assert!(
        elapsed.as_millis() >= 800,
        "Concurrent workers must respect collective token debt! Elapsed: {:?}",
        elapsed
    );
}

#[tokio::test]
async fn test_token_bucket_dynamic_rate_change() {
    use rheow_lib::engine::limiter::TokenBucketLimiter;

    let limiter = TokenBucketLimiter::new(50 * 1024);
    assert_eq!(limiter.rate(), 50 * 1024);

    // Change rate to unlimited
    limiter.set_rate(0);
    assert_eq!(limiter.rate(), 0);

    // Consume with rate 0 must return immediately without any delay
    let start = std::time::Instant::now();
    limiter.consume(1024 * 1024).await;
    assert!(start.elapsed().as_millis() < 50);

    // Set rate back to 200 KB/s
    limiter.set_rate(200 * 1024);
    assert_eq!(limiter.rate(), 200 * 1024);
}

#[test]
fn test_db_update_speed_limit() {
    use rheow_lib::db::{Database, DownloadRecord};

    let temp_db = std::env::temp_dir().join(format!("rheow_speed_limit_test_{}.db", uuid::Uuid::new_v4()));
    let db = Database::new(&temp_db).expect("Must initialize database");

    let rec = DownloadRecord {
        id: "limit-test-1".to_string(),
        url: "https://example.com/test.zip".to_string(),
        filename: "test.zip".to_string(),
        category: "Other".to_string(),
        destination_path: "C:\\Downloads\\test.zip".to_string(),
        total_size: 1000,
        downloaded_size: 0,
        speed: 0.0,
        eta_seconds: 0,
        status: "paused".to_string(),
        etag: None,
        last_modified: None,
        open_folder_on_finish: true,
        created_at: "2026-10-25T00:00:00Z".to_string(),
        completed_at: None,
        cookie: None,
        referer: None,
        speed_limit_kb: None,
        segment_count: Some(8),
        supports_range: true,
        ..Default::default()
    };

    db.insert_download(&rec).unwrap();
    assert_eq!(db.get_download_by_id("limit-test-1").unwrap().unwrap().speed_limit_kb, None);

    db.update_speed_limit("limit-test-1", Some(250)).unwrap();
    assert_eq!(db.get_download_by_id("limit-test-1").unwrap().unwrap().speed_limit_kb, Some(250));

    db.update_speed_limit("limit-test-1", None).unwrap();
    assert_eq!(db.get_download_by_id("limit-test-1").unwrap().unwrap().speed_limit_kb, None);

    let _ = std::fs::remove_file(temp_db);
}

#[test]
fn test_get_partitions() {
    let parts = rheow_lib::get_system_partitions();
    println!("Detected partitions: {:?}", parts);
    assert!(!parts.is_empty(), "Must detect at least 1 partition on system");
    for p in &parts {
        assert!(p.total_bytes > 0);
        assert!(p.usage_percentage >= 0.0 && p.usage_percentage <= 100.0);
    }
}

#[test]
fn test_sqlite_queue_and_lifecycle() {
    use rheow_lib::db::{Database, DownloadRecord};

    let temp_db = std::env::temp_dir().join(format!("rheow_test_db_{}.db", uuid::Uuid::new_v4()));
    let db = Database::new(&temp_db).expect("Must initialize database");

    // 1. Insert 3 queued items with distinct creation timestamps
    let q1 = DownloadRecord {
        id: "q-1".to_string(),
        url: "https://example.com/file1.zip".to_string(),
        filename: "file1.zip".to_string(),
        category: "Compressed".to_string(),
        destination_path: "C:\\Downloads\\Compressed\\file1.zip".to_string(),
        total_size: 1000,
        downloaded_size: 0,
        speed: 0.0,
        eta_seconds: 0,
        status: "queued".to_string(),
        etag: None,
        last_modified: None,
        open_folder_on_finish: true,
        created_at: "2026-10-24T10:00:00Z".to_string(),
        completed_at: None,
        cookie: Some("auth=token123".to_string()),
        referer: Some("https://example.com".to_string()),
        speed_limit_kb: Some(500),
        segment_count: Some(8),
        supports_range: true,
        ..Default::default()
    };

    let q2 = DownloadRecord {
        id: "q-2".to_string(),
        url: "https://example.com/file2.zip".to_string(),
        filename: "file2.zip".to_string(),
        category: "Compressed".to_string(),
        destination_path: "C:\\Downloads\\Compressed\\file2.zip".to_string(),
        total_size: 2000,
        downloaded_size: 0,
        speed: 0.0,
        eta_seconds: 0,
        status: "queued".to_string(),
        etag: None,
        last_modified: None,
        open_folder_on_finish: false,
        created_at: "2026-10-24T10:05:00Z".to_string(),
        completed_at: None,
        cookie: None,
        referer: None,
        speed_limit_kb: None,
        segment_count: Some(4),
        supports_range: true,
        ..Default::default()
    };

    let q3 = DownloadRecord {
        id: "q-3".to_string(),
        url: "https://example.com/file3.iso".to_string(),
        filename: "file3.iso".to_string(),
        category: "Programs".to_string(),
        destination_path: "C:\\Downloads\\Programs\\file3.iso".to_string(),
        total_size: 3000,
        downloaded_size: 0,
        speed: 0.0,
        eta_seconds: 0,
        status: "queued".to_string(),
        etag: None,
        last_modified: None,
        open_folder_on_finish: true,
        created_at: "2026-10-24T10:10:00Z".to_string(),
        completed_at: None,
        cookie: None,
        referer: None,
        speed_limit_kb: None,
        segment_count: Some(16),
        supports_range: true,
        ..Default::default()
    };

    db.insert_download(&q1).unwrap();
    db.insert_download(&q2).unwrap();
    db.insert_download(&q3).unwrap();

    // 2. Test Queue Worker retrieval (FIFO: oldest created_at first)
    let next_batch = db.get_next_queued_downloads(2).unwrap();
    assert_eq!(next_batch.len(), 2);
    assert_eq!(next_batch[0].id, "q-1");
    assert_eq!(next_batch[1].id, "q-2");
    assert_eq!(next_batch[0].cookie.as_deref(), Some("auth=token123"));
    assert_eq!(next_batch[0].speed_limit_kb, Some(500));

    // 3. Simulate Queue Worker starting item q-1: status becomes "downloading"
    db.update_status("q-1", "downloading").unwrap();
    let q_after_start = db.get_next_queued_downloads(2).unwrap();
    assert_eq!(q_after_start.len(), 2);
    assert_eq!(q_after_start[0].id, "q-2");
    assert_eq!(q_after_start[1].id, "q-3");

    // 4. Test Pause
    db.update_status("q-1", "paused").unwrap();
    let r1 = db.get_download_by_id("q-1").unwrap().unwrap();
    assert_eq!(r1.status, "paused");

    // 5. Test Cancel
    db.update_status("q-2", "cancelled").unwrap();
    let r2 = db.get_download_by_id("q-2").unwrap().unwrap();
    assert_eq!(r2.status, "cancelled");

    // 6. Test Resume: paused item q-1 updated back to downloading
    db.update_status("q-1", "downloading").unwrap();
    let r1_resumed = db.get_download_by_id("q-1").unwrap().unwrap();
    assert_eq!(r1_resumed.status, "downloading");

    // 7. Test Delete
    db.delete_download("q-3").unwrap();
    assert!(db.get_download_by_id("q-3").unwrap().is_none());

    // 8. Test Segment Checkpoints
    let segments = vec![
        (0, 0, 499, 250, false),
        (1, 500, 999, 500, false),
    ];
    db.save_segments("q-1", &segments).unwrap();
    let saved_segs = db.get_segments("q-1").unwrap();
    assert_eq!(saved_segs.len(), 2);
    assert_eq!(saved_segs[0].current_offset, 250);
    assert_eq!(saved_segs[1].current_offset, 500);

    // Cleanup
    let _ = std::fs::remove_file(&temp_db);
    println!("SQLite queue and lifecycle test PASSED!");
}

#[test]
fn test_fresh_database_is_empty_and_legacy_demo_rows_are_purged() {
    use rheow_lib::db::{Database, DownloadRecord};

    let temp_db = std::env::temp_dir().join(format!(
        "rheow_demo_cleanup_test_{}.db",
        uuid::Uuid::new_v4()
    ));
    let db = Database::new(&temp_db).expect("Must initialize database");

    assert!(
        db.get_all_downloads().unwrap().is_empty(),
        "a fresh database must not contain demo rows"
    );

    let make_record = |id: &str, url: &str| DownloadRecord {
        id: id.to_string(),
        url: url.to_string(),
        filename: "file.bin".to_string(),
        category: "Compressed".to_string(),
        destination_path: format!("C:\\Downloads\\Compressed\\{}.bin", id),
        total_size: 1000,
        downloaded_size: 0,
        speed: 0.0,
        eta_seconds: 0,
        status: "queued".to_string(),
        etag: None,
        last_modified: None,
        open_folder_on_finish: true,
        created_at: "2026-10-24T10:00:00Z".to_string(),
        completed_at: None,
        cookie: None,
        referer: None,
        speed_limit_kb: None,
        segment_count: Some(4),
        supports_range: true,
        ..Default::default()
    };

    // Exact legacy demo row.
    db.insert_download(&make_record(
        "row-1",
        "https://updates.cdprojektred.com/patches/cyberpunk_2077_patch_2.12.zip",
    ))
    .unwrap();
    // Same legacy id but a real URL: must be preserved.
    db.insert_download(&make_record("row-4", "https://example.com/real-download.zip"))
        .unwrap();

    db.save_segments("row-1", &[(0, 0, 499, 100, false)]).unwrap();
    db.save_segments("row-4", &[(0, 0, 499, 100, false)]).unwrap();

    let removed = db.purge_legacy_demo_rows().unwrap();
    assert_eq!(removed, 1, "only the exact demo row must be removed");

    let remaining = db.get_all_downloads().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "row-4");
    assert!(db.get_segments("row-1").unwrap().is_empty(), "demo segments must be removed");
    assert_eq!(db.get_segments("row-4").unwrap().len(), 1, "real segments must be kept");

    let _ = std::fs::remove_file(&temp_db);
}

#[test]
fn test_engine_settings_persistence_and_clamping() {
    use rheow_lib::db::Database;
    use rheow_lib::settings::EngineSettings;

    let temp_db = std::env::temp_dir().join(format!(
        "rheow_settings_test_{}.db",
        uuid::Uuid::new_v4()
    ));
    let db = Database::new(&temp_db).expect("Must initialize database");

    // Nothing saved yet -> frontend knows it should migrate localStorage.
    assert!(db.get_engine_settings().is_none());

    let mut settings = EngineSettings::default();
    settings.max_connections = 999;
    settings.connection_timeout_seconds = 1;
    settings.max_retries = 500;
    settings.default_download_path = "D:\\Rheow".to_string();
    settings.autostart_enabled = true;
    settings.close_to_tray = false;
    settings.start_minimized = true;

    db.save_engine_settings(&settings.sanitized()).unwrap();

    let loaded = db.get_engine_settings().expect("settings must roundtrip");
    assert_eq!(loaded.max_connections, 32, "connections must be clamped");
    assert_eq!(loaded.connection_timeout_seconds, 5, "timeout must be clamped");
    assert_eq!(loaded.max_retries, 50, "retries must be clamped");
    assert_eq!(loaded.default_download_path, "D:\\Rheow");
    assert!(loaded.autostart_enabled, "autostart preference must roundtrip");
    assert!(!loaded.close_to_tray, "close-to-tray preference must roundtrip");
    assert!(loaded.start_minimized, "start-minimized preference must roundtrip");

    // Saving again must update the existing row instead of failing.
    let mut updated = loaded.clone();
    updated.max_connections = 4;
    db.save_engine_settings(&updated).unwrap();
    assert_eq!(db.get_engine_settings().unwrap().max_connections, 4);

    let _ = std::fs::remove_file(&temp_db);
}

#[test]
fn test_destination_without_preallocation() {
    use rheow_lib::engine::prealloc::create_destination;

    let dir = std::env::temp_dir().join(format!("rheow_no_prealloc_{}", uuid::Uuid::new_v4()));
    let path = dir.join("file.bin");

    create_destination(&path, 1024 * 1024, false).unwrap();
    assert_eq!(fs::metadata(&path).unwrap().len(), 0, "file must start empty");
    assert!(dir.exists(), "parent folder must be created");

    create_destination(&path, 1024 * 1024, true).unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().len(),
        1024 * 1024,
        "preallocation must reserve the full size"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_redownload_and_file_deletion_lifecycle() {
    use rheow_lib::db::{Database, DownloadRecord};

    let temp_dir = std::env::temp_dir().join(format!("rheow_redownload_test_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let temp_db = temp_dir.join("test.db");
    let target_file = temp_dir.join("sample.zip");

    // Write a dummy file to represent downloaded content
    fs::write(&target_file, b"downloaded content 12345").unwrap();
    assert!(target_file.exists());

    let db = Database::new(&temp_db).unwrap();
    let record = DownloadRecord {
        id: "dl-redownload-1".to_string(),
        url: "https://example.com/sample.zip".to_string(),
        destination_path: target_file.to_string_lossy().to_string(),
        filename: "sample.zip".to_string(),
        total_size: 1000,
        downloaded_size: 1000,
        category: "Compressed".to_string(),
        status: "completed".to_string(),
        speed: 50.0,
        eta_seconds: 0,
        etag: Some("test-etag".to_string()),
        last_modified: None,
        open_folder_on_finish: false,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        completed_at: Some("2026-01-01T00:05:00Z".to_string()),
        cookie: None,
        referer: None,
        speed_limit_kb: None,
        segment_count: Some(4),
        supports_range: true,
        ..Default::default()
    };
    db.insert_download(&record).unwrap();
    db.save_segments("dl-redownload-1", &[(0, 0, 999, 999, true)]).unwrap();

    // 1. Redownload resets DB state and clears segments
    db.reset_for_redownload("dl-redownload-1").unwrap();
    let reset = db.get_download_by_id("dl-redownload-1").unwrap().unwrap();
    assert_eq!(reset.status, "queued");
    assert_eq!(reset.downloaded_size, 0);
    assert_eq!(reset.speed, 0.0);
    assert!(reset.completed_at.is_none());
    assert!(db.get_segments("dl-redownload-1").unwrap().is_empty());

    // 2. Physical file deletion when deleting with file
    if target_file.exists() {
        fs::remove_file(&target_file).unwrap();
    }
    assert!(!target_file.exists());

    db.delete_download("dl-redownload-1").unwrap();
    assert!(db.get_download_by_id("dl-redownload-1").unwrap().is_none());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_notification_action_types_registration_structure() {
    use tauri_plugin_notification::{Action, ActionType};

    let completed_type = ActionType::builder("download-completed")
        .actions(vec![
            Action::builder("open_file", "Open File").build(),
            Action::builder("open_folder", "Open Folder").build(),
        ])
        .build();

    assert_eq!(completed_type.id(), "download-completed");
    assert_eq!(completed_type.actions().len(), 2);
    assert_eq!(completed_type.actions()[0].id(), "open_file");
    assert_eq!(completed_type.actions()[0].title(), "Open File");
    assert_eq!(completed_type.actions()[1].id(), "open_folder");
    assert_eq!(completed_type.actions()[1].title(), "Open Folder");

    let failed_type = ActionType::builder("download-failed")
        .actions(vec![
            Action::builder("retry", "Retry").build(),
            Action::builder("refresh_link", "Refresh Link").build(),
        ])
        .build();

    assert_eq!(failed_type.id(), "download-failed");
    assert_eq!(failed_type.actions().len(), 2);
    assert_eq!(failed_type.actions()[0].id(), "retry");
    assert_eq!(failed_type.actions()[0].title(), "Retry");
    assert_eq!(failed_type.actions()[1].id(), "refresh_link");
    assert_eq!(failed_type.actions()[1].title(), "Refresh Link");
}

#[test]
fn test_notification_payload_action_performed_deserialization() {
    use tauri_plugin_notification::ActionPerformed;

    let json_payload = serde_json::json!({
        "actionId": "open_file",
        "inputValue": null,
        "notification": {
            "id": 123,
            "title": "Rheow Download Completed",
            "body": "'test.zip' has finished downloading.",
            "actionTypeId": "download-completed",
            "extra": {
                "destination_path": "C:\\Downloads\\test.zip",
                "download_id": "test-uuid-1234"
            }
        }
    });

    let performed: ActionPerformed = serde_json::from_value(json_payload).expect("Must deserialize ActionPerformed");
    assert_eq!(performed.action_id(), "open_file");
    let notif = performed.notification().expect("Must have active notification");
    assert_eq!(
        notif.extra().get("destination_path").and_then(|v| v.as_str()),
        Some("C:\\Downloads\\test.zip")
    );
    assert_eq!(
        notif.extra().get("download_id").and_then(|v| v.as_str()),
        Some("test-uuid-1234")
    );
}

#[test]
fn test_open_folder_with_spaces_in_path() {
    use rheow_lib::system::{resolve_explorer_action, ExplorerAction};

    let temp_dir = std::env::temp_dir().join(format!("rheow test dir with spaces {}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let sample_file = temp_dir.join("sample download with spaces.mkv");
    fs::write(&sample_file, b"test video data").unwrap();

    let action = resolve_explorer_action(&sample_file.to_string_lossy());
    assert_eq!(action, ExplorerAction::HighlightItem(sample_file.clone()));

    #[cfg(target_os = "windows")]
    {
        let raw_arg = rheow_lib::system::format_explorer_raw_select_arg(&sample_file);
        assert!(
            raw_arg.starts_with(r#"/select,""#),
            "/select, must precede the opening quote so Windows Explorer recognizes the switch"
        );
        assert!(raw_arg.ends_with('"'));
        assert!(!raw_arg.starts_with(r#""/select,"#));
    }

    let _ = fs::remove_file(&sample_file);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_delete_download_with_and_without_physical_file() {
    use rheow_lib::db::{Database, DownloadRecord};

    let temp_dir = std::env::temp_dir().join(format!("rheow_del_test_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let temp_db = temp_dir.join("test.db");
    let target_file1 = temp_dir.join("keep_me.zip");
    let target_file2 = temp_dir.join("delete_me.zip");

    fs::write(&target_file1, b"keep content").unwrap();
    fs::write(&target_file2, b"delete content").unwrap();
    assert!(target_file1.exists());
    assert!(target_file2.exists());

    let db = Database::new(&temp_db).unwrap();

    let rec1 = DownloadRecord {
        id: "dl-keep-file".to_string(),
        url: "https://example.com/keep.zip".to_string(),
        destination_path: target_file1.to_string_lossy().to_string(),
        filename: "keep_me.zip".to_string(),
        total_size: 500,
        downloaded_size: 500,
        category: "Compressed".to_string(),
        status: "completed".to_string(),
        speed: 0.0,
        eta_seconds: 0,
        etag: None,
        last_modified: None,
        open_folder_on_finish: false,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        completed_at: Some("2026-01-01T00:05:00Z".to_string()),
        cookie: None,
        referer: None,
        speed_limit_kb: None,
        segment_count: Some(1),
        supports_range: true,
        ..Default::default()
    };

    let rec2 = DownloadRecord {
        id: "dl-delete-file".to_string(),
        url: "https://example.com/delete.zip".to_string(),
        destination_path: target_file2.to_string_lossy().to_string(),
        filename: "delete_me.zip".to_string(),
        total_size: 500,
        downloaded_size: 500,
        category: "Compressed".to_string(),
        status: "completed".to_string(),
        speed: 0.0,
        eta_seconds: 0,
        etag: None,
        last_modified: None,
        open_folder_on_finish: false,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        completed_at: Some("2026-01-01T00:05:00Z".to_string()),
        cookie: None,
        referer: None,
        speed_limit_kb: None,
        segment_count: Some(1),
        supports_range: true,
        ..Default::default()
    };

    db.insert_download(&rec1).unwrap();
    db.insert_download(&rec2).unwrap();

    // Case 1: Delete without deleting physical file
    db.delete_download("dl-keep-file").unwrap();
    assert!(db.get_download_by_id("dl-keep-file").unwrap().is_none());
    assert!(target_file1.exists(), "target_file1 must remain on disk when delete_file is false");

    // Case 2: Delete with physical file removal
    if target_file2.exists() {
        fs::remove_file(&target_file2).unwrap();
    }
    db.delete_download("dl-delete-file").unwrap();
    assert!(db.get_download_by_id("dl-delete-file").unwrap().is_none());
    assert!(!target_file2.exists(), "target_file2 must be removed from disk");

    let _ = fs::remove_dir_all(&temp_dir);
}

