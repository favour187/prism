import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamChat } from './api.js';
import { grabFrame, isDesktop } from './capture.js';
import RegionSelector from './components/RegionSelector.jsx';
import MessageList from './components/MessageList.jsx';

const desktop = window.prismDesktop ?? null;
let shotSeq = 0;

/**
 * Compact "toggle" assistant — the Arc-style experience.
 * Runs inside the Electron overlay window and at /?overlay=1 in a browser.
 *
 * Flow: press global hotkey → panel appears → one click captures
 * screen/window/region → type a question (or just hit send) → the answer
 * streams right here in the small panel.
 */
export default function OverlayApp() {
  const [messages, setMessages] = useState([]);
  const [stream, setStream] = useState(null);
  const [shots, setShots] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null);            // 'screen' | 'window' | 'region'
  const [windows, setWindows] = useState(null);      // window-picker list
  const [regionFrame, setRegionFrame] = useState(null); // web-fallback region
  const [notice, setNotice] = useState(null);
  const [pinned, setPinned] = useState(true);
  const [cfg, setCfg] = useState(null);
  const abortRef = useRef(null);
  const noticeTimer = useRef(null);

  const [conversationId, setConversationId] = useState(
    () => localStorage.getItem('prism.overlayConversationId') ?? null,
  );

  const flash = useCallback((msg, ms = 3600) => {
    clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);

  useEffect(() => {
    api.getConfig().then(setCfg).catch(() => {});
    if (conversationId) {
      api.getConversation(conversationId)
        .then((d) => setMessages(d.messages))
        .catch(() => {
          localStorage.removeItem('prism.overlayConversationId');
          setConversationId(null);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addShot = useCallback((dataUrl, name = 'capture.png') => {
    shotSeq += 1;
    setShots((prev) => [...prev.slice(-3), { id: `shot-${Date.now()}-${shotSeq}`, dataUrl, name }]);
  }, []);

  // ------------------------------- capture ---------------------------------
  const captureScreen = async () => {
    setBusy('screen');
    try {
      const dataUrl = desktop ? await desktop.captureScreen() : (await grabFrame()).dataUrl;
      addShot(dataUrl, 'screen.png');
    } catch (err) {
      flash(err?.name === 'NotAllowedError' ? 'Capture cancelled.' : `Capture failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const showWindowPicker = async () => {
    setBusy('window');
    try {
      if (desktop) {
        setWindows(await desktop.listWindows());
      } else {
        // Browser fallback: the OS picker itself offers window/tab choice.
        addShot((await grabFrame()).dataUrl, 'window.png');
      }
    } catch (err) {
      flash(`Could not list windows: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const pickWindow = async (id) => {
    setWindows(null);
    setBusy('window');
    try {
      addShot(await desktop.captureWindow(id), 'window.png');
    } catch (err) {
      flash(`Window capture failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const captureRegion = async () => {
    setBusy('region');
    try {
      if (desktop) {
        const dataUrl = await desktop.captureRegion(); // transparent selector over your screen
        if (dataUrl) addShot(dataUrl, 'region.png');
      } else {
        setRegionFrame(await grabFrame());
      }
    } catch (err) {
      flash(err?.name === 'NotAllowedError' ? 'Capture cancelled.' : `Region capture failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  // -------------------------------- sending ---------------------------------
  const canSend = !stream && (text.trim() || shots.length > 0);

  const send = useCallback(() => {
    if (!canSend) return;
    const content = text.trim();
    const payloadShots = shots.map((s) => s.dataUrl);

    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: [content, ...payloadShots.map((d, i) => `![capture ${i + 1}](${d})`)].filter(Boolean).join('\n\n') || 'Screenshot',
        createdAt: Date.now(),
        meta: {},
        attachments: [],
      },
    ]);
    setStream({ text: '', meta: null, error: null });
    setText('');
    setShots([]);

    abortRef.current = streamChat(
      { conversationId, content, screenshots: payloadShots },
      {
        onMeta: (meta) => {
          if (meta.conversationId && meta.conversationId !== conversationId) {
            setConversationId(meta.conversationId);
            localStorage.setItem('prism.overlayConversationId', meta.conversationId);
          }
          setStream((s) => (s ? { ...s, meta: { ...(s.meta ?? {}), ...meta } } : s));
        },
        onDelta: (delta) => setStream((s) => (s ? { ...s, text: s.text + delta } : s)),
        onNotice: (n) => flash(n, 5200),
        onError: (err) => setStream((s) => (s ? { ...s, error: err } : { text: '', meta: null, error: err })),
        onDone: async (done) => {
          setStream(null);
          if (done?.conversationId) {
            try {
              const data = await api.getConversation(done.conversationId);
              setMessages(data.messages);
            } catch { /* keep optimistic view */ }
          }
        },
      },
    );
  }, [canSend, text, shots, conversationId, flash]);

  const stop = () => {
    abortRef.current?.abort();
    setStream((s) => (s && s.text ? { ...s, error: { code: 'STOPPED', message: 'Stopped.' } } : null));
  };

  const newThread = () => {
    abortRef.current?.abort();
    setStream(null);
    setMessages([]);
    setShots([]);
    setConversationId(null);
    localStorage.removeItem('prism.overlayConversationId');
  };

  const togglePin = async () => {
    const next = desktop ? await desktop.setPin(!pinned) : !pinned;
    setPinned(next);
  };

  const providerReady = cfg?.provider?.ready ?? true;
  const kbd = useMemo(() => (navigator.platform?.includes('Mac') ? '⌘⇧A' : 'Ctrl+Shift+A'), []);

  return (
    <div className="overlay-app">
      {/* draggable title strip (frameless Electron window) */}
      <header className="ov-drag">
        <span className="ov-brand">◮ Prism</span>
        {cfg && (
          <span className={`ov-dot ${cfg.provider.ready ? 'ok' : cfg.provider.id === 'mock' ? 'mock' : 'bad'}`}
            title={cfg.provider.ready ? `provider: ${cfg.provider.id}` : (cfg.provider.reason ?? 'not configured')} />
        )}
        <span className="ov-hint no-drag">{kbd}</span>
        <div className="ov-actions no-drag">
          <button className={`ov-btn ${pinned ? 'on' : ''}`} title={pinned ? 'Unpin from top' : 'Keep on top'} onClick={togglePin}>📌</button>
          {desktop
            ? <button className="ov-btn" title="Open full app" onClick={() => desktop.openFullApp()}>⤢</button>
            : <a className="ov-btn" title="Open full app" href="/" target="_blank" rel="noreferrer">⤢</a>}
          {desktop && <button className="ov-btn" title="Hide (reopen with hotkey)" onClick={() => desktop.hide()}>✕</button>}
          {!desktop && messages.length > 0 && <button className="ov-btn" title="New thread" onClick={newThread}>✕</button>}
        </div>
      </header>

      {!providerReady && (
        <div className="ov-banner">
          Model not configured — set <code>FEATHERLESS_API_KEY</code> on the server.
        </div>
      )}
      {notice && <div className="ov-notice">{notice}</div>}

      {regionFrame && (
        <RegionSelector
          frame={regionFrame}
          onCancel={() => setRegionFrame(null)}
          onDone={(d) => { setRegionFrame(null); addShot(d, 'region.png'); }}
        />
      )}

      {windows && (
        <div className="ov-windowpicker">
          <div className="ov-picker-head">
            <strong>Pick a window</strong>
            <button className="icon-btn" onClick={() => setWindows(null)} title="Cancel">×</button>
          </div>
          <div className="ov-picker-grid">
            {windows.map((w) => (
              <button key={w.id} className="ov-window" onClick={() => pickWindow(w.id)} title={w.name}>
                <img src={w.thumbnail} alt="" />
                <span>{w.name}</span>
              </button>
            ))}
            {!windows.length && <p className="ov-empty">No capturable windows found.</p>}
          </div>
        </div>
      )}

      <div className="ov-messages">
        <MessageList
          messages={messages}
          stream={stream}
          onCodeAction={null}
          emptyHint={`Press ${kbd} anywhere to toggle me. Capture your screen below, then ask about it.`}
        />
      </div>

      {shots.length > 0 && (
        <div className="ov-shots">
          {shots.map((s) => (
            <span key={s.id} className="ov-shot">
              <img src={s.dataUrl} alt="capture preview" />
              <button className="ov-shot-x" onClick={() => setShots((p) => p.filter((x) => x.id !== s.id))}>×</button>
            </span>
          ))}
        </div>
      )}

      <footer className="ov-composer">
        <div className="ov-capture-row">
          <button className="ov-cap" disabled={Boolean(busy) || Boolean(stream)} onClick={captureScreen} title="Capture the whole screen">
            🖥<span>Screen</span>{busy === 'screen' && <span className="spinner" />}
          </button>
          <button className="ov-cap" disabled={Boolean(busy) || Boolean(stream)} onClick={showWindowPicker} title="Capture one app window">
            🪟<span>Window</span>{busy === 'window' && <span className="spinner" />}
          </button>
          <button className="ov-cap" disabled={Boolean(busy) || Boolean(stream)} onClick={captureRegion} title="Drag-select a region">
            ✂️<span>Region</span>{busy === 'region' && <span className="spinner" />}
          </button>
        </div>
        <div className="ov-input-row">
          <input
            className="ov-input"
            placeholder={shots.length ? 'Ask about the capture…' : 'Ask anything…'}
            value={text}
            disabled={Boolean(stream)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            autoFocus
          />
          {stream
            ? <button className="ov-send stop" onClick={stop} title="Stop">■</button>
            : <button className="ov-send" onClick={send} disabled={!canSend} title="Send">➤</button>}
        </div>
      </footer>
    </div>
  );
}
