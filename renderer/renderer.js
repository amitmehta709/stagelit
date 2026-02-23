/* ══════════════════════════════════════════════
   StageLit — Renderer v3
   Improvements:
   1. Flash timer moved to bottom-left
   2. Smart duration: min(config, media length)
   3. Audio-synced equalizer via Web Audio API
   4. Responsive layout — scales with window
   ══════════════════════════════════════════════ */

const STATES = { IDLE: "idle", PLAYING: "playing", WARNING: "warning", FLASH: "flash", COMPLETED: "completed" };

const state = {
  activeTab: 0,
  folderPath: "",
  files: [],
  selectedFile: null,
  duration: 3,          // Configured duration in minutes
  mediaDuration: null,  // Actual media length in seconds (detected on play)
  elapsed: 0,
  youtubeUrl: "",
  playMode: "download",
  fullSong: false,       // When true, plays entire media length (ignores slider)
  flashOn: true,
  playbackTimer: null,
  flashTimer: null,
  currentSource: null,
  playState: STATES.IDLE,
};

// ── Audio analysis (Web Audio API) ──
let audioCtx = null;
let analyser = null;
let audioSourceNode = null;
let freqData = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  flashOverlay: $("#flash-overlay"),
  flashBigTime: $("#flash-big-time"),
  statusDot: $("#status-dot"),
  statusText: $("#status-text"),
  tabBtns: $$(".tab-btn"),
  tabPanels: [$("#tab-panel-0"), $("#tab-panel-1")],
  folderPath: $("#folder-path"),
  browseBtn: $("#browse-btn"),
  fileSelect: $("#file-select"),
  urlInput: $("#url-input"),
  ytdlpStatus: $("#ytdlp-status"),
  ytdlpInfo: $("#ytdlp-info"),
  modeOptions: $$(".mode-option"),
  browserCard: $("#browser-card"),
  browserUrl: $("#browser-url"),
  durationSlider: $("#duration-slider"),
  durVal: $("#dur-val"),
  playBtn: $("#play-btn"),
  statusMsg: $("#status-msg"),
  videoBox: $("#video-box"),
  localVideo: $("#local-video"),
  localAudio: $("#local-audio"),
  audioViz: $("#audio-viz"),
  eqLarge: $("#eq-large"),
  eqSmall: $("#eq-small"),
  nowCard: $("#now-card"),
  progressRing: $("#progress-ring"),
  progressCircle: $("#progress-circle"),
  ringElapsed: $("#ring-elapsed"),
  ringRemaining: $("#ring-remaining"),
  trackName: $("#track-name"),
  trackBadge: $("#track-badge"),
  seekbarWrap: $("#seekbar-wrap"),
  seekbarFill: $("#seekbar-fill"),
  seekbarKnob: $("#seekbar-knob"),
  seekbarHoverLine: $("#seekbar-hover-line"),
  seekbarTooltip: $("#seekbar-tooltip"),
  timeElapsed: $("#time-elapsed"),
  timeTotal: $("#time-total"),
  warningBanner: $("#warning-banner"),
  warningTime: $("#warning-time"),
  flashBanner: $("#flash-banner"),
  flashInlineTime: $("#flash-inline-time"),
  idleState: $("#idle-state"),
  hints: $("#hints"),
  completedCard: $("#completed-card"),
  completedSub: $("#completed-sub"),
  newSongBtn: $("#new-song-btn"),
  lockTabs: $("#lock-tabs"),
  lockFiles: $("#lock-files"),
  lockDuration: $("#lock-duration"),
  fullSongCheck: $("#full-song-check"),
  fullSongHint: $("#full-song-hint"),
};

// ── Helpers ──
const formatTime = (s) => {
  const ss = Math.round(Math.max(0, s));
  return `${Math.floor(ss / 60)}:${(ss % 60).toString().padStart(2, "0")}`;
};

