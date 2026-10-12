import { useEffect, useRef, useState } from 'react';
import { grabFrame, ScreenWatcher, isAndroid, startAndroidWatch, stopAndroidWatch } from '../capture.js';
import RegionSelector from './RegionSelector.jsx';

export default function ScreenAssistant({ open, onToggle, onClose, onCapture, onAnswer, onError, onWatchNarrate, streaming }) {
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [awaitingRegion, setAwaitingRegion] = useState(null);
  const [watch, setWatch] = useState(null);
  const [narrate, setNarrate] = useState(() => localStorage.getItem('prism.watchNarrate') !== '0');
  const watcherRef = useRef(null);
  const narrateRef = useRef(narrate);
  const streamingRef = useRef(streaming);
  const androidPrevRef = useRef(null);
  const androidCountRef = useRef(0);
  const androidTokenRef = useRef(null);
  narrateRef.current = narrate;
  streamingRef.current = streaming;

  useEffect(() => {
    localStorage.setItem('prism.watchNarrate', narrate ? '1' : '0');
  }, [narrate]);

  const stopWatch = () => {
    if (androidTokenRef.current) {
      stopAndroidWatch();
      androidTokenRef.current = null;
      androidPrevRef.current = null;
    }
    watcherRef.current?.stop();
    watcherRef.current = null;
    setWatch(null);
  };

  useEffect(() => {
    if (!isAndroid()) return undefined;
    window.__prismWatchFrame = (dataUrl) => {
      if (!androidTokenRef.current || !dataUrl) return;
      const img = new Image();
      img.onload = () => {
        if (!androidTokenRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = Math.max(32, Math.round(96 * img.height / img.width));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const prev = androidPrevRef.current;
        androidPrevRef.current = pixels;
        if (!prev) return;
        let diff = 0; let count = 0;
        for (let i = 0; i < pixels.length; i += 32) {
          diff += Math.abs(pixels[i] - prev[i]) + Math.abs(pixels[i + 1] - prev[i + 1]) + Math.abs(pixels[i + 2] - prev[i + 2]);
          count += 3;
        }
        if (count && diff / count > 13) {
          const n = ++androidCountRef.current;
          setWatch({ count: n });
          setPreview(dataUrl);
          if (narrateRef.current && !streamingRef.current) onWatchNarrate?.(dataUrl, n);
        }
      };
      img.src = dataUrl;
    };
    window.__prismWatchStatus = (token, ok, message) => {
      if (token !== androidTokenRef.current) return;
      if (!ok) {
        androidTokenRef.current = null;
        androidPrevRef.current = null;
        setWatch(null);
        onError?.(message || 'Could not start screen Watch.');
      } else setWatch({ count: 0 });
    };
    return () => {
      delete window.__prismWatchFrame;
      delete window.__prismWatchStatus;
    };
  }, [onError, onWatchNarrate]);

  useEffect(() => () => watcherRef.current?.stop(), []);

  const toggleWatch = async () => {
    if (watcherRef.current || androidTokenRef.current) {
      const n = watch?.count ?? 0;
      stopWatch();
      onError?.(`Watch stopped — ${n} change${n === 1 ? '' : 's'} detected.`);
      return;
    }
    if (isAndroid()) {
      const token = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      androidTokenRef.current = token;
      androidPrevRef.current = null;
      androidCountRef.current = 0;
      try {
        startAndroidWatch(token);
        setWatch({ count: 0 });
      } catch (err) {
        androidTokenRef.current = null;
        onError?.(err?.message || 'Could not start screen Watch.');
      }
      return;
    }
    if (watcherRef.current) {
      const n = watch?.count ?? 0;
      stopWatch();
      onError?.(`Watch stopped — ${n} change${n === 1 ? '' : 's'} captured.`);
      return;
    }
    const watcher = new ScreenWatcher({ threshold: 7 });
    try {
      await watcher.start({
        onChange: ({ dataUrl, n }) => {
          setWatch(() => ({ count: n }));
          setPreview(dataUrl);
          if (narrateRef.current && !streamingRef.current) {
            onWatchNarrate?.(dataUrl, n);
          }
        },
        onTick: (avg) => {
          if (avg < 0) stopWatch();
        },
      });
      watcherRef.current = watcher;
      setWatch({ count: 0 });
    } catch (err) {
      onError?.(err?.name === 'NotAllowedError' ? 'Watch needs capture permission.' : `Watch failed: ${err.message}`);
    }
  };

  useEffect(() => {
    if (!open) { setPreview(null); setAwaitingRegion(null); setBusy(null); stopWatch(); }
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

  const answerNow = async () => {
    setBusy('answer');
    try {
      const frame = await grabFrame();
      onAnswer?.(frame.dataUrl);
      setPreview(null);
      onClose();
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
    onClose();
  };

  if (!open && !awaitingRegion) {
    return (
      <button
        className="assistant-edge"
        onClick={onToggle}
        title="Prism screen assistant — click to open"
        aria-label="Open screen assistant"
      >
        <span className="assistant-edge-line" aria-hidden="true" />
      </button>
    );
  }

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
              Prism captures only after you approve Android screen recording. Watch checks for visible changes while active; stop it any time.
            </p>

            <div className={`assistant-watch ${watch ? 'on' : ''}`}>
              <button className="capture-mode watch" disabled={Boolean(busy)} onClick={toggleWatch}>
                <span className="capture-icon">◉</span>
                <span>{watch ? `Watching · ${watch.count} changes` : 'Watch the screen'}</span>
                <small>{watch ? 'Tap to stop · captures only when screen changes' : 'keeps a shot only when the screen moves'}</small>
              </button>
              {watch && (
                <label className="assistant-narrate">
                  <input type="checkbox" checked={narrate} onChange={(e) => setNarrate(e.target.checked)} />
                  ✨ narrate changes into the chat
                </label>
              )}
            </div>

            {!preview ? (
              <div className="capture-modes">
                {onAnswer && (
                  <button className="capture-mode answer" disabled={Boolean(busy) || Boolean(streaming)} onClick={answerNow}>
                    <span className="capture-icon">⚡</span>
                    <span>Answer now</span>
                    <small>capture screen & answer instantly</small>
                    {busy === 'answer' && <span className="spinner" />}
                  </button>
                )}
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
                <p className="preview-label">{watch ? 'Latest Watch shot' : 'Preview — review before sending'}</p>
                <div className="preview-actions">
                  <button className="btn primary" onClick={attach}>Attach to composer</button>
                  {!watch && <button className="btn ghost" onClick={() => setPreview(null)}>Retake</button>}
                  <button className="btn ghost danger" onClick={() => setPreview(null)}>Discard</button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {}
      <button
        className={`assistant-edge ${open ? 'open' : ''}`}
        onClick={onToggle}
        title={open ? 'Close screen assistant' : 'Prism screen assistant — click to open'}
        aria-label={open ? 'Close screen assistant' : 'Open screen assistant'}
      >
        <span className="assistant-edge-line" aria-hidden="true" />
      </button>
    </>
  );
}
