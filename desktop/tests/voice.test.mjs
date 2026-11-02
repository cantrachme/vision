import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, recordVoice } from '../src/voice.ts';

test('PCM WAV has correct header, sample rate, clamping and length', async () => {
  const blob = encodeWav(new Float32Array([-2, 0, 2]), 48000);
  const data = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 50);
  assert.equal(data.getUint32(24, true), 48000);
  assert.equal(data.getUint32(40, true), 6);
  assert.equal(data.getInt16(44, true), -32768);
  assert.equal(data.getInt16(48, true), 32767);
});

test('unavailable capture gives readable error without recording', async () => {
  await assert.rejects(recordVoice(new AbortController().signal), /Microphone capture is unavailable/);
});

import { createSilenceDetector } from '../src/silence.ts';
test('silence detection waits for speech and tolerates short pauses', () => {
  const detect = createSilenceDetector();
  const silence = new Float32Array(1000), speech = new Float32Array(1000).fill(.1);
  assert.equal(detect(silence, 1000), false);
  assert.equal(detect(silence, 1000), false);
  assert.equal(detect(speech, 1000), false);
  assert.equal(detect(silence, 1000), false);
  assert.equal(detect(speech, 1000), false);
  assert.equal(detect(silence, 1000), false);
  assert.equal(detect(silence, 1000), true);
});

test('manual stop and cancellation release nodes, tracks and context', async () => {
  for (const cancel of [false, true]) {
    const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const savedContext = globalThis.AudioContext, savedWorklet = globalThis.AudioWorkletNode;
    let stopped = 0, closed = 0, disconnected = 0, portClosed = 0;
    const track = { stop: () => stopped++, addEventListener() {}, removeEventListener() {} };
    const stream = { getTracks: () => [track] };
    class Context {
      sampleRate = 48000;
      audioWorklet = { addModule: async () => {} };
      resume = async () => {};
      close = async () => { closed++; };
      createMediaStreamSource() { return { connect(node) { node.port.onmessage({ data: { samples: new Float32Array(4800).fill(.1) } }); }, disconnect() { disconnected++; } }; }
    }
    class Worklet {
      port = { onmessage: null, postMessage: () => queueMicrotask(() => this.port.onmessage?.({ data: { done: true } })), close: () => portClosed++ };
      connect() {}
      disconnect() { disconnected++; }
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
    globalThis.AudioContext = Context; globalThis.AudioWorkletNode = Worklet;
    try {
      const controller = new AbortController();
      const capture = recordVoice(controller.signal, { onReady: stop => cancel ? controller.abort() : stop() });
      if (cancel) await assert.rejects(capture, /cancelled/);
      else assert.equal((await capture).size, 9644);
      assert.equal(stopped, 1); assert.equal(closed, 1); assert.equal(disconnected, 2); assert.equal(portClosed, 1);
    } finally {
      Object.defineProperty(globalThis, 'navigator', savedNavigator);
      if (savedContext) globalThis.AudioContext = savedContext; else delete globalThis.AudioContext;
      if (savedWorklet) globalThis.AudioWorkletNode = savedWorklet; else delete globalThis.AudioWorkletNode;
    }
  }
});
