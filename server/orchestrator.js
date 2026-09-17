import fs from 'node:fs/promises';
import config from './config.js';
import store from './memory/store.js';
import { getProvider } from './providers/index.js';
import { renderTool } from './tools/codeActions.js';
import { decodeDataUrl, normalizeImageBuffer, toDataUrl, ImageValidationError } from './utils/images.js';
import { ocrImage } from './utils/ocr.js';
import { extOf, languageOfExt } from './utils/fileProcessor.js';
import { ProviderError } from './providers/base.js';

const SYSTEM_PROMPT = `You are Prism, an expert AI pair-programmer and general assistant inside a developer-focused chat app.

Engineering behavior:
- You are exceptional at software engineering: debugging, code generation, refactoring, architecture, APIs, Git, shells/terminals, IDEs, web, mobile, databases, and DevOps.
- Detect the programming language automatically and label every code block with it.
- When fixing code, explain the root cause first, then give the COMPLETE corrected code; preserve the user's formatting, naming, and indentation; never rewrite unrelated working code.
- When improving code, keep behavior identical unless the change fixes a bug, and list what changed and why.
- When asked to compare implementations, present trade-offs (complexity, readability, perf) and a recommendation.
- Answer in Markdown. Use fenced code blocks with language tags. Be concise by default, thorough when the problem demands it.
- If the user attaches project files, treat them as authoritative codebase context and reference them by filename.
- If a screenshot or OCR text is provided, analyze the visible errors, code, UI, terminal output, or documentation precisely.
- Ask a clarifying question only when the request is genuinely ambiguous; otherwise state assumptions and proceed.`;

const SCREENSHOT_NOTE =
  'The user captured their screen and attached the image. Analyze exactly what is visible: errors, stack traces, code, UI state, terminal output — and respond helpfully.';

const OCR_NOTE =
  'Vision model was unavailable, so the screenshot was processed with OCR. The extracted text follows. Rely on it, mention any likely OCR garbling, and answer accordingly.';

export class OrchestratorError extends Error {
  constructor(message, code = 'ORCHESTRATION_ERROR', status = 400) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.status = status;
  }
}

function buildFileContextBlock(attachments) {
  const files = attachments.filter((a) => a.kind === 'file' && a.extracted_text);
  if (!files.length) return null;

  let budget = config.maxContextFilesChars;
  const parts = [
    'The user attached the following project files. Treat them as authoritative codebase context:',
    '',
  ];
  for (const f of files) {
    if (budget <= 0) break;
    const lang = languageOfExt(extOf(f.name));
    let text = f.extracted_text;
    let note = f.truncated ? ' (server-truncated)' : '';
    if (text.length > budget) {
      text = text.slice(0, budget);
      note = ' (truncated to fit context)';
    }
    budget -= text.length;
    parts.push(`### File: ${f.name}${note}`, '', '```' + lang, text, '```', '');
  }
  return parts.join('\n');
}

