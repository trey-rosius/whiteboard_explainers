/**
 * Accuracy of transcript alignment. Offline cases always run; with ELEVENLABS_API_KEY (--env-file=.env) it also
 * measures Scribe-based timings against ElevenLabs' exact character timings for the same generated speech.
 */
import { alignFromChars, alignTranscript, cutWav, findRestarts, parseNarration, wavDuration, type TranscriptWord } from '../engine/narration';

let fails = 0;
const ok = (c: unknown, l: string, x = '') => { console.log(`${c ? '✔' : '✖'} ${l}${x ? ` — ${x}` : ''}`); if (!c) fails++; };
const fake = (text: string, wps = 2.5): TranscriptWord[] => text.split(/\s+/).map((w, i) => ({ text: w, start: i / wps, end: (i + 0.8) / wps }));
const monotonic = (ws: Array<{ start: number }>) => ws.every((w, i) => !i || w.start >= ws[i - 1].start);
const script = 'Every request {req} lands on one database, and at ten thousand {load} requests a second it falls over {bad}.';
const P = parseNarration(script);
const cueTime = (r: ReturnType<typeof alignTranscript>, cue: string) => r.words[P.cues[cue]]?.start ?? -1;

const exact = alignTranscript(P.tokens, fake(P.spokenText), 10);
ok(exact.coverage === 1 && exact.words.length === P.tokens.length, 'read exactly: every word matched');
const heard = alignTranscript(P.tokens, fake('Every request lands on one database, and at 10,000 requests a second it falls over.'), 10);
ok(heard.words.length === P.tokens.length && monotonic(heard.words), 'number written as digits: one token per script word, still in order', `coverage ${heard.coverage.toFixed(2)}`);
const heardWords = fake('Every request lands on one database, and at 10,000 requests a second it falls over.');
ok(Math.abs(cueTime(heard, 'load') - heardWords.find((w) => w.text === 'requests' && w.start > 2)!.start) < 1.2, 'cue after the number stays near its real time');
ok(P.cues.bad === P.tokens.length, 'a cue before final punctuation means end of narration');
const adlib = alignTranscript(P.tokens, fake('Okay so every single request lands on just one database, and um at ten thousand requests a second it basically falls over.'), 12);
ok(adlib.coverage > 0.9 && monotonic(adlib.words), 'ad-libs and fillers tolerated', `coverage ${adlib.coverage.toFixed(2)}`);
const skipped = alignTranscript(P.tokens, fake('Every request lands on one database and it falls over.'), 8);
ok(skipped.words.length === P.tokens.length && monotonic(skipped.words) && skipped.missing.includes('thousand'), 'skipped words are interpolated and reported', skipped.missing.join(' '));
const wrong = alignTranscript(P.tokens, fake('The quick brown fox jumps over a lazy dog near the riverbank every morning.'), 8);
ok(wrong.coverage < 0.5, 'wrong recording is detectable', `coverage ${wrong.coverage.toFixed(2)}`);
const silent = alignTranscript(P.tokens, [], 6);
ok(silent.coverage === 0 && silent.words.length === P.tokens.length && monotonic(silent.words), 'empty transcript does not crash');
ok(alignTranscript([], fake('hello there'), 2).coverage === 1, 'scene without narration does not crash');

// Re-read mistakes: cut the false start, keep everything else.
const LINE = parseNarration('Most teams fall into one of two traps. The first is assisted development, where humans still own the planning.');
const said = (r: ReturnType<typeof findRestarts>) => r.transcript.map((w) => w.text).join(' ');
const clean = LINE.spokenText;
const none = findRestarts(LINE.tokens, fake(clean), 10);
ok(none.cuts.length === 0, 'clean reading: nothing cut');
const sentenceAgain = findRestarts(LINE.tokens, fake('Most teams fall into one of two traps. The first is assistant, sorry. The first is assisted development, where humans still own the planning.'), 20);
ok(sentenceAgain.cuts.length === 1 && said(sentenceAgain) === clean, 'sentence re-read after a slip: first attempt cut', sentenceAgain.cuts[0]?.said);
const opening = findRestarts(LINE.tokens, fake(`Most teems fell. ${clean}`), 20);
ok(opening.cuts.length === 1 && opening.cuts[0].from === 0 && said(opening) === clean, 'slip in the first sentence: cut from the very start', opening.cuts[0]?.said);
const twice = findRestarts(LINE.tokens, fake(`Most teams fall into one of two traps. The first is assisted. Most teams fall into one of two traps. The first is assisted development, where humans still own the planning. ${clean}`), 40);
ok(said(twice) === clean, 'whole scene read again: the last reading is what stays', `${twice.cuts.length} cut(s)`);
const slips = findRestarts(LINE.tokens, fake('Most teams fall in. Most teams fall into one of two traps. The first is assisted develop, assisted development, where humans still still own the planning.'), 20);
ok(said(slips) === clean && slips.cuts.length === 3, 'several slips in one take: each is cut', slips.cuts.map((c) => c.said).join(' | '));
const kept = findRestarts(LINE.tokens, fake('Okay so most teams basically fall into one of just two traps. The first is um assisted development, where humans still own all the planning.'), 20);
ok(kept.cuts.length === 0, 'ad-libs and fillers are not re-reads: nothing cut', kept.cuts.map((c) => c.said).join(' | '));
const DIGITS = parseNarration('At ten thousand requests a second, published on July thirty-first, it falls over.');
ok(findRestarts(DIGITS.tokens, fake('At 10,000 requests a second, published on July 31st, it falls over.'), 10).cuts.length === 0, 'numbers transcribed as digits: nothing cut');
// A pronounced number ("2017" said as "twenty seventeen") is transcribed as digits: the re-read must still be the one kept.
const YEAR = parseNarration('Before 2017, translation AI had a problem.', { '2017': 'twenty seventeen' });
const year = findRestarts(YEAR.tokens, fake('Before 2017, translation AI had a-- before 2017, translation AI had a problem.'), 20);
ok(year.cuts.length === 1 && year.cuts[0].from === 0 && said(year) === 'before 2017, translation AI had a problem.', 'restart on a pronounced number: the whole first attempt is cut', year.cuts[0]?.said);
// A number written as words but transcribed as digits: the repeated sentence is cut whole, never half of each reading.
const SECS = parseNarration('In the third, only Decider runs. Switching back takes about forty-five seconds.');
const secs = findRestarts(SECS.tokens, fake('In the third, only Decider runs. Switching back takes about 45 seconds. Switching back takes about 45 seconds.'), 20);
ok(secs.cuts.length === 1 && said(secs) === 'In the third, only Decider runs. Switching back takes about 45 seconds.', 'number words vs digits: one whole reading kept', secs.cuts.map((c) => c.said).join(' | '));
const secsAlign = alignTranscript(SECS.tokens, fake('In the third, only Decider runs. Switching back takes about 45 seconds.'), 10);
ok(secsAlign.coverage === 1, 'number words vs digits: every word matched', secsAlign.missing.join(','));
const retimed = findRestarts(LINE.tokens, fake(`Most teems fell. ${clean}`), 20);
ok(monotonic(retimed.transcript) && retimed.transcript[0].start < 0.3 && retimed.durationSec < 20, 'later words move earlier by the amount removed', `first word at ${retimed.transcript[0].start.toFixed(2)}s, ${retimed.durationSec.toFixed(2)}s long`);

