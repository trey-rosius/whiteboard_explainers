/**
 * End-to-end test of human narration on the DEPLOYED app, with a generated voice standing in for the person.
 * Wrong take → retake request → cancel → retry reuses recordings → finished video. Hides its test jobs afterwards.
 *   npx tsx --env-file=.env explainer/test/narration-e2e.ts --url https://<app>/aws-blocks/api
 */
import '../node/service-access';
import { ApiNamespaceClient } from '@aws-blocks/blocks/client';
import { encodeWav, TAKE_SAMPLE_RATE as R } from '../../src/audio';

const argv = process.argv.slice(2);
const url = argv[argv.indexOf('--url') + 1];
const ex: any = ApiNamespaceClient('explainer', { url });
const key = process.env.ELEVENLABS_API_KEY!;
let fails = 0;
const ok = (c: unknown, l: string, x = '') => { console.log(`${c ? '✔' : '✖'} ${l}${x ? ` — ${x}` : ''}`); if (!c) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function speak(text: string) {
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/6OzrBCQf8cjERkYgzSg8?output_format=pcm_24000', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: 'eleven_v3' }) });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  const pcm = new Int16Array(await res.arrayBuffer());
  const out = new Float32Array(Math.floor((pcm.length * R) / 24000));
  for (let i = 0; i < out.length; i++) out[i] = (pcm[Math.min(pcm.length - 1, Math.floor((i * 24000) / R))] / 32768) * 0.9;
  return encodeWav(out);
}
async function put(jobId: string, sceneId: string, wav: Uint8Array) {
  const { url: u } = await ex.narrationUploadUrl({ jobId, sceneId });
  const r = await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.from(wav) });
  if (!r.ok) throw new Error(`PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
async function until(jobId: string, pred: (j: any) => boolean, ms = 600_000) {
  const t0 = Date.now(); let j: any;
  for (;;) { j = await ex.get(jobId); if (pred(j) || Date.now() - t0 > ms) return j; await sleep(3000); }
}
const terminal = (j: any) => ['done', 'failed', 'cancelled'].includes(j.state);
const started: string[] = [];
try {
  const { jobId } = await ex.start({ topic: 'What is a mutex?', format: '9:16', minutes: 0.5, narration: 'self', requestId: `narr-${Date.now()}` });
  started.push(jobId);
  let j = await until(jobId, (x) => x.status?.stage === 'awaiting-narration' || terminal(x));
  ok(j.status?.stage === 'awaiting-narration', 'script written, job pauses for the recording', j.status?.detail);
  ok(j.voiceName === 'Your voice', 'job is labelled as your voice');
  await sleep(2000);
  const slots = await ex.list({ page: 1, pageSize: 1 });
  ok(slots.queue.running === 0, 'waiting job does not hold a pipeline slot', JSON.stringify(slots.queue));

  let script = await ex.narrationScript(jobId);
  ok(script.scenes.length > 0 && script.scenes.every((x: any) => x.text && !/\{/.test(x.text)), 'script shown without cue markers', `${script.scenes.length} scenes`);
  try { await ex.submitNarration({ jobId }); ok(false, 'submit with nothing recorded refused'); } catch (e: any) { ok(/Still to record/.test(e.message), 'submit with nothing recorded refused', e.message.slice(0, 70)); }
  try { await ex.narrationUploadUrl({ jobId, sceneId: 'nope' }); ok(false, 'unknown scene refused'); } catch (e: any) { ok(/not part/.test(e.message), 'unknown scene refused'); }

  // First scene gets the wrong words; all others correct. Slightly ad-libbed to be realistic.
  const scenes = script.scenes;
  await put(jobId, scenes[0].id, await speak('The weather in Douala is warm and rainy today, and the markets are very busy this morning.'));
  for (const sc of scenes.slice(1)) await put(jobId, sc.id, await speak(`Okay. ${sc.spoken}`));
  script = await ex.narrationScript(jobId);
  ok(script.scenes.every((x: any) => x.take), 'takes are listed again after a reload (closed tab is safe)');
  await ex.submitNarration({ jobId });
  await ex.submitNarration({ jobId }).catch((e: any) => ok(false, 'double submit is harmless', e.message));
  j = await until(jobId, (x) => (x.status?.stage === 'awaiting-narration' && x.status?.narrationAttempt === 1) || terminal(x));
  script = await ex.narrationScript(jobId);
  ok(script.problems[scenes[0].id] && Object.keys(script.problems).length === 1, 'wrong take detected, only that scene needs redoing', script.problems[scenes[0].id]);

  await put(jobId, scenes[0].id, await speak(scenes[0].spoken));
  await ex.submitNarration({ jobId });
  j = await until(jobId, (x) => ['timing', 'visual-qa', 'rendering'].includes(x.status?.stage) || terminal(x));
  ok(['timing', 'visual-qa', 'rendering'].includes(j.status?.stage), 'retake accepted, pipeline continues', j.status?.stage);
  const events = j.status.events.filter((e: any) => /Aligned scene/.test(e.detail)).map((e: any) => e.detail);
  console.log('   ' + events.join('\n   '));

  // Interrupt, then retry: recordings must be reused.
  await sleep(1000);
  await ex.cancel(jobId);
  const rt = await ex.retry(jobId);
  started.push(rt.jobId);
  let sawWait = false;
  const final = await until(rt.jobId, (x) => { if (x.status?.stage === 'awaiting-narration') sawWait = true; return terminal(x); });
  ok(!sawWait, 'retry reused the recordings and never asked again');
  ok(final.state === 'done' && !!final.status?.videoUrl, `video finished: "${final.status?.title}" · ${final.status?.seconds}s`, final.state === 'done' ? '' : String(final.status?.detail).slice(0, 220));
  const total = scenes.length;
  ok((final.status?.seconds ?? 0) > total, 'video length comes from the recordings', `${final.status?.seconds}s`);
  console.log('   video job:', rt.jobId);
} finally {
  for (const id of started) { await ex.cancel(id).catch(() => {}); }
}
console.log(fails ? `\n✖ ${fails} failed` : '\n✔ narration flow passed');
process.exit(fails ? 1 : 0);
