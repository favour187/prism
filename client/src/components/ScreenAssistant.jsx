import { useEffect, useRef, useState } from 'react';

/**
 * Floating screen assistant.
 *
 * Privacy by design: the screen is NEVER recorded. A frame is captured only
 * when the user explicitly clicks a capture mode, using the browser picker
 * (getDisplayMedia) which itself asks which screen/window/tab to share.
 */

async function grabFrame() {
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

function RegionSelector({ frame, onDone, onCancel }) {
  const overlayRef = useRef(null);
  const imgRef = useRef(null);
  const [drag, setDrag] = useState(null); // {x1,y1,x2,y2} in overlay coords
  const [box, setBox] = useState(null);   // committed drag rect

  const point = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const toRect = (d) => ({
    x: Math.min(d.x1, d.x2),
    y: Math.min(d.y1, d.y2),
    w: Math.abs(d.x2 - d.x1),
    h: Math.abs(d.y2 - d.y1),
  });

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const commit = () => {
    const d = box ?? drag;
    if (!d) return;
    const { x, y, w, h } = toRect(d);
    if (w < 8 || h < 8) return onCancel();
    // Map overlay coords → image pixels, accounting for object-fit: contain.
    const img = imgRef.current;
    const overlay = overlayRef.current.getBoundingClientRect();
    const scale = Math.min(overlay.width / frame.width, overlay.height / frame.height);
    const drawnW = frame.width * scale;
    const drawnH = frame.height * scale;
    const offsetX = (overlay.width - drawnW) / 2;
    const offsetY = (overlay.height - drawnH) / 2;

    const sx = Math.max(0, (x - offsetX) / scale);
    const sy = Math.max(0, (y - offsetY) / scale);
    const sw = Math.max(1, Math.min(w / scale, frame.width - sx));
    const sh = Math.max(1, Math.min(h / scale, frame.height - sy));

    const src = new Image();
    src.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      canvas.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      onDone(canvas.toDataURL('image/png'));
    };
    src.src = frame.dataUrl;
  };

  const rect = (box ?? drag) ? toRect(box ?? drag) : null;

  return (
    <div
      className="region-overlay"
      ref={overlayRef}
      onMouseDown={(e) => { setBox(null); setDrag({ x1: e.clientX - overlayRef.current.getBoundingClientRect().left, y1: e.clientY - overlayRef.current.getBoundingClientRect().top, x2: 0, y2: 0 }); }}
      onMouseMove={(e) => {
        if (!drag || box) return;
        const p = point(e);
        setDrag((d) => ({ ...d, x2: p.x, y2: p.y }));
      }}
      onMouseUp={() => { if (drag && !box) { setDrag((d) => ({ ...d, x2: d.x2 || d.x1, y2: d.y2 || d.y1 })); setBox(drag); } }}
      role="dialog"
      aria-label="Select region to capture"
    >
      <img ref={imgRef} src={frame.dataUrl} alt="Captured frame — drag to select a region" className="region-frame" draggable="false" />
      <div className="region-hint">Drag to select a region · <kbd>Esc</kbd> to cancel</div>
      {rect && rect.w > 0 && (
        <>
          <div className="region-dim" style={{ left: 0, top: 0, width: '100%', height: rect.y }} />
          <div className="region-dim" style={{ left: 0, top: rect.y, width: rect.x, height: rect.h }} />
          <div className="region-dim" style={{ left: rect.x + rect.w, top: rect.y, width: `calc(100% - ${rect.x + rect.w}px)`, height: rect.h }} />
          <div className="region-dim" style={{ left: 0, top: rect.y + rect.h, width: '100%', height: `calc(100% - ${rect.y + rect.h}px)` }} />
          <div className="region-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
          <div className="region-actions" style={{ left: rect.x, top: Math.max(8, rect.y - 44) }}>
            <button className="btn primary small" onClick={commit}>✂ Capture {rect.w}×{rect.h}</button>
            <button className="btn ghost small" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ScreenAssistant({ open, onToggle, onClose, onCapture, onError }) {
  const [busy, setBusy] = useState(null); // 'full' | 'window' | 'region'
  const [preview, setPreview] = useState(null); // dataUrl
  const [awaitingRegion, setAwaitingRegion] = useState(null); // full frame for region picking
  const [question, setQuestion] = useState('');

  useEffect(() => {
    if (!open) { setPreview(null); setAwaitingRegion(null); setQuestion(''); setBusy(null); }
  }, [open]);

  const capture = async (mode) => {
    setBusy(mode);
    try {
      const frame = await grabFrame();
      if (mode === 'region') {
        setAwaitingRegion(frame);
      } else {
        setPreview(frame.dataUrl);
      }
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        onError('Capture cancelled — permission was not granted.');
      } else {
        onError(err.message ?? 'Screen capture failed.');
      }
    } finally {
      setBusy(null);
    }
  };

  const attach = () => {
    onCapture(preview, 'capture.png');
    setPreview(null);
    setQuestion('');
    onClose();
  };

  if (!open && !awaitingRegion) return null;

  return (
    <>
      {awaitingRegion && (
        <RegionSelector
          frame={awaitingRegion}
          onCancel={() => setAwaitingRegion(null)}
          onDone={(dataUrl) => { setAwaitingRegion(null); setPreview(dataUrl); }}
        />
      )}

      {open && (
        <section className="assistant-panel" aria-label="Screen assistant">
          <header className="assistant-head">
            <div className="assistant-title">📸 Screen assistant</div>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">×</button>
          </header>

          <div className="assistant-body">
            <p className="assistant-note">
              Nothing is recorded. A single frame is captured only when you pick a mode —
              your browser will ask which screen, window, or tab to share.
            </p>

            {!preview ? (
              <div className="capture-modes">
                <button className="capture-mode" disabled={Boolean(busy)} onClick={() => capture('full')}>
                  <span className="capture-icon">🖥</span>
                  <span>Full screen</span>
                  <small>Entire display</small>
                  {busy === 'full' && <span className="spinner" />}
                </button>
                <button className="capture-mode" disabled={Boolean(busy)} onClick={() => capture('window')}>
                  <span className="capture-icon">🪟</span>
                  <span>Window / tab</span>
                  <small>Pick an app in the dialog</small>
                  {busy === 'window' && <span className="spinner" />}
                </button>
                <button className="capture-mode" disabled={Boolean(busy)} onClick={() => capture('region')}>
                  <span className="capture-icon">✂️</span>
                  <span>Region</span>
                  <small>Capture, then drag-select</small>
                  {busy === 'region' && <span className="spinner" />}
                </button>
              </div>
            ) : (
              <div className="capture-preview">
                <img src={preview} alt="Screenshot preview before sending" className="preview-img" />
                <p className="preview-label">Preview — review before sending</p>
                <div className="preview-actions">
                  <button className="btn primary" onClick={attach}>Attach to composer</button>
                  <button className="btn ghost" onClick={() => setPreview(null)}>Retake</button>
                  <button className="btn ghost danger" onClick={() => setPreview(null)}>Discard</button>
                </div>
              </div>
            )}

            <div className="assistant-foot">
              <kbd className="kbd">Ctrl/⌘ + Shift + A</kbd> toggles this panel
            </div>
          </div>
        </section>
      )}

      {/* Floating action button — always visible while the app is open */}
      <button
        className={`assistant-fab ${open ? 'active' : ''}`}
        onClick={onToggle}
        title="Screen assistant (Ctrl/⌘+Shift+A)"
        aria-label={open ? 'Close screen assistant' : 'Open screen assistant'}
      >
        📸
      </button>
    </>
  );
}
