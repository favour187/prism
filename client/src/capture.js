/**
 * Browser-side screen capture via getDisplayMedia — the privacy-safe way:
 * the OS/browser shows its picker; nothing is captured without consent.
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
    const { dataUrl, width, height } = await frameFromStream(stream, 120);
    return { dataUrl, width, height };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function frameCanvas(source, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return canvas;
}

async function frameFromStream(stream, settleMs = 150) {
  const [track] = stream.getVideoTracks();
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  await new Promise((r) => setTimeout(r, settleMs));
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('Could not read the captured frame.');
  track?.stop();
  return { dataUrl: frameCanvas(video, w, h).toDataURL('image/png'), width: w, height: h };
}

/** Open a live capture stream (user-consented once) for repeated sampling. */
export async function openCaptureStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 5, max: 12 } },
    audio: false,
  });
  const [track] = stream.getVideoTracks();
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  await new Promise((r) => setTimeout(r, 150));
  if (!video.videoWidth) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('Could not start the capture stream.');
  }
  return { video, track, stop: () => stream.getTracks().forEach((t) => t.stop()) };
}

/**
 * Watch mode — motion-triggered screenshots.
 *
 * An explicitly user-started session: the screen is sampled every interval,
 * frames are differed LOCALLY (nothing leaves the device except the kept
 * screenshot), and a screenshot is only produced when the visible change
 * exceeds the sensitivity threshold. Frames with no movement are discarded
 * immediately — this is precisely not continuous recording.
 */
export class ScreenWatcher {
  /**
   * intervalMs sampling period; threshold mean per-pixel luminance delta (0–255);
   * sample small diff canvas width; maxShots cap per session.
   */
  constructor({ intervalMs = 900, threshold = 7, sample = 200, maxShots = 24 } = {}) {
    this.intervalMs = intervalMs;
    this.threshold = threshold;
    this.sample = sample;
    this.maxShots = maxShots;
    this.stopped = true;
    this.prev = null;
    this.shots = 0;
  }

  async start({ onChange, onTick }) {
    this.handle = await openCaptureStream();
    this.stopped = false;
    const loop = () => {
      if (this.stopped) return;
      try {
        const v = this.handle.video;
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) throw new Error('stream ended');

        const sw = this.sample;
        const sh = Math.max(24, Math.round((this.sample * h) / w));
        const data = frameCanvas(v, sw, sh).getContext('2d').getImageData(0, 0, sw, sh).data;

        if (this.prev) {
          const avgDelta = lumDiff(data, this.prev);
          const jumps = layoutJumps(data, this.prev, sw, sh);
          onTick?.(avgDelta, jumps);
          if ((avgDelta >= this.threshold || jumps >= 3) && this.shots < this.maxShots) {
            this.shots += 1;
            onChange({
              dataUrl: frameCanvas(v, w, h).toDataURL('image/jpeg', 0.86),
              width: w,
              height: h,
              delta: avgDelta,
              jumps,
              n: this.shots,
            });
            // Re-baseline so each shot captures a NEW movement, not the same one.
            this.prev = data;
          }
        } else {
          this.prev = data;
        }
      } catch {
        this.stop();
        onTick?.(-1, 0);
        return;
      }
      this.timer = setTimeout(loop, this.intervalMs);
    };
    loop();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.handle?.stop();
    this.prev = null;
  }
}

/** Mean absolute luminance difference between two ImageData arrays (0–255). */
function lumDiff(a, b, step = 8) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += step * 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    sum += Math.abs(la - lb);
    count += 1;
  }
  return count ? sum / count : 0;
}

/**
 * Layout-cell flips on an 8×8 grid: catches structural moves (a window
 * appearing, big scroll jumps) that a diluted mean-delta can miss.
 */
function layoutJumps(a, b, sw, sh) {
  const GX = 8;
  const GY = 8;
  const cw = Math.max(1, Math.floor(sw / GX));
  const ch = Math.max(1, Math.floor(sh / GY));
  const cellLum = (img, gx, gy) => {
    let sum = 0;
    let count = 0;
    for (let y = gy * ch; y < (gy + 1) * ch && y < sh; y += 2) {
      for (let x = gx * cw; x < (gx + 1) * cw && x < sw; x += 2) {
        const i = (y * sw + x) * 4;
        sum += 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
        count += 1;
      }
    }
    return count ? sum / count : 0;
  };
  let jumps = 0;
  for (let gy = 0; gy < GY; gy += 1) {
    for (let gx = 0; gx < GX; gx += 1) {
      if (Math.abs(cellLum(a, gx, gy) - cellLum(b, gx, gy)) > 26) jumps += 1;
    }
  }
  return jumps;
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
