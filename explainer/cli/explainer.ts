#!/usr/bin/env tsx
/**
 * Explainer harness CLI.
 *
 *   npm run explainer -- setup                       generate SFX + preview plan
 *   npm run explainer -- icons <query>               find icon ids
 *   npm run explainer -- validate <spec.json> [--fix] schema + layout + timing + pacing checks (--fix: auto-layout)
 *   npm run explainer -- tts <spec.json> [--force] [--upload]   narration audio + word timings (cached)
 *   npm run explainer -- qa <spec.json> [--scene id] contact sheets of key frames → out/explainer/<id>/qa
 *   npm run explainer -- studio <spec.json>          open Remotion Studio on the compiled plan
 *   npm run explainer -- render <spec.json> [--draft] [--out f.mp4] [--lambda]
 *   npm run explainer -- make <spec.json>            validate → tts → validate → qa → render
 *   npm run explainer -- deploy-site                 deploy the renderer to Remotion Lambda (prints serve URL)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validate, formatIssues, type ValidationResult } from '../engine/validate';
import { parseNarration } from '../engine/narration';
import type { SceneTiming } from '../engine/compile';
import type { RenderPlan } from '../engine/plan';
import { resolveIcon, searchIcons } from '../node/icons';
import { synthesize, ttsHash, type VoiceConfig } from '../node/tts';
import { generateSfx } from '../node/sfx';
import { VideoSpec } from '../engine/schema';

const ROOT = process.cwd();
const HERE = path.join(ROOT, 'explainer');
const PUBLIC = path.join(HERE, 'public');
const ENTRY = path.join(HERE, 'remotion', 'index.ts');

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--') && ['scene', 'out', 'primary', 'primary-name'].includes(arr[i - 1].slice(2))));

function die(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function loadSpecRaw(file?: string): any {
  if (!file) die('Missing <spec.json> argument');
  const p = path.resolve(file);
  if (!fs.existsSync(p)) die(`Spec not found: ${p}`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e: any) {
    die(`Spec is not valid JSON: ${e.message}`);
  }
}

const outDir = (id: string) => path.join(ROOT, 'out', 'explainer', id);
const timingsFile = (id: string) => path.join(outDir(id), 'timings.json');

function voiceOf(spec: VideoSpec): VoiceConfig {
  return { ...spec.voice, voiceId: spec.voice.voiceId ?? process.env.ELEVENLABS_VOICE_ID };
}

/** Timings whose hash matches the current narration + voice (stale ones are ignored). */
function freshTimings(spec: VideoSpec): Record<string, SceneTiming> {
  const f = timingsFile(spec.id);
  if (!fs.existsSync(f)) return {};
  const all: Record<string, SceneTiming> = JSON.parse(fs.readFileSync(f, 'utf8'));
  const out: Record<string, SceneTiming> = {};
  for (const sc of spec.scenes) {
    const t = all[sc.id];
    if (!t || !sc.narration) continue;
    const parsed = parseNarration(sc.narration, spec.pronounce);
    if (t.hash === ttsHash(parsed.spokenText, voiceOf(spec))) out[sc.id] = t;
  }
  return out;
}

function runValidate(raw: any, quiet = false): ValidationResult {
  const pre = VideoSpec.safeParse(raw);
  const timings = pre.success ? freshTimings(pre.data) : {};
  const r = validate(raw, { timings, resolveIcon });
  if (!quiet) console.log(formatIssues(r));
  return r;
}

function writePlan(plan: RenderPlan): string {
  fs.mkdirSync(outDir(plan.id), { recursive: true });
  const f = path.join(outDir(plan.id), 'plan.json');
  fs.writeFileSync(f, JSON.stringify(plan));
  return f;
}

let bundled: string | null = null;
async function bundleOnce(): Promise<string> {
  if (bundled) return bundled;
  const { bundle } = await import('@remotion/bundler');
  process.stdout.write('… bundling renderer\n');
  bundled = await bundle({ entryPoint: ENTRY, publicDir: PUBLIC });
  return bundled;
}

