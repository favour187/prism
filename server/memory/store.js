import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });

const db = new Database(path.join(config.dataDir, 'prism.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New conversation',
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',   -- JSON array of attachment ids
  meta TEXT NOT NULL DEFAULT '{}',          -- JSON: model, usage, vision mode, action
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file','image')),
  size INTEGER NOT NULL,
  path TEXT NOT NULL,                        -- on-disk location (server only)
  extracted_text TEXT,                       -- text pulled from code/doc files
  truncated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

const id = () => crypto.randomUUID();
const now = () => Date.now();

export const store = {
  // ------------------------------ conversations ------------------------------
  createConversation({ title = 'New conversation', model = null } = {}) {
    const cid = id();
    db.prepare(
      'INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(cid, title, model, now(), now());
    return this.getConversation(cid);
  },

  getConversation(cid) {
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(cid) ?? null;
  },

  listConversations({ query = '', limit = 200 } = {}) {
    const q = query.trim();
    if (!q) {
      return db
        .prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?')
        .all(limit);
    }
    const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\'
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(like, like, limit);
  },

  renameConversation(cid, title) {
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), cid);
    return this.getConversation(cid);
  },

  touchConversation(cid) {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), cid);
  },

  deleteConversation(cid) {
    const rows = db.prepare("SELECT path FROM attachments WHERE conversation_id = ? AND path != ''").all(cid);
    db.prepare('DELETE FROM attachments WHERE conversation_id = ?').run(cid);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(cid);
    for (const r of rows) {
      const stillUsed = db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE path = ?').get(r.path);
      if (!stillUsed?.n) fs.rm(r.path, { force: true }, () => {});
    }
  },

  // --------------------------------- messages ---------------------------------
  addMessage({ conversationId, role, content, attachments = [], meta = {} }) {
    const mid = id();
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, attachments, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(mid, conversationId, role, content, JSON.stringify(attachments), JSON.stringify(meta), now());
    this.touchConversation(conversationId);
    return mid;
  },

  getMessages(conversationId, { limit = 500 } = {}) {
    return db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?')
      .all(conversationId, limit)
      .map((m) => ({ ...m, attachments: safeJson(m.attachments, []), meta: safeJson(m.meta, {}) }));
  },

  getRecentHistory(conversationId, limit) {
    const rows = db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? AND role IN ('user','assistant')
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse();
    return rows.map((m) => ({ role: m.role, content: m.content }));
  },

  // -------------------------------- attachments -------------------------------
  addAttachment({ conversationId = null, name, mime, kind, size, filePath, extractedText = null, truncated = 0 }) {
    const aid = id();
    db.prepare(
      'INSERT INTO attachments (id, conversation_id, name, mime, kind, size, path, extracted_text, truncated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(aid, conversationId, name, mime, kind, size, filePath, extractedText, truncated ? 1 : 0, now());
    return aid;
  },

  getAttachment(aid) {
    const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(aid);
    return a ?? null;
  },

  getAttachments(ids) {
    if (!ids?.length) return [];
    const marks = ids.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM attachments WHERE id IN (${marks})`).all(...ids);
  },

  publicAttachment(a) {
    if (!a) return null;
    return {
      id: a.id,
      name: a.name,
      mime: a.mime,
      kind: a.kind,
      size: a.size,
      truncated: Boolean(a.truncated),
      textPreview: a.extracted_text ? a.extracted_text.slice(0, 400) : null,
      extractedChars: a.extracted_text?.length ?? 0,
      createdAt: a.created_at,
    };
  },

  attachToConversation(cid, ids) {
    if (!ids?.length) return;
    const stmt = db.prepare('UPDATE attachments SET conversation_id = ? WHERE id = ?');
    for (const aid of ids) stmt.run(cid, aid);
  },

  deleteOrphanAttachments() {
    const rows = db.prepare('SELECT id, path FROM attachments WHERE conversation_id IS NULL').all();
    const cutoff = now() - 24 * 60 * 60 * 1000;
    for (const r of rows) {
      db.prepare('DELETE FROM attachments WHERE id = ? AND created_at < ?').run(r.id, cutoff);
    }
  },

  // ---------------------------------- privacy ---------------------------------
  exportAll() {
    const conversations = this.listConversations({ limit: 10000 });
    return {
      exportedAt: new Date().toISOString(),
      conversations: conversations.map((c) => ({
        ...c,
        messages: this.getMessages(c.id, { limit: 100000 }).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          attachments: m.attachments,
          meta: m.meta,
          created_at: m.created_at,
        })),
      })),
    };
  },

  wipeAll() {
    const paths = db.prepare("SELECT path FROM attachments WHERE path != ''").all();
    db.exec('DELETE FROM messages; DELETE FROM attachments; DELETE FROM conversations;');
    for (const p of paths) fs.rm(p.path, { force: true }, () => {});
  },
};

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export default store;