// Smart duration: respects full-song toggle and media length
function effectiveDuration() {
  const configSec = state.duration * 60;
  const hasDuration = state.mediaDuration && state.mediaDuration > 0 && state.currentSource?.type !== "browser";

  if (state.fullSong && hasDuration) {
    // Full song mode: use actual media length
    return Math.floor(state.mediaDuration);
  }
  if (hasDuration) {
    // Normal mode: use shorter of config vs media
    return Math.min(configSec, Math.floor(state.mediaDuration));
  }
  return configSec;
}

const totalSeconds = () => effectiveDuration();
const remaining = () => Math.max(0, totalSeconds() - state.elapsed);
const progress = () => totalSeconds() > 0 ? (state.elapsed / totalSeconds()) * 100 : 0;
const isVideoSource = () => {
  if (!state.currentSource) {
    if (state.activeTab === 0 && state.selectedFile) return state.selectedFile.type === "video";
    return true;
  }
  return ["local-video", "stream-video", "browser"].includes(state.currentSource.type);
};
const isActive = () => [STATES.PLAYING, STATES.WARNING, STATES.FLASH].includes(state.playState);

// ── yt-dlp check ──
async function checkYtdlp() {
  try {
    const result = await window.stagelit.checkYtdlp();
    if (result.found) {
      const src = result.type === "bundled" ? "bundled" : result.type === "python" ? "via Python" : "system";
      const ver = result.version && result.version !== "bundled" ? ` v${result.version}` : "";
      DOM.ytdlpStatus.innerHTML = `✅ <strong>yt-dlp${ver}</strong> (${src}) — no ads, direct playback`;
      DOM.ytdlpStatus.style.color = "rgba(34,197,94,0.8)";
    } else {
      DOM.ytdlpStatus.innerHTML =
        '⚠️ <strong>yt-dlp not found</strong> — run <code style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;">npm install</code> to auto-download, or use Browser Mode';
      DOM.ytdlpStatus.style.color = "rgba(245,158,11,0.8)";
    }
  } catch (e) {
    DOM.ytdlpStatus.textContent = "Could not check yt-dlp status";
  }
}
checkYtdlp();


// ═══════════════════════════════════════
// #3 — Audio-synced Equalizer (Web Audio API)
// ═══════════════════════════════════════

function initEqualizer(container, count) {
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const bar = document.createElement("div");
    bar.className = "eq-bar";
    container.appendChild(bar);
  }
}

// Persistent map: createMediaElementSource can only be called ONCE per element
const sourceNodeMap = new WeakMap();

function setupAudioAnalyser(mediaElement) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();

    // Get or create source node (ONCE per element, stored forever)
    if (sourceNodeMap.has(mediaElement)) {
      audioSourceNode = sourceNodeMap.get(mediaElement);
      try { audioSourceNode.disconnect(); } catch (e) {}
    } else {
      audioSourceNode = audioCtx.createMediaElementSource(mediaElement);
      sourceNodeMap.set(mediaElement, audioSourceNode);
    }

    // Fresh analyser each time
    if (analyser) { try { analyser.disconnect(); } catch (e) {} }
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -10;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    audioSourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    zeroFrames = 0;
  } catch (e) {
    console.log("[StageLit] Web Audio setup failed:", e.message);
    analyser = null;
    freqData = null;
    if (audioSourceNode) {
      try { audioSourceNode.connect(audioCtx.destination); } catch (e2) {}
    }
  }
}

function teardownAudioAnalyser() {
  if (analyser) {
    try { analyser.disconnect(); } catch (e) {}
    analyser = null;
  }
  if (audioSourceNode && audioCtx) {
    try { audioSourceNode.disconnect(); audioSourceNode.connect(audioCtx.destination); } catch (e) {}
  }
  freqData = null;
}

let eqAnimId = null;
let zeroFrames = 0;

