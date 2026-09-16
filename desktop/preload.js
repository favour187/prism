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

  /** Resize the panel. Returns the applied { w, h }. */
  setSize: (w, h) => ipcRenderer.invoke('prism:set-size', w, h),

  /**
   * "Insert into app": sets the clipboard and, when supported, simulates a
   * paste keystroke into the app you were just using. Returns { copied, pasted }.
   */
  writeText: (text) => ipcRenderer.invoke('prism:write', text),

  hide: () => ipcRenderer.send('prism:hide'),
  openFullApp: () => ipcRenderer.send('prism:open-full'),

  /** ⌘⇧G "ask about selection" — payload arrives here; cb(text). Returns an unsubscribe fn. */
  onQuickAsk: (cb) => {
    const listener = (_e, text) => cb(text);
    ipcRenderer.on('prism:quick-ask', listener);
    return () => ipcRenderer.removeListener('prism:quick-ask', listener);
  },

  /** ⌘⇧W global watch toggle; cb(). Returns an unsubscribe fn. */
  onToggleWatch: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('prism:toggle-watch', listener);
    return () => ipcRenderer.removeListener('prism:toggle-watch', listener);
  },

  // ---- inline Write bar (⌘⇧R window) ----
  /** Text that was selected in the source app when the bar opened. */
  writeGetSelection: () => ipcRenderer.invoke('prism:write-selection'),
  /** Paste the rewritten text back into the source app; returns { copied, pasted }. */
  writePasteBack: (text) => ipcRenderer.invoke('prism:write-back', text),
  /** Close the bar and restore the previous clipboard. */
  writeCancel: () => ipcRenderer.send('prism:write-cancel'),
});
