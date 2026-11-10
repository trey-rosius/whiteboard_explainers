/**
 * Narration parsing: cue markers, pronunciation substitution, and word-timing alignment.
 *
 *   "Every request {req} lands on one database {db}."
 *   → tokens: Every request lands on one database.   cues: req→2 ("lands"), db→5 ("database.")
 */

export interface Token {
  display: string;
  spoken: string;
  /** Char range of `spoken` inside the full spoken text. */
  s0: number;
  s1: number;
}

export interface ParsedNarration {
  tokens: Token[];
  /** cue name → index of the token it precedes (tokens.length = end of narration). */
  cues: Record<string, number>;
  /** Cues written at the END of a phrase ("becomes a number {ids}." or last in the narration), not before its words. */
  cuesEndingPhrase: string[];
  duplicateCues: string[];
  displayText: string;
  spokenText: string;
}

export interface WordTime { start: number; end: number }

const CUE_RE = /\{([a-z][a-z0-9-]*)\}/g;

export function parseNarration(text: string, pronounce: Record<string, string> = {}): ParsedNarration {
  const tokens: Token[] = [];
  const cues: Record<string, number> = {};
  const duplicateCues: string[] = [];
  const lowerMap = new Map(Object.entries(pronounce).map(([k, v]) => [k.toLowerCase(), v]));

  let last = 0;
  let m: RegExpExecArray | null;
  const pieces: Array<{ text?: string; cue?: string }> = [];
  const cuesEndingPhrase: string[] = [];
  CUE_RE.lastIndex = 0;
  while ((m = CUE_RE.exec(text))) {
    pieces.push({ text: text.slice(last, m.index) });
    pieces.push({ cue: m[1] });
    last = m.index + m[0].length;
    // "number {ids}." or a cue with nothing after it closes the phrase; "go. {arch} Tickets" opens the next one.
    const after = text.slice(last).replace(/\{[a-z][a-z0-9-]*\}/g, '');
    if (/^[.,;:!?)\]"'’”…—–]/u.test(after) || !/[\p{L}\p{N}]/u.test(after)) cuesEndingPhrase.push(m[1]);
  }
  pieces.push({ text: text.slice(last) });

  let spoken = '';
  for (const p of pieces) {
    if (p.cue) {
      if (p.cue in cues) duplicateCues.push(p.cue);
      cues[p.cue] = tokens.length;
      continue;
    }
    for (const word of (p.text ?? '').split(/\s+/).filter(Boolean)) {
      // Punctuation split off by a cue ("machine {cue}.") belongs to the previous word: never speak or show it alone.
      if (!/[\p{L}\p{N}]/u.test(word) && tokens.length && /^[.,;:!?)\]"'’”…]+$/u.test(word)) {
        const prev = tokens[tokens.length - 1];
        prev.display += word; prev.spoken += word; spoken += word; prev.s1 = spoken.length;
        continue;
      }
      const lead = word.match(/^[^\p{L}\p{N}]*/u)![0];
      const trail = word.match(/[^\p{L}\p{N}]*$/u)![0];
      const core = word.slice(lead.length, word.length - trail.length);
      const rep = pronounce[core] ?? lowerMap.get(core.toLowerCase());
      const spokenWord = rep !== undefined && core ? `${lead}${rep}${trail}` : word;
      if (spoken) spoken += ' ';
      const s0 = spoken.length;
      spoken += spokenWord;
      tokens.push({ display: word, spoken: spokenWord, s0, s1: spoken.length });
    }
  }
  return {
    tokens,
    cues,
    cuesEndingPhrase,
    duplicateCues,
    displayText: tokens.map((t) => t.display).join(' '),
    spokenText: spoken,
  };
}

/**
 * Estimator pace relative to eleven_multilingual_v2 at speed 1.0 (measured ~200 wpm).
 * Calibrated: v2 @ 0.9 → 0.81 (≈160 wpm), v3 @ 1.0 → 0.84 (≈166 wpm). Re-check with test/calibrate.ts.
 */
export function estimatePace(voice?: { model?: string; speed?: number }): number {
  const s = voice?.speed ?? 1;
  return (voice?.model ?? 'eleven_v3') === 'eleven_v3' ? 0.84 * s : s * s;
}
/** @deprecated kept for callers that pass a raw pace; equals v3 at speed 1. */
export const DEFAULT_VOICE_SPEED = 0.84;
/** Calibrated against real ElevenLabs timings (eleven_multilingual_v2, speed 1.0: estimate/real = 1.32). */
const CAL = 0.76;

