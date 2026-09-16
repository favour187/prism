import config from '../config.js';
import { FeatherlessProvider } from './featherless.js';
import { MockProvider } from './mock.js';

let cached = null;

/**
 * Provider factory. The rest of the app only depends on the AIProvider
 * interface (providers/base.js), which is what keeps the vendor swappable.
 */
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

/** For tests: reset the singleton. */
export function resetProvider() {
  cached = null;
}
