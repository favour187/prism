const { contextBridge, ipcRenderer } = require('electron');

/** Bridge for the always-on-top HUD windows (edge line + circle launcher). */
contextBridge.exposeInMainWorld('prismHud', {
  toggleOverlay: () => ipcRenderer.send('hud:toggle-overlay'),
  openMainApp: () => ipcRenderer.send('hud:open-main'),
  dragEdge: (dy) => ipcRenderer.send('hud:drag-edge', dy),
  endDrag: () => ipcRenderer.send('hud:drag-end'),
});
