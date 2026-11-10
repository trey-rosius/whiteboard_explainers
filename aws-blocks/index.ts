/**
 * Backend — aws-blocks/index.ts
 *
 * API for the explainer video studio: job queue and pipeline control (`explainer`) and the posting calendar (`calendar`).
 */
import {
  Scope,
  ApiNamespace,
  Realtime,
  Secret,
  AsyncJob,
  DistributedTable,
  CronJob,
  Metrics,
  AuthCognito,
} from '@aws-blocks/blocks';
import { z } from 'zod';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand, ListDurableExecutionsByFunctionCommand, SendDurableExecutionCallbackSuccessCommand, StopDurableExecutionCommand } from '@aws-sdk/client-lambda';
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@aws-blocks/core';
import { THEME_IDS, isThemeName, type ThemeChoice } from '../explainer/engine/theme-list';
import { applyScriptEdits, editableScenes, type SceneEdit } from '../explainer/engine/script-edit';
import { validate } from '../explainer/engine/validate';
import { parseNarration } from '../explainer/engine/narration';

const cleanTheme = (v: unknown): ThemeChoice => (isThemeName(v) ? v : 'auto');
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const scope = new Scope('video');
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Observability & Telemetry
export const metrics = new Metrics(scope, 'metrics', {
  namespace: 'AwsBlocks/VideoPlatform',
  defaultDimensions: { service: 'video-orchestrator' },
});

// ─── Explainer videos: cloud pipeline (SQS queue → durable Lambda → Remotion Lambda) ─────
// Rendering never happens in this API. `start` / `startBatch` enqueue jobs (SQS via AsyncJob); the dispatcher
// admits at most N concurrent pipelines (slot table, conditional writes), re-queueing the rest with a delay.
// The pipeline reports every stage to `report` → Realtime channel (`watch`); done/failed frees the slot.
// Resource names derive from BLOCKS_STACK_NAME (see index.cdk.ts), so no extra configuration is needed.
//
// Hardening (see also explainer/pipeline): normalised + validated input, idempotent submits (requestId) and a
// double-submit window, batch line parsing/dedupe, daily limit that ignores jobs which cost nothing, cancel/retry,
// and self-healing: lost "done/failed" reports are reconciled from status.json, stalled or lost jobs are failed
// with a reason, and their slots are freed.

const DEFAULTS = { maxConcurrent: 5, dailyLimit: 20 }; // overridable in SSM: /video-explainer/max-concurrent, daily-limit
const SLOT_LEASE_MS = 45 * 60 * 1000; // a slot held longer than this is considered abandoned
const REQUEUE_DELAY_S = 30;
const STALL_MS = 40 * 60 * 1000; // running job with no pipeline event for this long → failed
const QUEUE_MAX_MS = 6 * 3600 * 1000; // queued this long → its SQS message was lost → failed
const DEDUPE_WINDOW_MS = 2 * 60 * 1000; // same topic+settings again within this window → reuse the job
const MAX_BATCH = 10;

export const ExplainerJobSchema = z.object({
  jobId: z.string(),
  topic: z.string(),
  minutes: z.number(),
  format: z.enum(['16:9', '9:16']),
  theme: z.enum([...THEME_IDS, 'auto']),
  voiceName: z.string().optional(),
  voiceId: z.string().optional(),
  brief: z.string().optional(),
  batchId: z.string().optional(),
  state: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']).optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  requestId: z.string().optional(),
  executionArn: z.string().optional(),
  error: z.string().optional(),
  errorKind: z.string().optional(),
  retryable: z.boolean().optional(),
  retryOf: z.string().optional(),
  retriedAs: z.string().optional(),
  /** Bumped when a retry is deleted, so the next retry gets a fresh job instead of the deleted one's id. */
  retryRound: z.number().optional(),
  /** "self": the user records the narration. */
  narration: z.enum(['self']).optional(),
  resumeFrom: z.string().optional(),
  /** Hidden from the library (soft delete; nothing is removed from S3). */
  archived: z.boolean().optional(),
  createdDay: z.string(),
  createdAt: z.string(),
});
type ExplainerJob = z.infer<typeof ExplainerJobSchema>;

export const explainerJobsTable = new DistributedTable(scope, 'explainer-jobs', {
  schema: ExplainerJobSchema,
  key: { partitionKey: 'jobId' },
  indexes: { byDay: { partitionKey: 'createdDay', sortKey: 'createdAt' } },
});

/** One item per occupied pipeline slot (slotId "s0".."s{N-1}"); claimed with ifNotExists. */
export const explainerSlotsTable = new DistributedTable(scope, 'explainer-slots', {
  schema: z.object({ slotId: z.string(), jobId: z.string(), claimedAt: z.string() }),
  key: { partitionKey: 'slotId' },
});

export const PipelineEventSchema = z.object({
  at: z.string(),
  stage: z.string(),
  detail: z.string(),
  pct: z.number().optional(),
  errorKind: z.string().optional(),
  retryable: z.boolean().optional(),
});

export const explainerProgress = new Realtime(scope, 'explainer-progress', {
  namespaces: {
    job: Realtime.namespace(z.object({ jobId: z.string(), event: PipelineEventSchema })),
  },
});

/** Shared with the pipeline Lambda (it reads the same Secrets Manager secret) to authenticate `report` calls. */
export const progressToken = new Secret(scope, 'progress-token', { name: 'video-explainer/progress-token', generate: true });

// ─── Sign-in: passkey, with an emailed code as the backup. No passwords, and no open sign-up: ─────
// the only account is created in index.cdk.ts. Passkeys are tied to this domain, so moving the app re-enrols them.
const auth = new AuthCognito(scope, 'auth', {
  signInWith: 'email',
  authFlowType: 'USER_AUTH',
  preferredChallenge: 'EMAIL_OTP',
  selfSignUp: false,
  mfa: 'off',
  enablePasskeys: true,
  webAuthnRelyingParty: { id: 'studio.educloud.academy', origins: ['https://studio.educloud.academy'], userVerification: 'required' },
  removalPolicy: 'retain',
});
export const authApi = auth.createApi();

/**
 * A signed-in session, or the service token (same secret as the pipeline's `report` calls) for the repo's CLI
 * and test scripts. Reading that secret already takes AWS access to this account.
 */
async function requireAccess(context: any) {
  const presented = context?.request?.headers?.get?.('x-service-token');
  if (presented) {
    const expected = await progressToken.get();
    const a = Buffer.from(String(presented));
    const b = Buffer.from(String(expected ?? ''));
    if (expected && a.length === b.length && timingSafeEqual(a, b)) return;
  }
  await auth.requireAuth(context);
}

/** Locks every method, so a new one can't be left public by accident. `open` lists the deliberate exceptions. */
function locked<T extends Record<string, (...args: any[]) => Promise<any>>>(context: any, methods: T, open: Array<keyof T> = []): T {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(methods)) {
    out[name] = open.includes(name) ? fn : async (...args: unknown[]) => { await requireAccess(context); return fn(...args); };
  }
  return out as T;
}

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

function explainerResources() {
  const stack = process.env.BLOCKS_STACK_NAME;
  if (!stack) throw new Error('The explainer pipeline runs only in the deployed (cloud) environment.');
  return { bucket: `${stack}-explainer`, fn: `${stack}-explainer:prod`, fnName: `${stack}-explainer` };
}

const sign = (bucket: string, key: string, seconds = 6 * 3600) =>
  getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: seconds });

async function readExplainerStatus(jobId: string, withEvents = false) {
  const { bucket } = explainerResources();
  try {
    const r = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: `explainer/${jobId}/status.json` }));
    const status = JSON.parse(await r.Body!.transformToString()) as Record<string, any>;
    if (status.stage === 'done' && status.videoKey) status.videoUrl = await sign(bucket, status.videoKey);
    if (status.posterKey) status.posterUrl = await sign(bucket, status.posterKey);
    if (status.metadataKey) status.metadataUrl = await sign(bucket, status.metadataKey);
    if (!withEvents) delete status.events;
    return status;
  } catch (e: any) {
    if (e?.name === 'NoSuchKey') return { stage: 'queued', detail: 'Waiting in the queue', events: [] as any[] };
    throw e;
  }
}

