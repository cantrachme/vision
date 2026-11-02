/* Local module: bounded PCM batches, no audio output/monitoring. */
class VisionPCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(2048); this.offset = 0; this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.stopped = true; this.flush(); this.port.postMessage({ done: true });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ samples }, [samples.buffer]); this.offset = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.buffer[this.offset++] = sample;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('vision-pcm', VisionPCM);
