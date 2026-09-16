import { memo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock, { InlineCode } from './CodeBlock.jsx';

const rehypePlugins = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];
const remarkPlugins = [remarkGfm];

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

const Message = memo(function Message({ msg, onCodeAction }) {
  const isUser = msg.role === 'user';
  const vision = msg.meta?.vision;
  return (
    <article className={`msg ${isUser ? 'msg-user' : 'msg-assistant'}`}>
      <div className="msg-avatar" aria-hidden="true">{isUser ? '🧑‍💻' : '◮'}</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-role">{isUser ? 'You' : 'Prism'}</span>
          {!isUser && msg.meta?.model && <span className="msg-model">{msg.meta.model}</span>}
          {!isUser && vision === 'vision' && <span className="msg-badge vision" title="Answered by the vision model">👁 vision</span>}
          {!isUser && vision === 'ocr' && <span className="msg-badge ocr" title="Vision model fell back to OCR text extraction">⌗ OCR fallback</span>}
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

export default function MessageList({ messages, stream, onCodeAction, emptyHint = null }) {
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
          {messages.map((m) => (
            <Message key={m.id} msg={m} onCodeAction={onCodeAction} />
          ))}
          {stream && <StreamingMessage stream={stream} onCodeAction={onCodeAction} />}
        </div>
      )}
      <div className="chat-pad" />
    </div>
  );
}
