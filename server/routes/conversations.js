import { Router } from 'express';
import store from '../memory/store.js';

const router = Router();

/** GET /api/conversations?query= — list + full-text-ish search over titles & messages. */
router.get('/', (req, res, next) => {
  try {
    const items = store.listConversations({ query: String(req.query.query ?? ''), limit: 300 });
    res.json({ conversations: items.map(publicConversation) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/conversations — create empty conversation. */
router.post('/', (req, res, next) => {
  try {
    const convo = store.createConversation({ title: 'New conversation' });
    res.status(201).json({ conversation: publicConversation(convo) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/conversations/:id — conversation + full message history. */
router.get('/:id', (req, res, next) => {
  try {
    const convo = store.getConversation(req.params.id);
    if (!convo) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    }
    const messages = store.getMessages(convo.id, { limit: 1000 }).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      meta: m.meta,
      attachments: store.getAttachments(m.attachments).map(store.publicAttachment).filter(Boolean),
    }));
    res.json({ conversation: publicConversation(convo), messages });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/conversations/:id — rename. */
router.patch('/:id', (req, res, next) => {
  try {
    const title = String(req.body?.title ?? '').trim().slice(0, 120);
    if (!title) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'title is required.' } });
    }
    const convo = store.renameConversation(req.params.id, title);
    if (!convo) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    }
    res.json({ conversation: publicConversation(convo) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/conversations/:id */
router.delete('/:id', (req, res, next) => {
  try {
    if (!store.getConversation(req.params.id)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } });
    }
    store.deleteConversation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function publicConversation(c) {
  return {
    id: c.id,
    title: c.title,
    model: c.model,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

export default router;