function animateEqualizer() {
  if (!isActive()) return;

  const largeBars = DOM.eqLarge.children;
  const smallBars = DOM.eqSmall.children;
  let useAudioData = false;

  if (analyser && freqData) {
    analyser.getByteFrequencyData(freqData);
    let sum = 0;
    for (let i = 0; i < freqData.length; i++) sum += freqData[i];
    if (sum > 50) { zeroFrames = 0; useAudioData = true; }
    else { zeroFrames++; useAudioData = zeroFrames < 30; }
  }

  if (useAudioData) {
    const binCount = freqData.length;

    for (let i = 0; i < largeBars.length; i++) {
      const bS = Math.floor((i / largeBars.length) * binCount * 0.8);
      const bE = Math.floor(((i + 1) / largeBars.length) * binCount * 0.8);
      let mx = 0;
      for (let b = bS; b <= Math.min(bE, binCount - 1); b++) mx = Math.max(mx, freqData[b]);
      const v = mx / 255;
      largeBars[i].style.transform = `scaleY(${(0.05 + v * 0.95).toFixed(3)})`;
      largeBars[i].style.opacity = (0.3 + v * 0.7).toFixed(2);
    }

    for (let i = 0; i < smallBars.length; i++) {
      const bS = Math.floor((i / smallBars.length) * binCount * 0.85);
      const bE = Math.floor(((i + 1) / smallBars.length) * binCount * 0.85);
      let mx = 0;
      for (let b = bS; b <= Math.min(bE, binCount - 1); b++) mx = Math.max(mx, freqData[b]);
      const v = mx / 255;
      smallBars[i].style.transform = `scaleY(${(0.05 + v * 0.95).toFixed(3)})`;
      smallBars[i].style.opacity = (0.3 + v * 0.7).toFixed(2);
    }

    // Disc bass pulse
    let bass = 0;
    for (let i = 0; i < 10; i++) bass += freqData[i];
    bass /= (10 * 255);
    const disc = document.querySelector(".disc");
    if (disc) disc.style.setProperty("--disc-scale", (0.9 + bass * 0.3).toFixed(3));

    // Video glow
    let energy = 0;
    for (let i = 0; i < binCount; i++) energy += freqData[i];
    energy /= (binCount * 255);
    if (DOM.videoBox && !DOM.videoBox.classList.contains("hidden")) {
      DOM.videoBox.style.boxShadow = `0 0 ${(20 + energy * 40).toFixed(0)}px rgba(238,43,123,${(0.08 + energy * 0.3).toFixed(2)})`;
    }
  } else {
    // Fallback: smooth wave animation
    const t = performance.now() / 1000;
    for (let i = 0; i < largeBars.length; i++) {
      const w = 0.25 + 0.35 * Math.sin(t * 3 + i * 0.4) + 0.25 * Math.sin(t * 7 + i * 0.7) + Math.random() * 0.15;
      largeBars[i].style.transform = `scaleY(${w.toFixed(3)})`;
      largeBars[i].style.opacity = "0.75";
    }
    for (let i = 0; i < smallBars.length; i++) {
      const w = 0.2 + 0.3 * Math.sin(t * 4 + i * 0.5) + 0.2 * Math.sin(t * 9 + i * 0.8) + Math.random() * 0.2;
      smallBars[i].style.transform = `scaleY(${w.toFixed(3)})`;
      smallBars[i].style.opacity = "0.7";
    }
  }

  eqAnimId = requestAnimationFrame(animateEqualizer);
}

function startEqAnimation() { stopEqAnimation(); eqAnimId = requestAnimationFrame(animateEqualizer); }
function stopEqAnimation() {
  if (eqAnimId) cancelAnimationFrame(eqAnimId);
  eqAnimId = null;
  for (const bar of DOM.eqLarge.children) { bar.style.transform = "scaleY(0.1)"; bar.style.opacity = "0.3"; }
  for (const bar of DOM.eqSmall.children) { bar.style.transform = "scaleY(0.1)"; bar.style.opacity = "0.3"; }
  const disc = document.querySelector(".disc");
  if (disc) disc.style.setProperty("--disc-scale", "1");
  DOM.videoBox.style.boxShadow = "";
}

