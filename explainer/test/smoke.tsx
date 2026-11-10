/**
 * Renderer smoke test (no browser): server-renders every 5th frame of every scene of a plan.
 * Catches exceptions, infinite loops and pathological slow frames before a real render.
 *   npx tsx --tsconfig explainer/tsconfig.json explainer/test/smoke.tsx out/explainer/<id>/plan.json
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { SceneView } from '../remotion/SceneView';

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const t0 = Date.now();
let n = 0;
for (const sc of plan.scenes) {
  let worst = 0;
  for (let f = 0; f < sc.durationInFrames; f += 5) {
    const t = Date.now();
    const html = renderToStaticMarkup(<SceneView plan={plan} scene={sc} frame={f} />);
    if (!html.length) throw new Error(`empty render ${sc.id}@${f}`);
    worst = Math.max(worst, Date.now() - t);
    n++;
  }
  console.log(`  ✓ ${sc.id.padEnd(14)} ${String(sc.durationInFrames).padStart(5)}f  worst frame ${worst}ms`);
}
console.log(`✔ ${n} frames server-rendered in ${Date.now() - t0}ms`);
