/**
 * Client-side audio helpers for the local STT/TTS tools.
 * Whisper expects 16 kHz mono Float32 PCM — the AudioContext below
 * resamples whatever the browser can decode (mp3, wav, ogg, webm, m4a…).
 */

export const WHISPER_SAMPLE_RATE = 16_000;

export async function decodeAudioToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    if (decoded.numberOfChannels === 1) {
      // Copy — the underlying buffer belongs to the AudioContext.
      return decoded.getChannelData(0).slice();
    }
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    const mono = new Float32Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      mono[i] = ((left[i] ?? 0) + (right[i] ?? 0)) / 2;
    }
    return mono;
  } finally {
    void ctx.close();
  }
}
