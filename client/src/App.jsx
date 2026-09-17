import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamChat, regenerateChat } from './api.js';
import { speak, stopSpeaking, ttsSupported } from './voice.js';
import Sidebar from './components/Sidebar.jsx';
import ChatHeader from './components/ChatHeader.jsx';
import MessageList from './components/MessageList.jsx';
import Composer from './components/Composer.jsx';
import ScreenAssistant from './components/ScreenAssistant.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import WriteDesk from './components/WriteDesk.jsx';

const WATCH_NARRATION_PROMPT =
  'Watch narration: in ONE short sentence, describe what visibly changed on the screen. ' +
  'Be concrete — name the app, dialog, or content that changed. No preamble.';

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [stream, setStream] = useState(null); // { text, meta, error }
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark');
  const [search, setSearch] = useState('');

  const [pendingFiles, setPendingFiles] = useState([]);     // uploaded attachments
  const [pendingScreenshots, setPendingScreenshots] = useState([]); // {id, dataUrl, name}
  const [pendingAction, setPendingAction] = useState(null); // { action, selection }
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [view, setView] = useState('chat'); // 'chat' | 'write'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState(() => localStorage.getItem('prism.model') ?? '');
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('prism.autospeak') !== '0');
  const [toast, setToast] = useState(null);

  const abortRef = useRef(null);
  const toastTimer = useRef(null);
  const streamTextRef = useRef('');

  const showToast = useCallback((message, kind = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, kind });
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  // ------------------------------ bootstrap ------------------------------------
  useEffect(() => {
    api.getConfig()
      .then(setCfg)
      .catch(() => showToast('Backend unreachable — is the server running?', 'error'));
    refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('prism.theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('prism.model', model ?? '');
  }, [model]);

  const refreshConversations = useCallback(async (query = '') => {
    try {
      const data = await api.listConversations(query);
      setConversations(data.conversations);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [showToast]);

  // debounced search
  useEffect(() => {
    const t = setTimeout(() => refreshConversations(search), 250);
    return () => clearTimeout(t);
  }, [search, refreshConversations]);

  const openConversation = useCallback(async (id) => {
    abortRef.current?.abort();
    setStream(null);
    setActiveId(id);
    if (window.innerWidth <= 900) setSidebarOpen(false);
    try {
      const data = await api.getConversation(id);
      setMessages(data.messages);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [showToast]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setStream(null);
    setActiveId(null);
    setMessages([]);
    setPendingFiles([]);
    setPendingScreenshots([]);
    setPendingAction(null);
    if (window.innerWidth <= 900) setSidebarOpen(false);
  }, []);

  const deleteConversation = useCallback(async (id) => {
    try {
      await api.deleteConversation(id);
      if (activeId === id) newConversation();
      await refreshConversations(search);
      showToast('Conversation deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [activeId, newConversation, refreshConversations, search, showToast]);

  const renameConversation = useCallback(async (id, title) => {
    try {
      await api.renameConversation(id, title);
      await refreshConversations(search);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [refreshConversations, search, showToast]);

  // ------------------------------ uploading -------------------------------------
  const addFiles = useCallback(async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    try {
      const data = await api.uploadFiles(files);
      const accepted = (data.attachments ?? []).map((a) => ({
        ...a,
        previewUrl: a.kind === 'image' ? api.imagePreviewUrl(a.id) : null,
      }));
      setPendingFiles((prev) => [...prev, ...accepted]);
      for (const r of data.rejected ?? []) showToast(`${r.name}: ${r.reason}`, 'error');
      if (accepted.length) showToast(`${accepted.length} file(s) ready — add a question and send.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [showToast]);

  // ------------------------------ sending ---------------------------------------
  const canSend = useMemo(() => !stream, [stream]);

  const sendMessage = useCallback(({ content }) => {
    if (!canSend) return;
    const trimmed = (content ?? '').trim();
    if (!trimmed && !pendingFiles.length && !pendingScreenshots.length && !pendingAction) return;
    stopSpeaking();
    streamTextRef.current = '';

    const attachmentIds = pendingFiles.map((f) => f.id);
    const screenshots = pendingScreenshots.map((s) => s.dataUrl);
    const optimisticParts = [trimmed];
    if (pendingAction) {
      optimisticParts.unshift(
        `**${labelOf(pendingAction.action)}${pendingAction.selection ? ' — selected code' : ''}**`,
      );
    }
    if (pendingScreenshots.length) {
      optimisticParts.push(
        ...pendingScreenshots.map((s) => `![${s.name}](${s.dataUrl})`),
      );
    }
    if (pendingFiles.length) {
      optimisticParts.push(...pendingFiles.filter((f) => f.kind === 'file').map((f) => `📎 \`${f.name}\``));
      optimisticParts.push(...pendingFiles.filter((f) => f.kind === 'image' && f.previewUrl).map((f) => `![${f.name}](${f.previewUrl})`));
    }

    const optimistic = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: optimisticParts.filter(Boolean).join('\n\n') || '(attachments sent)',
      createdAt: Date.now(),
      meta: {},
      attachments: [],
    };
    setMessages((prev) => [...prev, optimistic]);
    setStream({ text: '', meta: null, error: null });

    const payload = {
      conversationId: activeId,
      content: trimmed,
      attachmentIds,
      screenshots,
      action: pendingAction?.action ?? null,
      selection: pendingAction?.selection ?? '',
      model: model || null,
    };
    setPendingFiles([]);
    setPendingScreenshots([]);
    setPendingAction(null);

    let sawMetaConvo = activeId;
    abortRef.current = streamChat(payload, {
      onMeta: (meta) => {
        if (meta.conversationId && meta.conversationId !== sawMetaConvo) {
          sawMetaConvo = meta.conversationId;
          setActiveId(meta.conversationId);
        }
        setStream((s) => (s ? { ...s, meta: { ...(s.meta ?? {}), ...meta } } : s));
      },
      onDelta: (delta) => {
        streamTextRef.current += delta;
        setStream((s) => (s ? { ...s, text: s.text + delta } : s));
      },
      onNotice: (notice) => showToast(notice, 'info'),
      onError: (err) => {
        setStream((s) => (s ? { ...s, error: err } : { text: '', meta: null, error: err }));
        showToast(err.message, 'error');
      },
      onDone: async (done) => {
        setStream(null);
        const finalText = streamTextRef.current;
        streamTextRef.current = '';
        if (done?.conversationId) {
          sawMetaConvo = done.conversationId;
          try {
            const data = await api.getConversation(done.conversationId);
            if (sawMetaConvo === done.conversationId) setMessages(data.messages);
          } catch { /* keep optimistic view */ }
        }
        refreshConversations(search);
        if (autoSpeak && finalText && ttsSupported()) speak(finalText).catch(() => {});
      },
    });

    function labelOf(a) {
      return { explain: 'Explain', fix: 'Fix', improve: 'Improve', generate: 'Generate' }[a] ?? a;
    }
  }, [canSend, pendingFiles, pendingScreenshots, pendingAction, activeId, model, showToast, refreshConversations, search, autoSpeak]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStream((s) => (s && s.text ? { ...s, error: { code: 'STOPPED', message: 'Generation stopped.' } } : null));
  }, []);

  /** Regenerate the most recent assistant reply. */
  const regenerateMessage = useCallback((msg) => {
    if (stream) return;
    if (!activeId && !msg?.id) return;
    stopSpeaking();
    streamTextRef.current = '';
    // Optimistically drop the last assistant reply; it is replaced on done.
    setMessages((prev) => {
      const idx = prev.map((m) => m.role).lastIndexOf('assistant');
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    setStream({ text: '', meta: null, error: null });
    abortRef.current = regenerateChat(activeId, {
      onMeta: (meta) => setStream((s) => (s ? { ...s, meta: { ...(s.meta ?? {}), ...meta } } : s)),
      onDelta: (delta) => {
        streamTextRef.current += delta;
        setStream((s) => (s ? { ...s, text: s.text + delta } : s));
      },
      onNotice: (notice) => showToast(notice, 'info'),
      onError: (err) => {
        setStream((s) => (s ? { ...s, error: err } : { text: '', meta: null, error: err }));
        showToast(err.message, 'error');
      },
      onDone: async (done) => {
        setStream(null);
        const finalText = streamTextRef.current;
        streamTextRef.current = '';
        if (done?.conversationId) {
          try {
            const data = await api.getConversation(done.conversationId);
            setMessages(data.messages);
          } catch { /* keep optimistic view */ }
        }
        refreshConversations(search);
        if (autoSpeak && finalText && ttsSupported()) speak(finalText).catch(() => {});
      },
    }, model || null);
  }, [stream, activeId, model, showToast, refreshConversations, search, autoSpeak]);

  // Code-block quick actions → compose an action turn
  const onCodeAction = useCallback((action, code) => {
    setPendingAction({ action, selection: code });
    showToast(`${action[0].toUpperCase() + action.slice(1)}: selected code attached. Press send (or add a note first).`);
    document.querySelector('.composer textarea')?.focus();
  }, [showToast]);

  /** Watch-mode narration: a background turn describing the visual change. */
  const narrateShot = useCallback((dataUrl, n) => {
    if (stream) return; // never interrupt a user's turn with a narration
    stopSpeaking();
    streamTextRef.current = '';
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}-w${n}`,
        role: 'user',
        content: `🎥 Screen changed — shot #${n}\n\n![watch](${dataUrl})`,
        createdAt: Date.now(),
        meta: { watch: true },
        attachments: [],
      },
    ]);
    setStream({ text: '', meta: null, error: null });
    let sawConvo = activeId;
    abortRef.current = streamChat(
      { conversationId: activeId, content: WATCH_NARRATION_PROMPT, screenshots: [dataUrl], model: model || null },
      {
        onMeta: (meta) => {
          if (meta.conversationId && meta.conversationId !== sawConvo) {
            sawConvo = meta.conversationId;
            setActiveId(meta.conversationId);
          }
          setStream((s) => (s ? { ...s, meta: { ...(s.meta ?? {}), ...meta } } : s));
        },
        onDelta: (delta) => {
          streamTextRef.current += delta;
          setStream((s) => (s ? { ...s, text: s.text + delta } : s));
        },
        onNotice: (notice) => showToast(notice, 'info'),
        onError: (err) => setStream((s) => (s ? { ...s, error: err } : { text: '', meta: null, error: err })),
        onDone: async (done) => {
          setStream(null);
          const finalText = streamTextRef.current;
          if (done?.conversationId) {
            try {
              const data = await api.getConversation(done.conversationId);
              setMessages(data.messages);
            } catch { /* keep optimistic view */ }
          }
          if (autoSpeak && finalText && ttsSupported()) speak(finalText).catch(() => {});
        },
      },
    );
  }, [stream, activeId, model, autoSpeak, showToast]);

  /** Write desk → chat handoff: ask the model to review the draft. */
  const discussDraft = useCallback((docText) => {
    setView('chat');
    sendMessage({ content: `Review this draft and suggest improvements — be specific:\n\n${String(docText).slice(0, 8000)}` });
  }, [sendMessage]);

  // Screenshot captured in the floating assistant
  const onScreenshot = useCallback((dataUrl, name = 'screenshot.png') => {
    setPendingScreenshots((prev) => [
      ...prev,
      { id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, dataUrl, name },
    ]);
    showToast('Screenshot attached — preview is in the composer.', 'success');
  }, [showToast]);

  // Global shortcuts: Ctrl/Cmd+Shift+A toggles the screen assistant, plus
  // Arc-style keys (Cmd+K palette, Cmd+N new chat, Cmd+J sidebar) for everyone.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        setAssistantOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'k') {
          e.preventDefault();
          setSidebarOpen(true);
          const search = document.querySelector('.search');
          search?.focus();
          return;
        }
        if (key === 'n') {
          e.preventDefault();
          newConversation();
          return;
        }
        if (key === 'j') {
          e.preventDefault();
          setSidebarOpen((v) => !v);
          return;
        }
        if (key === ',') {
          e.preventDefault();
          setSettingsOpen(true);
          return;
        }
      }
      if (e.key === 'Escape') {
        setAssistantOpen(false);
        setSettingsOpen(false);
      }
      // Arc-style: focus the composer quickly with Tab (unless already typing).
      if (e.key === 'Tab' && view === 'chat') {
        const active = document.activeElement;
        const typing = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.tagName === 'SELECT');
        const ta = document.querySelector('.composer textarea');
        if (ta && active !== ta && !typing) {
          e.preventDefault();
          ta.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newConversation, view]);

  const providerReady = cfg?.provider?.ready;
  const activeTitle = useMemo(
    () => conversations.find((c) => c.id === activeId)?.title ?? 'New conversation',
    [conversations, activeId],
  );

  return (
    <div className={`app ${sidebarOpen ? 'with-sidebar' : ''}`}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        search={search}
        onSearch={setSearch}
        onSelect={openConversation}
        onNew={newConversation}
        onDelete={deleteConversation}
        onRename={renameConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        provider={cfg?.provider}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main">
        <ChatHeader
          title={activeTitle}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          cfg={cfg}
          model={model}
          onModelChange={setModel}
          onOpenAssistant={() => setAssistantOpen((v) => !v)}
          speakOn={autoSpeak}
          onToggleSpeak={() => {
            setAutoSpeak((v) => {
              const next = !v;
              localStorage.setItem('prism.autospeak', next ? '1' : '0');
              if (!next) stopSpeaking();
              return next;
            });
          }}
        />

        {cfg && providerReady === false && (
          <div className="banner banner-warn" role="alert">
            <strong>Model provider not configured.</strong>&nbsp;{cfg.provider.reason} Add it to your
            server environment, then restart. (Tip: set <code>AI_PROVIDER=mock</code> to try the UI locally.)
          </div>
        )}

        <div className="view-tabs" role="tablist" aria-label="Workspace">
          <button
            role="tab" aria-selected={view === 'chat'}
            className={`view-tab ${view === 'chat' ? 'active' : ''}`}
            onClick={() => setView('chat')}
          >💬 Chat</button>
          <button
            role="tab" aria-selected={view === 'write'}
            className={`view-tab ${view === 'write' ? 'active' : ''}`}
            onClick={() => setView('write')}
          >✍️ Write</button>
        </div>

        {view === 'write' ? (
          <WriteDesk onDiscuss={discussDraft} onToast={showToast} />
        ) : (
          <>
            <MessageList
              messages={messages}
              stream={stream}
              onCodeAction={onCodeAction}
              onRegenerate={activeId ? regenerateMessage : null}
            />

            <Composer
              disabled={!canSend}
              streaming={Boolean(stream)}
              onSend={sendMessage}
              onStop={stopStreaming}
              onFiles={addFiles}
              pendingFiles={pendingFiles}
              onRemoveFile={(id) => setPendingFiles((p) => p.filter((f) => f.id !== id))}
              screenshots={pendingScreenshots}
              onRemoveScreenshot={(id) => setPendingScreenshots((p) => p.filter((s) => s.id !== id))}
              pendingAction={pendingAction}
              onClearAction={() => setPendingAction(null)}
              onAction={(action) => setPendingAction({ action, selection: '' })}
              onOpenAssistant={() => setAssistantOpen(true)}
              onNew={newConversation}
              speakOn={autoSpeak}
              onToggleSpeak={() => {
                setAutoSpeak((v) => {
                  const next = !v;
                  localStorage.setItem('prism.autospeak', next ? '1' : '0');
                  if (!next) stopSpeaking();
                  return next;
                });
              }}
              onToast={showToast}
            />
          </>
        )}
      </main>

      <ScreenAssistant
        open={assistantOpen}
        onToggle={() => setAssistantOpen((v) => !v)}
        onClose={() => setAssistantOpen(false)}
        onCapture={onScreenshot}
        onError={(msg) => showToast(msg, 'error')}
        onWatchNarrate={narrateShot}
        streaming={Boolean(stream)}
      />

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          cfg={cfg}
          onClose={() => setSettingsOpen(false)}
          onWiped={() => {
            setConversations([]);
            newConversation();
            showToast('All local data wiped from the server.');
            setSearch('');
          }}
        />
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
