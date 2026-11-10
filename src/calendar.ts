/**
 * Content calendar — plan videos by date and time, then post them by hand from a "posting kit".
 *
 *   ?view=calendar              month / week / agenda, drag a post to reschedule it
 *   ?view=calendar&post=<id>    a post's kit: MP4 download, caption, hashtags, upload links, posted checklist
 *   ?view=calendar&schedule=<jobId>   opens the composer with a library video selected
 *
 * Times are stored in UTC and shown in the browser's timezone. Posting APIs can later replace the manual checklist;
 * until then `.ics` export gives phone reminders.
 */
import { calendar, explainer } from 'aws-blocks';
import { THEME_IDS, THEME_META, type ThemeChoice } from '../explainer/engine/theme-list';
import { html, nothing, type TemplateResult } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
import { ArrowLeft, Ban, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, CircleCheck, Clock, Copy, Download, ExternalLink, Film, LayoutGrid, LoaderCircle, Plus, RotateCcw, Rows3, TriangleAlert, Upload, X } from 'lucide-static';
import { siInstagram, siTiktok, siYoutube, siYoutubeshorts } from 'simple-icons';

const icon = (svg: string, cls = 'w-4 h-4') => html`<span class="inline-flex shrink-0 ${cls} [&>svg]:w-full [&>svg]:h-full">${unsafeSVG(svg)}</span>`;
const brand = (path: string, cls = 'w-3.5 h-3.5') => html`<span class="inline-flex shrink-0 ${cls} [&>svg]:w-full [&>svg]:h-full">${unsafeSVG(`<svg viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>`)}</span>`;

// ─── Types & constants ─────────────────────────────────────────────────────────

type Format = '16:9' | '9:16';
type PlatformId = 'youtube' | 'youtube-shorts' | 'tiktok' | 'instagram';
type PostStatus = 'planned' | 'making' | 'ready' | 'due' | 'posted' | 'failed';
interface PlatformState { platform: PlatformId; posted: boolean; postedAt?: string; url?: string }
interface Post {
  postId: string; scheduledAt: string; status: PostStatus; title: string; format: Format; platforms: PlatformState[]; topic?: string; jobId?: string; videoJobId?: string;
  posterUrl?: string; seconds?: number; stage?: string; error?: string; warnings: string[]; canRetry: boolean; generateAt?: string; leadHours?: number; note?: string;
}
interface PostDetail extends Post { videoUrl?: string; downloadUrl?: string; description: string; hashtags: string[]; sources: Array<{ title: string; url: string; publisher?: string }> }
interface LibraryVideo { jobId: string; title: string; format: Format; seconds?: number; posterUrl?: string; createdAt: string; scheduledCount: number }
interface VoiceOption { id: string; name: string }

const PLATFORMS: Record<PlatformId, { name: string; path: string; upload: string; uploadLabel: string; captionLimit: number; color: string }> = {
  youtube: { name: 'YouTube', path: siYoutube.path, upload: 'https://studio.youtube.com', uploadLabel: 'YouTube Studio', captionLimit: 5000, color: 'text-red-400' },
  'youtube-shorts': { name: 'Shorts', path: siYoutubeshorts.path, upload: 'https://studio.youtube.com', uploadLabel: 'YouTube Studio', captionLimit: 5000, color: 'text-red-400' },
  tiktok: { name: 'TikTok', path: siTiktok.path, upload: 'https://www.tiktok.com/tiktokstudio/upload', uploadLabel: 'TikTok Studio', captionLimit: 2200, color: 'text-zinc-100' },
  instagram: { name: 'Instagram', path: siInstagram.path, upload: 'https://www.instagram.com/', uploadLabel: 'Instagram', captionLimit: 2200, color: 'text-pink-400' },
};
const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];
const defaultPlatforms = (f: Format): PlatformId[] => (f === '9:16' ? ['youtube-shorts', 'tiktok', 'instagram'] : ['youtube']);

const STATUS: Record<PostStatus, { label: string; chip: string; dot: string }> = {
  planned: { label: 'Planned', chip: 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500', dot: 'bg-zinc-500' },
  making: { label: 'Making video', chip: 'border-sky-500/40 bg-sky-500/10 text-sky-200 hover:border-sky-400', dot: 'bg-sky-400 animate-pulse' },
  ready: { label: 'Ready', chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400', dot: 'bg-emerald-400' },
  due: { label: 'Post now', chip: 'border-amber-400/60 bg-amber-400/15 text-amber-100 hover:border-amber-300', dot: 'bg-amber-400' },
  posted: { label: 'Posted', chip: 'border-zinc-800 bg-transparent text-zinc-500 hover:border-zinc-700', dot: 'bg-zinc-700' },
  failed: { label: 'Failed', chip: 'border-rose-500/50 bg-rose-500/10 text-rose-200 hover:border-rose-400', dot: 'bg-rose-500' },
};

const LENGTHS: Record<Format, Array<{ value: number; label: string }>> = {
  '9:16': [{ value: 0.5, label: '30s' }, { value: 0.92, label: '60s' }, { value: 1.5, label: '90s' }, { value: 2, label: '2m' }, { value: 3, label: '3m' }],
  '16:9': [{ value: 1, label: '1 min' }, { value: 2, label: '2 min' }, { value: 3, label: '3 min' }, { value: 5, label: '5 min' }],
};
const LEADS = [{ value: 0, label: 'Now' }, { value: 1, label: '1h before' }, { value: 3, label: '3h before' }, { value: 24, label: '1 day before' }];

// ─── Date helpers (all local time) ──────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toLocalInput = (d: Date) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d: Date) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const fmtFull = (d: Date) => d.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'local time'; } };
/** First weekday of the user's locale (Monday when the browser cannot say). */
function weekStartsOn(): number {
  try {
    const info: any = new Intl.Locale(navigator.language);
    const first = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    return typeof first === 'number' ? first % 7 : 1;
  } catch { return 1; }
}
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() - weekStartsOn() + 7) % 7));
function relative(d: Date): string {
  const days = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return fmtDay(d);
}
/** Next future occurrence of a local time on a date offset, for the quick-pick chips. */
const at = (offsetDays: number, hour: number, minute = 0) => { const d = addDays(startOfDay(new Date()), offsetDays); d.setHours(hour, minute, 0, 0); return d; };

// ─── State ─────────────────────────────────────────────────────────────────────

type ViewMode = 'month' | 'week' | 'agenda';
interface Composer {
  mode: 'topic' | 'library' | 'series';
  when: string; topic: string; brief: string; lines: string; everyDays: number; jobIds: string[]; search: string;
  format: Format; minutes: number; theme: ThemeChoice; voiceId: string; leadHours: number; platforms: PlatformId[]; platformsTouched: boolean;
  busy: boolean; error: string; rid: string;
}
const state = {
  view: (window.matchMedia?.('(max-width: 767px)').matches ? 'agenda' : 'month') as ViewMode,
  cursor: new Date(),
  items: [] as Post[], attention: [] as Post[], next: [] as Post[],
  loading: false, error: '', everLoaded: false,
  detail: null as PostDetail | null, detailId: '', detailError: '', dirty: new Set<string>(), confirmDelete: false, savedAt: 0, reschedule: '',
  composer: null as Composer | null, videos: null as LibraryVideo[] | null,
  toast: null as { text: string; tone: 'ok' | 'warn' | 'error' } | null,
  dragId: '', dropKey: '',
};
let deps: { draw: () => void; navigate: (url: string) => void; voices: () => VoiceOption[] } = { draw: () => {}, navigate: () => {}, voices: () => [] };
let poll: ReturnType<typeof setInterval> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function initCalendar(d: typeof deps) { deps = d; }
const draw = () => deps.draw();
const errText = (e: any) => e?.message ?? String(e);
function toast(text: string, tone: 'ok' | 'warn' | 'error' = 'ok') {
  state.toast = { text, tone };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; draw(); }, tone === 'ok' ? 2600 : 7000);
  draw();
}
const calUrl = (extra = '') => `${location.pathname}?view=calendar${extra}`;

/** Posts that need the user: due to post, or failed. Shown as the nav badge. */
export const attentionCount = () => state.attention.filter((p) => p.status === 'due' || p.status === 'failed').length;

// ─── Data ──────────────────────────────────────────────────────────────────────

