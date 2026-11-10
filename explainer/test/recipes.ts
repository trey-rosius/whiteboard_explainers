/** Proves every layout recipe in references/visual-grammar.md passes the validator. */
import { validate, formatIssues } from '../engine/validate';
const mk = (format: '16:9' | '9:16', elements: any[]) => ({
  id: 'recipe', title: 't', format, voice: { provider: 'none' },
  scenes: [{ id: 's', kind: 'board', heading: 'Recipe check', narration: 'Here {go} is everything.',
    elements, steps: [{ at: 'go', do: 'show', targets: elements.map((e) => e.id) }] }],
});
const db = (id: string, at: number[], label = 'Database') => ({ id, type: 'db', label, at });
const sv = (id: string, at: number[], label = 'App server') => ({ id, type: 'server', label, at });
const cl = (id: string, at: number[]) => ({ id, type: 'client', variant: 'laptop', label: 'Client', at });
const nd = (id: string, at: number[], label = 'Service') => ({ id, type: 'node', icon: 'lucide:box', label, at });
const ar = (id: string, from: string, to: string, bend?: number) => ({ id, type: 'arrow', from, to, ...(bend ? { bend } : {}) });
const R: Record<string, any> = {
  pipeline3: mk('16:9', [cl('a', [1.6, 3]), sv('b', [6, 3]), db('c', [10.4, 3]), ar('x', 'a', 'b'), ar('y', 'b', 'c')]),
  pipeline4: mk('16:9', [cl('a', [1.5, 3]), nd('b', [4.5, 3]), sv('c', [7.5, 3]), db('d', [10.5, 3]), ar('x', 'a', 'b'), ar('y', 'b', 'c'), ar('z', 'c', 'd')]),
  sideLookup: mk('16:9', [cl('a', [1.6, 3]), sv('b', [6, 3]), nd('c', [6, 0.9], 'Redis cache'), db('d', [10.4, 3]), ar('x', 'a', 'b'), ar('y', 'b', 'c'), ar('z', 'b', 'd')]),
  fanOutRight: mk('16:9', [nd('s', [2, 3], 'Load balancer'), sv('t1', [9, 1.1]), sv('t2', [9, 3]), sv('t3', [9, 4.9]), ar('a', 's', 't1'), ar('b', 's', 't2'), ar('c', 's', 't3')]),
  fanOutDown: mk('16:9', [db('s', [6, 1.6]), db('t1', [2.5, 4.4]), db('t2', [6, 4.4]), db('t3', [9.5, 4.4]), ar('a', 's', 't1'), ar('b', 's', 't2'), ar('c', 's', 't3')]),
  hub: mk('16:9', [nd('h', [6, 3], 'Event bus'), nd('a', [2, 1.2]), nd('b', [10, 1.2]), nd('c', [2, 4.8]), nd('d', [10, 4.8]), ar('w', 'h', 'a'), ar('x', 'h', 'b'), ar('y', 'h', 'c'), ar('z', 'h', 'd')]),
  layers: mk('16:9', [cl('a', [6, 0.7]), sv('b', [6, 2.8]), db('c', [6, 4.9]), ar('x', 'a', 'b'), ar('y', 'b', 'c')]),
  ringCenter: mk('16:9', [{ id: 'r', type: 'ring', label: 'Hash ring', at: [6, 3.1] }, ...[0, 90, 180, 270].map((ang, i) => ({ id: `s${i}`, type: 'marker', ring: 'r', angle: ang, label: `Server ${'ABCD'[i]}` }))]),
  ringWithSide: mk('16:9', [{ id: 'r', type: 'ring', label: 'Hash ring', at: [4.6, 3.1] }, ...[30, 150, 265].map((ang, i) => ({ id: `s${i}`, type: 'marker', ring: 'r', angle: ang, label: `Server ${'ABC'[i]}` })), { id: 'n', type: 'note', text: 'Owner = first server clockwise', at: [10, 1.6] }, { id: 'c', type: 'code', lines: ['owner = next_cw(hash(k))'], at: [10, 4.6] }]),
  vertical: mk('9:16', [cl('a', [3, 1.5]), sv('b1', [1.2, 5]), sv('b2', [3, 5]), sv('b3', [4.8, 5]), db('c', [3, 8.6]), ar('x', 'a', 'b1'), ar('y', 'a', 'b2'), ar('z', 'a', 'b3')]),
};
let bad = 0;
for (const [name, spec] of Object.entries(R)) {
  const r = validate(spec);
  const issues = [...r.errors, ...r.warnings].filter((i) => i.code !== 'LATE_START');
  console.log(`${issues.length ? '✖' : '✔'} ${name}`);
  if (issues.length) { bad++; console.log(formatIssues(r)); }
}
process.exit(bad ? 1 : 0);
