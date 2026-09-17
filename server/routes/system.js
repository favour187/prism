import { Router } from 'express';
import config from '../config.js';
import store from '../memory/store.js';
import { getProvider } from '../providers/index.js';
import { listTools } from '../tools/codeActions.js';

const router = Router();

let modelsCache = { at: 0, models: [] };
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

async function cachedModels(provider) {
  if (provider.id === 'mock' || !provider.isReady()) return [];
  if (Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS) return modelsCache.models;
  const models = await provider.listModels().catch(() => []);
  modelsCache = { at: Date.now(), models };
  return models;
}

router.get('/health', (_req, res) => {
  const provider = getProvider();
  res.json({
    ok: true,
    provider: provider.id,
    providerReady: provider.isReady(),
    uptime: Math.round(process.uptime()),
  });
});

router.get('/config', async (_req, res, next) => {
  try {
    const provider = getProvider();
    let models = await cachedModels(provider);
    res.json({
      app: { name: 'Prism', version: '1.0.0' },
      provider: { id: provider.id, ready: provider.isReady(), reason: provider.isReady() ? null : provider.notReadyReason() },
      defaults: {
        chatModel: config.featherless.chatModel,
        visionModel: config.featherless.visionModel,
      },
      models,
      tools: listTools(),
      limits: {
        maxUploadMb: config.maxUploadMb,
        maxUploadFiles: config.maxUploadFiles,
        maxScreenshots: 4,
        maxAudioMb: config.maxAudioMb,
      },
      voice: {
        stt: provider.supportsTranscription(),
        tts: 'client',
      },
      privacy: {
        screenRecording: 'opt-in-per-capture',
        keyLocation: 'server-only',
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/privacy/export', (_req, res, next) => {
  try {
    const data = store.exportAll();
    res.setHeader('Content-Disposition', `attachment; filename="prism-export-${Date.now()}.json"`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/privacy/data', (_req, res, next) => {
  try {
    store.wipeAll();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
