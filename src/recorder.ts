/**
 * Recording studio: the pipeline has paused with a finished script; the user records or uploads each scene here.
 * Takes are uploaded as soon as they're made, so a closed tab or crash loses nothing.
 */
import { explainer } from 'aws-blocks';
import { html, nothing } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import { Check, CircleStop, LoaderCircle, Mic, RotateCcw, TriangleAlert, Upload } from 'lucide-static';
import { analyse, encodeWav, mixToMono, normalisePeak, TAKE_SAMPLE_RATE, trimSilence } from './audio';
import { openScriptEditor, scriptEditorView } from './script-editor';
import { PencilLine } from 'lucide-static';

const icon = (svg: string, cls = 'w-4 h-4') => html`<span class="inline-flex shrink-0 ${cls} [&>svg]:w-full [&>svg]:h-full">${unsafeSVG(svg)}</span>`;

interface Scene { id: string; name: string; text: string; words: number; estSeconds: number; take: { url: string; seconds: number; at: string } | null }
type Busy = 'recording' | 'processing' | 'uploading';
const st = {
  jobId: '', attempt: -1, loading: false, error: '', scenes: [] as Scene[], problems: {} as Record<string, string>,
  busy: {} as Record<string, Busy>, sceneError: {} as Record<string, string>, sceneWarning: {} as Record<string, string>, localUrl: {} as Record<string, string>,
  seconds: 0, active: '', submitting: false, submitted: false, formatLabel: '', editing: false,
};
let draw: () => void = () => {};
export function initRecorder(d: () => void) { draw = d; }

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let meterStop: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function releaseMic() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null; recorder = null;
  meterStop?.(); meterStop = null;
  if (timer) { clearInterval(timer); timer = null; }
  window.removeEventListener('beforeunload', warnLeaving);
}
const warnLeaving = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };

/** Leaving the page: stop the mic and discard an unfinished take. */
export function stopRecorder() {
  if (recorder && recorder.state !== 'inactive') { recorder.ondataavailable = null; recorder.onstop = null; recorder.stop(); }
  if (st.active) delete st.busy[st.active];
  st.active = '';
  releaseMic();
}

/** Called on every job refresh; loads the script when the pipeline (re)asks for narration. */
export function syncRecorder(jobId: string, stage: string, attempt: number | undefined) {
  if (stage !== 'awaiting-narration') { st.submitted = false; st.editing = false; return; }
  if (jobId !== st.jobId) st.editing = false;
  const a = attempt ?? 0;
  if ((jobId !== st.jobId || a !== st.attempt) && !st.loading) load(jobId, a);
}

async function load(jobId: string, attempt: number) {
  stopRecorder();
  if (jobId !== st.jobId) Object.assign(st, { localUrl: {}, sceneError: {}, sceneWarning: {}, busy: {} });
  st.loading = true; st.error = ''; st.jobId = jobId; st.attempt = attempt; st.submitted = false; draw();
  try {
    const r: any = await explainer.narrationScript(jobId);
    st.scenes = r.scenes; st.problems = r.problems ?? {};
  } catch (e: any) {
    st.error = e?.message ?? String(e);
    st.attempt = -1; // try again on the next refresh
  }
  st.loading = false; draw();
}

const micError = (e: any) => e?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser settings, or upload a file instead.'
  : e?.name === 'NotFoundError' ? 'No microphone found. Plug one in, or upload a file instead.'
  : e?.name === 'NotReadableError' ? 'Another app is using the microphone. Close it and try again.'
  : `Could not start recording (${e?.message ?? e}). You can upload a file instead.`;

async function startRecording(sceneId: string) {
  if (st.active) return;
  st.sceneError[sceneId] = ''; st.sceneWarning[sceneId] = '';
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { st.sceneError[sceneId] = 'This browser cannot record. Upload a file instead.'; draw(); return; }
  try {
    // No browser processing: phone-call style filters make a voice sound thin and clipped.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    beginTake(sceneId);
    st.active = sceneId; st.busy[sceneId] = 'recording';
    timer = setInterval(() => { st.seconds++; draw(); }, 1000);
    startMeter(stream);
    window.addEventListener('beforeunload', warnLeaving);
  } catch (e) {
    releaseMic();
    st.sceneError[sceneId] = micError(e);
  }
  draw();
}

