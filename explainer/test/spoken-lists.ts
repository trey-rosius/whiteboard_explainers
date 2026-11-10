/** Spoken-list detection and the validator check built on it. Run: npx tsx explainer/test/spoken-lists.ts */
import { parseNarration } from '../engine/narration';
import { findSpokenLists } from '../engine/spoken-lists';
import { validate } from '../engine/validate';
let fails = 0;
const ok = (c: unknown, l: string, x = '') => { console.log(`${c ? '✔' : '✖'} ${l}${x ? ` — ${x}` : ''}`); if (!c) fails++; };
const lists = (t: string) => findSpokenLists(parseNarration(t).tokens).map((l) => l.items.map((i) => i.text));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

ok(same(lists('Phase one is Inception: the AI turns business intent into requirements, user stories, and acceptance criteria.')[0], ['requirements', 'user stories', 'acceptance criteria']), 'list at the end of a sentence', JSON.stringify(lists('Phase one is Inception: the AI turns business intent into requirements, user stories, and acceptance criteria.')[0]));
ok(lists('It generates {a} domain models, {b} writes the code, and {c} produces a test suite covering the criteria.')[0]?.length === 3, 'list of actions, with cues in the text');
ok(same(lists('Three phases — Inception, Construction, and Operations — replace the old way.')[0], ['Inception', 'Construction', 'Operations']), 'list between dashes');
ok(same(lists('You need flour, eggs and milk.')[0], ['flour', 'eggs', 'milk']), 'no comma before "and"');
for (const not of [
  'In Construction, the AI reads the approved requirements from the repository and proposes an architecture.',
  'Bolts replace sprints, and mob sessions replace solo coding and review.',
  'AI and humans work together.',
  'Coding and review become Mob Construction, a collaborative session where AI and humans build side by side.',
  'Everyone in the room, AI and humans together, refining until the stories are sharp.',
  'Still, AWS open-sourced the workflow rules in November at the labs site, making it neutral and available for any team to try.',
  'The core loop is: AI plans, humans validate, AI executes, humans verify — and the cycle repeats.',
]) ok(lists(not).length === 0, 'not a list', not.slice(0, 60));

const spec = (narration: string, elements: any[], steps: any[]) => ({ id: 't', title: 'Test', format: '16:9', voice: { provider: 'none' }, scenes: [{ id: 'one', kind: 'board', heading: 'H', narration, elements, steps }] });
const flagged = (s: any) => { const r = validate(s, {}); return r.warnings.filter((w) => w.code === 'SPOKEN_LIST_UNSEEN'); };
const node = (id: string, label: string, x: number) => ({ id, type: 'node', icon: 'lucide:bot', label, at: [x, 3] });
const text = 'The agent {a} drafts requirements, {b} user stories, and {c} acceptance criteria today.';
const seen = spec(text, [node('n1', 'Requirements', 2), node('n2', 'User stories', 6), node('n3', 'Acceptance criteria', 10)], [{ at: 'a', do: 'show', targets: ['n1'] }, { at: 'b', do: 'show', targets: ['n2'] }, { at: 'c', do: 'show', targets: ['n3'] }]);
ok(flagged(seen).length === 0, 'each item shown on its cue: not flagged');
const squeezed = spec(text, [{ ...node('n1', 'AI Agent', 6), sub: 'drafts artifacts' }], [{ at: 'a', do: 'show', targets: ['n1'] }, { at: 'b', do: 'pulse', target: 'n1' }, { at: 'c', do: 'pulse', target: 'n1' }]);
const f = flagged(squeezed);
ok(f.length === 1 && /requirements/i.test(f[0].message), 'one vague label and pulses: flagged', f[0]?.message.slice(0, 110));
const partial = spec(text, [{ ...node('n1', 'Requirements', 6), sub: 'and stories' }], [{ at: 'a', do: 'show', targets: ['n1'] }, { at: 'b', do: 'pulse', target: 'n1' }, { at: 'c', do: 'pulse', target: 'n1' }]);
ok(flagged(partial).length === 1 && /but "acceptance criteria/.test(flagged(partial)[0].message) && !/never appears.*"requirements/i.test(flagged(partial)[0].message), 'one dropped item: named exactly', flagged(partial)[0]?.message.split('but ')[1]?.slice(0, 60));
const cleared = spec(text + ' Next {d} something else entirely arrives on the board.', [node('n1', 'Requirements', 2), node('n2', 'User stories', 6), node('n3', 'Acceptance criteria', 10), node('n4', 'Other', 6)], [{ at: 'a', do: 'show', targets: ['n1'] }, { at: 'b', do: 'show', targets: ['n2'] }, { at: 'c', do: 'show', targets: ['n3'] }, { at: 'd', do: 'hide', targets: ['n1', 'n2', 'n3'] }, { at: 'd', do: 'show', targets: ['n4'] }]);
ok(flagged(cleared).length === 0, 'cleared right after it was said: not flagged');
const late = spec(text + ' Then we wait a very long while before anything else happens on the board here at all, and then finally {d} we draw them.', [node('n1', 'Requirements', 2), node('n2', 'User stories', 6), node('n3', 'Acceptance criteria', 10)], [{ at: 'a', do: 'show', targets: ['n1'] }, { at: 'd', do: 'show', targets: ['n2', 'n3'] }]);
ok(flagged(late).length === 1, 'shown long after it was said: flagged');
console.log(fails ? `\n✖ ${fails} failed` : '\n✔ spoken-list checks passed');
process.exit(fails ? 1 : 0);
