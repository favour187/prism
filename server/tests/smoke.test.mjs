/**
 * End-to-end smoke test: boots the real server (mock AI provider) and walks
 * the full product surface over HTTP — conversations, streaming chat (SSE),
 * uploads + attachment context, screenshots, search, privacy, validation,
 * rate limiting, and error handling.
 *
 * Run: AI_PROVIDER=mock node server/tests/smoke.test.mjs  (or `npm test`)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-test-'));

let passed = 0;
let failed = 0;
function assert(cond, name, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.error(`  ✘ ${name} ${extra}`);
  }
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await delay(250);
  }
  throw new Error('server did not start');
}

/** Consume the SSE stream of POST /api/chat and collect typed events. */
async function chatStream(payload) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const events = { meta: [], deltas: [], notices: [], done: null, errors: [], status: res.status };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!raw.startsWith('event:')) continue;
      const [evLine, dataLine] = raw.split('\n');
      const ev = evLine.slice(6).trim();
      const data = JSON.parse(dataLine.slice(5).trimStart());
      if (ev === 'meta') events.meta.push(data);
      else if (ev === 'delta') events.deltas.push(data.delta);
      else if (ev === 'notice') events.notices.push(data.notice);
      else if (ev === 'done') events.done = data;
      else if (ev === 'error') events.errors.push(data);
    }
  }
  return events;
}