function beginTake(sceneId: string) {
  const chunks: Blob[] = [];
  const take = new MediaRecorder(stream!);
  take.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  take.onstop = () => {
    const blob = new Blob(chunks, { type: take.mimeType || 'audio/webm' });
    releaseMic();
    st.active = '';
    handleAudio(sceneId, blob);
  };
  take.start(1000);
  recorder = take;
  st.seconds = 0;
}

/** Throws away what's been said so far and keeps recording, with no save or upload in between. */
function startOver() {
  if (!recorder || recorder.state === 'inactive' || !st.active) return;
  recorder.ondataavailable = null; recorder.onstop = null; recorder.stop();
  beginTake(st.active);
  draw();
}

function startMeter(s: MediaStream) {
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  const ctx: AudioContext = new AC();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(s).connect(an);
  const data = new Uint8Array(an.fftSize);
  let raf = 0;
  const tick = () => {
    an.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    const el = document.getElementById('rec-level');
    if (el) { el.style.width = `${Math.min(100, peak * 110)}%`; el.style.backgroundColor = peak > 0.95 ? '#f43f5e' : peak > 0.7 ? '#fbbf24' : '#34d399'; }
    raf = requestAnimationFrame(tick);
  };
  tick();
  meterStop = () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); };
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') {
    if (st.active) st.busy[st.active] = 'processing';
    recorder.stop();
    draw();
  }
}

async function handleAudio(sceneId: string, blob: Blob) {
  st.busy[sceneId] = 'processing'; st.sceneError[sceneId] = ''; st.sceneWarning[sceneId] = ''; draw();
  try {
    if (blob.size > 300 * 1024 * 1024) throw new Error('That file is over 300 MB. Export just this scene\'s audio and upload that.');
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC({ sampleRate: TAKE_SAMPLE_RATE });
    let decoded: AudioBuffer;
    try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); } catch { throw new Error('This browser could not read that file. Try MP3, WAV or M4A.'); } finally { ctx.close().catch(() => {}); }
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const trimmed = trimSilence(mixToMono(channels));
    const check = analyse(trimmed);
    if (check.problem) throw new Error(check.problem);
    if (check.warning) st.sceneWarning[sceneId] = check.warning;
    const wav = encodeWav(normalisePeak(trimmed));
    st.busy[sceneId] = 'uploading'; draw();
    await upload(sceneId, wav);
    const sc = st.scenes.find((x) => x.id === sceneId);
    if (st.localUrl[sceneId]) URL.revokeObjectURL(st.localUrl[sceneId]);
    st.localUrl[sceneId] = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }));
    if (sc) sc.take = { url: st.localUrl[sceneId], seconds: Math.round(check.seconds * 10) / 10, at: new Date().toISOString() };
    delete st.problems[sceneId];
  } catch (e: any) {
    st.sceneError[sceneId] = e?.message ?? String(e);
  }
  delete st.busy[sceneId];
  draw();
}

async function upload(sceneId: string, wav: Uint8Array) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { url } = (await explainer.narrationUploadUrl({ jobId: st.jobId, sceneId })) as { url: string };
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }) });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      return;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`Couldn't upload this take: ${(last as Error)?.message ?? last}. Check your connection and retry.`);
}

function pickFile(sceneId: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,video/mp4,.m4a,.mp3,.wav,.aac,.ogg,.flac';
  input.onchange = () => { const f = input.files?.[0]; if (f) handleAudio(sceneId, f); };
  input.click();
}

