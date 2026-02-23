const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stagelit", {
  // File operations
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  scanFolder: (path) => ipcRenderer.invoke("scan-folder", path),

  // Online playback — download mode
  downloadVideo: (url) => ipcRenderer.invoke("download-video", url),
  cancelDownload: () => ipcRenderer.invoke("cancel-download"),
  cleanupTemp: () => ipcRenderer.invoke("cleanup-temp"),
  detectUrlType: (url) => ipcRenderer.invoke("detect-url-type", url),
  checkYtdlp: () => ipcRenderer.invoke("check-ytdlp"),
  onDownloadProgress: (callback) => {
    ipcRenderer.on("download-progress", (event, data) => callback(data));
  },
  removeDownloadProgress: () => {
    ipcRenderer.removeAllListeners("download-progress");
  },

  // Online playback — browser mode
  openBrowserMode: (url) => ipcRenderer.invoke("open-browser-mode", url),
  closeBrowserMode: () => ipcRenderer.invoke("close-browser-mode"),
  isBrowserModeOpen: () => ipcRenderer.invoke("is-browser-mode-open"),
  onBrowserModeClosed: (callback) => {
    ipcRenderer.on("browser-mode-closed", () => callback());
  },
  removeBrowserModeClosed: () => {
    ipcRenderer.removeAllListeners("browser-mode-closed");
  },

  // Misc
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
