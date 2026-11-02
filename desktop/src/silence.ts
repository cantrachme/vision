/** Audio-level detection, not semantic speech recognition. */
export function createSilenceDetector(threshold = 0.015, silenceSeconds = 1.5) {
  let heardSpeech = false, quiet = 0;
  return (samples: Float32Array, sampleRate: number): boolean => {
    if (!samples.length) return false;
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    if (rms >= threshold) { heardSpeech = true; quiet = 0; }
    else if (heardSpeech) quiet += samples.length / sampleRate;
    return heardSpeech && quiet >= silenceSeconds;
  };
}
