import { WebSocket, WebSocketServer } from 'ws';
import config from './config.js';

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.8-live';
const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export function attachLiveVoice(server) {
  const localWss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/api/live-voice') return;
    if (!config.gemini.apiKey) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    localWss.handleUpgrade(req, socket, head, (client) => {
      localWss.emit('connection', client, req);
    });
  });

  localWss.on('connection', (client) => {
    const upstream = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(config.gemini.apiKey)}`);
    let setupSent = false;
    let upstreamReady = false;
    const pending = [];

    const sendClient = (value) => {
      if (client.readyState === WebSocket.OPEN) client.send(typeof value === 'string' ? value : JSON.stringify(value));
    };

    upstream.on('open', () => {
      setupSent = true;
      upstream.send(JSON.stringify({
        setup: {
          model: `models/${LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_LIVE_VOICE ?? 'Kore' } } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: 'You are Prism, a helpful voice assistant. Speak naturally and concisely. Respond with audio and keep a conversational tone. Let the user interrupt you naturally.' }],
          },
        },
      }));
    });

    upstream.on('message', (raw) => {
      const text = raw.toString();
      let event;
      try { event = JSON.parse(text); } catch { sendClient(text); return; }
      if (event.setupComplete) {
        upstreamReady = true;
        sendClient(text);
        for (const message of pending.splice(0)) upstream.send(message);
        return;
      }
      sendClient(text);
    });

    client.on('message', (raw, isBinary) => {
      if (isBinary) {
        if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(raw, { binary: true });
        else if (pending.length < 20) pending.push(raw);
        return;
      }
      if (upstream.readyState !== WebSocket.OPEN || !setupSent) return;
      if (upstreamReady) upstream.send(raw.toString());
      else if (pending.length < 20) pending.push(raw.toString());
    });

    const closeBoth = () => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
    };
    client.on('close', closeBoth);
    upstream.on('close', (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        sendClient({ prismError: `Gemini Live disconnected (${code}): ${reason.toString() || 'connection closed'}` });
        client.close();
      }
    });
    upstream.on('error', (err) => {
      sendClient({ prismError: `Gemini Live connection failed: ${err.message}` });
      closeBoth();
    });
    client.on('error', closeBoth);
  });
}