/** Narration pace when no audio exists yet, with punctuation pauses. */
export function estimateWordTimes(tokens: Token[], speed = DEFAULT_VOICE_SPEED): { words: WordTime[]; duration: number } {
  const words: WordTime[] = [];
  let t = 0;
  for (const tok of tokens) {
    const letters = tok.spoken.replace(/[^\p{L}\p{N}]/gu, '').length;
    const d = ((0.11 + letters * 0.052) * CAL) / speed;
    words.push({ start: t, end: t + d });
    t += d + (0.04 * CAL) / speed;
    if (/[.!?]$/.test(tok.spoken)) t += (0.38 * CAL) / speed;
    else if (/[,;:—–-]$/.test(tok.spoken)) t += (0.18 * CAL) / speed;
  }
  return { words, duration: Math.max(t, 0.5) };
}

/** Exact alignment from per-character timings of the spoken text (ElevenLabs). */
export function alignFromChars(tokens: Token[], starts: number[], ends: number[]): WordTime[] {
  return tokens.map((tok) => {
    let i0 = tok.s0;
    let i1 = tok.s1 - 1;
    while (i0 < i1 && starts[i0] === undefined) i0++;
    while (i1 > i0 && ends[i1] === undefined) i1--;
    const start = starts[i0] ?? 0;
    return { start, end: Math.max(start + 0.05, ends[i1] ?? start + 0.2) };
  });
}

/**
 * Generic alignment when a provider returns its own word list (which may differ in
 * tokenisation): map by relative character position across the full text.
 */
export function alignProportional(tokens: Token[], provider: Array<{ word: string; start: number; end: number }>): WordTime[] {
  if (!provider.length) return estimateWordTimes(tokens).words;
  if (provider.length === tokens.length) return provider.map((w) => ({ start: w.start, end: w.end }));
  const pLens = provider.map((w) => Math.max(1, w.word.length));
  const pTotal = pLens.reduce((a, b) => a + b + 1, 0);
  const pPos: number[] = [];
  let acc = 0;
  for (const l of pLens) { pPos.push(acc / pTotal); acc += l + 1; }
  const spokenLen = tokens.length ? tokens[tokens.length - 1].s1 : 1;
  const at = (ratio: number) => {
    let i = 0;
    while (i + 1 < pPos.length && pPos[i + 1] <= ratio) i++;
    const w = provider[i];
    const next = pPos[i + 1] ?? 1;
    const frac = Math.min(1, Math.max(0, (ratio - pPos[i]) / Math.max(1e-6, next - pPos[i])));
    return w.start + (w.end - w.start) * frac;
  };
  return tokens.map((tok) => {
    const start = at(tok.s0 / spokenLen);
    const end = Math.max(start + 0.05, at(tok.s1 / spokenLen));
    return { start, end };
  });
}

// ─── Human narration: align a transcript of the recording to the script ───────────────────

