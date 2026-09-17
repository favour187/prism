import { createWorker } from 'tesseract.js';

let workerPromise = null;
let queue = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
  }
  return workerPromise;
}

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

export async function closeOcr() {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    if (w) await w.terminate();
    workerPromise = null;
  }
}
