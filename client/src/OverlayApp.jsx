import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamChat } from './api.js';
import { grabFrame, isAndroid, androidCapture, ScreenWatcher } from './capture.js';
import { VoiceRecorder, transcribe, speak, stopSpeaking, voiceSupported, ttsSupported } from './voice.js';
import RegionSelector from './components/RegionSelector.jsx';
import MessageList from './components/MessageList.jsx';

const desktop = window.prismDesktop ?? null;
const android = isAndroid();
let shotSeq = 0;

const SENSITIVITY = { low: 12, medium: 7, high: 4 };
const SIZE_PRESETS = [
  { key: 'S', w: 420, h: 640 },
  { key: 'M', w: 480, h: 740 },
  { key: 'L', w: 620, h: 840 },
];

const WRITE_STYLES = [
  { id: 'fix', label: 'Fix grammar', hint: 'corrects spelling & grammar, keeps voice' },
  { id: 'improve', label: 'Improve', hint: 'same meaning, sharper writing' },
  { id: 'concise', label: 'Concise', hint: 'say it in fewer words' },
  { id: 'professional', label: 'Professional', hint: 'formal, work-appropriate tone' },
  { id: 'friendly', label: 'Friendly', hint: 'warmer, more casual tone' },
  { id: 'expand', label: 'Expand', hint: 'more detail & structure' },
  { id: 'to_en', label: '→ English', hint: 'translate to English' },
  { id: 'to_fr', label: '→ French', hint: 'traduire en français' },
];

const WRITE_PROMPT = {
  fix: "Fix the grammar and spelling of this text. Return ONLY the corrected text — no commentary, no quotes, preserve the author's voice.",
  improve: 'Improve this writing: clearer, sharper, same meaning and length roughly. Return ONLY the improved text — no commentary.',
  concise: 'Make this text significantly more concise without losing meaning. Return ONLY the rewritten text — no commentary.',
  professional: 'Rewrite this text in a professional, work-appropriate tone. Return ONLY the rewritten text — no commentary.',
  friendly: 'Rewrite this text in a warmer, friendlier, more casual tone. Return ONLY the rewritten text — no commentary.',
  expand: 'Expand this text with more detail and structure. Return ONLY the rewritten text — no commentary.',
  to_en: 'Translate this text to natural English. Return ONLY the translation — no commentary.',
  to_fr: 'Translate this text to natural French. Return ONLY the translation — no commentary.',
};

/**
 * Compact toggle assistant — the Arc-style experience.
 * Global hotkey → panel → capture/watch → ask → answer (spoken) → write back.
 */
