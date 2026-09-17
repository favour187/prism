import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { VoiceRecorder, transcribe, voiceSupported, ttsSupported } from '../voice.js';

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

const ACCEPT =
  '.js,.mjs,.cjs,.jsx,.ts,.mts,.cts,.tsx,.py,.rb,.go,.rs,.java,.c,.h,.cc,.cpp,.hpp,.cs,.php,.swift,.kt,.kts,.scala,.dart,.lua,.r,.jl,.ex,.exs,.erl,.hs,.clj,.groovy,.pl,.sh,.bash,.zsh,.ps1,.sql,.html,.vue,.svelte,.css,.scss,.sass,.less,.json,.yaml,.yml,.toml,.ini,.cfg,.xml,.svg,.csv,.tsv,.md,.markdown,.txt,.log,.dockerfile,.tf,.hcl,.proto,.graphql,.prisma,.diff,.patch,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif';

const ACTIONS = [
  { id: 'explain', label: 'Explain', icon: '💡', hint: 'Explain the attached/selected code' },
  { id: 'fix', label: 'Fix', icon: '🛠', hint: 'Find the bug & return the complete corrected code' },
  { id: 'improve', label: 'Improve', icon: '✨', hint: 'Refactor for quality without changing behavior' },
  { id: 'generate', label: 'Generate', icon: '⚡', hint: 'Generate production-quality code from your prompt' },
];

