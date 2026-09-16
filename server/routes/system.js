import { Router } from 'express';
import config from '../config.js';
import store from '../memory/store.js';
import { getProvider } from '../providers/index.js';
import { listTools } from '../tools/codeActions.js';

const router = Router();

/** Liveness + readiness for health checks (Render, uptime monitors). */
router.get('/health', (_req, res) => {
  const provider = getProvider();
  res.json({
    ok: true,
    provider: provider.id,
    providerReady: provider.isReady(),
    uptime: Math.round(process.uptime()),
  });
});

/**
 * Public client config — strictly non-secret. The Featherless key never
 * leaves the server; the client only learns if the provider is configured.
 */
router.get('/config', async (_req, res, next) => {
  try {
    const provider = getProvider();
    let models = [];
    if (provider.isReady() && provider.id !== 'mock') {
      models = await provider.listModels().catch(() => []);
    }
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

/** GET /api/privacy/export — everything stored about the user, as JSON. */
router.get('/privacy/export', (_req, res, next) => {
  try {
    const data = store.exportAll();
    res.setHeader('Content-Disposition', `attachment; filename="prism-export-${Date.now()}.json"`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/privacy/data — irreversibly wipe conversations + uploads. */
router.delete('/privacy/data', (_req, res, next) => {
  try {
    store.wipeAll();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
