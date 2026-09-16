const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prismRegion', {
  onFrame: (cb) => ipcRenderer.once('region:frame', (_e, frame) => cb(frame)),
  finish: (dataUrlOrNull) => ipcRenderer.send('region:result', dataUrlOrNull),
});