export default function OverlayApp() {
  const [messages, setMessages] = useState([]);
  const [stream, setStream] = useState(null);
  const [shots, setShots] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null);
  const [windows, setWindows] = useState(null);
  const [regionFrame, setRegionFrame] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pinned, setPinned] = useState(true);
  const [cfg, setCfg] = useState(null);
  const [mic, setMic] = useState('idle');
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('prism.autospeak') !== '0');
  const [watch, setWatch] = useState(null); // {count, sensitivity}
  const [writeOpen, setWriteOpen] = useState(false);
  const [writeResult, setWriteResult] = useState(null); // last write-mode output
  const [sizeMenu, setSizeMenu] = useState(false);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  const abortRef = useRef(null);
  const noticeTimer = useRef(null);
  const recorderRef = useRef(null);
  const streamTextRef = useRef('');
  const watcherRef = useRef(null);
  const writeTaskRef = useRef(false);

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

  // ------------------------------- window size --------------------------------
  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Restore the remembered size in the desktop shell.
  useEffect(() => {
    if (!desktop?.setSize) return;
    const stored = (localStorage.getItem('prism.overlaySize') ?? '').split('x').map(Number);
    if (stored.length === 2 && stored.every((n) => Number.isFinite(n) && n > 0)) {
      desktop.setSize(stored[0], stored[1]).then((s) => s && setDims(s)).catch(() => {});
    }
  }, []);

  const applySize = useCallback(async (w, h) => {
    if (!desktop?.setSize) {
      setSizeMenu(false);
      return;
    }
    const actual = await desktop.setSize(w, h).catch(() => null);
    const final = actual ?? { w, h };
    setDims(final);
    localStorage.setItem('prism.overlaySize', `${final.w}x${final.h}`);
    setSizeMenu(false);
  }, []);

  const startDragResize = (e) => {
    if (!desktop?.setSize) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const { w: startW, h: startH } = dims;
    let raf = 0;
    let last = { w: startW, h: startH };
    const move = (ev) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        last = { w: Math.round(startW + (ev.clientX - startX)), h: Math.round(startH + (ev.clientY - startY)) };
        desktop.setSize(last.w, last.h).then((s) => s && setDims(s)).catch(() => {});
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      localStorage.setItem('prism.overlaySize', `${last.w}x${last.h}`);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const addShot = useCallback((dataUrl, name = 'capture.png') => {
    shotSeq += 1;
    setShots((prev) => [...prev.slice(-3), { id: `shot-${Date.now()}-${shotSeq}`, dataUrl, name }]);
  }, []);

  // ------------------------------- watch mode ---------------------------------
  const stopWatch = useCallback(() => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setWatch(null);
  }, []);

  const toggleWatch = useCallback(async (sensitivity = watch?.sensitivity ?? 'medium') => {
    if (watcherRef.current) {
      const n = watch?.count ?? 0;
      stopWatch();
      flash(`Watch stopped — ${n} change${n === 1 ? '' : 's'} captured.`);
      return;
    }
    stopSpeaking();
    const watcher = new ScreenWatcher({ threshold: SENSITIVITY[sensitivity] ?? 7 });
    try {
      await watcher.start({
        onChange: ({ dataUrl, n, jumps, delta }) => {
          addShot(dataUrl, `watch-${n}.jpg`);
          setWatch((prev) => (prev ? { ...prev, count: n } : prev));
          flash(`Movement detected (Δ${delta.toFixed(1)}${jumps >= 3 ? ', layout jump' : ''}) — screenshot ${n} captured.`, 2600);
        },
        onTick: (avg) => {
          if (avg < 0) {
            stopWatch();
            flash('Capture stream ended — Watch stopped.');
          }
        },
      });
      watcherRef.current = watcher;
      setWatch({ count: 0, sensitivity });
      flash(`Watching for screen changes — sensitivity: ${sensitivity}. Frames are only kept when something moves.`, 4200);
    } catch (err) {
      flash(err?.name === 'NotAllowedError' ? 'Watch needs capture permission.' : `Watch failed: ${err.message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopWatch, addShot, flash, watch?.sensitivity, watch?.count]);

  useEffect(() => () => watcherRef.current?.stop(), []);

  // ------------------------------- capture ---------------------------------
  const captureScreen = async () => {
    setBusy('screen');
    try {
      const dataUrl = android
        ? await androidCapture('screen')
        : desktop
          ? await desktop.captureScreen()
          : (await grabFrame()).dataUrl;
      if (dataUrl) addShot(dataUrl, 'screen.png');
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
      if (android) {
        const dataUrl = await androidCapture('screen');
        if (dataUrl) setRegionFrame({ dataUrl });
      } else if (desktop) {
        const dataUrl = await desktop.captureRegion();
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

  // --------------------------------- voice ----------------------------------
  useEffect(() => {
    localStorage.setItem('prism.autospeak', autoSpeak ? '1' : '0');
  }, [autoSpeak]);

  const toggleMic = async () => {
    if (mic === 'recording') {
      setMic('transcribing');
      const { blob, mime } = (await recorderRef.current?.stop()) ?? {};
      recorderRef.current = null;
      try {
        if (!blob) throw new Error('Nothing was recorded.');
        const transcript = await transcribe(blob, mime);
        if (transcript) {
          setText((t) => (t.trim() ? `${t.trim()} ${transcript}` : transcript));
        } else {
          flash('Heard silence — try again closer to the mic.');
        }
      } catch (err) {
        flash(err.message ?? 'Transcription failed.');
      } finally {
        setMic('idle');
      }
      return;
    }
    if (mic === 'transcribing') return;
    stopSpeaking();
    try {
      recorderRef.current = new VoiceRecorder();
      await recorderRef.current.start();
      setMic('recording');
    } catch (err) {
      recorderRef.current = null;
      flash(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied — allow access in OS/browser settings.'
          : `Mic unavailable: ${err.message}`,
      );
    }
  };

  // -------------------------------- sending ---------------------------------
  const canSend = !stream && (text.trim() || shots.length > 0);

  const sendContent = useCallback((content, { isWrite = false } = {}) => {
    stopSpeaking();
    stopWatch();
    streamTextRef.current = '';
    writeTaskRef.current = isWrite;
    const payloadShots = shots.map((s) => s.dataUrl);

    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: [isWrite ? `**✍️ Write request**` : content, isWrite ? `> ${text.slice(0, 500)}` : '',
          ...payloadShots.map((d, i) => `![capture ${i + 1}](${d})`)].filter(Boolean).join('\n\n') || 'Screenshot',
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
        onDelta: (delta) => {
          streamTextRef.current += delta;
          setStream((s) => (s ? { ...s, text: s.text + delta } : s));
        },
        onNotice: (n) => flash(n, 5200),
        onError: (err) => setStream((s) => (s ? { ...s, error: err } : { text: '', meta: null, error: err })),
        onDone: async (done) => {
          setStream(null);
          const finalText = streamTextRef.current;
          if (writeTaskRef.current && finalText) {
            setWriteResult(finalText.trim().replace(/^["']|["']$/g, ''));
            writeTaskRef.current = false;
          }
          if (done?.conversationId) {
            try {
              const data = await api.getConversation(done.conversationId);
              setMessages(data.messages);
            } catch { /* keep optimistic view */ }
          }
          if (autoSpeak && finalText && ttsSupported()) {
            speak(finalText).catch(() => {});
          }
        },
      },
    );
  }, [shots, conversationId, flash, autoSpeak, stopWatch, text]);

  const send = useCallback(() => {
    if (!canSend) return;
    sendContent(text.trim());
    setWriteResult(null);
  }, [canSend, text, sendContent]);

  const runWrite = useCallback((style) => {
    const source = text.trim();
    if (!source) {
      flash('Type or paste some text first, then pick a style.');
      return;
    }
    setWriteOpen(false);
    setWriteResult(null);
    sendContent(`${WRITE_PROMPT[style.id]}\n\n---\n${source}`, { isWrite: true });
  }, [text, sendContent, flash]);

  const insertResult = async () => {
    if (!writeResult) return;
    if (desktop?.writeText) {
      const res = await desktop.writeText(writeResult).catch(() => ({ copied: false, pasted: false }));
      flash(res.pasted ? 'Inserted into your app ✓' : 'Copied to clipboard — panel hid; paste with Ctrl/⌘+V.');
    } else {
      await navigator.clipboard.writeText(writeResult).catch(() => {});
      flash('Copied — paste anywhere with Ctrl/⌘+V.');
    }
    setWriteResult(null);
  };

  const stop = () => {
    abortRef.current?.abort();
    setStream((s) => (s && s.text ? { ...s, error: { code: 'STOPPED', message: 'Stopped.' } } : null));
  };

  const newThread = () => {
    abortRef.current?.abort();
    stopWatch();
    setStream(null);
    setMessages([]);
    setShots([]);
    setWriteResult(null);
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
        <span className="ov-gem" aria-hidden="true" />
        <span className="ov-brand">Prism</span>
        {cfg && (
          <span className={`ov-dot ${cfg.provider.ready ? 'ok' : cfg.provider.id === 'mock' ? 'mock' : 'bad'}`}
            title={cfg.provider.ready ? `provider: ${cfg.provider.id}` : (cfg.provider.reason ?? 'not configured')} />
        )}
        <span className="ov-hint no-drag">{kbd}</span>
        <div className="ov-actions no-drag">
          {ttsSupported() && (
            <button
              className={`ov-btn ${autoSpeak ? 'on' : ''}`}
              title={autoSpeak ? 'Voice answers ON — click to mute' : 'Voice answers OFF — click to hear answers'}
              onClick={() => setAutoSpeak((v) => { if (v) stopSpeaking(); return !v; })}
            >
              {autoSpeak ? '🔊' : '🔇'}
            </button>
          )}
          {messages.length > 0 && (
            <button className="ov-btn" title="New thread" onClick={newThread}>＋</button>
          )}
          {!android && (
            <button className={`ov-btn ${pinned ? 'on' : ''}`} title={pinned ? 'Unpin from top' : 'Keep on top'} onClick={togglePin}>📌</button>
          )}
          {desktop
            ? <button className="ov-btn" title="Open full app" onClick={() => desktop.openFullApp()}>⤢</button>
            : <a className="ov-btn" title="Open full app" href="/" target="_blank" rel="noreferrer">⤢</a>}
          {desktop && <button className="ov-btn" title="Hide (reopen with hotkey)" onClick={() => desktop.hide()}>✕</button>}
        </div>
      </header>

      {!providerReady && (
        <div className="ov-banner">
          Model not configured — set <code>FEATHERLESS_API_KEY</code> on the server.
        </div>
      )}
      {notice && <div className="ov-notice">{notice}</div>}

      {watch && (
        <div className="ov-watchbar">
          <span className="ov-watching-dot" aria-hidden="true" />
          <span className="ov-watchtext">Watching — <strong>{watch.count}</strong> saved when screen moves</span>
          <select
            className="ov-watch-sens"
            value={watch.sensitivity}
            title="Sensitivity (how much change counts as movement)"
            onChange={(e) => {
              const s = e.target.value;
              stopWatch();
              toggleWatch(s);
            }}
          >
            <option value="low">low</option>
            <option value="medium">med</option>
            <option value="high">high</option>
          </select>
          <button className="ov-btn" title="Stop watching" onClick={() => stopWatch()}>✕</button>
        </div>
      )}

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
          emptyHint={`Press ${kbd} anywhere to toggle me. Capture your screen — live or motion-triggered — and ask about it.`}
        />
      </div>

      {writeResult && (
        <div className="ov-actionbar">
          <span className="ov-actionbar-label">✍ Result</span>
          <button className="btn primary small" onClick={insertResult}>⤓ Insert into app</button>
          <button className="btn ghost small" onClick={async () => { await navigator.clipboard.writeText(writeResult).catch(() => {}); flash('Copied.'); }}>Copy</button>
          {ttsSupported() && <button className="btn ghost small" onClick={() => speak(writeResult).catch(() => {})}>Speak</button>}
          <button className="ov-btn" onClick={() => setWriteResult(null)} title="Dismiss">✕</button>
        </div>
      )}

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

      <footer className="ov-composer" onClick={() => (writeOpen && setWriteOpen(false), sizeMenu && setSizeMenu(false))}>
        <div className="ov-tools">
          {!android && (
            <button
              className={`ov-tool ${watch ? 'active rec' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleWatch(); }}
              title="Watch mode: sample the screen and keep a screenshot every time something visibly moves. Off = nothing is sampled."
            >
              ◉<span>{watch ? 'Watching' : 'Watch'}</span>
            </button>
          )}
          <button
            className={`ov-tool ${writeOpen ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setSizeMenu(false); setWriteOpen((v) => !v); }}
            title="Write mode: rewrite your text in a chosen style, then insert it into the app you were using."
          >
            ✍<span>Write</span>
          </button>
          <div className="ov-tools-right no-drag" onClick={(e) => e.stopPropagation()}>
            <button
              className="ov-size-label"
              title="Panel size — click for presets"
              onClick={() => { setWriteOpen(false); setSizeMenu((v) => !v); }}
            >
              {dims.w}×{dims.h}
            </button>
          </div>
        </div>

        {writeOpen && (
          <div className="ov-pop" onClick={(e) => e.stopPropagation()}>
            <div className="ov-pop-title">Rewrite as…</div>
            <div className="ov-write-grid">
              {WRITE_STYLES.map((s) => (
                <button key={s.id} className="ov-write-style" title={s.hint} onClick={() => runWrite(s)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {sizeMenu && (
          <div className="ov-pop right" onClick={(e) => e.stopPropagation()}>
            <div className="ov-pop-title">Panel size</div>
            {desktop?.setSize ? (
              <div className="ov-size-grid">
                {SIZE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className={`ov-size-preset ${Math.abs(dims.w - p.w) < 40 && Math.abs(dims.h - p.h) < 60 ? 'active' : ''}`}
                    onClick={() => applySize(p.w, p.h)}
                  >
                    <strong>{p.key}</strong>
                    <span>{p.w}×{p.h}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="ov-pop-note">Resizing needs the desktop app. In the browser, resize the window itself.</p>
            )}
            {desktop?.setSize && <p className="ov-pop-note">…or drag the corner grip at bottom-right ↘</p>}
          </div>
        )}

        <div className={`ov-capture-row ${android ? 'two' : ''}`}>
          <button className="ov-cap" disabled={Boolean(busy) || Boolean(stream)} onClick={captureScreen} title="Capture the whole screen">
            🖥<span>Screen</span>{busy === 'screen' && <span className="spinner" />}
          </button>
          {!android && (
            <button className="ov-cap" disabled={Boolean(busy) || Boolean(stream)} onClick={showWindowPicker} title="Capture one app window">
              🪟<span>Window</span>{busy === 'window' && <span className="spinner" />}
            </button>
          )}
          <button className="ov-cap" disabled={Boolean(busy) || Boolean(stream)} onClick={captureRegion} title="Drag-select a region">
            ✂️<span>Region</span>{busy === 'region' && <span className="spinner" />}
          </button>
        </div>
        <div className="ov-input-row">
          {voiceSupported() && (
            <button
              className={`ov-mic ${mic}`}
              onClick={toggleMic}
              disabled={Boolean(stream) || mic === 'transcribing'}
              title={mic === 'recording' ? 'Tap to stop & transcribe' : mic === 'transcribing' ? 'Transcribing…' : 'Tap to talk — Prism hears you'}
            >
              {mic === 'recording' ? '⏺' : mic === 'transcribing' ? '…' : '🎤'}
            </button>
          )}
          {mic === 'recording' && <span className="ov-rec">listening… tap ⏺ to stop</span>}
          <input
            className="ov-input"
            placeholder={shots.length ? 'Ask about the capture…' : 'Ask, or type text then ✍ Write…'}
            value={text}
            disabled={Boolean(stream)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !stream && send()}
            autoFocus
          />
          {stream
            ? <button className="ov-send stop" onClick={stop} title="Stop">■</button>
            : <button className="ov-send" onClick={send} disabled={!canSend} title="Send">➤</button>}
        </div>
        <div className="ov-statusline">
          <span>{cfg?.defaults?.chatModel ?? 'Prism'} · Featherless AI</span>
        </div>
        {desktop?.setSize && (
          <div className="ov-resize no-drag" onMouseDown={startDragResize} title="Drag to resize" aria-hidden="true" />
        )}
      </footer>
    </div>
  );
}
