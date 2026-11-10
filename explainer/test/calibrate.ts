/** Compares the narration-length estimator with real TTS word timings (timings.json from a cloud job). */
import fs from 'node:fs';
import { parseNarration, estimateWordTimes, estimatePace } from '../engine/narration';
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const timings = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
let real = 0, est = 0, words = 0;
for (const sc of spec.scenes) {
  if (!sc.narration || !timings[sc.id]) continue;
  const p = parseNarration(sc.narration, spec.pronounce ?? {});
  const t = timings[sc.id];
  const e = estimateWordTimes(p.tokens, estimatePace(spec.voice)).duration;
  real += t.durationSec; est += e; words += p.tokens.length;
  console.log(`${sc.id.padEnd(14)} real ${t.durationSec.toFixed(1).padStart(5)}s  est ${e.toFixed(1).padStart(5)}s  ${(p.tokens.length / t.durationSec).toFixed(2)} w/s`);
}
console.log(`TOTAL real ${real.toFixed(1)}s est ${est.toFixed(1)}s ratio ${(est / real).toFixed(2)} · ${(words / real).toFixed(2)} words/s`);
