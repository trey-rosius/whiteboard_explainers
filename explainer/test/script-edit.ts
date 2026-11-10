/** Script editor rules: only words change, {cue} markers survive, values keep their type, and the result still validates. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyScriptEdits, cuesOf, editableScenes } from '../engine/script-edit';
import { validate } from '../engine/validate';

const spec = JSON.parse(readFileSync('explainer/examples/database-sharding.json', 'utf8'));
const scenes = editableScenes(spec);
assert.equal(scenes.length, spec.scenes.length);
const board = scenes.find((s) => s.cues.length >= 2)!;
assert.ok(board, 'example has a board scene with cues');
assert.ok(scenes.every((s) => s.fields.every((f) => !/\.(icon|id|color|at|type|from|to)$/.test(f.path))), 'only text is offered');

// Rewording keeps every marker: saved, marked as needing a new recording, still valid.
const reworded = `Well, ${board.narration}`;
let r = applyScriptEdits(spec, [{ id: board.id, narration: reworded }]);
assert.deepEqual(r.problems, []);
assert.deepEqual(r.respoken, [board.id]);
assert.deepEqual(cuesOf(r.spec.scenes.find((s: any) => s.id === board.id).narration), board.cues);
assert.ok(validate(r.spec).ok, 'reworded spec validates');
assert.notEqual(spec.scenes.find((s: any) => s.id === board.id).narration, reworded, 'input spec is not mutated');

// Lost, invented and reordered markers are refused.
const first = board.cues[0], second = board.cues[1];
assert.match(applyScriptEdits(spec, [{ id: board.id, narration: board.narration!.replace(`{${first}}`, '') }]).problems[0], /put back the marker/);
assert.match(applyScriptEdits(spec, [{ id: board.id, narration: `${board.narration} {made-up}` }]).problems[0], /not a marker/);
const swapped = board.narration!.replace(`{${first}}`, '\u0001').replace(`{${second}}`, `{${first}}`).replace('\u0001', `{${second}}`);
assert.match(applyScriptEdits(spec, [{ id: board.id, narration: swapped }]).problems[0], /original order/);

// Moving a cue's surrounding words is fine; only spoken words decide whether to re-record.
r = applyScriptEdits(spec, [{ id: board.id, narration: board.narration!.replace(/\s+/g, '  ') }]);
assert.deepEqual(r.problems, []);
assert.deepEqual(r.respoken, []);

// On-screen text: same type only, never structure.
const label = board.fields.find((f) => typeof f.value === 'string' && f.name === 'label') ?? board.fields.find((f) => typeof f.value === 'string')!;
r = applyScriptEdits(spec, [{ id: board.id, fields: [{ path: label.path, value: '  New   words ' }] }]);
assert.deepEqual(r.problems, []);
assert.equal(label.path.split('.').reduce((o: any, k) => o[/^\d+$/.test(k) ? Number(k) : k], r.spec.scenes.find((s: any) => s.id === board.id)), 'New words');
assert.match(applyScriptEdits(spec, [{ id: board.id, fields: [{ path: 'elements.0.icon', value: 'x' }] }]).problems[0], /can't be edited/);
assert.match(applyScriptEdits(spec, [{ id: board.id, fields: [{ path: label.path, value: '' }] }]).problems[0], /can't be empty/);
assert.match(applyScriptEdits(spec, [{ id: 'nope', narration: 'hi' }]).problems[0], /not part of this script/);
const num = scenes.flatMap((s) => s.fields.map((f) => ({ s, f }))).find((x) => typeof x.f.value === 'number');
if (num) assert.match(applyScriptEdits(spec, [{ id: num.s.id, fields: [{ path: num.f.path, value: 'lots' }] }]).problems[0], /number/);

console.log('script-edit: ok');
