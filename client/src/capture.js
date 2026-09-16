/**
 * Browser-side screen capture via getDisplayMedia (the privacy-safe way:
 * the OS/browser shows its picker; nothing is captured without consent).
 */
export async function grabFrame() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture is not supported in this browser (use Chrome/Edge/Firefox desktop).');
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 1, max: 5 } },
    audio: false,
  });
  try {
    const [track] = stream.getVideoTracks();
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // Give the compositor a moment so the first frame is painted.
    await new Promise((r) => setTimeout(r, 120));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Could not read the captured frame.');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    track?.stop();
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** True when running inside the Prism desktop (Electron) shell. */
export function isDesktop() {
  return Boolean(window.prismDesktop?.isDesktop);
}

/** True when running inside the Prism Android overlay WebView. */
export function isAndroid() {
  return typeof window.prismAndroid?.requestCapture === 'function';
}

/**
 * Ask the Android shell for a screenshot. The native side handles the
 * MediaProjection consent dialog, captures exactly ONE frame, restores the
 * panel, and resolves the promise with a PNG data URL (or null if cancelled).
 */
export function androidCapture(kind = 'screen') {
  return new Promise((resolve) => {
    const token = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const store = (window.__prismCaptureResolvers ??= {});
    store[token] = resolve;
    try {
      window.prismAndroid.requestCapture(kind, token);
    } catch {
      delete store[token];
      resolve(null);
    }
  });
}

// Native → web callback target for androidCapture().
window.__prismCaptureResult = (token, dataUrl) => {
  const store = window.__prismCaptureResolvers;
  if (store?.[token]) {
    store[token](dataUrl || null);
    delete store[token];
  }
};
