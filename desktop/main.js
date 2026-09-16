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
const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, shell, session, clipboard } = require('electron');
const path = require('node:path');

// Optional: true keystroke paste for "Insert into app". Gracefully degrades
// to clipboard-only if the prebuilt binary is unavailable for this platform.
let robot = null;
try {
  // eslint-disable-next-line global-require
  robot = require('@jitsi/robotjs');
} catch {
  robot = null;
}

const PRISM_URL = (process.env.PRISM_URL ?? 'https://prism-yks3.onrender.com').replace(/\/$/, '');
const SHORTCUT = process.env.PRISM_SHORTCUT ?? 'CommandOrControl+Shift+A';
const WINDOW_W = Number(process.env.PRISM_WIDTH ?? 440);
const WINDOW_H = Number(process.env.PRISM_HEIGHT ?? 720);

let win = null;
let regionWin = null;
let regionResolve = null;

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

const SIZE_LIMITS = { minW: 340, maxW: 1600, minH: 420, maxH: 1600 };

ipcMain.handle('prism:set-size', (_e, w, h) => {
  if (!win || win.isDestroyed()) return null;
  const width = Math.max(SIZE_LIMITS.minW, Math.min(SIZE_LIMITS.maxW, Math.round(Number(w) || win.getSize()[0])));
  const height = Math.max(SIZE_LIMITS.minH, Math.min(SIZE_LIMITS.maxH, Math.round(Number(h) || win.getSize()[1])));
  win.setSize(width, height);
  return { w: width, h: height };
});

/**
 * "Insert into app": puts the text on the clipboard, hides the panel so the
 * previously focused app regains focus, and — when the optional robot module
 * is available (and macOS Accessibility permission was granted) — simulates
 * a genuine paste keystroke into that app.
 */
ipcMain.handle('prism:write', (_e, text) => {
  const payload = String(text ?? '').slice(0, 1_000_000);
  clipboard.writeText(payload);
  if (robot && win && !win.isDestroyed()) {
    win.hide();
    setTimeout(() => {
      try {
        robot.keyTap('v', process.platform === 'darwin' ? 'command' : 'control');
      } catch { /* accessibility permission missing — clipboard is still set */ }
      setTimeout(() => win && !win.isDestroyed() && win.show(), 350);
    }, 320);
    return { copied: true, pasted: true };
  }
  return { copied: true, pasted: false };
});

// -------------------- inline write bar (Arc-style, any app) -----------------
// ⌘/Ctrl+Shift+R grabs the selection in WHATEVER app is focused, opens the
// floating write bar, style chips rewrite it, and Enter pastes the rewrite
// straight back into the source app. No panel context-switch.

let writeWin = null;
let writeSelection = { text: '', previous: '' };
let writeDidPaste = false;

const MOD = process.platform === 'darwin' ? 'command' : 'control';

/** Simulate copy, read the clipboard, preserve what was there. */
async function grabSelection() {
  const previous = clipboard.readText();
  let text = previous; // graceful path: robot missing → treat clipboard as selection
  if (robot) {
    try {
      robot.keyTap('c', MOD);
      await new Promise((r) => setTimeout(r, 240));
      const after = clipboard.readText();
      text = after === previous ? '' : after;
    } catch {
      text = previous; // no Accessibility permission — clipboard stays intact
    }
  }
  return { text: String(text ?? ''), previous: String(previous ?? '') };
}

