import config from '../config.js';
import { FeatherlessProvider } from './featherless.js';
import { MockProvider } from './mock.js';

let cached = null;

export function getProvider() {
  if (cached) return cached;
  if (config.aiProvider === 'mock') {
    cached = new MockProvider();
  } else {
    cached = new FeatherlessProvider({
      apiKey: config.featherless.apiKey,
      baseUrl: config.featherless.baseUrl,
      timeoutMs: config.featherless.timeoutMs,
      sttModel: config.featherless.sttModel,
      sttBaseUrl: config.featherless.sttBaseUrl,
    });
  }
  return cached;
}

export function resetProvider() {
  cached = null;
}
