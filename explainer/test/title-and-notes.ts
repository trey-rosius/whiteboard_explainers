/** Every title design fits every format and stays readable; openings stay short; notes get moved off arrows. */
import { autoTitleStyle, bandColors, capTitleNarration, contrast, keywordIndex, monogramOf, titleLayout, titleSafe, TITLE_STYLES } from '../engine/title';
import { arrowLabelRect, arrowLabelSide, FRAME, footprint, gridToPx, intersection, OVERLAY_TEXT, PHONE_TEXT, type Format } from '../engine/layout';
import { THEMES } from '../engine/theme';
import { THEME_IDS } from '../engine/theme-list';
import { validate } from '../engine/validate';
import { autofixLayout } from '../engine/autofix';

let fails = 0;
const ok = (cond: unknown, label: string) => { if (!cond) { fails++; console.log(`✖ ${label}`); } };
const titles = ['Caching', 'DNS TTL: What It Is and Why It Matters', 'What Happens When You Message an AI Chatbot now', 'Internationalization Considerations Everywhere', 'How to Make a Double Cheese Hamburger at Home!!'];
for (const format of ['9:16', '16:9'] as Format[]) {
  const safe = titleSafe(format);
  for (const style of TITLE_STYLES) for (const title of titles) {
    for (const extra of [{}, { kicker: 'Cloud and AI series', subtitle: 'The timer hiding inside every DNS record, and what it costs you when you change one' }]) {
      const l = titleLayout(style, { title, ...extra }, format);
      const tag = `${format} ${style} "${title.slice(0, 20)}"${'kicker' in extra ? ' +extras' : ''}`;
      ok(l.top >= safe.y - 1 && l.bottom <= safe.y + safe.h + 1, `${tag}: stack ${Math.round(l.top)}–${Math.round(l.bottom)} leaves the safe area ${safe.y}–${safe.y + safe.h}`);
      ok(l.maxLineW <= FRAME[format].w - 60, `${tag}: line is ${Math.round(l.maxLineW)}px wide`);
      if (l.panel && style === 'stamp') ok(l.panel.x >= 20 && l.panel.x + l.panel.w <= FRAME[format].w - 20, `${tag}: frame leaves the screen`);
      if (l.ghost) { ok(l.ghost.y >= safe.y - 1, `${tag}: letters hit the logo`); ok(l.ghost.y + l.ghost.size * 1.02 <= (l.kickerTop ?? l.blockTop), `${tag}: letters reach the text`); }
      if (l.lines.length > 1) { const w = l.lines.map((x) => x.length); ok(!(w[w.length - 1] <= 4 && Math.max(...w) > 14 && title.split(' ').length > 3), `${tag}: stranded word "${l.lines[l.lines.length - 1]}"`); }
    }
  }
}
for (const id of THEME_IDS) for (const title of titles) {
  const { band, text } = bandColors(THEMES[id], title);
  ok(contrast(band, text) >= 4.5, `${id}: band text ${contrast(band, text).toFixed(1)}:1 on ${band}`);
}
const seen = new Set(titles.concat(['Kafka', 'S3 buckets', 'How CDNs work', 'Lambda cold starts', 'What is a VPC?', 'Vector databases', 'Prompt caching', 'IAM roles']).map((t) => autoTitleStyle(t, true)));
ok(seen.size >= 4, `auto designs too samey: ${[...seen]}`);
ok(!seen.has('classic'), 'auto picked classic');
ok(autoTitleStyle('x', false) !== 'hero' && !titles.map((t) => autoTitleStyle(t, false)).includes('hero'), 'hero picked without an icon');
ok(monogramOf('DNS TTL: What It Is') === 'DNS', `monogram ${monogramOf('DNS TTL: What It Is')}`);
ok(monogramOf('How Vector Databases Work') === 'D', `monogram ${monogramOf('How Vector Databases Work')}`);
ok(autoTitleStyle('How Vector Databases Work', true) !== 'monogram' && !['Kafka', 'Prompt caching', 'Lambda cold starts'].map((t) => autoTitleStyle(t, true)).includes('monogram'), 'monogram picked without an acronym');
ok('DNS TTL: x'.split(' ')[keywordIndex('DNS TTL: x')] === 'DNS', 'keyword');

// Openings: the real one that ran 13.7 s, a good one, and a title that is itself a question.
const T = 'DNS TTL: What It Is and Why It Matters';
ok(capTitleNarration(`${T}. DNS TTL — the hidden timer that controls how long the internet caches your records.`, T) === `${T}.`, 'repeating hook not dropped');
ok(capTitleNarration(`${T}. It decides how fast your changes go live.`, T) === `${T}. It decides how fast your changes go live.`, 'short hook dropped');
ok(capTitleNarration(`What is a VPC? Your own private corner of the cloud. And many more words follow.`, 'What is a VPC?') === 'What is a VPC? Your own private corner of the cloud.', 'question title');
ok(capTitleNarration(`${T}.`, T) === `${T}.`, 'title only changed');

