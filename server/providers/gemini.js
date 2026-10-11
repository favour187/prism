import { AIProvider, ProviderError } from './base.js';

export class GeminiProvider extends AIProvider {
  id = 'gemini';

  constructor({ apiKey, baseUrl, timeoutMs }) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  isReady() {
    return Boolean(this.apiKey);
  }

  notReadyReason() {
    return 'Neither GEMINI_API_KEY nor GROQ_API_KEY is configured on the server.';
  }

  #assertReady() {
    if (!this.isReady()) throw new ProviderError('GEMINI_API_KEY is not configured on the server.', 'PROVIDER_NOT_CONFIGURED', 503);
  }

  #headers() {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  async #request(path, body, { stream = false, signal } = {}) {
    this.#assertReady();
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(body),
        signal: requestSignal,
      });
    } catch (err) {
      if (signal?.aborted) {
        throw new ProviderError('Request aborted by client.', 'CLIENT_ABORTED', 499);
      }
      if (timeoutSignal.aborted || err?.name === 'TimeoutError') {
        throw new ProviderError('Gemini request timed out.', 'PROVIDER_TIMEOUT', 504);
      }
      throw new ProviderError(`Cannot reach Gemini: ${err.message}`, 'PROVIDER_UNREACHABLE', 502);
    }
  }

  async #throwIfNotOk(res) {
    if (res.ok) return;
    const raw = await res.text().catch(() => '');
    let detail = raw;
    try {
      const data = JSON.parse(raw);
      detail = data?.error?.message ?? data?.message ?? raw;
    } catch { /* Keep the raw response text for non-JSON errors. */ }
    const code = res.status === 401 || res.status === 403 ? 'PROVIDER_AUTH_FAILED'
      : res.status === 404 ? 'MODEL_NOT_FOUND'
      : res.status === 429 ? 'PROVIDER_RATE_LIMITED'
      : res.status >= 500 ? 'PROVIDER_UPSTREAM_ERROR' : 'PROVIDER_BAD_REQUEST';
    throw new ProviderError(`Gemini error (${res.status}): ${detail || res.statusText}`, code,
      res.status === 429 ? 429 : res.status === 404 ? 400 : 502);
  }

  async *streamChat({ model, messages, temperature = 0.6, maxTokens = 2048, signal }) {
    const res = await this.#request('/chat/completions', {
      model, messages, stream: true, temperature, max_tokens: maxTokens,
    }, signal);
    await this.#throwIfNotOk(res);
    if (!res.body) throw new ProviderError('Gemini returned no stream body.', 'PROVIDER_UPSTREAM_ERROR', 502);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          if (json?.error) {
            throw new ProviderError(`Gemini stream error: ${json.error.message ?? 'unknown'}`,
              'PROVIDER_UPSTREAM_ERROR', 502);
          }
          const choice = json?.choices?.[0];
          const delta = choice?.delta?.content;
          if (typeof delta === 'string' && delta) yield { delta };
          if (json?.usage) yield { usage: json.usage };
          if (choice?.finish_reason === 'length') {
            yield { delta: '\n\n_(Response truncated — hit the token limit. Ask me to continue.)_' };
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        throw new ProviderError('Request aborted by client.', 'CLIENT_ABORTED', 499);
      }
      throw err;
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  async complete({ model, messages, temperature = 0.3, maxTokens = 512, signal }) {
    const res = await this.#request('/chat/completions', {
      model, messages, temperature, max_tokens: maxTokens,
    }, signal);
    await this.#throwIfNotOk(res);
    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? '';
  }

  async listModels() {
    this.#assertReady();
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.#headers(), signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json?.data) ? json.data.map((m) => m.id).filter(Boolean) : [];
  }
}
