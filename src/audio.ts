/**
 * Pure audio helpers for narration takes. Every recording or uploaded file (webm, m4a, mp3, wav…) becomes the same
 * thing: mono 16-bit 44.1 kHz WAV, with silence trimmed and peaks normalised, so the pipeline never meets a surprise.
 */
export const TAKE_SAMPLE_RATE = 44100;

export interface TakeCheck { seconds: number; peak: number; rms: number; clippedShare: number; problem?: string; warning?: string }

/** Averages channels into one. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

/** Removes silence at both ends, keeping a short natural margin. Quiet takes use a threshold relative to their peak. */
export function trimSilence(s: Float32Array, rate = TAKE_SAMPLE_RATE, marginSec = 0.18): Float32Array {
  const win = Math.max(1, Math.floor(rate * 0.02));
  let peak = 0;
  for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
  const threshold = Math.max(0.004, peak * 0.04);
  const loud = (from: number) => {
    let sum = 0;
    const end = Math.min(s.length, from + win);
    for (let i = from; i < end; i++) sum += s[i] * s[i];
    return Math.sqrt(sum / Math.max(1, end - from)) > threshold;
  };
  let a = 0;
  while (a < s.length && !loud(a)) a += win;
  if (a >= s.length) return s; // all silence: leave it for analyse() to report
  let b = s.length - win;
  while (b > a && !loud(b)) b -= win;
  const margin = Math.floor(rate * marginSec);
  return s.subarray(Math.max(0, a - margin), Math.min(s.length, b + win + margin));
}

/** Measures a take and says what's wrong with it, in words the user can act on. */
export function analyse(s: Float32Array, rate = TAKE_SAMPLE_RATE): TakeCheck {
  let peak = 0, sum = 0, clipped = 0;
  for (let i = 0; i < s.length; i++) {
    const v = Math.abs(s[i]);
    peak = Math.max(peak, v); sum += v * v;
    if (v >= 0.995) clipped++;
  }
  const seconds = s.length / rate, rms = Math.sqrt(sum / Math.max(1, s.length)), clippedShare = clipped / Math.max(1, s.length);
  const c: TakeCheck = { seconds, peak, rms, clippedShare };
  if (seconds < 0.5) c.problem = 'That take is too short. Record the whole scene.';
  else if (seconds > 600) c.problem = 'That take is over 10 minutes. Record each scene separately.';
  else if (peak < 0.02) c.problem = 'No voice detected. Check the right microphone is selected and not muted.';
  else if (clippedShare > 0.002) c.warning = 'Your voice is distorting. Move back from the mic or lower its input level, then retake.';
  else if (peak < 0.08) c.warning = 'This take is very quiet and may sound noisy once boosted. Move closer to the mic if you can.';
  return c;
}

/** Scales so the loudest moment sits just under full scale; never boosts past `maxGain` (would amplify room noise). */
export function normalisePeak(s: Float32Array, target = 0.89, maxGain = 8): Float32Array {
  let peak = 0;
  for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
  if (!peak) return s;
  const gain = Math.min(maxGain, target / peak);
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i] * gain;
  return out;
}

/** Mono 16-bit PCM WAV. */
export function encodeWav(s: Float32Array, rate = TAKE_SAMPLE_RATE): Uint8Array {
  const b = new ArrayBuffer(44 + s.length * 2);
  const v = new DataView(b);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + s.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, s.length * 2, true);
  for (let i = 0; i < s.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s[i])) * 32767, true);
  return new Uint8Array(b);
}