/** The job table is the source of truth for terminal states the pipeline could not report (cancel, sweep). */
function overlayState(job: ExplainerJob, status: Record<string, any>) {
  if (job.state === 'cancelled') Object.assign(status, { stage: 'cancelled', detail: job.error ?? 'Cancelled' });
  else if (job.state === 'failed' && status.stage !== 'failed') Object.assign(status, { stage: 'failed', detail: job.error ?? 'Failed', error: job.error });
  if (job.state === 'failed' || job.state === 'cancelled') {
    status.errorKind = status.errorKind ?? job.errorKind;
    status.retryable = status.retryable ?? job.retryable ?? job.errorKind !== 'rejected';
  }
  return status;
}

type Voice = { id: string; name: string; description?: string };
let configCache: { at: number; voices: Voice[]; maxConcurrent: number; dailyLimit: number } | null = null;
async function loadConfig() {
  if (configCache && Date.now() - configCache.at < 60_000) return configCache;
  const names = ['voices', 'elevenlabs-voice-id', 'max-concurrent', 'daily-limit'].map((n) => `/video-explainer/${n}`);
  const res = await ssmClient.send(new GetParametersCommand({ Names: names }));
  const v = new Map((res.Parameters ?? []).map((p) => [p.Name!.replace('/video-explainer/', ''), p.Value!]));
  let voices: Voice[] = [];
  try { voices = v.has('voices') ? JSON.parse(v.get('voices')!) : []; } catch { voices = []; }
  const def = v.get('elevenlabs-voice-id');
  if (def && !voices.some((x) => x.id === def)) voices.unshift({ id: def, name: 'Default narrator' });
  const num = (k: string, d: number) => (Number.isFinite(Number(v.get(k))) && Number(v.get(k)) > 0 ? Number(v.get(k)) : d);
  configCache = { at: Date.now(), voices, maxConcurrent: num('max-concurrent', DEFAULTS.maxConcurrent), dailyLimit: num('daily-limit', DEFAULTS.dailyLimit) };
  return configCache;
}

const isConflict = (e: any) => e?.name === 'ConditionalCheckFailed' || e?.name === 'ConditionalCheckFailedException' || /ConditionalCheckFailed/.test(String(e?.name ?? e?.message));
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

