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

  // --- AI provider configuration (server-side only, never shipped to client) ---
  aiProvider: (process.env.AI_PROVIDER ?? 'featherless').toLowerCase(), // 'featherless' | 'mock'
  featherless: {
    apiKey: process.env.FEATHERLESS_API_KEY ?? '',
    baseUrl: (process.env.FEATHERLESS_BASE_URL ?? 'https://api.featherless.ai/v1').replace(/\/$/, ''),
    chatModel: process.env.FEATHERLESS_CHAT_MODEL ?? 'Qwen/Qwen2.5-Coder-32B-Instruct',
    visionModel: process.env.FEATHERLESS_VISION_MODEL ?? 'Qwen/Qwen2.5-VL-72B-Instruct',
    timeoutMs: num(process.env.FEATHERLESS_TIMEOUT_MS, 120_000),
    maxTokens: num(process.env.FEATHERLESS_MAX_TOKENS, 4096),
    temperature: Number.isFinite(Number(process.env.FEATHERLESS_TEMPERATURE))
      ? Number(process.env.FEATHERLESS_TEMPERATURE)
      : 0.6,
  },

  // --- Limits / safety ---
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 12),
  maxUploadFiles: num(process.env.MAX_UPLOAD_FILES, 6),
  maxInlineImageMb: num(process.env.MAX_INLINE_IMAGE_MB, 9),
  historyMessages: num(process.env.HISTORY_MESSAGES, 24),        // conversation memory window
  maxContextFilesChars: num(process.env.MAX_CONTEXT_FILES_CHARS, 180_000),
  maxFileChars: num(process.env.MAX_FILE_CHARS, 40_000),
  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    apiMax: num(process.env.RATE_LIMIT_API_MAX, 600),
    chatMax: num(process.env.RATE_LIMIT_CHAT_MAX, 40),
    uploadMax: num(process.env.RATE_LIMIT_UPLOAD_MAX, 60),
  },

  // Optional comma-separated extra CORS origins for a separately hosted frontend.
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export default config;