// ── Lock / unlock ──
function setLocked(locked) {
  [DOM.lockTabs, DOM.lockFiles, DOM.lockDuration].forEach((el) => {
    const existing = el.querySelector(".lock-overlay");
    if (locked && !existing) {
      const ov = document.createElement("div");
      ov.className = "lock-overlay";
      ov.innerHTML = '<div class="lock-label">🔒 Locked during playback</div>';
      el.appendChild(ov);
    } else if (!locked && existing) {
      existing.remove();
    }
  });
}

// ── Messages ──
function showMsg(text, type = "info", persistent = false) {
  DOM.statusMsg.innerHTML = text;
  DOM.statusMsg.className = `status-msg ${type}`;
  DOM.statusMsg.classList.remove("hidden");
  if (!persistent) setTimeout(() => DOM.statusMsg.classList.add("hidden"), 6000);
}
function hideMsg() { DOM.statusMsg.classList.add("hidden"); }

// ── UI Update ──
function updateUI() {
  const ps = state.playState;
  const active = isActive();
  const rem = remaining();
  const prog = progress();
  const vid = isVideoSource();

  // Status
  DOM.statusDot.className = "status-dot " + (
    ps === STATES.FLASH ? "flash" : ps === STATES.WARNING ? "warn" :
    active ? "live" : ps === STATES.COMPLETED ? "done" : "off"
  );
  DOM.statusText.textContent =
    ps === STATES.COMPLETED ? "Completed" : ps === STATES.FLASH ? "Ending!" :
    ps === STATES.WARNING ? "Ending Soon" : active ? "Live" : "Ready";
  DOM.statusText.style.color =
    ps === STATES.FLASH ? "#ef4444" : ps === STATES.WARNING ? "#f59e0b" :
    ps === STATES.COMPLETED ? "#22c55e" : "";

  setLocked(active);

  // Play button
  if (ps === STATES.IDLE) {
    DOM.playBtn.className = "play-btn go";
    DOM.playBtn.textContent = "▶ Start Performance";
    DOM.playBtn.disabled = !(state.activeTab === 0 ? state.selectedFile : state.youtubeUrl.trim());
  } else if (ps === STATES.COMPLETED) {
    DOM.playBtn.className = "play-btn complete";
    DOM.playBtn.textContent = "🎵 Select New Song";
    DOM.playBtn.disabled = false;
  } else {
    DOM.playBtn.className = "play-btn halt";
    DOM.playBtn.textContent = "■ Stop Playback";
    DOM.playBtn.disabled = false;
  }

  const isBrowser = state.currentSource?.type === "browser";

  // Sections
  DOM.videoBox.classList.toggle("hidden", !active || isBrowser);
  DOM.videoBox.classList.toggle("active", active && !isBrowser);
  DOM.nowCard.classList.toggle("hidden", !active);
  DOM.nowCard.className = `now-card${ps === STATES.FLASH ? " flash-card" : ps === STATES.WARNING ? " warn-card" : ""}${!active ? " hidden" : ""}`;
  DOM.idleState.classList.toggle("hidden", ps !== STATES.IDLE);
  DOM.hints.classList.toggle("hidden", ps !== STATES.IDLE);
  DOM.completedCard.classList.toggle("hidden", ps !== STATES.COMPLETED);
  DOM.browserCard.classList.toggle("hidden", !(active && isBrowser));
  if (active && isBrowser) DOM.browserUrl.textContent = state.youtubeUrl || "—";

  // Warning / flash banners
  DOM.warningBanner.classList.toggle("hidden", ps !== STATES.WARNING);
  if (ps === STATES.WARNING) DOM.warningTime.textContent = `${rem}s`;

  DOM.flashBanner.classList.toggle("hidden", ps !== STATES.FLASH);
  if (ps === STATES.FLASH) {
    DOM.flashBanner.className = `flash-inline-banner ${state.flashOn ? "on" : "off"}`;
    DOM.flashInlineTime.textContent = `${rem}s`;
  }

  // #1 — Flash overlay (timer now positioned bottom-left via CSS)
  if (ps === STATES.FLASH) {
    DOM.flashOverlay.classList.remove("hidden");
    DOM.flashOverlay.className = `flash-overlay ${state.flashOn ? "on" : "off"}`;
    DOM.flashBigTime.textContent = rem;
  } else {
    DOM.flashOverlay.classList.add("hidden");
  }

  // Progress ring
  const circ = 2 * Math.PI * 49;
  DOM.progressCircle.style.strokeDashoffset = circ - (prog / 100) * circ;
  DOM.progressCircle.setAttribute("stroke", (ps === STATES.FLASH || ps === STATES.WARNING) ? "url(#prWarn)" : "url(#prGrad)");

  DOM.ringElapsed.textContent = formatTime(state.elapsed);
  DOM.ringRemaining.textContent = `-${formatTime(rem)}`;
  DOM.ringElapsed.style.color =
    ps === STATES.FLASH ? (state.flashOn ? "#ef4444" : "rgba(239,68,68,0.4)") :
    ps === STATES.WARNING ? "#f59e0b" : "#ff6b2b";

  // Track info
  const name = state.activeTab === 0 ? (state.selectedFile?.name || "—") : (state.youtubeUrl || "Online Stream");
  DOM.trackName.textContent = name;
  DOM.trackBadge.textContent = vid ? "Video" : "Audio";
  DOM.trackBadge.className = `badge ${vid ? "vid" : "aud"}`;

  // Show duration info if media is shorter than configured
  if (active && state.mediaDuration && state.mediaDuration < state.duration * 60 && state.currentSource?.type !== "browser") {
    DOM.trackBadge.textContent += ` · ${formatTime(state.mediaDuration)} long`;
  }

  // Seekbar
  DOM.seekbarFill.style.width = `${prog}%`;
  DOM.seekbarKnob.style.left = `${prog}%`;
  DOM.timeElapsed.textContent = formatTime(state.elapsed);
  DOM.timeTotal.textContent = formatTime(totalSeconds());

  // Media visibility
  if (active && state.currentSource) {
    DOM.localVideo.classList.toggle("hidden", !["local-video", "stream-video"].includes(state.currentSource.type));
    DOM.audioViz.classList.toggle("hidden", !["local-audio", "stream-audio"].includes(state.currentSource.type));
  }

  // Completed
  if (ps === STATES.COMPLETED) {
    DOM.completedSub.innerHTML = `${name}<br>Played for ${formatTime(state.elapsed)}`;
  }
}