// Cutting the audio itself: a 2 s tone with the middle second removed.
const RATE = 44100;
const tone = new Uint8Array(44 + RATE * 4);
const tv = new DataView(tone.buffer);
[...'RIFF'].forEach((c, i) => tv.setUint8(i, c.charCodeAt(0))); tv.setUint32(4, 36 + RATE * 4, true); [...'WAVEfmt '].forEach((c, i) => tv.setUint8(8 + i, c.charCodeAt(0)));
tv.setUint32(16, 16, true); tv.setUint16(20, 1, true); tv.setUint16(22, 1, true); tv.setUint32(24, RATE, true); tv.setUint32(28, RATE * 2, true); tv.setUint16(32, 2, true); tv.setUint16(34, 16, true);
[...'data'].forEach((c, i) => tv.setUint8(36 + i, c.charCodeAt(0))); tv.setUint32(40, RATE * 4, true);
for (let i = 0; i < RATE * 2; i++) tv.setInt16(44 + i * 2, 10000, true);
const cutTone = cutWav(tone, [{ from: 0.5, to: 1.5 }]);
const cv = new DataView(cutTone.buffer);
ok(Math.abs(wavDuration(cutTone)! - 1) < 0.001, 'cut audio is the right length', `${wavDuration(cutTone)!.toFixed(3)}s`);
ok(cv.getInt16(44 + Math.floor(RATE * 0.25) * 2, true) === 10000 && Math.abs(cv.getInt16(44 + Math.floor(RATE * 0.5) * 2, true)) < 300, 'audio is untouched away from the join and fades to near silence at it');
ok(cutWav(tone, []).length === tone.length, 'no cuts: same audio');

const key = process.env.ELEVENLABS_API_KEY;
if (key) {
  const text = "So here's the problem. Your API is getting hammered: one client is firing ten thousand requests a second. How do you slow them down, without blocking everyone else? That's exactly what a token bucket does. Let's build one.";
  const parsed = parseNarration(text);
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/6OzrBCQf8cjERkYgzSg8/with-timestamps?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: 'eleven_v3' }) });
  const j: any = await res.json();
  const al = j.alignment ?? j.normalized_alignment;
  const truth = alignFromChars(parsed.tokens, al.character_start_times_seconds, al.character_end_times_seconds);
  const f = new FormData();
  f.append('model_id', 'scribe_v2'); f.append('language_code', 'en'); f.append('timestamps_granularity', 'word'); f.append('tag_audio_events', 'false');
  f.append('file', new Blob([Buffer.from(j.audio_base64, 'base64')], { type: 'audio/mpeg' }), 'a.mp3');
  const stt: any = await (await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: f })).json();
  const a = alignTranscript(parsed.tokens, stt.words.filter((w: any) => w.type === 'word'), al.character_end_times_seconds.at(-1));
  const signed = a.words.map((w, i) => w.start - truth[i].start);
  console.log('  signed start error (ms):', signed.map((e) => Math.round(e * 1000)).join(' '));
  console.log('  word durations truth vs scribe (first 8):', a.words.slice(0, 8).map((w, i) => `${parsed.tokens[i].spoken}:${truth[i].start.toFixed(2)}/${w.start.toFixed(2)}`).join(' '));
  const errs = a.words.map((w, i) => Math.abs(w.start - truth[i].start)).sort((x, y) => x - y);
  const p50 = errs[Math.floor(errs.length / 2)], p95 = errs[Math.floor(errs.length * 0.95)], max = errs.at(-1)!;
  console.log(`  real audio: coverage ${a.coverage.toFixed(2)} · median error ${(p50 * 1000).toFixed(0)} ms · p95 ${(p95 * 1000).toFixed(0)} ms · max ${(max * 1000).toFixed(0)} ms · missing: ${a.missing.join(' ')}`);
  ok(p95 < 0.25, 'real speech: 95% of words within 250 ms of exact timings');
}
console.log(fails ? `\n✖ ${fails} failed` : '\n✔ alignment checks passed');
process.exit(fails ? 1 : 0);