/** Claim a free pipeline slot for jobId; returns the slot id or null when all are busy. */
async function claimSlot(jobId: string, max: number): Promise<string | null> {
  for (let i = 0; i < max; i++) {
    const slotId = `s${i}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await explainerSlotsTable.put({ slotId, jobId, claimedAt: new Date().toISOString() }, { ifNotExists: true });
        return slotId;
      } catch (e: any) {
        if (!isConflict(e)) throw e;
        const held = await explainerSlotsTable.get({ slotId });
        if (!held) continue; // freed between our write and read — try again
        if (held.jobId === jobId) return slotId; // redelivery: we already own it
        if (Date.now() - new Date(held.claimedAt).getTime() > SLOT_LEASE_MS) {
          try { await explainerSlotsTable.delete({ slotId }, { ifFieldEquals: { jobId: held.jobId } }); continue; } catch (e2) { if (!isConflict(e2)) throw e2; }
        }
        break; // busy
      }
    }
  }
  return null;
}

async function releaseSlot(jobId: string) {
  for (const slot of await Array.fromAsync(explainerSlotsTable.scan())) {
    if (slot.jobId !== jobId) continue;
    try { await explainerSlotsTable.delete({ slotId: slot.slotId }, { ifFieldEquals: { jobId } }); } catch (e) { if (!isConflict(e)) throw e; }
  }
}

async function setState(jobId: string, state: ExplainerJob['state'], extra: Partial<ExplainerJob> = {}) {
  const job = await explainerJobsTable.get({ jobId });
  if (!job) return;
  // never resurrect a cancelled job, never downgrade a finished one
  if (job.state === 'cancelled' && state !== 'cancelled') return;
  if (job.state === 'done' && state !== 'done') return;
  await explainerJobsTable.put({ ...job, ...extra, state });
}

async function findExecutionArn(job: ExplainerJob): Promise<string | undefined> {
  if (job.executionArn) return job.executionArn;
  try {
    const r = await lambdaClient.send(new ListDurableExecutionsByFunctionCommand({ FunctionName: explainerResources().fnName, DurableExecutionName: job.jobId }) /* Qualifier cannot be combined with a name filter */);
    return r.DurableExecutions?.[0]?.DurableExecutionArn;
  } catch { return undefined; }
}

async function executionStatus(job: ExplainerJob): Promise<string | undefined> {
  try {
    const r = await lambdaClient.send(new ListDurableExecutionsByFunctionCommand({ FunctionName: explainerResources().fnName, DurableExecutionName: job.jobId }) /* Qualifier cannot be combined with a name filter */);
    return r.DurableExecutions?.[0]?.Status;
  } catch { return undefined; }
}

async function stopExecution(job: ExplainerJob, reason: string) {
  const arn = await findExecutionArn(job);
  if (!arn) return;
  try {
    await lambdaClient.send(new StopDurableExecutionCommand({ DurableExecutionArn: arn, Error: { ErrorType: 'Cancelled', ErrorMessage: reason } }));
  } catch { /* already finished */ }
}

/**
 * Self-healing pass (throttled to once a minute per container):
 * - running job whose status.json is terminal → the pipeline's report was lost: adopt it and free the slot
 * - running job with no event for STALL_MS, or whose execution ended without a report → failed + slot freed
 * - queued job older than QUEUE_MAX_MS → its queue message was lost (DLQ) → failed
 * - slot held by a job that is no longer running → freed
 */
let lastSweep = 0;
async function sweep(force = false) {
  if (!force && Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  const jobs = await Array.fromAsync(explainerJobsTable.scan());
  const now = Date.now();
  for (const j of jobs) {
    try {
      if (j.state === 'running') {
        const st: any = await readExplainerStatus(j.jobId);
        if (st.stage === 'done' || st.stage === 'failed') {
          await setState(j.jobId, st.stage, { finishedAt: st.updatedAt, ...(st.stage === 'failed' ? { error: st.error ?? st.detail, errorKind: st.errorKind, retryable: st.retryable } : {}) });
          await releaseSlot(j.jobId);
          continue;
        }
        const last = new Date(st.updatedAt ?? j.startedAt ?? j.createdAt).getTime();
        if (now - last > 10 * 60 * 1000) {
          const ex = await executionStatus(j);
          const ended = ex && ex !== 'RUNNING';
          const waitingForUser = /^awaiting-/.test(String(st.stage)); // a paused job makes no progress on purpose
          if (ended || (!waitingForUser && now - last > STALL_MS)) {
            if (!ended) await stopExecution(j, 'Stalled: no progress for 40 minutes');
            await setState(j.jobId, 'failed', {
              finishedAt: new Date().toISOString(), errorKind: 'internal', retryable: true,
              error: ended ? `The pipeline ended unexpectedly (${ex}) without reporting a result.` : 'No progress for 40 minutes — the job was stopped.',
            });
            await releaseSlot(j.jobId);
          }
        }
      } else if (j.state === 'queued' && now - new Date(j.createdAt).getTime() > QUEUE_MAX_MS) {
        await setState(j.jobId, 'failed', { finishedAt: new Date().toISOString(), errorKind: 'internal', retryable: true, error: 'The job was never admitted from the queue.' });
      }
    } catch { /* best effort, next sweep retries */ }
  }
  const byId = new Map(jobs.map((j) => [j.jobId, j]));
  for (const slot of await Array.fromAsync(explainerSlotsTable.scan())) {
    const j = byId.get(slot.jobId);
    const fresh = j ? await explainerJobsTable.get({ jobId: j.jobId }) : undefined;
    if (!fresh || TERMINAL.has(fresh.state ?? '') || (fresh.state === 'queued' && now - new Date(slot.claimedAt).getTime() > 5 * 60 * 1000)) {
      try { await explainerSlotsTable.delete({ slotId: slot.slotId }, { ifFieldEquals: { jobId: slot.jobId } }); } catch { /* raced */ }
    }
  }
}

// Presigned PUTs from the browser: without this the SDK signs a checksum of the empty body and the upload fails.
const uploadClient = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });

async function readNarrationRequest(jobId: string): Promise<any | null> {
  try {
    const r = await s3Client.send(new GetObjectCommand({ Bucket: explainerResources().bucket, Key: `explainer/${jobId}/narration-request.json` }));
    return JSON.parse(await r.Body!.transformToString());
  } catch (e: any) { if (e?.name === 'NoSuchKey') return null; throw e; }
}

/** Newest take per scene. Keys are explainer/<job>/narration/<scene>/<time>.wav; duration follows from the fixed WAV format. */
async function latestTakes(jobId: string) {
  const prefix = `explainer/${jobId}/narration/`;
  const out = new Map<string, { key: string; seconds: number; at: string }>();
  let token: string | undefined;
  do {
    const r = await s3Client.send(new ListObjectsV2Command({ Bucket: explainerResources().bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      if (!o.Key?.endsWith('.wav')) continue;
      const scene = o.Key.slice(prefix.length).split('/')[0];
      const at = o.LastModified?.toISOString() ?? '';
      const cur = out.get(scene);
      if (!cur || at > cur.at || (at === cur.at && o.Key > cur.key)) out.set(scene, { key: o.Key, seconds: Math.round((Math.max(0, (o.Size ?? 44) - 44) / 88200) * 10) / 10, at });
    }
    token = r.NextContinuationToken;
  } while (token);
  return out;
}

async function readBucketJson<T = any>(key: string): Promise<T> {
  const r = await s3Client.send(new GetObjectCommand({ Bucket: explainerResources().bucket, Key: key }));
  return JSON.parse(await r.Body!.transformToString()) as T;
}
const writeBucketJson = (key: string, body: unknown) =>
  s3Client.send(new PutObjectCommand({ Bucket: explainerResources().bucket, Key: key, Body: JSON.stringify(body), ContentType: 'application/json' }));

/** The script can be edited only while the pipeline waits for the recordings. */
async function editableScript(jobId: string) {
  const job = await explainerJobsTable.get({ jobId: String(jobId ?? '') });
  if (!job) throw userError('This video does not exist.', 404);
  if (job.narration !== 'self' || TERMINAL.has(job.state ?? '')) throw userError('This script can no longer be edited.');
  const status = await readBucketJson<{ stage?: string }>(`explainer/${job.jobId}/status.json`).catch(() => ({} as { stage?: string }));
  const request = await readNarrationRequest(job.jobId);
  if (status.stage !== 'awaiting-narration' || !request) throw userError('The script can be edited only while it waits for your recordings.', 409);
  const { specKey } = await readBucketJson<{ specKey: string }>(`explainer/${job.jobId}/script-final.json`);
  if (!specKey?.startsWith(`explainer/${job.jobId}/`)) throw userError('This script can no longer be edited.');
  return { job, request, specKey, spec: await readBucketJson(specKey) };
}

/** A take older than the last edit of its scene's words no longer matches the script. */
const staleTake = (request: any, sceneId: string, take?: { at: string }) =>
  !!take && !!request?.editedAt?.[sceneId] && take.at < request.editedAt[sceneId];
const STALE_TAKE = 'You changed the words after recording this scene. Record it again.';

/** Looks of the latest finished videos, so Auto mode doesn't repeat itself. Best effort. */
async function recentThemes(): Promise<string[]> {
  try {
    const jobs = (await Array.fromAsync(explainerJobsTable.scan())).filter((j) => j.state === 'done').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
    const statuses = await Promise.all(jobs.map((j) => readExplainerStatus(j.jobId).catch(() => ({} as Record<string, any>))));
    return [...new Set(statuses.map((st: any) => st.theme).filter(isThemeName))];
  } catch { return []; }
}

/** SQS consumer: admits a queued job when a slot is free, otherwise re-queues it. */
export const explainerDispatch = new AsyncJob(scope, 'explainer-dispatch', {
  batchSize: 1,
  maxBatchingWindowSeconds: 0,
  maxRetries: 5,
  handler: async (payload: { jobId: string }) => {
    const job = await explainerJobsTable.get({ jobId: payload.jobId });
    if (!job || (job.state && job.state !== 'queued')) return; // started, finished or cancelled (idempotent redelivery)
    const { maxConcurrent } = await loadConfig();
    let slot = await claimSlot(job.jobId, maxConcurrent);
    if (!slot) {
      await sweep(true); // free slots whose completion report was lost, then try once more
      slot = await claimSlot(job.jobId, maxConcurrent);
    }
    if (!slot) {
      await explainerDispatch.submit({ jobId: job.jobId }, { delaySeconds: REQUEUE_DELAY_S });
      return;
    }
    try {
      const latest = await explainerJobsTable.get({ jobId: job.jobId });
      if (latest?.state === 'cancelled') { await releaseSlot(job.jobId); return; }
      await setState(job.jobId, 'running', { startedAt: new Date().toISOString() });
      const res = await lambdaClient.send(new InvokeCommand({
        FunctionName: explainerResources().fn,
        InvocationType: 'Event',
        DurableExecutionName: job.jobId, // idempotent: a duplicate start is rejected by Lambda
        Payload: new TextEncoder().encode(JSON.stringify({
          topic: job.topic, brief: job.brief, minutes: job.minutes, format: job.format, theme: job.theme, voiceId: job.voiceId, episodeId: job.jobId, narration: job.narration, resumeFrom: job.resumeFrom, recentThemes: await recentThemes(),
        })),
      }));
      if (res.DurableExecutionArn) await setState(job.jobId, 'running', { executionArn: res.DurableExecutionArn });
      await explainerProgress.publish('job', job.jobId, { jobId: job.jobId, event: { at: new Date().toISOString(), stage: 'queued', detail: `Admitted to pipeline slot ${slot}` } });
    } catch (e: any) {
      if (/already exists|ResourceConflict|DurableExecutionAlreadyStarted/i.test(String(e?.name ?? e?.message))) return;
      await setState(job.jobId, 'queued');
      await releaseSlot(job.jobId);
      throw e; // AsyncJob retries, then dead-letters (the sweep later marks it failed with a reason)
    }
  },
});

// ─── Input handling ─────────────────────────────────────────────────────────────

/** Errors the user should read (Blocks masks plain Errors as "Internal error" in production). */
const userError = (message: string, status = 400) => new ApiError(message, status);

type StartInput = {
  topic: string; minutes?: number; format?: '16:9' | '9:16'; theme?: ThemeChoice; brief?: string; voiceId?: string;
  /** "self" = the user records the narration; the pipeline pauses for it after the script is ready. */
  narration?: 'self';
  /** Client-generated id per submit click: repeating it returns the same job instead of creating another. */
  requestId?: string;
};

/** Cleans pasted topics: bullets/numbering, wrapping quotes, zero-width and control characters, repeated spaces. */
export function normalizeTopic(raw: unknown): string {
  let t = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, ' ');
  t = t.replace(/^\s*(?:[-*•▪►✓✔]|\[[ xX]?\]|\d{1,3}[.)\]:])(?:\s+|$)/, '').trim();
  t = t.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').replace(/\s+/g, ' ').trim();
  return t;
}

function checkTopic(t: string) {
  const max = /https?:\/\//i.test(t) ? 500 : 200;
  if (t.length < 3) throw userError('Please enter a topic (at least 3 characters).');
  if (t.length > max) throw userError(`Topic is too long (${t.length} characters, max ${max}). Put extra detail in the notes instead.`);
  if (!/\p{L}/u.test(t)) throw userError('The topic needs some words, not just numbers or symbols.');
}

const cleanBrief = (b: unknown) => {
  const s = String(b ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, 2000) : undefined;
};

const requestJobId = (requestId: string) => `ex-r${createHash('sha256').update(requestId).digest('hex').slice(0, 14)}`;
const sameSettings = (a: ExplainerJob, b: { topic: string; format: string; minutes: number }) =>
  a.topic.toLowerCase() === b.topic.toLowerCase() && a.format === b.format && Math.abs(a.minutes - b.minutes) < 0.01;

/** Jobs that never spent money don't count against the daily limit. */
const countsTowardLimit = (j: ExplainerJob) =>
  !(j.state === 'cancelled' && !j.startedAt) && !(j.state === 'failed' && ['rejected', 'config', 'quota'].includes(j.errorKind ?? ''));

async function usage() {
  const { dailyLimit } = await loadConfig();
  const createdDay = new Date().toISOString().slice(0, 10);
  const today = await Array.fromAsync(explainerJobsTable.query({ index: 'byDay', where: { createdDay: { equals: createdDay } } }));
  const used = today.filter(countsTowardLimit).length;
  return { today, used, limit: dailyLimit, remaining: Math.max(0, dailyLimit - used) };
}

async function createJobs(inputs: Array<StartInput & { retryOf?: string; batchId?: string; resumeFrom?: string }>, batchId?: string) {
  const { voices } = await loadConfig();
  explainerResources();
  const now = new Date();
  const createdDay = now.toISOString().slice(0, 10);
  const { today, remaining, limit } = await usage();

  // normalise + validate everything before writing anything (a batch is all-or-nothing)
  const prepared = inputs.map((input, k) => {
    const topic = normalizeTopic(input?.topic);
    checkTopic(topic);
    const format: '16:9' | '9:16' = input.format === '9:16' ? '9:16' : '16:9';
    const minutesRaw = Number(input.minutes ?? (format === '9:16' ? 0.92 : 2));
    const minutes = Math.min(10, Math.max(0.5, Number.isFinite(minutesRaw) ? minutesRaw : 2));
    const narration = input.narration === 'self' ? 'self' as const : undefined;
    const voice = narration ? undefined : input.voiceId ? voices.find((v) => v.id === input.voiceId) : voices[0];
    if (!narration && input.voiceId && !voice) throw userError('That narrator voice is no longer available — pick another one.');
    const requestId = input.requestId ? String(input.requestId).slice(0, 120) : undefined;
    const at = new Date(now.getTime() + k); // stable FIFO order within a batch
    const job: ExplainerJob = {
      jobId: requestId ? requestJobId(requestId) : `ex-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      topic, minutes, format,
      theme: cleanTheme(input.theme),
      voiceName: narration ? 'Your voice' : voice?.name, voiceId: voice?.id, narration, resumeFrom: input.resumeFrom,
      brief: cleanBrief(input.brief),
      batchId: input.batchId ?? batchId, retryOf: input.retryOf, requestId,
      state: 'queued', createdDay, createdAt: at.toISOString(),
    };
    return job;
  });

  // idempotency: a repeated requestId returns the job it created; a repeated topic+settings within 2 minutes too
  const result: Array<ExplainerJob & { reused?: boolean }> = [];
  const fresh: ExplainerJob[] = [];
  for (const job of prepared) {
    const existing = job.requestId ? await explainerJobsTable.get({ jobId: job.jobId }) : undefined;
    if (existing) { result.push({ ...existing, reused: true }); continue; }
    const dup = !job.retryOf && today.find((t) => sameSettings(t, job) && !['failed', 'cancelled'].includes(t.state ?? '') && now.getTime() - new Date(t.createdAt).getTime() < DEDUPE_WINDOW_MS);
    if (dup) { result.push({ ...dup, reused: true }); continue; }
    fresh.push(job); result.push(job);
  }
  if (fresh.length > remaining) {
    throw userError(remaining === 0
      ? `Daily limit reached (${limit} videos today). It resets at midnight UTC, or raise /video-explainer/daily-limit.`
      : `Only ${remaining} of today's ${limit} videos left — remove ${fresh.length - remaining} topic(s) or raise /video-explainer/daily-limit.`);
  }
  const written: ExplainerJob[] = [];
  for (const j of fresh) {
    try { await explainerJobsTable.put(j, { ifNotExists: true }); written.push(j); } catch (e) { if (!isConflict(e)) throw e; }
  }
  if (written.length) await explainerDispatch.submitBatch(written.map((j) => ({ jobId: j.jobId })));
  metrics.emit('ExplainerQueued', written.length, { unit: 'Count' });
  return result;
}

