/**
 * Durable Studio — whiteboard explainer videos, generated end-to-end in the cloud.
 *
 *   Library  (/)            create a video (16:9 or 9:16), browse the paginated library
 *   Workflow (/?job=<id>)   the pipeline as a live workflow: every stage, event and render % arrives in real time
 *                           (Blocks Realtime channel, with a polling fallback), then the finished video.
 */
import './styles.css';
import { explainer } from 'aws-blocks';
import { THEME_IDS, THEME_META } from '../explainer/engine/theme-list';
import { isSignedOutError, requireSignIn, signOut } from './signin';
import { initRecorder, recorderView, stopRecorder, syncRecorder } from './recorder';
import { attentionCount, calendarView, initCalendar, leaveCalendar, refreshAttention, syncCalendarRoute } from './calendar';
import { html, render, nothing, type TemplateResult } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import { ArrowLeft, CalendarDays, Archive, AudioLines, Ban, CalendarPlus, Check, Clapperboard, ExternalLink, Globe, Plus, RotateCcw, ScanEye, Search, Sparkles, SquareTerminal, TriangleAlert, Webhook, X, LoaderCircle, Film, Trash2 } from 'lucide-static';

/** Inline Lucide icon (stroke = currentColor). */
const icon = (svg: string, cls = 'w-5 h-5') => html`<span class="inline-flex shrink-0 ${cls} [&>svg]:w-full [&>svg]:h-full">${unsafeSVG(svg)}</span>`;

const appEl = document.getElementById('app')!;

// ─── Types ─────────────────────────────────────────────────────────────────────

type Format = '16:9' | '9:16';
type Stage = 'queued' | 'preflight' | 'researching' | 'cancelled' | 'writing-script' | 'validating' | 'awaiting-approval' | 'awaiting-narration' | 'voicing' | 'timing' | 'visual-qa' | 'rendering' | 'publishing' | 'done' | 'failed';
interface PipelineEvent { at: string; stage: Stage; detail: string; pct?: number; errorKind?: string; retryable?: boolean }
interface ResearchSummary { kind: string; angle: string; facts: number; degraded: boolean; provider: string; searches: number; reads: number; conflicts: number; sources: Array<{ id: number; title: string; url: string; publisher?: string; date?: string }> }
interface JobStatus { stage: Stage; detail?: string; pct?: number; model?: string; queuePosition?: number; title?: string; seconds?: number; videoUrl?: string; posterUrl?: string; error?: string; errorKind?: string; retryable?: boolean; research?: ResearchSummary; metadataUrl?: string; narrationAttempt?: number; events?: PipelineEvent[]; updatedAt?: string }
interface Job { archived?: boolean; jobId: string; topic: string; minutes: number; format: Format; theme: string; voiceName?: string; createdAt: string; state?: string; retriedAs?: string; retryOf?: string; status: JobStatus }
interface Voice { id: string; name: string; description?: string }
interface Page { items: Job[]; page: number; pages: number; total: number; pageSize: number; queue?: { running: number; queued: number; max: number }; quota?: { used: number; limit: number; remaining: number } }

// ─── Workflow definition (7 steps, each covering one or more pipeline stages) ───

interface StepDef { id: string; title: string; service: string; icon: string; stages: Stage[]; idle: string; badge: (evs: PipelineEvent[], state: StepState) => string }
type StepState = 'done' | 'running' | 'idle' | 'failed' | 'revisit';

const countMatch = (evs: PipelineEvent[], re: RegExp) => evs.filter((e) => re.test(e.detail)).length;
const STEPS: StepDef[] = [
  { id: 'ingest', title: 'Queue & Ingest', service: 'Blocks API · SQS · slot admission · preflight', icon: Webhook, stages: ['queued', 'preflight'], idle: 'Job queued in SQS, admitted when a slot frees',
    badge: (_evs, st) => (st === 'running' ? (live?.job?.status?.queuePosition ? `Queue #${live.job.status.queuePosition}` : 'Admitting') : 'SQS · 202') },
  { id: 'research', title: 'Research Agent', service: 'Claude tool use · Tavily search · fact sheet', icon: Search, stages: ['researching'], idle: 'Searches the web and builds a sourced fact sheet',
    badge: (evs, st) => { const r = live?.job?.status?.research; if (st === 'idle') return 'Live sources'; if (r) return r.degraded ? 'No sources' : `${r.facts} facts · ${r.sources.length} src`; const n = countMatch(evs, /^(Searching|Reading)/); return n ? `${n} lookups` : 'Searching'; } },
  { id: 'script', title: 'Claude Script', service: 'Amazon Bedrock · validator', icon: Sparkles, stages: ['writing-script', 'validating', 'awaiting-approval'], idle: 'Teaching plan, narration with cues, storyboard',
    badge: (evs, st) => { const n = countMatch(evs, /^Pass \d/); return st === 'idle' ? 'Flagship AI' : n ? `${n} pass${n > 1 ? 'es' : ''}` : 'Drafting'; } },
  { id: 'voice', title: 'Voiceover', service: 'ElevenLabs · stitched takes', icon: AudioLines, stages: ['awaiting-narration', 'voicing', 'timing'], idle: 'Scene-by-scene narration with word timings',
    badge: (evs, st) => { const m = [...evs].reverse().find((e) => /scene (\d+)\/(\d+)/.test(e.detail))?.detail.match(/scene (\d+)\/(\d+)/); if (live?.stage === 'awaiting-narration') return 'Your turn'; return st === 'idle' ? 'Narration' : m ? `${m[1]}/${m[2]} scenes` : 'Recording'; } },
  { id: 'qa', title: 'Visual QA', service: 'Lambda stills · Claude vision', icon: ScanEye, stages: ['visual-qa'], idle: 'A director reviews every scene',
    badge: (evs, st) => { const last = evs[evs.length - 1]?.detail ?? ''; return st === 'idle' ? 'Review gate' : /approved/i.test(last) ? 'Approved' : /requested changes to (\d+)/i.test(last) ? `${last.match(/requested changes to (\d+)/i)![1]} fixes` : 'Reviewing'; } },
  { id: 'render', title: 'Remotion Lambda', service: 'Distributed rendering', icon: Clapperboard, stages: ['rendering'], idle: 'Frames rendered across parallel Lambdas',
    badge: (evs, st) => { const m = evs.map((e) => e.detail.match(/~(\d+) parallel/)).find(Boolean); return st === 'idle' ? 'Parallel chunks' : m ? `${m[1]} Lambdas` : 'Dispatching'; } },
  { id: 'publish', title: 'Publish', service: 'S3 · signed delivery · poster', icon: Globe, stages: ['publishing', 'done'], idle: 'Poster frame + instant playback',
    badge: () => 'Instant playback' },
];
const stepOf = (stage: Stage) => (stage === 'done' ? STEPS.length : Math.max(0, STEPS.findIndex((st) => st.stages.includes(stage))));

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued', preflight: 'Preflight', researching: 'Researching', cancelled: 'Cancelled', 'writing-script': 'Writing script', validating: 'Validating', 'awaiting-approval': 'Awaiting approval', 'awaiting-narration': 'Record narration',
  voicing: 'Recording voice', timing: 'Sync check', 'visual-qa': 'Visual QA', rendering: 'Rendering', publishing: 'Publishing',
  done: 'Ready', failed: 'Failed',
};

// ─── State ─────────────────────────────────────────────────────────────────────

