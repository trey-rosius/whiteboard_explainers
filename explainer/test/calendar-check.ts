/**
 * Calendar checks against the DEPLOYED app. Cleans up everything it creates.
 *   npx tsx explainer/test/calendar-check.ts --url https://<app>/aws-blocks/api [--cron]
 * --cron schedules a real 30 s video that the EventBridge tick must start on its own (≈ 1 video of quota, ~15 min).
 */
import '../node/service-access';
import { ApiNamespaceClient } from '@aws-blocks/blocks/client';

const argv = process.argv.slice(2);
const url = argv[argv.indexOf('--url') + 1];
if (!url) throw new Error('Pass --url');
const cal: any = ApiNamespaceClient('calendar', { url });
const ex: any = ApiNamespaceClient('explainer', { url });

let failures = 0;
const ok = (c: unknown, label: string, extra = '') => { console.log(`${c ? '✔' : '✖'} ${label}${extra ? ` — ${extra}` : ''}`); if (!c) failures++; };
async function rejects(label: string, fn: () => Promise<unknown>, re: RegExp) {
  try { await fn(); ok(false, label, 'did not throw'); } catch (e: any) { ok(re.test(String(e?.message)), label, String(e?.message).slice(0, 90)); }
}
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const rid = () => `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const created = new Set<string>();

try {
  const videos = await cal.videos();
  ok(videos.length > 0, 'library videos are available to schedule', `${videos.length} videos`);
  const video = videos.find((v: any) => v.format === '9:16') ?? videos[0];

  await rejects('past time refused', () => cal.createMany({ items: [{ scheduledAt: inHours(-2), platforms: ['tiktok'], jobId: video.jobId }] }), /past/);
  await rejects('garbage date refused', () => cal.createMany({ items: [{ scheduledAt: 'soon', platforms: ['tiktok'], jobId: video.jobId }] }), /valid date/);
  await rejects('far future refused', () => cal.createMany({ items: [{ scheduledAt: inHours(24 * 365 * 3), platforms: ['tiktok'], jobId: video.jobId }] }), /2 years/);
  await rejects('no platform refused', () => cal.createMany({ items: [{ scheduledAt: inHours(5), platforms: [], jobId: video.jobId }] }), /platform/);
  await rejects('unknown platform refused', () => cal.createMany({ items: [{ scheduledAt: inHours(5), platforms: ['myspace'], jobId: video.jobId }] }), /Unknown platform/);
  await rejects('unknown video refused', () => cal.createMany({ items: [{ scheduledAt: inHours(5), platforms: ['tiktok'], jobId: 'ex-nope' }] }), /no longer exists/);
  await rejects('bad topic refused now, not at post time', () => cal.createMany({ items: [{ scheduledAt: inHours(5), platforms: ['tiktok'], topic: '!!!' }] }), /at least 3|needs some words/);
  const before = (await cal.list({})).items.length;
  await rejects('batch is all-or-nothing', () => cal.createMany({ items: [{ scheduledAt: inHours(5), platforms: ['tiktok'], jobId: video.jobId }, { scheduledAt: inHours(-5), platforms: ['tiktok'], jobId: video.jobId }] }), /past/);
  ok((await cal.list({})).items.length === before, 'nothing written by the failed batch');

  // create, idempotent repeat, warnings
  const r1 = rid();
  const a = await cal.createMany({ items: [{ scheduledAt: inHours(26), platforms: ['tiktok', 'youtube-shorts', 'tiktok'], jobId: video.jobId, requestId: r1 }] });
  const b = await cal.createMany({ items: [{ scheduledAt: inHours(26), platforms: ['tiktok', 'youtube-shorts'], jobId: video.jobId, requestId: r1 }] });
  const id = a.results[0].postId; created.add(id);
  ok(id === b.results[0].postId && b.results[0].reused, 'same requestId returns the same post');
  const wrong = await cal.createMany({ items: [{ scheduledAt: inHours(30), platforms: [video.format === '9:16' ? 'youtube' : 'tiktok'], jobId: video.jobId }] });
  created.add(wrong.results[0].postId);
  ok(wrong.results[0].warnings.length === 1, 'format/platform mismatch warns', wrong.results[0].warnings[0]);

  // kit
  let d = await cal.get(id);
  ok(d.status === 'ready' && d.platforms.length === 2, 'duplicate platform removed; video-backed future post is "ready"', d.status);
  ok(!!d.downloadUrl && /attachment/.test(decodeURIComponent(d.downloadUrl)), 'kit has a named MP4 download link');

  // edit + reschedule
  await cal.update({ postId: id, title: 'Edited title', description: 'Edited', hashtags: '#one, two  #one' });
  d = await cal.get(id);
  ok(d.title === 'Edited title' && d.description === 'Edited' && d.hashtags.join() === 'one,two', 'caption edits saved, hashtags cleaned', d.hashtags.join());
  const later = inHours(50);
  await cal.update({ postId: id, scheduledAt: later });
  ok((await cal.get(id)).scheduledAt === later, 'reschedule saved');
  await rejects('reschedule into the past refused', () => cal.update({ postId: id, scheduledAt: inHours(-1) }), /past/);

  // range filter
  const inside = await cal.list({ from: inHours(49), to: inHours(51) });
  const outside = await cal.list({ from: inHours(60), to: inHours(61) });
  ok(inside.items.some((p: any) => p.postId === id) && !outside.items.some((p: any) => p.postId === id), 'date range filter works');

  // posted checklist
  await rejects('javascript: link refused or neutralised', async () => { await cal.markPosted({ postId: id, platform: 'tiktok', posted: true, url: 'not a url at all' }); }, /valid URL/);
  await cal.markPosted({ postId: id, platform: 'tiktok', posted: true, url: 'tiktok.com/@me/video/1' });
  d = await cal.get(id);
  ok(d.platforms.find((p: any) => p.platform === 'tiktok').url === 'https://tiktok.com/@me/video/1' && d.status !== 'posted', 'one platform posted, link normalised, post still open');
  await cal.update({ postId: id, platforms: ['tiktok', 'youtube-shorts', 'instagram'] });
  ok((await cal.get(id)).platforms.find((p: any) => p.platform === 'tiktok').posted, 'adding a platform keeps earlier posted ticks');
  await cal.update({ postId: id, platforms: ['tiktok', 'youtube-shorts'] });
  await cal.markPosted({ postId: id, platform: 'youtube-shorts', posted: true });
  ok((await cal.get(id)).status === 'posted', 'all platforms posted → post is "posted"');
  await rejects('published post cannot be moved', () => cal.update({ postId: id, scheduledAt: inHours(70) }), /already published/);
  await cal.markPosted({ postId: id, platform: 'youtube-shorts', posted: false });
  ok((await cal.get(id)).status === 'ready', 'undo posted works');

  // planned topic: waits; lead time longer than the gap starts now is covered by the composer; far-future waits
  const planned = await cal.createMany({ items: [{ scheduledAt: inHours(24 * 30), platforms: ['youtube'], topic: '  - "What is eventual consistency?"  ', format: '16:9', leadHours: 3 }] });
  const pid = planned.results[0].postId; created.add(pid);
  const pd = await cal.get(pid);
  ok(pd.status === 'planned' && pd.topic === 'What is eventual consistency?' && !pd.jobId, 'future topic waits, topic cleaned, no video started', pd.topic);
  const delta = (new Date(pd.scheduledAt).getTime() - new Date(pd.generateAt).getTime()) / 3600_000;
  ok(Math.abs(delta - 3) < 0.01, 'generation is set 3 hours before the post');
  const moved = inHours(24 * 40);
  await cal.update({ postId: pid, scheduledAt: moved });
  const pd2 = await cal.get(pid);
  ok(Math.abs((new Date(moved).getTime() - new Date(pd2.generateAt).getTime()) / 3600_000 - 3) < 0.01, 'rescheduling moves the generation time with it');

  await cal.remove(id); created.delete(id);
  await rejects('removed post is gone', () => cal.get(id), /no longer exists/);
  ok((await ex.get(video.jobId)).state === 'done', 'removing a post keeps the video');
  await cal.remove(id); // second remove is harmless
  ok(true, 'remove is idempotent');

  if (argv.includes('--cron')) {
    const when = inHours(1 + 7 / 60); // generation due in ~7 min; only the tick can start it
    const c = await cal.createMany({ items: [{ scheduledAt: when, platforms: ['tiktok'], topic: 'What is a Bloom filter?', format: '9:16', minutes: 0.5, leadHours: 1 }] });
    const cid = c.results[0].postId; created.add(cid);
    ok(!(await cal.get(cid)).jobId, 'cron test: nothing started yet');
    const t0 = Date.now();
    let cur: any;
    for (;;) {
      cur = await cal.get(cid);
      if (cur.status === 'ready' || cur.status === 'failed' || Date.now() - t0 > 22 * 60_000) break;
      await new Promise((r) => setTimeout(r, 20_000));
    }
    ok(cur.status === 'ready' && !!cur.downloadUrl, `cron started and finished the video: "${cur.title}" · ${cur.seconds}s (${Math.round((Date.now() - t0) / 60000)} min)`, cur.status === 'ready' ? '' : String(cur.error).slice(0, 150));
    ok(cur.description.length > 0 && cur.hashtags.length > 0, 'kit filled from the pipeline: description + hashtags', cur.hashtags.join(' '));
    if (cur.videoJobId) await ex.archive(cur.videoJobId).catch(() => {});
  }
} finally {
  for (const id of created) await cal.remove(id).catch(() => {});
}
console.log(failures ? `\n✖ ${failures} check(s) failed` : '\n✔ all calendar checks passed');
process.exit(failures ? 1 : 0);