async function submit(force = false) {
  if (st.submitting) return;
  st.submitting = true; st.error = ''; draw();
  try {
    await explainer.submitNarration({ jobId: st.jobId, force });
    st.submitted = true; st.problems = {};
  } catch (e: any) { st.error = e?.message ?? String(e); }
  st.submitting = false; draw();
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** One sentence per line: much easier to read aloud, and to find your place again after a slip. */
const sentences = (text: string) => text.replace(/([.!?]["'”)]*)\s+/g, '$1\n').split('\n');

function sceneCard(sc: Scene, i: number) {
  const busy = st.busy[sc.id];
  const problem = st.problems[sc.id];
  const anotherActive = !!st.active && st.active !== sc.id;
  const btn = 'rounded-xl text-sm px-3 py-2.5 sm:py-2 inline-flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed';
  return html`
    <article class="rounded-2xl border p-4 sm:p-5 space-y-4 transition ${busy === 'recording' ? 'border-rose-500/60 bg-rose-500/5' : problem ? 'border-amber-400/50 bg-amber-400/5' : sc.take ? 'border-emerald-500/30 bg-zinc-900/30' : 'border-zinc-800 bg-zinc-900/30'}">
      <header class="flex items-center gap-3">
        <span class="w-7 h-7 rounded-lg inline-flex items-center justify-center text-xs font-mono ${sc.take && !problem ? 'bg-emerald-500/20 text-emerald-300' : 'bg-black border border-zinc-800 text-zinc-400'}">${sc.take && !problem ? icon(Check, 'w-3.5 h-3.5') : i + 1}</span>
        <h3 class="text-sm font-medium text-white truncate">${sc.name}</h3>
        <span class="ml-auto text-[11px] font-mono text-zinc-500 shrink-0">${sc.take ? `${fmt(sc.take.seconds)} recorded` : `about ${fmt(sc.estSeconds)}`}</span>
      </header>
      <div class="space-y-2 text-lg sm:text-xl leading-relaxed text-zinc-100">${sentences(sc.text).map((line) => html`<p>${line}</p>`)}</div>
      ${problem ? html`<div class="flex gap-2 text-sm text-amber-200">${icon(TriangleAlert, 'w-4 h-4 mt-0.5')}<span>${problem}</span></div>` : nothing}
      ${st.sceneError[sc.id] ? html`<div class="flex gap-2 text-sm text-rose-300">${icon(TriangleAlert, 'w-4 h-4 mt-0.5')}<span>${st.sceneError[sc.id]}</span></div>` : nothing}
      ${st.sceneWarning[sc.id] ? html`<div class="flex gap-2 text-sm text-amber-200">${icon(TriangleAlert, 'w-4 h-4 mt-0.5')}<span>${st.sceneWarning[sc.id]}</span></div>` : nothing}
      ${busy === 'recording' ? html`
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
          <span class="font-mono text-sm tabular-nums text-white">${fmt(st.seconds)}</span>
          <div class="flex-1 min-w-[120px] h-2 rounded-full bg-zinc-800 overflow-hidden"><div id="rec-level" class="h-2 rounded-full bg-emerald-400" style="width:0%"></div></div>
          <div class="flex gap-2 w-full sm:w-auto">
            <button type="button" class="${btn} flex-1 sm:flex-none justify-center border border-zinc-700 text-zinc-200 hover:border-zinc-500" @click=${startOver}>${icon(RotateCcw)} Start over</button>
            <button type="button" class="${btn} flex-1 sm:flex-none justify-center bg-rose-500 text-white hover:bg-rose-400 font-medium" @click=${stopRecording}>${icon(CircleStop)} Stop</button>
          </div>
        </div>` : html`
        <div class="flex flex-wrap items-center gap-2">
          ${busy ? html`<span class="${btn} text-zinc-300">${icon(LoaderCircle, 'w-4 h-4 animate-spin')} ${busy === 'uploading' ? 'Saving your take…' : 'Preparing audio…'}</span>` : html`
            <button type="button" class="${btn} ${sc.take ? 'border border-zinc-700 text-zinc-200 hover:border-zinc-500' : 'bg-white text-black hover:bg-zinc-200 font-semibold'}" ?disabled=${anotherActive || st.submitted} @click=${() => startRecording(sc.id)}>${icon(sc.take ? RotateCcw : Mic)} ${sc.take ? 'Retake' : 'Record'}</button>
            <button type="button" class="${btn} text-zinc-400 hover:text-white" ?disabled=${anotherActive || st.submitted} @click=${() => pickFile(sc.id)}>${icon(Upload)} Upload file</button>`}
          ${sc.take && !busy ? html` <audio class="sm:ml-auto h-10 sm:h-9 sm:max-w-[280px] w-full" controls preload="none" src=${st.localUrl[sc.id] ?? sc.take.url}></audio>` : nothing}
        </div>`}
    </article>`;
}

function editScript() {
  if (st.active || Object.keys(st.busy).length) return;
  st.editing = true;
  openScriptEditor(st.jobId, draw, (saved) => { st.editing = false; if (saved) load(st.jobId, st.attempt); else draw(); });
}

export function recorderView() {
  if (st.editing) return scriptEditorView();
  if (st.loading && !st.scenes.length) return html`<div class="h-48 rounded-3xl border border-zinc-800 shimmer-bg animate-shimmer"></div>`;
  if (st.submitted) {
    return html`<section class="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-6 flex items-center gap-3 text-sm text-emerald-200">${icon(LoaderCircle, 'w-4 h-4 animate-spin')} Recordings received. Matching your voice to the script…</section>`;
  }
  const done = st.scenes.filter((x) => x.take && !st.problems[x.id]).length;
  const total = st.scenes.length;
  const flagged = Object.keys(st.problems).filter((id) => st.scenes.find((x) => x.id === id)?.take);
  const anyBusy = Object.keys(st.busy).length > 0;
  const allHaveTakes = total > 0 && st.scenes.every((x) => x.take);
  const seconds = st.scenes.reduce((a, x) => a + (x.take?.seconds ?? 0), 0);
  return html`
    <section class="rounded-2xl sm:rounded-3xl border border-amber-400/40 bg-zinc-900/30 p-4 sm:p-6 space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold tracking-tight text-white">Your turn: record the narration</h2>
          <p class="text-sm text-zinc-400 max-w-[60ch]">Read each scene in your natural voice. Made a mistake? Don't stop. Re-read the sentence and carry on, and the mistake is cut when you finish. Small changes in wording are fine, and animations follow your pace. Every take saves right away, so you can close this and return later.</p>
        </div>
        <div class="text-right space-y-1.5">
          <button type="button" class="rounded-xl text-sm px-3 py-2 inline-flex items-center gap-2 border border-zinc-700 text-zinc-200 hover:border-zinc-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
            ?disabled=${anyBusy || st.submitting} title="Change the words before you record" @click=${editScript}>${icon(PencilLine)} Edit script</button>
          <div class="font-mono text-sm tabular-nums text-white">${done}/${total} scenes</div>
          ${seconds ? html`<div class="text-[11px] font-mono text-zinc-500">${fmt(seconds)} recorded</div>` : nothing}
        </div>
      </div>
      <div class="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div class="h-1.5 bg-emerald-400 transition-all duration-500" style="width:${total ? (done / total) * 100 : 0}%"></div></div>
      ${st.error ? html`<p class="text-xs font-mono text-rose-400">${st.error}</p>` : nothing}
      <div class="space-y-3">${st.scenes.map(sceneCard)}</div>
      <div class="flex flex-wrap items-center justify-end gap-3">
        ${flagged.length && !anyBusy ? html`<button type="button" class="text-sm text-zinc-400 hover:text-white transition" title="Use these takes even though they don't seem to match the script" @click=${() => submit(true)}>Use my takes anyway</button>` : nothing}
        <button type="button" class="w-full sm:w-auto rounded-xl bg-white text-black text-sm font-semibold px-5 py-3 sm:py-2.5 hover:bg-zinc-200 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed"
          ?disabled=${!allHaveTakes || anyBusy || st.submitting || flagged.length > 0} @click=${() => submit()}>${st.submitting ? 'Sending…' : 'Finish and make the video →'}</button>
      </div>
    </section>`;
}