/** 9:16 "60s" aims at 55 s of narration so the ±10% length check keeps the short at or under a minute. */
const SHORT_MIN = 0.92;
const composer = { mode: 'single' as 'single' | 'batch', topic: '', topics: '', brief: '', showBrief: false, minutes: 2, format: '16:9' as Format, theme: 'auto', voiceId: '' };
/** Batch lines as the server will see them: "topic | notes", bullets stripped, blanks and duplicates dropped. */
const batchLines = () => {
  const seen = new Set<string>();
  const out: string[] = [];
  let dups = 0;
  for (const raw of composer.topics.split('\n')) {
    const topic = raw.split('|')[0].replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '').trim();
    if (topic.length < 3) continue;
    if (seen.has(topic.toLowerCase())) { dups++; continue; }
    seen.add(topic.toLowerCase()); out.push(raw.trim());
  }
  return { lines: out, dups };
};
const batchTopics = () => batchLines().lines;
const newRequestId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
let voices: Voice[] = [];
let submitting = false;
let formError = '';
let formNotice = '';
let actionBusy = '';

let confirmingDelete = '';
const library = { page: 1, filter: 'all' as 'all' | 'archived' | Format, data: null as Page | null, loading: false, error: '' };
let libraryTimer: ReturnType<typeof setInterval> | null = null;

interface Live { jobId: string; job: Job | null; events: PipelineEvent[]; stage: Stage; live: boolean; error: string; selected?: string; showLog?: boolean; unsub?: () => void; poll?: ReturnType<typeof setInterval>; tick?: ReturnType<typeof setInterval> }
let live: Live | null = null;

// ─── Helpers ───────────────────────────────────────────────────────────────────