function keyFrames(plan: RenderPlan, si: number): Array<{ frame: number; label: string }> {
  const sc = plan.scenes[si];
  if (sc.kind === 'title') return [{ frame: Math.min(sc.durationInFrames - 12, 45), label: `${sc.id} title` }];
  const out: Array<{ frame: number; label: string }> = [];
  for (const a of sc.actions) {
    if (a.do === 'unhighlight' || a.do === 'undim') continue;
    const f = Math.min(sc.durationInFrames - 12, a.frame + (a.do === 'flow' ? 14 : 20));
    const what = a.do === 'flow' ? `flow ${a.path.join('>')}` : `${a.do} ${(a as any).target ?? ''}`;
    const prev = out[out.length - 1];
    if (prev && f - prev.frame < 8) { prev.label += ` + ${what}`; continue; }
    out.push({ frame: f, label: `${(f / plan.fps).toFixed(1)}s ${what}` });
  }
  out.push({ frame: sc.durationInFrames - 12, label: `${((sc.durationInFrames - 12) / plan.fps).toFixed(1)}s END` });
  return out;
}

async function qa(plan: RenderPlan, onlyScene?: string): Promise<string[]> {
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  const serveUrl = await bundleOnce();
  const dir = path.join(outDir(plan.id), 'qa');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const per = plan.format === '9:16' ? 8 : 9;
  for (let si = 0; si < plan.scenes.length; si++) {
    const sc = plan.scenes[si];
    if (onlyScene && sc.id !== onlyScene) continue;
    const kf = keyFrames(plan, si);
    for (let page = 0; page * per < kf.length; page++) {
      const slice = kf.slice(page * per, page * per + per);
      const inputProps = { plan, sceneIndex: si, frames: slice.map((k) => k.frame), labels: slice.map((k) => k.label) };
      const composition = await selectComposition({ serveUrl, id: 'ContactSheet', inputProps });
      const output = path.join(dir, `${String(si + 1).padStart(2, '0')}-${sc.id}${page ? `-p${page + 1}` : ''}.png`);
      await renderStill({ composition, serveUrl, output, inputProps, frame: 0 });
      files.push(output);
      console.log(`  ▣ ${path.relative(ROOT, output)}`);
    }
  }
  return files;
}

async function renderLocal(plan: RenderPlan, out: string, draft: boolean) {
  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  const serveUrl = await bundleOnce();
  const inputProps = { plan };
  const composition = await selectComposition({ serveUrl, id: 'Explainer', inputProps });
  let last = -1;
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: out,
    crf: draft ? 28 : 16, scale: draft ? 0.5 : 1, audioBitrate: '192k', imageFormat: 'jpeg', jpegQuality: draft ? 70 : 92,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 20);
      if (p !== last) { last = p; process.stdout.write(`\r  rendering ${'█'.repeat(p)}${'░'.repeat(20 - p)} ${Math.round(progress * 100)}%`); }
    },
  });
  process.stdout.write('\n');
}

