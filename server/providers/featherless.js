import { AIProvider, ProviderError } from './base.js';

/**
 * Featherless AI provider.
 *
 * Featherless exposes an OpenAI-compatible API
 * (https://api.featherless.ai/v1/chat/completions), so we speak plain HTTP +
 * server-sent events with no vendor SDK. The API key lives ONLY here,
 * server-side.
 */
export class FeatherlessProvider extends AIProvider {
  id = 'featherless';

  constructor({ apiKey, baseUrl, timeoutMs, sttModel = null, sttBaseUrl = null }) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.sttModel = sttModel;
    this.sttBaseUrl = sttBaseUrl ?? baseUrl;
  }

  isReady() {
    return Boolean(this.apiKey);
  }

  notReadyReason() {
    return 'FEATHERLESS_API_KEY is not configured on the server.';
  }

  #assertReady() {
    if (!this.isReady()) {
      throw new ProviderError(this.notReadyReason(), 'PROVIDER_NOT_CONFIGURED', 503);
    }
  }

  #headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async #request(path, body, { stream = false, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Featherless request timed out')), this.timeoutMs);
    const onAbort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new ProviderError('Request aborted by client.', 'CLIENT_ABORTED', 499);
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (signal?.aborted) throw new ProviderError('Request aborted by client.', 'CLIENT_ABORTED', 499);
        throw new ProviderError('Featherless request timed out.', 'PROVIDER_TIMEOUT', 504);
      }
      throw new ProviderError(`Cannot reach Featherless: ${err.message}`, 'PROVIDER_UNREACHABLE', 502);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async #throwIfNotOk(res) {
    if (res.ok) return;
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error?.message ?? data?.message ?? JSON.stringify(data);
    } catch {
      detail = await res.text().catch(() => '');
    }
    const code =
      res.status === 401 || res.status === 403
        ? 'PROVIDER_AUTH_FAILED'
        : res.status === 404
          ? 'MODEL_NOT_FOUND'
          : res.status === 429
            ? 'PROVIDER_RATE_LIMITED'
            : res.status >= 500
              ? 'PROVIDER_UPSTREAM_ERROR'
              : 'PROVIDER_BAD_REQUEST';
    throw new ProviderError(
      `Featherless error (${res.status}): ${detail || res.statusText}`,
      code,
      res.status === 429 ? 429 : res.status === 404 ? 400 : 502,
    );
  }

  async *streamChat({ model, messages, temperature = 0.6, maxTokens = 2048, signal }) {
    this.#assertReady();
    const res = await this.#request(
      '/chat/completions',
      { model, messages, stream: true, temperature, max_tokens: maxTokens, stream_options: { include_usage: true } },
      { stream: true, signal },
    );
    await this.#throwIfNotOk(res);
    if (!res.body) throw new ProviderError('Featherless returned no stream body.', 'PROVIDER_UPSTREAM_ERROR', 502);

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
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // tolerate heartbeats/partials
          }
          const errPayload = json?.error;
          if (errPayload) {
            throw new ProviderError(
              `Featherless stream error: ${errPayload.message ?? 'unknown'}`,
              'PROVIDER_UPSTREAM_ERROR',
              502,
            );
          }
          const choice = json?.choices?.[0];
          const delta = choice?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield { delta };
          }
          if (json?.usage) {
            yield { usage: json.usage };
          }
          if (choice?.finish_reason === 'length') {
            yield { delta: '\n\n_(Response truncated — hit the token limit. Ask me to continue.)_' };
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  async complete({ model, messages, temperature = 0.3, maxTokens = 512, signal }) {
    this.#assertReady();
    const res = await this.#request('/chat/completions', { model, messages, temperature, max_tokens: maxTokens }, { signal });
    await this.#throwIfNotOk(res);
    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? '';
  }

  async listModels() {
    this.#assertReady();
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.#headers() });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json?.data) ? json.data.map((m) => m.id).filter(Boolean) : [];
  }

    supportsTranscription() {
    return Boolean(this.apiKey && this.sttModel);
  }

  /**
   * Speech-to-text via the OpenAI-compatible /audio/transcriptions endpoint.
   * Works with Featherless-hosted whisper-style models (or any compatible
   * endpoint when FEATHERLESS_STT_BASE_URL is set).
   */
  async transcribeAudio({ buffer, mime, filename }) {
    this.#assertReady();
    if (!this.sttModel) {
      throw new ProviderError('Speech-to-text is not configured (FEATHERLESS_STT_MODEL).', 'STT_NOT_CONFIGURED', 503);
    }
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), filename || 'audio.webm');
    form.append('model', this.sttModel);
    form.append('response_format', 'json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 90_000));
    let res;
    try {
      res = await fetch(`${this.sttBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      throw new ProviderError(
        err?.name === 'AbortError' ? 'Transcription timed out.' : `Cannot reach STT endpoint: ${err.message}`,
        err?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
        err?.name === 'AbortError' ? 504 : 502,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message ?? ''; } catch { detail = await res.text().catch(() => ''); }
      const code = res.status === 404 ? 'STT_MODEL_NOT_FOUND' : 'PROVIDER_UPSTREAM_ERROR';
      throw new ProviderError(
        `Speech-to-text failed (${res.status}): ${detail || res.statusText}. Check FEATHERLESS_STT_MODEL / endpoint.`,
        code,
        res.status === 429 ? 429 : 502,
      );
    }
    const json = await res.json();
    return (json?.text ?? '').trim();
  }
}
