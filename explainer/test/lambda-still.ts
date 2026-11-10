/** Renders QA contact sheets ON REMOTION LAMBDA (cloud) for a compiled plan and downloads the PNGs for inspection. */
import fs from 'node:fs';
import { renderStillOnLambda } from '@remotion/lambda-client';
const [planFile, outDir, ...sceneIds] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const region = 'us-east-1';
fs.mkdirSync(outDir, { recursive: true });
for (let si = 0; si < plan.scenes.length; si++) {
  const sc = plan.scenes[si];
  if (sceneIds.length && !sceneIds.includes(sc.id)) continue;
  const frames: number[] = sc.kind === 'title' ? [45] : [...new Set<number>(sc.actions.map((a: any) => Math.min(sc.durationInFrames - 12, a.frame + 20)))].slice(0, 8).concat([sc.durationInFrames - 12]);
  const t = Date.now();
  const r = await renderStillOnLambda({
    region, functionName: process.env.FN!, serveUrl: process.env.SERVE!, composition: 'ContactSheet',
    inputProps: { plan, sceneIndex: si, frames, labels: frames.map((f: number) => `${(f / 30).toFixed(1)}s`) },
    imageFormat: 'png', privacy: 'public', maxRetries: 1,
  });
  const png = Buffer.from(await (await fetch(r.url)).arrayBuffer());
  fs.writeFileSync(`${outDir}/${sc.id}.png`, png);
  console.log(`✔ ${sc.id} ${(Date.now() - t) / 1000}s ${png.length} bytes`);
}
