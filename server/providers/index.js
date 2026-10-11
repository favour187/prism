import config from '../config.js';
import { FeatherlessProvider } from './featherless.js';
import { GroqProvider } from './groq.js';
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
    cached = new GroqProvider({
      apiKey: config.groq.apiKey,
      baseUrl: config.groq.baseUrl,
      timeoutMs: config.groq.timeoutMs,
      sttModel: config.groq.sttModel,
      sttBaseUrl: config.groq.sttBaseUrl,
    });
  }
  return cached;
}

export function resetProvider() {
  cached = null;
}
