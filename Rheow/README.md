# Rheow: Modern Windows Download Manager

**Rheow** is a single-window download manager engineered in **Rust (Tauri v2)** and **React 19 + TypeScript + Tailwind CSS v4**.

Rheow focuses on core performance strengths: multi-segment HTTP Range chunking, disk pre-allocation, and browser integration. It replaces detached floating download popups with a unified dashboard and a real-time chunk visualizer.

---

## Key Highlights & Architecture

- **Unified Single-Window Dashboard**: Consolidates active task progress, speed metrics, and segment blocks in one place.
- **Multi-Segment Range Engine**: Parallel chunk downloader powered by `tokio` and `reqwest`. Supports dynamic splitting (up to 32 concurrent connections) writing into pre-allocated byte offsets with `seek` and `set_len`.
- **Smart Category Subfolder Routing**: Classifies files into categories (`Compressed`, `Programs`, `Video`, `Documents`, `Music`, `General`). If the folder exists in your `Downloads` directory, Rheow uses it; if not, Rheow creates it on demand.
- **ACID SQLite Persistence**: Uses embedded SQLite (`rusqlite`) located at `%APPDATA%\Rheow\rheow.db` to protect task states across system reboots.
- **Rice Paper Design System**:
  - Rice Paper background (`#fafafa`)
  - Crisp hairline borders (`#e5e5e5`)
  - Electric Blue accents (`#2563eb`)
  - Pill badges (`rounded-full`), card radiuses (`rounded-[12px]`), buttons (`rounded-[8px]`), inputs (`rounded-[6px]`)
- **Browser Integration (Manifest V3)**:
  - Chrome, Edge, and Brave extension located in `extension/`.
  - Right-click "Download with Rheow" context menu.
  - Automatic download interception with file extension filtering.
  - Communication with the desktop engine via local loopback bridge on `http://127.0.0.1:41789`.

---

## 📁 Repository Structure

```text
Rheow/
├── extension/                     # Chrome / Edge Manifest V3 Extension
│   ├── manifest.json
│   ├── background.js              # Download interceptor & context menu
│   ├── popup.html                 # Sleek status & quick add popup
│   ├── popup.js
│   └── icons/                     # 16x16, 48x48, 128x128 PNG icons
├── public/                        # Frontend & brand assets
├── scripts/                       # Bridge & extension E2E tests
├── src/                           # React 19 Frontend
│   ├── components/
│   │   ├── Header.tsx             # Brand & navigation tabs
│   │   ├── Sidebar.tsx            # Categories & SSD storage meter
│   │   ├── HeroActiveCard.tsx     # Multi-segment chunk visualizer
│   │   ├── FilterToolbar.tsx      # Search & status filter pills
│   │   ├── DownloadTable.tsx      # Main tasks list with inline progress
│   │   └── AddDownloadModal.tsx   # Transient confirmation popup
│   ├── types/                     # TypeScript interfaces
│   ├── index.css                  # Tailwind v4 theme definitions
│   └── App.tsx                    # Main application controller
└── src-tauri/                     # Rust Engine Backend
    ├── src/
    │   ├── db/                    # SQLite database layer
    │   ├── engine/                # Multi-segment Range worker & prealloc
    │   ├── server.rs              # HTTP loopback bridge (Port 41789)
    │   ├── lib.rs                 # Core library
    │   └── main.rs                # Tauri application entrypoint
    └── tests/
        └── engine_test.rs         # Integration test suite
```

---

## 🛠️ How to Run & Build

All commands below are run from the repository root.

### 1. Install Dependencies
```powershell
cd Rheow
npm ci
```

### 2. Run in Development Mode
```powershell
cd Rheow
npx tauri dev
```

### 3. Run Integration Tests
```powershell
cd Rheow\src-tauri
cargo test --test engine_test -- --nocapture
```

### 4. Build Production Installer
```powershell
cd Rheow
npm ci
npx tauri build
```
The NSIS installer is created at:
`Rheow\src-tauri\target\release\bundle\nsis\Rheow_1.0.0_x64-setup.exe`.

To build only the optimized executable:
```powershell
npx tauri build --no-bundle
```
The standalone binary is created at:
`Rheow\src-tauri\target\release\rheow.exe`.

---

## 🌐 Installing the Browser Extension (Chrome / Edge / Brave)

The Windows installer bundles the extension, and Rheow opens a guided setup wizard on first launch:

1. Click **Continue**: Rheow copies the extension to
   `%LOCALAPPDATA%\com.rheow.app\browser-extension` and can open that folder for you.
2. Click **Open browser**: Rheow launches your default Chromium browser and copies the
   extensions page address (`chrome://extensions` or `edge://extensions`).
3. Paste the address, turn on **Developer mode**, click **Load unpacked**, paste the copied
   folder path into the picker, and select the folder.
4. The wizard turns green as soon as the extension connects to Rheow.

The wizard can be reopened from **Settings → Browser → Open wizard**. For a development build,
you can still select `Rheow\extension` directly.
