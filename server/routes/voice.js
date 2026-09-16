import { Router } from 'express';
import multer from 'multer';
import config from '../config.js';
import { getProvider } from '../providers/index.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const AUDIO_MIMES = new Set([
  'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/mpeg',
  'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'video/webm', // Safari/Chrome variants
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxAudioMb * 1024 * 1024, files: 1 },
});

const router = Router();

/**
 * POST /api/transcribe — multipart 'audio' (≤ MAX_AUDIO_MB).
 * The microphone audio goes straight to the configured STT endpoint
 * (server-side key); the raw audio is never stored on disk.
 */
router.post('/', chatLimiter, (req, res, next) => {
  upload.single('audio')(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Audio exceeds the ${config.maxAudioMb} MB limit.`
        : err.message;
      return res.status(400).json({ error: { code: 'UPLOAD_FAILED', message } });
    }
    try {
      const file = req.file;
      if (!file || file.size < 10) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No audio received.' } });
      }
      const mime = (file.mimetype ?? '').toLowerCase().trim();
      if (![...AUDIO_MIMES].some((m) => mime.startsWith(m.split(';')[0]))) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Unsupported audio type: ${mime}` } });
      }

      const provider = getProvider();
      if (!provider.supportsTranscription()) {
        return res.status(503).json({
          error: {
            code: provider.id === 'featherless' ? 'PROVIDER_NOT_CONFIGURED' : 'TRANSCRIPTION_UNSUPPORTED',
            message:
              provider.id === 'featherless'
                ? 'Set FEATHERLESS_API_KEY (and FEATHERLESS_STT_MODEL) to enable voice input.'
                : 'This AI provider does not offer speech-to-text.',
          },
        });
      }

      const text = await provider.transcribeAudio({
        buffer: file.buffer,
        mime,
        filename: file.originalname || 'audio.webm',
      });
      res.json({ text });
    } catch (e) {
      next(e);
    }
  });
});

export default router;
