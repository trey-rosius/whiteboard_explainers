/**
 * Finds lists the narrator says aloud ("requirements, user stories, and acceptance criteria"), so the validator can
 * check that each thing named actually appears on screen. Deliberately simple: it only needs to raise a question for
 * the writer, never to be certain, so a miss here costs a repair round at most.
 */
import type { Token } from './narration';

export interface SpokenItem { text: string; keywords: string[]; firstToken: number; lastToken: number }
export interface SpokenList { items: SpokenItem[] }

const STOP = new Set(('a an the and or of to into in on for with as by at it its your our their this that these those is are be was were '
  + 'we you they them from like such than then using use uses will can not all each every any some more most full big new very').split(' '));

/** Lowercase letters and digits, with a plural "s" removed, so "tests" and "test" match. */
export const stem = (word: string) => {
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
};
const keywordsOf = (words: string[]) => words.flatMap((w) => w.split(/[-–/]/)).map((w) => ({ raw: w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''), s: stem(w) })).filter((w) => w.s.length > 1 && !STOP.has(w.raw)).map((w) => w.s);

const MAX_ITEM_WORDS = 5;

export function findSpokenLists(tokens: Token[]): SpokenList[] {
  const lists: SpokenList[] = [];
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    const shown = tokens[i].display;
    const ends = /[.!?:;]["'”)]*$/.test(shown) || /[—–]$/.test(shown) || i === tokens.length - 1;
    const nextIsDash = /^[—–]+$/.test(tokens[i + 1]?.display ?? '');
    if (ends || nextIsDash) { const l = listIn(tokens, start, i); if (l) lists.push(l); start = i + 1; }
  }
  return lists;
}

function listIn(tokens: Token[], from: number, to: number): SpokenList | null {
  const parts: Array<[number, number]> = [];
  let s = from;
  for (let i = from; i <= to; i++) {
    if (/^[—–]+$/.test(tokens[i].display)) { s = i + 1; continue; }
    if (/,["'”)]*$/.test(tokens[i].display) || i === to) { if (i >= s) parts.push([s, i]); s = i + 1; }
  }
  if (parts.length < 2) return null;
  const isJoin = (i: number) => /^(and|or)$/i.test(tokens[i].display.replace(/[^\p{L}]/gu, ''));

  // The last part holds the final item, either "and C" or, without a final comma, "B and C".
  const last = parts[parts.length - 1];
  let finals: Array<[number, number]>;
  if (isJoin(last[0])) finals = [[last[0] + 1, Math.min(last[1], last[0] + MAX_ITEM_WORDS)]];
  else {
    let join = -1;
    for (let i = last[0] + 1; i <= last[1]; i++) if (isJoin(i)) { join = i; break; }
    if (join < 0) return null;
    // Short on both sides, or it's a clause: "a session where AI and humans build side by side" is not a list item.
    if (join - last[0] > 3 || last[1] - join > 3) return null;
    finals = [[last[0], join - 1], [join + 1, last[1]]];
  }
  const middle = parts.slice(1, -1);
  if ([...middle, ...finals.slice(0, -1)].some(([a, b]) => b - a + 1 > MAX_ITEM_WORDS)) return null;
  if (middle.length + finals.length + 1 < 3) return null;

  // The first part usually runs on from the sentence ("the AI turns intent into requirements"): take its tail.
  const second = middle[0] ?? finals[0];
  const firstLen = Math.max(1, Math.min(MAX_ITEM_WORDS, second[1] - second[0] + 1));
  const first: [number, number] = [Math.max(parts[0][0], parts[0][1] - firstLen + 1), parts[0][1]];

  const items = [first, ...middle, ...finals].map(([a, b]) => {
    const words = tokens.slice(a, b + 1).map((t) => t.display);
    while (words.length > 1 && STOP.has(words[0].toLowerCase())) words.shift();
    return { text: words.join(' ').replace(/[,.;:!?]+$/, ''), keywords: keywordsOf(words), firstToken: a, lastToken: b };
  });
  return items.every((it) => it.keywords.length) ? { items } : null;
}

/** Every word shown by an element's text, as stems. */
export function screenWords(spec: any): Set<string> {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string') out.push(...v.split(/[\s\-–/·,:&()→]+/));
    else if (Array.isArray(v)) v.forEach(add);
  };
  for (const key of ['label', 'sub', 'text', 'title', 'items', 'rows', 'columns', 'lines', 'code']) add(spec?.[key]);
  if (Array.isArray(spec?.bars)) spec.bars.forEach((b: any) => add(b.label));
  return new Set(out.map(stem).filter(Boolean));
}