async function renderLambda(plan: RenderPlan) {
  const { renderMediaOnLambda, getRenderProgress } = await import('@remotion/lambda/client');
  const region = (process.env.AWS_REGION ?? 'us-east-1') as any;
  const functionName = process.env.REMOTION_LAMBDA_FUNCTION_NAME ?? die('Set REMOTION_LAMBDA_FUNCTION_NAME');
  const serveUrl = process.env.EXPLAINER_SERVE_URL ?? die('Set EXPLAINER_SERVE_URL (run `deploy-site`)');
  for (const sc of plan.scenes) if (sc.audio && !/^https?:/.test(sc.audio.src)) die(`Scene ${sc.id} audio is local; run \`tts --upload\` so Lambda can fetch it.`);
  const { renderId, bucketName } = await renderMediaOnLambda({
    region, functionName, serveUrl, composition: 'Explainer', inputProps: { plan }, codec: 'h264', imageFormat: 'jpeg', jpegQuality: 92, crf: 16,
    framesPerLambda: Math.max(120, Math.ceil(plan.totalFrames / 150)), privacy: 'private', downloadBehavior: { type: 'download', fileName: `${plan.id}.mp4` },
  });
  console.log(`  ↑ Lambda render ${renderId}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const p = await getRenderProgress({ renderId, bucketName, functionName, region });
    process.stdout.write(`\r  lambda ${Math.round(p.overallProgress * 100)}%   `);
    if (p.fatalErrorEncountered) die(p.errors.map((e) => e.message).join('\n'));
    if (p.done) { console.log(`\n✔ ${p.outputFile}`); return; }
  }
}

async function tts(spec: VideoSpec, force: boolean, upload: boolean) {
  const voice = voiceOf(spec);
  if (voice.provider === 'none') { console.log('voice.provider = none → skipping TTS (timings estimated)'); return; }
  const f = timingsFile(spec.id);
  fs.mkdirSync(outDir(spec.id), { recursive: true });
  const all: Record<string, SceneTiming> = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const narrated = spec.scenes.filter((s) => s.narration);
  let s3: any = null;
  if (upload) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
    if (!process.env.EXPLAINER_AUDIO_BUCKET) die('Set EXPLAINER_AUDIO_BUCKET (and optionally EXPLAINER_AUDIO_BASE_URL) for --upload');
  }
  for (let i = 0; i < narrated.length; i++) {
    const sc = narrated[i];
    const parsed = parseNarration(sc.narration!, spec.pronounce);
    const hash = ttsHash(parsed.spokenText, voice);
    const prevT = all[sc.id];
    if (!force && prevT?.hash === hash && (upload ? /^https?:/.test(prevT.src ?? '') : true)) { console.log(`  ✓ ${sc.id} (cached)`); continue; }
    const prevText = i > 0 ? parseNarration(narrated[i - 1].narration!, spec.pronounce).spokenText : undefined;
    const nextText = i < narrated.length - 1 ? parseNarration(narrated[i + 1].narration!, spec.pronounce).spokenText : undefined;
    process.stdout.write(`  ♪ ${sc.id} … `);
    const r = await synthesize(parsed, voice, { previousText: prevText?.slice(-300), nextText: nextText?.slice(0, 300) });
    const rel = `videos/${spec.id}/${sc.id}-${hash}.${r.ext}`;
    let src = rel;
    if (upload) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const key = `explainer/${rel}`;
      await s3.send(new PutObjectCommand({ Bucket: process.env.EXPLAINER_AUDIO_BUCKET, Key: key, Body: r.audio, ContentType: r.ext === 'mp3' ? 'audio/mpeg' : 'audio/wav' }));
      const base = process.env.EXPLAINER_AUDIO_BASE_URL ?? `https://${process.env.EXPLAINER_AUDIO_BUCKET}.s3.amazonaws.com`;
      src = `${base.replace(/\/$/, '')}/${key}`;
    }
    const abs = path.join(PUBLIC, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, r.audio);
    all[sc.id] = { src, durationSec: r.durationSec, words: r.words, hash };
    fs.writeFileSync(f, JSON.stringify(all, null, 1));
    console.log(`${r.durationSec.toFixed(1)}s`);
  }
}