/** "topic | notes" lines → items; blank lines and duplicates removed (duplicates reported). */
function parseBatch(topics: unknown[], briefs: unknown[] = []) {
  const items: Array<{ topic: string; brief?: string }> = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  topics.forEach((raw, i) => {
    let line = String(raw ?? '');
    let brief = cleanBrief(briefs[i]);
    const bar = line.indexOf('|');
    if (!brief && bar > 0) { brief = cleanBrief(line.slice(bar + 1)); line = line.slice(0, bar); }
    const topic = normalizeTopic(line);
    if (topic.length < 3) return; // blank, a lone bullet, or a stray character
    const key = topic.toLowerCase();
    if (seen.has(key)) { skipped.push(topic); return; }
    seen.add(key);
    items.push({ topic, brief });
  });
  return { items, skipped };
}

export const explainer = new ApiNamespace(scope, 'explainer', (context) => locked(context, {
  /** Queue one whiteboard explainer video. Returns immediately; follow it with `watch(jobId)` / `get(jobId)`. */
  async start(input: StartInput) {
    const [job] = await createJobs([input]);
    return { jobId: job.jobId, reused: !!job.reused };
  },

  /**
   * Queue several videos at once (shared settings). Each line may be "topic | notes".
   * Blank lines and duplicates are dropped; they run at most N at a time.
   */
  async startBatch(input: { topics: string[]; briefs?: string[] } & Omit<StartInput, 'topic'>) {
    const { items, skipped } = parseBatch(Array.isArray(input?.topics) ? input.topics : [], Array.isArray(input?.briefs) ? input.briefs : []);
    if (!items.length) throw userError('Add at least one topic (one per line).');
    if (items.length > MAX_BATCH) throw userError(`A batch can hold up to ${MAX_BATCH} topics — you have ${items.length}. Split it into two batches.`);
    const batchId = `b-${input.requestId ? createHash('sha256').update(String(input.requestId)).digest('hex').slice(0, 10) : Date.now().toString(36)}`;
    const { briefs: _b, topics: _t, requestId, ...shared } = input;
    const jobs = await createJobs(items.map(({ topic, brief }, i) => ({
      ...shared, topic, brief: brief ?? shared.brief, requestId: requestId ? `${requestId}#${i}` : undefined,
    })), batchId);
    return { batchId, jobIds: jobs.map((j) => j.jobId), reused: jobs.filter((j) => j.reused).length, skippedDuplicates: skipped };
  },

  /** One page of the video library (newest first), optionally filtered by format, plus queue stats and today's quota. */
  async list(input: { page?: number; pageSize?: number; format?: '16:9' | '9:16'; archived?: boolean } = {}) {
    await sweep().catch(() => {});
    const pageSize = Math.min(24, Math.max(1, Math.floor(Number(input?.pageSize ?? 9)) || 9));
    const everything = (await Array.fromAsync(explainerJobsTable.scan())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const queuedFifo = everything.filter((j) => j.state === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const all = everything.filter((j) => !!j.archived === !!input?.archived && (!input?.format || j.format === input.format));
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(pages, Math.max(1, Math.floor(Number(input?.page ?? 1)) || 1));
    const slice = all.slice((page - 1) * pageSize, page * pageSize);
    const items = await Promise.all(slice.map(async (j) => {
      const status: Record<string, any> = overlayState(j, await readExplainerStatus(j.jobId).catch(() => ({ stage: 'queued', detail: '' })));
      if (j.state === 'queued') {
        const pos = queuedFifo.findIndex((q) => q.jobId === j.jobId) + 1;
        Object.assign(status, { stage: 'queued', detail: `Waiting for a free slot · #${pos} in queue`, queuePosition: pos });
      }
      return { ...j, status };
    }));
    const { maxConcurrent } = await loadConfig();
    const running = (await Array.fromAsync(explainerSlotsTable.scan())).length;
    const { used, limit, remaining } = await usage();
    return { items, page, pageSize, pages, total: all.length, queue: { running, queued: queuedFifo.length, max: maxConcurrent }, quota: { used, limit, remaining } };
  },

  /** Job + full status including the event log; `videoUrl`/`posterUrl` are 6-hour signed links. */
  async get(jobId: string) {
    const job = await explainerJobsTable.get({ jobId: String(jobId ?? '') });
    if (!job) throw userError('This video does not exist (it may have been deleted).');
    const status: Record<string, any> = overlayState(job, await readExplainerStatus(job.jobId, true));
    if (job.state === 'queued') {
      const queued = (await Array.fromAsync(explainerJobsTable.scan())).filter((j) => j.state === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const pos = queued.findIndex((q) => q.jobId === job.jobId) + 1;
      Object.assign(status, { stage: 'queued', detail: `Waiting for a free slot · #${pos} in queue`, queuePosition: pos });
    }
    return { ...job, status };
  },

  /** Cancel a queued or running job (stops the durable execution and frees its slot). Safe to call twice. */
  async cancel(jobId: string) {
    const job = await explainerJobsTable.get({ jobId: String(jobId ?? '') });
    if (!job) throw userError('This video does not exist.');
    if (TERMINAL.has(job.state ?? '')) return { jobId: job.jobId, state: job.state };
    const wasRunning = job.state === 'running';
    await explainerJobsTable.put({ ...job, state: 'cancelled', error: 'Cancelled by you', finishedAt: new Date().toISOString(), retryable: true });
    if (wasRunning) await stopExecution(job, 'Cancelled by user');
    await releaseSlot(job.jobId);
    await explainerProgress.publish('job', job.jobId, { jobId: job.jobId, event: { at: new Date().toISOString(), stage: 'cancelled', detail: 'Cancelled by you' } });
    return { jobId: job.jobId, state: 'cancelled' as const };
  },

  /** Re-run a failed or cancelled job with the same settings (research + recordings are cached where possible). */
  async retry(jobId: string) {
    const job = await explainerJobsTable.get({ jobId: String(jobId ?? '') });
    if (!job) throw userError('This video does not exist.');
    if (job.retriedAs) return { jobId: job.retriedAs, reused: true };
    if (job.state !== 'failed' && job.state !== 'cancelled') throw userError('Only failed or cancelled videos can be retried.');
    if (job.errorKind === 'rejected') throw userError('This topic was rejected by the research agent — rephrase it and start a new video.');
    const [fresh] = await createJobs([{
      topic: job.topic, brief: job.brief, minutes: job.minutes, format: job.format, theme: job.theme, voiceId: job.voiceId,
      requestId: `retry:${job.jobId}${job.retryRound ? `:${job.retryRound}` : ''}`, retryOf: job.jobId, batchId: job.batchId, narration: job.narration, resumeFrom: job.narration ? job.jobId : undefined,
    }]);
    await explainerJobsTable.put({ ...job, retriedAs: fresh.jobId });
    return { jobId: fresh.jobId, reused: !!fresh.reused };
  },

  /** Hide a finished, failed or cancelled video from the library (reversible with `restore`). */
  async archive(jobId: string) {
    const job = await explainerJobsTable.get({ jobId: String(jobId ?? '') });
    if (!job) throw userError('This video does not exist.', 404);
    if (!TERMINAL.has(job.state ?? '')) throw userError('Cancel the video first — only finished, failed or cancelled videos can be removed.');
    await explainerJobsTable.put({ ...job, archived: true });
    return { jobId: job.jobId, archived: true };
  },

  /** Undo `archive`. */
  async restore(jobId: string) {
    const job = await explainerJobsTable.get({ jobId: String(jobId ?? '') });
    if (!job) throw userError('This video does not exist.', 404);
    await explainerJobsTable.put({ ...job, archived: false });
    return { jobId: job.jobId, archived: false };
  },

  /**
   * Permanently removes a finished, failed or cancelled video: everything under its own folder, then its record. Can't be undone.
   * Refuses while something else still needs it. Safe to repeat if it stops part-way.
   */
  async deleteForever(jobId: string) {
    const id = String(jobId ?? '');
    const job = await explainerJobsTable.get({ jobId: id });
    if (!job) throw userError('This video does not exist (it may have been deleted).', 404);
    if (!TERMINAL.has(job.state ?? '')) throw userError('Cancel the video first. Only finished, failed or cancelled videos can be deleted.');
    const posts = await Array.fromAsync(scheduledPostsTable.scan());
    if (posts.some((p) => p.jobId === id && p.platforms.some((x) => !x.posted))) throw userError('This video is scheduled to be posted. Remove it from the calendar first.');

    // A failed or cancelled retry can still be retried, and reads the recordings and script of the job it came from.
    const folder = `explainer/${id}/`;
    const { bucket } = explainerResources();
    const reads = async (o: ExplainerJob) => {
      if (o.resumeFrom === id) return true;
      for (const name of ['narration-final.json', 'script-final.json']) {
        try {
          const r = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: `explainer/${o.jobId}/${name}` }));
          if ((await r.Body!.transformToString()).includes(folder)) return true;
        } catch (e: any) { if (e?.name !== 'NoSuchKey') throw e; }
      }
      return false;
    };
    for (const o of await Array.fromAsync(explainerJobsTable.scan())) {
      if (o.jobId !== id && o.state !== 'done' && await reads(o)) throw userError('Another video that is not finished still uses these recordings. Delete that one first.');
    }

    let token: string | undefined;
    do {
      const page = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: folder, ContinuationToken: token }));
      const Objects = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (Objects.length) {
        const r = await s3Client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }));
        if (r.Errors?.length) throw new Error(`Could not delete ${r.Errors.length} file(s): ${r.Errors[0].Message}`);
      }
      token = page.NextContinuationToken;
    } while (token);

    if (job.retryOf) {
      const parent = await explainerJobsTable.get({ jobId: job.retryOf });
      if (parent?.retriedAs === id) await explainerJobsTable.put({ ...parent, retriedAs: undefined, retryRound: (parent.retryRound ?? 0) + 1 });
    }
    await explainerJobsTable.delete({ jobId: id });
    return { jobId: id, deleted: true };
  },

  /** The script to record, plus takes already uploaded (survives a closed tab). */
  async narrationScript(jobId: string) {
    const job = await explainerJobsTable.get({ jobId: String(jobId ?? '') });
    if (!job) throw userError('This video does not exist.', 404);
    const request = await readNarrationRequest(job.jobId);
    if (!request) throw userError('The script is not ready yet.', 409);
    const takes = await latestTakes(job.jobId);
    const { bucket } = explainerResources();
    return {
      attempt: request.attempt, requestedAt: request.requestedAt, editedAt: request.editedAt ?? null,
      problems: { ...(request.problems ?? {}), ...Object.fromEntries(request.scenes.filter((sc: any) => staleTake(request, sc.id, takes.get(sc.id))).map((sc: any) => [sc.id, STALE_TAKE])) },
      scenes: await Promise.all(request.scenes.map(async (sc: any) => {
        const t = takes.get(sc.id);
        return { id: sc.id, name: sc.name, text: sc.text, spoken: sc.spoken, words: sc.words, estSeconds: sc.estSeconds, take: t ? { url: await sign(bucket, t.key), seconds: t.seconds, at: t.at } : null };
      })),
    };
  },

  /** The words of a script waiting to be recorded: narration (with its {cue} markers) and every piece of on-screen text. */
  async scriptForEditing(jobId: string) {
    const { spec } = await editableScript(jobId);
    const check = validate(spec);
    return { format: spec.format, targetSeconds: spec.targetSeconds ?? null, seconds: check.stats?.seconds ?? null, scenes: editableScenes(spec) };
  },

  /**
   * Checks (dryRun) or saves edits to a script waiting to be recorded. Saves only when the result passes the same validator
   * the pipeline uses, keeps a copy of the previous version, and refreshes the recording page. Takes of scenes whose words
   * changed must be recorded again.
   */
  async saveScript(input: { jobId: string; scenes: SceneEdit[]; dryRun?: boolean }) {
    const { job, request, specKey, spec } = await editableScript(input?.jobId);
    if (!Array.isArray(input?.scenes)) throw userError('Nothing to save.');
    const edited = applyScriptEdits(spec, input.scenes);
    const describe = (i: { where: string; message: string }) => `${i.where}: ${i.message}`;
    if (edited.problems.length) return { ok: false, saved: false, problems: edited.problems, warnings: [] as string[], seconds: null as number | null, rerecord: [] as string[] };
    const check = validate(edited.spec);
    const warnings = check.warnings.filter((w) => w.code === 'DURATION' || w.code === 'TEXT_TOO_LONG').map(describe);
    const seconds = check.stats?.seconds ?? null;
    if (!check.ok) return { ok: false, saved: false, problems: check.errors.slice(0, 12).map(describe), warnings, seconds, rerecord: [] };
    const takes = await latestTakes(job.jobId);
    const rerecord = edited.respoken.filter((id) => takes.has(id));
    if (input.dryRun) return { ok: true, saved: false, problems: [], warnings, seconds, rerecord };

    const now = new Date().toISOString();
    await writeBucketJson(`explainer/${job.jobId}/spec.before-edit-${Date.now().toString(36)}.json`, spec);
    await writeBucketJson(specKey, edited.spec);
    const scenes = (edited.spec.scenes as any[]).filter((x) => x.narration).map((x) => {
      const p = parseNarration(x.narration, edited.spec.pronounce);
      return { id: x.id, name: x.kind === 'title' ? x.title : x.heading ?? x.id, text: p.displayText, spoken: p.spokenText, words: p.tokens.length, estSeconds: Math.round(p.tokens.length / 2.6) };
    });
    const editedAt = { ...(request.editedAt ?? {}), ...Object.fromEntries(edited.respoken.map((id) => [id, now])) };
    await writeBucketJson(`explainer/${job.jobId}/narration-request.json`, { ...request, scenes, editedAt, editedSavedAt: now });
    return { ok: true, saved: true, problems: [], warnings, seconds, rerecord };
  },

  /** Short-lived upload link for one scene's take (a 16-bit PCM WAV prepared in the browser). */
  async narrationUploadUrl(input: { jobId: string; sceneId: string }) {
    const job = await explainerJobsTable.get({ jobId: String(input?.jobId ?? '') });
    if (!job || job.narration !== 'self') throw userError('This video does not use your own narration.');
    if (TERMINAL.has(job.state ?? '')) throw userError('This video is already finished.');
    const request = await readNarrationRequest(job.jobId);
    if (!request?.scenes.some((x: any) => x.id === input.sceneId)) throw userError('That scene is not part of this script.');
    const { bucket } = explainerResources();
    const key = `explainer/${job.jobId}/narration/${input.sceneId}/${Date.now().toString(36)}.wav`;
    const url = await getSignedUrl(uploadClient, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'audio/wav' }), { expiresIn: 15 * 60 });
    return { url, key };
  },

  /** All scenes recorded: wake the pipeline. `force` accepts takes it flagged as not matching the script. */
  async submitNarration(input: { jobId: string; force?: boolean }) {
    const job = await explainerJobsTable.get({ jobId: String(input?.jobId ?? '') });
    if (!job) throw userError('This video does not exist.', 404);
    const request = await readNarrationRequest(job.jobId);
    if (!request) throw userError('The script is not ready yet.', 409);
    const takes = await latestTakes(job.jobId);
    const missing = request.scenes.filter((x: any) => !takes.has(x.id)).map((x: any) => x.name);
    if (missing.length) throw userError(`Still to record: ${missing.join(', ')}`);
    const stale = request.scenes.filter((x: any) => staleTake(request, x.id, takes.get(x.id))).map((x: any) => x.name);
    if (stale.length && !input.force) throw userError(`You changed the words of ${stale.join(', ')} after recording. Record ${stale.length > 1 ? 'them' : 'it'} again.`);
    const payload = { takes: Object.fromEntries([...takes].map(([id, t]) => [id, t.key])), force: !!input.force };
    try {
      await lambdaClient.send(new SendDurableExecutionCallbackSuccessCommand({ CallbackId: request.callbackId, Result: new TextEncoder().encode(JSON.stringify(payload)) }));
    } catch (e: any) {
      // Already submitted (double click): the pipeline has it. Anything else is real.
      if (!/CallbackAlready|InvalidState|ResourceNotFound|CallbackTimeout/i.test(String(e?.name))) throw e;
    }
    return { ok: true };
  },

  /** Realtime channel that receives every pipeline event for this job. */
  async watch(jobId: string) {
    return explainerProgress.getChannel('job', String(jobId));
  },

  /** Narrator voices configured in SSM (/video-explainer/voices). */
  async voices() {
    return (await loadConfig()).voices.map(({ id, name, description }) => ({ id, name, description }));
  },

  /** Called by the pipeline Lambda (token-authenticated) to push live progress; done/failed frees the slot. */
  async report(input: { token: string; jobId: string; event: { at: string; stage: string; detail: string; pct?: number; errorKind?: string; retryable?: boolean } }) {
    const expected = await progressToken.get();
    const a = Buffer.from(String(input?.token ?? ''));
    const b = Buffer.from(String(expected ?? ''));
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw userError('Forbidden');
    const event = PipelineEventSchema.parse(input.event);
    const jobId = String(input.jobId);
    const job = await explainerJobsTable.get({ jobId });
    if (job?.state === 'cancelled') return { ok: true, ignored: true };
    if (event.stage === 'awaiting-narration') await releaseSlot(jobId); // don't block other videos while waiting for a person
    if (event.stage === 'done') {
      await setState(jobId, 'done', { finishedAt: event.at });
      await releaseSlot(jobId);
    } else if (event.stage === 'failed') {
      await setState(jobId, 'failed', { finishedAt: event.at, error: event.detail, errorKind: event.errorKind, retryable: event.retryable });
      await releaseSlot(jobId);
    }
    await explainerProgress.publish('job', jobId, { jobId, event });
    return { ok: true };
  },
}, ['report']));

