import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';
import store from '../memory/store.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import {
  validateUpload,
  extractText,
  kindOfExt,
  mimeOfExt,
  sniffImageMime,
  IMAGE_EXTS,
  FileValidationError,
} from '../utils/fileProcessor.js';
import { normalizeImageBuffer } from '../utils/images.js';

const uploadsDir = path.join(config.dataDir, 'uploads');

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.bin`),
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: config.maxUploadFiles },
});

const router = Router();

router.post('/', uploadLimiter, (req, res, next) => {
  upload.array('files', config.maxUploadFiles)(req, res, async (multerErr) => {
    if (multerErr) {
      const message =
        multerErr.code === 'LIMIT_FILE_SIZE'
          ? `A file exceeded the ${config.maxUploadMb} MB limit.`
          : multerErr.code === 'LIMIT_FILE_COUNT'
            ? `At most ${config.maxUploadFiles} files per upload.`
            : multerErr.message;
      return res.status(400).json({ error: { code: 'UPLOAD_FAILED', message } });
    }

    const files = req.files ?? [];
    if (!files.length) {
      return res.status(400).json({ error: { code: 'UPLOAD_FAILED', message: 'No files received.' } });
    }

    const results = [];
    const rejected = [];
    for (const f of files) {
      const safeName = path.basename(f.originalname).slice(0, 160) || 'file';
      try {
        const ext = validateUpload({ originalname: safeName, size: f.size });
        const kind = kindOfExt(ext);

        if (kind === 'image') {
          const sniffed = await sniffImageMime(f.path);
          if (!sniffed) throw new FileValidationError(`"${safeName}" is not a valid image file.`);
          const norm = await normalizeImageBuffer(f.path);
          const { writeFile } = await import('node:fs/promises');
          await writeFile(f.path, norm.buffer);
          results.push(
            store.getAttachment(
              store.addAttachment({
                name: safeName,
                mime: norm.mime,
                kind,
                size: norm.buffer.length,
                filePath: f.path,
                extractedText: null,
              }),
            ),
          );
        } else {
          const { text, truncated } = await extractText(f.path, ext);
          results.push(
            store.getAttachment(
              store.addAttachment({
                name: safeName,
                mime: mimeOfExt(ext),
                kind,
                size: f.size,
                filePath: f.path,
                extractedText: text,
                truncated,
              }),
            ),
          );
        }
      } catch (err) {
        const { rm } = await import('node:fs/promises');
        await rm(f.path, { force: true }).catch(() => {});
        rejected.push({ name: safeName, reason: err.message });
      }
    }

    store.deleteOrphanAttachments();
    res.status(rejected.length && !results.length ? 400 : 200).json({
      attachments: results.map(store.publicAttachment).filter(Boolean),
      rejected,
    });
  });
});

router.get('/:id/raw', (req, res, next) => {
  try {
    const a = store.getAttachment(req.params.id);
    if (!a) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found.' } });
    if (!IMAGE_EXTS.has(path.extname(a.name).replace('.', '').toLowerCase()) && a.kind !== 'image') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Only images can be previewed inline.' } });
    }
    res.setHeader('Content-Type', a.mime.startsWith('image/') ? a.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(a.path);
  } catch (err) {
    next(err);
  }
});

export default router;
