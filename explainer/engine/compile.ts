/**
 * Compiler: VideoSpec (+ optional TTS timings) → RenderPlan.
 * Resolves cues to frames, grid to pixels, colours to hex, icons to data URIs,
 * expands multi-target steps, schedules SFX and captions. Never throws on bad
 * references — it records Issues so the LLM gets precise, fixable feedback.
 */
import { autoTitleStyle } from './title';
import type { BoardScene, Element, PlacedElement, Step, VideoSpec } from './schema';
import { CONTENT, FORMAT_SCALE, FRAME, gridToPx, ringPoint, ringRadius, type Format } from './layout';
import { DEFAULT_COLOR, THEMES } from './theme';
import { estimatePace, estimateWordTimes, parseNarration, type WordTime } from './narration';
import {
  foldScene,
  type CaptionChunk,
  type Issue,
  type PlanAction,
  type PlanElement,
  type PlanScene,
  type RenderPlan,
  type SfxName,
} from './plan';

export interface SceneTiming {
  /** Audio path relative to the public dir (e.g. "videos/x/s1.mp3") or an absolute https URL. */
  src?: string;
  durationSec: number;
  /** One entry per display token of the scene narration. */
  words: WordTime[];
  /** Hash of the spoken text + voice settings; used to detect stale audio. */
  hash?: string;
}

export interface CompileOptions {
  fps?: number;
  timings?: Record<string, SceneTiming>;
  resolveIcon?: (icon: string, hex: string) => string | null;
}

const HEAD = 6; // frames of silence before narration starts
const TAIL = 16; // breathing room after the last word (short: the voice should flow across scenes)
const FIRST_VISUAL_BY = 18; // the board shows something within 0.6 s of a new slide
const MIN_READ_FRAMES = 54; // the last new element stays up at least 1.8 s
const MIN_SETTLE_FRAMES = 24; // any animation gets 0.8 s to finish before the cut
const CUE_GAP = 15; // frames between a moved cue and the one before it
const CUE_LEAD = 3; // visuals land a hair before the word — feels "in sync" to viewers

const PLACED = new Set(['node', 'db', 'server', 'client', 'queue', 'table', 'code', 'list', 'chat', 'text', 'chip', 'note', 'bars', 'ring', 'marker']);
export const isPlaced = (e: Element): e is PlacedElement => PLACED.has(e.type);

