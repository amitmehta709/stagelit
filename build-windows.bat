@echo off
REM ══════════════════════════════════════════════
REM StageLit — Windows Build Script
REM Downloads yt-dlp.exe + builds .exe installer
REM ══════════════════════════════════════════════

echo.
echo   🎤 StageLit — Windows Build
echo   ════════════════════════════
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ❌ Node.js v18+ required. Download from https://nodejs.org
    pause
    exit /b 1
)
echo ✅ Node.js detected

cd /d "%~dp0"
echo 📁 %cd%
echo.

echo 📦 Installing dependencies...
call npm install --ignore-scripts
if %ERRORLEVEL% neq 0 (
    echo ❌ npm install failed.
    pause
    exit /b 1
)
echo.

echo 📥 Downloading yt-dlp for Windows...
call node scripts/download-ytdlp-target.js win
if %ERRORLEVEL% neq 0 (
    echo ⚠️ yt-dlp download failed. Build will continue but online playback won't work.
)
echo.

echo Select target:
echo   1^) 64-bit (x64) — most common
echo   2^) 32-bit (ia32)
echo   3^) Both
set /p C="Choice [1-3]: "
echo.

if "%C%"=="1" (
    call npx electron-builder --win --x64
) else if "%C%"=="2" (
    call npx electron-builder --win --ia32
) else if "%C%"=="3" (
    call npx electron-builder --win --x64
    call npx electron-builder --win --ia32
) else (
    echo ❌ Invalid.
    pause
    exit /b 1
)

if %ERRORLEVEL% neq 0 (
    echo ❌ Build failed.
    pause
    exit /b 1
)

echo.
echo ══════════════════════════════════════════
echo   ✅ Done! yt-dlp.exe is bundled inside the app.
echo   📂 Output: %cd%\dist\
echo ══════════════════════════════════════════
echo.
dir /b dist\*.exe 2>nul
echo.

set /p O="Open dist folder? [y/N]: "
if /i "%O%"=="y" explorer dist

pause
