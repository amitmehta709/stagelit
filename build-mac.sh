#!/bin/bash
set -e

echo ""
echo "  🎤 StageLit — macOS Build"
echo "  ════════════════════════════"
echo ""

if ! command -v node &> /dev/null; then
    echo "❌ Node.js v18+ required. Install from https://nodejs.org"
    exit 1
fi
echo "✅ Node.js $(node -v) · npm $(npm -v)"

cd "$(dirname "$0")"
echo "📁 $(pwd)"
echo ""

echo "📦 Installing dependencies..."
npm install --ignore-scripts
echo ""

echo "📥 Downloading yt-dlp for macOS..."
node scripts/download-ytdlp-target.js mac
echo ""

echo "Select target:"
echo "  1) Apple Silicon (arm64) — M1/M2/M3/M4"
echo "  2) Intel (x64)"
echo "  3) Both"
read -p "Choice [1-3]: " C
echo ""

case $C in
    1) npx electron-builder --mac --arm64 ;;
    2) npx electron-builder --mac --x64 ;;
    3) npx electron-builder --mac --arm64 && npx electron-builder --mac --x64 ;;
    *) echo "❌ Invalid."; exit 1 ;;
esac

echo ""
echo "✅ Done! yt-dlp is bundled inside the app."
echo "📂 Output: $(pwd)/dist/"
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || true