// ─── Content calendar: schedule posts (manual publishing today, platform APIs later) ─────
// A post = when + where + what. "What" is an existing library video (jobId) or a topic to be made later (generateAt).
// `calendar-tick` (EventBridge, every 5 min) starts due generations even with the app closed, and runs the
// self-healing sweep. Times are stored in UTC; the browser displays them in the user's timezone.

const POST_PLATFORMS = ['youtube', 'youtube-shorts', 'tiktok', 'instagram'] as const;
const MAX_SCHEDULE_BATCH = 30;
const MAX_AHEAD_MS = 2 * 366 * 86400_000;
const GENERATION_GRACE_MS = 24 * 3600_000; // stop trying to make a video this long after its post time

export const ScheduledPostSchema = z.object({
  postId: z.string(),
  scheduledAt: z.string(),
  jobId: z.string().optional(),
  topic: z.string().optional(),
  brief: z.string().optional(),
  format: z.enum(['16:9', '9:16']),
  minutes: z.number().optional(),
  theme: z.enum([...THEME_IDS, 'auto']).optional(),
  voiceId: z.string().optional(),
  generateAt: z.string().optional(),
  leadHours: z.number().optional(),
  platforms: z.array(z.object({
    platform: z.enum(POST_PLATFORMS),
    posted: z.boolean(),
    postedAt: z.string().optional(),
    url: z.string().optional(),
  })),
  title: z.string().optional(),
  description: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  note: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type ScheduledPost = z.infer<typeof ScheduledPostSchema>;
type PostPlatform = (typeof POST_PLATFORMS)[number];

export const scheduledPostsTable = new DistributedTable(scope, 'explainer-posts', {
  schema: ScheduledPostSchema,
  key: { partitionKey: 'postId' },
});

type NewPost = {
  scheduledAt: string;
  platforms: string[];
  /** Schedule an existing library video… */
  jobId?: string;
  /** …or a topic to research and make. */
  topic?: string;
  brief?: string;
  format?: '16:9' | '9:16';
  minutes?: number;
  theme?: ThemeChoice;
  voiceId?: string;
  /** 0 = make it now; N = start N hours before the post time (fresher research). */
  leadHours?: number;
  note?: string;
  /** One id per submit: repeating it returns the same post. */
  requestId?: string;
};

function parseWhen(raw: unknown, now = Date.now()): string {
  const t = new Date(String(raw ?? '')).getTime();
  if (!Number.isFinite(t)) throw userError('Pick a valid date and time.');
  if (t < now - 60_000) throw userError('That time is in the past — pick a future date and time.');
  if (t > now + MAX_AHEAD_MS) throw userError('Posts can be scheduled up to 2 years ahead.');
  return new Date(t).toISOString();
}

function parsePlatforms(raw: unknown): ScheduledPost['platforms'] {
  const list = [...new Set(Array.isArray(raw) ? raw.map(String) : [])];
  const bad = list.filter((p) => !POST_PLATFORMS.includes(p as PostPlatform));
  if (bad.length) throw userError(`Unknown platform: ${bad.join(', ')}`);
  if (!list.length) throw userError('Choose at least one platform.');
  return list.map((platform) => ({ platform: platform as PostPlatform, posted: false }));
}

const cleanText = (v: unknown, max: number) => {
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, max) : undefined;
};
const cleanHashtags = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)).map((h) => String(h).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 30);

