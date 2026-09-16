import { useState, isValidElement, Children } from 'react';

/** Extract raw text from a (possibly highlighted) React node tree. */
function extractText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) return extractText(node.props?.children);
  return '';
}

export function InlineCode({ children }) {
  return <code className="inline-code">{children}</code>;
}

export default function CodeBlock({ className = '', children, onAction }) {
  const [copied, setCopied] = useState(false);
  const langMatch = /language-([\w+-]+)/.exec(className);
  const lang = langMatch?.[1] ?? 'text';
  const code = extractText(children).replace(/\n$/, '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
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
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang}</span>
        <div className="code-actions">
          {onAction && (
            <>
              <button className="code-action" title="Explain this code" onClick={() => onAction('explain', code)}>Explain</button>
              <button className="code-action" title="Fix this code" onClick={() => onAction('fix', code)}>Fix</button>
              <button className="code-action" title="Improve this code" onClick={() => onAction('improve', code)}>Improve</button>
              <span className="code-actions-sep" />
            </>
          )}
          <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copy}>
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
        </div>
      </div>
      <pre className="code-pre"><code className={`hljs ${className}`}>{children}</code></pre>
    </div>
  );
}

export { Children };