export function compile(spec: VideoSpec, opts: CompileOptions = {}): { plan: RenderPlan; issues: Issue[] } {
  const fps = opts.fps ?? 30;
  const theme = THEMES[spec.theme];
  const format = spec.format as Format;
  const issues: Issue[] = [];
  const scenes: PlanScene[] = [];
  const hex = (name: string | undefined, fallback: string) => theme.colors[(name ?? fallback) as keyof typeof theme.colors] ?? theme.ink;

  const sceneIds = new Set<string>();
  spec.scenes.forEach((sc, si) => {
    const where = `scenes[${si}] "${sc.id}"`;
    if (sceneIds.has(sc.id)) issues.push({ level: 'error', code: 'DUP_SCENE_ID', where, message: `Duplicate scene id "${sc.id}".`, fix: 'Give every scene a unique id.' });
    sceneIds.add(sc.id);

    // ── narration timing ──
    const parsed = parseNarration(sc.narration ?? '', spec.pronounce);
    for (const d of parsed.duplicateCues) {
      issues.push({ level: 'error', code: 'DUP_CUE', where, message: `Cue {${d}} appears twice in the narration.`, fix: 'Each cue name must be unique within a scene.' });
    }
    let words: WordTime[] = [];
    let dur = 0;
    let estimated = true;
    const t = opts.timings?.[sc.id];
    if (parsed.tokens.length) {
      if (t && t.words.length === parsed.tokens.length) {
        words = t.words;
        dur = t.durationSec;
        estimated = false;
      } else {
        if (t) issues.push({ level: 'warn', code: 'STALE_AUDIO', where, message: 'Audio timings do not match the current narration (narration changed). Using estimates.', fix: 'Re-run `tts` for this video.' });
        const est = estimateWordTimes(parsed.tokens, estimatePace(spec.voice));
        words = est.words;
        dur = est.duration;
      }
    }
    const wordFrames = words.map((w, i) => ({
      text: parsed.tokens[i].display,
      startFrame: HEAD + Math.round(w.start * fps),
      endFrame: HEAD + Math.max(Math.round(w.start * fps) + 2, Math.round(w.end * fps)),
    }));
    const narrationEnd = wordFrames.length ? wordFrames[wordFrames.length - 1].endFrame : HEAD;
    const minFrames = sc.kind === 'title' ? Math.round(2.6 * fps) : Math.round(2 * fps);
    const durationInFrames = Math.max(minFrames, HEAD + Math.ceil(dur * fps) + TAIL);

    const cueFrames: Record<string, number> = {};
    // Written order is kept: a cue never fires before one written ahead of it (an arrow must exist before a flow uses it).
    let earliest = 0;
    for (const [name, idx] of Object.entries(parsed.cues).sort((p, q) => p[1] - q[1])) {
      // Only a cue written at the end of its phrase is moved back to where the phrase begins.
      const at = parsed.cuesEndingPhrase.includes(name) ? cueWordIndex(parsed.tokens.map((t) => t.display), idx) : idx;
      const frameOf = (w: number) => (w < wordFrames.length ? Math.max(0, wordFrames[w].startFrame - CUE_LEAD) : narrationEnd);
      const written = frameOf(idx);
      // A moved cue also leaves the previous step time to appear, but never fires later than where it was written.
      const frame = at === idx ? written : Math.min(written, Math.max(frameOf(at), earliest + CUE_GAP));
      earliest = Math.max(earliest, frame);
      cueFrames[name] = earliest;
    }

    const next = spec.scenes[si + 1];
    const base: PlanScene = {
      id: sc.id,
      kind: sc.kind,
      durationInFrames,
      fadeIn: !(sc.kind === 'board' && sc.continue),
      fadeOut: !(next && next.kind === 'board' && next.continue),
      headingStatic: false,
      audio: t?.src && !estimated ? { src: t.src, startFrame: HEAD } : undefined,
      narrationStart: HEAD,
      narrationEnd,
      words: wordFrames,
      captions: chunkCaptions(wordFrames, format),
      cueFrames,
      elements: [],
      actions: [],
      sfx: [],
      estimatedTiming: estimated && parsed.tokens.length > 0,
    };

    if (sc.kind === 'title') {
      // An unknown icon only costs the title its picture, never the video.
      const icon = sc.icon && opts.resolveIcon ? opts.resolveIcon(sc.icon, theme.colors.yellow) ?? undefined : undefined;
      if (sc.icon && !icon) issues.push({ level: 'warn', code: 'ICON_UNKNOWN', where: `scene "${sc.id}"`, message: `Title icon "${sc.icon}" not found, so the title screen won't show it.` });
      const style = sc.titleStyle === 'hero' && !icon ? autoTitleStyle(sc.title, false) : sc.titleStyle ?? autoTitleStyle(sc.title, !!icon);
      base.title = { kicker: sc.kicker, title: sc.title, subtitle: sc.subtitle, style, icon };
      base.sfx.push({ frame: 4, name: 'swoosh', volume: 0.35 });
      scenes.push(base);
      return;
    }

    // ── board scene ──
    const prev = [...scenes].reverse().find((s) => s.kind === 'board');
    if (sc.continue && !prev) {
      issues.push({ level: 'error', code: 'CONTINUE_NO_PREV', where, message: '`continue: true` but there is no previous board scene.', fix: 'Remove `continue` or add a board scene before it.' });
    }
    if (sc.continue && scenes[scenes.length - 1]?.kind !== 'board') {
      issues.push({ level: 'warn', code: 'CONTINUE_AFTER_TITLE', where, message: '`continue` after a title card carries the board across the title — usually unintended.', fix: 'Remove `continue` or move the title card.' });
    }
    base.heading = sc.heading ?? (sc.continue ? prev?.heading : undefined);
    base.headingStatic = !!(sc.continue && prev && prev.heading === base.heading);

    const elements: PlanElement[] = [];
    const byId = new Map<string, PlanElement>();

    if (sc.continue && prev) {
      const st = foldScene(prev, prev.durationInFrames);
      for (const el of prev.elements) {
        const s = st.els[el.id];
        if (!s?.visible) continue;
        const specCopy: any = { ...el.spec };
        for (const k of ['label', 'sub', 'text', 'items', 'rows'] as const) if (s.ov[k] !== undefined) specCopy[k] = s.ov[k];
        if (s.ov.values && specCopy.type === 'bars') specCopy.bars = specCopy.bars.map((b: any, i: number) => ({ ...b, value: s.ov.values[i] ?? b.value }));
        delete specCopy.emergeFrom;
        // A growing diagram keeps its state: what was dimmed, ticked or lit stays that way in the next scene.
        const carried: PlanElement = { ...el, spec: specCopy, pos: s.pos, initiallyVisible: true, carry: { dimmed: s.dimmed, struck: s.struckAt !== null, mark: s.mark?.kind, hl: s.hl ? { color: s.hl.color, row: s.hl.row } : undefined } };
        elements.push(carried);
        byId.set(el.id, carried);
      }
    }

    sc.elements.forEach((el, ei) => {
      const ew = `${where} elements[${ei}] "${el.id}"`;
      if (byId.has(el.id)) {
        issues.push({ level: 'error', code: 'DUP_ID', where: ew, message: `Element id "${el.id}" already exists in this scene${sc.continue ? ' (possibly carried over by `continue`)' : ''}.`, fix: sc.continue ? 'Use a new id, or `set`/`move` the carried element instead of redefining it.' : 'Use unique ids.' });
        return;
      }
      const color = hex(el.color, DEFAULT_COLOR[el.type]);
      const scaled = el.type === 'ring' || el.type === 'marker' ? el : ({ ...el, __scale: FORMAT_SCALE[spec.format as Format] } as any);
      const pe: PlanElement = { id: el.id, spec: scaled, color, initiallyVisible: false };
      if (el.type === 'marker') {
        // positioned in the ring pass below
      } else if (isPlaced(el)) {
        pe.pos = gridToPx(format, (el as any).at);
        const c = CONTENT[format];
        const at = (el as any).at as [number, number];
        if (at[0] < 0 || at[0] > c.cols || at[1] < 0 || at[1] > c.rows) {
          issues.push({ level: 'error', code: 'GRID_RANGE', where: ew, message: `at [${at}] is outside the ${format} grid (x 0..${c.cols}, y 0..${c.rows}).`, fix: `Keep x within 0..${c.cols} and y within 0..${c.rows}.` });
        }
        const iconName = el.type === 'node' ? el.icon : el.type === 'db' ? el.icon : undefined;
        if (iconName && opts.resolveIcon) {
          const uri = opts.resolveIcon(iconName, color);
          if (uri) pe.icon = uri;
          else issues.push({ level: 'error', code: 'ICON_UNKNOWN', where: ew, message: `Icon "${iconName}" not found.`, fix: 'Run `explainer icons <query>` and use an exact id like "lucide:database", "aws:lambda" or "si:redis".' });
        }
      }
      elements.push(pe);
      byId.set(el.id, pe);
    });

    // ring pass: place markers on their ring (0° = top, clockwise); label direction points outward
    for (const pe of elements) {
      const el = pe.spec as any;
      if (el.type !== 'marker' || pe.initiallyVisible) continue;
      const ring = byId.get(el.ring);
      if (!ring || ring.spec.type !== 'ring' || !ring.pos) {
        issues.push({ level: 'error', code: 'BAD_REF', where: `${where} marker "${el.id}"`, message: `Marker ring "${el.ring}" is not a ring in this scene.`, fix: `Rings here: ${[...byId.values()].filter((e) => e.spec.type === 'ring').map((e) => e.id).join(', ') || 'none — add a ring element'}` });
        pe.pos = { x: 0, y: 0 };
        continue;
      }
      const a = (el.angle * Math.PI) / 180;
      pe.pos = ringPoint(ring.pos, ringRadius((ring.spec as any).size), el.angle);
      pe.spec = { ...el, __dir: { x: Math.sin(a), y: -Math.cos(a) } };
    }

    // references inside elements
    for (const pe of elements) {
      const el = pe.spec as any;
      if (el.type === 'arrow') {
        for (const end of ['from', 'to'] as const) {
          const target = byId.get(el[end]);
          if (!target) issues.push({ level: 'error', code: 'BAD_REF', where: `${where} arrow "${el.id}"`, message: `Arrow ${end} "${el[end]}" does not exist.`, fix: `Use one of: ${[...byId.keys()].join(', ')}` });
          else if (target.spec.type === 'arrow') issues.push({ level: 'error', code: 'BAD_REF', where: `${where} arrow "${el.id}"`, message: `Arrow ${end} points at another arrow.`, fix: 'Arrows connect elements or groups.' });
        }
        if (el.from === el.to) issues.push({ level: 'error', code: 'SELF_ARROW', where: `${where} arrow "${el.id}"`, message: 'Arrow connects an element to itself.' });
      }
      if (el.type === 'group') {
        for (const c of el.contains) {
          const t = byId.get(c);
          if (!t || !isPlaced(t.spec)) issues.push({ level: 'error', code: 'BAD_REF', where: `${where} group "${el.id}"`, message: `Group contains unknown/non-placed element "${c}".` });
        }
      }
      if (el.emergeFrom && !byId.has(el.emergeFrom)) {
        issues.push({ level: 'error', code: 'BAD_REF', where: `${where} element "${el.id}"`, message: `emergeFrom "${el.emergeFrom}" does not exist.` });
      }
    }

    // ── steps → actions ──
    const resolveAt = (at: string | number, sw: string): number | null => {
      if (typeof at === 'number') return HEAD + Math.round(at * fps);
      const m = parseAt(at, Object.keys(cueFrames));
      if (!m) {
        issues.push({ level: 'error', code: 'BAD_AT', where: sw, message: `Cannot parse at="${at}".`, fix: 'Use a cue name, "cue+0.5", "start", "end", or seconds as a number.' });
        return null;
      }
      const off = m[3] ? (m[2] === '-' ? -1 : 1) * Math.round(parseFloat(m[3]) * fps) : 0;
      let f: number;
      if (m[1] === 'start') f = 6;
      else if (m[1] === 'end') f = durationInFrames - 24;
      else if (m[1] in cueFrames) f = cueFrames[m[1]];
      else {
        const avail = Object.keys(cueFrames);
        issues.push({ level: 'error', code: 'UNKNOWN_CUE', where: sw, message: `Cue "${m[1]}" is not in the narration.`, fix: avail.length ? `Available cues: ${avail.join(', ')} — or add {${m[1]}} to the narration.` : `Add {${m[1]}} markers to the narration text.` });
        return null;
      }
      return Math.min(durationInFrames - 2, Math.max(0, f + off));
    };

    const actions: PlanAction[] = [];
    const need = (id: string, sw: string, kinds?: string[]) => {
      const t = byId.get(id);
      if (!t) {
        issues.push({ level: 'error', code: 'BAD_REF', where: sw, message: `Unknown element "${id}".`, fix: `Known ids: ${[...byId.keys()].join(', ')}` });
        return null;
      }
      if (kinds && !kinds.includes(t.spec.type)) {
        issues.push({ level: 'error', code: 'BAD_TARGET_TYPE', where: sw, message: `"${id}" is a ${t.spec.type}; this step needs ${kinds.join('/')}.` });
        return null;
      }
      return t;
    };

    sc.steps.forEach((st: Step, i) => {
      const sw = `${where} steps[${i}] (${st.do} @ ${JSON.stringify(st.at)})`;
      const frame = resolveAt(st.at, sw);
      if (frame === null) return;
      const push = (a: Partial<PlanAction>) => actions.push({ ...(st as any), ...a, frame: a.frame ?? frame, stepIndex: i } as PlanAction);
      switch (st.do) {
        case 'show': {
          const valid = st.targets.filter((id) => need(id, sw));
          const placedFirst = [...valid].sort((a, b) => Number(byId.get(a)!.spec.type === 'arrow') - Number(byId.get(b)!.spec.type === 'arrow'));
          const nonArrows = placedFirst.filter((id) => byId.get(id)!.spec.type !== 'arrow');
          // A stamp is a moment, not a label: it clears itself so it never sits over what comes next.
          for (const id of valid) {
            const sp = byId.get(id)!.spec as any;
            if (sp.type === 'text' && sp.style === 'stamp' && !sc.steps.some((x: any) => x.do === 'hide' && x.targets.includes(id))) actions.push({ at: st.at, do: 'hide', targets: [id], target: id, frame: frame + Math.round(2.2 * fps), stepIndex: i } as PlanAction);
          }
          const stagger = Math.round((st.stagger ?? (valid.length > 1 ? 0.18 : 0)) * fps);
          let lastPlaced = frame;
          placedFirst.forEach((id, j) => {
            const isArrow = byId.get(id)!.spec.type === 'arrow';
            const f = isArrow
              ? (nonArrows.length ? lastPlaced + 10 : frame) + (j - nonArrows.length) * Math.max(4, Math.round(stagger / 2))
              : frame + j * stagger;
            if (!isArrow) lastPlaced = f;
            push({ target: id, frame: f });
          });
          break;
        }
        case 'hide':
        case 'dim':
        case 'undim':
          st.targets.forEach((id) => need(id, sw) && push({ target: id }));
          break;
        case 'focus':
          st.targets.forEach((id) => need(id, sw));
          push({});
          break;
        case 'unfocus':
          push({});
          break;
        case 'flow': {
          const arrows = st.path.map((id) => need(id, sw, ['arrow']));
          if (arrows.every(Boolean)) {
            const ends = arrows.map((a) => a!.spec as any);
            const ordered = st.reverse ? [...ends].reverse().map((e) => ({ from: e.to, to: e.from })) : ends.map((e) => ({ from: e.from, to: e.to }));
            for (let k = 1; k < ordered.length; k++) {
              if (ordered[k - 1].to !== ordered[k].from) {
                issues.push({ level: 'error', code: 'FLOW_GAP', where: sw, message: `Flow path breaks between "${st.path[k - 1]}" and "${st.path[k]}" (${ordered[k - 1].to} ≠ ${ordered[k].from}).`, fix: 'Consecutive arrows must share an endpoint in travel direction (use `reverse` for return trips).' });
              }
            }
          }
          push({ hex: hex(st.color, 'yellow') });
          break;
        }
        case 'highlight': {
          const t = need(st.target, sw);
          if (t && st.row !== undefined) {
            const s = t.spec as any;
            const max = s.type === 'table' ? s.rows.length : s.type === 'code' ? s.lines.length : s.type === 'list' ? s.items.length : s.type === 'chat' ? s.messages.length : s.type === 'bars' ? s.bars.length : -1;
            if (max < 0) issues.push({ level: 'error', code: 'BAD_ROW', where: sw, message: '`row` only applies to table, code, list, chat and bars.' });
            else if (st.row >= max) issues.push({ level: 'error', code: 'BAD_ROW', where: sw, message: `row ${st.row} out of range (0..${max - 1}).` });
          }
          push({ target: st.target, hex: hex(st.color, 'yellow') });
          if (st.for) actions.push({ at: st.at, do: 'unhighlight', target: st.target, frame: frame + Math.round(st.for * fps), stepIndex: i } as PlanAction);
          break;
        }
        case 'shake':
          need(st.target, sw) && push({ target: st.target, until: frame + Math.round((st.for ?? 1.4) * fps) });
          break;
        case 'move': {
          const t = need(st.target, sw);
          if (t && !isPlaced(t.spec)) issues.push({ level: 'error', code: 'BAD_TARGET_TYPE', where: sw, message: 'Only placed elements can move (not arrows/groups).' });
          if (t && (t.spec.type === 'ring' || t.spec.type === 'marker')) issues.push({ level: 'error', code: 'BAD_TARGET_TYPE', where: sw, message: 'Rings and markers cannot move.', fix: 'Add a new marker at the new angle (show it) and hide the old one.' });
          push({ target: st.target, toPx: gridToPx(format, st.to) });
          break;
        }
        case 'reveal':
          need(st.target, sw, ['list', 'chat']);
          push({ target: st.target });
          break;
        case 'set':
          need(st.target, sw);
          push({ target: st.target });
          break;
        case 'travel': {
          const a = need(st.target, sw, ['marker']);
          const b = need(st.to, sw, ['marker']);
          if (a && b && (a.spec as any).ring !== (b.spec as any).ring) issues.push({ level: 'error', code: 'TRAVEL_RING', where: sw, message: `"${st.target}" and "${st.to}" are on different rings.` });
          push({ target: st.target, hex: hex(st.color, 'yellow') });
          break;
        }
        case 'span': {
          need(st.target, sw, ['ring']);
          for (const m of [st.from, st.to]) {
            const t = need(m, sw, ['marker']);
            if (t && (t.spec as any).ring !== st.target) issues.push({ level: 'error', code: 'SPAN_RING', where: sw, message: `Marker "${m}" is not on ring "${st.target}".` });
          }
          push({ target: st.target, hex: hex(st.color, 'yellow'), until: st.for ? frame + Math.round(st.for * fps) : undefined });
          break;
        }
        case 'unspan':
          need(st.target, sw, ['ring']);
          push({ target: st.target });
          break;
        default:
          need((st as any).target, sw);
          push({ target: (st as any).target });
      }
    });

    actions.sort((a, b) => a.frame - b.frame || a.stepIndex - b.stepIndex);

    // A narrator is talking the whole time, so the picture must keep up. No blank board while they speak…
    const firstShow = actions.find((a) => a.do === 'show');
    if (firstShow && !elements.some((e) => e.initiallyVisible) && firstShow.frame > FIRST_VISUAL_BY) {
      const late = firstShow.frame;
      for (const a of actions) if (a.do === 'show' && a.frame === late) a.frame = FIRST_VISUAL_BY;
      actions.sort((a, b) => a.frame - b.frame || a.stepIndex - b.stepIndex);
    }
    // Nothing animates an element before it exists (one "show" reveals its targets one after another).
    const shownAt = new Map<string, number>();
    for (const a of actions) if (a.do === 'show' && (a as any).target && !shownAt.has((a as any).target)) shownAt.set((a as any).target, a.frame);
    let reordered = false;
    for (const a of actions) {
      if (a.do === 'show' || a.do === 'hide') continue;
      const ids: string[] = [(a as any).target, ...(((a as any).path as string[]) ?? [])].filter(Boolean);
      const ready = Math.max(-1, ...ids.map((id) => shownAt.get(id) ?? -1));
      if (ready >= 0 && a.frame < ready + 12) { a.frame = ready + 12; reordered = true; }
    }
    if (reordered) actions.sort((a, b) => a.frame - b.frame || a.stepIndex - b.stepIndex);
    // …and no slide leaves before its last element can be read.
    const lastShow = actions.reduce((m, a) => (a.do === 'show' ? Math.max(m, a.frame) : m), 0);
    const lastAny = actions.reduce((m, a) => Math.max(m, a.frame), 0);
    base.durationInFrames = Math.max(base.durationInFrames, lastShow + MIN_READ_FRAMES, lastAny + MIN_SETTLE_FRAMES);
    base.elements = elements;
    base.actions = actions;
    base.sfx = scheduleSfx(actions, byId);
    scenes.push(base);
  });

  const { w, h } = FRAME[format];
  const plan: RenderPlan = {
    version: 1,
    id: spec.id,
    title: spec.title,
    format,
    width: w,
    height: h,
    fps,
    theme: spec.theme,
    captions: spec.captions ?? (format === '9:16' ? 'karaoke' : 'subtle'),
    brand: spec.brand,
    brandKit: spec.brandKit,
    endFrames: spec.brandKit ? END_CARD_FRAMES : undefined,
    music: spec.music ? { src: spec.music.src, volume: spec.music.volume } : undefined,
    scenes,
    totalFrames: scenes.reduce((s, sc) => s + sc.durationInFrames, 0) + (spec.brandKit ? END_CARD_FRAMES : 0),
  };
  return { plan, issues };
}

