/** Take processing: trimming, loudness, checks and the WAV format the pipeline reads. npx tsx explainer/test/audio-check.ts */
import { analyse, encodeWav, mixToMono, normalisePeak, trimSilence, TAKE_SAMPLE_RATE as R } from '../../src/audio';
import { wavDuration } from '../engine/narration';

let fails = 0;
const ok = (c: unknown, l: string, x = '') => { console.log(`${c ? '✔' : '✖'} ${l}${x ? ` — ${x}` : ''}`); if (!c) fails++; };
const tone = (sec: number, amp: number) => Float32Array.from({ length: Math.floor(sec * R) }, (_, i) => Math.sin(i * 0.05) * amp);
const concat = (...a: Float32Array[]) => { const o = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const hiss = (sec: number) => Float32Array.from({ length: Math.floor(sec * R) }, () => (Math.random() - 0.5) * 0.002);

const take = concat(hiss(2), tone(3, 0.4), hiss(1.5));
const t = trimSilence(take);
ok(Math.abs(t.length / R - 3.36) < 0.1, 'silence trimmed at both ends, small margin kept', `${(t.length / R).toFixed(2)} s from ${(take.length / R).toFixed(1)} s`);
const gap = trimSilence(concat(hiss(1), tone(1, 0.4), hiss(2), tone(1, 0.4), hiss(1)));
ok(gap.length / R > 4, 'pauses inside a take are kept');
const quietVoice = trimSilence(concat(hiss(1), tone(2, 0.05), hiss(1)));
ok(Math.abs(quietVoice.length / R - 2.36) < 0.2, 'quiet voice is not trimmed away');
ok(analyse(hiss(3)).problem?.includes('No voice'), 'silent recording refused', analyse(hiss(3)).problem);
ok(analyse(tone(0.2, 0.5)).problem?.includes('too short'), 'too-short take refused');
ok(analyse(tone(2, 1)).warning?.includes('distorting'), 'clipping warned');
ok(analyse(tone(2, 0.05)).warning?.includes('quiet'), 'quiet take warned');
ok(!analyse(tone(2, 0.5)).problem && !analyse(tone(2, 0.5)).warning, 'normal take passes');
const n = normalisePeak(tone(1, 0.3)); ok(Math.abs(Math.max(...n) - 0.89) < 0.01, 'peak normalised', Math.max(...n).toFixed(2));
const capped = normalisePeak(tone(1, 0.02)); ok(Math.max(...capped) < 0.17, 'gain capped so room noise is not blasted', Math.max(...capped).toFixed(2));
ok(mixToMono([tone(1, 0.5), tone(1, 0.5)]).length === R, 'stereo mixes to mono');
const wav = encodeWav(tone(2.5, 0.5));
ok(Math.abs(wavDuration(wav)! - 2.5) < 0.001, 'pipeline reads the app\'s WAV duration', `${wavDuration(wav)} s`);
ok(wavDuration(new Uint8Array(100)) === null, 'non-WAV bytes rejected');
ok(wavDuration(wav.subarray(0, 40)) === null, 'truncated WAV rejected');
ok((wav.length - 44) / 88200 === 2.5, 'API duration formula matches the file');
console.log(fails ? `\n✖ ${fails} failed` : '\n✔ audio checks passed');
process.exit(fails ? 1 : 0);
