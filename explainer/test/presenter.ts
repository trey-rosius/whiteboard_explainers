/** The narrator's face: its video follows the edited audio, fills each scene, and the board keeps its corner clear. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keptSegments } from '../engine/narration';
import { presenterPieces } from '../remotion/presenter';
import { validate } from '../engine/validate';
import { autofixLayout } from '../engine/autofix';

// Cuts come out of the take; what's left plays back to back.
assert.deepEqual(keptSegments([], 10), [{ from: 0, to: 10 }]);
assert.deepEqual(keptSegments([{ from: 6, to: 7 }, { from: 2, to: 3.5 }], 10), [{ from: 0, to: 2 }, { from: 3.5, to: 6 }, { from: 7, to: 10 }]);
assert.deepEqual(keptSegments([{ from: 0, to: 1 }, { from: 9, to: 12 }], 10), [{ from: 1, to: 9 }]);

// Video seconds → scene frames at 30 fps. Speech starts 0.5 s into the video; narration starts 6 frames into the scene.
const p = { src: 'x.mp4', startFrame: 6, seconds: 12, segments: [{ from: 0.5, to: 2.5 }, { from: 4, to: 6 }] };
const pieces = presenterPieces(p, 150, 30);
assert.deepEqual(pieces[0], { at: 0, frames: 66, from: 9 }, 'lead-in plays the 6 frames before the first word, then the first stretch');
assert.deepEqual(pieces[1].at, 66);
assert.equal(pieces[1].from, 120);
const covered = pieces.reduce((n, x) => n + x.frames, 0);
assert.equal(covered, 150, 'every frame of the scene shows the face');
assert.ok(pieces.every((x, i) => i === 0 || x.at === pieces[i - 1].at + pieces[i - 1].frames), 'pieces are back to back');
assert.ok(pieces.at(-1)!.from + pieces.at(-1)!.frames <= 12 * 30, 'never runs past the end of the video');
// No video before the first word: hold the first frame instead.
const tight = presenterPieces({ ...p, segments: [{ from: 0, to: 2 }] }, 90, 30);
assert.deepEqual(tight[0], { at: 0, frames: 6, from: 0, hold: true });
// Video too short for the scene: the last frame holds.
const short = presenterPieces({ ...p, seconds: 2.6, segments: [{ from: 0.5, to: 2.5 }] }, 150, 30);
assert.ok(short.at(-1)!.hold && short.reduce((n, x) => n + x.frames, 0) === 150);

// The board keeps the corner clear when the face is shown.
const spec = JSON.parse(readFileSync('explainer/examples/database-sharding.json', 'utf8'));
assert.equal(validate(spec).errors.filter((e) => e.code === 'OUT_OF_BOUNDS').length, 0);
const scene = spec.scenes.find((s: any) => s.kind === 'board');
scene.elements.push({ id: 'corner-note', type: 'server', label: 'Corner', at: [11.3, 5.1], size: 's' });
scene.steps.push({ at: scene.steps[0].at, do: 'show', targets: ['corner-note'] });
assert.equal(validate(spec).errors.filter((e) => e.ids?.includes('corner-note')).length, 0, 'fine without a face');
const withFace = { ...spec, presenter: true };
const hit = validate(withFace).errors.find((e) => e.ids?.includes('corner-note'));
assert.ok(hit && hit.code === 'OUT_OF_BOUNDS' && /face/.test(hit.message), 'flags an element in the face corner');
const fixed = autofixLayout(withFace);
assert.equal(validate(fixed.spec).errors.filter((e) => e.ids?.includes('corner-note')).length, 0, 'auto-layout moves it out');
console.log('presenter: ok');
