import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 4000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.join(__dirname, 'data'),
  clientDist: process.env.CLIENT_DIST ?? path.join(__dirname, '..', 'client', 'dist'),

  aiProvider: (process.env.AI_PROVIDER ?? 'gemini').toLowerCase(),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    baseUrl: (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\\/$/, ''),
    chatModel: process.env.GEMINI_CHAT_MODEL ?? 'gemini-3.8-flash',
    visionModel: process.env.GEMINI_VISION_MODEL ?? 'gemini-3.8-flash',
    timeoutMs: num(process.env.GEMINI_TIMEOUT_MS, 120_000),
    maxTokens: num(process.env.GEMINI_MAX_TOKENS, 4096),
    temperature: Number.isFinite(Number(process.env.GEMINI_TEMPERATURE)) ? Number(process.env.GEMINI_TEMPERATURE) : 0.6,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? '',
    baseUrl: (process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    chatModel: process.env.GROQ_CHAT_MODEL ?? 'qwen/qwen3.8-27b',
    visionModel: process.env.GROQ_VISION_MODEL ?? 'qwen/qwen3.8-27b',
    sttModel: process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo',
    sttBaseUrl: (process.env.GROQ_STT_BASE_URL ?? '').replace(/\/$/, '') || null,
    timeoutMs: num(process.env.GROQ_TIMEOUT_MS, 120_000),
    maxTokens: num(process.env.GROQ_MAX_TOKENS, 4096),
    temperature: Number.isFinite(Number(process.env.GROQ_TEMPERATURE)) ? Number(process.env.GROQ_TEMPERATURE) : 0.6,
  },
  featherless: {
    apiKey: process.env.FEATHERLESS_API_KEY ?? '',
    baseUrl: (process.env.FEATHERLESS_BASE_URL ?? 'https://api.featherless.ai/v1').replace(/\/$/, ''),
    chatModel: process.env.FEATHERLESS_CHAT_MODEL ?? 'Qwen/Qwen2.5-Coder-32B-Instruct',
    visionModel: process.env.FEATHERLESS_VISION_MODEL ?? 'Qwen/Qwen2.5-VL-72B-Instruct',
    sttModel: process.env.FEATHERLESS_STT_MODEL ?? 'openai/whisper-large-v3',
    sttBaseUrl: (process.env.FEATHERLESS_STT_BASE_URL ?? '').replace(/\/$/, '') || null,
    timeoutMs: num(process.env.FEATHERLESS_TIMEOUT_MS, 120_000),
    maxTokens: num(process.env.FEATHERLESS_MAX_TOKENS, 4096),
    temperature: Number.isFinite(Number(process.env.FEATHERLESS_TEMPERATURE))
      ? Number(process.env.FEATHERLESS_TEMPERATURE)
      : 0.6,
  },

  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 12),
  maxUploadFiles: num(process.env.MAX_UPLOAD_FILES, 6),
  maxInlineImageMb: num(process.env.MAX_INLINE_IMAGE_MB, 9),
  maxAudioMb: num(process.env.MAX_AUDIO_MB, 15),
  historyMessages: num(process.env.HISTORY_MESSAGES, 24),
  maxContextFilesChars: num(process.env.MAX_CONTEXT_FILES_CHARS, 180_000),
  maxFileChars: num(process.env.MAX_FILE_CHARS, 40_000),
  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    apiMax: num(process.env.RATE_LIMIT_API_MAX, 600),
    chatMax: num(process.env.RATE_LIMIT_CHAT_MAX, 40),
    uploadMax: num(process.env.RATE_LIMIT_UPLOAD_MAX, 60),
  },

  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export default config;