// The two real cases: a note on an arrow's path, and a note jammed against a label.
const scene = (note: [number, number]) => ({ id: 's', kind: 'board', heading: 'h', narration: 'One {a} two {b} three {c} four five six seven eight nine ten.', elements: [
  { id: 'r', type: 'server', label: 'Resolver', sub: 'cache', at: [0.75, 4.5], size: 'l' }, { id: 'd', type: 'db', label: 'Auth', at: [3, 7.8] },
  { id: 'x', type: 'arrow', from: 'r', to: 'd' }, { id: 'n', type: 'note', text: 'TTL = 300 s → cached 5 min', at: note },
], steps: [{ at: 'a', do: 'show', targets: ['r', 'd', 'x'] }, { at: 'b', do: 'show', targets: ['n'] }] });
const spec = { id: 't', title: 't', format: '9:16', voice: { provider: 'none' }, scenes: [scene([3, 6.2])] };
const codes = (s: any) => validate(s).warnings.filter((w) => ['ARROW_THROUGH', 'NOTE_CROWDED'].includes(w.code)).map((w) => w.code);
ok(codes(spec).length > 0, 'bad note not flagged');
// A tall stack with its note in the middle: the only free space is far from where the note started.
const far = { id: 'f', title: 'f', format: '9:16', voice: { provider: 'none' }, scenes: [{ id: 's', kind: 'board', heading: 'h', narration: 'One {a} two {b} three four five six seven.', elements: [
  { id: 'm', type: 'server', label: 'Model', at: [3, 2.5], size: 'l' }, { id: 'c', type: 'client', variant: 'phone', label: 'App', at: [3, 7.2], size: 'l' },
  { id: 'x', type: 'arrow', from: 'm', to: 'c' }, { id: 'n', type: 'note', text: '500 tokens → 500 rounds', at: [3, 5.5], size: 's' },
], steps: [{ at: 'a', do: 'show', targets: ['m', 'c', 'x'] }, { at: 'b', do: 'show', targets: ['n'] }] }] };
ok(codes(far).length > 0, 'stacked note not flagged');
ok(codes(autofixLayout(far).spec).length === 0, 'stacked note not moved to free space');
const fixed = autofixLayout(spec);
ok(codes(fixed.spec).length === 0, `note not cleared: ${codes(fixed.spec)}`);
ok(validate(fixed.spec).errors.length === 0, 'moving the note broke the scene');
ok(JSON.stringify(fixed.spec.scenes[0].narration) === JSON.stringify(spec.scenes[0].narration), 'narration changed');

// Two labelled arrows between the same pair: labels apart, and a note keeps clear of both.
const mk = (id: string, from: string, to: string, label: string) => ({ id, spec: { type: 'arrow', from, to, label } });
const down = mk('a', 'm', 'c', 'token'), up = mk('b', 'c', 'm', 'adds it');
const geo = { p0: { x: 500, y: 700 }, c: { x: 500, y: 760 }, p1: { x: 500, y: 820 }, mid: { x: 500, y: 760 }, length: 120 };
ok(arrowLabelSide(down, [down, up]) === -1 && arrowLabelSide(up, [down, up]) === 1 && arrowLabelSide(down, [down]) === 0, 'label sides');
ok(intersection(arrowLabelRect('token', geo, '9:16', -1), arrowLabelRect('adds it', geo, '9:16', 1)) === 0, 'paired labels still touch');

// Phones: even the smallest size of every element stays readable.
const small = { size: 's', __scale: 1.3 };
const samples: any[] = [
  { type: 'node', icon: 'x', label: 'Node', sub: 'sub' }, { type: 'server', label: 'Server', sub: 'sub' }, { type: 'db', label: 'DB', sub: 'sub' }, { type: 'client', label: 'Client', sub: 'sub' },
  { type: 'text', text: '10.0.0.0/16', style: 'label' }, { type: 'note', text: 'A short note' }, { type: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] }, { type: 'code', lines: ['x = 1'] },
  { type: 'bars', bars: [{ label: 'a', value: 1 }] }, { type: 'list', items: ['one'] },
];
for (const el of samples) {
  let g: any; try { g = footprint({ ...el, ...small, id: 'x' }, gridToPx('9:16', [3, 5])); } catch (e) { ok(false, `${el.type} sample: ${e}`); continue; }
  const sizes = { label: g.label?.labelSize, sub: g.label?.subSize, font: g.m?.font, size: g.m?.size };
  for (const [k, v] of Object.entries(sizes)) if (typeof v === 'number') ok(v >= PHONE_TEXT.body, `${el.type} ${k} is only ${Math.round(v as number)}px on a phone`);
  if (g.label) ok(g.label.labelSize >= PHONE_TEXT.label, `${el.type} label is ${Math.round(g.label.labelSize)}px`);
}
for (const [k, v] of Object.entries(OVERLAY_TEXT['9:16'])) ok(v >= PHONE_TEXT.body, `${k} overlay text is only ${v}px on a phone`);

console.log(fails ? `\n✖ ${fails} title/note check(s) failed` : '\n✔ title designs fit and read in every theme; openings stay short; notes clear arrows');
process.exit(fails ? 1 : 0);
