import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamChat } from './api.js';
import { grabFrame, isAndroid, androidCapture, ScreenWatcher } from './capture.js';
import { VoiceRecorder, transcribe, speak, stopSpeaking, voiceSupported, ttsSupported } from './voice.js';
import { SCREEN_ASK_PROMPT } from './prompts.js';
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

const WATCH_NARRATION_PROMPT =
  'Watch narration: in ONE short sentence, describe what visibly changed on the screen. ' +
  'Be concrete — name the app, dialog, or content that changed. No preamble.';

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
  const [watch, setWatch] = useState(null);
  const [narrate, setNarrate] = useState(() => localStorage.getItem('prism.watchNarrate') !== '0');
  const [styles, setStyles] = useState(FALLBACK_STYLES);
  const [styleBusy, setStyleBusy] = useState(null);
  const [writeState, setWriteState] = useState(null);
  const [sizeMenu, setSizeMenu] = useState(false);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [palIndex, setPalIndex] = useState(0);

  const abortRef = useRef(null);
  const noticeTimer = useRef(null);
  const recorderRef = useRef(null);
  const streamTextRef = useRef('');
  const watcherRef = useRef(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);
  const textRef = useRef(text);
  textRef.current = text;
  const narrateRef = useRef(narrate);
  narrateRef.current = narrate;

  const [conversationId, setConversationId] = useState(
    () => localStorage.getItem('prism.overlayConversationId') ?? null,
  );

  const flash = useCallback((msg, ms = 3600) => {
    clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(() => {
    api.getConfig().then(setCfg).catch(() => {});
    api.listWriteStyles().then((d) => d.styles?.length && setStyles(d.styles)).catch(() => {});
    if (conversationId) {
      api.getConversation(conversationId)
        .then((d) => setMessages(d.messages))
        .catch(() => {
          localStorage.removeItem('prism.overlayConversationId');
          setConversationId(null);
        });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('prism.watchNarrate', narrate ? '1' : '0');
  }, [narrate]);

  useEffect(() => {
    localStorage.setItem('prism.autospeak', autoSpeak ? '1' : '0');
  }, [autoSpeak]);

  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  const stopWatch = useCallback(() => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setWatch(null);
  }, []);


  const sendContent = useCallback((content, { auto = false, screenshots = null, userPreview = null } = {}) => {
    if (streamRef.current) return;
    stopSpeaking();
    if (!auto) stopWatch();
    streamTextRef.current = '';
    const payloadShots = screenshots ?? shots.map((s) => s.dataUrl);

    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}${auto ? `-a${shotSeq}` : ''}`,
        role: 'user',
        content: [
          userPreview ?? content,
          ...payloadShots.map((d, i) => `![capture ${i + 1}](${d})`),
        ].filter(Boolean).join('\n\n') || 'Screenshot',
        createdAt: Date.now(),
        meta: auto ? { watch: true } : {},
        attachments: [],
      },
    ]);
    setStream({ text: '', meta: null, error: null });
    if (!auto) {
      setText('');
      setShots([]);
      setWriteState(null);
    }

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
          if (done?.conversationId) {
            try {
              const data = await api.getConversation(done.conversationId);
              setMessages(data.messages);
            } catch {  }
          }
          if (autoSpeak && finalText && ttsSupported()) {
            speak(finalText).catch(() => {});
          }
        },
      },
    );
  }, [shots, conversationId, flash, autoSpeak, stopWatch]);

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
          if (narrateRef.current && !streamRef.current) {
            sendContent(WATCH_NARRATION_PROMPT, {
              auto: true,
              screenshots: [dataUrl],
              userPreview: `🎥 Screen changed — shot #${n}`,
            });
          }
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
  }, [stopWatch, addShot, flash, sendContent, watch?.sensitivity, watch?.count]);

  useEffect(() => () => watcherRef.current?.stop(), []);

  const captureScreen = useCallback(async () => {
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
  }, [addShot, flash]);

  const showWindowPicker = useCallback(async () => {
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
  }, [addShot, flash]);

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

  const captureRegion = useCallback(async () => {
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
  }, [addShot, flash]);


  const captureAndAsk = useCallback(async () => {
    setBusy('answer');
    try {
      const dataUrl = android
        ? await androidCapture('screen')
        : desktop
          ? await desktop.captureScreen()
          : (await grabFrame()).dataUrl;
      if (!dataUrl) {
        flash('Capture cancelled.');
        return;
      }
      sendContent(SCREEN_ASK_PROMPT, {
        screenshots: [dataUrl],
        userPreview: `📸 Screen captured — answer from it`,
      });
    } catch (err) {
      flash(err?.name === 'NotAllowedError' ? 'Capture cancelled.' : `Capture failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }, [sendContent, flash]);

  const toggleMic = useCallback(async () => {
    if (mic === 'recording') {
      setMic('transcribing');
      const { blob, mime } = (await recorderRef.current?.stop()) ?? {};
      recorderRef.current = null;
      try {
        if (!blob) throw new Error('Nothing was recorded.');
        const transcript = await transcribe(blob, mime);
        if (transcript) {
          setText(transcript);
          sendContent(transcript);
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
  }, [mic, flash, sendContent]);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    stopWatch();
    setStream(null);
    setMessages([]);
    setShots([]);
    setWriteState(null);
    setConversationId(null);
    localStorage.removeItem('prism.overlayConversationId');
  }, [stopWatch]);

  const quickAsk = useCallback((selectionText) => {
    const t = String(selectionText ?? '').trim();
    if (!t) return;
    sendContent(`Answer or explain this — be concise and useful:\n\n${t.slice(0, 6000)}`);
  }, [sendContent]);

  const toggleWatchRef = useRef(toggleWatch);
  toggleWatchRef.current = toggleWatch;
  const quickAskRef = useRef(quickAsk);
  quickAskRef.current = quickAsk;

  useEffect(() => {
    if (!desktop) return undefined;
    const un1 = desktop.onToggleWatch?.(() => toggleWatchRef.current());
    const un2 = desktop.onQuickAsk?.((t) => quickAskRef.current(t));
    const un3 = desktop.onFocusBar?.(() => {
      inputRef.current?.focus();
      if (textRef.current?.startsWith('/')) setText('');
    });
    return () => { un1?.(); un2?.(); un3?.(); };
  }, []);

  const paletteOpen = text.startsWith('/');
  const commands = useMemo(() => {
    const list = [
      { id: 'answer', icon: '⚡', label: 'Answer from my screen', hint: 'reads the screen and answers instantly, no questions', run: captureAndAsk },
      ...(!android ? [{
        id: 'watch', icon: '◉', label: watch ? 'Stop watching' : 'Watch screen',
        hint: 'screenshot only when something moves', run: () => toggleWatch(),
      }] : []),
      ...(!android ? [{
        id: 'narrate', icon: '✨', label: `Narration ${narrate ? 'off' : 'on'}`,
        hint: 'AI describes each change as it happens', run: () => setNarrate((v) => !v),
      }] : []),
      { id: 'screen', icon: '🖥', label: 'Screenshot', hint: 'capture the full screen', run: captureScreen },
      ...(!android ? [{ id: 'window', icon: '🪟', label: 'Window', hint: 'capture one app window', run: showWindowPicker }] : []),
      { id: 'region', icon: '✂️', label: 'Region', hint: 'drag-select a part of the screen', run: captureRegion },
      ...(voiceSupported() ? [{ id: 'voice', icon: '🎤', label: 'Voice', hint: 'speak — transcribes and asks the AI immediately', run: toggleMic }] : []),
      ...(ttsSupported() ? [{
        id: 'speak', icon: autoSpeak ? '🔇' : '🔊', label: `Spoken answers ${autoSpeak ? 'off' : 'on'}`,
        hint: 'read replies aloud', run: () => setAutoSpeak((v) => !v),
      }] : []),
      ...(messages.length ? [{ id: 'new', icon: '＋', label: 'New thread', hint: 'clear and start over', run: newThread }] : []),
    ];
    const q = text.slice(1).trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.id.includes(q) || c.label.toLowerCase().includes(q));
  }, [text, watch, narrate, autoSpeak, messages.length, captureAndAsk, toggleWatch, captureScreen, showWindowPicker, captureRegion, toggleMic, newThread]);

  useEffect(() => {
    setPalIndex(0);
  }, [text]);

  const writeChipsOpen = Boolean(text.trim()) && !paletteOpen && !stream;
  const transformed = writeState && text !== writeState.original;

  const runInlineWrite = useCallback(async (style) => {
    const source = text.trim();
    if (!source || styleBusy) return;
    setStyleBusy(style.id);
    try {
      const d = await api.write(source, style.id);
      setWriteState((prev) => (prev ? prev : { original: text }));
      setText(d.result);
      setSizeMenu(false);
    } catch (err) {
      flash(err.message ?? 'Rewrite failed.');
    } finally {
      setStyleBusy(null);
    }
  }, [text, styleBusy, flash]);

  const insertTransformed = useCallback(async () => {
    const payload = text.trim();
    if (!payload) return;
    if (desktop?.writeText) {
      const res = await desktop.writeText(payload).catch(() => ({ copied: false, pasted: false }));
      flash(res.pasted ? 'Inserted into your app ✓' : 'Copied to clipboard — paste with Ctrl/⌘+V.');
    } else {
      await navigator.clipboard.writeText(payload).catch(() => {});
      flash('Copied — paste anywhere with Ctrl/⌘+V.');
    }
    setText('');
    setWriteState(null);
  }, [text, flash]);

  const canSend = !stream && (text.trim() || shots.length > 0);

  const send = useCallback(() => {
    if (!canSend || paletteOpen) return;
    sendContent(text.trim());
  }, [canSend, paletteOpen, text, sendContent]);

  const stop = () => {
    abortRef.current?.abort();
    setStream((s) => (s && s.text ? { ...s, error: { code: 'STOPPED', message: 'Stopped.' } } : null));
  };

  const togglePin = async () => {
    const next = desktop ? await desktop.setPin(!pinned) : !pinned;
    setPinned(next);
  };

  const onInputKeyDown = (e) => {
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
    if (e.key === 'Enter' && !stream) {
      send();
    } else if (e.key === 'Escape' && transformed) {
      setText(writeState.original);
      setWriteState(null);
    }
  };

  const providerReady = cfg?.provider?.ready ?? true;
  const kbd = useMemo(() => (navigator.platform?.includes('Mac') ? '⌘⇧A' : 'Ctrl+Shift+A'), []);

  return (
    <div className="overlay-app">
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
          <span className="ov-watchtext">Watching — <strong>{watch.count}</strong> kept</span>
          <button
            className={`ov-watch-narrate ${narrate ? 'on' : ''}`}
            title="AI narrates each detected change in the thread"
            onClick={() => setNarrate((v) => !v)}
          >✨ narrate</button>
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
          onSpeak={ttsSupported()}
          emptyHint={android
            ? `⚡ Tap “Answer” to capture your screen and get a reply in seconds — or just type below.`
            : `One bar for everything: ⚡ Answer reads your screen and replies instantly · talk to ask · / for commands. ${kbd} toggles me anywhere.`}
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

      <footer className="ov-composer" onClick={() => sizeMenu && setSizeMenu(false)}>
        {}
        {paletteOpen && (
          <div className="ov-palette" role="listbox" aria-label="Commands">
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

        {}
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

        {}
        {writeChipsOpen && (
          <div className="ov-chips" onClick={(e) => e.stopPropagation()}>
            {styles.map((s) => (
              <button
                key={s.id}
                className={`ov-chip ${styleBusy === s.id ? 'busy' : ''}`}
                title={s.hint ?? ''}
                disabled={Boolean(styleBusy)}
                onClick={() => runInlineWrite(s)}
              >
                {s.label}
                {styleBusy === s.id && <span className="spinner" />}
              </button>
            ))}
          </div>
        )}

        {}
        {transformed && !paletteOpen && (
          <div className="ov-bar-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn primary small" onClick={insertTransformed}>⤓ Insert into app</button>
            <button
              className="btn ghost small"
              onClick={() => { setText(writeState.original); setWriteState(null); }}
              title="Restore what you typed (Esc)"
            >↺ Original</button>
            <button
              className="btn ghost small"
              onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); flash('Copied.'); }}
            >Copy</button>
          </div>
        )}

        {}
        <div className={`ov-capture-row ${android ? 'two' : ''}`}>
          <button className="ov-cap ov-cap-answer" disabled={Boolean(busy) || Boolean(stream)} onClick={captureAndAsk} title="Capture your screen and get an instant answer">
            ⚡<span>Answer</span>{busy === 'answer' && <span className="spinner" />}
          </button>
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

        {}
        <div className="ov-input-row">
          {voiceSupported() && (
            <button
              className={`ov-mic ${mic}`}
              onClick={toggleMic}
              disabled={Boolean(stream) || mic === 'transcribing'}
              title={mic === 'recording' ? 'Tap to stop — Prism transcribes and answers' : mic === 'transcribing' ? 'Transcribing…' : 'Tap to talk — Prism hears you and answers'}
            >
              {mic === 'recording' ? '⏺' : mic === 'transcribing' ? '…' : '🎤'}
            </button>
          )}
          {mic === 'recording' && <span className="ov-rec">listening… tap ⏺ to stop & answer</span>}
          <input
            ref={inputRef}
            className="ov-input"
            placeholder={shots.length ? 'Ask about the capture… ( / for commands )' : 'Ask anything · ⚡ Answer captures your screen · type text to rewrite it'}
            value={text}
            disabled={Boolean(stream)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onInputKeyDown}
            autoFocus
            spellCheck="false"
          />
          {stream
            ? <button className="ov-send stop" onClick={stop} title="Stop">■</button>
            : <button className="ov-send" onClick={send} disabled={!canSend || paletteOpen} title="Send">➤</button>}
        </div>

        {}
        <div className="ov-slim no-drag" onClick={(e) => e.stopPropagation()}>
          {!android && (
            <button
              className={`ov-slim-watch ${watch ? 'on' : ''}`}
              title="Watch: sample the screen, keep a screenshot when it moves. Only while toggled on."
              onClick={() => toggleWatch()}
            >
              ◉ {watch ? `watching · ${watch.count}` : 'watch'}
            </button>
          )}
          <button
            className="ov-size-label"
            title="Panel size — click for presets"
            onClick={() => setSizeMenu((v) => !v)}
          >
            {dims.w}×{dims.h}
          </button>
          <span className="ov-slim-model">{cfg?.defaults?.chatModel ?? 'Prism'} · Featherless</span>
        </div>

        {desktop?.setSize && (
          <div className="ov-resize no-drag" onMouseDown={startDragResize} title="Drag to resize" aria-hidden="true" />
        )}
      </footer>
    </div>
  );
}
