/**
 * Prism Desktop — Arc-style floating screen assistant.
 *
 *  • Frameless, always-on-top mini window that floats over your apps.
 *  • GLOBAL hotkey Ctrl/⌘+Shift+A toggles it from anywhere in the OS.
 *  • One-click capture: full screen, a specific window, or a drag-select
 *    region (transparent selector appears over your screen, like snipping).
 *  • The panel itself backs off while capturing so it never photobombs.
 *  • Nothing is ever recorded — one frame per explicit click.
 *
 * Runs against any Prism server:
 *   npm install && npm start                 → uses https://prism-yks3.onrender.com
 *   PRISM_URL=http://localhost:5173 npm run dev
 */
const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, shell } = require('electron');
const path = require('node:path');

const PRISM_URL = (process.env.PRISM_URL ?? 'https://prism-yks3.onrender.com').replace(/\/$/, '');
const SHORTCUT = process.env.PRISM_SHORTCUT ?? 'CommandOrControl+Shift+A';
const WINDOW_W = Number(process.env.PRISM_WIDTH ?? 440);
const WINDOW_H = Number(process.env.PRISM_HEIGHT ?? 720);

let win = null;
let regionWin = null;
let regionResolve = null;

const distDir = path.join(__dirname, '..', 'client', 'dist');
const localDistIndex = path.join(distDir, 'index.html');
const fs = require('node:fs');

async function loadOverlay(browserWindow) {
  // Prefer the live web app; fall back to a locally built dist (offline dev with the API on :4000).
  if (process.env.PRISM_URL || !fs.existsSync(localDistIndex)) {
    await browserWindow.loadURL(`${PRISM_URL}/?overlay=1`);
  } else {
    await browserWindow.loadFile(localDistIndex, { search: 'overlay=1' });
  }
}

function currentDisplay() {
  if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds());
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;

  win = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    x: x + width - WINDOW_W - 16,
    y: y + 16,
    minWidth: 380,
    minHeight: 480,
    frame: false,
    show: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#0e1016',
    title: 'Prism',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Answer is rendered locally; captures are done by the main process —
      // renderer never gets session-level screen access by default.
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(`${PRISM_URL}/?overlay=1`);

  win.on('closed', () => {
    win = null;
  });
}

function toggleWindow() {
  if (!win) return createWindow();
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

/** Hide the panel, wait for compositing, capture, restore. */
async function withHiddenWindow(fn) {
  const wasVisible = win?.isVisible();
  if (wasVisible) win.hide();
  await new Promise((r) => setTimeout(r, 220));
  try {
    return await fn();
  } finally {
    if (wasVisible && win && !win.isDestroyed()) win.show();
  }
}

async function captureDisplayDataUrl(display) {
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  // Prefer the source matching this display (Electron exposes display_id as string).
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0];
  if (!source) throw new Error('No screen source available for capture.');
  const dataUrl = source.thumbnail.toDataURL();
  if (!source.thumbnail.getSize().width) throw new Error('Screen capture returned an empty frame (check screen-recording permission).');
  return { dataUrl, width: source.thumbnail.getSize().width, height: source.thumbnail.getSize().height, scale };
}

// ------------------------------- IPC ---------------------------------------

ipcMain.handle('prism:capture-screen', () =>
  withHiddenWindow(async () => {
    const { dataUrl } = await captureDisplayDataUrl(currentDisplay());
    return dataUrl;
  }),
);

ipcMain.handle('prism:list-windows', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 360, height: 225 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((s) => !/^prism/i.test(s.name)) // don't offer to capture ourselves
    .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

ipcMain.handle('prism:capture-window', (_e, sourceId) =>
  withHiddenWindow(async () => {
    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) },
    });
    const source = sources.find((s) => s.id === sourceId);
    if (!source) throw new Error('Window is gone — pick it again.');
    if (!source.thumbnail.getSize().width) throw new Error('Empty window capture (minimized or protected).');
    return source.thumbnail.toDataURL();
  }),
);

ipcMain.handle('prism:capture-region', () =>
  withHiddenWindow(async () => {
    const display = currentDisplay();
    const frame = await captureDisplayDataUrl(display);
    return new Promise((resolve) => {
      regionResolve = resolve;
      const { x, y, width, height } = display.bounds;
      regionWin = new BrowserWindow({
        x, y, width, height,
        frame: false,
        show: false,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        fullscreenable: true,
        skipTaskbar: true,
        backgroundColor: '#000000',
        webPreferences: {
          preload: path.join(__dirname, 'region-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      regionWin.setAlwaysOnTop(true, 'screen-saver');
      regionWin.once('ready-to-show', () => {
        regionWin.show();
        regionWin.focus();
        regionWin.webContents.send('region:frame', frame);
      });
      regionWin.on('closed', () => {
        regionWin = null;
        if (regionResolve) {
          regionResolve(null); // closed without a selection
          regionResolve = null;
        }
      });
      regionWin.loadFile(path.join(__dirname, 'region.html'));
    });
  }),
);

ipcMain.on('region:result', (_e, dataUrl) => {
  if (regionResolve) {
    regionResolve(dataUrl || null);
    regionResolve = null;
  }
  if (regionWin && !regionWin.isDestroyed()) regionWin.close();
});

ipcMain.handle('prism:set-pin', (_e, pin) => {
  if (!win) return Boolean(pin);
  win.setAlwaysOnTop(Boolean(pin), 'floating');
  return Boolean(pin);
});

ipcMain.on('prism:hide', () => win?.hide());
ipcMain.on('prism:open-full', () => shell.openExternal(PRISM_URL));

// ------------------------------- lifecycle ---------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    createWindow();
    const ok = globalShortcut.register(SHORTCUT, toggleWindow);
    if (!ok) console.warn('[prism-desktop] could not register', SHORTCUT);
  });

  // Assistant-style: closing windows keeps the daemon alive (reopen via hotkey).
  app.on('window-all-closed', () => { /* stay resident */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('activate', () => { if (!win) createWindow(); });
}