export async function* runChatTurn({
  conversationId = null,
  content: rawContent = '',
  attachmentIds = [],
  screenshots = [],
  action = null,
  selection = '',
  model = null,
  signal,
  skip_persist = false,
}) {
  const provider = getProvider();

  const content = String(rawContent ?? '').slice(0, 64_000).trim();
  const hasAnything = Boolean(content) || screenshots.length > 0 || attachmentIds.length > 0 || Boolean(action) || skip_persist;
  if (!hasAnything) {
    throw new OrchestratorError('Message is empty.', 'EMPTY_MESSAGE', 400);
  }
  if (screenshots.length > 4) throw new OrchestratorError('At most 4 screenshots per message.', 'TOO_MANY_IMAGES', 400);
  if (!provider.isReady()) {
    throw new ProviderError(provider.notReadyReason(), 'PROVIDER_NOT_CONFIGURED', 503);
  }

  let cid = conversationId;
  if (cid) {
    if (!store.getConversation(cid)) throw new OrchestratorError('Conversation not found.', 'NOT_FOUND', 404);
  } else {
    cid = store.createConversation({ title: 'New conversation' }).id;
  }

  const attachments = store.getAttachments(attachmentIds);
  if (attachments.length !== attachmentIds.length) {
    throw new OrchestratorError('One or more attachments were not found (upload again).', 'ATTACHMENT_NOT_FOUND', 404);
  }
  const fileContext = buildFileContextBlock(attachments);

  const images = [];
  for (const a of attachments.filter((x) => x.kind === 'image')) {
    const buf = await fs.readFile(a.path).catch(() => null);
    if (!buf) continue;
    const norm = await normalizeImageBuffer(buf);
    images.push({ dataUrl: toDataUrl(norm.buffer, norm.mime), origin: 'upload', name: a.name });
  }
  for (const [i, dataUrlRaw] of screenshots.entries()) {
    const { buffer } = decodeDataUrl(dataUrlRaw);
    const norm = await normalizeImageBuffer(buffer);
    images.push({ dataUrl: toDataUrl(norm.buffer, norm.mime), origin: 'capture', name: `screenshot-${i + 1}` });
  }
  const capturedShot = images.find((im) => im.origin === 'capture');

  let toolPrompt = null;
  if (action) {
    toolPrompt = renderTool(action, selection);
    if (!toolPrompt) throw new OrchestratorError(`Unknown action "${action}".`, 'UNKNOWN_ACTION', 400);
  }

  const textParts = [];
  if (toolPrompt) textParts.push(toolPrompt);
  if (content) textParts.push(content);
  if (capturedShot) textParts.push(SCREENSHOT_NOTE);
  if (fileContext) textParts.push(fileContext);
  const userText = textParts.join('\n\n').trim();

  const history = store.getRecentHistory(cid, config.historyMessages);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];
  const userTurn =
    images.length > 0
      ? {
          role: 'user',
          content: [
            { type: 'text', text: userText || 'Please analyze the attached image(s).' },
            ...images.map((im) => ({ type: 'image_url', image_url: { url: im.dataUrl } })),
          ],
        }
      : { role: 'user', content: userText };
  if (!skip_persist) messages.push(userTurn);

  const displayContent =
    [content || (action ? `${toolsLabel(action)}${selection ? ' selected code' : ''}` : ''),
      screenshots.length ? `📷 ${screenshots.length} screenshot(s) captured` : '',
      attachments.length ? `📎 ${attachments.map((a) => a.name).join(', ')}` : '']
      .filter(Boolean)
      .join('\n\n') || userText.slice(0, 2000);
  let userMessageId = null;
  if (!skip_persist) {
    userMessageId = store.addMessage({
      conversationId: cid,
      role: 'user',
      content: displayContent,
      attachments: attachmentIds,
      meta: { action: action ?? null, hasScreenshots: screenshots.length > 0 },
    });
    store.attachToConversation(cid, attachmentIds);
  }

  const chatModel = model || config.featherless.chatModel;
  const visionModel = config.featherless.visionModel;
  const wantsVision = images.length > 0;

  let usedModel = wantsVision ? visionModel : chatModel;
  let visionMode = wantsVision ? 'vision' : 'none';

  yield {
    type: 'meta',
    conversationId: cid,
    userMessageId,
    model: provider.id === 'mock' ? 'mock/chat-demo' : usedModel,
    provider: provider.id,
    vision: visionMode,
  };

  let full = '';
  let usage = null;

  const runStream = async function* (msgs, mdl) {
    for await (const chunk of provider.streamChat({
      model: provider.id === 'mock' ? (wantsVision ? 'mock/vision-demo' : 'mock/chat-demo') : mdl,
      messages: msgs,
      temperature: config.featherless.temperature,
      maxTokens: config.featherless.maxTokens,
      signal,
    })) {
      if (chunk.delta) {
        full += chunk.delta;
        yield { type: 'delta', delta: chunk.delta };
      }
      if (chunk.usage) usage = chunk.usage;
    }
  };

  try {
    yield* runStream(messages, usedModel);
  } catch (err) {
    const canOcrFallback =
      wantsVision && !(err?.code === 'CLIENT_ABORTED') && images.some((im) => im.origin === 'capture' || im.origin === 'upload');
    if (!canOcrFallback) throw err;

    yield { type: 'notice', notice: 'Vision model unavailable — falling back to OCR on the screenshot.' };
    visionMode = 'ocr';
    usedModel = chatModel;
    full = '';
    try {
      const ocrResults = [];
      for (const im of images) {
        const buf = Buffer.from(im.dataUrl.split(',')[1], 'base64');
        const { text, confidence } = await ocrImage(buf);
        if (text) ocrResults.push({ name: im.name, text, confidence });
      }
      const ocrBlock = ocrResults
        .map((r) => `--- OCR text from ${r.name}${r.confidence != null ? ` (confidence ${r.confidence}%)` : ''} ---\n${r.text}`)
        .join('\n\n');
      const ocrMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.slice(1, -1),
        {
          role: 'user',
          content: [OCR_NOTE, ocrBlock || '(OCR produced no text)', toolPrompt ?? '', content].filter(Boolean).join('\n\n'),
        },
      ];
      yield { type: 'meta', vision: 'ocr', model: provider.id === 'mock' ? 'mock/chat-demo' : usedModel };
      yield* runStream(ocrMessages, chatModel);
    } catch (ocrErr) {
      if (ocrErr?.code === 'CLIENT_ABORTED') throw ocrErr;
      throw new OrchestratorError(
        `Vision failed (${err.message}) and OCR fallback failed (${ocrErr.message}).`,
        'IMAGE_PIPELINE_FAILED',
        502,
      );
    }
  }

  const assistantMessageId = store.addMessage({
    conversationId: cid,
    role: 'assistant',
    content: full,
    meta: { model: usedModel, provider: provider.id, vision: visionMode, usage },
  });

  const convo = store.getConversation(cid);
  let title = convo?.title;
  if (!skip_persist && convo && convo.title === 'New conversation') {
    title = await autoTitle(provider, chatModel, userText, signal).catch(() => null);
    if (!title) title = titleFromText(content || userText);
    store.renameConversation(cid, title);
  }

  yield { type: 'done', conversationId: cid, assistantMessageId, title, usage, model: usedModel, vision: visionMode };

  function toolsLabel(a) {
    return { explain: 'Explain', fix: 'Fix', improve: 'Improve', generate: 'Generate' }[a] ?? a;
  }
}

async function autoTitle(provider, model, userText, signal) {
  if (provider.id === 'mock') return titleFromText(userText);
  const raw = await provider.complete({
    model,
    temperature: 0.2,
    maxTokens: 24,
    signal,
    messages: [
      {
        role: 'user',
        content:
          'Write a 3-6 word conversation title (no quotes, no trailing punctuation) for this user message:\n\n' +
          userText.slice(0, 800),
      },
    ],
  });
  const title = raw.trim().replace(/^["']|["'.]$/g, '').split('\n')[0].slice(0, 80);
  return title || null;
}

function titleFromText(text) {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New conversation';
  return clean.length <= 48 ? clean : `${clean.slice(0, 47)}…`;
}

export { ImageValidationError };
