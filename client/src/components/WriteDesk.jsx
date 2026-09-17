import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

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

export default function WriteDesk({ onDiscuss, onToast }) {
  const [doc, setDoc] = useState(() => localStorage.getItem('prism.writedesk.doc') ?? '');
  const [history, setHistory] = useState([]);
  const [styles, setStyles] = useState(FALLBACK_STYLES);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api.listWriteStyles().then((d) => d.styles?.length && setStyles(d.styles)).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem('prism.writedesk.doc', doc);
  }, [doc]);

  const pushHistory = (snapshot) => setHistory((h) => [...h.slice(-19), snapshot]);

  const applyTransform = useCallback(async (payload, tag) => {
    const source = doc;
    if (!source.trim() || busy) return;
    setBusy(tag);
    try {
      const d = payload.instruction
        ? await api.writeInstruction(source, payload.instruction)
        : await api.write(source, payload.style);
      pushHistory(source);
      setDoc(d.result);
      if (payload.instruction) setInstruction('');
    } catch (err) {
      onToast?.(err.message ?? 'Transform failed.', 'error');
    } finally {
      setBusy(null);
    }
  }, [doc, busy, onToast]);

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      setDoc(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(doc).catch(() => {});
    onToast?.('Copied to clipboard.', 'success');
  };

  const insert = async () => {
    if (!desktop?.writeText) { copy(); onToast?.('Insert needs the desktop app — copied instead.', 'info'); return; }
    const res = await desktop.writeText(doc).catch(() => ({ pasted: false }));
    onToast?.(res.pasted ? 'Inserted into your app ✓' : 'Copied — paste with Ctrl/⌘+V.', 'success');
  };

  const download = () => {
    const blob = new Blob([doc], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prism-draft.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const words = doc.trim() ? doc.trim().split(/\s+/).length : 0;
  const hasDoc = Boolean(doc.trim());

  return (
    <div className="desk">
      <div className="desk-toolbar">
        <div className="desk-chips">
          {styles.map((s) => (
            <button
              key={s.id}
              className={`ov-chip ${busy === s.id ? 'busy' : ''}`}
              disabled={!hasDoc || Boolean(busy)}
              title={s.hint ?? ''}
              onClick={() => applyTransform({ style: s.id }, s.id)}
            >
              {s.label}{busy === s.id && <span className="spinner" />}
            </button>
          ))}
        </div>
        <div className="desk-instruct">
          <input
            className="desk-instruct-input"
            placeholder='…or tell Prism exactly what to do: "make this a polite rejection email"'
            value={instruction}
            disabled={Boolean(busy)}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && instruction.trim()) applyTransform({ instruction: instruction.trim() }, 'custom');
            }}
          />
          <button
            className="btn primary small"
            disabled={!hasDoc || !instruction.trim() || Boolean(busy)}
            onClick={() => applyTransform({ instruction: instruction.trim() }, 'custom')}
          >
            {busy === 'custom' ? <span className="spinner" /> : 'Apply ✨'}
          </button>
        </div>
      </div>

      <textarea
        className="desk-doc"
        placeholder="Start writing — a note, an email, a plan. Transform it with the chips above, or ask for anything: tone, translation, structure, summary…"
        value={doc}
        onChange={(e) => setDoc(e.target.value)}
        spellCheck="true"
      />

      <div className="desk-foot">
        <span className="desk-count">{words.toLocaleString()} words · {doc.length.toLocaleString()} chars</span>
        <div className="desk-actions">
          <button className="btn ghost small" disabled={!history.length} onClick={undo} title="Undo the last change (typing or AI)">↺ Undo</button>
          <button className="btn ghost small" disabled={!hasDoc} onClick={copy}>Copy</button>
          <button className="btn ghost small" disabled={!hasDoc} onClick={insert} title="Paste back into the app you were using (desktop)">⤓ Insert into app</button>
          <button className="btn ghost small" disabled={!hasDoc} onClick={download}>⬇ .md</button>
          <button className="btn primary small" disabled={!hasDoc} onClick={() => onDiscuss?.(doc)}>💬 Discuss in chat</button>
        </div>
      </div>
    </div>
  );
}
