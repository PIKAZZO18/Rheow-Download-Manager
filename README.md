<p align="center">
  <img src="rheow-horizontal-dark.png" alt="Rheow" width="360">
</p>

# Rheow

**Download manager Windows yang cepat, ringan, dan modern** — dibangun dengan **Rust (Tauri v2)** dan **React 19 + TypeScript**.

Repository ini berisi source code aplikasi Rheow. Tidak ada installer atau build artifact yang disertakan; clone repo ini lalu build dan test sendiri.

Rheow adalah aplikasi download manager multi-segmen dengan antarmuka satu jendela. Mesin unduh paralel berbasis `tokio` dan `reqwest` menulis langsung ke offset berkas yang sudah dialokasikan, sementara dashboard React menampilkan progres setiap segmen secara real-time. Rheow juga terintegrasi dengan browser melalui ekstensi Manifest V3 dan bridge lokal.

---

## Fitur Utama

- **Multi-segment range engine** — hingga 32 koneksi paralel dengan penulisan langsung ke disk (*pre-allocation*, tanpa penggabungan file sementara).
- **Dashboard satu jendela** — progres, kecepatan, sisa waktu, dan visualisasi segmen tanpa popup download terpisah.
- **Antrean & penjadwalan** — batas koneksi global, antrean FIFO, pause/resume/retry, serta pembatas kecepatan.
- **Kategori otomatis** — file diklasifikasikan ke `Compressed`, `Programs`, `Video`, `Documents`, `Music`, atau `General`, dengan subfolder yang dapat dikustomisasi.
- **Integrasi browser** — ekstensi Chrome/Edge/Brave (Manifest V3), context menu "Download with Rheow", intersepsi download, dan bridge lokal di `http://127.0.0.1:41789`.
- **Wizard ekstensi first-run** — aplikasi memandu aktivasi ekstensi lewat browser.
- **Notifikasi Windows interaktif** — aksi Open File, Open Folder, Retry, dan Refresh Link langsung dari toast.
- **Persistensi SQLite** — status unduhan, segmen, riwayat, dan pengaturan tersimpan di `%APPDATA%\Rheow\rheow.db`.
- **UI konsisten** — dashboard bersih dengan token desain internal Rheow.

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| Desktop framework | Tauri v2 |
| Backend | Rust, `tokio`, `reqwest`, `rusqlite`, `serde` |
| Frontend | React 19, TypeScript, Vite 8 |
| Styling | Tailwind CSS v4, Lucide Icons |
| Database | SQLite (embedded) |
| Browser extension | Chrome Manifest V3 |
| Installer | NSIS (Tauri bundler) |

---

## Struktur Repository

```text
.
├── README.md
├── LICENSE
├── rheow-horizontal-dark.png
└── Rheow/                      # Source aplikasi Tauri
    ├── extension/              # Ekstensi Chrome/Edge/Brave (MV3)
    ├── public/                 # Aset frontend & brand
    ├── scripts/                # Test bridge & E2E ekstensi
    ├── src/                    # Frontend React + TypeScript
    └── src-tauri/              # Backend Rust, konfigurasi Tauri, NSIS
```

---

## Persyaratan

- **Windows 10 / 11 x64**
- **Node.js 20.19+** (atau 22.12+) dan npm
- **Rust** toolchain `stable-x86_64-pc-windows-msvc`
- **Visual Studio Build Tools** dengan workload *Desktop development with C++*
- **WebView2 Runtime** (biasanya sudah tersedia di Windows 10/11)

Panduan instalasi Tauri: <https://tauri.app/start/prerequisites/>

---

## Build & Jalankan

Dari root repository:

```powershell
cd Rheow
npm ci
npx tauri dev
```

Build installer NSIS:

```powershell
cd Rheow
npm ci
npx tauri build
```

Installer dihasilkan di:

```text
Rheow\src-tauri\target\release\bundle\nsis\Rheow_1.0.0_x64-setup.exe
```

Untuk hanya membangun executable:

```powershell
npx tauri build --no-bundle
```

Output: `Rheow\src-tauri\target\release\rheow.exe`.

> `npm run build` hanya membangun frontend ke `dist/`. Gunakan `npx tauri build` untuk installer lengkap.

---

## Testing

Unit dan integration test Rust:

```powershell
cd Rheow\src-tauri
cargo test
```

Test integrasi engine secara spesifik:

```powershell
cd Rheow\src-tauri
cargo test --test engine_test -- --nocapture
```

E2E ekstensi (aplikasi Rheow harus sudah berjalan):

```powershell
cd Rheow
npm run test:e2e
```

Matriks keamanan HTTP bridge (aplikasi Rheow harus sudah berjalan):

```powershell
cd Rheow
powershell -ExecutionPolicy Bypass -File .\scripts\test-bridge.ps1
```

---

## Ekstensi Browser

Installer Rheow membawa ekstensi di dalam paket. Saat aplikasi pertama kali dijalankan, wizard akan:

1. Menyalin ekstensi ke `%LOCALAPPDATA%\com.rheow.app\browser-extension`.
2. Membuka browser default.
3. Memandu pengguna membuka `chrome://extensions` atau `edge://extensions`, mengaktifkan **Developer mode**, lalu **Load unpacked**.
4. Menunggu hingga ekstensi terhubung ke Rheow.

Wizard dapat dibuka kembali dari **Settings → Browser → Open wizard**.

Untuk development, ekstensi dapat dimuat manual dari folder `Rheow\extension` di Chrome, Edge, atau Brave.

---

## Dokumentasi Teknis

Lihat [`Rheow/README.md`](Rheow/README.md) untuk struktur aplikasi, arsitektur, dan detail build.

---

## Lisensi

Dirilis di bawah lisensi **MIT**. Lihat [`LICENSE`](LICENSE).