// ── Timers ──
function startPlaybackTimer() {
  stopPlaybackTimer();
  state.playbackTimer = setInterval(() => {
    state.elapsed++;
    const total = totalSeconds();
    if (state.elapsed >= total) {
      stopPlayback(); state.playState = STATES.COMPLETED; updateUI(); return;
    }
    const rem = total - state.elapsed;
    if (rem <= 15 && state.playState !== STATES.FLASH) { state.playState = STATES.FLASH; startFlashTimer(); }
    else if (rem <= 30 && rem > 15 && state.playState === STATES.PLAYING) { state.playState = STATES.WARNING; }
    updateUI();
  }, 1000);
}
function stopPlaybackTimer() { if (state.playbackTimer) clearInterval(state.playbackTimer); state.playbackTimer = null; }
function startFlashTimer() { stopFlashTimer(); state.flashTimer = setInterval(() => { state.flashOn = !state.flashOn; updateUI(); }, 500); }
function stopFlashTimer() { if (state.flashTimer) clearInterval(state.flashTimer); state.flashTimer = null; state.flashOn = true; }

// ═══════════════════════════════════════
// #2 — Detect media duration
// ═══════════════════════════════════════

function detectMediaDuration(mediaEl) {
  return new Promise((resolve) => {
    if (mediaEl.duration && isFinite(mediaEl.duration) && mediaEl.duration > 0) {
      resolve(mediaEl.duration);
      return;
    }
    const handler = () => {
      mediaEl.removeEventListener("loadedmetadata", handler);
      if (isFinite(mediaEl.duration) && mediaEl.duration > 0) {
        resolve(mediaEl.duration);
      } else {
        resolve(null);
      }
    };
    mediaEl.addEventListener("loadedmetadata", handler);
    // Timeout fallback
    setTimeout(() => { mediaEl.removeEventListener("loadedmetadata", handler); resolve(null); }, 5000);
  });
}