function platformWarnings(format: string, platforms: Array<{ platform: string }>) {
  const names = platforms.map((p) => p.platform);
  const out: string[] = [];
  if (format === '16:9' && names.some((n) => n !== 'youtube')) out.push('This is a 16:9 video — TikTok, Instagram Reels and Shorts expect vertical 9:16.');
  if (format === '9:16' && names.includes('youtube')) out.push('This is a vertical 9:16 video — consider posting it as a YouTube Short instead.');
  return out;
}

/** Follows retries so a post keeps tracking the latest attempt at its video. */
async function resolveJob(jobId?: string): Promise<ExplainerJob | undefined> {
  let job = jobId ? await explainerJobsTable.get({ jobId }) : undefined;
  for (let i = 0; job?.retriedAs && i < 6; i++) {
    const next = await explainerJobsTable.get({ jobId: job.retriedAs });
    if (!next) break;
    job = next;
  }
  return job ?? undefined;
}

type PostStatus = 'planned' | 'making' | 'ready' | 'due' | 'posted' | 'failed';
function postStatus(post: ScheduledPost, job: ExplainerJob | undefined, now = Date.now()): PostStatus {
  if (post.platforms.every((p) => p.posted)) return 'posted';
  const past = new Date(post.scheduledAt).getTime() <= now;
  if (!post.jobId) return past && now - new Date(post.scheduledAt).getTime() > GENERATION_GRACE_MS ? 'failed' : 'planned';
  if (!job || job.state === 'failed' || job.state === 'cancelled') return 'failed';
  if (job.state === 'done') return past ? 'due' : 'ready';
  return 'making';
}