function range(): { from: Date; to: Date } {
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const from = startOfWeek(first);
  // 6 weeks always cover the month grid, and any week containing the cursor
  return { from: addDays(from, -7), to: addDays(from, 49) };
}

export async function loadCalendar(silent = false) {
  if (!silent) { state.loading = true; draw(); }
  try {
    const { from, to } = range();
    const r: any = await calendar.list({ from: from.toISOString(), to: to.toISOString() });
    state.items = r.items; state.attention = r.attention; state.next = r.next;
    state.error = ''; state.everLoaded = true;
    if (state.detail) {
      const fresh = [...state.items, ...state.attention, ...state.next].find((p) => p.postId === state.detail!.postId);
      if (fresh && fresh.status !== state.detail.status) await loadDetail(state.detail.postId, true);
    }
  } catch (e) { state.error = errText(e); }
  state.loading = false;
  draw();
}

/** Lightweight refresh for the nav badge on other pages. */
export async function refreshAttention() {
  try { const now = new Date().toISOString(); const r: any = await calendar.list({ from: now, to: now }); state.attention = r.attention; state.next = r.next; draw(); } catch { /* badge only */ }
}

async function loadDetail(postId: string, keepEdits = false) {
  state.detailId = postId; state.detailError = '';
  try {
    const d = (await calendar.get(postId)) as unknown as PostDetail;
    if (state.detailId !== postId) return;
    const prev = state.detail;
    if (keepEdits && prev?.postId === postId) {
      if (state.dirty.has('title')) d.title = prev.title;
      if (state.dirty.has('description')) d.description = prev.description;
      if (state.dirty.has('hashtags')) d.hashtags = prev.hashtags;
    } else { state.dirty.clear(); state.confirmDelete = false; }
    state.detail = d;
    if (!keepEdits || !state.reschedule) state.reschedule = toLocalInput(new Date(d.scheduledAt));
  } catch (e) { state.detail = null; state.detailError = errText(e); }
  draw();
}

/** Called by the router whenever the URL changes while on the calendar. */
export function syncCalendarRoute(params: URLSearchParams) {
  if (!poll) {
    poll = setInterval(() => { if (document.visibilityState === 'visible') loadCalendar(true); }, 20000);
    loadCalendar();
  }
  const postId = params.get('post');
  if (postId) { if (state.detailId !== postId) { state.detail = null; loadDetail(postId); } } else { state.detail = null; state.detailId = ''; state.detailError = ''; }
  const schedule = params.get('schedule');
  if (schedule && !state.composer) { openComposer({ mode: 'library', jobId: schedule }); history.replaceState({}, '', calUrl()); }
}
export function leaveCalendar() {
  if (poll) { clearInterval(poll); poll = null; }
  state.detail = null; state.detailId = ''; state.composer = null;
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.composer && !state.composer.busy) { state.composer = null; draw(); } else if (state.detailId) deps.navigate(calUrl());
});

// ─── Actions ───────────────────────────────────────────────────────────────────

function shiftCursor(dir: number) {
  const c = state.cursor;
  state.cursor = state.view === 'week' ? addDays(c, dir * 7) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
  loadCalendar();
}

async function movePost(postId: string, target: Date) {
  const post = state.items.find((p) => p.postId === postId);
  if (!post) return;
  if (target.getTime() === new Date(post.scheduledAt).getTime()) return;
  if (post.status === 'posted') { toast('This post is already published.', 'warn'); return; }
  if (target.getTime() <= Date.now()) { toast('That time has passed — drop it on a future slot.', 'warn'); return; }
  const previous = post.scheduledAt;
  post.scheduledAt = target.toISOString(); // optimistic
  draw();
  try {
    await calendar.update({ postId, scheduledAt: target.toISOString() });
    toast(`Moved to ${fmtFull(target)}`);
    loadCalendar(true);
  } catch (e) { post.scheduledAt = previous; toast(errText(e), 'error'); }
}

async function saveField(field: 'title' | 'description' | 'hashtags') {
  const d = state.detail;
  if (!d || !state.dirty.has(field)) return;
  try {
    await calendar.update({ postId: d.postId, [field]: d[field] } as any);
    state.dirty.delete(field); state.savedAt = Date.now();
    draw();
  } catch (e) { toast(errText(e), 'error'); }
}

async function setPosted(platform: PlatformId, posted: boolean, url?: string) {
  const d = state.detail;
  if (!d) return;
  const entry = d.platforms.find((p) => p.platform === platform)!;
  const before = { ...entry };
  entry.posted = posted; if (url !== undefined) entry.url = url;
  draw();
  try {
    const r: any = await calendar.markPosted({ postId: d.postId, platform, posted, url });
    if (r.allPosted && posted) toast('All platforms posted — nice.');
    await loadCalendar(true);
    await loadDetail(d.postId, true);
  } catch (e) { Object.assign(entry, before); toast(errText(e), 'error'); }
}

async function togglePlatform(platform: PlatformId) {
  const d = state.detail;
  if (!d) return;
  const has = d.platforms.some((p) => p.platform === platform);
  const next = has ? d.platforms.filter((p) => p.platform !== platform).map((p) => p.platform) : [...d.platforms.map((p) => p.platform), platform];
  if (!next.length) { toast('A post needs at least one platform.', 'warn'); return; }
  try {
    await calendar.update({ postId: d.postId, platforms: next });
    await loadDetail(d.postId, true);
    loadCalendar(true);
  } catch (e) { toast(errText(e), 'error'); }
}

async function saveReschedule() {
  const d = state.detail;
  if (!d || !state.reschedule) return;
  const target = new Date(state.reschedule);
  try {
    await calendar.update({ postId: d.postId, scheduledAt: target.toISOString() });
    toast(`Rescheduled to ${fmtFull(target)}`);
    state.cursor = target;
    await loadDetail(d.postId, true);
    await loadCalendar(true);
  } catch (e) { toast(errText(e), 'error'); }
}

async function removePost() {
  const d = state.detail;
  if (!d) return;
  try {
    await calendar.remove(d.postId);
    toast(d.jobId ? 'Removed from the calendar — the video stays in your library.' : 'Removed from the calendar.');
    deps.navigate(calUrl());
    await loadCalendar(true);
  } catch (e) { toast(errText(e), 'error'); }
}

async function retryVideo() {
  const d = state.detail;
  if (!d?.videoJobId) return;
  try {
    await explainer.retry(d.videoJobId);
    toast('Video queued again.');
    await loadDetail(d.postId, true);
    await loadCalendar(true);
  } catch (e) { toast(errText(e), 'error'); }
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { toast('Could not copy — select the text manually.', 'error'); ta.remove(); return; }
    ta.remove();
  }
  toast(`${what} copied`);
}

const tagsText = (tags: string[]) => tags.map((t) => `#${t}`).join(' ');
function captionFor(d: PostDetail, platform: PlatformId): string {
  const tags = tagsText(d.hashtags);
  if (platform === 'youtube' || platform === 'youtube-shorts') {
    const sources = d.sources.length ? `\n\nSources:\n${d.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}` : '';
    return `${d.description}${sources}${tags ? `\n\n${tags}` : ''}`.trim();
  }
  return `${d.description}${tags ? `\n\n${tags}` : ''}`.trim();
}

