# Rheow — Modern IDM Alternative Download Manager

**Rheow** is a blazing-fast, modern, single-window download manager engineered in **Rust (Tauri v2)** and **React 19 + TypeScript + Tailwind CSS v4**. 

Built from reverse-engineering analysis of Internet Download Manager (`IDMan.exe`), Rheow modernizes the core architectural strengths of IDM (multi-segment HTTP Range chunking, zero-copy disk pre-allocation, browser integration) while eliminating bloated trial dialogs and resource-heavy floating mini download windows in favor of a clean, unified dashboard with a real-time chunk visualizer.

---

## 🚀 Key Highlights & Architecture

- **Unified Single-Window Dashboard**: No annoying floating mini download windows that consume extra RAM and clutter your desktop. Real-time multi-segment progress is displayed directly in the dashboard's hero card.
- **Multi-Segment Range Engine**: High-speed parallel chunk downloader powered by `tokio` and `reqwest`. Supports dynamic splitting (up to 32 concurrent connections) directly writing into pre-allocated byte offsets with `seek` and `set_len`.
- **Smart Category Subfolder Routing**: Automatically classifies files into categories (`Compressed`, `Programs`, `Video`, `Documents`, `Music`, `General`). If the subfolder already exists in your `Downloads` directory, Rheow uses it immediately; if not, Rheow creates it automatically on demand.
- **ACID SQLite Persistence**: Uses embedded SQLite (`rusqlite`) located at `%APPDATA%\Rheow\rheow.db` to guarantee download state resilience across system reboots.
- **Frosted Link Dashboard on Rice Paper**: Custom visual craft built to Rheow's internal design system:
  - Rice Paper background (`#fafafa`)
  - Crisp hairline borders (`#e5e5e5`)
  - Electric Blue accents (`#2563eb`)
  - Pill badges (`rounded-full`), Card radiuses (`rounded-[12px]`), Buttons (`rounded-[8px]`), Inputs (`rounded-[6px]`)
- **Browser Integration (Manifest V3)**:
  - Chrome / Edge / Brave extension located in `extension/`.
  - Right-click "Download with Rheow" context menu.
  - Automatic browser download interception with file-extension filtering.
  - Seamless communication with the Rheow desktop engine via local loopback bridge on `http://127.0.0.1:41789`.

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

1. Click **Continue** — Rheow copies the extension to
   `%LOCALAPPDATA%\com.rheow.app\browser-extension` and can open that folder for you.
2. Click **Open browser** — Rheow launches your default Chromium browser and copies the
   extensions page address (`chrome://extensions` or `edge://extensions`).
3. Paste the address, turn on **Developer mode**, click **Load unpacked**, paste the copied
   folder path into the picker, and select the folder.
4. The wizard turns green as soon as the extension connects to Rheow.

The wizard can be reopened from **Settings → Browser → Open wizard**. For a development build,
you can still select `Rheow\extension` directly.
