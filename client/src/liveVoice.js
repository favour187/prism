const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

function toBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function floatToPcm16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

export async function startGeminiLive({ onTranscript, onStatus, onError } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
    throw new Error('Live voice requires microphone access and a supported browser.');
  }
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${location.host}/api/live-voice`);
  socket.binaryType = 'arraybuffer';
  let stream;
  let audioContext;
  let source;
  let processor;
  let muteGain;
  let stopped = false;
  let ready = false;
  let playbackAt = 0;
  const playbackNodes = new Set();

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    onStatus?.('stopping');
    try { processor?.disconnect(); } catch {}
    try { source?.disconnect(); } catch {}
    try { muteGain?.disconnect(); } catch {}
    for (const node of playbackNodes) {
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    playbackNodes.clear();
    stream?.getTracks().forEach((track) => track.stop());
    try { await audioContext?.close(); } catch {}
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    onStatus?.('idle');
  };

  socket.addEventListener('message', (event) => {
    let data;
    try { data = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); }
    catch { return; }
    if (data.prismError) {
      onError?.(new Error(data.prismError));
      stop();
      return;
    }
    if (data.setupComplete) {
      ready = true;
      onStatus?.('listening');
      return;
    }
    if (data.serverContent?.inputTranscription?.text) {
      onTranscript?.({ role: 'user', text: data.serverContent.inputTranscription.text });
    }
    if (data.serverContent?.outputTranscription?.text) {
      onTranscript?.({ role: 'assistant', text: data.serverContent.outputTranscription.text });
    }
    if (data.serverContent?.interrupted) {
      for (const node of playbackNodes) {
        try { node.stop(); } catch {}
      }
      playbackNodes.clear();
      playbackAt = audioContext?.currentTime ?? 0;
    }
    const parts = data.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      const encoded = part?.inlineData?.data;
      if (!encoded || !audioContext) continue;
      try {
        const bytes = fromBase64(encoded);
        const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
        const samples = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
        const buffer = audioContext.createBuffer(1, samples.length, OUTPUT_RATE);
        buffer.copyToChannel(samples, 0);
        const node = audioContext.createBufferSource();
        node.buffer = buffer;
        node.connect(audioContext.destination);
        const when = Math.max(audioContext.currentTime + 0.02, playbackAt);
        node.start(when);
        playbackAt = when + buffer.duration;
        playbackNodes.add(node);
        node.onended = () => { playbackNodes.delete(node); node.disconnect(); };
        onStatus?.('speaking');
      } catch (err) {
        onError?.(err);
      }
    }
    if (data.serverContent?.turnComplete && ready) onStatus?.('listening');
  });

  socket.addEventListener('error', () => onError?.(new Error('Could not connect to Gemini Live. Check the server and Gemini API key.')));
  socket.addEventListener('close', () => { if (!stopped) onStatus?.('idle'); });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gemini Live connection timed out.')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Gemini Live connection failed.')); }, { once: true });
    });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    audioContext = new AudioContext();
    await audioContext.resume();
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(2048, 1, 1);
    muteGain = audioContext.createGain();
    muteGain.gain.value = 0;
    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(audioContext.destination);
    processor.onaudioprocess = (event) => {
      if (!ready || stopped || socket.readyState !== WebSocket.OPEN) return;
      const mono = event.inputBuffer.getChannelData(0);
      const samples = resample(mono, audioContext.sampleRate, INPUT_RATE);
      const bytes = floatToPcm16(samples);
      socket.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: toBase64(bytes) } } }));
    };
    onStatus?.('connecting');
  } catch (err) {
    await stop();
    throw err;
  }

  return { stop };
}
