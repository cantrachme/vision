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
