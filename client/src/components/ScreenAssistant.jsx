import { useEffect, useRef, useState } from 'react';
import { grabFrame, ScreenWatcher } from '../capture.js';
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
  narrateRef.current = narrate;
  streamingRef.current = streaming;

  useEffect(() => {
    localStorage.setItem('prism.watchNarrate', narrate ? '1' : '0');
  }, [narrate]);

  const stopWatch = () => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setWatch(null);
  };

  useEffect(() => () => watcherRef.current?.stop(), []);

  const toggleWatch = async () => {
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
              Nothing is recorded. A single frame is captured only when you pick a mode —
              or, in Watch, kept only when the screen visibly moves.
            </p>

            <div className={`assistant-watch ${watch ? 'on' : ''}`}>
              <button className="capture-mode watch" disabled={Boolean(busy)} onClick={toggleWatch}>
                <span className="capture-icon">◉</span>
                <span>{watch ? `Watching · ${watch.count} kept` : 'Watch the screen'}</span>
                <small>{watch ? 'click to stop' : 'keeps a shot only on movement'}</small>
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
