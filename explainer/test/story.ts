/** Vertical story mode: state carries across `continue`, chips validate, wiping or writing on the board is flagged. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate as validateSpec } from '../engine/validate';
import { foldScene } from '../engine/plan';

const board = (id: string, extra: any) => ({ id, kind: 'board', narration: `Say {a} something here now {b} and carry on talking.`, elements: [], steps: [{ at: 'a', do: 'pulse', target: 'chip' }], ...extra });
const base = (scenes: any[]) => ({ id: 'story-test', title: 'T', format: '9:16', theme: 'chalkboard', voice: { provider: 'none' }, scenes });

const first = board('one', {
  elements: [
    { id: 'a-node', type: 'node', icon: 'lucide:cpu', label: 'Router', at: [3, 2] },
    { id: 'b-node', type: 'node', icon: 'lucide:zap', label: 'Expert', at: [3, 5] },
    { id: 'chip', type: 'chip', text: 'Paris', at: [3, 8] },
  ],
  steps: [
    { at: 'a', do: 'show', targets: ['a-node', 'b-node', 'chip'] },
    { at: 'b', do: 'dim', targets: ['a-node'] },
    { at: 'b', do: 'mark', target: 'b-node', kind: 'check' },
    { at: 'b', do: 'highlight', target: 'b-node', color: 'green' },
  ],
});

const good = validateSpec(base([first, board('two', { continue: true, steps: [{ at: 'a', do: 'move', target: 'chip', to: [1.2, 8] }, { at: 'b', do: 'set', target: 'chip', text: 'Paris, France' }] })]) as any);
assert.equal(good.errors.length, 0, JSON.stringify(good.errors));

const two = good.plan!.scenes[1];
const st = foldScene(two, 0);
assert.equal(st.els['a-node'].dimmed, true, 'dim carries into the next scene');
assert.equal(st.els['b-node'].mark?.kind, 'check', 'tick carries');
assert.equal(st.els['b-node'].hl?.color !== undefined, true, 'highlight carries');
assert.equal(st.els['chip'].dimmed, false);
assert(foldScene(two, two.durationInFrames).els['chip'].pos!.x < st.els['chip'].pos!.x, 'chip moved');

// Dimmed parts don't count as clutter; the same parts lit do.
const many = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, type: 'node', icon: 'lucide:zap', label: `N${i}`, at: [1.2 + (i % 2) * 3.6, 0.8 + Math.floor(i / 2) * 2.3] }));
const ids = many.map((m) => m.id);
const clutter = (steps: any[]) => validateSpec(base([board('one', { elements: many, steps })]) as any);
const codes = (r: any) => [...r.errors, ...r.warnings].map((w: any) => w.code);
assert(codes(clutter([{ at: 'a', do: 'show', targets: ids }])).includes('CLUTTER'), 'eight lit is clutter');
assert(!codes(clutter([{ at: 0, do: 'dim', targets: ids.slice(0, 6) }, { at: 0, do: 'show', targets: ids }])).includes('CLUTTER'), 'dimmed parts are not clutter');

// Both examples the writer learns from must pass, and neither choice of visual is penalised.
for (const name of ['story-short', 'mixed-short', 'break-fix-short']) {
  const r = validateSpec(JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8')));
  assert.equal(r.errors.length, 0, name + JSON.stringify(r.errors));
  const bad = r.warnings.filter((w: any) => ['LONG_BOARD', 'TEXT_ALONE', 'TOO_MUCH_TEXT', 'OUT_OF_BOUNDS'].includes(w.code));
  assert.deepEqual(bad, [], name);
}

const textBoard = (id: string, text: string, style = 'headline') => board(id, { elements: [{ id: `${id}-t`, type: 'text', text, style, at: [3, 4.5] }], steps: [{ at: 'a', do: 'show', targets: [`${id}-t`] }] });
const codesOf = (r: any) => [...r.errors, ...r.warnings].map((w: any) => w.code);
// One big line alone is fine; a small label alone is not; mostly words is not.
assert(!codesOf(validateSpec(base([textBoard('one', 'Distance is delay')]) as any)).includes('TEXT_ALONE'));
assert(codesOf(validateSpec(base([textBoard('one', '47B total', 'label')]) as any)).includes('TEXT_ALONE'));
const wordy = validateSpec(base([textBoard('one', 'A'), textBoard('two', 'B'), textBoard('three', 'C')]) as any);
assert(codesOf(wordy).includes('TOO_MUCH_TEXT'));
const cut = textBoard('one', 'A very long line that was cut…');
assert(codesOf(validateSpec(base([cut]) as any)).includes('TEXT_CUT'));
// A chip that never moves, and a tick that gives away the ending, are both flagged; a moving chip is not.
const stages = [{ id: 'a-node', type: 'node', icon: 'lucide:cpu', label: 'A', at: [3, 2] }, { id: 'b-node', type: 'node', icon: 'lucide:zap', label: 'B', at: [3, 6] }, { id: 'link', type: 'arrow', from: 'a-node', to: 'b-node' }];
const still = board('one', { elements: [...stages, { id: 'chip', type: 'chip', text: 'x', at: [5, 9] }], steps: [{ at: 'a', do: 'show', targets: ['a-node', 'b-node', 'link', 'chip'] }, { at: 'b', do: 'mark', target: 'b-node', kind: 'check' }] });
const next = (steps: any[]) => board('two', { continue: true, steps });
assert(codesOf(validateSpec(base([still, next([{ at: 'a', do: 'pulse', target: 'chip' }])]) as any)).includes('CHIP_STILL'));
assert(!codesOf(validateSpec(base([still, next([{ at: 'a', do: 'move', target: 'chip', to: [5, 8] }])]) as any)).includes('CHIP_STILL'));
assert(codesOf(validateSpec(base([still, next([{ at: 'a', do: 'flow', path: ['link'] }])]) as any)).includes('TICK_EARLY'));
assert(!codesOf(validateSpec(base([still, next([{ at: 'a', do: 'unmark', target: 'b-node' }, { at: 'b', do: 'flow', path: ['link'] }])]) as any)).includes('TICK_EARLY'));
// Strike stays and carries across scenes; a stamp may overlap the diagram; a second stamp is flagged.
const struck = board('one', { elements: stages, steps: [{ at: 'a', do: 'show', targets: ['a-node', 'b-node', 'link'] }, { at: 'b', do: 'strike', target: 'a-node' }] });
const sr: any = validateSpec(base([struck, board('two', { continue: true, steps: [{ at: 'a', do: 'pulse', target: 'a-node' }] })]) as any);
assert.equal(sr.errors.length, 0, JSON.stringify(sr.errors));
assert.notEqual(foldScene(sr.plan.scenes[1], 0).els['a-node'].struckAt, null, 'strike carries');
const cleared: any = validateSpec(base([struck, board('two', { continue: true, steps: [{ at: 'a', do: 'unstrike', target: 'a-node' }] })]) as any);
assert.equal(foldScene(cleared.plan.scenes[1], cleared.plan.scenes[1].durationInFrames).els['a-node'].struckAt, null, 'unstrike clears it');
const stamp = (id: string) => ({ id, type: 'text', text: 'Nope', style: 'stamp', at: [3, 2] });
const one: any = validateSpec(base([board('one', { elements: [...stages, stamp('s1')], steps: [{ at: 'a', do: 'show', targets: ['a-node', 's1'] }] })]) as any);
assert(!codesOf(one).includes('OVERLAP'), 'a stamp may sit over the diagram');
assert(!codesOf(one).includes('TOO_MANY_STAMPS'));
const twoStamps: any = validateSpec(base([board('one', { elements: [stamp('s1'), stamp('s2')], steps: [{ at: 'a', do: 'show', targets: ['s1'] }, { at: 'b', do: 'hide', targets: ['s1'] }, { at: 'b+0.5', do: 'show', targets: ['s2'] }] })]) as any);
assert(codesOf(twoStamps).includes('TOO_MANY_STAMPS'));
const long: any = validateSpec(base([board('one', { elements: [{ ...stamp('s1'), text: 'Far too many letters here' }], steps: [{ at: 'a', do: 'show', targets: ['s1'] }] })]) as any);
assert(codesOf(long).includes('TEXT_TOO_LONG') || long.errors.length > 0 || long.warnings.length > 0);
// A stamp clears itself about 2 s after landing, unless the writer hides it.
const landed: any = validateSpec(base([board('one', { elements: [stamp('s1')], steps: [{ at: 0, do: 'show', targets: ['s1'] }] })]) as any);
const sc0 = landed.plan.scenes[0];
const firstShow = sc0.actions.find((a: any) => a.do === 'show').frame;
assert.equal(foldScene(sc0, firstShow + 30).els.s1.visible, true, 'stamp still up after 1 s');
assert.equal(foldScene(sc0, firstShow + 90).els.s1.visible, false, 'stamp gone after 3 s');
console.log('story: ok');

// The beginner read's limits are enforced in code, not left to the reader's judgement.
{
  const { plainProblems } = await import('../pipeline/plain-check');
  const scene = (scene: string, verdict = 'clear', carriedBy = 'running-example') => ({ scene, retelling: 'x', picture: 'y', carriedBy, verdict });
  const clean = { terms: [{ scene: 'a', term: 'cache', explainedAs: 'the desk', verdict: 'explained' }], scenes: [scene('t', 'clear', 'none'), scene('a'), scene('b')], soWhat: 'My app feels faster.' };
  assert.deepEqual(plainProblems(clean, 120), []);
  const term = (t: string, verdict = 'explained') => ({ scene: 'a', term: t, explainedAs: 'y', verdict });
  assert.equal(plainProblems({ ...clean, terms: [term('loop', 'unexplained')] }, 120).length, 1, 'unexplained term');
  assert.equal(plainProblems({ ...clean, terms: ['a', 'b', 'c', 'd', 'e'].map((t) => term(t)) }, 120).length, 1, 'too many terms for the length');
  assert.equal(plainProblems({ ...clean, scenes: [scene('t'), scene('a', 'abstract'), scene('b', 'lost')] }, 120).length, 2, 'unclear scenes');
  assert.equal(plainProblems({ ...clean, scenes: [scene('t', 'clear', 'none'), scene('a', 'clear', 'none'), scene('b')] }, 120).length, 1, 'example dropped');
  assert.equal(plainProblems({ ...clean, soWhat: 'none' }, 120).length, 1, 'no reason to care');
  assert.deepEqual(plainProblems({ ...clean, terms: [term('iceberg model', 'unexplained')] }, 120, 'the jam is only the surface'), [], 'a scene name is not a term the viewer heard');
}

// A fact-check answer with lists sent as JSON strings must still be read, not crash the step.
{
  const { asList, auditProblems } = await import('../pipeline/fact-check');
  assert.equal(asList('[{"severity":"major"}]').length, 1);
  assert.equal(asList('not json').length, 0);
  assert.equal(auditProblems('[{"verdict":"unsupported","scene":"a","quote":"q","scope":"s","claim":"none"}]').length, 1);
}
