import config from '../config.js';
import { FeatherlessProvider } from './featherless.js';
import { GrokProvider } from './grok.js';
import { MockProvider } from './mock.js';

let cached = null;

export function getProvider() {
  if (cached) return cached;
  if (config.aiProvider === 'mock') {
    cached = new MockProvider();
  } else if (config.aiProvider === 'featherless') {
    cached = new FeatherlessProvider({
      apiKey: config.featherless.apiKey,
      baseUrl: config.featherless.baseUrl,
      timeoutMs: config.featherless.timeoutMs,
      sttModel: config.featherless.sttModel,
      sttBaseUrl: config.featherless.sttBaseUrl,
    });
  } else {
    cached = new GrokProvider({
      apiKey: config.grok.apiKey,
      baseUrl: config.grok.baseUrl,
      timeoutMs: config.grok.timeoutMs,
    });
  }
  return cached;
}

export function resetProvider() {
  cached = null;
}
