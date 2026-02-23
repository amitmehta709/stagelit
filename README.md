# 🎤 StageLit — Singing Orchestra & Karaoke Desktop App

A cross-platform (macOS & Windows) desktop application for timed media playback, perfect for singing orchestras, karaoke sessions, and performance events.

---

## ✨ Features

- **Local Media Playback** — Browse folders and play any audio/video file (MP4, MKV, AVI, MOV, MP3, WAV, FLAC, etc.)
- **YouTube / Online Playback** — Paste YouTube links; videos are downloaded ad-free via yt-dlp, or use Browser Mode for instant streaming
- **Timed Playback** — Set duration from 30 seconds to 20 minutes; playback auto-stops when time runs out
- **Smart Duration** — Automatically uses actual song length if it's shorter than the configured time
- **Full Song Toggle** — Override the timer to play the entire track (resets after each playback)
- **Two-Phase Ending Alert**:
  - **Warning (30s–15s)**: Subtle amber "Playback ending soon" banner
  - **Flash (last 15s)**: Dramatic red edge-flash with large countdown timer
- **Audio-Synced Equalizer** — Bars react to actual audio frequencies via Web Audio API
- **Seekable Progress Bar** — Hover to see timestamps, click to jump to any position
- **Controls Locked During Playback** — Prevents accidental changes mid-performance
- **Responsive Layout** — Scales to any window size with media-query breakpoints
- **Modern Dark UI** — Glassmorphism, gradient accents, animated equalizer, spinning disc for audio

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18 or later — https://nodejs.org

### Install & Run

```bash
cd stagelit
npm install      # Installs dependencies + auto-downloads yt-dlp
npm start        # Launch the app
```

### Build for Distribution

#### Option A: Use the build scripts (recommended)

```bash
# macOS — interactive, picks arm64 / x64
chmod +x build-mac.sh
./build-mac.sh

# Windows — interactive, picks x64 / ia32
build-windows.bat

# All platforms
chmod +x build-all.sh
./build-all.sh
```

#### Option B: Use npm scripts directly

```bash
# macOS
npm run build:mac-arm64       # Apple Silicon (M1/M2/M3/M4)
npm run build:mac-x64         # Intel Macs
npm run build:mac-all         # Both

# Windows
npm run build:win-x64         # 64-bit
npm run build:win-ia32        # 32-bit
npm run build:win-all         # Both

# Everything
npm run build:all

# Cleanup
npm run clean
```

> **Note:** Build scripts automatically download the correct yt-dlp for the target platform. If using npm scripts directly, run `npm run download-ytdlp-mac` or `npm run download-ytdlp-win` first.

#### Build Outputs (in `dist/` folder)

| Platform | Architecture | File | Shareable? |
|---|---|---|---|
| macOS | Apple Silicon | `StageLit-1.0.0-mac-arm64.dmg` | ✅ Yes |
| macOS | Intel | `StageLit-1.0.0-mac-x64.dmg` | ✅ Yes |
| macOS | Apple Silicon | `StageLit-1.0.0-mac-arm64.zip` | ✅ Yes |
| macOS | Intel | `StageLit-1.0.0-mac-x64.zip` | ✅ Yes |
| Windows | 64-bit | `StageLit-1.0.0-win-x64.exe` (installer) | ✅ Yes |
| Windows | 64-bit | `StageLit-1.0.0-portable-x64.exe` (portable) | ✅ Yes |
| Windows | 32-bit | `StageLit-1.0.0-win-ia32.exe` (installer) | ✅ Yes |

> ⚠️ **Do NOT** share the bare `StageLit.exe` from inside `Program Files` or the binary from inside `StageLit.app/Contents/MacOS/` — these require the full app bundle to function.

> **Cross-compilation:** You can build Windows `.exe` on macOS (requires Wine: `brew install --cask wine-stable`) and macOS `.dmg` for any architecture from any Mac.

---

## 🏗️ Architecture

```
stagelit/
├── main.js                    # Electron main process
│                              # - File dialogs, folder scanning
│                              # - Async yt-dlp detection (cached)
│                              # - Video downloading with progress
│                              # - Browser mode window management
├── preload.js                 # IPC bridge (contextIsolation)
├── renderer/
│   ├── index.html             # App UI
│   ├── styles.css             # Dark theme, responsive breakpoints
│   └── renderer.js            # State machine, Web Audio API, EQ
├── scripts/
│   ├── postinstall.js         # Auto-downloads yt-dlp on npm install
│   └── download-ytdlp-target.js  # Platform-specific yt-dlp downloader
├── bin/                       # yt-dlp binary (auto-downloaded, gitignored)
├── assets/
│   ├── icon.svg               # Vector logo
│   └── icon.png               # App icon (512×512)
├── build-mac.sh               # macOS build script
├── build-windows.bat          # Windows build script
├── build-all.sh               # All-platform build script
├── package.json               # Dependencies & electron-builder config
├── .gitignore
└── README.md
```

### Online Playback — Two Modes

| Mode | How it works | Pros | Cons |
|---|---|---|---|
| **📥 Download & Play** | yt-dlp downloads video → plays locally | No ads, seekable, perfect playback | Takes a few seconds to download |
| **🌐 Browser Mode** | Opens in Electron browser window | Instant start | Has ads, no seek bar |

### yt-dlp — Bundled Automatically

yt-dlp is downloaded automatically when you run `npm install`. No manual installation needed.

- macOS: Universal binary (`yt-dlp_macos` — works on Apple Silicon & Intel)
- Windows: `yt-dlp.exe`
- Linux: `yt-dlp_linux`

The binary is stored in `bin/`, bundled inside the app via `extraResources`, and detected at runtime from `process.resourcesPath`. Falls back to system-installed yt-dlp if the bundled binary is unavailable.

---

## 🎨 UI States

| State | Sidebar | Stage | Timer |
|---|---|---|---|
| **Idle** | All controls enabled | Logo + hint cards | — |
| **Playing** | 🔒 Locked | Video/audio + now-playing card | Counting up |
| **Warning** (30s left) | 🔒 Locked | Amber banner | Amber countdown |
| **Flash** (15s left) | 🔒 Locked | Red edge flash + big countdown | Red pulsing |
| **Completed** | Unlocked | ✓ Completion card | — |

---

## ⚙️ Configuration

- **Max duration**: 20 minutes (adjustable via slider)
- **Full Song mode**: Toggle to play entire track regardless of slider
- **Warning threshold**: 30 seconds before end
- **Flash threshold**: 15 seconds before end
- **Supported formats**: All common audio/video formats via Chromium codecs

---

## 📝 Notes

- **Zero runtime dependencies** — only Electron built-ins and vanilla JS
- **yt-dlp detection is async and cached** — no UI freezing on startup
- Downloaded videos are saved to `{OS temp}/stagelit/` and auto-cleaned on stop/quit
- In Browser Mode, the Electron window auto-closes when the timer ends
- On macOS, the title bar uses `hiddenInset` style for a clean native look
- First launch on macOS may trigger a Gatekeeper prompt — right-click → Open to allow
