/**
 * Procedurally synthesised UI sound effects (no licensing issues, tiny, deterministic).
 * Kept subtle on purpose: they should be *felt* under the narration, not noticed.
 */
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

function wav(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.89 / peak : 1;
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * g)) * 32767), 44 + i * 2));
  return buf;
}

function make(dur: number, fn: (t: number, i: number) => number) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
  // 3ms fade in/out to avoid clicks
  const f = Math.round(0.003 * SR);
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[n - 1 - i] *= i / f; }
  return out;
}

/** State-variable band-pass over noise with a moving centre frequency. */
function sweptNoise(dur: number, f0: number, f1: number, f2: number, q: number, seed: number) {
  const r = rng(seed);
  let low = 0, band = 0;
  return make(dur, (t) => {
    const u = t / dur;
    const fc = u < 0.5 ? f0 + (f1 - f0) * (u / 0.5) : f1 + (f2 - f1) * ((u - 0.5) / 0.5);
    const f = 2 * Math.sin((Math.PI * fc) / SR);
    const x = r();
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    const env = Math.sin(Math.PI * u) ** 1.6;
    return band * env;
  });
}

export const SFX: Record<string, () => Float32Array> = {
  pop: () => {
    let ph = 0;
    return make(0.12, (t) => {
      const f = 260 + 620 * Math.exp(-t * 38);
      ph += (2 * Math.PI * f) / SR;
      return Math.sin(ph) * Math.exp(-t * 32);
    });
  },
  tick: () => make(0.05, (t) => Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 110) + Math.sin(2 * Math.PI * 3300 * t) * 0.3 * Math.exp(-t * 160)),
  whoosh: () => sweptNoise(0.5, 350, 2400, 700, 0.9, 7),
  swoosh: () => sweptNoise(0.32, 500, 1500, 600, 1.2, 11),
  ding: () => make(1.0, (t) => (Math.sin(2 * Math.PI * 1318.5 * t) + 0.45 * Math.sin(2 * Math.PI * 1975.5 * t) + 0.2 * Math.sin(2 * Math.PI * 2637 * t)) * Math.exp(-t * 5.5) * Math.min(1, t * 400)),
  error: () => make(0.34, (t) => {
    const f = t < 0.15 ? 311 : 233;
    const env = t < 0.15 ? Math.exp(-(t) * 14) : Math.exp(-(t - 0.17) * 12) * (t > 0.17 ? 1 : 0);
    return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * env;
  }),
  thud: () => {
    const r = rng(3);
    let ph = 0, lp = 0;
    return make(0.3, (t) => {
      const f = 48 + 70 * Math.exp(-t * 25);
      ph += (2 * Math.PI * f) / SR;
      lp += 0.08 * (r() - lp);
      return Math.sin(ph) * Math.exp(-t * 14) + lp * 2.2 * Math.exp(-t * 40);
    });
  },
};

export function generateSfx(dir: string): string[] {
  fs.mkdirSync(dir, { recursive: true });
  return Object.entries(SFX).map(([name, fn]) => {
    const file = path.join(dir, `${name}.wav`);
    fs.writeFileSync(file, wav(fn()));
    return file;
  });
}
