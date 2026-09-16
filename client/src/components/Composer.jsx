import { useEffect, useRef, useState } from 'react';

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
}) {
  const [text, setText] = useState('');
  const taRef = useRef(null);
  const fileRef = useRef(null);

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
  };

  const onKeyDown = (e) => {
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      submit();
    }
  };

  const hasContent = text.trim() || pendingFiles.length || screenshots.length || pendingAction;

  return (
    <div className="composer-wrap">
      {/* pending attachments / screenshots / actions tray */}
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
              : 'Ask anything — code, errors, architecture… (Enter to send, Shift+Enter for newline)'
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
