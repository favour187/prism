
export function voiceSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function ttsSupported() {
  return 'speechSynthesis' in window;
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export class VoiceRecorder {
  #recorder = null;
  #stream = null;
  #chunks = [];
  #mime = 'audio/webm';

  get recording() {
    return this.#recorder?.state === 'recording';
  }

  async start() {
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    this.#mime = mime || 'video/webm';
    this.#chunks = [];
    this.#recorder = new MediaRecorder(this.#stream, mime ? { mimeType: mime } : undefined);
    this.#recorder.ondataavailable = (e) => {
      if (e.data?.size) this.#chunks.push(e.data);
    };
    this.#recorder.start(250);
    return this;
  }

  stop() {
    return new Promise((resolve) => {
      const rec = this.#recorder;
      if (!rec) return resolve({ blob: null, mime: this.#mime });
      rec.onstop = () => {
        this.#cleanup();
        resolve({
          blob: this.#chunks.length ? new Blob(this.#chunks, { type: this.#mime }) : null,
          mime: this.#mime,
        });
      };
      try { rec.stop(); } catch { this.#cleanup(); resolve({ blob: null, mime: this.#mime }); }
    });
  }

  cancel() {
    this.#chunks = [];
    try { this.#recorder?.stop(); } catch {  }
    this.#cleanup();
  }

  #cleanup() {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
    this.#recorder = null;
  }
}

export async function transcribe(blob, mime) {
  const form = new FormData();
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('audio', blob, `voice.${ext}`);
  const res = await fetch('/api/transcribe', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `Transcription failed (${res.status})`);
    err.code = data?.error?.code ?? 'TRANSCRIBE_FAILED';
    throw err;
  }
  return (data.text ?? '').trim();
}


export function stripForSpeech(markdown) {
  let text = String(markdown ?? '');
  text = text.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_m, lang, body) => {
    const lines = body.trim().split('\n').length;
    return ` Code block${lang ? ` in ${lang}` : ''}, ${lines} ${lines === 1 ? 'line' : 'lines'} — shown on screen. `;
  });
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' (image) ');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/^\s*>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/\|/g, ' ');
  text = text.replace(/\s{2,}/g, ' ');
  return text.trim();
}

function splitForSpeech(text, max = 220) {
  const sentences = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [text];
  const chunks = [];
  let current = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if ((current + ' ' + s).trim().length > max && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current = `${current} ${s}`.trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Speak text aloud; resolves when finished. Long answers are chopped into
 * sentence chunks (utterances have length limits on several platforms).
 */
export function speak(markdown, { rate = 1.04, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!ttsSupported()) {
      onEnd?.();
      return resolve();
    }
    window.speechSynthesis.cancel();
    const chunks = splitForSpeech(stripForSpeech(markdown));
    if (!chunks.length) {
      onEnd?.();
      return resolve();
    }
    let i = 0;
    const next = () => {
      if (i >= chunks.length) {
        onEnd?.();
        return resolve();
      }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.rate = rate;
      u.onend = next;
      u.onerror = next;
      window.speechSynthesis.speak(u);
    };
    next();
  });
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

export function isSpeaking() {
  return ttsSupported() && window.speechSynthesis.speaking;
}
