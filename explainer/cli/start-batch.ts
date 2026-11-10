#!/usr/bin/env tsx
/**
 * Queue a batch through the DEPLOYED Blocks app and watch the queue drain (same API as the UI's Batch mode).
 *   npx tsx explainer/cli/start-batch.ts --url https://<app>/aws-blocks/api --format 9:16 --minutes 0.5 "Topic one" "Topic two"
 *   npx tsx explainer/cli/start-batch.ts --url ... --file batch.json   (per-topic briefs)
 */
import '../node/service-access';
import { ApiNamespaceClient } from '@aws-blocks/blocks/client';
import type { explainer as ExplainerApi } from 'aws-blocks';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const url = opt('url') ?? process.env.BLOCKS_API_URL;
if (!url) throw new Error('Pass --url');
// --file batch.json → [{ "topic": "...", "brief": "facts the script must use" }, ...]
const file = opt('file');
const items: Array<{ topic: string; brief?: string }> = file
  ? JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'))
  : argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--'))).map((topic) => ({ topic }));
const ex = ApiNamespaceClient('explainer', { url }) as unknown as typeof ExplainerApi;
const { batchId, jobIds } = await ex.startBatch({
  topics: items.map((x) => x.topic), briefs: items.map((x) => x.brief ?? ''),
  format: (opt('format') as any) ?? '16:9', minutes: Number(opt('minutes') ?? 2),
});
console.log(`▶ batch ${batchId}: ${jobIds.join(', ')}`);
const seen = new Map<string, string>();
for (;;) {
  const jobs = await Promise.all(jobIds.map((id) => ex.get(id)));
  for (const j of jobs) {
    const s: any = j.status ?? {};
    const line = `${j.state ?? '?'} · ${s.stage}${s.queuePosition ? ` #${s.queuePosition}` : ''}`;
    if (seen.get(j.jobId) !== line) { console.log(`${new Date().toLocaleTimeString()}  ${j.jobId}  ${line}`); seen.set(j.jobId, line); }
  }
  if (jobs.every((j) => j.state === 'done' || j.state === 'failed')) { console.log('✔ batch finished'); break; }
  await new Promise((r) => setTimeout(r, 5000));
}
