import { useEffect, useState } from 'react';
import { grabFrame } from '../capture.js';
import RegionSelector from './RegionSelector.jsx';

/**
 * Floating screen assistant panel (web app mode).
 *
 * Privacy by design: the screen is NEVER recorded. A frame is captured only
 * when the user explicitly clicks a capture mode, using the browser picker
 * (getDisplayMedia) which itself asks which screen/window/tab to share.
 */
export default function ScreenAssistant({ open, onToggle, onClose, onCapture, onError }) {
  const [busy, setBusy] = useState(null); // 'full' | 'window' | 'region'
  const [preview, setPreview] = useState(null);
  const [awaitingRegion, setAwaitingRegion] = useState(null);

  useEffect(() => {
    if (!open) { setPreview(null); setAwaitingRegion(null); setBusy(null); }
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