// ─── .ics export (phone / desktop reminders, no API needed) ─────────────────────

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function icsFold(line: string) {
  const chars = [...line];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += 70) out.push((i ? ' ' : '') + chars.slice(i, i + 70).join(''));
  return out.join('\r\n');
}
function downloadIcs(posts: Post[], filename: string) {
  const open = posts.filter((p) => p.status !== 'posted');
  if (!open.length) { toast('Nothing upcoming to export.', 'warn'); return; }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Durable Studio//Content Calendar//EN', 'CALSCALE:GREGORIAN'];
  for (const p of open) {
    const start = new Date(p.scheduledAt);
    const names = p.platforms.map((x) => PLATFORMS[x.platform].name).join(', ');
    const link = `${location.origin}${calUrl(`&post=${encodeURIComponent(p.postId)}`)}`;
    lines.push('BEGIN:VEVENT', `UID:${p.postId}@durable-studio`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, 'DURATION:PT15M',
      icsFold(`SUMMARY:${icsEscape(`Post: ${p.title}`)}`), icsFold(`DESCRIPTION:${icsEscape(`Post to ${names}.\nPosting kit: ${link}`)}`), icsFold(`URL:${link}`),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', icsFold(`DESCRIPTION:${icsEscape(`Time to post: ${p.title}`)}`), 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`${open.length} reminder${open.length === 1 ? '' : 's'} exported — open the file to add them to your calendar.`);
}

// ─── Composer logic ────────────────────────────────────────────────────────────

const newRid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function openComposer(opts: { mode?: Composer['mode']; when?: Date; jobId?: string } = {}) {
  let when = opts.when;
  if (!when || when.getTime() <= Date.now()) when = at(1, 9);
  const format: Format = '9:16';
  state.composer = {
    mode: opts.mode ?? 'topic', when: toLocalInput(when), topic: '', brief: '', lines: '', everyDays: 1, jobIds: opts.jobId ? [opts.jobId] : [], search: '',
    format, minutes: 0.92, theme: 'auto', voiceId: deps.voices()[0]?.id ?? '', leadHours: 3, platforms: defaultPlatforms(format), platformsTouched: false,
    busy: false, error: '', rid: newRid(),
  };
  if (state.composer.mode === 'library' || opts.jobId) loadVideos();
  draw();
}

async function loadVideos() {
  if (state.videos) { syncLibraryFormat(); return; }
  try { state.videos = (await calendar.videos()) as LibraryVideo[]; syncLibraryFormat(); } catch (e) { if (state.composer) state.composer.error = errText(e); }
  draw();
}
const videoById = (id: string) => state.videos?.find((x) => x.jobId === id);
/** Until the user picks platforms, each video goes to what fits its own format; the picker shows the union. */
function syncLibraryFormat() {
  const c = state.composer;
  if (!c || c.platformsTouched) return;
  const formats = new Set(c.jobIds.map((id) => videoById(id)?.format).filter(Boolean) as Format[]);
  if (!formats.size) formats.add('9:16');
  c.platforms = PLATFORM_IDS.filter((id) => [...formats].some((f) => defaultPlatforms(f).includes(id)));
}
function toggleVideo(c: Composer, jobId: string) {
  c.jobIds = c.jobIds.includes(jobId) ? c.jobIds.filter((x) => x !== jobId) : [...c.jobIds, jobId];
  syncLibraryFormat();
  draw();
}
const libraryPlatforms = (c: Composer, jobId: string) => {
  const v = videoById(jobId);
  return c.platformsTouched || !v ? c.platforms : defaultPlatforms(v.format);
};

function seriesTopics(c: Composer) {
  const seen = new Set<string>();
  const out: Array<{ topic: string; brief?: string }> = [];
  for (const raw of c.lines.split('\n')) {
    const [t, ...rest] = raw.split('|');
    const topic = t.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '').trim();
    if (topic.length < 3 || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    out.push({ topic, brief: rest.join('|').trim() || undefined });
  }
  return out;
}
const seriesDate = (c: Composer, i: number) => addDays(new Date(c.when), i * c.everyDays);

function composerProblem(c: Composer): string {
  if (!c.when || Number.isNaN(new Date(c.when).getTime())) return 'Pick a date and time';
  if (new Date(c.when).getTime() <= Date.now()) return 'Pick a future time';
  if (!c.platforms.length) return 'Choose a platform';
  if (c.mode === 'topic' && c.topic.trim().length < 3) return 'Enter a topic';
  if (c.mode === 'library' && !c.jobIds.length) return 'Choose at least one video';
  if (c.mode === 'library' && c.jobIds.length > 30) return 'Up to 30 posts at a time';
  if (c.mode === 'series' && !seriesTopics(c).length) return 'Add at least one topic';
  if (c.mode === 'series' && seriesTopics(c).length > 30) return 'Up to 30 posts at a time';
  return '';
}

async function submitComposer(e: Event) {
  e.preventDefault();
  const c = state.composer;
  if (!c || c.busy || composerProblem(c)) return;
  c.busy = true; c.error = ''; draw();
  const shared = { format: c.format, minutes: c.minutes, theme: c.theme, voiceId: c.voiceId || undefined, leadHours: c.leadHours };
  // includes the content, so editing a topic after a failed attempt is a new post, while a plain retry is not
  const rid = (i: number, what: string) => `${c.rid}#${i}#${what.slice(0, 40)}`;
  const items = c.mode === 'library'
    ? c.jobIds.map((jobId, i) => ({ scheduledAt: seriesDate(c, i).toISOString(), platforms: libraryPlatforms(c, jobId), jobId, requestId: rid(i, jobId) }))
    : c.mode === 'topic'
      ? [{ ...shared, scheduledAt: new Date(c.when).toISOString(), platforms: c.platforms, topic: c.topic.trim(), brief: c.brief.trim() || undefined, requestId: rid(0, c.topic) }]
      : seriesTopics(c).map((t, i) => ({ ...shared, ...t, scheduledAt: seriesDate(c, i).toISOString(), platforms: c.platforms, requestId: rid(i, t.topic) }));
  try {
    const r: any = await calendar.createMany({ items });
    const first = new Date(items[0].scheduledAt);
    state.composer = null;
    state.cursor = first;
    state.videos = null; // scheduled counts changed
    await loadCalendar(true);
    const problems = [...new Set<string>([...r.warnings, ...r.results.flatMap((x: any) => [...x.warnings, ...(x.error ? [x.error] : [])])])];
    if (problems.length) toast(problems.join(' '), 'warn');
    else toast(items.length === 1 ? `Scheduled for ${fmtFull(first)}` : `${items.length} posts scheduled from ${fmtDay(first)}`);
  } catch (err) {
    c.busy = false; c.error = errText(err); draw();
  }
}

// ─── Small view pieces ─────────────────────────────────────────────────────────

function seg<T extends string | number>(options: Array<{ value: T; label: string | TemplateResult }>, value: T, onPick: (v: T) => void) {
  return html`<div class="inline-flex flex-wrap rounded-xl bg-black border border-zinc-800 p-1">${options.map((o) => html`
    <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 ${o.value === value ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}"
      aria-pressed=${o.value === value} @click=${() => { onPick(o.value); draw(); }}>${o.label}</button>`)}</div>`;
}
const fieldLabel = (t: string) => html`<div class="text-[11px] font-mono uppercase tracking-wider text-zinc-500">${t}</div>`;
const statusDot = (s: PostStatus) => html`<span class="w-1.5 h-1.5 rounded-full shrink-0 ${STATUS[s].dot}"></span>`;
const statusBadge = (s: PostStatus) => html`<span class="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-lg border ${STATUS[s].chip}">${statusDot(s)}${STATUS[s].label}</span>`;
const platformGlyphs = (p: Post) => html`<span class="inline-flex items-center gap-1 ${p.status === 'posted' ? 'opacity-60' : ''}">${p.platforms.map((x) => html`<span class=${x.posted ? 'opacity-40' : ''} title=${`${PLATFORMS[x.platform].name}${x.posted ? ' · posted' : ''}`}>${brand(PLATFORMS[x.platform].path, 'w-3 h-3')}</span>`)}</span>`;
const openPost = (p: Post) => deps.navigate(calUrl(`&post=${encodeURIComponent(p.postId)}`));

function chip(p: Post, compact = true) {
  const d = new Date(p.scheduledAt);
  return html`
    <button type="button" draggable=${p.status !== 'posted' ? 'true' : 'false'}
      class="group w-full text-left rounded-lg border px-2 py-1.5 transition ${STATUS[p.status].chip} ${state.dragId === p.postId ? 'opacity-40' : ''} ${p.status === 'posted' ? '' : 'cursor-grab active:cursor-grabbing'}"
      title=${`${p.title} · ${fmtTime(d)} · ${STATUS[p.status].label}`}
      @click=${(e: Event) => { e.stopPropagation(); openPost(p); }}
      @dragstart=${(e: DragEvent) => { state.dragId = p.postId; e.dataTransfer?.setData('text/plain', p.postId); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
      @dragend=${() => { state.dragId = ''; state.dropKey = ''; draw(); }}>
      <span class="flex items-center gap-1.5 text-[10px] font-mono tabular-nums leading-none">
        ${p.status === 'posted' ? icon(Check, 'w-3 h-3') : statusDot(p.status)}${fmtTime(d)}
        <span class="ml-auto">${platformGlyphs(p)}</span>
      </span>
      <span class="mt-1 block text-[11px] leading-snug ${compact ? 'truncate' : 'line-clamp-2'} ${p.status === 'posted' ? 'line-through decoration-zinc-700' : ''}">${p.title}</span>
    </button>`;
}

/** Drop handlers for a day or hour slot. */
function dropProps(key: string, target: () => Date) {
  return {
    over: (e: DragEvent) => { if (!state.dragId) return; e.preventDefault(); if (state.dropKey !== key) { state.dropKey = key; draw(); } },
    drop: (e: DragEvent) => { e.preventDefault(); const id = state.dragId; state.dragId = ''; state.dropKey = ''; if (id) movePost(id, target()); else draw(); },
  };
}

// ─── Month / week / agenda ─────────────────────────────────────────────────────

const postsOn = (day: Date) => state.items.filter((p) => sameDay(new Date(p.scheduledAt), day)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

function weekdayHeader() {
  const start = startOfWeek(new Date());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i).toLocaleDateString([], { weekday: 'short' }));
}

function monthView() {
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const lastDay = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 0);
  const weeks = Math.ceil((Math.round((lastDay.getTime() - gridStart.getTime()) / 86400000) + 1) / 7); // round: DST days aren't 24 h
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const today = new Date();
  return html`
    <div class="rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-950/40">
      <div class="grid grid-cols-7 border-b border-zinc-800 bg-black/40">${weekdayHeader().map((w) => html`<div class="px-3 py-2.5 text-[11px] font-mono uppercase tracking-wider text-zinc-500">${w}</div>`)}</div>
      <div class="grid grid-cols-7 auto-rows-fr">
        ${days.map((day, i) => {
          const inMonth = day.getMonth() === state.cursor.getMonth();
          const isToday = sameDay(day, today);
          const past = startOfDay(day).getTime() < startOfDay(today).getTime();
          const posts = postsOn(day);
          const key = dayKey(day);
          const dp = dropProps(key, () => {
            const src = state.items.find((p) => p.postId === state.dragId);
            const t = src ? new Date(src.scheduledAt) : at(0, 9);
            const d = new Date(day); d.setHours(t.getHours(), t.getMinutes(), 0, 0);
            return d;
          });
          return html`
            <div class="group/cell relative min-h-[8.25rem] p-1.5 flex flex-col gap-1 border-zinc-800/80 ${(i + 1) % 7 ? 'border-r' : ''} ${i < days.length - 7 ? 'border-b' : ''} ${inMonth ? '' : 'bg-black/40'} ${past ? 'bg-black/20' : ''} ${state.dropKey === key ? 'ring-2 ring-inset ring-sky-400/70 bg-sky-500/5' : ''} transition"
              @dragover=${dp.over} @drop=${dp.drop}>
              <div class="flex items-center justify-between px-0.5 h-6">
                <span class="text-xs font-mono tabular-nums inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-md ${isToday ? 'bg-white text-black font-semibold' : inMonth ? 'text-zinc-300' : 'text-zinc-600'}">${day.getDate()}</span>
                ${past && !isToday ? nothing : html`<button type="button" class="opacity-0 group-hover/cell:opacity-100 focus:opacity-100 w-6 h-6 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 inline-flex items-center justify-center transition" aria-label=${`Schedule on ${fmtDay(day)}`}
                    @click=${() => { const d = new Date(day); d.setHours(9, 0, 0, 0); if (d.getTime() <= Date.now()) { const n = new Date(Date.now() + 3600000); d.setHours(n.getHours(), 0, 0, 0); } openComposer({ when: d }); }}>${icon(Plus, 'w-3.5 h-3.5')}</button>`}
              </div>
              <div class="flex flex-col gap-1 min-w-0">
                ${posts.slice(0, 3).map((p) => chip(p))}
                ${posts.length > 3 ? html`<button type="button" class="text-[10px] font-mono text-zinc-400 hover:text-white text-left px-1" @click=${() => { state.view = 'agenda'; state.cursor = day; loadCalendar(); }}>+${posts.length - 3} more</button>` : nothing}
              </div>
            </div>`;
        })}
      </div>
    </div>`;
}

