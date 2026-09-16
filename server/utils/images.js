import sharp from 'sharp';
import config from '../config.js';

/** Max dimension accepted by most VL models; keeps payloads small and fast. */
const MAX_EDGE = 1568;
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/;

export class ImageValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageValidationError';
    this.code = 'INVALID_IMAGE';
    this.status = 400;
  }
}

/** Normalize an image buffer for a vision model: cap dimensions, JPEG/PNG encoding. */
export async function normalizeImageBuffer(input) {
  const image = sharp(input, { failOn: 'error' });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new ImageValidationError('Unreadable image.');

  const needsResize = meta.width > MAX_EDGE || meta.height > MAX_EDGE;
  let pipeline = image.rotate(); // respect EXIF orientation
  if (needsResize) pipeline = pipeline.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside' });

  const hasAlpha = Boolean(meta.hasAlpha);
  const out = hasAlpha
    ? await pipeline.png({ compressionLevel: 8 }).toBuffer()
    : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();

  return {
    buffer: out,
    mime: hasAlpha ? 'image/png' : 'image/jpeg',
    width: meta.width,
    height: meta.height,
    resized: needsResize,
  };
}

export function toDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Validate and decode a client-supplied data URL into a buffer + mime. */
export function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length < 64) {
    throw new ImageValidationError('Malformed image payload.');
  }
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) throw new ImageValidationError('Only PNG/JPEG/WebP screenshots are supported.');
  const mime = match[1] === 'jpg' ? 'image/jpeg' : `image/${match[1]}`;
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  const maxBytes = config.maxInlineImageMb * 1024 * 1024;
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new ImageValidationError(`Screenshot must be between 1 KB and ${config.maxInlineImageMb} MB.`);
  }
  return { buffer, mime };
}

export { MAX_EDGE };
