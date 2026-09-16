/**
 * Provider interface. Every AI backend (Featherless, mock, future providers)
 * implements this contract so the orchestrator never talks to a vendor SDK.
 *
 * Messages use the OpenAI schema:
 *   { role: 'system' | 'user' | 'assistant', content: string | ContentPart[] }
 * where ContentPart = { type: 'text', text } | { type: 'image_url', image_url: { url } }
 */
export class AIProvider {
  /** Stable provider id, e.g. 'featherless'. */
  id = 'base';

  /** Whether the provider has everything it needs to serve traffic. */
  isReady() {
    return true;
  }

  /** Human readable reason when not ready. */
  notReadyReason() {
    return '';
  }

  /**
   * Stream a chat completion. Must async-yield `{ delta }` chunks and may end
   * with a `{ usage }` chunk.
   * @param {{ model: string, messages: any[], temperature?: number, maxTokens?: number, signal?: AbortSignal }} opts
   */
  // eslint-disable-next-line no-unused-vars
  async *streamChat(opts) {
    throw new Error('streamChat not implemented');
  }

  /**
   * Non-streaming completion, returns the full text.
   * @param {{ model: string, messages: any[], temperature?: number, maxTokens?: number, signal?: AbortSignal }} opts
   */
  // eslint-disable-next-line no-unused-vars
  async complete(opts) {
    throw new Error('complete not implemented');
  }

  /** List available model ids (best-effort). */
  async listModels() {
    return [];
  }
}

export class ProviderError extends Error {
  constructor(message, code = 'PROVIDER_ERROR', status = 502, details = undefined) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
