import { isAndroid, isEdgeRunning, startEdgeAssistant, stopEdgeAssistant } from '../capture.js';
import { useState, useEffect } from 'react';
export default function ChatHeader({
  title,
  sidebarOpen,
  onToggleSidebar,
  theme,
  onToggleTheme,
  cfg,
  model,
  onModelChange,
  onOpenAssistant,
  speakOn = false,
  onToggleSpeak,
}) {
  const models = cfg?.models?.length ? cfg.models : [];
  const defaultModel = cfg?.defaults?.chatModel;
  const current = model || defaultModel || 'default';
  const [edgeActive, setEdgeActive] = useState(() => isAndroid() && isEdgeRunning());

  useEffect(() => {
    if (!isAndroid()) return;
    const interval = setInterval(() => {
      setEdgeActive(isEdgeRunning());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggleEdge = () => {
    if (edgeActive) {
      stopEdgeAssistant();
      setEdgeActive(false);
    } else {
      const started = startEdgeAssistant();
      setEdgeActive(started);
    }
  };

  return (
    <header className="chat-header">
      <div className="chat-header-left">
        <button
          className="icon-btn"
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <h1 className="chat-title" title={title}>{title}</h1>
      </div>

      <div className="chat-header-right">
        <select
          className="model-select"
          value={current}
          onChange={(e) => onModelChange(e.target.value === defaultModel ? '' : e.target.value)}
          title="Chat model (Featherless)"
          aria-label="Chat model"
        >
          {!models.length && <option value={current}>{current}</option>}
          {defaultModel && !models.includes(defaultModel) && <option value={defaultModel}>{defaultModel}</option>}
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

                {isAndroid() && (
          <button
            className={`btn small ${edgeActive ? 'danger' : 'primary'}`}
            onClick={toggleEdge}
            title={edgeActive ? 'Disable Edge Assistant overlay' : 'Start Edge Assistant overlay'}
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            {edgeActive ? 'Stop Edge' : '⚡ Start Edge'}
          </button>
        )}
        <button
          className="btn ghost assistant-btn"
          onClick={onOpenAssistant}
          title="Screen assistant (Ctrl/⌘+Shift+A)"
        >
          <span aria-hidden="true">📸</span>
          <span className="assistant-btn-label">&nbsp;Capture</span>
          <kbd className="kbd">⌃⇧A</kbd>
        </button>

        {onToggleSpeak && (
          <button
            className="icon-btn"
            onClick={onToggleSpeak}
            title={speakOn ? 'Voice answers ON — click to mute' : 'Voice answers OFF — click to hear answers'}
            aria-label="Toggle voice answers"
          >
            {speakOn ? '🔊' : '🔇'}
          </button>
        )}

        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀︎' : '☾'}
        </button>
      </div>
    </header>
  );
}
