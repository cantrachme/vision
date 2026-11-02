import { createSilenceDetector } from './silence.ts';
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

export interface RecordingOptions {
  silenceDetection?: boolean;
  onReady?: (stop: () => void) => void;
  onDuration?: (seconds: number) => void;
}
export async function recordVoice(signal: AbortSignal, options: RecordingOptions = {}): Promise<Blob> {
  signal.throwIfAborted();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable. Open the native app and check macOS permissions.');
  const context = new AudioContext();
  void context.resume().catch(() => {});
  let stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let abortListener = () => {};
  let deviceListener = () => {};
  const stopTracks = (value: MediaStream) => value.getTracks().forEach(track => track.stop());
  const permissionSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  try {
    const acquisition = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
    acquisition.then(value => { if (permissionSignal.aborted) stopTracks(value); }, () => {});
    stream = await new Promise<MediaStream>((resolve, reject) => {
      const abort = () => reject(new Error('Microphone permission was cancelled or timed out.'));
      permissionSignal.addEventListener('abort', abort, { once: true });
      acquisition.then(value => { permissionSignal.removeEventListener('abort', abort); resolve(value); }, error => { permissionSignal.removeEventListener('abort', abort); reject(error); });
    });
    signal.throwIfAborted();
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url).href);
    await context.resume();
    signal.throwIfAborted();
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'vision-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const chunks: Float32Array[] = [];
    const detectSilence = createSilenceDetector();
    let sampleCount = 0;
    await new Promise<void>((resolve, reject) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        processor!.port.postMessage('stop');
        flushTimer = setTimeout(() => reject(new Error('Microphone did not stop correctly. Please try again.')), 2000);
      };
      abortListener = () => reject(new Error('Recording cancelled.'));
      deviceListener = () => reject(new Error('Microphone disconnected. Check your input device.'));
      signal.addEventListener('abort', abortListener, { once: true });
      stream!.getTracks().forEach(track => track.addEventListener('ended', deviceListener));
      processor!.onprocessorerror = () => reject(new Error('Audio recording failed. Please try again.'));
      processor!.port.onmessage = event => {
        if (event.data.done) { resolve(); return; }
        const samples = event.data.samples as Float32Array;
        const remaining = Math.round(context.sampleRate * 60) - sampleCount;
        const chunk = samples.slice(0, Math.max(0, remaining));
        if (chunk.length) { chunks.push(chunk); sampleCount += chunk.length; }
        if (sampleCount >= context.sampleRate * 60 || (options.silenceDetection && detectSilence(chunk, context.sampleRate))) stop();
      };
      // Worklet outputs zeros: processing is live, microphone is never monitored.
      source!.connect(processor!); processor!.connect(context.destination);
      const start = performance.now();
      options.onDuration?.(0);
      interval = setInterval(() => options.onDuration?.(Math.min(60, Math.floor((performance.now() - start) / 1000))), 250);
      limit = setTimeout(stop, 60000);
      options.onReady?.(stop);
    });
    signal.throwIfAborted();
    if (sampleCount < context.sampleRate * .1) throw new Error('Recording is empty or too short. Please try again.');
    const samples = new Float32Array(sampleCount); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    return encodeWav(samples, context.sampleRate);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('Microphone denied. Allow VISION in System Settings → Privacy & Security → Microphone, then restart.');
    throw new Error(error instanceof Error && !(error instanceof DOMException) ? error.message : 'Microphone recording failed. Check permissions and input device.');
  } finally {
    clearInterval(interval); clearTimeout(limit); clearTimeout(flushTimer);
    signal.removeEventListener('abort', abortListener);
    if (processor) { processor.port.onmessage = null; processor.onprocessorerror = null; processor.port.close(); processor.disconnect(); }
    source?.disconnect();
    if (stream) { stream.getTracks().forEach(track => track.removeEventListener('ended', deviceListener)); stopTracks(stream); }
    await context.close().catch(() => {});
  }
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
