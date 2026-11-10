/** Renders one real frame of a sample episode per theme ON LAMBDA, to judge them by eye. npx tsx explainer/test/theme-gallery.ts <outDir> [format] [themes…] */
import fs from 'node:fs';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { renderStillOnLambda } from '@remotion/lambda-client';
import { validate } from '../engine/validate';
import { THEME_IDS } from '../engine/theme-list';
import { resolveIcon } from '../node/icons';
const [out, format = '9:16', ...only] = process.argv.slice(2);
const res = await new SSMClient({ region: 'us-east-1' }).send(new GetParametersCommand({ Names: ['/video-explainer/remotion-function-name', '/video-explainer/remotion-serve-url'] }));
const get = (k: string) => res.Parameters!.find((p) => p.Name!.endsWith(k))!.Value!;
const scene = { id: 'demo', kind: 'board', heading: 'One request, three servers', narration: 'Requests {go} reach the balancer, then the first server, the second, and the database keeps everything safe, all of it.', elements: [
  { id: 'lb', type: 'node', icon: 'lucide:split', label: 'Balancer', sub: 'round robin', at: [3, 1.2], size: 'l', color: 'orange' },
  { id: 'a', type: 'server', label: 'Server A', at: [1.3, 4.1], color: 'cyan' },
  { id: 'b', type: 'server', label: 'Server B', at: [4.7, 4.1], color: 'green' },
  { id: 'd', type: 'db', label: 'Database', at: [3, 6.9], color: 'purple' },
  { id: 'n', type: 'note', text: 'No single point of failure', at: [3, 8.9] },
  { id: 'x', type: 'arrow', from: 'lb', to: 'a' }, { id: 'y', type: 'arrow', from: 'lb', to: 'b' },
  { id: 'p', type: 'arrow', from: 'a', to: 'd' }, { id: 'q', type: 'arrow', from: 'b', to: 'd' },
], steps: [{ at: 'go', do: 'show', targets: ['lb', 'a', 'b', 'd', 'n', 'x', 'y', 'p', 'q'] }] };
fs.mkdirSync(out, { recursive: true });
await Promise.all((only.length ? only : [...THEME_IDS]).map(async (theme) => {
  const spec = { id: `gallery-${theme}`, title: 'Gallery', format, theme, voice: { provider: 'none' }, scenes: [scene] };
  const r: any = validate(spec, { resolveIcon });
  if (!r.plan) throw new Error(`${theme}: ${JSON.stringify(r.errors).slice(0, 400)}`);
  if (r.errors.length) console.log(theme, 'issues:', r.errors.map((e: any) => e.code).join(','));
  const still = await renderStillOnLambda({ region: 'us-east-1', functionName: get('remotion-function-name'), serveUrl: get('remotion-serve-url'), composition: 'Explainer', inputProps: { plan: r.plan }, frame: r.plan.totalFrames - 20, imageFormat: 'jpeg', jpegQuality: 80, scale: format === '9:16' ? 0.33 : 0.3, privacy: 'public', maxRetries: 1 });
  fs.writeFileSync(`${out}/${theme}.jpg`, Buffer.from(await (await fetch(still.url)).arrayBuffer()));
  console.log('✔', theme, `$${still.estimatedPrice.accruedSoFar.toFixed(4)}`);
}));
