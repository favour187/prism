import { Router } from 'express';
import { runChatTurn } from '../orchestrator.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import store from '../memory/store.js';

const router = Router();

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

  streamTurn(
    res,
    (signal) => runChatTurn({ conversationId, content, attachmentIds, screenshots, action, selection, model, signal }),
  );
});

router.post('/regenerate', chatLimiter, async (req, res) => {
  const { conversationId = null, model = null } = req.body ?? {};
  if (typeof conversationId !== 'string' || !conversationId) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'conversationId is required to regenerate.' },
    });
  }
  const convo = store.getConversation(conversationId);
  if (!convo) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
  }

  const last = store.getLastMessage(conversationId, 'user');
  if (!last) {
    return res.status(400).json({
      error: { code: 'NOTHING_TO_REGENERATE', message: 'No question to regenerate in this conversation yet.' },
    });
  }
  store.deleteLastAssistantMessage(conversationId);

  streamTurn(
    res,
    (signal) => runChatTurn({ conversationId, content: '', model: model || null, skip_persist: true, signal }),
  );
});

function streamTurn(res, turnFactory) {
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
  res.on('close', () => {
    if (!abort.signal.aborted) abort.abort(new Error('client disconnected'));
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': hb\n\n');
  }, 15000);

  const run = async () => {
    try {
      for await (const event of turnFactory(abort.signal)) {
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
  };
  run();
}

export default router;
