const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prismDesktop', {
  isDesktop: true,

  captureScreen: () => ipcRenderer.invoke('prism:capture-screen'),

  listWindows: () => ipcRenderer.invoke('prism:list-windows'),

  captureWindow: (sourceId) => ipcRenderer.invoke('prism:capture-window', sourceId),

  captureRegion: () => ipcRenderer.invoke('prism:capture-region'),

  setPin: (pin) => ipcRenderer.invoke('prism:set-pin', pin),

  setSize: (w, h) => ipcRenderer.invoke('prism:set-size', w, h),

  writeText: (text) => ipcRenderer.invoke('prism:write', text),

  hide: () => ipcRenderer.send('prism:hide'),
  openFullApp: () => ipcRenderer.send('prism:open-full'),

  onQuickAsk: (cb) => {
    const listener = (_e, text) => cb(text);
    ipcRenderer.on('prism:quick-ask', listener);
    return () => ipcRenderer.removeListener('prism:quick-ask', listener);
  },

  onToggleWatch: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('prism:toggle-watch', listener);
    return () => ipcRenderer.removeListener('prism:toggle-watch', listener);
  },

  onFocusBar: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('prism:focus-bar', listener);
    return () => ipcRenderer.removeListener('prism:focus-bar', listener);
  },

  writeGetSelection: () => ipcRenderer.invoke('prism:write-selection'),
  writePasteBack: (text) => ipcRenderer.invoke('prism:write-back', text),
  writeCancel: () => ipcRenderer.send('prism:write-cancel'),
});
