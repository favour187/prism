export class AIProvider {
  id = 'base';

  isReady() {
    return true;
  }

  notReadyReason() {
    return '';
  }

  async *streamChat(opts) {
    throw new Error('streamChat not implemented');
  }

  async complete(opts) {
    throw new Error('complete not implemented');
  }

  async listModels() {
    return [];
  }

  supportsTranscription() {
    return false;
  }

  async transcribeAudio(audio) {
    throw new Error('transcribeAudio not implemented');
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
