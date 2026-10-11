import config from '../config.js';
import { FeatherlessProvider } from './featherless.js';
import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
import { MockProvider } from './mock.js';

let cached = null;

class GeminiWithGroqFallback {
  get id() {
    return this.primary.isReady() ? 'gemini' : 'groq';
  }

  constructor(primary, backup) {
    this.primary = primary;
    this.backup = backup;
  }

  isReady() {
    return this.primary.isReady() || this.backup.isReady();
  }

  notReadyReason() {
    return 'Set GEMINI_API_KEY for primary Gemini, and GROQ_API_KEY for Groq backup and Whisper transcription.';
  }

  supportsTranscription() {
    return this.backup.supportsTranscription();
  }

  async transcribeAudio(audio) {
    if (!this.backup.supportsTranscription()) {
      throw new Error('Whisper transcription requires GROQ_API_KEY and GROQ_STT_MODEL.');
    }
    return this.backup.transcribeAudio(audio);
  }

  async listModels() {
    if (this.primary.isReady()) {
      const models = await this.primary.listModels().catch(() => []);
      if (models.length) return models;
    }
    return this.backup.listModels();
  }

  async *streamChat(opts) {
    const imageRequest = opts.messages.some((m) =>
      Array.isArray(m.content) && m.content.some((part) => part?.type === 'image_url'));
    if (this.primary.isReady()) {
      let emittedText = false;
      try {
        for await (const chunk of this.primary.streamChat({
          ...opts,
          model: opts.model || config.gemini.chatModel,
        })) {
          if (chunk.delta) emittedText = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (emittedText || err?.code === 'CLIENT_ABORTED') throw err;
        // Fall through to Groq when Gemini is unavailable, rate-limited, or rejects the request.
      }
    }
    if (!this.backup.isReady()) {
      throw new Error('Gemini failed and Groq backup is not configured. Set GEMINI_API_KEY and GROQ_API_KEY.');
    }
    const fallbackModel = imageRequest ? config.groq.visionModel : config.groq.chatModel;
    yield {
      notice: 'Gemini is unavailable for this request; switching to the Groq backup.',
      meta: { provider: 'groq', model: fallbackModel, vision: imageRequest ? 'vision' : 'none' },
    };
    yield* this.backup.streamChat({
      ...opts,
      model: fallbackModel,
    });
  }

  async complete(opts) {
    if (this.primary.isReady()) {
      try {
        return await this.primary.complete({ ...opts, model: opts.model || config.gemini.chatModel });
      } catch (err) {
        if (err?.code === 'CLIENT_ABORTED') throw err;
      }
    }
    if (!this.backup.isReady()) throw new Error('Gemini failed and Groq backup is not configured.');
    return this.backup.complete({ ...opts, model: config.groq.chatModel });
  }
}

export function getProvider() {
  if (cached) return cached;
  if (config.aiProvider === 'mock') {
    cached = new MockProvider();
  } else if (config.aiProvider === 'featherless') {
    cached = new FeatherlessProvider({
      apiKey: config.featherless.apiKey,
      baseUrl: config.featherless.baseUrl,
      timeoutMs: config.featherless.timeoutMs,
      sttModel: config.featherless.sttModel,
      sttBaseUrl: config.featherless.sttBaseUrl,
    });
  } else if (config.aiProvider === 'groq') {
    cached = new GroqProvider({
      apiKey: config.groq.apiKey,
      baseUrl: config.groq.baseUrl,
      timeoutMs: config.groq.timeoutMs,
      sttModel: config.groq.sttModel,
      sttBaseUrl: config.groq.sttBaseUrl,
    });
  } else {
    const primary = new GeminiProvider({
      apiKey: config.gemini.apiKey,
      baseUrl: config.gemini.baseUrl,
      timeoutMs: config.gemini.timeoutMs,
    });
    const backup = new GroqProvider({
      apiKey: config.groq.apiKey,
      baseUrl: config.groq.baseUrl,
      timeoutMs: config.groq.timeoutMs,
      sttModel: config.groq.sttModel,
      sttBaseUrl: config.groq.sttBaseUrl,
    });
    cached = new GeminiWithGroqFallback(primary, backup);
  }
  return cached;
}

export function resetProvider() {
  cached = null;
}