export interface TranscriptWord { text: string; start: number; end: number }
export interface TranscriptAlignment {
  words: WordTime[];
  /** Share of script words found in the recording (1 = read exactly as written). */
  coverage: number;
  /** Script words that were not heard (timed by interpolation). */
  missing: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** "forty-five" → 45, "45" / "45," → 45, so a number read aloud matches a transcriber's digits. */
function numberValue(raw: string): number | null {
  const w = raw.toLowerCase().replace(/[^a-z0-9.-]/g, '').replace(/[.]+$/, '');
  if (/^\d+(\.\d+)?$/.test(raw.replace(/[,]/g, '').replace(/[^\d.]/g, '')) && /^\$?[\d,]+(\.\d+)?%?[.,;:!?]*$/.test(raw)) return Number(raw.replace(/[^\d.]/g, '').replace(/[.]+$/, ''));
  const parts = w.split('-');
  if (parts.length === 1) { const u = UNITS.indexOf(w); if (u >= 0) return u; const t = TENS.indexOf(w); return t >= 2 ? t * 10 : null; }
  if (parts.length === 2) { const t = TENS.indexOf(parts[0]), u = UNITS.indexOf(parts[1]); return t >= 2 && u >= 1 && u <= 9 ? t * 10 + u : null; }
  return null;
}

function similar(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.7;
  // Levenshtein ratio, cheap enough for words
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/**
 * Global sequence alignment (script tokens ↔ transcript words), tolerant of ad-libs, skipped words and differences
 * such as "ten thousand" ↔ "10,000". Unmatched script words are interpolated between their matched neighbours,
 * proportionally to length, so every token still gets a monotonic time and cues keep working.
 */
function matchTranscript(tokens: Token[], transcript: TranscriptWord[]) {
  const script = tokens.map((t) => norm(t.spoken));
  // A pronunciation ("2017" said as "twenty seventeen") changes the spoken form, but a transcriber writes digits and
  // acronyms as written, so a heard word may match either form.
  const written = tokens.map((t) => norm(t.display));
  const values = tokens.map((t) => numberValue(t.spoken) ?? numberValue(t.display));
  const heard = transcript.map((w) => ({ ...w, n: norm(w.text), v: numberValue(w.text) })).filter((w) => w.n);
  const heardValue = new Map(heard.map((w) => [w.n, w.v]));
  const like = (i: number, h: string) => {
    const v = values[i];
    if (v !== null && v === heardValue.get(h)) return 1;
    return Math.max(similar(script[i], h), written[i] !== script[i] ? similar(written[i], h) : 0);
  };
  const n = script.length;
  const m = heard.length;
  const GAP = -0.4;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 skip script word, 3 skip heard word
  for (let i = 1; i <= n; i++) { score[i][0] = i * GAP; move[i][0] = 2; }
  for (let j = 1; j <= m; j++) { score[0][j] = j * GAP; move[0][j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = like(i - 1, heard[j - 1].n);
      const diag = score[i - 1][j - 1] + (sim >= 0.65 ? 1 + sim : -1);
      const up = score[i - 1][j] + GAP;
      const left = score[i][j - 1] + GAP;
      // The tolerance matters: equal paths differ by float rounding, and a tie must resolve to the match.
      if (diag >= up - 1e-9 && diag >= left - 1e-9) { score[i][j] = diag; move[i][j] = 1; } else if (up >= left) { score[i][j] = up; move[i][j] = 2; } else { score[i][j] = left; move[i][j] = 3; }
    }
  }
  // Walking back from the end and preferring matches means a sentence read twice resolves to its LAST reading.
  const match = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const mv = move[i][j];
    if (mv === 1) { if (like(i - 1, heard[j - 1].n) >= 0.65) match[i - 1] = j - 1; i--; j--; } else if (mv === 2) i--; else j--;
  }
  return { script, heard, match, like };
}

export function alignTranscript(tokens: Token[], transcript: TranscriptWord[], durationSec: number): TranscriptAlignment {
  const { script, heard, match } = matchTranscript(tokens, transcript);
  const n = script.length;

  const words: WordTime[] = new Array(n);
  for (let i = 0; i < n; i++) if (match[i] >= 0) words[i] = { start: heard[match[i]].start, end: Math.max(heard[match[i]].start + 0.03, heard[match[i]].end) };
  const lens = script.map((s) => Math.max(1, s.length));
  for (let i = 0; i < n;) {
    if (words[i]) { i++; continue; }
    let e = i;
    while (e < n && !words[e]) e++;
    const from = i > 0 ? words[i - 1].end : 0;
    const to = e < n ? words[e].start : Math.max(from, durationSec);
    const total = lens.slice(i, e).reduce((a, b) => a + b, 0);
    let t = from;
    for (let k = i; k < e; k++) {
      const d = ((to - from) * lens[k]) / total;
      words[k] = { start: t, end: Math.max(t + 0.01, t + d) };
      t += d;
    }
    i = e;
  }
  for (let i = 1; i < n; i++) if (words[i].start < words[i - 1].start) words[i] = { start: words[i - 1].start, end: Math.max(words[i - 1].start + 0.01, words[i].end) };
  // Tokens with no letters or digits (a lone "." or "—") are never spoken, so they can't count as missed.
  const speakable = script.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
  const matched = speakable.filter((i) => match[i] >= 0).length;
  return { words, coverage: speakable.length ? matched / speakable.length : 1, missing: speakable.filter((i) => match[i] < 0).map((i) => tokens[i].display).slice(0, 20) };
}

// ─── Human narration: cut mistakes the speaker corrected by re-reading ────────────────────

export interface RestartCut { from: number; to: number; said: string }
export interface RestartEdit {
  cuts: RestartCut[];
  /** The transcript with cut words removed and later words moved earlier, matching the edited audio. */
  transcript: TranscriptWord[];
  durationSec: number;
}

/**
 * Finds false starts: words heard but not needed by the script, which the speaker then re-reads. Anything extra that is
 * NOT re-read (an ad-lib, "um", a number transcribed as digits) stays, because cutting it would damage a good reading.
 */
export function findRestarts(tokens: Token[], transcript: TranscriptWord[], durationSec: number): RestartEdit {
  const { script, heard, match, like } = matchTranscript(tokens, transcript);
  const scriptAt = new Map<number, number>();
  match.forEach((j, i) => { if (j >= 0) scriptAt.set(j, i); });
  const reread = (w: string, from: number, to: number) => script.slice(from, to).some((_, k) => like(from + k, w) >= 0.65);

  const cuts: RestartCut[] = [];
  const cutWords = new Set<number>();
  for (let j = 0; j < heard.length;) {
    if (scriptAt.has(j)) { j++; continue; }
    let e = j;
    while (e < heard.length && !scriptAt.has(e)) e++;
    // A run with nothing after it has no second reading to keep.
    if (e < heard.length) {
      const run = heard.slice(j, e);
      const next = scriptAt.get(e)!;
      const startsTheReread = run.slice(0, 2).some((w) => reread(w.n, next, next + 2));
      const mostlyReread = run.filter((w) => reread(w.n, next, next + run.length + 3)).length / run.length >= 0.5;
      if (startsTheReread || mostlyReread) {
        const prev = j > 0 ? heard[j - 1] : null;
        // Leave a natural gap: a little longer where the script has a sentence break.
        const prevToken = prev ? tokens[scriptAt.get(j - 1) ?? -1] : undefined;
        const pad = prevToken && /[.!?]["'”)]*$/.test(prevToken.spoken) ? 0.2 : 0.08;
        const from = prev ? Math.min(prev.end + pad, run[0].start) : 0;
        const to = Math.max(heard[e].start - pad, run[run.length - 1].end);
        if (to > from) {
          cuts.push({ from, to, said: run.map((w) => w.text).join(' ') });
          for (let k = j; k < e; k++) cutWords.add(k);
        }
      }
    }
    j = e;
  }

  const removedBefore = (t: number) => cuts.reduce((sum, c) => sum + (c.to <= t ? c.to - c.from : 0), 0);
  return {
    cuts,
    transcript: heard.filter((_, j) => !cutWords.has(j)).map((w) => { const d = removedBefore(w.start); return { text: w.text, start: w.start - d, end: w.end - d }; }),
    durationSec: durationSec - cuts.reduce((sum, c) => sum + (c.to - c.from), 0),
  };
}

/** The samples of a mono 16-bit PCM WAV (the app normalises every recording to one). */
export function readPcm16(b: Uint8Array): { rate: number; samples: Int16Array } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  let rate = 0, channels = 0, bits = 0, dataAt = -1, dataSize = 0;
  for (let o = 12; o + 8 <= b.length;) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'fmt ') { channels = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === 'data') { dataAt = o + 8; dataSize = Math.min(size, b.length - dataAt); break; }
    o += 8 + size + (size % 2);
  }
  if (dataAt < 0 || channels !== 1 || bits !== 16 || !rate) throw new Error('Expected a mono 16-bit PCM WAV');
  const samples = new Int16Array(Math.floor(dataSize / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = v.getInt16(dataAt + i * 2, true);
  return { rate, samples };
}

/** A mono 16-bit PCM WAV of these samples. */
export function pcm16Wav(samples: Int16Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const w = new DataView(out.buffer);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) w.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); w.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); w.setUint32(16, 16, true); w.setUint16(20, 1, true); w.setUint16(22, 1, true);
  w.setUint32(24, rate, true); w.setUint32(28, rate * 2, true); w.setUint16(32, 2, true); w.setUint16(34, 16, true);
  str(36, 'data'); w.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) w.setInt16(44 + i * 2, samples[i], true);
  return out;
}