/**
 * Writers sometimes put a cue after the phrase it illustrates ("…becomes a number {ids}."). Firing there means the picture
 * lags the voice and arrives just as the slide leaves, so such a cue fires when that clause begins. Only cues written
 * right before punctuation (or at the very end) are moved: "…in one go. {arch} Tickets…" fires on "Tickets", as written.
 */
export function cueWordIndex(tokens: string[], idx: number): number {
  const closes = (t: string) => /[.!?;:,—–]["'’”)]*$/.test(t) || !/[\p{L}\p{N}]/u.test(t);
  if (idx <= 0 || (idx < tokens.length && !closes(tokens[idx - 1]))) return idx;
  let j = idx - 2;
  while (j >= 0 && !closes(tokens[j])) j--;
  return j + 1;
}

/** Closing brand card: long enough to read a URL, short enough that viewers don't swipe away early. */
export const END_CARD_FRAMES = 105;

function scheduleSfx(actions: PlanAction[], byId: Map<string, PlanElement>): PlanScene['sfx'] {
  const out: PlanScene['sfx'] = [];
  const add = (frame: number, name: SfxName, volume: number) => {
    if (out.some((s) => Math.abs(s.frame - frame) < 5)) return;
    out.push({ frame, name, volume });
  };
  for (const a of actions) {
    switch (a.do) {
      case 'show': {
        const t = byId.get(a.target!);
        if (t?.spec.type === 'arrow') break;
        if (t?.spec.type === 'text' && t.spec.style === 'stamp') add(a.frame + 3, 'thud', 0.55);
        else add(a.frame, 'pop', 0.32);
        break;
      }
      case 'flow':
      case 'travel': add(a.frame, 'whoosh', 0.3); break;
      case 'span': add(a.frame, 'tick', 0.25); break;
      case 'strike': add(a.frame, 'error', 0.3); break;
      case 'mark': add(a.frame + 4, a.kind === 'check' ? 'ding' : 'error', a.kind === 'check' ? 0.35 : 0.3); break;
      case 'shake': add(a.frame, 'thud', 0.42); break;
      case 'focus':
      case 'unfocus': add(a.frame, 'swoosh', 0.22); break;
      case 'highlight': add(a.frame, 'tick', 0.25); break;
      case 'reveal': add(a.frame, 'tick', 0.22); break;
      default: break;
    }
  }
  return out.sort((a, b) => a.frame - b.frame);
}

function chunkCaptions(words: Array<{ text: string; startFrame: number; endFrame: number }>, format: Format): CaptionChunk[] {
  const max = format === '9:16' ? 4 : 8;
  const chunks: CaptionChunk[] = [];
  let cur: typeof words = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({ startFrame: cur[0].startFrame, endFrame: cur[cur.length - 1].endFrame, words: cur });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const punct = /[.!?]$/.test(w.text) || (/[,;:]$/.test(w.text) && cur.length >= 3);
    if (cur.length >= max || punct) flush();
  }
  flush();
  // hold each chunk until the next starts (no flicker), but not more than 0.8s of silence
  for (let i = 0; i < chunks.length; i++) {
    const nxt = chunks[i + 1];
    chunks[i].endFrame = nxt ? Math.min(nxt.startFrame, chunks[i].endFrame + 24) : chunks[i].endFrame + 18;
  }
  return chunks;
}

/**
 * Parse a step `at` string → [_, name, sign, seconds]. Cue names are kebab-case, so "land-a" is a cue while
 * "land-0.5" is cue "land" minus 0.5 s — unless a cue literally named "land-0" exists. Known cues win.
 */
export function parseAt(at: string, cues: string[]): [string, string, string | undefined, string | undefined] | null {
  const s = at.trim();
  if (cues.includes(s) || s === 'start' || s === 'end') return [s, s, undefined, undefined];
  const m = s.match(/^([a-z][a-z0-9-]*?)\s*([+-])\s*(\d+(?:\.\d+)?)$/);
  if (m) return [s, m[1], m[2], m[3]];
  return /^[a-z][a-z0-9-]*$/.test(s) ? [s, s, undefined, undefined] : null;
}

export function isBoard(s: VideoSpec['scenes'][number]): s is BoardScene {
  return s.kind === 'board';
}
