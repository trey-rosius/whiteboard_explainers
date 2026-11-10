/** Renders the last moment of every board scene ON LAMBDA for a quick visual review. FN and SERVE env vars set. npx tsx explainer/test/final-frames.ts <plan.json> <out.dir> */
import fs from 'node:fs';
import { renderStillOnLambda } from '@remotion/lambda-client';
const [planFile, out] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
fs.mkdirSync(out, { recursive: true });
let off = 0; const jobs: Array<[number, string]> = [];
for (const sc of plan.scenes) { off += sc.durationInFrames; if (sc.kind === 'board') jobs.push([off - 14, sc.id]); }
await Promise.all(jobs.map(async ([frame, id], i) => {
  let r: any; for (let k = 0; k < 3; k++) { try { r = await renderStillOnLambda({ region: 'us-east-1', functionName: process.env.FN!, serveUrl: process.env.SERVE!, composition: 'Explainer', inputProps: { plan }, frame, imageFormat: 'jpeg', jpegQuality: 78, scale: 0.38, privacy: 'public', maxRetries: 1 }); break; } catch (e) { if (k === 2) throw e; } }
  fs.writeFileSync(`${out}/${String(i).padStart(2, '0')}-${id}.jpg`, Buffer.from(await (await fetch(r.url)).arrayBuffer()));
}));
