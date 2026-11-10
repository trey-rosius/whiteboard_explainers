/**
 * What the narration says that the picture must show plainly: key figures (money and percentages) and things moving
 * from one place to another. Pure, so it can be tested on narration alone.
 */
import type { Token } from './narration';

export interface Phrase { text: string; first: number; last: number }
export interface Movement extends Phrase { /** How many separate moves the sentence describes ("goes into the queue, which triggers the function" = 2). */ moves: number }

const word = (t: Token | undefined) => (t?.spoken ?? '').toLowerCase().replace(/[^\p{L}\p{N}$%.-]/gu, '');
const NUMBER_WORD = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|point|half)$/;
const isNumber = (t: Token | undefined) => {
  const w = word(t).replace(/[.]+$/, '');
  if (!w) return false;
  if (/\d/.test(w)) return true;
  return w.split('-').every((p) => NUMBER_WORD.test(p));
};
const joins = (t: Token | undefined) => /^(and|a)$/.test(word(t));
const endsSentence = (t: Token) => /[.!?]["'”)]*$/.test(t.display);

/** Amounts of money, percentages and "N times cheaper": the numbers a viewer should see in big type. */
export function findKeyFigures(tokens: Token[]): Phrase[] {
  const out: Phrase[] = [];
  const phrase = (first: number, last: number) => ({ text: tokens.slice(first, last + 1).map((t) => t.display).join(' ').replace(/[,.;:!?]+$/, ''), first, last });
  for (let i = 0; i < tokens.length; i++) {
    const w = word(tokens[i]);
    const unit = /^(dollars?|percent|cents?)$/.test(w.replace(/[.]+$/, ''));
    const symbol = /[$%]/.test(tokens[i].display) && /\d/.test(tokens[i].display);
    const times = w === 'times' && /^(cheaper|faster|slower|bigger|smaller|more|less|larger|fewer)/.test(word(tokens[i + 1]));
    if (!unit && !symbol && !times) continue;
    if (symbol) { out.push(phrase(i, i)); continue; }
    let first = i;
    while (first > 0 && (isNumber(tokens[first - 1]) || (joins(tokens[first - 1]) && isNumber(tokens[first - 2])))) first--;
    let last = times ? i + 1 : i;
    // "a dollar forty": the number can follow the unit.
    if (first === i && !times) while (last + 1 < tokens.length && isNumber(tokens[last + 1]) && !endsSentence(tokens[last])) last++;
    if (first < i || last > i) out.push(phrase(first, last));
  }
  return out;
}

const MOVES = /\b(go(es)?|went|sent|sends?|flows?|travels?|moves?|arrives?|pass(es|ed)?|routed|routes?|forwards?|triggers?|lands?|handed|hands)\b\s+(\w+\s+)?(into|to|through|onto|in|on|over|along)\b|\btriggers?\b|\bflows?\b/i;

/** Sentences that describe something travelling from one place to another, which the viewer should see move. */
export function findMovements(tokens: Token[]): Movement[] {
  const out: Movement[] = [];
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!endsSentence(tokens[i]) && i < tokens.length - 1) continue;
    const text = tokens.slice(start, i + 1).map((t) => t.display).join(' ');
    const moves = text.match(new RegExp(MOVES.source, 'gi'))?.length ?? 0;
    if (moves) out.push({ text, first: start, last: i, moves });
    start = i + 1;
  }
  return out;
}
