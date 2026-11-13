/**
 * Caption styles, and which words a caption should make stand out. Pure, shared by the compiler and the renderer.
 */
import type { Format } from './layout';
import type { Token } from './narration';
import { findKeyFigures } from './emphasis';
import { autoCaptionChoices, type CaptionStyle } from './caption-list';
import type { ThemeName } from './theme-list';

export { CAPTION_STYLES, type CaptionStyle } from './caption-list';

const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h; };

/** Varies between videos among the styles that read best on this background; stable for one video (a re-render keeps its look). */
export function autoCaptionStyle(id: string, theme: ThemeName, format: Format): CaptionStyle {
  const options = autoCaptionChoices(theme, format);
  return options[hash(`captions:${id}`) % options.length] ?? 'subtle';
}

/**
 * Words worth catching the eye in one scene's narration: money, percentages and other numbers, and the first mention of
 * a name written as an acronym or CamelCase ("SQS", "DynamoDB", "AT&T"). One flag per token.
 */
/** Acronyms too everyday to be the point of a sentence. */
const COMMON = new Set(['ai', 'ok', 'us', 'uk', 'tv', 'id', 'pc']);

export function keyWords(tokens: Token[]): boolean[] {
  const seen = new Set<string>();
  const key = tokens.map((t) => {
    const w = t.display.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '');
    if (/\d/.test(w)) return true;
    // A name stands out the first time it's said in the scene; every "AI" in gold is noise.
    const name = /^[A-Z][A-Za-z&]*[A-Z][A-Za-z]*(?:'s)?$/.test(w) || /^[A-Z]?[a-z]+[A-Z][A-Za-z]*$/.test(w);
    const base = w.replace(/'s$|s$/, '').toLowerCase();
    if (!name || seen.has(base) || COMMON.has(base)) return false;
    seen.add(base);
    return true;
  });
  for (const f of findKeyFigures(tokens)) for (let i = f.first; i <= f.last; i++) key[i] = true;
  return key;
}

/** Splits a caption line into groups of at most `max` words, breaking after punctuation: for one-glance styles. */
export function wordGroups<T extends { text: string }>(words: T[], max = 3): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= max || /[.,!?;:]["'”)]*$/.test(w.text)) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}
