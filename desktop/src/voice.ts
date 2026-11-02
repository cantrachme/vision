import { fetch } from '@tauri-apps/plugin-http';

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767), true));
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function recordVoice(signal: AbortSignal): Promise<Blob> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable. Open the native app and check macOS permissions.');
  const context = new AudioContext();
  void context.resume().catch(() => {});
  const stop = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const permissionSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  try {
    const acquisition = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
    // A permission dialog can outlive cancellation; never leave late tracks running.
    acquisition.then(value => { if (permissionSignal.aborted) stop(value); }, () => {});
    stream = await new Promise<MediaStream>((resolve, reject) => {
      const abort = () => reject(new Error('Microphone permission was cancelled or timed out.'));
      permissionSignal.addEventListener('abort', abort, { once: true });
      acquisition.then(value => { permissionSignal.removeEventListener('abort', abort); resolve(value); }, error => { permissionSignal.removeEventListener('abort', abort); reject(error); });
    });
    signal.throwIfAborted();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    // A five-second PCM capture avoids Safari MediaRecorder's MP4/AAC format,
    // which the existing WAV/MP3 endpoint intentionally does not accept.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain(); mute.gain.value = 0;
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error('Recording cancelled.')); };
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 5000);
      });
    } finally { processor.onaudioprocess = null; processor.disconnect(); source.disconnect(); mute.disconnect(); }
    const count = Math.min(chunks.reduce((n, c) => n + c.length, 0), Math.round(context.sampleRate * 5));
    if (!count) throw new Error('No microphone audio received. Check your input device.');
    const samples = new Float32Array(count); let offset = 0;
    for (const chunk of chunks) { const length = Math.min(chunk.length, count - offset); samples.set(chunk.subarray(0, length), offset); offset += length; }
    return encodeWav(samples, context.sampleRate);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('Microphone denied. Allow VISION in System Settings → Privacy & Security → Microphone, then restart.');
    throw new Error(error instanceof Error && !(error instanceof DOMException) ? error.message : 'Microphone recording failed. Check permissions and input device.');
  } finally { clearTimeout(timer); if (stream) stop(stream); await context.close(); }
}

async function voiceRequest(path: string, body: BodyInit, signal: AbortSignal, timeout: number, json = false) {
  const base = (import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  let response: Response;
  try { response = await fetch(`${base}/api/v1/${path}`, { method: 'POST', body, ...(json ? { headers: { 'Content-Type': 'application/json' } } : {}), connectTimeout: 5000, signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) }); }
  catch { throw new Error(`${path === 'speak' ? 'Speech playback' : 'Transcription'} connection failed or timed out. Check the backend; no retry was sent.`); }
  if (!response.ok) throw new Error(`${path === 'speak' ? 'Speech playback' : 'Transcription'} failed (HTTP ${response.status}). Check the backend and local audio setup.`);
  try { return await response.json(); } catch { throw new Error('Invalid voice response from backend.'); }
}
export async function transcribeVoice(audio: Blob, signal: AbortSignal): Promise<string> {
  const form = new FormData(); form.append('file', audio, 'voice.wav');
  const data = await voiceRequest('transcribe', form, signal, 180000);
  if (typeof data?.text !== 'string') throw new Error('Invalid transcription response.');
  if (!data.text.trim()) throw new Error('No speech recognized. Please try again.');
  return data.text.trim();
}
export async function speakVoice(text: string, signal: AbortSignal) {
  const data = await voiceRequest('speak', JSON.stringify({ text }), signal, 70000, true);
  if (data?.status !== 'completed') throw new Error('Speech playback did not complete.');
}
