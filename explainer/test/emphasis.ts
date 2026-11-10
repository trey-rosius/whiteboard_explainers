/** Key figures and movements in the narration: found reliably, and the validator insists they are shown plainly. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNarration } from '../engine/narration';
import { findKeyFigures, findMovements } from '../engine/emphasis';
import { validate } from '../engine/validate';

const figures = (s: string) => findKeyFigures(parseNarration(s).tokens).map((p) => p.text);
assert.deepEqual(figures('However, it cost about twenty-two thousand dollars for every million tickets.'), ['twenty-two thousand dollars']);
assert.deepEqual(figures('It costs about a dollar forty an hour.'), ['dollar forty']);
assert.deepEqual(figures("That's forty-four times cheaper."), ['forty-four times cheaper']);
assert.deepEqual(figures('Costs fell 98% and the bill hit $500.'), ['98%', '$500']);
assert.deepEqual(figures('It saves millions of dollars a year. Each call took four seconds.'), [], 'vague amounts and plain durations are not key figures');

const moves = (s: string) => findMovements(parseNarration(s).tokens).map((m) => [m.text, m.moves]);
assert.deepEqual(moves('Tickets go into an SQS queue, which triggers a Lambda function. One setting decides which model runs.'), [['Tickets go into an SQS queue, which triggers a Lambda function.', 2]]);
assert.deepEqual(moves('She read the ticket and chose a label.'), []);

// The Amazon rollout scene as first drafted: a small cost chip, one dot over one hop, boxes not named as narrated.
const spec = JSON.parse(readFileSync('explainer/test/fixtures/still-route.json', 'utf8'));
const codes = validate(spec).errors.map((e) => e.code);
for (const c of ['FIGURE_SMALL', 'MOVEMENT_FAINT', 'NAME_UNSEEN']) assert.ok(codes.includes(c), `flags ${c}`);

// Fixed: the figure in big type, the ticket travelling queue → Lambda, boxes named as the narrator says.
const fixed = structuredClone(spec);
const board = fixed.scenes.find((s: any) => s.id === 'route');
board.elements.find((e: any) => e.id === 'q').label = 'SQS queue';
board.elements.find((e: any) => e.id === 'fn').label = 'Lambda';
board.elements.push({ id: 'cost-big', type: 'text', style: 'headline', text: '$22,200 per million', at: [6, 5.2] });
board.steps.push({ at: 'cost', do: 'show', targets: ['cost-big'] });
board.steps = board.steps.map((s: any) => (s.do === 'flow' ? { ...s, path: ['in', 'qf'] } : s));
const after = validate(fixed).errors.map((e) => e.code);
assert.deepEqual(after.filter((c) => ['FIGURE_SMALL', 'MOVEMENT_FAINT', 'MOVEMENT_STILL', 'NAME_UNSEEN'].includes(c)), [], `fixed scene passes (got ${after.join(', ')})`);
console.log('emphasis: ok');

import { formatValue } from '../engine/number-format';
assert.equal(formatValue(22200, '$'), '$22,200');
assert.equal(formatValue(500, '$'), '$500');
assert.equal(formatValue(4215, 'ms'), '4,215ms');
assert.equal(formatValue(86.5, '%'), '86.5%');
assert.equal(formatValue(7), '7');
console.log('number format: ok');

// Cue timing: a cue written before a sentence fires on that sentence; one written after a phrase still fires early.
import { compile } from '../engine/compile';
import { VideoSpec } from '../engine/schema';
const timing = VideoSpec.parse({ ...spec, scenes: [spec.scenes[0], { ...spec.scenes[1], narration: 'The team went slowly. {src} Tickets go into a queue. It becomes a number {q}. {cost} It cost a lot.' }] });
const ps: any = compile(timing).plan.scenes[1];
const wordAt = (w: string) => ps.words.find((x: any) => x.text.replace(/[^\w]/g, '') === w).startFrame;
assert.ok(ps.cueFrames.src >= wordAt('Tickets') - 5, `sentence-start cue fires on its own sentence (${ps.cueFrames.src} vs ${wordAt('Tickets')})`);
assert.ok(ps.cueFrames.q <= wordAt('becomes'), 'phrase-end cue fires where its phrase begins');
assert.ok(ps.cueFrames.cost >= wordAt('cost') - 10, 'cue after a full stop fires on the next sentence');
console.log('cue timing: ok');