function prettySize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  onFiles,
  pendingFiles,
  onRemoveFile,
  screenshots,
  onRemoveScreenshot,
  pendingAction,
  onClearAction,
  onAction,
  onOpenAssistant,
  onVoice,
  onNew,
  speakOn,
  onToggleSpeak,
  onToast,
}) {
  const [text, setText] = useState('');
  const [mic, setMic] = useState('idle');
  const [styles, setStyles] = useState(FALLBACK_STYLES);
  const [styleBusy, setStyleBusy] = useState(null);
  const [writeState, setWriteState] = useState(null);
  const [palIndex, setPalIndex] = useState(0);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const recorderRef = useRef(null);

  const desktop = window.prismDesktop ?? null;

  useEffect(() => {
    api.listWriteStyles().then((d) => d.styles?.length && setStyles(d.styles)).catch(() => {});
  }, []);

  const toggleMic = async () => {
    if (mic === 'recording') {
      setMic('transcribing');
      const { blob, mime } = (await recorderRef.current?.stop()) ?? {};
      recorderRef.current = null;
      try {
        if (!blob) throw new Error('Nothing recorded.');
        const transcript = await transcribe(blob, mime);
        if (transcript) {
          setText(transcript);
          if (onVoice) {
            onVoice(transcript);
          } else {
            setText((t) => (t.trim() && transcript ? `${t.trim()} ${transcript}` : transcript ?? t));
          }
        } else {
          onToast?.('Heard silence — try again.');
        }
      } catch (err) {
        onToast?.(err.message, 'error');
      } finally {
        setMic('idle');
      }
      return;
    }
    if (mic === 'transcribing') return;
    try {
      recorderRef.current = new VoiceRecorder();
      await recorderRef.current.start();
      setMic('recording');
    } catch (err) {
      recorderRef.current = null;
      onToast?.(err?.name === 'NotAllowedError' ? 'Microphone permission denied.' : `Mic unavailable: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [text]);

  const submit = () => {
    if (disabled) return;
    onSend({ content: text });
    setText('');
    setWriteState(null);
  };

  const paletteOpen = text.startsWith('/');
  const commands = useMemo(() => {
    const list = [
      { id: 'assistant', icon: '📸', label: 'Screen assistant', hint: 'capture, watch & narrate', run: onOpenAssistant },
      ...(voiceSupported() ? [{ id: 'voice', icon: '🎤', label: 'Voice input', hint: 'dictate a message', run: toggleMic }] : []),
      { id: 'attach', icon: '📎', label: 'Attach files', hint: 'code, docs, images', run: () => fileRef.current?.click() },
      ...(ttsSupported() && onToggleSpeak ? [{
        id: 'speak', icon: speakOn ? '🔇' : '🔊', label: `Spoken answers ${speakOn ? 'off' : 'on'}`,
        hint: 'read replies aloud', run: onToggleSpeak,
      }] : []),
      ...(onNew ? [{ id: 'new', icon: '＋', label: 'New conversation', hint: 'clear and start over', run: onNew }] : []),
    ];
    const q = text.slice(1).trim().toLowerCase();
    return q ? list.filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q)) : list;
  }, [text, speakOn, onNew, onToggleSpeak, onOpenAssistant]);

  useEffect(() => { setPalIndex(0); }, [text]);

  const writeChipsOpen = Boolean(text.trim()) && !paletteOpen && !disabled;
  const transformed = writeState && text !== writeState.original;

  const runInlineWrite = async (style) => {
    const source = text.trim();
    if (!source || styleBusy) return;
    setStyleBusy(style.id);
    try {
      const d = await api.write(source, style.id);
      setWriteState((prev) => prev ?? { original: text });
      setText(d.result);
    } catch (err) {
      onToast?.(err.message ?? 'Rewrite failed.', 'error');
    } finally {
      setStyleBusy(null);
    }
  };

  const insertTransformed = async () => {
    const payload = text.trim();
    if (!payload) return;
    if (desktop?.writeText) {
      const res = await desktop.writeText(payload).catch(() => ({ copied: false, pasted: false }));
      onToast?.(res.pasted ? 'Inserted into your app ✓' : 'Copied — paste with Ctrl/⌘+V.', 'success');
    } else {
      await navigator.clipboard.writeText(payload).catch(() => {});
      onToast?.('Copied — paste anywhere with Ctrl/⌘+V.', 'success');
    }
    setText('');
    setWriteState(null);
  };

  const onKeyDown = (e) => {
    if (paletteOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!commands.length) return;
        setPalIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = commands[Math.min(palIndex, commands.length - 1)];
        setText('');
        cmd?.run?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setText('');
      }
      return;
    }
    if (e.key === 'Escape' && transformed) {
      setText(writeState.original);
      setWriteState(null);
      return;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      submit();
    }
  };

  const hasContent = text.trim() || pendingFiles.length || screenshots.length || pendingAction;

  return (
    <div className="composer-wrap">
      {}
      {(pendingFiles.length > 0 || screenshots.length > 0 || pendingAction) && (
        <div className="tray" aria-label="Pending context">
          {pendingAction && (
            <span className="chip chip-action">
              {ACTIONS.find((a) => a.id === pendingAction.action)?.icon}{' '}
              {ACTIONS.find((a) => a.id === pendingAction.action)?.label}
              {pendingAction.selection ? ' · selected code' : ''}
              <button className="chip-x" onClick={onClearAction} title="Remove action">×</button>
            </span>
          )}
          {screenshots.map((s) => (
            <span key={s.id} className="chip chip-image">
              <img src={s.dataUrl} alt="Screenshot preview" className="chip-thumb" />
              <span className="chip-name">screenshot</span>
              <button className="chip-x" onClick={() => onRemoveScreenshot(s.id)} title="Remove screenshot">×</button>
            </span>
          ))}
          {pendingFiles.map((f) => (
            <span key={f.id} className={`chip ${f.kind === 'image' ? 'chip-image' : ''}`}>
              {f.kind === 'image' && f.previewUrl
                ? <img src={f.previewUrl} alt={f.name} className="chip-thumb" />
                : <span aria-hidden="true">📎</span>}
              <span className="chip-name" title={f.name}>{f.name}</span>
              <span className="chip-size">{prettySize(f.size)}</span>
              {f.extractedChars > 0 && <span className="chip-size">{f.extractedChars.toLocaleString()} chars</span>}
              {f.truncated && <span className="chip-flag" title="File was truncated to keep context manageable">trimmed</span>}
              <button className="chip-x" onClick={() => onRemoveFile(f.id)} title="Remove file">×</button>
            </span>
          ))}
        </div>
      )}

      {paletteOpen && (
        <div className="ov-palette composer-palette" role="listbox" aria-label="Commands">
          {commands.map((c, i) => (
            <button
              key={c.id}
              className={`ov-palette-item ${i === Math.min(palIndex, commands.length - 1) ? 'active' : ''}`}
              onMouseEnter={() => setPalIndex(i)}
              onClick={() => { setText(''); c.run(); }}
            >
              <span className="ov-palette-icon">{c.icon}</span>
              <span className="ov-palette-label">{c.label}</span>
              <span className="ov-palette-hint">{c.hint}</span>
            </button>
          ))}
          {!commands.length && <div className="ov-palette-empty">No matching command.</div>}
        </div>
      )}

      {writeChipsOpen && (
        <div className="ov-chips composer-chips">
          {styles.map((s) => (
            <button
              key={s.id}
              className={`ov-chip ${styleBusy === s.id ? 'busy' : ''}`}
              disabled={Boolean(styleBusy)}
              title={s.hint ?? ''}
              onClick={() => runInlineWrite(s)}
            >
              {s.label}{styleBusy === s.id && <span className="spinner" />}
            </button>
          ))}
        </div>
      )}

      {transformed && !paletteOpen && (
        <div className="ov-bar-actions composer-bar-actions">
          <button className="btn primary small" onClick={insertTransformed}>⤓ Insert into app</button>
          <button className="btn ghost small" onClick={() => { setText(writeState.original); setWriteState(null); }} title="Restore what you typed (Esc)">↺ Original</button>
          <button className="btn ghost small" onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); onToast?.('Copied.', 'success'); }}>Copy</button>
        </div>
      )}

      <div className="composer">
        <div className="composer-tools">
          <button className="tool-btn" title="Attach development files (code, PDF, DOCX, images)"
            onClick={() => fileRef.current?.click()} disabled={disabled}>
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button className="tool-btn" title="Capture your screen (Ctrl/⌘+Shift+A)"
            onClick={onOpenAssistant} disabled={disabled}>
            📸
          </button>
          {voiceSupported() && (
            <button
              className={`tool-btn mic ${mic === 'recording' ? 'recording' : ''}`}
              title={mic === 'recording' ? 'Stop — transcribes and sends your answer' : mic === 'transcribing' ? 'Transcribing…' : 'Tap to talk (voice input)'}
              onClick={toggleMic}
              disabled={disabled && mic === 'idle'}
            >
              {mic === 'recording' ? '⏺' : mic === 'transcribing' ? '…' : '🎤'}
            </button>
          )}
          <span className="tool-sep" />
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              className={`action-chip ${pendingAction?.action === a.id ? 'active' : ''}`}
              title={a.hint}
              disabled={disabled}
              onClick={() => (pendingAction?.action === a.id ? onClearAction() : onAction(a.id))}
            >
              <span aria-hidden="true">{a.icon}</span> {a.label}
            </button>
          ))}
        </div>

        <textarea
          ref={taRef}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={
            pendingAction
              ? `${ACTIONS.find((a) => a.id === pendingAction.action)?.label} what? (optional note, Enter to run)`
              : 'Message Prism… (Enter to send · / for commands · Shift+Enter for a new line)'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message"
        />

        {streaming ? (
          <button className="send-btn stop" onClick={onStop} title="Stop generating">■</button>
        ) : (
          <button className="send-btn" onClick={submit} disabled={!hasContent} title="Send">➤</button>
        )}
      </div>
      <div className="composer-foot">
        <span>Prism can make mistakes — verify code before shipping. Screens are captured only on demand.</span>
      </div>
    </div>
  );
}
