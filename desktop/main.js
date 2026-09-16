/**
 * Optional Electron desktop shell for Prism.
 *
 * What it adds over the pure web app:
 *  - TRUE global keyboard shortcut (Ctrl/⌘+Shift+A) that surfaces the
 *    assistant even when another app is focused.
 *  - An optional always-on-top, frameless-lite floating window.
 *
 * The web app itself (capture, chat, files, OCR) works unchanged inside the
 * shell. Run alongside the web dev server:
 *   npm --prefix desktop install && npm --prefix desktop run dev
 */
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');

const PRISM_URL = process.env.PRISM_URL ?? 'http://localhost:5173';
const SHORTCUT = process.env.PRISM_SHORTCUT ?? 'CommandOrControl+Shift+A';

let win = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 420,
    height: 680,
    x: width - 448,
    y: 28,
    minWidth: 360,
    minHeight: 480,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    title: 'Prism — Screen Assistant',
    webPreferences: {
      preload: require('node:path').join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(PRISM_URL);
  win.on('closed', () => { win = null; });
}

function registerShortcuts() {
  globalShortcut.register(SHORTCUT, () => {
    if (!win) return createWindow();
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
    // Tell the web app to toggle its assistant panel as well.
    win.webContents.executeJavaScript(
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', ctrlKey: true, shiftKey: true, bubbles: true }));",
      true,
    ).catch(() => {});
  });
}

app.whenReady().then(() => {
  createWindow();
  registerShortcuts();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('prism:toggle-always-on-top', () => {
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next);
  return next;
});
