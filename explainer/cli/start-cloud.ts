#!/usr/bin/env tsx
/**
 * Start an explainer video on the DEPLOYED Blocks app (same typed client the frontend uses) and follow it.
 * Nothing renders locally.
 *
 *   npx tsx explainer/cli/start-cloud.ts --url https://<cloudfront>/aws-blocks/api --topic "Consistent hashing" --minutes 2
 *   npx tsx explainer/cli/start-cloud.ts --url … --job <jobId>        # just follow an existing job
 */
import '../node/service-access';
import { ApiNamespaceClient } from '@aws-blocks/blocks/client';
import '@aws-blocks/bb-realtime/aws-middleware';
import type { explainer as ExplainerApi } from 'aws-blocks';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = arg('url') ?? process.env.BLOCKS_API_URL;
if (!url) throw new Error('Pass --url https://<app>/aws-blocks/api (or set BLOCKS_API_URL)');
const explainer = ApiNamespaceClient('explainer', { url }) as unknown as typeof ExplainerApi;

let jobId = arg('job');
if (!jobId) {
  const topic = arg('topic');
  if (!topic) throw new Error('Pass --topic "<topic>" or --job <jobId>');
  ({ jobId } = await explainer.start({
    topic,
    minutes: Number(arg('minutes') ?? 2),
    format: (arg('format') as '16:9' | '9:16') ?? '16:9',
    brief: arg('brief'),
    voiceId: arg('voice'),
  }));
  console.log(`▶ started ${jobId}`);
}
if (process.argv.includes('--no-follow')) process.exit(0);

// Realtime: print every event the moment the pipeline reports it.
let rtCount = 0;
try {
  const channel: any = await explainer.watch(jobId!);
  const sub = channel.subscribe((m: any) => {
    rtCount++;
    console.log(`${new Date().toLocaleTimeString()}  [live] ${m.event.stage}${typeof m.event.pct === 'number' ? ` ${m.event.pct}%` : ''} · ${m.event.detail}`);
  });
  await sub.established;
  console.log('● subscribed to realtime channel');
} catch (e: any) {
  console.log(`realtime unavailable (${e?.message}); polling only`);
}

// Poll as the source of truth for completion.
for (;;) {
  const job: any = await explainer.get(jobId!);
  const s = job.status ?? {};
  if (s.stage === 'done') { console.log(`✔ ${s.title} · ${s.seconds}s · ${rtCount} live events\n${s.videoUrl}`); process.exit(0); }
  if (s.stage === 'failed') { console.error(`✖ ${s.error}`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 10000));
}
