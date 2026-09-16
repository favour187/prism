import { useState } from 'react';

function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

export default function Sidebar({
  conversations,
  activeId,
  search,
  onSearch,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onOpenSettings,
  provider,
  open,
  onClose,
}) {
  const [editing, setEditing] = useState(null); // id being renamed
  const [draft, setDraft] = useState('');

  const commitRename = (id) => {
    const title = draft.trim();
    if (title) onRename(id, title);
    setEditing(null);
  };

  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'open' : 'closed'}`} aria-label="Conversations">
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">◮</span>
            <span className="brand-name">Prism</span>
            {provider && (
              <span
                className={`provider-pill ${provider.ready ? 'ok' : provider.id === 'mock' ? 'mock' : 'bad'}`}
                title={provider.ready ? `AI provider: ${provider.id}` : (provider.reason ?? 'Not configured')}
              >
                {provider.id === 'mock' ? 'demo model' : provider.ready ? provider.id : 'no provider'}
              </span>
            )}
          </div>
          <button className="btn new-chat" onClick={onNew} title="New conversation">
            <span aria-hidden="true">＋</span> New chat
          </button>
          <div className="search-wrap">
            <input
              className="search"
              type="search"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              aria-label="Search conversations"
            />
          </div>
        </div>

        <nav className="convo-list" role="list">
          {conversations.length === 0 && (
            <p className="convo-empty">
              {search ? 'No conversations match your search.' : 'No conversations yet — start chatting!'}
            </p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              role="listitem"
              className={`convo-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              {editing === c.id ? (
                <input
                  className="rename-input"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(c.id);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={() => commitRename(c.id)}
                />
              ) : (
                <>
                  <div className="convo-main">
                    <span className="convo-title">{c.title}</span>
                    <span className="convo-time">{timeAgo(c.updatedAt)}</span>
                  </div>
                  <div className="convo-actions">
                    <button
                      className="icon-btn"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(c.id);
                        setDraft(c.title);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete “${c.title}”? This cannot be undone.`)) onDelete(c.id);
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="btn ghost" onClick={onOpenSettings}>
            ⚙ Settings &amp; privacy
          </button>
        </div>
      </aside>
    </>
  );
}