function openWriteBar() {
  if (writeWin && !writeWin.isDestroyed()) {
    writeWin.close();
    return; // second press toggles it away
  }
  grabSelection().then((sel) => {
    writeSelection = sel;
    writeDidPaste = false;
    const point = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const W = 500;
    const H = 330;
    writeWin = new BrowserWindow({
      width: W,
      height: H,
      x: Math.min(Math.max(point.x - W / 2, area.x + 8), area.x + area.width - W - 8),
      y: Math.min(Math.max(point.y - 24, area.y + 8), area.y + area.height - H - 8),
      frame: false,
      show: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: '#0e1016',
      title: 'Prism Write',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    writeWin.setAlwaysOnTop(true, 'floating');
    writeWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    writeWin.loadURL(`${PRISM_URL}/?writebar=1`);
    writeWin.once('ready-to-show', () => writeWin?.show());
    writeWin.on('closed', () => {
      writeWin = null;
      if (!writeDidPaste && writeSelection.previous) {
        clipboard.writeText(writeSelection.previous); // never clobber the user's clipboard on cancel
      }
    });
    // Arc popovers go away when you click elsewhere.
    writeWin.on('blur', () => {
      setTimeout(() => {
        if (writeWin && !writeWin.isDestroyed() && !writeWin.isFocused()) writeWin.close();
      }, 250);
    });
  });
}

ipcMain.handle('prism:write-selection', () => ({
  text: writeSelection.text,
  clipboardBacked: !robot || Boolean(writeSelection.text && writeSelection.text === writeSelection.previous),
}));

ipcMain.handle('prism:write-back', (_e, text) => {
  const payload = String(text ?? '').slice(0, 1_000_000);
  writeDidPaste = true;
  clipboard.writeText(payload);
  const w = writeWin;
  if (w && !w.isDestroyed()) w.hide(); // source app regains focus
  let pasted = false;
  if (robot) {
    pasted = true;
    setTimeout(() => {
      try {
        robot.keyTap('v', MOD);
      } catch { /* accessibility missing — clipboard is still set */ }
      if (w && !w.isDestroyed()) w.close();
    }, 260);
  } else if (w && !w.isDestroyed()) {
    w.close();
  }
  return { copied: true, pasted };
});

ipcMain.on('prism:write-cancel', () => {
  writeDidPaste = false;
  if (writeWin && !writeWin.isDestroyed()) writeWin.close();
});

/** Show the overlay and hand it a payload over IPC (once it has a listener). */
function presentOverlay(channel, payload) {
  if (!win || win.isDestroyed()) createWindow();
  const deliver = () => {
    win.show();
    win.focus();
    if (channel) win.webContents.send(channel, payload);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }
}

// ------------------------------- lifecycle ---------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    // Voice input (getUserMedia mic) and TTS are part of the assistant UX.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media' || permission === 'audioCapture' || permission === 'speaker-selection');
    });

    // Watch mode needs a getDisplayMedia stream. Electron 31+ can show the
    // native system picker; otherwise we grant the primary screen source.
    if (session.defaultSession.setDisplayMediaRequestHandler) {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 64 } })
          .then((sources) => callback({ video: sources[0], audio: false }))
          .catch(() => callback({}));
      });
    }

    createWindow();
    const ok = globalShortcut.register(SHORTCUT, toggleWindow);
    if (!ok) console.warn('[prism-desktop] could not register', SHORTCUT);
    globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());

    // Inline, system-wide Arc-style commands:
    for (const [accel, fn, label] of [
      ['CommandOrControl+Shift+R', openWriteBar, 'write-selection'],
      [
        'CommandOrControl+Shift+G',
        async () => {
          const sel = await grabSelection();
          if (sel.previous) clipboard.writeText(sel.previous); // grab is inspect-only here
          if (sel.text) presentOverlay('prism:quick-ask', sel.text);
          else toggleWindow();
        },
        'quick-ask',
      ],
      ['CommandOrControl+Shift+W', () => presentOverlay('prism:toggle-watch'), 'watch toggle'],
    ]) {
      if (!globalShortcut.register(accel, fn)) {
        console.warn('[prism-desktop] could not register', accel, `(${label})`);
      }
    }
  });

  // Assistant-style: closing windows keeps the daemon alive (reopen via hotkey).
  app.on('window-all-closed', () => { /* stay resident */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('activate', () => { if (!win) createWindow(); });
}