function weekView() {
  const start = startOfWeek(state.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const label = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  return html`
    <div class="rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-950/40">
      <div class="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-zinc-800 bg-black/40">
        <div></div>
        ${days.map((d) => html`<div class="px-2 py-2.5 border-l border-zinc-800/80 text-center">
          <div class="text-[11px] font-mono uppercase tracking-wider text-zinc-500">${d.toLocaleDateString([], { weekday: 'short' })}</div>
          <div class="mt-1 inline-flex items-center justify-center min-w-[1.75rem] h-7 rounded-md text-sm font-mono tabular-nums ${sameDay(d, today) ? 'bg-white text-black font-semibold' : 'text-zinc-200'}">${d.getDate()}</div>
        </div>`)}
      </div>
      <div id="week-scroll" class="max-h-[640px] overflow-y-auto scrollbar-thin">
        ${hours.map((h) => html`
          <div class="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] min-h-[3.25rem] border-b border-zinc-900 last:border-b-0" data-hour=${h}>
            <div class="px-2 pt-1 text-[10px] font-mono text-zinc-600 text-right">${label(h)}</div>
            ${days.map((d) => {
              const slot = new Date(d); slot.setHours(h, 0, 0, 0);
              const key = `${dayKey(d)}T${h}`;
              const posts = state.items.filter((p) => { const t = new Date(p.scheduledAt); return sameDay(t, d) && t.getHours() === h; });
              const past = slot.getTime() + 3600000 <= Date.now();
              const dp = dropProps(key, () => {
                const src = state.items.find((p) => p.postId === state.dragId);
                const t = new Date(slot); t.setMinutes(src ? new Date(src.scheduledAt).getMinutes() : 0);
                return t;
              });
              return html`<div class="group/slot relative border-l border-zinc-800/80 p-1 flex flex-col gap-1 ${past ? 'bg-black/30' : ''} ${state.dropKey === key ? 'ring-2 ring-inset ring-sky-400/70 bg-sky-500/5' : ''}" @dragover=${dp.over} @drop=${dp.drop}>
                ${posts.map((p) => chip(p))}
                ${past ? nothing : html`<button type="button" class="absolute top-0.5 right-0.5 opacity-0 group-hover/slot:opacity-100 focus:opacity-100 w-5 h-5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 inline-flex items-center justify-center" aria-label=${`Schedule at ${label(h)} on ${fmtDay(d)}`}
                    @click=${() => openComposer({ when: slot.getTime() > Date.now() ? slot : new Date(slot.getTime() + 3600000) })}>${icon(Plus, 'w-3 h-3')}</button>`}
              </div>`;
            })}
          </div>`)}
      </div>
    </div>`;
}

function agendaRow(p: Post) {
  const d = new Date(p.scheduledAt);
  return html`
    <button type="button" class="w-full text-left flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 hover:border-zinc-600 p-2.5 transition" @click=${() => openPost(p)}>
      <div class="w-14 sm:w-16 shrink-0 text-xs font-mono tabular-nums text-zinc-300">${fmtTime(d)}</div>
      <div class="w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center text-zinc-600">
        ${p.posterUrl ? html`<img src=${p.posterUrl} alt="" class="w-full h-full object-cover" loading="lazy" />` : icon(Film)}
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-sm text-white line-clamp-2 sm:truncate ${p.status === 'posted' ? 'line-through decoration-zinc-600 text-zinc-400' : ''}">${p.title}</div>
        <div class="mt-1 flex items-center gap-2 text-zinc-400">${platformGlyphs(p)}<span class="text-[11px] font-mono text-zinc-500">${p.format}</span></div>
      </div>
      <div class="hidden sm:block shrink-0">${statusBadge(p.status)}</div>
      <div class="sm:hidden shrink-0" title=${STATUS[p.status].label}>${statusDot(p.status)}</div>
    </button>`;
}

function agendaView() {
  const month = state.items.filter((p) => { const d = new Date(p.scheduledAt); return d.getMonth() === state.cursor.getMonth() && d.getFullYear() === state.cursor.getFullYear(); });
  if (!month.length) {
    return html`<div class="rounded-2xl border border-dashed border-zinc-800 p-12 text-center space-y-3">
      <div class="text-sm text-zinc-400">Nothing scheduled in ${state.cursor.toLocaleDateString([], { month: 'long' })}.</div>
      <button type="button" class="rounded-xl bg-white text-black text-sm font-semibold px-4 py-2 hover:bg-zinc-200 transition" @click=${() => openComposer()}>Schedule a post</button>
    </div>`;
  }
  const days = [...new Set(month.map((p) => dayKey(new Date(p.scheduledAt))))].sort();
  return html`<div class="space-y-5">${days.map((k) => {
    const posts = month.filter((p) => dayKey(new Date(p.scheduledAt)) === k).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return html`<section class="space-y-2">
      <h3 class="text-xs font-mono uppercase tracking-wider text-zinc-500">${relative(new Date(posts[0].scheduledAt))}${relative(new Date(posts[0].scheduledAt)).includes(',') ? '' : ` · ${fmtDay(new Date(posts[0].scheduledAt))}`}</h3>
      <div class="space-y-2">${posts.map(agendaRow)}</div>
    </section>`;
  })}</div>`;
}

function rail() {
  const row = (p: Post) => {
    const d = new Date(p.scheduledAt);
    return html`<button type="button" class="w-full text-left rounded-xl border border-zinc-800 hover:border-zinc-600 bg-black/40 p-3 transition space-y-1.5" @click=${() => openPost(p)}>
      <div class="flex items-center justify-between gap-2">${statusBadge(p.status)}<span class="text-zinc-400">${platformGlyphs(p)}</span></div>
      <div class="text-sm text-white line-clamp-2">${p.title}</div>
      <div class="text-[11px] font-mono text-zinc-500">${relative(d)} · ${fmtTime(d)}</div>
    </button>`;
  };
  const needs = state.attention.filter((p) => p.status === 'due' || p.status === 'failed' || p.status === 'making' || p.status === 'planned');
  return html`
    <aside class="space-y-6">
      <section class="${needs.length ? '' : 'hidden xl:block'} rounded-2xl border ${needs.length ? 'border-amber-400/30' : 'border-zinc-800'} bg-zinc-900/30 p-4 space-y-3">
        <div class="flex items-center gap-2 text-sm font-semibold text-white">${icon(Upload, needs.length ? 'w-4 h-4 text-amber-300' : 'w-4 h-4 text-zinc-500')} To post now${needs.length ? html`<span class="ml-auto text-[11px] font-mono text-amber-300">${needs.length}</span>` : nothing}</div>
        ${needs.length ? html`<div class="space-y-2 max-h-[340px] overflow-y-auto scrollbar-thin">${needs.map(row)}</div>` : html`<p class="text-xs text-zinc-500">You're all caught up.</p>`}
      </section>
      <section class="${state.view === 'agenda' ? 'hidden xl:block' : ''} rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
        <div class="flex items-center gap-2 text-sm font-semibold text-white">${icon(Clock, 'w-4 h-4 text-zinc-500')} Coming up</div>
        ${state.next.length ? html`<div class="space-y-2">${state.next.map(row)}</div>` : html`<p class="text-xs text-zinc-500">Nothing scheduled yet.</p>`}
      </section>
      <div class="hidden sm:flex flex-wrap gap-x-3 gap-y-1.5 px-1">${(Object.keys(STATUS) as PostStatus[]).map((s) => html`<span class="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">${statusDot(s)}${STATUS[s].label}</span>`)}</div>
    </aside>`;
}

export function calendarView() {
  // Month and week grids need more width than a phone has, so phones get the agenda.
  if (state.view !== 'agenda' && matchMedia('(max-width: 639px)').matches) state.view = 'agenda';
  const c = state.cursor;
  const title = state.view === 'week'
    ? (() => { const s = startOfWeek(c); const e = addDays(s, 6); return `${s.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString([], { month: s.getMonth() === e.getMonth() ? undefined : 'short', day: 'numeric', year: 'numeric' })}`; })()
    : c.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const navBtn = 'w-10 h-10 sm:w-9 sm:h-9 rounded-xl border border-zinc-800 bg-black text-zinc-300 hover:text-white hover:border-zinc-600 inline-flex items-center justify-center transition';
  return html`
    <section class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="space-y-1">
          <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Content calendar</h1>
          <p class="hidden sm:block text-sm text-zinc-400">Plan videos by date and time, then post them from a ready-made kit. <span class="font-mono text-xs text-zinc-500">Times in ${timezone()}</span></p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="rounded-xl border border-zinc-800 bg-black text-zinc-300 hover:text-white hover:border-zinc-600 text-sm px-3 py-2 inline-flex items-center gap-2 transition" title="Add reminders to Google, Apple or Outlook calendar"
            @click=${() => downloadIcs([...state.attention, ...state.next, ...state.items].filter((p, i, a) => a.findIndex((x) => x.postId === p.postId) === i && new Date(p.scheduledAt).getTime() > Date.now()), 'content-calendar.ics')}>${icon(CalendarDays)} Reminders (.ics)</button>
          <button type="button" class="rounded-xl bg-white text-black text-sm font-semibold px-4 py-2 hover:bg-zinc-200 active:scale-[0.98] transition inline-flex items-center gap-2" @click=${() => openComposer()}>${icon(CalendarPlus)} Schedule post</button>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button type="button" class=${navBtn} aria-label="Previous" @click=${() => shiftCursor(-1)}>${icon(ChevronLeft)}</button>
          <button type="button" class=${navBtn} aria-label="Next" @click=${() => shiftCursor(1)}>${icon(ChevronRight)}</button>
          <button type="button" class="h-10 sm:h-9 px-3 rounded-xl border border-zinc-800 bg-black text-xs text-zinc-300 hover:text-white hover:border-zinc-600 transition" @click=${() => { state.cursor = new Date(); loadCalendar(); }}>Today</button>
          <h2 class="ml-2 text-lg font-medium text-white tabular-nums">${title}</h2>
          ${state.loading ? icon(LoaderCircle, 'w-4 h-4 animate-spin text-zinc-500') : nothing}
        </div>
        <div class="hidden sm:block">${seg<ViewMode>([{ value: 'month', label: html`${icon(LayoutGrid, 'w-3.5 h-3.5')} Month` }, { value: 'week', label: html`${icon(Rows3, 'w-3.5 h-3.5')} Week` }, { value: 'agenda', label: html`${icon(CalendarDays, 'w-3.5 h-3.5')} Agenda` }], state.view, (v) => { state.view = v; if (v === 'week') requestAnimationFrame(scrollWeek); })}</div>
      </div>
      ${state.error ? html`<p class="text-xs font-mono text-rose-400">${state.error}</p>` : nothing}
      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_18rem] gap-6 items-start">
        <div class="min-w-0 overflow-x-auto"><div class=${state.view === 'agenda' ? '' : 'min-w-[720px]'}>${state.view === 'month' ? monthView() : state.view === 'week' ? weekView() : agendaView()}</div></div>
        ${rail()}
      </div>
    </section>
    ${state.detailId ? drawer() : nothing}
    ${state.composer ? composerModal(state.composer) : nothing}
    ${state.toast ? html`<div role="status" class="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-2rem)] sm:w-auto max-w-lg rounded-xl border px-4 py-2.5 text-sm shadow-lg ${state.toast.tone === 'ok' ? 'border-emerald-500/40 bg-zinc-950 text-emerald-200' : state.toast.tone === 'warn' ? 'border-amber-400/50 bg-zinc-950 text-amber-200' : 'border-rose-500/50 bg-zinc-950 text-rose-200'}">${state.toast.text}</div>` : nothing}
  `;
}
function scrollWeek() {
  const el = document.getElementById('week-scroll');
  const row = el?.querySelector<HTMLElement>('[data-hour="7"]');
  if (el && row) el.scrollTop = row.offsetTop - el.offsetTop;
}

// ─── Post drawer: the manual posting kit ───────────────────────────────────────

function copyBtn(text: string, what: string, label = 'Copy') {
  return html`<button type="button" class="inline-flex items-center gap-1.5 py-2 sm:py-0 text-[11px] font-mono text-zinc-400 hover:text-white disabled:opacity-40 transition" ?disabled=${!text} @click=${() => copy(text, what)}>${icon(Copy, 'w-3 h-3')} ${label}</button>`;
}

function videoPanel(d: PostDetail) {
  const frame = d.format === '9:16' ? 'mx-auto w-full max-w-[220px] aspect-[9/16]' : 'w-full aspect-video';
  if (d.videoUrl) return html`<div class="${frame} rounded-2xl overflow-hidden border border-zinc-800 bg-black"><video class="w-full h-full object-contain" controls playsinline preload="metadata" poster=${d.posterUrl ?? ''} src=${d.videoUrl}></video></div>`;
  if (d.status === 'failed') {
    return html`<div class="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 space-y-3">
      <div class="flex gap-2 text-sm text-rose-200">${icon(TriangleAlert, 'w-4 h-4 mt-0.5')}<span>${(d.error ?? 'The video failed.').split('\n')[0]}</span></div>
      <div class="flex flex-wrap gap-2">
        ${d.canRetry ? html`<button type="button" class="rounded-xl bg-white text-black text-sm font-semibold px-3 py-2 inline-flex items-center gap-2 hover:bg-zinc-200 transition" @click=${retryVideo}>${icon(RotateCcw)} Retry video</button>` : nothing}
        ${d.videoJobId ? html`<a class="rounded-xl border border-zinc-700 text-zinc-300 hover:text-white text-sm px-3 py-2 inline-flex items-center gap-2" href=${`?job=${encodeURIComponent(d.videoJobId)}`} @click=${(e: Event) => { e.preventDefault(); deps.navigate(`?job=${encodeURIComponent(d.videoJobId!)}`); }}>See what happened</a>` : nothing}
      </div>
    </div>`;
  }
  if (d.status === 'making') {
    return html`<div class="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 text-sm text-sky-200">${icon(LoaderCircle, 'w-4 h-4 animate-spin')} The video is being made.</div>
      ${d.videoJobId ? html`<a class="text-xs font-mono text-sky-300 hover:text-white underline-offset-2 hover:underline" href=${`?job=${encodeURIComponent(d.videoJobId)}`} @click=${(e: Event) => { e.preventDefault(); deps.navigate(`?job=${encodeURIComponent(d.videoJobId!)}`); }}>Watch the workflow →</a>` : nothing}
    </div>`;
  }
  return html`<div class="rounded-2xl border border-zinc-800 bg-black/40 p-4 space-y-1.5">
    <div class="flex items-center gap-2 text-sm text-zinc-200">${icon(Clock, 'w-4 h-4 text-zinc-500')} ${d.generateAt ? `Video starts ${fmtFull(new Date(d.generateAt))}` : 'Video not started yet'}</div>
    <div class="text-xs text-zinc-500">It's researched and made automatically, even with this app closed. The posting kit appears here once it's ready.</div>
    ${d.error ? html`<div class="text-xs text-amber-300">${d.error}</div>` : nothing}
  </div>`;
}

function platformRow(d: PostDetail, p: PlatformState) {
  const meta = PLATFORMS[p.platform];
  const canPost = d.status === 'due' || d.status === 'ready' || d.status === 'posted' || p.posted;
  return html`
    <div class="rounded-xl border ${p.posted ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-black/40'} p-3 space-y-2.5">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class=${meta.color}>${brand(meta.path, 'w-4 h-4')}</span>
        <span class="text-sm font-medium text-white">${meta.name}</span>
        ${p.posted && p.postedAt ? html`<span class="text-[11px] font-mono text-emerald-300/80">${relative(new Date(p.postedAt))} ${fmtTime(new Date(p.postedAt))}</span>` : nothing}
        <div class="ml-auto flex items-center gap-2">
          ${copyBtn(captionFor(d, p.platform), `${meta.name} caption`, 'Caption')}
          <a class="inline-flex items-center gap-1.5 py-2 sm:py-0 text-[11px] font-mono text-zinc-400 hover:text-white transition" href=${meta.upload} target="_blank" rel="noopener noreferrer">${icon(ExternalLink, 'w-3 h-3')} Upload</a>
          <button type="button" ?disabled=${!canPost} title=${canPost ? '' : 'The video is not ready yet'}
            class="rounded-lg px-3 py-2.5 sm:px-2.5 sm:py-1.5 text-xs font-medium inline-flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed ${p.posted ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30' : 'bg-white text-black hover:bg-zinc-200'}"
            @click=${() => setPosted(p.platform, !p.posted)}>${p.posted ? html`${icon(CircleCheck, 'w-3.5 h-3.5')} Posted` : 'Mark posted'}</button>
        </div>
      </div>
      ${captionFor(d, p.platform).length > meta.captionLimit ? html`<div class="text-[11px] text-amber-300">Caption is ${captionFor(d, p.platform).length} characters; ${meta.name} allows about ${meta.captionLimit}.</div>` : nothing}
      ${p.posted ? html`<input type="url" placeholder="Paste the live link (optional)" .value=${p.url ?? ''}
          class="w-full bg-black border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          @change=${(e: Event) => setPosted(p.platform, true, (e.target as HTMLInputElement).value.trim())} />` : nothing}
    </div>`;
}

function drawer() {
  const d = state.detail;
  const close = () => deps.navigate(calUrl());
  const input = 'w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500';
  const body = !d
    ? state.detailError
      ? html`<div class="p-6 space-y-3"><p class="text-sm text-rose-300">${state.detailError}</p><button type="button" class="text-sm text-zinc-300 hover:text-white inline-flex items-center gap-2" @click=${close}>${icon(ArrowLeft)} Back to the calendar</button></div>`
      : html`<div class="p-6 space-y-3">${[0, 1, 2].map(() => html`<div class="h-24 rounded-2xl border border-zinc-800 shimmer-bg animate-shimmer"></div>`)}</div>`
    : html`
      <div class="p-6 space-y-6">
        <div class="space-y-2">
          <div class="flex items-center gap-2">${statusBadge(d.status)}<span class="text-[11px] font-mono text-zinc-500">${d.format}${d.seconds ? ` · ${Math.floor(d.seconds / 60)}:${pad(Math.round(d.seconds % 60))}` : ''}</span></div>
          <h2 class="text-lg font-semibold tracking-tight text-white">${d.title}</h2>
          <p class="text-sm text-zinc-400">${fmtFull(new Date(d.scheduledAt))}</p>
        </div>
        ${d.warnings.map((w) => html`<div class="flex gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">${icon(TriangleAlert, 'w-3.5 h-3.5 mt-0.5')}${w}</div>`)}
        ${videoPanel(d)}
        ${d.downloadUrl ? html`<a class="w-full rounded-xl bg-white text-black text-sm font-semibold px-4 py-2.5 hover:bg-zinc-200 transition inline-flex items-center justify-center gap-2" href=${d.downloadUrl}>${icon(Download)} Download MP4</a>` : nothing}

        <section class="space-y-2">
          ${fieldLabel('Post to')}
          <div class="space-y-2">${d.platforms.map((p) => platformRow(d, p))}</div>
          <div class="flex flex-wrap gap-1.5 pt-1">
            ${PLATFORM_IDS.map((id) => { const on = d.platforms.some((p) => p.platform === id); return html`<button type="button" class="text-[11px] font-mono px-2 py-1 rounded-lg border inline-flex items-center gap-1.5 transition ${on ? 'border-zinc-600 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}" aria-pressed=${on} @click=${() => togglePlatform(id)}>${brand(PLATFORMS[id].path, 'w-3 h-3')}${on ? '' : '+ '}${PLATFORMS[id].name}</button>`; })}
          </div>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between">${fieldLabel('Caption kit')}${state.savedAt && Date.now() - state.savedAt < 3000 ? html`<span class="text-[11px] font-mono text-emerald-400">Saved</span>` : nothing}</div>
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-[11px] font-mono text-zinc-500"><span>Title <span class=${d.title.length > 100 ? 'text-amber-300' : ''}>${d.title.length}/100</span></span>${copyBtn(d.title, 'Title')}</div>
            <input class=${input} maxlength="200" .value=${d.title} @input=${(e: Event) => { d.title = (e.target as HTMLInputElement).value; state.dirty.add('title'); draw(); }} @blur=${() => saveField('title')} />
          </div>
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-[11px] font-mono text-zinc-500"><span>Description</span>${copyBtn(d.description, 'Description')}</div>
            <textarea rows="4" class="${input} resize-y" maxlength="5000" placeholder=${d.videoUrl ? 'Write a description…' : 'Generated with the video. You can write your own now.'} .value=${d.description} @input=${(e: Event) => { d.description = (e.target as HTMLTextAreaElement).value; state.dirty.add('description'); }} @blur=${() => saveField('description')}></textarea>
          </div>
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-[11px] font-mono text-zinc-500"><span>Hashtags</span>${copyBtn(tagsText(d.hashtags), 'Hashtags')}</div>
            <input class=${input} placeholder="#systemdesign #aws" .value=${tagsText(d.hashtags)} @change=${(e: Event) => { d.hashtags = (e.target as HTMLInputElement).value.split(/[\s,]+/).map((t) => t.replace(/^#+/, '')).filter(Boolean); state.dirty.add('hashtags'); saveField('hashtags'); draw(); }} />
          </div>
          ${d.sources.length ? html`<details class="rounded-xl border border-zinc-800 bg-black/40 p-3">
            <summary class="cursor-pointer text-xs font-mono text-zinc-400">${d.sources.length} research sources (added to YouTube captions)</summary>
            <ol class="mt-2 space-y-1.5">${d.sources.map((s) => html`<li class="text-xs truncate"><a class="text-zinc-300 hover:text-white hover:underline" href=${s.url} target="_blank" rel="noopener noreferrer">${s.title}</a></li>`)}</ol>
          </details>` : nothing}
        </section>

        <section class="space-y-2">
          ${fieldLabel(`Reschedule · ${timezone()}`)}
          <div class="flex gap-2">
            <input type="datetime-local" class="${input} [color-scheme:dark]" .value=${state.reschedule} ?disabled=${d.status === 'posted'} @input=${(e: Event) => { state.reschedule = (e.target as HTMLInputElement).value; draw(); }} />
            <button type="button" class="rounded-xl border border-zinc-700 text-sm text-zinc-200 hover:text-white hover:border-zinc-500 px-4 transition disabled:opacity-40" ?disabled=${d.status === 'posted' || !state.reschedule || new Date(state.reschedule).getTime() === new Date(d.scheduledAt).getTime()} @click=${saveReschedule}>Move</button>
          </div>
        </section>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-5">
          <button type="button" class="text-sm text-zinc-300 hover:text-white inline-flex items-center gap-2" @click=${() => downloadIcs([d], `${d.postId}.ics`)}>${icon(CalendarDays)} Add reminder</button>
          ${state.confirmDelete
            ? html`<span class="inline-flex items-center gap-2 text-sm"><span class="text-zinc-400">Remove this post?</span>
                <button type="button" class="rounded-lg bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 px-3 py-1.5" @click=${removePost}>Remove</button>
                <button type="button" class="text-zinc-400 hover:text-white px-2 py-1.5" @click=${() => { state.confirmDelete = false; draw(); }}>Keep</button></span>`
            : html`<button type="button" class="text-sm text-zinc-500 hover:text-rose-300 inline-flex items-center gap-2 transition" @click=${() => { state.confirmDelete = true; draw(); }}>${icon(Ban)} Remove from calendar</button>`}
        </div>
      </div>`;
  return html`
    <div class="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" @click=${close}></div>
    <aside role="dialog" aria-modal="true" aria-label="Scheduled post" class="fixed inset-y-0 right-0 z-[70] w-full max-w-lg bg-zinc-950 border-l border-zinc-800 overflow-y-auto scrollbar-thin animate-rise">
      <div class="sticky top-0 z-10 flex items-center justify-between px-6 h-14 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
        <span class="text-sm font-semibold text-white">Posting kit</span>
        <button type="button" class="w-10 h-10 sm:w-8 sm:h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 inline-flex items-center justify-center" aria-label="Close" @click=${close}>${icon(X)}</button>
      </div>
      ${body}
    </aside>`;
}

// ─── Composer modal ────────────────────────────────────────────────────────────

function platformPicker(c: Composer) {
  return html`<div class="flex flex-wrap gap-1.5">${PLATFORM_IDS.map((id) => {
    const on = c.platforms.includes(id);
    return html`<button type="button" aria-pressed=${on} class="rounded-xl border px-3 py-2 text-xs inline-flex items-center gap-2 transition ${on ? 'border-zinc-500 bg-zinc-800 text-white' : 'border-zinc-800 bg-black text-zinc-400 hover:text-zinc-200'}"
      @click=${() => { c.platformsTouched = true; c.platforms = on ? c.platforms.filter((x) => x !== id) : [...c.platforms, id]; draw(); }}>${brand(PLATFORMS[id].path)}${PLATFORMS[id].name}</button>`;
  })}</div>`;
}

function videoSettings(c: Composer) {
  const voices = deps.voices();
  return html`
    <div class="flex flex-wrap gap-5">
      <div class="space-y-1.5">${fieldLabel('Format')}
        ${seg<Format>([{ value: '9:16', label: '▯ 9:16' }, { value: '16:9', label: '▭ 16:9' }], c.format, (v) => {
          c.format = v; c.minutes = v === '9:16' ? 0.92 : 2;
          if (!c.platformsTouched) c.platforms = defaultPlatforms(v);
        })}
      </div>
      <div class="space-y-1.5">${fieldLabel('Length')}${seg<number>(LENGTHS[c.format], c.minutes, (v) => (c.minutes = v))}</div>
      <div class="space-y-1.5">${fieldLabel('Style')}
        <select class="block bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500" @change=${(e: Event) => { c.theme = (e.target as HTMLSelectElement).value as ThemeChoice; }}>
          <option value="auto" ?selected=${c.theme === 'auto'}>Auto (matches the topic)</option>
          ${THEME_IDS.map((id) => html`<option value=${id} ?selected=${c.theme === id}>${THEME_META[id].name}</option>`)}
        </select>
      </div>
      <div class="space-y-1.5">${fieldLabel('Voice')}
        <select class="block bg-black border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500" @change=${(e: Event) => { c.voiceId = (e.target as HTMLSelectElement).value; }}>
          ${voices.length ? voices.map((v) => html`<option value=${v.id} ?selected=${v.id === c.voiceId}>${v.name}</option>`) : html`<option value="">Default narrator</option>`}
        </select>
      </div>
    </div>
    <div class="space-y-1.5">${fieldLabel('Make the video')}
      ${seg<number>(LEADS, c.leadHours, (v) => (c.leadHours = v))}
      <p class="text-[11px] text-zinc-500">${c.leadHours === 0 ? 'Starts right away, so you can review it early.' : 'Researched close to the post time, so the facts are fresh. Runs even with this app closed.'}</p>
    </div>`;
}

function libraryPicker(c: Composer) {
  if (!state.videos) return html`<div class="grid grid-cols-3 gap-2">${[0, 1, 2].map(() => html`<div class="h-24 rounded-xl border border-zinc-800 shimmer-bg animate-shimmer"></div>`)}</div>`;
  if (!state.videos.length) return html`<p class="text-sm text-zinc-500 rounded-xl border border-dashed border-zinc-800 p-6 text-center">No finished videos yet — schedule a new topic instead.</p>`;
  const q = c.search.toLowerCase();
  const list = state.videos.filter((v) => !q || v.title.toLowerCase().includes(q));
  return html`
    <input class="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" placeholder="Search your videos…" .value=${c.search} @input=${(e: Event) => { c.search = (e.target as HTMLInputElement).value; draw(); }} />
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto scrollbar-thin pr-1">
      ${list.map((v) => html`
        <button type="button" aria-pressed=${c.jobIds.includes(v.jobId)} class="text-left rounded-xl border overflow-hidden transition ${c.jobIds.includes(v.jobId) ? 'border-white ring-1 ring-white' : 'border-zinc-800 hover:border-zinc-600'}"
          @click=${() => toggleVideo(c, v.jobId)}>
          <div class="relative aspect-video bg-zinc-900">
            ${v.posterUrl ? html`<img src=${v.posterUrl} alt="" loading="lazy" class="w-full h-full object-cover" />` : nothing}
            <span class="absolute top-1 left-1 text-[9px] font-mono px-1 py-0.5 rounded bg-black/80 text-zinc-300">${v.format}</span>
            ${c.jobIds.includes(v.jobId)
              ? html`<span class="absolute top-1 right-1 min-w-[1.25rem] h-5 px-1 rounded-full bg-white text-black text-[11px] font-semibold inline-flex items-center justify-center tabular-nums">${c.jobIds.indexOf(v.jobId) + 1}</span>`
              : v.scheduledCount ? html`<span class="absolute top-1 right-1 text-[9px] font-mono px-1 py-0.5 rounded bg-black/80 text-amber-300">scheduled ×${v.scheduledCount}</span>` : nothing}
          </div>
          <div class="p-2 text-[11px] text-zinc-200 line-clamp-2">${v.title}</div>
        </button>`)}
      ${list.length ? nothing : html`<p class="col-span-full text-xs text-zinc-500 p-3">No videos match.</p>`}
    </div>
    <div class="flex items-center justify-between text-[11px] font-mono text-zinc-500">
      <span>${c.jobIds.length ? `${c.jobIds.length} selected · numbers show the posting order` : 'Click videos to select one or several'}</span>
      ${c.jobIds.length ? html`<button type="button" class="hover:text-white transition" @click=${() => { c.jobIds = []; syncLibraryFormat(); draw(); }}>Clear</button>` : nothing}
    </div>
    ${c.jobIds.length > 1 ? html`<div class="space-y-1.5">${fieldLabel('Post one every')}${seg<number>([{ value: 1, label: 'Day' }, { value: 2, label: '2 days' }, { value: 3, label: '3 days' }, { value: 7, label: 'Week' }, { value: 0, label: 'Same time' }], c.everyDays, (v) => (c.everyDays = v))}</div>` : nothing}`;
}

function composerModal(c: Composer) {
  const problem = composerProblem(c);
  const topics = c.mode === 'series' ? seriesTopics(c) : [];
  const many = c.mode === 'series' || (c.mode === 'library' && c.jobIds.length > 1);
  const count = c.mode === 'series' ? topics.length : c.mode === 'library' ? c.jobIds.length : 1;
  const preview = c.mode === 'series' ? topics.map((t) => t.topic) : c.mode === 'library' && c.jobIds.length > 1 ? c.jobIds.map((id) => videoById(id)?.title ?? id) : [];
  const field = 'w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500';
  const whenDate = new Date(c.when);
  const quick = [{ label: 'Tomorrow 9 AM', d: at(1, 9) }, { label: 'Tomorrow 6 PM', d: at(1, 18) }, { label: 'In 3 days', d: at(3, 9) }, { label: 'Next week', d: at(7, 9) }];
  const libFormats = new Set(c.jobIds.map((id) => videoById(id)?.format));
  // Only warn once the user has overridden platforms: by default each library video goes where its format fits.
  const mismatch = c.mode === 'library'
    ? (!c.platformsTouched ? '' : libFormats.has('16:9') && c.platforms.some((p) => p !== 'youtube') ? 'A 16:9 video is selected — TikTok, Reels and Shorts expect vertical.' : libFormats.has('9:16') && c.platforms.includes('youtube') ? 'A vertical video is selected — consider a YouTube Short instead.' : '')
    : c.format === '16:9' && c.platforms.some((p) => p !== 'youtube') ? '16:9 will look small on TikTok, Reels and Shorts.' : c.format === '9:16' && c.platforms.includes('youtube') ? 'Vertical videos fit better as a YouTube Short.' : '';
  return html`
    <div class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" @click=${() => { if (!c.busy) { state.composer = null; draw(); } }}></div>
    <div role="dialog" aria-modal="true" aria-label="Schedule a post" class="fixed inset-x-4 top-[5vh] bottom-[5vh] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[640px] z-[70] rounded-3xl bg-zinc-950 border border-zinc-800 overflow-y-auto scrollbar-thin">
      <form class="p-6 space-y-5" @submit=${submitComposer}>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold tracking-tight text-white">Schedule a post</h2>
          <button type="button" class="w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 inline-flex items-center justify-center" aria-label="Close" @click=${() => { state.composer = null; draw(); }}>${icon(X)}</button>
        </div>
        ${seg<Composer['mode']>([{ value: 'topic', label: 'New topic' }, { value: 'library', label: 'From library' }, { value: 'series', label: 'Series' }], c.mode, (v) => { c.mode = v; if (v === 'library') loadVideos(); if (v === 'series' && c.everyDays === 0) c.everyDays = 1; })}

        ${c.mode === 'topic' ? html`
          <input class=${field} placeholder="A topic, a headline or a link" maxlength="500" .value=${c.topic} @input=${(e: Event) => { c.topic = (e.target as HTMLInputElement).value; draw(); }} />
          <textarea rows="2" class="${field} resize-none" maxlength="2000" placeholder="Optional notes: audience, example, must-cover points" .value=${c.brief} @input=${(e: Event) => { c.brief = (e.target as HTMLTextAreaElement).value; }}></textarea>` : nothing}
        ${c.mode === 'library' ? libraryPicker(c) : nothing}
        ${c.mode === 'series' ? html`
          <textarea rows="5" class="${field} resize-y font-mono" placeholder=${'One topic per line, add notes after a |\nConsistent hashing\nKafka consumer groups | use a ride-sharing example'} .value=${c.lines} @input=${(e: Event) => { c.lines = (e.target as HTMLTextAreaElement).value; draw(); }}></textarea>
          <div class="space-y-1.5">${fieldLabel('Post one every')}${seg<number>([{ value: 1, label: 'Day' }, { value: 2, label: '2 days' }, { value: 3, label: '3 days' }, { value: 7, label: 'Week' }], c.everyDays, (v) => (c.everyDays = v))}</div>` : nothing}

        <div class="space-y-2">
          ${fieldLabel(`${many ? 'First post' : 'Post on'} · ${timezone()}`)}
          <input type="datetime-local" class="${field} [color-scheme:dark]" min=${toLocalInput(new Date())} .value=${c.when} @input=${(e: Event) => { c.when = (e.target as HTMLInputElement).value; draw(); }} />
          <div class="flex flex-wrap gap-1.5">${quick.map((q) => html`<button type="button" class="text-[11px] font-mono px-2 py-1 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 transition" @click=${() => { c.when = toLocalInput(q.d); draw(); }}>${q.label}</button>`)}</div>
          ${!Number.isNaN(whenDate.getTime()) && !many ? html`<p class="text-xs text-zinc-500">${fmtFull(whenDate)}</p>` : nothing}
        </div>

        ${preview.length && !Number.isNaN(whenDate.getTime()) ? html`
          <ol class="rounded-xl border border-zinc-800 bg-black/40 divide-y divide-zinc-900 max-h-40 overflow-y-auto scrollbar-thin">
            ${preview.map((title, i) => html`<li class="flex items-center justify-between gap-3 px-3 py-2 text-xs"><span class="truncate text-zinc-200">${title}</span><span class="shrink-0 font-mono text-zinc-500">${fmtDay(seriesDate(c, i))} · ${fmtTime(seriesDate(c, i))}</span></li>`)}
          </ol>` : nothing}

        <div class="space-y-2">${fieldLabel('Platforms')}${platformPicker(c)}
          ${mismatch ? html`<p class="text-xs text-amber-300">${mismatch}</p>` : nothing}
        </div>
        ${c.mode === 'library' && c.jobIds.length > 1 && !c.platformsTouched ? html`<p class="-mt-3 text-xs text-zinc-500">Each video goes to the platforms that fit its format. Change these to use the same platforms for all.</p>` : nothing}
        ${c.mode === 'library' ? nothing : videoSettings(c)}
        ${c.error ? html`<p class="text-xs font-mono text-rose-400">${c.error}</p>` : nothing}
        <div class="flex items-center justify-end gap-3 pt-1">
          ${problem ? html`<span class="text-xs text-zinc-500">${problem}</span>` : nothing}
          <button class="rounded-xl bg-white text-black text-sm font-semibold px-5 py-2.5 hover:bg-zinc-200 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed" ?disabled=${!!problem || c.busy}>
            ${c.busy ? 'Scheduling…' : many ? `Schedule ${count || ''} post${count === 1 ? '' : 's'}` : 'Schedule'}
          </button>
        </div>
      </form>
    </div>`;
}
