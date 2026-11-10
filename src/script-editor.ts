/**
 * Script editor on the recording page: change the narration and on-screen text before recording.
 * Pictures, layout and timing stay as they are; the server checks every change with the pipeline's validator before saving.
 */
import { explainer } from 'aws-blocks';
import { html, nothing } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import { ChevronDown, LoaderCircle, TriangleAlert } from 'lucide-static';

const icon = (svg: string, cls = 'w-4 h-4') => html`<span class="inline-flex shrink-0 ${cls} [&>svg]:w-full [&>svg]:h-full">${unsafeSVG(svg)}</span>`;

interface Field { path: string; name: string; group: string; value: string | number }
interface Scene { id: string; name: string; narration?: string; cues: string[]; fields: Field[] }
interface Result { ok: boolean; saved: boolean; problems: string[]; warnings: string[]; seconds: number | null; rerecord: string[] }

const st = {
  jobId: '', loading: false, error: '', scenes: [] as Scene[], seconds: null as number | null, target: null as number | null,
  narration: {} as Record<string, string>, fields: {} as Record<string, Record<string, string | number>>, open: {} as Record<string, boolean>,
  busy: '' as '' | 'checking' | 'saving', result: null as Result | null,
};
let draw: () => void = () => {};
let onDone: (saved: boolean) => void = () => {};

export async function openScriptEditor(jobId: string, redraw: () => void, done: (saved: boolean) => void) {
  draw = redraw; onDone = done;
  Object.assign(st, { jobId, loading: true, error: '', scenes: [], narration: {}, fields: {}, open: {}, busy: '', result: null });
  draw();
  try {
    const r: any = await explainer.scriptForEditing(jobId);
    st.scenes = r.scenes; st.seconds = r.seconds; st.target = r.targetSeconds;
  } catch (e: any) { st.error = e?.message ?? String(e); }
  st.loading = false; draw();
}

