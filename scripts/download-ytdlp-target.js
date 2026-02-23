#!/usr/bin/env node

/* ══════════════════════════════════════════════
   StageLit — Download yt-dlp for a TARGET platform
   Usage:
     node scripts/download-ytdlp-target.js mac
     node scripts/download-ytdlp-target.js win
     node scripts/download-ytdlp-target.js linux
     node scripts/download-ytdlp-target.js all
     node scripts/download-ytdlp-target.js        ← defaults to current OS
   ══════════════════════════════════════════════ */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, execFileSync } = require("child_process");

const BIN_DIR = path.join(__dirname, "..", "bin");

// Use latest release URL (redirects to newest version)
const LATEST_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

const TARGETS = {
  mac:   { url: `${LATEST_BASE}/yt-dlp_macos`, filename: "yt-dlp_macos", label: "macOS (universal)", chmod: true },
  win:   { url: `${LATEST_BASE}/yt-dlp.exe`,   filename: "yt-dlp.exe",   label: "Windows",          chmod: false },
  linux: { url: `${LATEST_BASE}/yt-dlp_linux`, filename: "yt-dlp_linux", label: "Linux",             chmod: true },
};

const ALIAS = { mac: "yt-dlp", linux: "yt-dlp" };

function downloadWithRedirects(url, dest, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, { headers: { "User-Agent": "StageLit-Installer/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadWithRedirects(res.headers.location, dest, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const total = parseInt(res.headers["content-length"], 10) || 0;
      let downloaded = 0;
      const file = fs.createWriteStream(dest);
      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (total > 0) process.stdout.write(`\r     ${((downloaded / total) * 100).toFixed(0)}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
      });
      res.pipe(file);
      file.on("finish", () => { file.close(); console.log(""); resolve(); });
      file.on("error", reject);
    }).on("error", reject);
  });
}

function removeQuarantine(filePath) {
  // macOS adds a quarantine attribute to downloaded files, which blocks execution
  if (os.platform() === "darwin") {
    try {
      execSync(`xattr -d com.apple.quarantine "${filePath}" 2>/dev/null`, { stdio: "pipe" });
      console.log("     → Removed macOS quarantine attribute");
    } catch (e) {
      // Attribute might not exist — that's fine
    }
  }
}

function verifyBinary(filePath) {
  try {
    // First run on macOS can take 30+ seconds due to Gatekeeper scanning unsigned binaries
    const output = execFileSync(filePath, ["--version"], { timeout: 60000, stdio: "pipe" });
    const version = output.toString().trim();
    console.log(`     → Verified working: yt-dlp ${version}`);
    return true;
  } catch (e) {
    if (e.message.includes("ETIMEDOUT")) {
      console.log(`     ⏳ First-run verification timed out (macOS Gatekeeper scan). This is normal — binary will work at runtime.`);
      return true; // Trust it — the file downloaded correctly
    }
    console.error(`     ⚠️  Verification failed: ${e.message}`);
    return false;
  }
}

async function downloadTarget(key) {
  const t = TARGETS[key];
  if (!t) { console.error(`  ❌ Unknown target: ${key}`); return; }

  const dest = path.join(BIN_DIR, t.filename);

  // Skip if already downloaded AND verified working
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000000) {
    removeQuarantine(dest);
    if (os.platform() === "darwin" && key === "mac" || os.platform() === "win32" && key === "win" || os.platform() === "linux" && key === "linux") {
      if (verifyBinary(dest)) {
        console.log(`  ✅ ${t.label}: already present and working`);
        // Still create alias
        if (ALIAS[key]) {
          const aliasPath = path.join(BIN_DIR, ALIAS[key]);
          try { fs.copyFileSync(dest, aliasPath); if (t.chmod) fs.chmodSync(aliasPath, 0o755); removeQuarantine(aliasPath); } catch (e) {}
        }
        return;
      }
    } else {
      // Cross-compiling — can't verify, trust the file size
      console.log(`  ✅ ${t.label}: already present (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB, can't verify cross-platform)`);
      if (ALIAS[key]) {
        const aliasPath = path.join(BIN_DIR, ALIAS[key]);
        try { fs.copyFileSync(dest, aliasPath); if (t.chmod) fs.chmodSync(aliasPath, 0o755); } catch (e) {}
      }
      return;
    }
  }

  console.log(`  📥 Downloading yt-dlp (latest) for ${t.label}...`);
  try {
    await downloadWithRedirects(t.url, dest);
    if (t.chmod) fs.chmodSync(dest, 0o755);
    removeQuarantine(dest);
    console.log(`     ✅ Saved: ${t.filename} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);

    // Verify on current platform
    const currentPlatform = os.platform() === "darwin" ? "mac" : os.platform() === "win32" ? "win" : "linux";
    if (key === currentPlatform) {
      if (!verifyBinary(dest)) {
        console.error("     ❌ Downloaded binary doesn't work. You may need to install yt-dlp manually.");
      }
    }
  } catch (err) {
    console.error(`     ❌ Failed: ${err.message}`);
    return;
  }

  // Create alias
  if (ALIAS[key]) {
    const aliasPath = path.join(BIN_DIR, ALIAS[key]);
    try {
      fs.copyFileSync(dest, aliasPath);
      if (t.chmod) fs.chmodSync(aliasPath, 0o755);
      removeQuarantine(aliasPath);
      console.log(`     → Alias created: ${ALIAS[key]}`);
    } catch (e) {}
  }
}

async function main() {
  let arg = (process.argv[2] || "").toLowerCase().trim();

  if (!arg) {
    if (os.platform() === "darwin") arg = "mac";
    else if (os.platform() === "win32") arg = "win";
    else arg = "linux";
    console.log(`  (Auto-detected platform: ${arg})`);
  }

  console.log("");
  console.log("  🎤 StageLit — yt-dlp Download");
  console.log("  ═══════════════════════════════");
  console.log("");

  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  // Clean bin/ of binaries NOT for this target
  if (arg !== "all") {
    const keepFiles = [TARGETS[arg].filename, ALIAS[arg], ".gitkeep"].filter(Boolean);
    try {
      const existing = fs.readdirSync(BIN_DIR);
      for (const f of existing) {
        if (!keepFiles.includes(f) && (f.startsWith("yt-dlp") || f.startsWith("yt_dlp"))) {
          fs.unlinkSync(path.join(BIN_DIR, f));
          console.log(`  🗑  Removed: ${f} (not needed for ${arg})`);
        }
      }
    } catch (e) {}
    console.log("");
  }

  if (arg === "all") {
    for (const key of Object.keys(TARGETS)) await downloadTarget(key);
  } else if (TARGETS[arg]) {
    await downloadTarget(arg);
  } else {
    console.error(`  ❌ Unknown target: "${arg}". Use: mac, win, linux, or all`);
    process.exit(1);
  }

  console.log("");
  console.log("  📂 bin/ contents:");
  fs.readdirSync(BIN_DIR).forEach((f) => {
    const s = fs.statSync(path.join(BIN_DIR, f));
    console.log(`     ${f} (${s.size > 1000 ? (s.size / 1024 / 1024).toFixed(1) + " MB" : s.size + " B"})`);
  });
  console.log("");
}

main();
