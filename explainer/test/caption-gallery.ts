/**
 * Caption design previews, rendered ON REMOTION LAMBDA (cloud): one contact sheet per style for a real recorded video,
 * at moments when a number or name is being said. Usage: caption-gallery <spec.json> <timings.json> <outDir> [styles…]
 * Needs FN (Remotion function) and SERVE (site URL) in the environment.
 */
import fs from 'node:fs';
import { renderStillOnLambda } from '@remotion/lambda-client';
import { compile } from '../engine/compile';
import { VideoSpec } from '../engine/schema';
import { CAPTION_STYLES } from '../engine/captions';

const [specFile, timingsFile, outDir, ...only] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const timings = JSON.parse(fs.readFileSync(timingsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const styles = (only.length ? only : CAPTION_STYLES.filter((s) => s !== 'off')) as Array<(typeof CAPTION_STYLES)[number]>;

// The same moments for every style: the board scene with the most numbers and names, as each is said.
const probe = compile(VideoSpec.parse(raw), { timings }).plan;
const keyCount = (i: number) => probe.scenes[i].words.filter((w) => w.key).length;
const si = probe.scenes.map((_, i) => i).filter((i) => probe.scenes[i].kind === 'board').sort((a, b) => keyCount(b) - keyCount(a))[0];
const sc = probe.scenes[si];
const keyed = sc.words.filter((w) => w.key).map((w) => w.startFrame + 3);
const plain = sc.captions.map((c) => Math.round((c.startFrame + c.endFrame) / 2));
const frames = [...new Set([...keyed, ...plain])].filter((f) => f < sc.durationInFrames).slice(0, probe.format === '9:16' ? 4 : 6).sort((a, b) => a - b);
console.log(`scene "${sc.id}" frames ${frames.join(', ')}`);

const download = async (url: string) => {
  for (let i = 0; ; i++) {
    try { return Buffer.from(await (await fetch(url)).arrayBuffer()); } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
};

for (const style of styles) {
  const { plan } = compile(VideoSpec.parse({ ...raw, captions: style }), { timings });
  const r = await renderStillOnLambda({
    region: 'us-east-1', functionName: process.env.FN!, serveUrl: process.env.SERVE!, composition: 'ContactSheet',
    inputProps: { plan, sceneIndex: si, frames, labels: frames.map((f) => `${style} · ${(f / 30).toFixed(1)}s`) },
    imageFormat: 'png', privacy: 'public', maxRetries: 1,
  });
  fs.writeFileSync(`${outDir}/${style}.png`, await download(r.url));
  console.log(`✔ ${style}`);
}