/** Removes time ranges from a mono 16-bit PCM WAV, with short fades so the joins don't click. */
export function cutWav(b: Uint8Array, cuts: Array<{ from: number; to: number }>): Uint8Array {
  const { rate, samples } = readPcm16(b);
  const total = samples.length;
  const keep: Array<[number, number]> = [];
  let at = 0;
  for (const c of [...cuts].sort((x, y) => x.from - y.from)) {
    const a = Math.max(at, Math.min(total, Math.round(c.from * rate)));
    const z = Math.max(a, Math.min(total, Math.round(c.to * rate)));
    if (a > at) keep.push([at, a]);
    at = z;
  }
  if (at < total) keep.push([at, total]);

  const out = new Int16Array(keep.reduce((sum, [a, z]) => sum + z - a, 0));
  const fade = Math.floor(rate * 0.02);
  let o = 0;
  keep.forEach(([a, z], n) => {
    for (let i = a; i < z; i++) {
      const fromStart = n > 0 ? (i - a) / fade : 1;
      const fromEnd = n < keep.length - 1 ? (z - 1 - i) / fade : 1;
      out[o++] = Math.round(samples[i] * Math.min(1, fromStart, fromEnd));
    }
  });
  return pcm16Wav(out, rate);
}

/** Duration of a PCM WAV (the app normalises every recording to one); null when the file isn't a readable WAV. */
export function wavDuration(b: Uint8Array): number | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let byteRate = 0;
  for (let o = 12; o + 8 <= b.length;) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'fmt ') byteRate = v.getUint32(o + 16, true);
    if (id === 'data') return byteRate ? Math.min(size, b.length - o - 8) / byteRate : null;
    o += 8 + size + (size % 2);
  }
  return null;
}
