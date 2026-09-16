import { createWorker } from 'tesseract.js';

/**
 * OCR fallback pipeline (tesseract.js). Used when a vision model is
 * unavailable or fails, so screenshots of terminals/UIs/errors still yield
 * analyzable text. The worker is created lazily and reused.
 */
let workerPromise = null;
let queue = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_pageseg_mode: '6', // assume a uniform block of text — good for terminals/code
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
  }
  return workerPromise;
}

/**
 * Run OCR on an image buffer. Concurrent calls are serialized because a
 * Tesseract worker handles one job at a time.
 */
export async function ocrImage(buffer) {
  const run = queue.then(async () => {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    return {
      text: (data?.text ?? '').trim(),
      confidence: typeof data?.confidence === 'number' ? Math.round(data.confidence) : null,
    };
  });
  queue = run.catch(() => {});
  return run;
}

/** For graceful shutdown / tests. */
export async function closeOcr() {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    if (w) await w.terminate();
    workerPromise = null;
  }
}