const fmt = (s: number | null) => (s == null ? '–' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

function changes() {
  return st.scenes.map((sc) => {
    const narration = st.narration[sc.id];
    const fields = Object.entries(st.fields[sc.id] ?? {}).map(([path, value]) => ({ path, value }));
    return { id: sc.id, ...(narration !== undefined && narration !== sc.narration ? { narration } : {}), fields };
  }).filter((e) => 'narration' in e || e.fields.length);
}

async function send(dryRun: boolean) {
  if (st.busy) return;
  const edits = changes();
  if (!edits.length) { if (!dryRun) onDone(false); return; }
  st.busy = dryRun ? 'checking' : 'saving'; st.error = ''; draw();
  try {
    const r = (await explainer.saveScript({ jobId: st.jobId, scenes: edits, dryRun })) as Result;
    st.result = r;
    if (r.seconds != null) st.seconds = r.seconds;
    if (r.saved) { st.busy = ''; onDone(true); return; }
  } catch (e: any) { st.error = e?.message ?? String(e); }
  st.busy = ''; draw();
}

const nameOf = (id: string) => st.scenes.find((s) => s.id === id)?.name ?? id;

function fieldInput(sc: Scene, f: Field) {
  const cur = st.fields[sc.id]?.[f.path] ?? f.value;
  const changed = cur !== f.value;
  const set = (v: string) => {
    const value = typeof f.value === 'number' ? (v.trim() === '' ? v : Number(v)) : v;
    st.fields[sc.id] = { ...(st.fields[sc.id] ?? {}) };
    if (value === f.value) delete st.fields[sc.id][f.path]; else st.fields[sc.id][f.path] = value as string | number;
    st.result = null; draw();
  };
  return html`
    <label class="grid grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr] items-center gap-2 text-xs">
      <span class="text-zinc-500 truncate" title=${f.name}>${f.name}</span>
      <input class="rounded-lg bg-black border ${changed ? 'border-amber-400/60' : 'border-zinc-800'} px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
        type=${typeof f.value === 'number' ? 'number' : 'text'} step="any" min="0" .value=${live(String(cur))} @input=${(e: Event) => set((e.target as HTMLInputElement).value)} />
    </label>`;
}

function sceneCard(sc: Scene, i: number) {
  const text = st.narration[sc.id] ?? sc.narration ?? '';
  const changed = sc.narration !== undefined && text !== sc.narration;
  const groups = [...new Set(sc.fields.map((f) => f.group))];
  const edited = Object.keys(st.fields[sc.id] ?? {}).length;
  const open = st.open[sc.id];
  return html`
    <article class="rounded-2xl border ${changed || edited ? 'border-amber-400/40' : 'border-zinc-800'} bg-zinc-900/30 p-4 sm:p-5 space-y-3">
      <header class="flex items-center gap-3">
        <span class="w-7 h-7 rounded-lg inline-flex items-center justify-center text-xs font-mono bg-black border border-zinc-800 text-zinc-400">${i + 1}</span>
        <h3 class="text-sm font-medium text-white truncate">${sc.name}</h3>
        ${changed || edited ? html`<span class="ml-auto text-[11px] text-amber-300">edited</span>` : nothing}
      </header>
      ${sc.narration !== undefined ? html`
        <textarea rows=${Math.min(10, Math.max(3, Math.ceil(text.length / 70)))} spellcheck="true"
          class="w-full rounded-xl bg-black border ${changed ? 'border-amber-400/60' : 'border-zinc-800'} p-3 text-base leading-relaxed text-zinc-100 focus:outline-none focus:border-zinc-500"
          .value=${live(text)} @input=${(e: Event) => { st.narration[sc.id] = (e.target as HTMLTextAreaElement).value; st.result = null; draw(); }}></textarea>
        ${sc.cues.length ? html`<p class="text-[11px] text-zinc-500">Markers to keep, in this order: ${sc.cues.map((c) => html`<code class="text-zinc-400">{${c}}</code> `)}</p>` : nothing}` : nothing}
      ${sc.fields.length ? html`
        <button type="button" class="text-xs text-zinc-400 hover:text-white inline-flex items-center gap-1" @click=${() => { st.open[sc.id] = !open; draw(); }}>
          ${icon(ChevronDown, `w-3.5 h-3.5 transition ${open ? 'rotate-180' : ''}`)} On-screen text (${sc.fields.length})${edited ? ` · ${edited} changed` : ''}
        </button>
        ${open ? html`<div class="space-y-3">${groups.map((g) => html`
          <div class="space-y-1.5">
            <div class="text-[11px] font-mono text-zinc-500">${g}</div>
            ${sc.fields.filter((f) => f.group === g).map((f) => fieldInput(sc, f))}
          </div>`)}</div>` : nothing}` : nothing}
    </article>`;
}

export function scriptEditorView() {
  if (st.loading) return html`<div class="h-48 rounded-3xl border border-zinc-800 shimmer-bg animate-shimmer"></div>`;
  const r = st.result;
  const pending = changes().length;
  const btn = 'rounded-xl text-sm px-4 py-2.5 transition disabled:opacity-40 disabled:cursor-not-allowed';
  return html`
    <section class="rounded-2xl sm:rounded-3xl border border-sky-400/40 bg-zinc-900/30 p-4 sm:p-6 space-y-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold tracking-tight text-white">Edit the script</h2>
          <p class="text-sm text-zinc-400 max-w-[62ch]">Change any words before you record. Keep the <code class="text-zinc-300">{markers}</code>: they time the animation, so move them with the words they belong to. Pictures and layout stay the same. If you change a scene you already recorded, you'll record that scene again.</p>
        </div>
        <div class="text-right text-[11px] font-mono text-zinc-500">
          <div class="text-sm text-white">about ${fmt(st.seconds)}</div>
          ${st.target ? html`<div>target ${fmt(st.target)}</div>` : nothing}
        </div>
      </div>
      ${st.error ? html`<p class="text-xs font-mono text-rose-400">${st.error}</p>` : nothing}
      <div class="space-y-3">${st.scenes.map(sceneCard)}</div>
      ${r && r.problems.length ? html`
        <div class="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 space-y-1.5 text-sm text-rose-200">
          <div class="flex items-center gap-2 font-medium">${icon(TriangleAlert)} Not saved. Fix these first:</div>
          ${r.problems.map((p) => html`<p class="text-xs">${p}</p>`)}
        </div>` : nothing}
      ${r && r.ok && !r.saved ? html`<p class="text-sm text-emerald-300">Looks good. Save to update your recording page.${r.rerecord.length ? ` You'll need to record ${r.rerecord.map(nameOf).join(', ')} again.` : ''}</p>` : nothing}
      ${r && r.warnings.length ? html`<div class="space-y-1 text-xs text-amber-200">${r.warnings.map((w) => html`<p>${w}</p>`)}</div>` : nothing}
      <div class="flex flex-wrap items-center justify-end gap-2">
        <button type="button" class="${btn} text-zinc-400 hover:text-white" ?disabled=${!!st.busy} @click=${() => onDone(false)}>Cancel</button>
        <button type="button" class="${btn} border border-zinc-700 text-zinc-200 hover:border-zinc-500" ?disabled=${!!st.busy || !pending} @click=${() => send(true)}>
          ${st.busy === 'checking' ? html`${icon(LoaderCircle, 'w-4 h-4 animate-spin inline-flex')} Checking…` : 'Check'}</button>
        <button type="button" class="${btn} bg-white text-black font-semibold hover:bg-zinc-200" ?disabled=${!!st.busy || !pending} @click=${() => send(false)}>
          ${st.busy === 'saving' ? 'Saving…' : `Save ${pending ? `${pending} scene${pending > 1 ? 's' : ''}` : 'changes'}`}</button>
      </div>
    </section>`;
}
