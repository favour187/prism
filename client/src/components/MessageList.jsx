import { memo, useEffect, useRef, useState } from 'react';import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock, { InlineCode } from './CodeBlock.jsx';

const rehypePlugins = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];
const remarkPlugins = [remarkGfm];

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function Markdown({ text, onCodeAction }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = /language-[\w+-]+/.test(className ?? '') || String(children).includes('\n');
          if (!isBlock) return <InlineCode>{children}</InlineCode>;
          return (
            <CodeBlock className={className} onAction={onCodeAction}>
              {children}
            </CodeBlock>
          );
        },
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

const Message = memo(function Message({ msg, onCodeAction, onCopy, onRegenerate }) {
  const isUser = msg.role === 'user';
  const vision = msg.meta?.vision;
  const [copied, setCopied] = useState(false);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = msg.content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <article className={`msg ${isUser ? 'msg-user' : 'msg-assistant'}`}>
      <div className="msg-avatar" aria-hidden="true">{isUser ? '🧑‍💻' : '◮'}</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-role">{isUser ? 'You' : 'Prism'}</span>
          {(msg.createdAt || msg.created_at) && (
            <span className="msg-time">{timeAgo(msg.createdAt ?? msg.created_at)}</span>
          )}
          {!isUser && msg.meta?.model && <span className="msg-model">{msg.meta.model}</span>}
          {!isUser && vision === 'vision' && <span className="msg-badge vision" title="Answered by the vision model">👁 vision</span>}
          {!isUser && vision === 'ocr' && <span className="msg-badge ocr" title="Vision model fell back to OCR text extraction">⌗ OCR fallback</span>}
          {!isUser && (
            <span className="msg-actions">
              <button className="msg-action" title="Copy this answer" onClick={copyMessage}>
                {copied ? '✓ Copied' : '⧉ Copy'}
              </button>
              {onRegenerate && (
                <button className="msg-action" title="Regenerate this answer" onClick={() => onRegenerate(msg)}>
                  ↻ Regenerate
                </button>
              )}
            </span>
          )}
        </div>
        <div className="msg-content markdown">
          <Markdown text={msg.content} onCodeAction={isUser ? null : onCodeAction} />
        </div>
      </div>
    </article>
  );
});

function StreamingMessage({ stream, onCodeAction }) {
  return (
    <article className="msg msg-assistant">
      <div className="msg-avatar streaming" aria-hidden="true">◮</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-role">Prism</span>
          {stream.meta?.model && <span className="msg-model">{stream.meta.model}</span>}
          {stream.meta?.vision === 'vision' && <span className="msg-badge vision">👁 vision</span>}
          {stream.meta?.vision === 'ocr' && <span className="msg-badge ocr">⌗ OCR fallback</span>}
        </div>
        {stream.error ? (
          <div className="msg-error" role="alert">
            <strong>{stream.error.code ?? 'ERROR'}:</strong> {stream.error.message}
            {stream.text && (
              <div className="markdown partial">
                <Markdown text={stream.text} onCodeAction={onCodeAction} />
              </div>
            )}
          </div>
        ) : (
          <div className={`msg-content markdown streaming ${stream.text ? '' : 'thinking'}`}>
            {stream.text
              ? <Markdown text={stream.text} onCodeAction={onCodeAction} />
              : <span className="thinking-dots"><i /><i /><i /></span>}
            {stream.text && <span className="caret" aria-hidden="true" />}
          </div>
        )}
      </div>
    </article>
  );
}

const SUGGESTIONS = [
  { icon: '🐛', title: 'Debug an error', body: 'Paste a stack trace or capture your screen — I will find the root cause and give you the complete fix.' },
  { icon: '🏗️', title: 'Design an architecture', body: 'Ask for system designs, API shapes, DB schemas, or refactor plans with trade-offs.' },
  { icon: '📸', title: 'Analyze my screen', body: 'Press Ctrl/⌘+Shift+A to capture a window or region — terminal output, IDE errors, docs, UI.' },
  { icon: '📎', title: 'Upload project files', body: 'Drop code files, PDFs or DOCX — I keep them as codebase context for the whole session.' },
];

export default function MessageList({ messages, stream, onCodeAction, onRegenerate = null, emptyHint = null }) {
  const scrollRef = useRef(null);
  const pinRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, stream?.text, stream?.error]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const empty = messages.length === 0 && !stream;

  if (empty && emptyHint) {
    return (
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="welcome welcome-mini">
          <div className="welcome-badge sm" aria-hidden="true">◮</div>
          <p className="welcome-sub">{emptyHint}</p>
          <div className="suggestions s1">
            <div className="suggestion">
              <div className="suggestion-title">🖥 Capture → ask</div>
              <div className="suggestion-body">Screenshot a terminal error, UI, or docs and ask — I analyze what's on screen.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
      {empty ? (
        <div className="welcome">
          <div className="welcome-badge" aria-hidden="true">◮</div>
          <h2>Prism</h2>
          <p className="welcome-sub">
            Your AI pair-programmer with eyes. Chat normally, attach code files, or capture your
            screen on demand — nothing is recorded without you pressing the button.
          </p>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <div className="suggestion" key={s.title}>
                <div className="suggestion-title"><span aria-hidden="true">{s.icon}</span> {s.title}</div>
                <div className="suggestion-body">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="msg-list">
          {messages.map((m, i) => {
            const isLastAssistant =
              m.role === 'assistant' && i === messages.length - 1;
            return (
              <Message
                key={m.id}
                msg={m}
                onCodeAction={onCodeAction}
                onRegenerate={isLastAssistant ? onRegenerate : null}
              />
            );
          })}
          {stream && <StreamingMessage stream={stream} onCodeAction={onCodeAction} />}
        </div>
      )}
      <div className="chat-pad" />
    </div>
  );
}