async function describePost(post: ScheduledPost) {
  const job = await resolveJob(post.jobId);
  const status = postStatus(post, job);
  const video: Record<string, any> = job ? await readExplainerStatus(job.jobId).catch(() => ({})) : {};
  const missed = status === 'failed' && !post.jobId;
  return {
    ...post,
    status,
    title: post.title ?? video.title ?? job?.topic ?? post.topic ?? 'Untitled',
    videoJobId: job?.jobId,
    seconds: video.seconds,
    posterUrl: video.posterUrl,
    stage: video.stage,
    canRetry: !!job && status === 'failed' && job.errorKind !== 'rejected',
    error: missed
      ? (post.error ?? 'The video could not be started before its post time.')
      : status === 'failed'
        ? (job ? (job.error ?? video.detail ?? 'The video failed.') : 'This video no longer exists.')
        : post.error,
    warnings: platformWarnings(job?.format ?? post.format, post.platforms),
  };
}

/** Starts a post's video; failures (daily limit, removed voice…) are stored on the post and retried by the tick. */
async function startGeneration(post: ScheduledPost): Promise<ScheduledPost> {
  try {
    const [job] = await createJobs([{
      topic: post.topic!, brief: post.brief, minutes: post.minutes, format: post.format, theme: post.theme, voiceId: post.voiceId,
      requestId: `sched:${post.postId}`,
    }]);
    const next = { ...post, jobId: job.jobId, error: undefined, updatedAt: new Date().toISOString() };
    await scheduledPostsTable.put(next);
    return next;
  } catch (e: any) {
    const next = { ...post, error: e instanceof ApiError ? e.message : 'Could not start the video — will try again in 5 minutes.', updatedAt: new Date().toISOString() };
    await scheduledPostsTable.put(next);
    return next;
  }
}

export const calendarTick = new CronJob(scope, 'calendar-tick', {
  schedule: 'rate(5 minutes)',
  description: 'Starts scheduled video generations and heals stuck pipeline jobs',
  handler: async () => {
    const now = Date.now();
    for (const post of await Array.fromAsync(scheduledPostsTable.scan())) {
      if (post.jobId || !post.topic || !post.generateAt) continue;
      if (new Date(post.generateAt).getTime() > now) continue;
      if (now - new Date(post.scheduledAt).getTime() > GENERATION_GRACE_MS) continue; // missed: shown as failed, never made late
      await startGeneration(post);
    }
    await sweep().catch(() => {});
  },
});