// ── Playback ──
async function startPlayback() {
  state.elapsed = 0;
  state.mediaDuration = null;
  state.playState = STATES.PLAYING;
  hideMsg();

  let mediaEl = null; // The element we'll connect to Web Audio

  if (state.activeTab === 0 && state.selectedFile) {
    const file = state.selectedFile;
    if (file.type === "video") {
      state.currentSource = { type: "local-video" };
      DOM.localVideo.src = file.path;
      DOM.localVideo.currentTime = 0;
      state.mediaDuration = await detectMediaDuration(DOM.localVideo);
      try { await DOM.localVideo.play(); } catch (e) {}
      mediaEl = DOM.localVideo;
    } else {
      state.currentSource = { type: "local-audio" };
      DOM.localAudio.src = file.path;
      DOM.localAudio.currentTime = 0;
      state.mediaDuration = await detectMediaDuration(DOM.localAudio);
      try { await DOM.localAudio.play(); } catch (e) {}
      mediaEl = DOM.localAudio;
    }
  } else if (state.activeTab === 1 && state.youtubeUrl.trim()) {
    const url = state.youtubeUrl.trim();
    const urlInfo = await window.stagelit.detectUrlType(url);

    if (urlInfo.isDirectMedia) {
      state.currentSource = { type: "stream-video" };
      DOM.localVideo.src = url;
      DOM.localVideo.currentTime = 0;
      state.mediaDuration = await detectMediaDuration(DOM.localVideo);
      try { await DOM.localVideo.play(); } catch (e) {}
      mediaEl = DOM.localVideo;
    } else if (state.playMode === "browser") {
      state.currentSource = { type: "browser" };
      const result = await window.stagelit.openBrowserMode(url);
      if (!result.success) {
        showMsg("Failed to open browser window", "error");
        state.playState = STATES.IDLE; state.currentSource = null; updateUI(); return;
      }
    } else {
      showMsg("⏳ Downloading video via yt-dlp (0%)...", "info", true);
      DOM.playBtn.disabled = true;
      DOM.playBtn.textContent = "⏳ Downloading...";

      window.stagelit.onDownloadProgress((data) => {
        DOM.statusMsg.innerHTML = `⏳ Downloading: <strong>${data.percent.toFixed(0)}%</strong>`;
        DOM.playBtn.textContent = `⏳ ${data.percent.toFixed(0)}%`;
      });
      updateUI();

      const result = await window.stagelit.downloadVideo(url);
      window.stagelit.removeDownloadProgress();

      if (result.success) {
        hideMsg();
        state.currentSource = { type: "stream-video", tempFile: result.filePath };
        DOM.localVideo.src = result.filePath;
        DOM.localVideo.currentTime = 0;
        state.mediaDuration = await detectMediaDuration(DOM.localVideo);

        DOM.localVideo.onerror = () => {
          showMsg("Downloaded file could not be played.", "error"); handleStop();
        };
        try { await DOM.localVideo.play(); } catch (e) {
          showMsg("Could not play the downloaded video.", "error"); handleStop(); return;
        }
        mediaEl = DOM.localVideo;
      } else {
        showMsg(result.error, "error");
        state.playState = STATES.IDLE; state.currentSource = null; updateUI(); return;
      }
    }
  }

  // #3 — Connect to Web Audio API for frequency analysis
  if (mediaEl) {
    setupAudioAnalyser(mediaEl);
  }

  initEqualizer(DOM.eqLarge, 48);
  initEqualizer(DOM.eqSmall, 64);
  startPlaybackTimer();
  startEqAnimation();
  updateUI();

  // Show smart duration info
  if (state.fullSong && state.mediaDuration) {
    showMsg(`Full Song mode — playing entire ${formatTime(state.mediaDuration)} track.`, "info");
  } else if (state.mediaDuration && state.mediaDuration < state.duration * 60) {
    showMsg(`Song is ${formatTime(state.mediaDuration)} — shorter than ${state.duration} min. Using actual length.`, "info");
  }
}

