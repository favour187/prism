import { AIProvider } from './base.js';

export class MockProvider extends AIProvider {
  id = 'mock';

  isReady() {
    return true;
  }

  #replyFor(lastUserText, hasImages) {
    const lower = (lastUserText ?? '').toLowerCase();
    const intro = hasImages
      ? 'I received your image/screenshot. In this mock mode I cannot really "see" it, but the vision routing pipeline delivered it correctly.'
      : 'Mock provider is active (AI_PROVIDER=mock). Set FEATHERLESS_API_KEY and AI_PROVIDER=featherless for real models.';

    if (lower.includes('fix') || lower.includes('error') || lower.includes('bug')) {
      return `${intro}

I looked at the context you provided. Here is a representative fix pattern this app produces with a real model:

\`\`\`js
// Before: throws when "list" is undefined
export function sum(list) {
  return (list ?? []).reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0);
}
\`\`\`

**What was wrong**
- \`list.reduce\` throws a \`TypeError\` when \`list\` is \`undefined\`/\`null\`.
- Non-numeric entries polluted the total with \`NaN\`.

**The fix** — default to \`[]\` and guard with \`Number.isFinite\`, preserving your original formatting. Only the broken lines changed.`;
    }

    return `${intro}

This is a **streaming** response, delivered token-by-token over SSE exactly like Featherless would:

\`\`\`ts
// language auto-detection + syntax highlighting + copy button demo
async function* streamText(text: string, chunk = 4) {
  for (let i = 0; i < text.length; i += chunk) {
    yield text.slice(i, i + chunk);
    await new Promise((r) => setTimeout(r, 10));
  }
}
\`\`\`

1. Markdown renders (headers, lists, *emphasis*, tables).
2. Code blocks have a language badge, one-click copy, and Explain / Fix / Improve actions.
3. Conversation history persists in SQLite — reload and it's still here.

\`\`\`python
def quick_check():
    return {"ok": True, "provider": "mock"}
\`\`\`

Now send a real message, attach a file, or capture your screen with \`Ctrl/⌘+Shift+A\`.`;
  }

  async *streamChat({ messages }) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = typeof lastUser?.content === 'string'
      ? lastUser.content
      : (lastUser?.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    const hasImages = Array.isArray(lastUser?.content) && lastUser.content.some((p) => p.type === 'image_url');

    const reply = this.#replyFor(text, hasImages);
    const tokens = reply.match(/\S+\s*/g) ?? [reply];
    for (const t of tokens) {
      yield { delta: t };
      await new Promise((r) => setTimeout(r, 12));
    }
    yield { usage: { prompt_tokens: 0, completion_tokens: tokens.length, total_tokens: tokens.length } };
  }

  async complete() {
    return 'Mock conversation title';
  }

  async listModels() {
    return ['mock/chat-demo', 'mock/vision-demo'];
  }

  supportsTranscription() {
    return true;
  }

  async transcribeAudio({ buffer }) {
    if (!buffer || buffer.length < 10) {
      throw new Error('Empty audio payload.');
    }
    return 'This is a mock transcription (AI_PROVIDER=mock) — speech-to-text flows through the real pipeline here.';
  }
}
