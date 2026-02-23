#!/bin/bash
set -e

echo ""
echo "  🎤 StageLit — Cross-Platform Builder"
echo "  ═══════════════════════════════════════"
echo ""

if ! command -v node &> /dev/null; then
    echo "❌ Node.js v18+ required."
    exit 1
fi
echo "✅ Node.js $(node -v) · npm $(npm -v)"

cd "$(dirname "$0")"
echo "📁 $(pwd)"
echo ""

echo "📦 Installing dependencies..."
npm install --ignore-scripts
echo ""

echo "Select what to build:"
echo ""
echo "  ── macOS ──"
echo "  1) macOS — Apple Silicon (arm64)"
echo "  2) macOS — Intel (x64)"
echo ""
echo "  ── Windows ──"
echo "  3) Windows — 64-bit (x64)"
echo "  4) Windows — 32-bit (ia32)"
echo ""
echo "  ── Bundles ──"
echo "  5) All macOS (arm64 + x64)"
echo "  6) All Windows (x64 + ia32)"
echo "  7) Everything (macOS + Windows)"
echo ""
read -p "Choice [1-7]: " C
echo ""

build_mac() {
    echo "📥 Downloading yt-dlp for macOS..."
    node scripts/download-ytdlp-target.js mac
    echo ""
}
build_win() {
    echo "📥 Downloading yt-dlp for Windows..."
    node scripts/download-ytdlp-target.js win
    echo ""
}

case $C in
    1) build_mac; npx electron-builder --mac --arm64 ;;
    2) build_mac; npx electron-builder --mac --x64 ;;
    3) build_win; npx electron-builder --win --x64 ;;
    4) build_win; npx electron-builder --win --ia32 ;;
    5) build_mac; npx electron-builder --mac --arm64 && npx electron-builder --mac --x64 ;;
    6) build_win; npx electron-builder --win --x64 && npx electron-builder --win --ia32 ;;
    7)
        build_mac
        npx electron-builder --mac --arm64
        npx electron-builder --mac --x64
        build_win
        npx electron-builder --win --x64
        npx electron-builder --win --ia32
        ;;
    *) echo "❌ Invalid."; exit 1 ;;
esac

echo ""
echo "══════════════════════════════════════════════"
echo "  ✅ Build complete! yt-dlp is bundled."
echo "  📂 Output: $(pwd)/dist/"
echo "══════════════════════════════════════════════"
echo ""
ls -lh dist/ 2>/dev/null | grep -E "\.(dmg|zip|exe|AppImage)$" || echo "  Check dist/"