// tiny valid PNG (1×1) and a text file for uploads
const TINY_PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  console.log(`\nPrism smoke test — data dir: ${DATA_DIR}\n`);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, AI_PROVIDER: 'mock', PORT: String(PORT), DATA_DIR, NODE_ENV: 'test', RATE_LIMIT_CHAT_MAX: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => console.error('[server]', d.toString()));
  try {
    await waitForServer();

    // ---- health & config ----
    console.log('• health & config');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert(health.ok && health.provider === 'mock' && health.providerReady, 'GET /api/health reports mock provider ready');
    const cfg = await (await fetch(`${BASE}/api/config`)).json();
    assert(cfg.provider.id === 'mock', 'GET /api/config exposes provider id (not secrets)');
    assert(!JSON.stringify(cfg).includes('apiKey'), 'config response contains no API key material');
    assert(Array.isArray(cfg.tools) && cfg.tools.length === 4, 'config lists the 4 code actions');

    // ---- conversations CRUD ----
    console.log('• conversations CRUD');
    let res = await fetch(`${BASE}/api/conversations`, { method: 'POST', body: '{}' });
    const { conversation } = await res.json();
    assert(res.status === 201 && conversation.id, 'POST /api/conversations creates one');
    res = await fetch(`${BASE}/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'My refactor thread' }),
    });
    assert((await res.json()).conversation.title === 'My refactor thread', 'PATCH renames conversation');

    // ---- streaming chat (new conversation via chat endpoint) ----
    console.log('• streaming chat over SSE');
    const s1 = await chatStream({ content: 'Can you help me with this error in my node app?' });
    assert(s1.status === 200, 'chat endpoint responds 200 with SSE');
    assert(s1.deltas.length > 5, `streams many deltas (${s1.deltas.length})`);
    const fullText = s1.deltas.join('');
    assert(fullText.includes('```') && fullText.length > 200, 'streamed body contains markdown code');
    assert(s1.done && s1.done.conversationId, 'done event carries conversationId');
    assert(s1.meta.length >= 1 && s1.meta[0].provider === 'mock', 'meta event announces provider/model');
    const cid = s1.done.conversationId;

    // ---- history persistence + memory window ----
    console.log('• persistence & memory');
    const got = await (await fetch(`${BASE}/api/conversations/${cid}`)).json();
    assert(got.messages.length === 2, 'user + assistant messages persisted');
    assert(got.messages[1].role === 'assistant' && got.messages[1].content.length > 0, 'assistant reply stored');
    const s2 = await chatStream({ conversationId: cid, content: 'Now convert that to TypeScript please' });
    assert(s2.done && !s2.errors.length, 'follow-up turn in same conversation works (memory window used)');

    // ---- uploads: code file → attachment context ----
    console.log('• file upload + attachment context');
    const form = new FormData();
    form.append('files', new Blob(['export function add(a, b) {\n  return a + b;\n}\n'], { type: 'text/plain' }), 'math.js');
    const up = await (await fetch(`${BASE}/api/uploads`, { method: 'POST', body: form })).json();
    assert(up.attachments.length === 1 && !up.rejected.length, 'uploads a .js file');
    const att = up.attachments[0];
    assert(att.kind === 'file' && att.extractedChars > 40, 'text extracted from the code file');
    const s3 = await chatStream({ conversationId: cid, content: 'What does this function do?', attachmentIds: [att.id] });
    assert(s3.done && s3.deltas.join('').length > 50, 'chat with attachment context streams fine');

    // ---- uploads: rejection of secrets + unknown types ----
    console.log('• upload validation');
    const bad1 = new FormData();
    bad1.append('files', new Blob(['SECRET=1']), '.env');
    const badUp1 = await (await fetch(`${BASE}/api/uploads`, { method: 'POST', body: bad1 })).json();
    assert(badUp1.rejected?.length === 1 && badUp1.rejected[0].reason.includes('security'), '.env uploads are blocked for security');
    const bad2 = new FormData();
    bad2.append('files', new Blob([Buffer.alloc(32)]), 'payload.exe');
    const badUp2 = await (await fetch(`${BASE}/api/uploads`, { method: 'POST', body: bad2 })).json();
    assert(badUp2.rejected?.length === 1 && badUp2.rejected[0].reason.includes('unsupported'), 'executable uploads rejected');

    // ---- screenshot (vision path through mock provider) ----
    console.log('• screenshot / vision pipeline');
    const s4 = await chatStream({ conversationId: cid, content: 'What is on my screen?', screenshots: [TINY_PNG_DATAURL] });
    assert(!s4.errors.length && s4.done, 'screenshot turn completes');
    assert(s4.meta.some((m) => m.vision === 'vision'), 'vision route taken for screenshots');
    const badImg = await chatStream({ content: 'look', screenshots: ['data:text/plain;base64,aGVsbG8='] });
    assert(badImg.errors.some((e) => e.code === 'INVALID_IMAGE'), 'invalid screenshot payload rejected with INVALID_IMAGE');

    // ---- code actions (tool system) ----
    console.log('• Explain / Fix / Improve / Generate actions');
    const s5 = await chatStream({ conversationId: cid, action: 'fix', selection: 'const x = y + 1' });
    assert(s5.done && !s5.errors.length, 'Fix action with selected code completes');
    const s6 = await chatStream({ conversationId: cid, action: 'bogus' });
    assert(s6.errors.some((e) => e.code === 'UNKNOWN_ACTION'), 'unknown action rejected cleanly');

    // ---- search ----
    console.log('• conversation search');
    const search = await (await fetch(`${BASE}/api/conversations?query=${encodeURIComponent('TypeScript')}`)).json();
    assert(search.conversations.length >= 1, 'search finds conversations by message content');

    // ---- privacy export ----
    console.log('• privacy');
    const exported = await (await fetch(`${BASE}/api/privacy/export`)).json();
    assert(exported.conversations.length >= 1 && exported.conversations[0].messages.length >= 2, 'privacy export contains full history');

    // ---- empty message rejected ----
    const emptyTurn = await chatStream({ content: '' });
    assert(emptyTurn.errors.some((e) => e.code === 'EMPTY_MESSAGE'), 'empty messages rejected');

    // ---- rate limit headers present ----
    res = await fetch(`${BASE}/api/health`);
    assert(Boolean(res.headers.get('ratelimit-limit')), 'rate limiting is active (RateLimit-* headers present)');

    // ---- delete conversation ----
    res = await fetch(`${BASE}/api/conversations/${cid}`, { method: 'DELETE' });
    assert(res.status === 200, 'conversation deleted');
    const gone = await fetch(`${BASE}/api/conversations/${cid}`);
    assert(gone.status === 404, 'deleted conversation is 404');

    // ---- 404 for unknown API ----
    res = await fetch(`${BASE}/api/nope`);
    assert(res.status === 404, 'unknown API routes return structured 404');
  } finally {
    server.kill('SIGTERM');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(1);
});