const esc = (s: string) => s;
const isActive = (s?: Stage) => !!s && s !== 'done' && s !== 'failed' && s !== 'cancelled';
const fmtDur = (sec?: number) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
function elapsed(from: string, to?: string) {
  const s = Math.max(0, ((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000);
  return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}
const eventKey = (e: PipelineEvent) => `${e.at}|${e.stage}|${e.detail}`;
function mergeEvents(a: PipelineEvent[], b: PipelineEvent[]) {
  const seen = new Set(a.map(eventKey));
  return [...a, ...b.filter((e) => !seen.has(eventKey(e)))].sort((x, y) => x.at.localeCompare(y.at));
}

// ─── Routing ───────────────────────────────────────────────────────────────────

function currentRoute() {
  const params = new URLSearchParams(location.search);
  const job = params.get('job');
  if (job) return { view: 'job' as const, jobId: job };
  return params.get('view') === 'calendar' ? { view: 'calendar' as const } : { view: 'library' as const };
}
function navigate(url: string) {
  history.pushState({}, '', url);
  onRoute();
}
window.addEventListener('popstate', () => onRoute());

let lastView = '';
function onRoute() {
  const r = currentRoute();
  const params = new URLSearchParams(location.search);
  const samePage = r.view === 'calendar' && lastView === 'calendar'; // opening a post drawer must not jump the page
  stopLive();
  if (r.view === 'calendar') syncCalendarRoute(params);
  else { leaveCalendar(); if (r.view === 'job') openJob(r.jobId); else loadLibrary(); }
  lastView = r.view;
  draw();
  if (!samePage) window.scrollTo({ top: 0 });
}

// ─── Data ──────────────────────────────────────────────────────────────────────

async function loadVoices() {
  try {
    voices = (await explainer.voices()) as Voice[];
    if (!composer.voiceId && voices[0]) composer.voiceId = voices[0].id;
  } catch { voices = []; }
  draw();
}

async function loadLibrary(silent = false) {
  if (!silent) { library.loading = true; draw(); }
  try {
    library.data = (await explainer.list({ page: library.page, pageSize: library.filter === '9:16' ? 8 : 9, format: library.filter === 'all' || library.filter === 'archived' ? undefined : library.filter, archived: library.filter === 'archived' })) as unknown as Page;
    library.error = '';
  } catch (e: any) {
    if (isSignedOutError(e)) { location.reload(); return; }
    library.error = e?.message ?? String(e);
  }
  library.loading = false;
  const running = library.data?.items.some((j) => isActive(j.status?.stage)) || !!library.data?.queue?.queued;
  if (running && !libraryTimer) libraryTimer = setInterval(() => currentRoute().view === 'library' && loadLibrary(true), 6000);
  if (!running && libraryTimer) { clearInterval(libraryTimer); libraryTimer = null; }
  draw();
}

async function submit(e: Event) {
  e.preventDefault();
  if (submitting || (composer.mode === 'single' ? composer.topic.trim().length < 3 : batchTopics().length === 0)) return;
  if (composer.mode === 'batch' && batchTopics().length > 10) { formError = `A batch holds up to 10 topics — you have ${batchTopics().length}.`; draw(); return; }
  submitting = true; formError = ''; formNotice = ''; draw();
  // one id per click: a network retry or double submit returns the same job(s) instead of creating more
  const requestId = newRequestId();
  try {
    const self = composer.voiceId === 'self';
    const shared = { brief: composer.brief.trim() || undefined, minutes: composer.minutes, format: composer.format, theme: composer.theme as any, voiceId: self ? undefined : composer.voiceId || undefined, narration: self ? 'self' as const : undefined, requestId };
    if (composer.mode === 'batch') {
      const r: any = await explainer.startBatch({ topics: batchTopics(), ...shared });
      const notes = [`Queued ${r.jobIds.length - (r.reused ?? 0)} video${r.jobIds.length === 1 ? '' : 's'}`];
      if (r.reused) notes.push(`${r.reused} already in progress (reused)`);
      if (r.skippedDuplicates?.length) notes.push(`skipped duplicate: ${r.skippedDuplicates.join(', ')}`);
      formNotice = notes.join(' · ');
      composer.topics = ''; composer.brief = '';
      library.page = 1; library.filter = 'all';
      await loadLibrary();
    } else {
      const { jobId } = await explainer.start({ topic: composer.topic.trim(), ...shared });
      composer.topic = ''; composer.brief = '';
      navigate(`?job=${encodeURIComponent(jobId)}`);
    }
  } catch (err: any) {
    formError = err?.message ?? String(err);
  } finally {
    submitting = false; draw();
  }
}

async function cancelJob(jobId: string) {
  if (actionBusy) return;
  actionBusy = 'cancel'; draw();
  try { await explainer.cancel(jobId); await refreshJob(); } catch (e: any) { if (live) live.error = e?.message ?? String(e); }
  actionBusy = ''; draw();
}
async function archiveJob(jobId: string) {
  if (actionBusy) return;
  actionBusy = 'archive'; draw();
  try { await explainer.archive(jobId); actionBusy = ''; navigate(location.pathname); return; } catch (e: any) { if (live) live.error = e?.message ?? String(e); }
  actionBusy = ''; draw();
}
async function restoreJob(jobId: string) {
  if (actionBusy) return;
  actionBusy = 'restore'; draw();
  try { await explainer.restore(jobId); await refreshJob(); } catch (e: any) { if (live) live.error = e?.message ?? String(e); }
  actionBusy = ''; draw();
}
async function deleteJob(jobId: string) {
  if (actionBusy) return;
  actionBusy = 'delete'; draw();
  try { await explainer.deleteForever(jobId); actionBusy = ''; confirmingDelete = ''; navigate(location.pathname); return; } catch (e: any) { if (live) live.error = e?.message ?? String(e); }
  actionBusy = ''; confirmingDelete = ''; draw();
}
async function retryJob(jobId: string) {
  if (actionBusy) return;
  actionBusy = 'retry'; draw();
  try { const r: any = await explainer.retry(jobId); actionBusy = ''; navigate(`?job=${encodeURIComponent(r.jobId)}`); return; } catch (e: any) { if (live) live.error = e?.message ?? String(e); }
  actionBusy = ''; draw();
}

// ─── Live job (Realtime + polling fallback) ───────────────────────────────────

function stopLive() {
  stopRecorder();
  if (!live) return;
  live.unsub?.();
  if (live.poll) clearInterval(live.poll);
  if (live.tick) clearInterval(live.tick);
  live = null;
}

async function refreshJob() {
  if (!live) return;
  const id = live.jobId;
  try {
    const job = (await explainer.get(id)) as unknown as Job;
    if (!live || live.jobId !== id) return;
    live.job = job;
    live.events = mergeEvents(live.events, job.status?.events ?? []);
    live.stage = job.status?.stage ?? 'queued';
    live.error = '';
    syncRecorder(id, live.stage, job.status?.narrationAttempt);
    if (!isActive(live.stage)) { if (live.poll) clearInterval(live.poll); if (live.tick) clearInterval(live.tick); live.poll = live.tick = undefined; }
  } catch (e: any) {
    live.error = e?.message ?? String(e);
  }
  draw();
}

async function openJob(jobId: string) {
  live = { jobId, job: null, events: [], stage: 'queued', live: false, error: '' };
  await refreshJob();
  if (!live || live.jobId !== jobId || !isActive(live.stage)) return;
  live.poll = setInterval(refreshJob, 5000); // safety net if a realtime message is missed
  live.tick = setInterval(draw, 1000); // elapsed timers
  try {
    const channel: any = await explainer.watch(jobId);
    const sub = channel.subscribe({
      onMessage: (msg: { jobId: string; event: PipelineEvent }) => {
        if (!live || live.jobId !== jobId) return;
        live.events = mergeEvents(live.events, [msg.event]);
        live.stage = msg.event.stage;
        if (msg.event.stage === 'done' || msg.event.stage === 'failed' || msg.event.stage === 'cancelled' || msg.event.stage === 'researching' || msg.event.stage === 'awaiting-narration') refreshJob();
        draw();
        scrollLog();
      },
      onDisconnect: () => { if (live) { live.live = false; draw(); } },
      onReconnect: () => { if (live) { live.live = true; refreshJob(); } },
    });
    if (live?.jobId !== jobId) { sub.unsubscribe(); return; }
    live.unsub = () => sub.unsubscribe();
    await sub.established;
    if (live?.jobId === jobId) { live.live = true; draw(); }
  } catch {
    /* polling keeps the view moving */
  }
}

function scrollLog() {
  requestAnimationFrame(() => {
    const el = document.getElementById('event-log');
    if (el) el.scrollTop = 0;
  });
}

// ─── Views ─────────────────────────────────────────────────────────────────────

function draw() {
  const r = currentRoute();
  const due = attentionCount();
  document.title = `${due ? `(${due}) ` : ''}${r.view === 'calendar' ? 'Content calendar' : 'Durable Studio'}`;
  render(
    html`
      ${header()}
      <main class="${r.view === 'library' ? 'max-w-6xl' : 'max-w-7xl'} mx-auto px-4 sm:px-6 pt-5 sm:py-10 pb-28">${r.view === 'job' ? jobView() : r.view === 'calendar' ? calendarView() : libraryView()}</main>
      ${tabBar()}
    `,
    appEl,
  );
}

function navLink(label: string, url: string, active: boolean, badge = 0) {
  return html`<a href=${url} aria-current=${active ? 'page' : 'false'} class="relative px-3 py-1.5 rounded-lg text-sm transition ${active ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}"
    @click=${(e: MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(url); }}>${label}${badge ? html`<span class="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-400 text-black text-[10px] font-semibold tabular-nums">${badge}</span>` : nothing}</a>`;
}

function header() {
  const view = currentRoute().view;
  return html`
    <header class="border-b border-zinc-800/80 bg-black/90 backdrop-blur sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <button class="flex items-center space-x-3 hover:opacity-80 transition" title="Video library" @click=${() => navigate(location.pathname)}>
          <div class="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white text-xs font-mono">⚡</div>
          <span class="sm:hidden font-semibold text-sm tracking-tight text-white">Durable Studio</span>
          <span class="hidden sm:inline font-semibold text-sm tracking-tight text-white">AWS Blocks</span>
          <span class="hidden sm:inline text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">Durable Studio</span>
        </button>
        <nav class="hidden sm:flex items-center gap-1 ml-4 mr-auto" aria-label="Main">
          ${navLink('Library', location.pathname, view !== 'calendar')}
          ${navLink('Calendar', `${location.pathname}?view=calendar`, view === 'calendar', attentionCount())}
        </nav>
        <div class="hidden lg:flex items-center space-x-4 text-xs font-mono text-zinc-400">
          <div class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span><span class="text-zinc-300">Lambda durable functions</span></div>
          <div class="h-3 w-px bg-zinc-800"></div><span>Remotion Lambda</span>
          <div class="h-3 w-px bg-zinc-800"></div><span class="text-zinc-500">us-east-1</span>
        </div>
        <button class="ml-4 py-2 text-xs text-zinc-500 hover:text-white transition whitespace-nowrap" @click=${signOut}>Sign out</button>
      </div>
    </header>
  `;
}

/** Phone navigation: thumb-reach tabs, in place of the links in the desktop header. */
function tabBar() {
  const view = currentRoute().view;
  const tab = (label: string, svg: string, url: string, active: boolean, badge = 0) => html`
    <a href=${url} aria-current=${active ? 'page' : 'false'} class="relative flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${active ? 'text-white' : 'text-zinc-500'}"
      @click=${(e: MouseEvent) => { e.preventDefault(); navigate(url); }}>
      ${icon(svg, 'w-5 h-5')}${label}
      ${badge ? html`<span class="absolute top-1.5 left-1/2 ml-2 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-400 text-black text-[10px] font-semibold inline-flex items-center justify-center tabular-nums">${badge}</span>` : nothing}
    </a>`;
  return html`
    <nav aria-label="Main" class="sm:hidden fixed bottom-0 inset-x-0 z-50 flex border-t border-zinc-800 bg-black/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      ${tab('Library', Clapperboard, location.pathname, view !== 'calendar')}
      ${tab('Calendar', CalendarDays, `${location.pathname}?view=calendar`, view === 'calendar', attentionCount())}
    </nav>`;
}

function seg<T extends string | number>(options: Array<{ value: T; label: string; hint?: string }>, value: T, onPick: (v: T) => void) {
  return html`
    <div class="flex w-full sm:inline-flex sm:w-auto rounded-xl bg-black border border-zinc-800 p-1">
      ${options.map(
        (o) => html`<button type="button" title=${o.hint ?? ''} @click=${() => { onPick(o.value); draw(); }}
          class="flex-1 sm:flex-none whitespace-nowrap px-2 sm:px-3 py-2.5 sm:py-1.5 rounded-lg text-xs font-medium transition ${o.value === value ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}">${o.label}</button>`,
      )}
    </div>
  `;
}

function libraryView() {
  return html`
    <section class="space-y-6 sm:space-y-10">
      <div class="hidden sm:block space-y-2">
        <h1 class="text-3xl sm:text-4xl font-semibold tracking-tight text-white">Whiteboard explainers, rendered in the cloud.</h1>
        <p class="text-sm text-zinc-400 max-w-[65ch]">Claude writes and storyboards, ElevenLabs narrates, a validator and a vision QA pass harden every scene, and Remotion Lambda renders — orchestrated by a Lambda durable function.</p>
      </div>
      ${composerCard()}
      ${libraryGrid()}
    </section>
  `;
}

function themePicker() {
  const tile = (id: string, name: string, vibe: string, preview: string, ink: string, accent: string) => html`
    <button type="button" aria-pressed=${composer.theme === id} title=${vibe} @click=${() => { composer.theme = id; draw(); }}
      class="shrink-0 w-[92px] rounded-xl border overflow-hidden text-left transition ${composer.theme === id ? 'border-white ring-1 ring-white' : 'border-zinc-800 hover:border-zinc-600'}">
      <span class="block h-14 relative" style="background:${preview}">
        <span class="absolute left-2 top-2 text-[13px] font-semibold" style="color:${ink}">Aa</span>
        <span class="absolute right-2 bottom-2 w-3.5 h-3.5 rounded border-2" style="border-color:${accent}"></span>
      </span>
      <span class="block px-2 py-1.5 text-[11px] text-zinc-300 truncate bg-black">${name}</span>
    </button>`;
  return html`<div class="flex gap-2 overflow-x-auto scrollbar-thin pb-1" role="group" aria-label="Video style">
    ${tile('auto', 'Auto', 'Matches the look to the topic and avoids repeating recent videos', 'conic-gradient(#67E8F9,#FF5EC4,#FFD93D,#4ADE80,#67E8F9)', '#000', '#000')}
    ${THEME_IDS.map((id) => tile(id, THEME_META[id].name, THEME_META[id].vibe, THEME_META[id].preview, THEME_META[id].ink, THEME_META[id].accent))}
  </div>`;
}

function composerCard() {
  const voice = voices.find((v) => v.id === composer.voiceId);
  return html`
    <form class="rounded-2xl bg-zinc-900/40 border border-zinc-800 p-4 sm:p-6 space-y-5" @submit=${submit}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <h2 class="text-sm font-semibold text-white tracking-tight">New ${composer.mode === 'batch' ? 'batch' : 'video'}</h2>
          ${seg<'single' | 'batch'>([{ value: 'single', label: 'Single' }, { value: 'batch', label: 'Batch (up to 10)' }], composer.mode, (v) => (composer.mode = v))}
        </div>
        <span class="text-[11px] font-mono text-zinc-500"><span class="hidden sm:inline">${composer.mode === 'batch' ? 'queued via SQS · runs 5 at a time' : 'researched → scripted → voiced → rendered · ≈ 4–6 min'}${library.data?.quota ? ' · ' : ''}</span>${library.data?.quota ? html`<span class=${library.data.quota.remaining ? '' : 'text-rose-400'}>${library.data.quota.remaining}/${library.data.quota.limit} left today</span>` : nothing}</span>
      </div>
      ${composer.mode === 'batch'
        ? html`<textarea rows="5" class="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none font-mono"
            placeholder=${'One topic per line — add notes after a |, e.g.\nConsistent hashing\nKafka consumer groups | use a ride-sharing example\nhttps://github.blog/changelog/ | the npm package firewall'}
            .value=${composer.topics} @input=${(e: Event) => { composer.topics = (e.target as HTMLTextAreaElement).value; draw(); }}></textarea>
          <div class="text-[11px] font-mono ${batchTopics().length > 10 ? 'text-rose-400' : 'text-zinc-500'}">${batchTopics().length} topic${batchTopics().length === 1 ? '' : 's'}${batchLines().dups ? ` · ${batchLines().dups} duplicate${batchLines().dups > 1 ? 's' : ''} ignored` : ''}${batchTopics().length > 10 ? ' · max 10 per batch' : ''} · each one is researched first · same format, length, theme and voice</div>`
        : nothing}
      ${composer.mode === 'batch' ? nothing : html`<input
        class="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-base text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        placeholder="A topic, a headline or a link"
        .value=${composer.topic}
        @input=${(e: Event) => { composer.topic = (e.target as HTMLInputElement).value; draw(); }}
        maxlength="500"
      />`}
      ${composer.mode === 'single' && /https?:\/\//i.test(composer.topic) ? html`<div class="-mt-3 text-[11px] font-mono text-zinc-500">The research agent will read that link first.</div>` : nothing}
      ${composer.showBrief
        ? html`<textarea rows="3" class="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            placeholder="Optional notes: audience, running example, must-cover points, facts you already know (they are still verified)…" .value=${composer.brief} maxlength="2000"
            @input=${(e: Event) => (composer.brief = (e.target as HTMLTextAreaElement).value)}></textarea>`
        : html`<button type="button" class="py-1 text-left text-xs font-mono text-zinc-500 hover:text-zinc-200" @click=${() => { composer.showBrief = true; draw(); }}>+ add direction (audience, example, must-cover points)</button>`}
      <div class="flex flex-wrap items-end gap-4 sm:gap-6">
        <div class="w-full sm:w-auto space-y-1.5">
          <div class="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Format</div>
          ${seg<Format>([{ value: '16:9', label: '▭ 16:9 · YouTube' }, { value: '9:16', label: '▯ 9:16 · TikTok / Shorts' }], composer.format, (v) => {
            composer.format = v;
            if (v === '9:16' && composer.minutes > 3) composer.minutes = SHORT_MIN;
            if (v === '16:9' && composer.minutes < 2) composer.minutes = 2;
          })}
        </div>
        <div class="w-full sm:w-auto space-y-1.5">
          <div class="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Length</div>
          ${seg<number>(composer.format === '9:16' ? [{ value: 0.5, label: '30s' }, { value: SHORT_MIN, label: '60s' }, { value: 1.5, label: '90s' }, { value: 2, label: '2m' }, { value: 3, label: '3m' }] : [1, 2, 3, 5].map((m) => ({ value: m, label: `${m} min` })), composer.minutes, (v) => (composer.minutes = v))}
        </div>
        <div class="w-full sm:w-auto space-y-1.5">
          <div class="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Voice</div>
          <select class="w-full sm:w-auto bg-black border border-zinc-800 rounded-xl px-3 py-2.5 sm:py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500" title=${voice?.description ?? ''}
            @change=${(e: Event) => { composer.voiceId = (e.target as HTMLSelectElement).value; draw(); }}>
            <option value="self" ?selected=${composer.voiceId === 'self'}>My own voice (I'll record it)</option>
            ${voices.length ? voices.map((v) => html`<option value=${v.id} ?selected=${v.id === composer.voiceId}>${v.name}</option>`) : html`<option value="">Default narrator</option>`}
          </select>
        </div>
      </div>
      <div class="space-y-1.5">
        <div class="text-[11px] font-mono uppercase tracking-wider text-zinc-500">Theme · <span class="normal-case tracking-normal text-zinc-300">${composer.theme === 'auto' ? 'Auto' : THEME_META[composer.theme as keyof typeof THEME_META].name}</span></div>
        ${themePicker()}
      </div>
      <div class="flex justify-end">
        <button class="w-full sm:w-auto rounded-xl bg-white text-black text-sm font-semibold px-6 py-3 sm:py-2.5 hover:bg-zinc-200 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed"
          ?disabled=${submitting || library.data?.quota?.remaining === 0 || (composer.mode === 'single' ? composer.topic.trim().length < 3 : batchTopics().length === 0 || batchTopics().length > 10)}>${submitting ? 'Queueing…' : composer.mode === 'batch' ? `Queue ${batchTopics().length || ''} video${batchTopics().length === 1 ? '' : 's'} →` : 'Generate video →'}</button>
      </div>
      ${composer.voiceId === 'self' ? html`<p class="text-xs text-zinc-400">The script is researched and written first, then the video waits for you to record it. Other videos keep running in the meantime.</p>` : nothing}
      ${formError ? html`<p class="text-xs font-mono text-rose-400">${formError}</p>` : nothing}
      ${formNotice ? html`<p class="text-xs font-mono text-emerald-400">${formNotice}</p>` : nothing}
    </form>
  `;
}

function libraryGrid() {
  const d = library.data;
  const vertical = library.filter === '9:16';
  return html`
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-semibold text-white tracking-tight">Library</h2>
          ${d ? html`<span class="text-[11px] font-mono text-zinc-500">${d.total} video${d.total === 1 ? '' : 's'}</span>` : nothing}
          ${d?.queue ? html`<span class="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-lg bg-black border border-zinc-800 text-zinc-400">
              <span class="w-1.5 h-1.5 rounded-full ${d.queue.running ? 'bg-sky-400 animate-pulse' : 'bg-zinc-600'}"></span>
              ${d.queue.running}/${d.queue.max} running${d.queue.queued ? ` · ${d.queue.queued} waiting` : ''}</span>` : nothing}
        </div>
        ${seg<'all' | 'archived' | Format>([{ value: 'all', label: 'All' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: 'archived', label: 'Archived' }], library.filter, (v) => {
          library.filter = v; library.page = 1; loadLibrary();
        })}
      </div>
      ${library.error ? html`<p class="text-xs font-mono text-rose-400">${library.error}</p>` : nothing}
      ${!d && library.loading
        ? html`<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">${[0, 1, 2].map(() => html`<div class="rounded-2xl border border-zinc-800 aspect-video shimmer-bg animate-shimmer"></div>`)}</div>`
        : d && d.items.length === 0
          ? html`<div class="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">${library.filter === 'archived' ? 'Nothing archived. Videos you archive wait here until you restore or delete them.' : 'No videos yet — describe a topic above to make your first one.'}</div>`
          : html`<div class="grid gap-3 sm:gap-4 items-start grid-cols-2 ${vertical ? 'md:grid-cols-4' : 'md:grid-cols-3'} ${library.loading ? 'opacity-60' : ''} transition">
              ${(d?.items ?? []).map((j) => card(j))}
            </div>`}
      ${d && d.pages > 1 ? pagination(d) : nothing}
    </section>
  `;
}

function stageBadge(s: JobStatus | undefined) {
  const stage = s?.stage ?? 'queued';
  const cls = stage === 'done' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : stage === 'failed' ? 'border-rose-500/40 text-rose-300 bg-rose-500/10' : stage === 'cancelled' ? 'border-zinc-700 text-zinc-400 bg-zinc-900/80' : stage === 'awaiting-narration' ? 'border-amber-400/60 text-amber-200 bg-amber-400/15' : 'border-sky-500/30 text-sky-300 bg-sky-500/10';
  const pct = stage === 'queued' && s?.queuePosition ? ` #${s.queuePosition}` : isActive(stage) && typeof s?.pct === 'number' && (stage === 'rendering' || stage === 'voicing') ? ` ${s.pct}%` : '';
  return html`<span class="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-lg border backdrop-blur ${cls}">
    ${isActive(stage) ? html`<span class="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>` : nothing}${STAGE_LABEL[stage] ?? stage}${pct}</span>`;
}

function card(j: Job) {
  const s = j.status ?? ({ stage: 'queued' } as JobStatus);
  const vertical = j.format === '9:16';
  const progress = Math.round((Math.min(stepOf(s.stage), STEPS.length) / STEPS.length) * 100);
  return html`
    <button class="group text-left rounded-2xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 overflow-hidden transition animate-rise" @click=${() => navigate(`?job=${encodeURIComponent(j.jobId)}`)}>
      <div class="relative ${vertical ? 'aspect-[9/16]' : 'aspect-video'} bg-zinc-950 overflow-hidden">
        ${s.posterUrl
          ? html`<img src=${s.posterUrl} class="w-full h-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" alt="" />`
          : html`<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 ${isActive(s.stage) ? 'shimmer-bg animate-shimmer' : ''}">
              <div class="text-zinc-600">${icon(s.stage === 'failed' ? X : s.stage === 'cancelled' ? Ban : Film, 'w-8 h-8')}</div>
              ${s.stage === 'failed' && s.detail ? html`<div class="px-4 text-center text-[11px] text-rose-300/80 line-clamp-3">${s.detail}</div>` : nothing}
              ${isActive(s.stage) ? html`<div class="w-2/3 h-1 rounded-full bg-zinc-800 overflow-hidden"><div class="h-1 bg-emerald-400 transition-all duration-500" style="width:${Math.max(6, progress)}%"></div></div>` : nothing}
            </div>`}
        <div class="hidden sm:block absolute top-2.5 left-2.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/80 border border-zinc-800 text-zinc-300">${j.format}</div>
        <div class="${s.stage === 'done' ? 'hidden sm:block' : ''} absolute top-2 right-2 sm:top-2.5 sm:right-2.5">${stageBadge(s)}</div>
        ${s.seconds ? html`<div class="absolute bottom-2.5 right-2.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/80 text-zinc-200">${fmtDur(s.seconds)}</div>` : nothing}
      </div>
      <div class="p-2.5 sm:p-4 space-y-1">
        <div class="text-sm font-medium text-white line-clamp-2 group-hover:text-zinc-200">${s.title ?? j.topic}</div>
        <div class="text-[11px] font-mono text-zinc-500 truncate">${ago(j.createdAt)}${j.voiceName ? ` · ${j.voiceName}` : ''}</div>
      </div>
    </button>
  `;
}

function pagination(d: Page) {
  const pages: Array<number | '…'> = [];
  for (let p = 1; p <= d.pages; p++) {
    if (p === 1 || p === d.pages || Math.abs(p - d.page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  const go = (p: number) => { library.page = p; loadLibrary(); window.scrollTo({ top: document.body.scrollHeight / 3, behavior: 'smooth' }); };
  const btn = 'min-w-[2.25rem] h-9 px-3 rounded-xl border text-xs font-mono transition';
  return html`
    <nav class="flex items-center justify-center gap-1.5 pt-2">
      <button class="${btn} border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40" ?disabled=${d.page <= 1} @click=${() => go(d.page - 1)}>← Prev</button>
      ${pages.map((p) => (p === '…' ? html`<span class="px-1 text-zinc-600">…</span>` : html`<button class="${btn} ${p === d.page ? 'border-zinc-600 bg-zinc-800 text-white' : 'border-zinc-800 text-zinc-400 hover:text-white'}" @click=${() => go(p)}>${p}</button>`))}
      <button class="${btn} border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-40" ?disabled=${d.page >= d.pages} @click=${() => go(d.page + 1)}>Next →</button>
    </nav>
  `;
}

// ─── Workflow view ─────────────────────────────────────────────────────────────

function stepStates(stage: Stage): { states: StepState[]; current: number } {
  const evs = live!.events;
  const failed = stage === 'failed' || stage === 'cancelled';
  const current = failed ? stepOf([...evs].reverse().find((e) => e.stage !== 'failed' && e.stage !== 'cancelled')?.stage ?? 'queued') : stepOf(stage);
  const reached = Math.max(current, ...evs.map((e) => stepOf(e.stage)).filter((n) => n < STEPS.length));
  const states = STEPS.map((_, i): StepState =>
    failed && i === current ? 'failed'
      : stage === 'done' || i < current ? 'done'
      : i === current ? 'running'
      : i <= reached ? 'revisit'
      : 'idle');
  return { states, current: Math.min(current, STEPS.length - 1) };
}
const stepEvents = (st: StepDef) => live!.events.filter((e) => st.stages.includes(e.stage));

function jobView() {
  if (!live) return nothing;
  const j = live.job;
  if (!j) return html`<div class="h-64 rounded-3xl border border-zinc-800 shimmer-bg animate-shimmer"></div>${live.error ? html`<p class="mt-4 text-xs font-mono text-rose-400">${live.error}</p>` : nothing}`;
  const s = j.status ?? ({ stage: live.stage } as JobStatus);
  const stage = live.stage;
  const { states, current } = stepStates(stage);
  const selected = live.selected ? STEPS.findIndex((st) => st.id === live!.selected) : stage === 'done' ? STEPS.length - 1 : current;
  return html`
    <section class="space-y-4 sm:space-y-6">
      <button class="-mb-1 sm:-mb-2 py-1 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition" @click=${() => navigate(location.pathname)}>
        ${icon(ArrowLeft, 'w-4 h-4')} Back to library
      </button>
      ${jobHeader(j, s, stage)}
      ${failureBanner(j, s, stage)}
      ${manageBar(j, stage)}
      ${stage === 'awaiting-narration' ? recorderView() : nothing}
      <div class="rounded-2xl sm:rounded-3xl bg-zinc-900/30 border border-zinc-800 p-2 sm:p-6">
        <div class="grid grid-cols-7 sm:grid-cols-4 lg:grid-cols-7 gap-1 sm:gap-3">
          ${STEPS.map((st, i) => stepCard(st, i, states[i], i === selected, i < STEPS.length - 1 ? states[i] === 'done' : undefined))}
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <div class="lg:col-span-7">${stepDetail(j, s, STEPS[selected], selected, states[selected])}</div>
        <div class="lg:col-span-5">${telemetry()}</div>
      </div>
    </section>
  `;
}

function jobHeader(j: Job, s: JobStatus, stage: Stage) {
  const done = stage === 'done', failed = stage === 'failed' || stage === 'cancelled';
  const label = done ? 'WORKFLOW COMPLETED' : stage === 'cancelled' ? 'WORKFLOW CANCELLED' : failed ? 'WORKFLOW FAILED' : stage === 'awaiting-narration' ? 'YOUR TURN TO RECORD' : stage === 'awaiting-approval' ? 'AWAITING APPROVAL' : stage === 'queued' ? 'QUEUED' : 'WORKFLOW RUNNING';
  const doneAt = done || failed ? live!.events[live!.events.length - 1]?.at : undefined;
  const chip = (k: string, v: string, wide = false) => html`<div class="${wide ? 'hidden sm:block' : ''} rounded-2xl bg-black border border-zinc-800 px-4 py-2 text-right">
      <div class="text-[10px] font-mono uppercase tracking-wider text-zinc-500">${k}</div>
      <div class="text-sm font-mono text-zinc-100 tabular-nums">${v}</div></div>`;
  return html`
    <div class="rounded-2xl sm:rounded-3xl bg-zinc-900/30 border border-zinc-800 p-4 sm:p-7 flex flex-wrap items-center justify-between gap-4 sm:gap-6">
      <div class="w-full sm:w-auto min-w-0 space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <span class="relative flex w-2.5 h-2.5">
            ${!done && !failed ? html`<span class="absolute inset-0 rounded-full bg-sky-400 animate-ping2"></span>` : nothing}
            <span class="relative w-2.5 h-2.5 rounded-full ${done ? 'bg-emerald-400' : failed ? 'bg-rose-500' : 'bg-sky-400'}"></span>
          </span>
          <span class="font-mono text-xs sm:text-sm tracking-[0.2em] text-zinc-200">${label}</span>
          <span class="hidden sm:inline font-mono text-xs px-2.5 py-1 rounded-lg bg-black border border-zinc-800 text-zinc-400">${j.jobId}</span>
          <span class="font-mono text-xs px-2.5 py-1 rounded-lg bg-black border border-zinc-800 text-zinc-400">${j.format}</span>
        </div>
        <h1 class="text-xl sm:text-2xl font-semibold tracking-tight text-white sm:truncate max-w-[60ch]">${s.title ?? j.topic}</h1>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        ${chip('Elapsed', elapsed(j.createdAt, doneAt))}
        ${chip('Model', s.model ?? 'claude-sonnet-4-6', true)}
        ${j.voiceName ? chip('Voice', j.voiceName.replace(/ \(.*\)$/, ''), true) : nothing}
        ${isActive(stage) ? html`<button class="rounded-2xl bg-black border border-zinc-800 hover:border-rose-500/60 hover:text-rose-300 px-4 py-3 text-sm text-zinc-300 inline-flex items-center gap-2 transition disabled:opacity-50" ?disabled=${!!actionBusy}
            @click=${() => cancelJob(j.jobId)}>${icon(Ban, 'w-4 h-4')} ${actionBusy === 'cancel' ? 'Cancelling…' : 'Cancel'}</button>` : nothing}
        ${done ? html`<button class="rounded-2xl bg-white text-black hover:bg-zinc-200 px-4 py-3 text-sm font-semibold inline-flex items-center gap-2 transition" @click=${() => navigate(`${location.pathname}?view=calendar&schedule=${encodeURIComponent(j.jobId)}`)}>${icon(CalendarPlus, 'w-4 h-4')} Schedule</button>` : nothing}
        <button class="hidden sm:inline-flex rounded-2xl bg-black border border-zinc-800 hover:border-zinc-600 px-4 py-3 text-sm text-zinc-200 items-center gap-2 transition" @click=${() => navigate(location.pathname)}>
          ${icon(Plus, 'w-4 h-4')} New video
        </button>
      </div>
    </div>
  `;
}

const ERROR_HINT: Record<string, string> = {
  rejected: 'The research agent declined this topic. Rephrase it as an educational question and start a new video.',
  config: 'A setting or API key is missing or invalid. Fix it (npm run explainer -- set-secrets), then retry.',
  quota: 'A provider ran out of credits. Top up, then retry — finished steps are reused.',
  spec: 'Claude could not produce a valid storyboard in time. Retrying usually works.',
  render: 'Remotion Lambda failed twice. Retrying usually works; check Lambda concurrency if it keeps failing.',
  internal: 'Something unexpected went wrong. Retrying is safe — completed research and recordings are reused.',
};

/** Archive (hide, can be undone) or delete (permanent, asks first) a video that has stopped running. */
function manageBar(j: Job, stage: Stage) {
  if (stage !== 'done' && stage !== 'failed' && stage !== 'cancelled') return nothing;
  const quiet = 'rounded-xl border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-600 text-sm px-4 py-2.5 transition inline-flex items-center justify-center gap-2 disabled:opacity-50';
  if (confirmingDelete === j.jobId) {
    return html`
      <div class="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-rose-100 max-w-[60ch]">Delete this video for good? Its video file, recordings and script will be gone, and this can't be undone.</p>
        <div class="flex w-full sm:w-auto gap-2">
          <button class="${quiet} flex-1 sm:flex-none" ?disabled=${!!actionBusy} @click=${() => { confirmingDelete = ''; draw(); }}>Keep it</button>
          <button class="flex-1 sm:flex-none rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-sm font-semibold px-4 py-2.5 transition inline-flex items-center justify-center gap-2 disabled:opacity-50" ?disabled=${!!actionBusy} @click=${() => deleteJob(j.jobId)}>${icon(Trash2, 'w-4 h-4')} ${actionBusy === 'delete' ? 'Deleting…' : 'Delete forever'}</button>
        </div>
      </div>`;
  }
  return html`
    <div class="flex flex-wrap items-center justify-end gap-2">
      ${j.archived
        ? html`<button class="${quiet} flex-1 sm:flex-none" ?disabled=${!!actionBusy} @click=${() => restoreJob(j.jobId)}>${icon(RotateCcw, 'w-4 h-4')} ${actionBusy === 'restore' ? 'Restoring…' : 'Restore to library'}</button>`
        : html`<button class="${quiet} flex-1 sm:flex-none" ?disabled=${!!actionBusy} title="Hide from the library. You can restore it later." @click=${() => archiveJob(j.jobId)}>${icon(Archive, 'w-4 h-4')} ${actionBusy === 'archive' ? 'Archiving…' : 'Archive'}</button>`}
      <button class="${quiet} flex-1 sm:flex-none hover:!text-rose-300 hover:!border-rose-500/60" ?disabled=${!!actionBusy} @click=${() => { confirmingDelete = j.jobId; draw(); }}>${icon(Trash2, 'w-4 h-4')} Delete</button>
    </div>`;
}

function failureBanner(j: Job, s: JobStatus, stage: Stage) {
  if (stage !== 'failed' && stage !== 'cancelled') return live?.error ? html`<p class="text-xs font-mono text-rose-400">${live.error}</p>` : nothing;
  const cancelled = stage === 'cancelled';
  const kind = s.errorKind ?? (cancelled ? 'cancelled' : 'internal');
  const canRetry = kind !== 'rejected';
  return html`
    <div class="rounded-2xl border ${cancelled ? 'border-zinc-700 bg-zinc-900/40' : 'border-rose-500/40 bg-rose-500/5'} p-5 flex flex-wrap items-start justify-between gap-4">
      <div class="flex gap-3 min-w-0">
        <div class="${cancelled ? 'text-zinc-400' : 'text-rose-400'} mt-0.5">${icon(cancelled ? Ban : TriangleAlert, 'w-5 h-5')}</div>
        <div class="min-w-0 space-y-1">
          <div class="text-sm font-medium text-white">${cancelled ? 'You cancelled this video.' : (s.detail ?? s.error ?? 'The pipeline failed.').split('\n')[0]}</div>
          ${cancelled ? nothing : html`<div class="text-xs text-zinc-400">${ERROR_HINT[kind] ?? ERROR_HINT.internal}</div>`}
          ${live?.error ? html`<div class="text-xs font-mono text-rose-400">${live.error}</div>` : nothing}
        </div>
      </div>
      <div class="flex items-center gap-2">
      ${j.retriedAs
        ? html`<button class="rounded-xl bg-white text-black text-sm font-semibold px-4 py-2.5 hover:bg-zinc-200 transition" @click=${() => navigate(`?job=${encodeURIComponent(j.retriedAs!)}`)}>View retry →</button>`
        : canRetry
          ? html`<button class="rounded-xl bg-white text-black text-sm font-semibold px-4 py-2.5 hover:bg-zinc-200 transition inline-flex items-center gap-2 disabled:opacity-50" ?disabled=${!!actionBusy}
              @click=${() => retryJob(j.jobId)}>${icon(RotateCcw, 'w-4 h-4')} ${actionBusy === 'retry' ? 'Queueing…' : 'Retry'}</button>`
          : nothing}
      </div>
    </div>
  `;
}

function researchPanel(s: JobStatus) {
  const r = s.research;
  if (!r) return nothing;
  return html`
    <div class="rounded-2xl bg-black border border-zinc-800 p-4 space-y-3">
      <div class="flex flex-wrap items-center gap-2 text-[11px] font-mono">
        <span class="px-2 py-0.5 rounded-md border border-zinc-800 text-zinc-300">${r.kind}</span>
        <span class="px-2 py-0.5 rounded-md border border-zinc-800 text-zinc-400">${r.facts} facts</span>
        <span class="px-2 py-0.5 rounded-md border border-zinc-800 text-zinc-400">${r.searches} searches · ${r.reads} pages read</span>
        <span class="px-2 py-0.5 rounded-md border border-zinc-800 text-zinc-500">${r.provider}</span>
        ${r.conflicts ? html`<span class="px-2 py-0.5 rounded-md border border-amber-500/40 text-amber-300">${r.conflicts} source conflict${r.conflicts > 1 ? 's' : ''} resolved</span>` : nothing}
      </div>
      ${r.degraded ? html`<div class="text-xs text-amber-300">No verified sources were found, so the script was kept to general, well-established knowledge.</div>` : nothing}
      ${r.angle ? html`<div class="text-sm text-zinc-200">${r.angle}</div>` : nothing}
      ${r.sources.length ? html`<ol class="space-y-1.5">${r.sources.map((src) => html`
        <li class="flex gap-2 text-xs"><span class="font-mono text-zinc-600 shrink-0">[${src.id}]</span>
          <a class="text-zinc-300 hover:text-white underline-offset-2 hover:underline min-w-0 truncate inline-flex items-center gap-1" href=${src.url} target="_blank" rel="noopener noreferrer">${src.title}${icon(ExternalLink, 'w-3 h-3 shrink-0 text-zinc-500')}</a>
          <span class="font-mono text-zinc-600 shrink-0">${src.publisher ?? ''}</span></li>`)}</ol>` : nothing}
    </div>
  `;
}

function stepCard(st: StepDef, i: number, state: StepState, selected: boolean, connectorDone?: boolean) {
  const evs = stepEvents(st);
  const box = {
    done: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
    running: 'border-sky-400/60 bg-sky-500/10 text-sky-300',
    failed: 'border-rose-500/50 bg-rose-500/10 text-rose-400',
    revisit: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    idle: 'border-zinc-800 bg-black text-zinc-600',
  }[state];
  const glyph = state === 'done' ? icon(Check, 'w-5 h-5') : state === 'failed' ? icon(X, 'w-5 h-5') : state === 'running' ? icon(st.icon, 'w-5 h-5') : icon(st.icon, 'w-5 h-5');
  const pct = state === 'running' ? [...evs].reverse().find((e) => typeof e.pct === 'number')?.pct : undefined;
  return html`
    <button aria-label=${st.title} class="relative text-center rounded-xl sm:rounded-2xl border p-1 sm:p-5 sm:pt-4 transition ${selected ? 'bg-zinc-900 border-zinc-600' : 'bg-black/40 border-zinc-800 hover:border-zinc-700'}"
      @click=${() => { live!.selected = st.id; draw(); }}>
      ${connectorDone !== undefined
        ? html`<span class="hidden lg:block absolute top-[2.65rem] -right-4 w-4 h-[2px] ${connectorDone ? 'bg-emerald-500/60' : 'bg-zinc-800'} transition-colors duration-500"></span>`
        : nothing}
      <div class="relative mx-auto w-9 h-9 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl border flex items-center justify-center ${box} transition-colors duration-500">
        ${state === 'running' ? html`<span class="absolute inset-0 rounded-2xl border border-sky-400/70 animate-ping2"></span>` : nothing}
        ${glyph}
      </div>
      <div class="hidden sm:block mt-4 text-[11px] font-mono tracking-[0.18em] text-zinc-500">STEP ${i + 1}</div>
      <div class="hidden sm:block mt-1 text-sm font-medium ${state === 'idle' ? 'text-zinc-400' : 'text-white'} truncate">${st.title}</div>
      <div class="hidden sm:inline-flex mt-2 items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 ${state === 'running' ? 'text-sky-300' : 'text-zinc-400'}">
        ${state === 'running' ? icon(LoaderCircle, 'w-3 h-3 animate-spin') : nothing}${st.badge(evs, state)}${pct !== undefined ? ` · ${pct}%` : ''}
      </div>
      ${pct !== undefined ? html`<div class="mt-3 h-1 rounded-full bg-zinc-800 overflow-hidden"><div class="h-1 bg-sky-400 transition-all duration-700" style="width:${pct}%"></div></div>` : nothing}
    </button>
  `;
}

function stepDetail(j: Job, s: JobStatus, st: StepDef, i: number, state: StepState) {
  const evs = stepEvents(st);
  const last = evs[evs.length - 1];
  const pct = [...evs].reverse().find((e) => typeof e.pct === 'number')?.pct;
  const isPublish = st.id === 'publish';
  const videoReady = live!.stage === 'done' && !!s.videoUrl;
  const headline = isPublish && videoReady ? 'Video Complete & Ready to Stream'
    : state === 'running' ? `${st.title} in progress`
    : state === 'done' ? `${st.title} complete`
    : state === 'failed' ? `${st.title} failed`
    : state === 'revisit' ? `${st.title} will run again`
    : `${st.title} waiting`;
  const tone = { done: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5', running: 'text-sky-300 border-sky-400/50 bg-sky-500/10', failed: 'text-rose-400 border-rose-500/40 bg-rose-500/10', revisit: 'text-amber-300 border-amber-500/40 bg-amber-500/10', idle: 'text-zinc-500 border-zinc-800 bg-black' }[state];
  return html`
    <div class="rounded-2xl sm:rounded-3xl bg-zinc-900/30 border border-zinc-800 p-4 sm:p-6 space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4 sm:pb-5">
        <div class="flex items-center gap-4 min-w-0">
          <div class="w-12 h-12 rounded-2xl border flex items-center justify-center ${tone}">${icon(state === 'done' ? Check : state === 'failed' ? X : st.icon, 'w-5 h-5')}</div>
          <div class="min-w-0">
            <div class="text-base sm:text-lg font-medium text-white sm:truncate">Step ${i + 1}: ${headline}</div>
            <div class="hidden sm:block text-sm font-mono text-zinc-500 truncate">${st.service}</div>
          </div>
        </div>
        ${videoReady && (isPublish || st.id === 'render')
          ? html`<a class="w-full sm:w-auto justify-center inline-flex items-center gap-2 rounded-xl bg-white text-black text-sm font-semibold px-4 py-3 sm:py-2.5 hover:bg-zinc-200 transition" href=${s.videoUrl} download="${j.jobId}.mp4" target="_blank" rel="noopener">${icon(Film, 'w-4 h-4')} Download MP4</a>`
          : nothing}
      </div>
      ${isPublish || st.id === 'render' ? player(j, s) : nothing}
      ${st.id === 'research' ? researchPanel(s) : nothing}
      ${!isPublish
        ? html`
          <p class="text-sm text-zinc-300">${(st.id === 'ingest' && live!.stage === 'queued' && s.detail) || last?.detail || st.idle}</p>
          ${typeof pct === 'number' && state !== 'idle' ? html`<div class="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div class="h-1.5 ${state === 'done' ? 'bg-emerald-400' : 'bg-sky-400'} transition-all duration-700" style="width:${state === 'done' ? 100 : pct}%"></div></div>` : nothing}
          <ol class="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin">
            ${evs.length === 0 ? html`<li class="text-xs font-mono text-zinc-600">No activity yet for this step.</li>` : nothing}
            ${[...evs].reverse().map((e) => html`<li class="flex gap-3 text-xs animate-rise"><span class="font-mono text-zinc-600 tabular-nums shrink-0">${timeOf(e.at)}</span><span class="text-zinc-300">${e.detail}</span></li>`)}
          </ol>`
        : nothing}
    </div>
  `;
}

function player(j: Job, s: JobStatus) {
  const vertical = j.format === '9:16';
  const frame = vertical ? 'mx-auto w-full max-w-[300px] aspect-[9/16] rounded-[2rem] border-[6px] border-zinc-800 shadow-lg' : 'mx-auto w-full aspect-video rounded-2xl border border-zinc-800';
  const stage = live!.stage;
  const cur = STEPS[Math.min(stepOf(stage), STEPS.length - 1)];
  const renderPct = stage === 'rendering' ? [...stepEvents(STEPS.find((x) => x.id === 'render')!)].reverse().find((e) => typeof e.pct === 'number')?.pct : undefined;
  return html`
    <div class="${frame} overflow-hidden bg-zinc-950 relative">
      ${stage === 'done' && s.videoUrl
        ? html`<video class="w-full h-full object-contain bg-black" controls playsinline preload="metadata" poster=${s.posterUrl ?? ''} src=${s.videoUrl}></video>`
        : stage === 'failed' || stage === 'cancelled'
          ? html`<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center ${stage === 'cancelled' ? 'text-zinc-400' : 'text-rose-300'}">${icon(stage === 'cancelled' ? Ban : X, 'w-7 h-7')}<div class="text-xs break-words line-clamp-6">${stage === 'cancelled' ? 'Cancelled' : (s.detail ?? s.error ?? 'The pipeline failed.')}</div></div>`
          : html`<div class="absolute inset-0 flex flex-col items-center justify-center gap-4 shimmer-bg animate-shimmer">
              <div class="flex items-end gap-1 h-8">${[0, 1, 2, 3, 4].map((i) => html`<span class="w-1.5 h-8 rounded-full bg-sky-400/80 animate-bars origin-bottom" style="animation-delay:${i * 0.12}s"></span>`)}</div>
              <div class="text-sm font-medium text-white">${cur.title}</div>
              <div class="text-[11px] font-mono text-zinc-400">${renderPct !== undefined ? `${renderPct}% rendered` : 'in progress…'}</div>
            </div>`}
    </div>
  `;
}

function telemetry() {
  const evs = [...live!.events].reverse();
  const tone = (e: PipelineEvent) =>
    e.stage === 'failed' ? 'text-rose-400' : e.stage === 'cancelled' ? 'text-zinc-500'
      : e.stage === 'done' || /\b(passed|approved|Recorded|Draft ready|valid ·|Published|Research brief|credits OK)\b/.test(e.detail) ? 'text-emerald-400'
      : /\b(errors?|revised|re-timing|requested changes|Auto-layout|Auto-fit|flagged|skipped|rejected|conflict)/i.test(e.detail) ? 'text-amber-300'
      : 'text-zinc-300';
  return html`
    <div class="rounded-2xl sm:rounded-3xl bg-zinc-900/30 border border-zinc-800 p-4 sm:p-6 space-y-4">
      <div class="flex items-center justify-between gap-3 lg:border-b border-zinc-800 lg:pb-4">
        <div class="flex items-center gap-2 font-mono text-xs sm:text-sm tracking-[0.18em] text-zinc-200">${icon(SquareTerminal, 'w-4 h-4 text-zinc-400')} TELEMETRY<span class="hidden sm:inline"> STREAM</span></div>
        <button type="button" class="lg:hidden ml-auto py-1 text-xs text-zinc-400 hover:text-white" aria-expanded=${!!live!.showLog} @click=${() => { live!.showLog = !live!.showLog; draw(); }}>${live!.showLog ? 'Hide' : 'Show'}</button>
        <div class="flex items-center gap-1.5 text-xs font-mono ${live!.live ? 'text-emerald-400' : 'text-zinc-500'}">
          <span class="w-1.5 h-1.5 rounded-full ${live!.live ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}"></span>${live!.live ? 'Live' : isActive(live!.stage) ? 'Polling' : 'Ended'}
        </div>
      </div>
      <div id="event-log" class="${live!.showLog ? '' : 'hidden lg:block'} max-h-[560px] overflow-y-auto scrollbar-thin space-y-3 font-mono text-[13px] leading-relaxed">
        ${evs.length === 0 ? html`<div class="text-zinc-600">Waiting for the first event…</div>` : nothing}
        ${evs.map((e) => html`<div class="flex gap-3 animate-rise"><span class="text-zinc-600 tabular-nums shrink-0">[${timeOf(e.at)}]</span><span class="${tone(e)} break-words">${e.detail}</span></div>`)}
      </div>
    </div>
  `;
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

requireSignIn(appEl).then(() => {
  initRecorder(draw);
  initCalendar({ draw, navigate, voices: () => voices });
  loadVoices();
  onRoute();
  refreshAttention();
  setInterval(() => { if (currentRoute().view !== 'calendar' && document.visibilityState === 'visible') refreshAttention(); }, 60000);
});
