const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile, exec } = require("child_process");
const os = require("os");

let mainWindow;

// Enable autoplay for media
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg",
  ".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a", ".opus",
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: "StageLit",
    icon: path.join(__dirname, "assets", "icon.png"),
    backgroundColor: "#06060c",
    titleBarStyle: "hiddenInset",
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });

  // Uncomment for dev tools:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  const { session } = require("electron");
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["media", "mediaKeySystem", "fullscreen"];
    callback(allowed.includes(permission));
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ─── IPC: Open folder dialog ─── */
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Media Folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

/* ─── IPC: Scan folder for media files ─── */
ipcMain.handle("scan-folder", async (event, folderPath) => {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && MEDIA_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => {
        const ext = path.extname(e.name).toLowerCase();
        const isVideo = [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg"].includes(ext);
        return {
          name: e.name,
          path: path.join(folderPath, e.name),
          type: isVideo ? "video" : "audio",
          ext: ext,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message, files: [] };
  }
});

/* ─── Helper: find yt-dlp binary (async, non-blocking) ─── */
let ytdlpCache = null; // Cache result after first check

async function findYtDlp() {
  if (ytdlpCache) return ytdlpCache;

  const isPackaged = app.isPackaged;
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const { execFile, exec } = require("child_process");
  const { promisify } = require("util");
  const execFileAsync = promisify(execFile);
  const execAsync = promisify(exec);

  console.log(`[StageLit] findYtDlp: packaged=${isPackaged} platform=${process.platform}`);

  // Helper: remove macOS quarantine
  async function unquarantine(p) {
    if (isMac) {
      try { await execAsync(`xattr -dr com.apple.quarantine "${p}" 2>/dev/null`); } catch (e) {}
    }
  }

  // Helper: test if a binary works by executing it (non-blocking)
  async function verify(p) {
    try {
      if (!isWin) try { fs.chmodSync(p, 0o755); } catch (e) {}
      await unquarantine(p);
      const { stdout } = await execFileAsync(p, ["--version"], { timeout: 15000 });
      return stdout.toString().trim();
    } catch (e) {
      console.log(`[StageLit] verify("${p}") failed: ${e.code || e.message}`);
      if (e.message && e.message.includes("ETIMEDOUT")) {
        return "unknown (scan timeout)";
      }
      return null;
    }
  }

  // 1) BUNDLED binary (highest priority)
  const binNames = isWin ? ["yt-dlp.exe"]
    : isMac ? ["yt-dlp", "yt-dlp_macos"]
    : ["yt-dlp", "yt-dlp_linux"];

  const bundleDirs = isPackaged
    ? [path.join(process.resourcesPath, "bin")]
    : [path.join(__dirname, "bin")];

  for (const dir of bundleDirs) {
    console.log(`[StageLit] Checking bundled dir: ${dir} (exists: ${fs.existsSync(dir)})`);
    if (fs.existsSync(dir)) {
      try { console.log(`[StageLit]   Contents: ${fs.readdirSync(dir).join(", ")}`); } catch (e) {}
    }
    for (const name of binNames) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        console.log(`[StageLit] Found bundled: ${p} (${(stat.size / 1024 / 1024).toFixed(1)} MB, mode: ${stat.mode.toString(8)})`);

        // In packaged app: trust the binary if it exists with reasonable size (>1MB)
        // Verification via --version can fail due to Gatekeeper / code signing / read-only fs
        if (isPackaged && stat.size > 1000000) {
          console.log(`[StageLit] Trusting bundled binary (packaged app, ${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
          ytdlpCache = { found: true, cmd: p, type: "bundled", version: "bundled" };
          return ytdlpCache;
        }

        // In dev mode: actually verify it runs
        const ver = await verify(p);
        if (ver) {
          ytdlpCache = { found: true, cmd: p, type: "bundled", version: ver };
          return ytdlpCache;
        }
        console.log(`[StageLit] Bundled binary exists but failed verification`);
      }
    }
  }

  // 2) System PATH
  const sysNames = isWin ? ["yt-dlp.exe", "yt-dlp"] : ["yt-dlp"];
  for (const name of sysNames) {
    try {
      const { stdout } = await execFileAsync(name, ["--version"], { timeout: 5000 });
      ytdlpCache = { found: true, cmd: name, type: "system", version: stdout.toString().trim() };
      console.log(`[StageLit] Found system: ${name} (${ytdlpCache.version})`);
      return ytdlpCache;
    } catch (e) {}
  }

  // 3) Python module
  try {
    const pyCmd = isWin ? "python" : "python3";
    const { stdout } = await execAsync(`${pyCmd} -m yt_dlp --version`, { timeout: 5000 });
    ytdlpCache = { found: true, cmd: pyCmd, type: "python", version: stdout.toString().trim() };
    console.log(`[StageLit] Found python module: ${ytdlpCache.version}`);
    return ytdlpCache;
  } catch (e) {}

  // 4) Common install paths
  const commonPaths = isMac
    ? ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", path.join(os.homedir(), ".local/bin/yt-dlp")]
    : isWin
    ? [path.join(os.homedir(), "AppData", "Local", "Programs", "yt-dlp", "yt-dlp.exe"),
       path.join(os.homedir(), "scoop", "shims", "yt-dlp.exe"),
       "C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe"]
    : [];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      const ver = await verify(p);
      if (ver) {
        ytdlpCache = { found: true, cmd: p, type: "system", version: ver };
        console.log(`[StageLit] Found common path: ${p} (${ver})`);
        return ytdlpCache;
      }
    }
  }

  console.log("[StageLit] yt-dlp NOT found anywhere");
  ytdlpCache = { found: false };
  return ytdlpCache;
}

/* ─── IPC: Check yt-dlp availability ─── */
ipcMain.handle("check-ytdlp", async () => {
  return await findYtDlp();
});

/* ─── IPC: Detect URL type (for UI badge only) ─── */
ipcMain.handle("detect-url-type", (event, url) => {
  const directMediaPatterns = /\.(mp4|mp3|wav|webm|ogg|m4a|flac|aac)(\?.*)?$/i;
  return { isDirectMedia: directMediaPatterns.test(url) };
});

/* ─── Temp file management ─── */
let currentDownloadProcess = null;
let tempFiles = [];

function getTempPath(ext = "mp4") {
  const tempDir = path.join(os.tmpdir(), "stagelit");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const name = `stagelit_${Date.now()}.${ext}`;
  const fullPath = path.join(tempDir, name);
  tempFiles.push(fullPath);
  return fullPath;
}

function cleanupTempFiles() {
  for (const f of tempFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
  }
  tempFiles = [];
}

// Cleanup on exit
app.on("before-quit", cleanupTempFiles);
app.on("window-all-closed", () => {
  cleanupTempFiles();
  if (process.platform !== "darwin") app.quit();
});

/* ─── IPC: Download video via yt-dlp to temp file (with progress) ─── */
ipcMain.handle("download-video", async (event, url) => {
  const ytdlp = await findYtDlp();

  if (!ytdlp.found) {
    return {
      success: false,
      error: "yt-dlp is required for online playback.\n\nInstall:\n• macOS: brew install yt-dlp\n• Windows: winget install yt-dlp\n• pip install yt-dlp",
    };
  }

  return new Promise((resolve) => {

    const outputPath = getTempPath("mp4");

    const args = [
      "--no-warnings",
      "--no-playlist",
      "--no-check-certificates",
      "--newline",
      "--progress",
      "-f", "best[ext=mp4][height<=1080]/best[ext=mp4]/best[height<=1080]/best",
      "-o", outputPath,
      url,
    ];

    let lastProgress = "";
    let hasError = false;
    let stderrOutput = "";

    const runDownload = (command, cmdArgs, isModule) => {
      let fullArgs, spawnCmd;

      if (isModule) {
        spawnCmd = command;
        fullArgs = ["-m", "yt_dlp", ...cmdArgs];
      } else {
        spawnCmd = command;
        fullArgs = cmdArgs;
      }

      const { spawn } = require("child_process");
      currentDownloadProcess = spawn(spawnCmd, fullArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      currentDownloadProcess.stdout.on("data", (data) => {
        const line = data.toString().trim();
        // Parse progress: [download]  45.2% of ~10.5MiB at 2.3MiB/s
        const match = line.match(/(\d+\.?\d*)%/);
        if (match) {
          const pct = parseFloat(match[1]);
          mainWindow.webContents.send("download-progress", { percent: pct, line });
          lastProgress = `${pct.toFixed(0)}%`;
        }
      });

      currentDownloadProcess.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line) stderrOutput += line + "\n";
        if (line.includes("ERROR")) {
          hasError = true;
        }
      });

      currentDownloadProcess.on("close", (code) => {
        currentDownloadProcess = null;

        if (code === 0 && fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          if (stats.size > 0) {
            resolve({ success: true, filePath: outputPath });
          } else {
            resolve({ success: false, error: "Download produced an empty file. Video may be restricted." });
          }
        } else {
          // Include stderr in error message for debugging
          const errDetail = stderrOutput.trim().split("\n").slice(-3).join("\n");
          const errMsg = errDetail
            ? `yt-dlp error:\n${errDetail}`
            : `Download failed (exit code ${code}). The video may be unavailable or restricted.`;

          // If direct command failed, try python module as fallback
          if (!isModule && ytdlp.type !== "python") {
            try {
              const pyCmd = process.platform === "win32" ? "python" : "python3";
              runDownload(pyCmd, args, true);
            } catch (e) {
              resolve({ success: false, error: errMsg });
            }
          } else {
            resolve({ success: false, error: errMsg });
          }
        }
      });

      currentDownloadProcess.on("error", (err) => {
        currentDownloadProcess = null;
        if (!isModule && ytdlp.type !== "python") {
          const pyCmd = process.platform === "win32" ? "python" : "python3";
          runDownload(pyCmd, args, true);
        } else {
          resolve({ success: false, error: `Failed to run yt-dlp: ${err.message}` });
        }
      });
    };

    if (ytdlp.type === "python") {
      runDownload(ytdlp.cmd, args, true);
    } else {
      // "bundled" or "system" — direct exec
      runDownload(ytdlp.cmd, args, false);
    }
  });
});

/* ─── IPC: Cancel ongoing download ─── */
ipcMain.handle("cancel-download", () => {
  if (currentDownloadProcess) {
    currentDownloadProcess.kill("SIGTERM");
    currentDownloadProcess = null;
  }
  return { cancelled: true };
});

/* ─── IPC: Cleanup temp files ─── */
ipcMain.handle("cleanup-temp", () => {
  cleanupTempFiles();
  return { cleaned: true };
});

/* ─── IPC: Open external link ─── */
ipcMain.handle("open-external", (event, url) => {
  shell.openExternal(url);
});

/* ══════════════════════════════════════════════
   BROWSER MODE — Opens URL in a controlled
   Electron window. App can close it on timer end.
   ══════════════════════════════════════════════ */

let browserModeWindow = null;

ipcMain.handle("open-browser-mode", (event, url) => {
  // Close existing browser window if any
  if (browserModeWindow && !browserModeWindow.isDestroyed()) {
    browserModeWindow.close();
  }

  browserModeWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: "StageLit — Browser Mode",
    icon: path.join(__dirname, "assets", "icon.png"),
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Standard Chrome user-agent so YouTube works normally
    },
  });

  // Set Chrome user-agent for YouTube compatibility
  browserModeWindow.webContents.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  browserModeWindow.loadURL(url);

  // Prevent user from navigating away to random sites
  browserModeWindow.webContents.on("will-navigate", (e, navUrl) => {
    // Allow YouTube/Vimeo navigations (ads, consent, etc.) but block unrelated
    const allowed = ["youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "google.com", "accounts.google.com"];
    try {
      const host = new URL(navUrl).hostname;
      if (!allowed.some((d) => host.endsWith(d))) {
        e.preventDefault();
      }
    } catch (err) {}
  });

  // Prevent popups
  browserModeWindow.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    // Allow YouTube auth popups, block others
    try {
      const host = new URL(popupUrl).hostname;
      if (host.endsWith("accounts.google.com") || host.endsWith("youtube.com")) {
        return { action: "allow" };
      }
    } catch (e) {}
    return { action: "deny" };
  });

  browserModeWindow.on("closed", () => {
    browserModeWindow = null;
    // Notify renderer that browser window was closed (user or timer)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("browser-mode-closed");
    }
  });

  return { success: true };
});

ipcMain.handle("close-browser-mode", () => {
  if (browserModeWindow && !browserModeWindow.isDestroyed()) {
    browserModeWindow.close();
    browserModeWindow = null;
  }
  return { closed: true };
});

ipcMain.handle("is-browser-mode-open", () => {
  return browserModeWindow && !browserModeWindow.isDestroyed();
});