function resetFullSong() {
  if (state.fullSong) {
    state.fullSong = false;
    DOM.fullSongCheck.checked = false;
    DOM.durationSlider.classList.remove("dimmed");
    DOM.durationSlider.parentElement.querySelector(".dur-display").classList.remove("dimmed");
    DOM.fullSongHint.textContent = "Play entire track length";
    hideMsg();
  }
}

function stopPlayback() {
  stopPlaybackTimer(); stopFlashTimer(); stopEqAnimation();
  teardownAudioAnalyser();
  window.stagelit.cancelDownload();
  window.stagelit.removeDownloadProgress();
  window.stagelit.closeBrowserMode();
  DOM.localVideo.pause(); DOM.localVideo.removeAttribute("src"); DOM.localVideo.load(); DOM.localVideo.onerror = null;
  DOM.localAudio.pause(); DOM.localAudio.removeAttribute("src"); DOM.localAudio.load();
  window.stagelit.cleanupTemp();
  state.currentSource = null;
  state.mediaDuration = null;
  resetFullSong();
}

function handleStop() { stopPlayback(); state.playState = STATES.IDLE; state.elapsed = 0; hideMsg(); updateUI(); }

function handleNewSong() {
  stopPlayback(); state.playState = STATES.IDLE; state.elapsed = 0;
  hideMsg(); updateUI();
}

function handleSeek(targetTime) {
  state.elapsed = targetTime;
  const rem = totalSeconds() - targetTime;
  if (["local-video", "stream-video"].includes(state.currentSource?.type)) DOM.localVideo.currentTime = targetTime;
  else if (["local-audio", "stream-audio"].includes(state.currentSource?.type)) DOM.localAudio.currentTime = targetTime;
  if (rem <= 15) { if (state.playState !== STATES.FLASH) { state.playState = STATES.FLASH; startFlashTimer(); } }
  else if (rem <= 30) { stopFlashTimer(); state.playState = STATES.WARNING; }
  else { stopFlashTimer(); state.playState = STATES.PLAYING; }
  updateUI();
}

// ── Events ──
DOM.tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (isActive()) return;
    const tab = parseInt(btn.dataset.tab);
    state.activeTab = tab;
    DOM.tabBtns.forEach((b) => b.classList.toggle("active", parseInt(b.dataset.tab) === tab));
    DOM.tabPanels.forEach((p, i) => p.classList.toggle("hidden", i !== tab));
    resetFullSong();
    updateUI();
  });
});

DOM.modeOptions.forEach((opt) => {
  opt.addEventListener("click", () => {
    if (isActive()) return;
    const mode = opt.dataset.mode;
    state.playMode = mode;
    DOM.modeOptions.forEach((o) => o.classList.toggle("active", o.dataset.mode === mode));
    DOM.ytdlpInfo.style.display = mode === "download" ? "" : "none";
    resetFullSong();
    updateUI();
  });
});

window.stagelit.onBrowserModeClosed(() => {
  if (state.currentSource?.type === "browser" && isActive()) {
    stopPlayback(); state.playState = STATES.COMPLETED; updateUI();
  }
});