export const calendar = new ApiNamespace(scope, 'calendar', (context) => locked(context, {
  /** Posts inside [from, to) plus what needs attention right now (anywhere on the calendar). */
  async list(input: { from?: string; to?: string } = {}) {
    const from = input?.from ? new Date(input.from).getTime() : -Infinity;
    const to = input?.to ? new Date(input.to).getTime() : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to)) throw userError('Invalid date range.');
    const all = (await Array.fromAsync(scheduledPostsTable.scan())).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const now = Date.now();
    const unfinished = all.filter((p) => p.platforms.some((x) => !x.posted));
    const attention = await Promise.all(unfinished.filter((p) => new Date(p.scheduledAt).getTime() <= now).map(describePost));
    const next = await Promise.all(unfinished.filter((p) => new Date(p.scheduledAt).getTime() > now).slice(0, 6).map(describePost));
    const items = await Promise.all(all.filter((p) => { const t = new Date(p.scheduledAt).getTime(); return t >= from && t < to; }).map(describePost));
    return { items, attention, next };
  },

  /** One post with its manual-posting kit: download link, caption, hashtags and sources. */
  async get(postId: string) {
    const post = await scheduledPostsTable.get({ postId: String(postId ?? '') });
    if (!post) throw userError('This scheduled post no longer exists.', 404);
    const d = await describePost(post);
    const job = await resolveJob(post.jobId);
    const video: Record<string, any> = job ? await readExplainerStatus(job.jobId).catch(() => ({})) : {};
    let meta: Record<string, any> = {};
    let downloadUrl: string | undefined;
    if (job && video.stage === 'done') {
      const { bucket } = explainerResources();
      if (video.metadataKey) {
        try { meta = JSON.parse(await (await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: video.metadataKey }))).Body!.transformToString()); } catch { /* older videos have no metadata */ }
      }
      if (video.videoKey) {
        const slug = String(d.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || job.jobId;
        downloadUrl = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: video.videoKey, ResponseContentDisposition: `attachment; filename="${slug}.mp4"` }), { expiresIn: 6 * 3600 });
      }
    }
    return {
      ...d,
      format: job?.format ?? post.format,
      videoUrl: video.videoUrl as string | undefined,
      downloadUrl,
      description: post.description ?? (meta.description as string | undefined) ?? '',
      hashtags: post.hashtags ?? (meta.hashtags as string[] | undefined) ?? [],
      sources: (meta.sources ?? []) as Array<{ title: string; url: string; publisher?: string }>,
    };
  },

  /** Up to 30 posts at once; all are validated before any is written. Each is safe to repeat with its requestId. */
  async createMany(input: { items: NewPost[] }) {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (!items.length) throw userError('Nothing to schedule.');
    if (items.length > MAX_SCHEDULE_BATCH) throw userError(`Schedule up to ${MAX_SCHEDULE_BATCH} posts at a time — you have ${items.length}.`);
    const nowIso = new Date().toISOString();
    const now = Date.now();
    const { voices } = await loadConfig();
    const prepared: ScheduledPost[] = [];
    for (const [i, item] of items.entries()) {
      const scheduledAt = parseWhen(item.scheduledAt, now);
      const platforms = parsePlatforms(item.platforms);
      const requestId = cleanText(item.requestId, 120);
      const postId = requestId ? `p-${createHash('sha256').update(requestId).digest('hex').slice(0, 16)}` : `p-${(now + i).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const note = cleanText(item.note, 500);
      if (item.jobId) {
        const job = await resolveJob(String(item.jobId));
        if (!job) throw userError('That video no longer exists.');
        if (job.state === 'failed' || job.state === 'cancelled') throw userError('That video failed — retry it first, then schedule it.');
        prepared.push({ postId, scheduledAt, platforms, jobId: job.jobId, format: job.format, note, createdAt: nowIso, updatedAt: nowIso });
      } else {
        const topic = normalizeTopic(item.topic);
        checkTopic(topic); // fail now, not at 3am
        if (item.voiceId && !voices.some((v) => v.id === item.voiceId)) throw userError('That narrator voice is no longer available — pick another one.');
        const leadHours = Math.min(24 * 14, Math.max(0, Number(item.leadHours ?? 0) || 0));
        const generateAt = new Date(Math.max(now, new Date(scheduledAt).getTime() - leadHours * 3600_000)).toISOString();
        const format: '16:9' | '9:16' = item.format === '9:16' ? '9:16' : '16:9';
        const minutesRaw = Number(item.minutes);
        prepared.push({
          postId, scheduledAt, platforms, topic, brief: cleanBrief(item.brief), format,
          minutes: Number.isFinite(minutesRaw) && minutesRaw > 0 ? Math.min(10, Math.max(0.5, minutesRaw)) : undefined,
          theme: cleanTheme(item.theme), voiceId: item.voiceId || undefined, generateAt, leadHours, note, createdAt: nowIso, updatedAt: nowIso,
        });
      }
    }
    const results: Array<{ postId: string; reused: boolean; error?: string; warnings: string[] }> = [];
    for (const post of prepared) {
      let saved = post;
      let reused = false;
      try { await scheduledPostsTable.put(post, { ifNotExists: true }); } catch (e) {
        if (!isConflict(e)) throw e;
        saved = (await scheduledPostsTable.get({ postId: post.postId })) ?? post;
        reused = true;
      }
      if (!reused && !saved.jobId && saved.generateAt && new Date(saved.generateAt).getTime() <= Date.now()) saved = await startGeneration(saved);
      results.push({ postId: saved.postId, reused, error: saved.error, warnings: platformWarnings(saved.format, saved.platforms) });
    }
    // Warn (don't block) when more videos start on one UTC day than the daily limit allows; the tick retries the rest.
    const { dailyLimit } = await loadConfig();
    const byDay = new Map<string, number>();
    for (const p of await Array.fromAsync(scheduledPostsTable.scan())) {
      if (p.jobId || !p.generateAt) continue;
      const day = p.generateAt.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const crowded = [...byDay].filter(([, n]) => n > dailyLimit).map(([d]) => d);
    return { results, warnings: crowded.length ? [`More than ${dailyLimit} videos are set to start on ${crowded.join(', ')} (UTC). Extra ones wait until the daily limit resets.`] : [] };
  },

  /** Reschedule or edit a post (time, platforms, caption, note). Posted platforms keep their posted state. */
  async update(input: { postId: string; scheduledAt?: string; platforms?: string[]; title?: string; description?: string; hashtags?: string[] | string; note?: string }) {
    const post = await scheduledPostsTable.get({ postId: String(input?.postId ?? '') });
    if (!post) throw userError('This scheduled post no longer exists.', 404);
    const next: ScheduledPost = { ...post, updatedAt: new Date().toISOString() };
    if (input.scheduledAt !== undefined && new Date(input.scheduledAt).getTime() !== new Date(post.scheduledAt).getTime()) {
      if (post.platforms.every((p) => p.posted)) throw userError('This post is already published — it cannot be moved.');
      next.scheduledAt = parseWhen(input.scheduledAt);
      if (!post.jobId && post.topic) {
        next.generateAt = new Date(Math.max(Date.now(), new Date(next.scheduledAt).getTime() - (post.leadHours ?? 0) * 3600_000)).toISOString();
        next.error = undefined;
      }
    }
    if (input.platforms !== undefined) {
      const wanted = parsePlatforms(input.platforms);
      next.platforms = wanted.map((w) => post.platforms.find((p) => p.platform === w.platform) ?? w);
    }
    if (input.title !== undefined) next.title = cleanText(input.title, 200);
    if (input.description !== undefined) next.description = cleanText(input.description, 5000) ?? '';
    if (input.hashtags !== undefined) next.hashtags = cleanHashtags(input.hashtags);
    if (input.note !== undefined) next.note = cleanText(input.note, 500);
    await scheduledPostsTable.put(next);
    return { postId: next.postId, scheduledAt: next.scheduledAt, warnings: platformWarnings(post.format, next.platforms) };
  },

  /** Tick a platform as posted by hand (optionally with the live URL), or undo it. */
  async markPosted(input: { postId: string; platform: string; posted: boolean; url?: string }) {
    const post = await scheduledPostsTable.get({ postId: String(input?.postId ?? '') });
    if (!post) throw userError('This scheduled post no longer exists.', 404);
    const entry = post.platforms.find((p) => p.platform === input.platform);
    if (!entry) throw userError('That platform is not part of this post.');
    let url = cleanText(input.url, 500);
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (url) {
      try { new URL(url); } catch { throw userError('That link does not look like a valid URL.'); }
    }
    // JSON round-trip: DynamoDB marshalling rejects undefined values nested inside lists
    const platforms: ScheduledPost['platforms'] = JSON.parse(JSON.stringify(post.platforms.map((p) => (p.platform === input.platform
      ? { ...p, posted: !!input.posted, postedAt: input.posted ? (p.postedAt ?? new Date().toISOString()) : undefined, url: input.posted ? (url ?? p.url) : undefined }
      : p))));
    await scheduledPostsTable.put({ ...post, platforms, updatedAt: new Date().toISOString() });
    return { postId: post.postId, allPosted: platforms.every((p) => p.posted) };
  },

  /** Remove a post from the calendar. The video stays in the library; a video not yet started is simply never made. */
  async remove(postId: string) {
    await scheduledPostsTable.delete({ postId: String(postId ?? '') });
    return { ok: true };
  },

  /** Finished videos that can be scheduled, newest first. */
  async videos() {
    const jobs = (await Array.fromAsync(explainerJobsTable.scan()))
      .filter((j) => j.state === 'done' && !j.archived)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
    const posts = await Array.fromAsync(scheduledPostsTable.scan());
    return Promise.all(jobs.map(async (j) => {
      const st: Record<string, any> = await readExplainerStatus(j.jobId).catch(() => ({}));
      return { jobId: j.jobId, title: st.title ?? j.topic, format: j.format, seconds: st.seconds, posterUrl: st.posterUrl, createdAt: j.createdAt, scheduledCount: posts.filter((p) => p.jobId === j.jobId).length };
    }));
  },
}));