async function main() {
  switch (cmd) {
    case 'setup': {
      const files = generateSfx(path.join(PUBLIC, 'sfx'));
      console.log(`✔ SFX: ${files.map((f) => path.basename(f)).join(', ')}`);
      const ex = path.join(HERE, 'examples', 'database-sharding.json');
      if (fs.existsSync(ex)) {
        const r = validate(JSON.parse(fs.readFileSync(ex, 'utf8')), { resolveIcon });
        if (r.plan) fs.writeFileSync(path.join(HERE, 'remotion', 'defaultPlan.json'), JSON.stringify(r.plan));
        console.log('✔ Studio preview plan written');
      }
      break;
    }
    case 'icons': {
      const q = args.slice(1).join(' ');
      if (!q) die('Usage: icons <query>');
      const hits = searchIcons(q);
      console.log(hits.length ? hits.join('\n') : `No icons match "${q}". Try a broader word (e.g. "database", "server", "lock").`);
      break;
    }
    case 'validate': {
      if (flag('fix')) {
        const { autofixLayout, autofixText } = await import('../engine/autofix');
        const raw = loadSpecRaw(positional[0]);
        const pre = VideoSpec.safeParse(raw);
        const opts = { timings: pre.success ? freshTimings(pre.data) : {}, resolveIcon };
        const text = autofixText(raw, opts);
        const fixed = autofixLayout(text.spec, opts);
        const changes = [...text.changes, ...fixed.changes];
        changes.forEach((c) => console.log(`  ↦ ${c}`));
        if (changes.length) fs.writeFileSync(path.resolve(positional[0]), JSON.stringify(fixed.spec, null, 2));
      }
      const r = runValidate(loadSpecRaw(positional[0]), flag('json'));
      if (flag('json')) console.log(JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings, stats: r.stats }, null, 2));
      process.exit(r.ok ? 0 : 1);
    }
    case 'tts': {
      const raw = loadSpecRaw(positional[0]);
      const r = runValidate(raw, true);
      if (!r.spec) { console.log(formatIssues(r)); die('Fix schema errors before TTS'); }
      if (!r.ok) console.warn('⚠ spec has errors; generating audio anyway (narration is independent of layout)');
      await tts(r.spec, flag('force'), flag('upload'));
      console.log('✔ TTS done — re-run validate: pacing checks now use real timings');
      break;
    }
    case 'compile': {
      const r = runValidate(loadSpecRaw(positional[0]));
      if (!r.plan) process.exit(1);
      console.log(`✔ ${path.relative(ROOT, writePlan(r.plan))}`);
      break;
    }
    case 'qa': {
      const r = runValidate(loadSpecRaw(positional[0]));
      if (!r.plan || !r.ok) die('Fix validation errors first');
      writePlan(r.plan);
      const files = await qa(r.plan, opt('scene'));
      console.log(`✔ ${files.length} contact sheet(s). Inspect every image against the QA checklist.`);
      break;
    }
    case 'studio': {
      const r = runValidate(loadSpecRaw(positional[0]));
      if (!r.plan) process.exit(1);
      const planFile = writePlan(r.plan);
      spawnSync('npx', ['remotion', 'studio', ENTRY, `--props=${planFile}`, `--public-dir=${PUBLIC}`], { stdio: 'inherit' });
      break;
    }
    case 'render': {
      const r = runValidate(loadSpecRaw(positional[0]));
      if (!r.plan || !r.ok) die('Refusing to render: fix validation errors first');
      if (r.stats?.estimatedTiming && r.spec!.voice.provider !== 'none' && !flag('draft')) die('Narration audio missing or stale — run `tts` first (or use --draft for a silent preview)');
      writePlan(r.plan);
      if (flag('lambda')) await renderLambda(r.plan);
      else {
        const out = path.resolve(opt('out') ?? path.join(outDir(r.plan.id), `${r.plan.id}${flag('draft') ? '-draft' : ''}.mp4`));
        await renderLocal(r.plan, out, flag('draft'));
        console.log(`✔ ${path.relative(ROOT, out)}`);
      }
      break;
    }
    case 'make': {
      const raw = loadSpecRaw(positional[0]);
      let r = runValidate(raw);
      if (!r.ok) die('Fix validation errors first');
      await tts(r.spec!, false, flag('upload'));
      r = runValidate(raw);
      if (!r.ok) die('Validation failed with real timings — fix and re-run');
      writePlan(r.plan!);
      await qa(r.plan!);
      const out = path.join(outDir(r.plan!.id), `${r.plan!.id}.mp4`);
      await renderLocal(r.plan!, out, flag('draft'));
      console.log(`✔ ${path.relative(ROOT, out)}`);
      break;
    }
    case 'deploy-site': {
      const { deploySite, getOrCreateBucket } = await import('@remotion/lambda');
      const region = (process.env.AWS_REGION ?? 'us-east-1') as any;
      const { bucketName } = await getOrCreateBucket({ region });
      // Ship only the SFX with the site; narration audio is fetched from S3 URLs (tts --upload).
      const sitePublic = path.join(ROOT, 'out', 'explainer', '_site_public');
      fs.rmSync(sitePublic, { recursive: true, force: true });
      fs.cpSync(path.join(PUBLIC, 'sfx'), path.join(sitePublic, 'sfx'), { recursive: true });
      fs.cpSync(path.join(PUBLIC, 'brand'), path.join(sitePublic, 'brand'), { recursive: true });
      const { serveUrl } = await deploySite({ entryPoint: ENTRY, bucketName, region, siteName: 'explainer', options: { publicDir: sitePublic } });
      console.log(`✔ EXPLAINER_SERVE_URL=${serveUrl}`);
      if (flag('cloud')) await putParams({ 'remotion-serve-url': serveUrl });
      break;
    }
    case 'deploy-remotion': {
      // Cloud render infrastructure: Remotion render function (needs the remotion-lambda-role from the Blocks stack).
      const { deployFunction } = await import('@remotion/lambda');
      const region = (process.env.AWS_REGION ?? 'us-east-1') as any;
      const { functionName, alreadyExisted } = await deployFunction({
        region, timeoutInSeconds: 900, memorySizeInMb: 3008, diskSizeInMb: 10240,
        createCloudWatchLogGroup: true, cloudWatchLogRetentionPeriodInDays: 14,
      });
      console.log(`✔ Remotion function ${functionName}${alreadyExisted ? ' (already existed)' : ''}`);
      await putParams({ 'remotion-function-name': functionName });
      break;
    }
    case 'set-voices': {
      // Narrator choices shown in the app (voice ids are not secret). Reads ids from .env.
      const voices = [
        { env: 'YOUNG_JAMAL_VOICE_ID', name: 'Young Jamal', description: 'Calm, confident tech narrator' },
        { env: 'ROSIUS_VOICE_ID', name: 'Rosius (your cloned voice)', description: 'Your own voice clone' },
      ].filter((v) => process.env[v.env]).map((v) => ({ id: process.env[v.env]!, name: v.name, description: v.description }));
      const def = process.env.ELEVENLABS_VOICE_ID;
      if (def && !voices.some((v) => v.id === def)) voices.unshift({ id: def, name: 'Default narrator', description: 'ELEVENLABS_VOICE_ID' });
      // --primary <id> [--primary-name "..."]: put this voice first and make it the pipeline default.
      const primary = opt('primary');
      if (primary) {
        const name = opt('primary-name') ?? 'Primary voice';
        const rest = voices.filter((v) => v.id !== primary && !v.name.startsWith(name.split(' ')[0]));
        voices.splice(0, voices.length, { id: primary, name, description: 'Default narrator' }, ...rest);
        await putParams({ 'elevenlabs-voice-id': primary });
      }
      if (!voices.length) die('No voice ids found in .env');
      await putParams({ voices: JSON.stringify(voices) });
      console.log(`✔ ${voices.length} voice(s): ${voices.map((v) => v.name).join(', ')}`);
      break;
    }
    case 'set-secrets': {
      // Copies API credentials from .env into SSM for the cloud pipeline (values are never printed).
      const key = process.env.ELEVENLABS_API_KEY;
      const voice = process.env.ELEVENLABS_VOICE_ID;
      const tavily = process.env.TAVILY_API_KEY;
      if (!key && !tavily) die('Set ELEVENLABS_API_KEY (+ ELEVENLABS_VOICE_ID) and/or TAVILY_API_KEY in .env');
      if (key) {
        if (voice) await putParams({ 'elevenlabs-voice-id': voice });
        await putParams({ 'elevenlabs-api-key': key }, true);
        console.log('✔ ElevenLabs credentials stored in SSM');
      }
      if (tavily) {
        await putParams({ 'tavily-api-key': tavily }, true);
        console.log('✔ Tavily key stored in SSM (research agent web search)');
      }
      break;
    }
    default:
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).join('\n').replace(/^ \* ?/gm, ''));
  }
}

async function putParams(values: Record<string, string>, secure = false) {
  const { SSMClient, PutParameterCommand } = await import('@aws-sdk/client-ssm');
  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  for (const [k, v] of Object.entries(values)) {
    await ssm.send(new PutParameterCommand({ Name: `/video-explainer/${k}`, Value: v, Type: secure ? 'SecureString' : 'String', Overwrite: true }));
    console.log(`  ✓ /video-explainer/${k}`);
  }
}

main().catch((e) => die(e?.stack ?? String(e)));
