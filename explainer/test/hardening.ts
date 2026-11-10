/** Each broken spec must be rejected with the expected error code. */
import { validate } from '../engine/validate';
import { resolveIcon } from '../node/icons';
const base = (scene: any) => ({ id: 't', title: 't', voice: { provider: 'none' }, scenes: [{ id: 's', kind: 'board', heading: 'H', ...scene }] });
const a = { id: 'a', type: 'server', label: 'A', at: [3, 3] };
const b = { id: 'b', type: 'db', label: 'B', at: [9, 3] };
const ab = { id: 'ab', type: 'arrow', from: 'a', to: 'b' };
const cases: Array<[string, any]> = [
  ['OVERLAP', base({ narration: 'x {go} y', elements: [a, { ...b, at: [3.4, 3] }], steps: [{ at: 'go', do: 'show', targets: ['a', 'b'] }] })],
  ['OUT_OF_BOUNDS', base({ narration: 'x {go} y', elements: [{ ...a, at: [0, 0] }], steps: [{ at: 'go', do: 'show', targets: ['a'] }] })],
  ['UNKNOWN_CUE', base({ narration: 'x {go} y', elements: [a], steps: [{ at: 'gone', do: 'show', targets: ['a'] }] })],
  ['ARROW_DANGLING', base({ narration: 'x {go} y', elements: [a, b, ab], steps: [{ at: 'go', do: 'show', targets: ['a', 'ab'] }] })],
  ['FLOW_HIDDEN', base({ narration: 'x {go} y {f} z', elements: [a, b, ab], steps: [{ at: 'go', do: 'show', targets: ['a', 'b'] }, { at: 'f', do: 'flow', path: ['ab'] }] })],
  ['TARGET_HIDDEN', base({ narration: 'x {go} y', elements: [a], steps: [{ at: 'go', do: 'highlight', target: 'a' }] })],
  ['BAD_REF', base({ narration: 'x {go} y', elements: [a], steps: [{ at: 'go', do: 'show', targets: ['nope'] }] })],
  ['TEXT_TOO_LONG', base({ narration: 'x {go} y', elements: [{ ...a, label: 'An extremely long label that will not fit' }], steps: [{ at: 'go', do: 'show', targets: ['a'] }] })],
  ['ICON_UNKNOWN', base({ narration: 'x {go} y', elements: [{ id: 'n', type: 'node', icon: 'lucide:not-a-real-icon', label: 'N', at: [6, 3] }], steps: [{ at: 'go', do: 'show', targets: ['n'] }] })],
  ['DEAD_AIR', base({ narration: `{go} ${'word '.repeat(60)}end.`, elements: [a], steps: [{ at: 'go', do: 'show', targets: ['a'] }] })],
  ['SCHEMA_UNRECOGNIZED_KEYS', base({ narration: 'x {go} y', elements: [{ ...a, x: 100 }], steps: [{ at: 'go', do: 'show', targets: ['a'] }] })],
  ['SCHEMA_INVALID_UNION_DISCRIMINATOR', base({ narration: 'x {go} y', elements: [a], steps: [{ at: 'go', do: 'explode', target: 'a' }] })],
  ['FLOW_GAP', base({ narration: 'x {go} y {f} z', elements: [a, b, { ...b, id: 'c', at: [9, 1] }, ab, { id: 'ca', type: 'arrow', from: 'c', to: 'a' }], steps: [{ at: 'go', do: 'show', targets: ['a', 'b', 'c', 'ab', 'ca'] }, { at: 'f', do: 'flow', path: ['ab', 'ca'] }] })],
  ['BAD_REF', base({ narration: 'x {go} y', elements: [a, { id: 'm1', type: 'marker', ring: 'a', angle: 10, label: 'M' }], steps: [{ at: 'go', do: 'show', targets: ['a', 'm1'] }] })],
  ['TRAVEL_RING', base({ narration: 'x {go} y {t} z', elements: [{ id: 'r1', type: 'ring', at: [3.2, 3] }, { id: 'r2', type: 'ring', size: 's', at: [9.5, 3] }, { id: 'k', type: 'marker', ring: 'r1', angle: 10, kind: 'key' }, { id: 's', type: 'marker', ring: 'r2', angle: 90 }], steps: [{ at: 'go', do: 'show', targets: ['r1', 'r2', 'k', 's'] }, { at: 't', do: 'travel', target: 'k', to: 's' }] })],
  ['BAD_TARGET_TYPE', base({ narration: 'x {go} y {m} z', elements: [{ id: 'r1', type: 'ring', at: [6, 3] }], steps: [{ at: 'go', do: 'show', targets: ['r1'] }, { at: 'm', do: 'move', target: 'r1', to: [5, 3] }] })],
  ['DURATION', { ...base({ narration: 'x {go} y', elements: [a], steps: [{ at: 'go', do: 'show', targets: ['a'] }] }), targetSeconds: 120 }],
];
let fail = 0;
for (const [code, spec] of cases) {
  const r = validate(spec, { resolveIcon });
  const hit = [...r.errors].some((e) => e.code === code);
  console.log(`${hit ? '✔' : '✖'} rejects ${code}`);
  if (!hit) { fail++; console.log('   got:', [...r.errors, ...r.warnings].map((e) => e.code).join(', ') || 'nothing'); }
}
// auto-layout must resolve a plain overlap without touching narration or steps
import('../engine/autofix').then(({ autofixLayout }) => {
  const broken = base({ narration: 'x {go} y', elements: [a, { ...b, at: [3.4, 3] }], steps: [{ at: 'go', do: 'show', targets: ['a', 'b'] }] });
  const r = autofixLayout(broken, { resolveIcon });
  const ok = r.remaining === 0 && validate(r.spec, { resolveIcon }).ok && JSON.stringify(r.spec.scenes[0].steps) === JSON.stringify(broken.scenes[0].steps);
  console.log(`${ok ? '✔' : '✖'} auto-layout resolves OVERLAP (${r.changes.join('; ')})`);
  process.exit(fail || !ok ? 1 : 0);
});
