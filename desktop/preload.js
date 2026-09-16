const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal, capability-scoped bridge: the overlay page can ask the main
 * process for captures and window chrome — it cannot reach the OS itself.
 */
contextBridge.exposeInMainWorld('prismDesktop', {
  isDesktop: true,

  /** Full-screen PNG data URL of the display the panel is on. */
  captureScreen: () => ipcRenderer.invoke('prism:capture-screen'),

  /** [{ id, name, thumbnail }] for every capturable window. */
  listWindows: () => ipcRenderer.invoke('prism:list-windows'),

  /** PNG data URL of one window (picked from listWindows). */
  captureWindow: (sourceId) => ipcRenderer.invoke('prism:capture-window', sourceId),

  /** Opens the drag-select overlay over the screen → cropped PNG data URL or null. */
  captureRegion: () => ipcRenderer.invoke('prism:capture-region'),

  /** Keep (or stop keeping) the panel above other windows. Returns current state. */
  setPin: (pin) => ipcRenderer.invoke('prism:set-pin', pin),

  hide: () => ipcRenderer.send('prism:hide'),
  openFullApp: () => ipcRenderer.send('prism:open-full'),
});
