#!/usr/bin/env node

/* Postinstall: downloads yt-dlp for current platform (for development/npm start) */
/* Build scripts download for the TARGET platform separately — see build-*.sh */

const { execFileSync } = require("child_process");
const path = require("path");

console.log("");
console.log("  🎤 StageLit — postinstall: downloading yt-dlp for current platform...");

try {
  execFileSync("node", [path.join(__dirname, "download-ytdlp-target.js")], { stdio: "inherit" });
} catch (e) {
  console.error("  ⚠️  yt-dlp download failed. You can still use Browser Mode.");
  console.error("     Or run manually: node scripts/download-ytdlp-target.js");
}
