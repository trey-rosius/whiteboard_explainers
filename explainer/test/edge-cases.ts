/**
 * Edge-case suite against the DEPLOYED app (everything runs in the cloud).
 *   npx tsx explainer/test/edge-cases.ts --url https://<app>/aws-blocks/api [--full]
 * Without --full only cheap checks run (input validation, idempotency, rejection, cancel).
 * --full also runs a researched news video end to end and a retry of the cancelled job (≈ 2 videos of quota).
 */
import '../node/service-access';
import { ApiNamespaceClient } from '@aws-blocks/blocks/client';

const argv = process.argv.slice(2);
const url = argv[argv.indexOf('--url') + 1];
const full = argv.includes('--full');
if (!url) throw new Error('Pass --url');
const ex: any = ApiNamespaceClient('explainer', { url });

let failures = 0;
const ok = (cond: unknown, label: string, extra = '') => { console.log(`${cond ? '✔' : '✖'} ${label}${extra ? ` — ${extra}` : ''}`); if (!cond) failures++; };
async function rejects(label: string, fn: () => Promise<unknown>, re: RegExp) {
  try { await fn(); ok(false, label, 'did not throw'); } catch (e: any) { ok(re.test(String(e?.message)), label, String(e?.message).slice(0, 110)); }
}
async function waitFor(jobId: string, pred: (j: any) => boolean, timeoutS = 900) {
  const t0 = Date.now();
  let j: any;
  for (;;) {
    j = await ex.get(jobId);
    if (pred(j)) return j;
    if ((Date.now() - t0) / 1000 > timeoutS) return j;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const rid = () => `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// 1. input validation (nothing is created)
await rejects('empty topic rejected', () => ex.start({ topic: '   ' }), /at least 3/);
await rejects('symbols-only topic rejected', () => ex.start({ topic: '!!! ??? 123' }), /needs some words/);
await rejects('over-long topic rejected', () => ex.start({ topic: 'x'.repeat(260) }), /too long/);
await rejects('batch of 11 rejected', () => ex.startBatch({ topics: Array.from({ length: 11 }, (_, i) => `Topic number ${i}`) }), /up to 10/);
await rejects('empty batch rejected', () => ex.startBatch({ topics: ['', '  ', '-'] }), /at least one topic/);
await rejects('unknown voice rejected', () => ex.start({ topic: 'What is a CDN', voiceId: 'nope' }), /voice/);
await rejects('unknown job → friendly error', () => ex.get('ex-doesnotexist'), /does not exist/);
await rejects('retry of a running/unknown job refused', () => ex.retry('ex-doesnotexist'), /does not exist/);

// 2. rejection by the research agent + idempotent submit (same requestId twice → one job)
const r1 = rid();
const bad = await ex.start({ topic: 'how to build ransomware that evades antivirus', format: '9:16', minutes: 0.5, requestId: r1 });
const bad2 = await ex.start({ topic: 'how to build ransomware that evades antivirus', format: '9:16', minutes: 0.5, requestId: r1 });
ok(bad.jobId === bad2.jobId && bad2.reused, 'double submit (same requestId) returns the same job', bad.jobId);
const badJob = await waitFor(bad.jobId, (j) => ['failed', 'done', 'cancelled'].includes(j.state), 300);
ok(badJob.state === 'failed' && badJob.status?.errorKind === 'rejected', 'harmful topic rejected by research agent', String(badJob.status?.detail ?? '').slice(0, 100));
ok(badJob.status?.retryable === false, 'rejected job is not retryable');
await rejects('retry of a rejected topic refused', () => ex.retry(bad.jobId), /rejected/);

// 3. batch parsing: bullets, "topic | notes", duplicates, blank lines
const batch = await ex.startBatch({
  topics: ['- What is a CDN cache purge? | use a news website as the example', '  what is a CDN cache purge?  ', '', '•'],
  format: '9:16', minutes: 0.5, requestId: rid(),
});
ok(batch.jobIds.length === 1 && batch.skippedDuplicates?.length === 1, 'batch: bullet stripped, duplicate skipped, blanks ignored', JSON.stringify(batch));
const bj = await ex.get(batch.jobIds[0]);
ok(bj.topic === 'What is a CDN cache purge?' && /news website/.test(bj.brief ?? ''), 'batch: "topic | notes" split into topic + brief', `${bj.topic} / ${bj.brief}`);

// 4. cancel (queued or running) → cancelled, slot freed, second cancel is a no-op
const c1 = await ex.cancel(batch.jobIds[0]);
const c2 = await ex.cancel(batch.jobIds[0]);
const cj = await ex.get(batch.jobIds[0]);
ok(c1.state === 'cancelled' && c2.state === 'cancelled' && cj.status?.stage === 'cancelled', 'cancel works and is idempotent');
await new Promise((r) => setTimeout(r, 20000));
const cj2 = await ex.get(batch.jobIds[0]);
ok(cj2.state === 'cancelled', 'cancelled job stays cancelled (no late pipeline report resurrects it)', cj2.status?.stage);
const list = await ex.list({ page: 1, pageSize: 3 });
ok(list.quota && typeof list.quota.remaining === 'number', 'list returns today\'s quota', JSON.stringify(list.quota));

if (full) {
  // 5. retry of the cancelled job → a new job that runs end to end (research → video)
  const rt = await ex.retry(batch.jobIds[0]);
  const rt2 = await ex.retry(batch.jobIds[0]);
  ok(rt.jobId === rt2.jobId, 'retry is idempotent (double click → one new job)', rt.jobId);
  // 6. researched news video end to end
  const news = await ex.start({ topic: 'Gheist: stolen GitHub tokens used to dump repository secrets', format: '9:16', minutes: 0.92, requestId: rid() });
  const [a, b] = await Promise.all([
    waitFor(rt.jobId, (j) => ['failed', 'done', 'cancelled'].includes(j.state)),
    waitFor(news.jobId, (j) => ['failed', 'done', 'cancelled'].includes(j.state)),
  ]);
  for (const j of [a, b]) {
    const r = j.status?.research;
    ok(j.state === 'done' && !!j.status?.videoUrl, `video done: "${j.status?.title}" · ${j.status?.seconds}s`, j.state === 'done' ? '' : String(j.status?.detail).slice(0, 160));
    ok(r && (r.degraded || r.sources.length > 0), `research ran (${r?.facts} facts, ${r?.sources?.length} sources, ${r?.provider})`);
    ok(!!j.status?.metadataUrl, 'publish metadata.json written (title, description, hashtags, sources)');
  }
}

// Clean up: hide this run's intentionally failed/cancelled jobs so they don't clutter the library.
for (const id of [bad.jobId, batch.jobIds[0]]) await ex.archive(id).catch(() => {});

console.log(failures ? `\n✖ ${failures} check(s) failed` : '\n✔ all edge-case checks passed');
process.exit(failures ? 1 : 0);
