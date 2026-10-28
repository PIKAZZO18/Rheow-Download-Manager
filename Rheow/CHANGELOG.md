# Changelog

All notable changes to Rheow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Replaced the bulk "Cancel" button in the download table with a bulk "Delete" action, allowing removal of all selected downloads at once.
- Added a bulk delete confirmation modal showing selected item count, total download size, preview list of items, and an option to also delete downloaded files from disk.
- Updates now appear in a notification in the bottom-right corner with the new version and its release notes. Clicking it opens **Settings → Updates**.
- After Rheow restarts on a new version, a one-time **What's new** window shows that version's changelog.

### Changed

- Made the download table selection toolbar fluidly responsive, ensuring Pause, Resume, Delete, and Clear selection controls remain fully visible without horizontal clipping at 1000×600.
- Streamlined the browser extension setup wizard into a unified 2-step flow, eliminating the duplicate extension folder path box and redundant intermediate screen.
- Combined the extensions address bar and browser launch button into a single compact toolbar in the setup wizard, and the first step now tells you to click that button instead of copying the address.
- Removed repetitive setup subtitle copy and redundant bridge security note from the browser integration wizard for a cleaner, high-focus layout.
- Removed the redundant static "Connect the extension" instruction card from the Settings Browser tab in favor of the interactive guided setup wizard.
- The setup wizard detects the default browser and labels the button with it. Clicking it opens a new browser window that lands directly on the extensions page (`chrome://extensions`, `edge://extensions`, and so on), without touching the clipboard or any browser window you already had open.

### Fixed

- The **Browser** settings tab no longer reports **Connected** after the extension is removed. The bridge now trusts the extension only while its once-a-minute heartbeat is recent, and the tab refreshes the status on its own while open.
- The sidebar drive cards now use each volume's real label (for example **OS (C:)** and **New Volume (D:)**) and list every local or removable drive, instead of a fixed two-drive placeholder.
- Hardened the local HTTP bridge against cross-extension abuse by requiring a per-installation authentication token (`X-Rheow-Token`) shared with the unpacked extension via `auth.json`.
- Blocked arbitrary command execution when opening browser links by restricting `open_browser_url` strictly to `http://` and `https://` URLs.
- Sanitized filenames in destination path resolution to prevent directory traversal (`..`) outside the designated category download folders.
- Bounded Windows clipboard text memory reads with `GlobalSize` to prevent out-of-bounds scanning on non-null-terminated clipboard data.

## [1.0.2] - 2026-10-27

### Added

- Automatic update checks shortly after startup and every 24 hours, plus a
  **Check for Update** button in **Settings → Updates**.
- A confirmation in **Settings → Updates** when Rheow is already running the
  latest version.
- An in-app update banner with release notes and explicit **Download** and
  **Install now** actions. Rheow never downloads or installs an update silently.
- Signed update verification before installation, and a verified database
  backup in `%APPDATA%\Rheow\backups` before every install.
- A prompt that offers **Pause All & Install** or **Later** when downloads are
  still active, so an update never interrupts a transfer without consent.

### Fixed

- Download throughput no longer collapses to the slowest connection when
  parallel connections have different speeds. Fast connections now claim new
  work instead of idling on a fixed byte range.
- The live speed readout no longer adds a decorative ±0.55% oscillation; it now
  shows the smoothed measured throughput only.
- The active-download card keeps every visual lane moving while chunks are
  scheduled dynamically.

### Changed

- Downloads are split into 1 MiB work-queue chunks (up to 256 per file) served
  by a fixed worker pool capped at the configured connection count.
- The download info modal now labels connections as "parallel streams".
- New installs use a per-user NSIS installer, so updating no longer requires
  administrator rights. Existing per-machine installs need one manual
  uninstall/reinstall to move to the per-user layout.
- The **Updates** settings tab and update banner are more compact: repeated
  status text, the channel badge, and a duplicate dismiss button were removed.
- The Local Bridge card no longer shows the request counter and last-request
  line, and the Updates tab no longer shows the signature and database-backup
  footer.
- The Connection tab no longer repeats the selected stream count next to
  **Default Max. Connection Number**. The browser setup wizard drops the
  "one-time setup" subtitle and the browser-name label, and the guided-setup
  card shows only its title.

## [1.0.0] - 2026-10-26

### Added

- Initial public release for Windows 10/11 x64.
- Multi-segment HTTP range engine with pre-allocated destination files.
- Single-window dashboard with live segment, speed, and progress views.
- Smart category routing, browser extension bridge, and interactive Windows
  notifications.
- SQLite persistence for downloads, settings, and resume checkpoints.
