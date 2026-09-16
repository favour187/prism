/** Thin API client. All AI traffic goes through our backend — no keys here. */

async function jsonFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `Request failed (${res.status})`);
    err.code = data?.error?.code ?? 'REQUEST_FAILED';
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  getConfig: () => jsonFetch('/api/config'),

  listConversations: (query = '') =>
    jsonFetch(`/api/conversations${query ? `?query=${encodeURIComponent(query)}` : ''}`),

  getConversation: (id) => jsonFetch(`/api/conversations/${id}`),

  createConversation: () =>
    jsonFetch('/api/conversations', { method: 'POST', body: '{}' }),

  renameConversation: (id, title) =>
    jsonFetch(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),

  deleteConversation: (id) => jsonFetch(`/api/conversations/${id}`, { method: 'DELETE' }),

  uploadFiles: async (files) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await fetch('/api/uploads', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data?.rejected) {
      const err = new Error(data?.error?.message ?? `Upload failed (${res.status})`);
      err.code = data?.error?.code ?? 'UPLOAD_FAILED';
      throw err;
    }
    return data;
  },

  imagePreviewUrl: (attachmentId) => `/api/uploads/${attachmentId}/raw`,

  exportData: () => {
    window.location.assign('/api/privacy/export');
  },

  wipeData: () => jsonFetch('/api/privacy/data', { method: 'DELETE' }),
};

/**
 * Stream a chat turn over SSE. Handlers receive typed events:
 *   onMeta(meta) onDelta(deltaText) onNotice(text) onError({code,message}) onDone(done)
 * Returns an AbortController so the UI can cancel.
 */
export function streamChat(payload, handlers = {}) {
  const controller = new AbortController();

  (async () => {
    let res;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        handlers.onError?.({ code: 'NETWORK_ERROR', message: 'Could not reach the server.' });
      }
      return;
    }

    if (!res.ok) {
      let message = `Server error (${res.status})`;
      let code = 'SERVER_ERROR';
      try {
        const data = await res.json();
        if (data?.error?.message) message = data.error.message;
        if (data?.error?.code) code = data.error.code;
      } catch { /* keep defaults */ }
      handlers.onError?.({ code, message });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const dispatch = (rawEvent) => {
      const lines = rawEvent.split('\n');
      let event = 'message';
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) return;
      let data;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        return;
      }
      const { type, ...rest } = data;
      const t = type ?? event;
      if (t === 'meta') handlers.onMeta?.(rest);
      else if (t === 'delta') handlers.onDelta?.(rest.delta ?? '');
      else if (t === 'notice') handlers.onNotice?.(rest.notice ?? '');
      else if (t === 'done') handlers.onDone?.(rest);
      else if (t === 'error') handlers.onError?.(rest);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (rawEvent.trim() && !rawEvent.startsWith(':')) dispatch(rawEvent);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        handlers.onError?.({ code: 'STREAM_ERROR', message: 'The response stream was interrupted.' });
      }
    }
  })();

  return controller;
}
