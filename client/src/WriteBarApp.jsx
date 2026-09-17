import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const desktop = window.prismDesktop ?? null;

const FALLBACK_STYLES = [
  { id: 'fix', label: 'Fix grammar' },
  { id: 'improve', label: 'Improve' },
  { id: 'concise', label: 'Concise' },
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'expand', label: 'Expand' },
  { id: 'to_en', label: '→ English' },
  { id: 'to_fr', label: '→ French' },
];

export default function WriteBarApp() {
  const [selection, setSelection] = useState(null);
  const [styles, setStyles] = useState(FALLBACK_STYLES);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const resultRef = useRef(null);

  useEffect(() => {
    api.listWriteStyles()
      .then((d) => d.styles?.length && setStyles(d.styles))
      .catch(() => {});
    desktop?.writeGetSelection?.()
      .then((sel) => setSelection(sel ?? { text: '' }))
      .catch(() => setSelection({ text: '' }));
  }, []);

  const rewrite = useCallback(async (style) => {
    const source = result ?? selection?.text ?? '';
    if (!source.trim() || busy) return;
    setBusy(style.id);
    setError(null);
    try {
      const d = await api.write(source, style.id);
      setResult(d.result);
      setStatus(null);
    } catch (err) {
      setError(err.message ?? 'Rewrite failed.');
    } finally {
      setBusy(null);
    }
  }, [busy, result, selection]);

  const pasteBack = useCallback(async () => {
    const payload = (result ?? selection?.text ?? '').trim();
    if (!payload) return;
    if (desktop?.writePasteBack) {
      const res = await desktop.writePasteBack(payload).catch(() => ({ copied: true, pasted: false }));
      setStatus(res.pasted ? 'Inserted ✓' : 'Copied — paste with Ctrl/⌘+V');
    } else {
      await navigator.clipboard.writeText(payload).catch(() => {});
      setStatus('Copied — paste with Ctrl/⌘+V');
    }
  }, [result, selection]);

  const cancel = useCallback(() => {
    if (desktop?.writeCancel) desktop.writeCancel();
    else window.close();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
      if (e.key === 'Enter' && !e.shiftKey && document.activeElement !== resultRef.current) {
        e.preventDefault();
        pasteBack();
        return;
      }
      const idx = ['1', '2', '3', '4', '5', '6', '7', '8'].indexOf(e.key);
      if (idx >= 0 && document.activeElement !== resultRef.current && styles[idx]) {
        e.preventDefault();
        rewrite(styles[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [styles, rewrite, pasteBack, cancel]);

  const source = selection?.text ?? '';

  return (
    <div className="wb-app">
      <header className="wb-head">
        <span className="ov-gem" aria-hidden="true" />
        <span className="wb-title">Write</span>
        <span className="wb-crumb">{result ? 'rewrite ready — Enter to insert' : source ? 'pick a style' : 'no selection detected'}</span>
        <button className="ov-btn" title="Close (Esc)" onClick={cancel}>✕</button>
      </header>

      <div className={`wb-source ${result ? 'dimmed' : ''}`} title="Selected text">
        {source
          ? <p>{source.slice(0, 500)}</p>
          : (
            <p className="wb-empty">
              Select text in the app you were using, then press <kbd>⌘/Ctrl+Shift+R</kbd>.
              {selection?.clipboardBacked === false ? '' : ' (Or copy text first — clipboard content is used as a fallback.)'}
            </p>
          )}
      </div>

      {result != null && (
        <textarea
          ref={resultRef}
          className="wb-result"
          value={result}
          onChange={(e) => setResult(e.target.value)}
          aria-label="Rewritten text — editable"
        />
      )}

      {error && <div className="wb-error">{error}</div>}
      {status && <div className="wb-status">{status}</div>}

      <div className="wb-chips">
        {styles.map((s, i) => (
          <button
            key={s.id}
            className={`ov-chip ${busy === s.id ? 'busy' : ''}`}
            onClick={() => rewrite(s)}
            disabled={!source.trim() && !result}
            title={s.hint ?? ''}
          >
            <kbd>{i + 1}</kbd> {s.label}
            {busy === s.id && <span className="spinner" />}
          </button>
        ))}
      </div>

      <footer className="wb-foot">
        <button className="btn primary small" onClick={pasteBack} disabled={!(result ?? source).trim()}>
          ⤓ Insert <kbd>Enter</kbd>
        </button>
        <button
          className="btn ghost small"
          disabled={!(result ?? source).trim()}
          onClick={async () => { await navigator.clipboard.writeText(result ?? source).catch(() => {}); setStatus('Copied.'); }}
        >
          Copy
        </button>
        {result !== null && (
          <button className="btn ghost small" onClick={() => setResult(null)} title="Back to the original selection">
            ↺ Original
          </button>
        )}
      </footer>
    </div>
  );
}
