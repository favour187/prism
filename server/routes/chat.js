import { Router } from 'express';
import { runChatTurn } from '../orchestrator.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * POST /api/chat — streaming chat turn.
 *
 * Body: {
 *   conversationId?: string,
 *   content?: string,
 *   attachmentIds?: string[],
 *   screenshots?: string[] (data URLs),
 *   action?: 'explain'|'fix'|'improve'|'generate',
 *   selection?: string,
 *   model?: string
 * }
 * Response: text/event-stream with events meta | delta | notice | done | error.
 */
router.post('/', chatLimiter, async (req, res) => {
  const {
    conversationId = null,
    content = '',
    attachmentIds = [],
    screenshots = [],
    action = null,
    selection = '',
    model = null,
  } = req.body ?? {};

  if (!Array.isArray(attachmentIds) || attachmentIds.some((x) => typeof x !== 'string')) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'attachmentIds must be an array of strings.' } });
  }
  if (!Array.isArray(screenshots) || screenshots.some((x) => typeof x !== 'string')) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'screenshots must be an array of data URLs.' } });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (type, payload) => {
    if (res.writableEnded) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  const abort = new AbortController();
  req.on('close', () => {
    if (!abort.signal.aborted) abort.abort(new Error('client disconnected'));
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': hb\n\n');
  }, 15000);

  try {
    for await (const event of runChatTurn({
      conversationId,
      content,
      attachmentIds,
      screenshots,
      action,
      selection,
      model,
      signal: abort.signal,
    })) {
      const { type, ...payload } = event;
      send(type, payload);
    }
  } catch (err) {
    if (err?.code !== 'CLIENT_ABORTED') {
      const status = Number.isInteger(err?.status) ? err.status : 500;
      send('error', {
        code: err?.code ?? 'INTERNAL_ERROR',
        status,
        message: err?.message ?? 'Unknown error.',
      });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export default router;