DOM.browseBtn.addEventListener("click", async () => {
  if (isActive()) return;
  const folder = await window.stagelit.selectFolder();
  if (!folder) return;
  state.folderPath = folder;
  DOM.folderPath.value = folder;
  const result = await window.stagelit.scanFolder(folder);
  if (result.success) {
    state.files = result.files;
    DOM.fileSelect.innerHTML = '<option value="">— Choose a file —</option>';
    result.files.forEach((f, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${f.type === "video" ? "🎬" : "🎵"} ${f.name}`;
      DOM.fileSelect.appendChild(opt);
    });
    if (!result.files.length) showMsg("No media files found in this folder", "info");
  } else {
    showMsg(`Error: ${result.error}`, "error");
  }
  updateUI();
});

DOM.fileSelect.addEventListener("change", () => {
  if (isActive()) return;
  state.selectedFile = DOM.fileSelect.value !== "" ? state.files[parseInt(DOM.fileSelect.value)] : null;
  if (state.playState === STATES.COMPLETED) state.playState = STATES.IDLE;
  updateUI();
});

DOM.urlInput.addEventListener("input", () => {
  if (isActive()) return;
  state.youtubeUrl = DOM.urlInput.value;
  if (state.playState === STATES.COMPLETED) state.playState = STATES.IDLE;
  updateUI();
});

DOM.durationSlider.addEventListener("input", () => {
  if (isActive()) return;
  state.duration = parseFloat(DOM.durationSlider.value);
  DOM.durVal.textContent = state.duration;
});

// Full Song toggle
DOM.fullSongCheck.addEventListener("change", () => {
  if (isActive()) { DOM.fullSongCheck.checked = state.fullSong; return; }
  state.fullSong = DOM.fullSongCheck.checked;
  DOM.durationSlider.classList.toggle("dimmed", state.fullSong);
  DOM.durationSlider.parentElement.querySelector(".dur-display").classList.toggle("dimmed", state.fullSong);
  DOM.fullSongHint.textContent = state.fullSong ? "Plays entire track length" : "Play entire track length";
  if (state.fullSong) {
    showMsg("⚠️ Full Song mode — StageLit is designed for timed performances. This bypasses the time limit and resets after playback.", "error");
  } else {
    hideMsg();
  }
});

DOM.playBtn.addEventListener("click", () => {
  if (state.playState === STATES.IDLE) startPlayback();
  else if (state.playState === STATES.COMPLETED) handleNewSong();
  else handleStop();
});

DOM.newSongBtn.addEventListener("click", handleNewSong);

// Seekbar
DOM.seekbarWrap.addEventListener("mouseenter", () => { DOM.seekbarHoverLine.classList.remove("hidden"); DOM.seekbarTooltip.classList.remove("hidden"); });
DOM.seekbarWrap.addEventListener("mouseleave", () => { DOM.seekbarHoverLine.classList.add("hidden"); DOM.seekbarTooltip.classList.add("hidden"); });
DOM.seekbarWrap.addEventListener("mousemove", (e) => {
  const rect = DOM.seekbarWrap.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  DOM.seekbarHoverLine.style.left = `${x}px`;
  DOM.seekbarTooltip.style.left = `${x}px`;
  DOM.seekbarTooltip.textContent = formatTime(Math.floor((x / rect.width) * totalSeconds()));
});
DOM.seekbarWrap.addEventListener("click", (e) => {
  if (!isActive() || state.currentSource?.type === "browser") return;
  const rect = DOM.seekbarWrap.getBoundingClientRect();
  handleSeek(Math.floor(((Math.max(0, Math.min(e.clientX - rect.left, rect.width))) / rect.width) * totalSeconds()));
});

// ── Init ──
initEqualizer(DOM.eqLarge, 48);
initEqualizer(DOM.eqSmall, 64);
updateUI();
