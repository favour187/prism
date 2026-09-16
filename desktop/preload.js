const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prismDesktop', {
  toggleAlwaysOnTop: () => ipcRenderer.invoke('prism:toggle-always-on-top'),
});
