import { Router } from 'express';
import { getProvider } from '../providers/index.js';
import config from '../config.js';
import { chatLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * Arc-style writing tools — single source of truth for styles & prompts.
 * Used by the overlay command bar (inline rewrite) and the desktop
 * global "rewrite selection" bar (⌘/Ctrl+Shift+R).
 */
export const WRITE_STYLES = [
  { id: 'fix', label: 'Fix grammar', hint: 'corrects spelling & grammar, keeps your voice' },
  { id: 'improve', label: 'Improve', hint: 'same meaning, sharper writing' },
  { id: 'concise', label: 'Concise', hint: 'say it in fewer words' },
  { id: 'professional', label: 'Professional', hint: 'formal, work-appropriate' },
  { id: 'friendly', label: 'Friendly', hint: 'warmer, more casual' },
  { id: 'expand', label: 'Expand', hint: 'more detail & structure' },
  { id: 'to_en', label: '→ English', hint: 'translate to English' },
  { id: 'to_fr', label: '→ French', hint: 'traduire en français' },
];

const PROMPTS = {
  fix: 'Fix the grammar and spelling of the following text. Return ONLY the corrected text — no commentary, no quotes, preserve the author\'s voice.',
  improve: 'Improve the following writing: clearer, sharper, roughly the same meaning and length. Return ONLY the improved text — no commentary.',
  concise: 'Make the following text significantly more concise without losing meaning. Return ONLY the rewritten text — no commentary.',
  professional: 'Rewrite the following text in a professional, work-appropriate tone. Return ONLY the rewritten text — no commentary.',
  friendly: 'Rewrite the following text in a warmer, friendlier, more casual tone. Return ONLY the rewritten text — no commentary.',
  expand: 'Expand the following text with more detail and structure. Return ONLY the rewritten text — no commentary.',
  to_en: 'Translate the following text to natural English. Return ONLY the translation — no commentary.',
  to_fr: 'Translate the following text to natural French. Return ONLY the translation — no commentary.',
};

const MAX_TEXT_CHARS = 20_000;
const MAX_INSTRUCTION_CHARS = 500;

/** GET /api/write/styles — what the bar renders. */
router.get('/styles', (_req, res) => {
  res.json({ styles: WRITE_STYLES.map(({ id, label, hint }) => ({ id, label, hint })) });
});

/**
 * POST /api/write
 * Body: { text: string, style?: 'fix'|'improve'|..., instruction?: string }
 *  — style applies a preset transform; instruction is a free-form directive
 *    ("turn this into a polite rejection email"). Exactly one is required.
 * → 200 { result, style, model, provider }
 */
router.post('/', chatLimiter, async (req, res, next) => {
  try {
    const { text = '', style = null, instruction = null } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Provide "text" to rewrite.' } });
    }
    if (text.length > MAX_TEXT_CHARS) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Text too long (max ${MAX_TEXT_CHARS} chars).` } });
    }

    let prompt;
    let usedStyle = style;
    if (instruction != null) {
      if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > MAX_INSTRUCTION_CHARS) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `instruction must be a string of at most ${MAX_INSTRUCTION_CHARS} chars.` } });
      }
      prompt = `${instruction.trim()}\nRules: transform the text below accordingly. Return ONLY the resulting text — no commentary.`;
      usedStyle = 'custom';
    } else if (typeof style === 'string' && PROMPTS[style]) {
      prompt = PROMPTS[style];
    } else {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: `Provide "style" (${Object.keys(PROMPTS).join(', ')}) or a free-form "instruction".` },
      });
    }

    const provider = getProvider();
    const messages = [
      { role: 'system', content: 'You are a precise writing tool. You return only the transformed text.' },
      { role: 'user', content: `${prompt}\n\n---\n${text.slice(0, MAX_TEXT_CHARS)}` },
    ];

    let result = '';
    for await (const chunk of provider.streamChat({
      model: provider.id === 'mock' ? 'mock/chat-demo' : config.featherless.chatModel,
      messages,
      temperature: 0.3,
      maxTokens: Math.min(config.featherless.maxTokens, 2048),
      signal: AbortSignal.timeout(60_000),
    })) {
      if (chunk.delta) result += chunk.delta;
    }

    const trimmed = result.trim();
    if (!trimmed) {
      return res.status(502).json({ error: { code: 'EMPTY_RESULT', message: 'The model returned an empty rewrite — try again.' } });
    }
    res.json({
      result: trimmed,
      style: usedStyle,
      model: provider.id === 'mock' ? 'mock/chat-demo' : config.featherless.chatModel,
      provider: provider.id,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
