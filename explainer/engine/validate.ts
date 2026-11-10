/**
 * Validator: schema → compile → layout/timing/pacing/readability checks.
 * Every issue has a location and a concrete fix so an LLM can repair it in a loop.
 */
import type { ZodIssue } from 'zod';
import { VideoSpec } from './schema';
import { compile, isPlaced, parseAt, type CompileOptions } from './compile';
import { CONTENT, arrowEnd, arrowGeometry, footprint, groupRect, inset, intersection, quadPoint, type Format, type Rect, arrowLabelRect, arrowLabelSide } from './layout';
import { effectiveSpec, foldScene, type Issue, type PlanScene, type RenderPlan } from './plan';
import { findSpokenLists, screenWords } from './spoken-lists';
import { findKeyFigures, findMovements } from './emphasis';
import { parseNarration } from './narration';

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  spec?: VideoSpec;
  plan?: RenderPlan;
  stats?: { scenes: number; seconds: number; words: number; estimatedTiming: boolean };
}

/** Longest a title screen should hold; a static screen this long loses viewers. */
const TITLE_MAX_SECONDS = 9;
const NOTE_CLEARANCE = 18;

export function validate(raw: unknown, opts: CompileOptions = {}): ValidationResult {
  const parsed = VideoSpec.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 40).map(zodToIssue);
    return { ok: false, errors, warnings: [] };
  }
  const spec = parsed.data;
  const { plan, issues } = compile(spec, opts);
  const format = spec.format as Format;

  textLimits(spec, format, issues);
  mixChecks(spec, format, issues);
  cutText(spec, issues);
  spec.scenes.forEach((sc, si) => {
    const ps = plan.scenes[si];
    if (sc.kind === 'board' && ps) sceneChecks(sc, ps, format, plan.fps, issues, si === spec.scenes.length - 1, spec.scenes.slice(0, si).some((x) => x.kind === 'board'));
    if (sc.kind === 'title' && ps && ps.durationInFrames / plan.fps > TITLE_MAX_SECONDS) {
      issues.push({ level: 'warn', code: 'TITLE_LONG', where: `scene "${sc.id}"`, scene: sc.id, message: `The title screen holds for ${(ps.durationInFrames / plan.fps).toFixed(1)}s (keep it under ${TITLE_MAX_SECONDS}s).`, fix: 'Say the title, then one hook of 12 words at most. Move the rest into the first board.' });
    }
  });

  // global narration stats
  let words = 0;
  for (const sc of spec.scenes) words += parseNarration(sc.narration ?? '', spec.pronounce).tokens.length;
  const seconds = (plan.totalFrames - (plan.endFrames ?? 0)) / plan.fps; // the closing card isn't part of the requested length
  if (spec.targetSeconds) {
    const diff = seconds / spec.targetSeconds - 1;
    const words = Math.round(Math.abs(seconds - spec.targetSeconds) * 2.5);
    if (Math.abs(diff) > 0.1) {
      issues.push({
        level: Math.abs(diff) > 0.2 ? 'error' : 'warn', code: 'DURATION', where: 'video',
        message: `Video runs ~${Math.round(seconds)}s but the target is ${spec.targetSeconds}s (${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%).`,
        fix: diff > 0 ? `Cut ~${words} words of narration (tighten sentences, merge or drop a scene).` : `Add ~${words} words of narration (a worked example or one more beat).`,
      });
    }
  }
  if (seconds > 20 * 60) issues.push({ level: 'warn', code: 'LONG_VIDEO', where: 'video', message: `Video is ${(seconds / 60).toFixed(1)} min. Long renders are fine but consider splitting into parts.` });
  if (!spec.scenes.some((s) => s.kind === 'board')) issues.push({ level: 'error', code: 'NO_BOARD', where: 'video', message: 'Video has no board scenes.' });

  const dedup = (list: Issue[]) => {
    const seen = new Set<string>();
    return list.filter((i) => {
      const key = `${i.code}|${i.where}|${i.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const errors = dedup(issues.filter((i) => i.level === 'error'));
  const warnings = dedup(issues.filter((i) => i.level === 'warn'));
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    spec,
    plan,
    stats: { scenes: plan.scenes.length, seconds: Math.round(seconds), words, estimatedTiming: plan.scenes.some((s) => s.estimatedTiming) },
  };
}

function zodToIssue(z: ZodIssue): Issue {
  const where = z.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('').replace(/^\./, '') || 'root';
  let fix: string | undefined;
  const anyZ = z as any;
  if (z.code === 'invalid_union_discriminator') fix = `Allowed values: ${anyZ.options?.map((o: any) => JSON.stringify(o)).join(', ')}`;
  else if (z.code === 'unrecognized_keys') fix = `Remove unknown keys: ${anyZ.keys?.join(', ')}. Check the DSL reference for allowed fields.`;
  else if (z.code === 'invalid_enum_value') fix = `Allowed: ${anyZ.options?.join(', ')}`;
  else if (z.code === 'invalid_type') fix = `Expected ${anyZ.expected}, got ${anyZ.received}.`;
  return { level: 'error', code: `SCHEMA_${z.code.toUpperCase()}`, where, message: z.message, fix };
}

// ─── Readability limits ──────────────────────────────────────────────────────────

const LIMITS = {
  label: 24, chip: 24, stamp: 14, sub: 30, tableTitle: 30, cell: 22, note: 90, statement: 110, headline: 60, textLabel: 44,
  arrowLabel: 22, flowLabel: 16, groupLabel: 28, barLabel: 14, queueItem: 4, chatMessage: 90, title: 48, kicker: 26, subtitle: 80,
} as const;

/** The balance across a whole video: no choice of visual is wrong on its own, but text must not replace the drawing. */
function mixChecks(spec: VideoSpec, _format: Format, issues: Issue[]) {
  const boards = spec.scenes.filter((s): s is Extract<VideoSpec['scenes'][number], { kind: 'board' }> => s.kind === 'board');
  const stamps = boards.flatMap((b) => b.elements.filter((e) => e.type === 'text' && e.style === 'stamp'));
  if (stamps.length > 1) issues.push({ level: 'warn', code: 'TOO_MANY_STAMPS', where: 'video', message: `${stamps.length} stamps; the effect only works once.`, fix: 'Keep one stamp at the main turning point and make the others `statement` text or a `shake`.' });
  // A chip stands for the thing being followed, so one that never moves shows no journey.
  for (const b of boards) for (const el of b.elements) {
    if (el.type !== 'chip') continue;
    const later = boards.slice(boards.indexOf(b));
    const acted = later.some((x) => x.steps.some((st: any) => st.target === el.id && (st.do === 'move' || st.do === 'set') || (st.do === 'hide' && st.targets.includes(el.id))));
    if (later.length > 1 && !acted) {
      issues.push({ level: 'warn', code: 'CHIP_STILL', where: `scene "${b.id}" element "${el.id}"`, message: `Chip "${el.id}" stays on screen but never moves, so the viewer can't follow it.`, fix: '`move` it to each stage on the cue where the narrator reaches that stage, or hide it once its job is done.' });
    }
  }
  if (boards.length < 3) return;
  const wordy = boards.filter((b) => b.elements.length > 0 && b.elements.every((e) => e.type === 'list' || e.type === 'text' || e.type === 'note'));
  if (wordy.length > boards.length / 2) {
    issues.push({ level: 'warn', code: 'TOO_MUCH_TEXT', where: 'video', message: `${wordy.length} of ${boards.length} boards are only words (${wordy.map((b) => b.id).join(', ')}).`, fix: 'Keep the words where they are the point. Elsewhere draw it: nodes and arrows for how things connect, bars or a table for comparisons.' });
  }
}

/** Autofix cuts over-long text with "…". That fits, but it reads as a mistake, so ask for shorter wording. */
function cutText(spec: VideoSpec, issues: Issue[]) {
  for (const sc of spec.scenes) {
    if (sc.kind !== 'board') continue;
    const texts = [sc.heading, ...sc.elements.flatMap((e: any) => [e.label, e.sub, e.text, e.title, ...(e.items ?? [])])];
    for (const x of texts) {
      if (typeof x === 'string' && x.endsWith('…')) issues.push({ level: 'warn', code: 'TEXT_CUT', where: `scene "${sc.id}"`, message: `"${x}" was cut off to fit.`, fix: 'Reword it in fewer words so it fits whole. Same narration and cues.' });
    }
  }
}

function textLimits(spec: VideoSpec, format: Format, issues: Issue[]) {
  const vertical = format === '9:16';
  /** `path` is the JSON path of the string in the raw spec, so the harness can shorten it deterministically. */
  const lim = (where: string, what: string, text: string | undefined, max: number, path: Array<string | number>) => {
    if (text && [...text].length > max) {
      issues.push({ level: 'error', code: 'TEXT_TOO_LONG', where, message: `${what} "${text}" is ${[...text].length} chars (max ${max}).`, fix: `Rewrite it in at most ${max - 4} characters — on-screen text is a label, the narration carries the explanation.`, data: { path, max } });
    }
  };
  const headingMax = vertical ? 28 : 44;
  const codeMax = vertical ? 34 : 52;
  const listMax = vertical ? 30 : 46;
  spec.scenes.forEach((sc, si) => {
    const w = `scenes[${si}] "${sc.id}"`;
    const P = ['scenes', si] as Array<string | number>;
    if (sc.kind === 'title') {
      lim(w, 'Title', sc.title, LIMITS.title, [...P, 'title']);
      lim(w, 'Kicker', sc.kicker, LIMITS.kicker, [...P, 'kicker']);
      lim(w, 'Subtitle', sc.subtitle, LIMITS.subtitle, [...P, 'subtitle']);
      return;
    }
    lim(w, 'Heading', sc.heading, headingMax, [...P, 'heading']);
    sc.elements.forEach((el, ei) => {
      const ew = `${w} element "${el.id}"`;
      const E = [...P, 'elements', ei];
      switch (el.type) {
        case 'node': case 'db': case 'server': case 'client':
          lim(ew, 'Label', el.label, LIMITS.label, [...E, 'label']); lim(ew, 'Sub', el.sub, LIMITS.sub, [...E, 'sub']); break;
        case 'queue':
          lim(ew, 'Label', el.label, LIMITS.label, [...E, 'label']);
          el.items.forEach((it, k) => lim(ew, 'Queue item', it, LIMITS.queueItem, [...E, 'items', k]));
          break;
        case 'table':
          lim(ew, 'Table title', el.title, LIMITS.tableTitle, [...E, 'title']);
          el.columns.forEach((c, k) => lim(ew, 'Cell', c, LIMITS.cell, [...E, 'columns', k]));
          el.rows.forEach((r, ri) => r.forEach((c, k) => lim(ew, 'Cell', c, LIMITS.cell, [...E, 'rows', ri, k])));
          el.rows.forEach((r, ri) => {
            if (r.length !== el.columns.length) issues.push({ level: 'error', code: 'TABLE_SHAPE', where: ew, message: `Row ${ri} has ${r.length} cells but there are ${el.columns.length} columns.` });
          });
          break;
        case 'code': el.lines.forEach((l, k) => lim(ew, 'Code line', l, codeMax, [...E, 'lines', k])); lim(ew, 'Title', el.title, LIMITS.tableTitle, [...E, 'title']); break;
        case 'list': el.items.forEach((it, k) => lim(ew, 'List item', it, listMax, [...E, 'items', k])); lim(ew, 'Title', el.title, LIMITS.tableTitle, [...E, 'title']); break;
        case 'chat': el.messages.forEach((m, k) => lim(ew, 'Chat message', m.text, LIMITS.chatMessage, [...E, 'messages', k, 'text'])); lim(ew, 'Title', el.title, LIMITS.tableTitle, [...E, 'title']); break;
        case 'text': lim(ew, 'Text', el.text, el.style === 'stamp' ? LIMITS.stamp : el.style === 'headline' ? LIMITS.headline : el.style === 'label' ? LIMITS.textLabel : LIMITS.statement, [...E, 'text']); break;
        case 'chip': lim(ew, 'Chip', el.text, LIMITS.chip, [...E, 'text']); break;
        case 'note': lim(ew, 'Note', el.text, LIMITS.note, [...E, 'text']); break;
        case 'bars': el.bars.forEach((b, k) => lim(ew, 'Bar label', b.label, LIMITS.barLabel, [...E, 'bars', k, 'label'])); break;
        case 'group': lim(ew, 'Group label', el.label, LIMITS.groupLabel, [...E, 'label']); break;
        case 'arrow': lim(ew, 'Arrow label', el.label, LIMITS.arrowLabel, [...E, 'label']); break;
        case 'ring': lim(ew, 'Ring label', el.label, LIMITS.label, [...E, 'label']); lim(ew, 'Ring sub', el.sub, LIMITS.sub, [...E, 'sub']); break;
        case 'marker': lim(ew, 'Marker label', el.label, 16, [...E, 'label']); break;
      }
    });
    sc.steps.forEach((st, i) => {
      const sw = `${w} steps[${i}]`;
      const S = [...P, 'steps', i];
      if (st.do === 'flow') lim(sw, 'Flow label', st.label, LIMITS.flowLabel, [...S, 'label']);
      if (st.do === 'set') {
        lim(sw, 'Label', st.label, LIMITS.label, [...S, 'label']);
        lim(sw, 'Sub', st.sub, LIMITS.sub, [...S, 'sub']);
        lim(sw, 'Text', st.text, LIMITS.statement, [...S, 'text']);
        st.items?.forEach((it, k) => lim(sw, 'Item', it, listMax, [...S, 'items', k]));
        st.rows?.forEach((r, ri) => r.forEach((c, k) => lim(sw, 'Cell', c, LIMITS.cell, [...S, 'rows', ri, k])));
      }
    });
  });
}

// ─── Scene checks: layout over time, references over time, pacing ────────────────

/** Box extents in grid units, for messages an LLM can act on. */
let gridFormat: Format = '16:9';
function gridSpan(b: Rect): string {
  const c = CONTENT[gridFormat];
  const gx = (px: number) => ((px - c.x) / (c.w / c.cols)).toFixed(1);
  const gy = (py: number) => ((py - c.y) / (c.h / c.rows)).toFixed(1);
  return `x ${gx(b.x)}–${gx(b.x + b.w)}, y ${gy(b.y)}–${gy(b.y + b.h)}`;
}

function sceneChecks(sc: Extract<VideoSpec['scenes'][number], { kind: 'board' }>, ps: PlanScene, format: Format, fps: number, issues: Issue[], isLastScene = false, afterBoard = false) {
  const where = `scene "${sc.id}"`;
  gridFormat = format;
  const content = CONTENT[format];
  const bounds: Rect = { x: content.x - 14, y: content.y - 14, w: content.w + 28, h: content.h + 28 };
  const maxVisible = format === '9:16' ? 7 : 10;
  let textAlone = false;
  const elById = new Map(ps.elements.map((e) => [e.id, e]));
  const ever = new Set(ps.elements.filter((e) => e.initiallyVisible).map((e) => e.id));

  const checkpoints = new Set<number>([ps.durationInFrames - 1]);
  for (const a of ps.actions) {
    checkpoints.add(Math.min(ps.durationInFrames - 1, a.frame + 1));
    checkpoints.add(Math.min(ps.durationInFrames - 1, a.frame + 30));
  }

  let peak: { n: number; boxes: Rect[] } = { n: 0, boxes: [] };
  for (const f of [...checkpoints].sort((a, b) => a - b)) {
    const st = foldScene(ps, f);
    const t = `${where} @${(f / fps).toFixed(1)}s`;
    const placed: Array<{ id: string; box: Rect; shape: Rect }> = [];
    for (const el of ps.elements) {
      const s = st.els[el.id];
      if (!s.visible) continue;
      ever.add(el.id);
      if (!isPlaced(el.spec) || !s.pos) continue;
      const g = footprint(effectiveSpec(el, s), s.pos);
      placed.push({ id: el.id, box: g.box, shape: g.shape });
      if (g.box.x < bounds.x || g.box.y < bounds.y || g.box.x + g.box.w > bounds.x + bounds.w || g.box.y + g.box.h > bounds.y + bounds.h) {
        const side = g.box.x < bounds.x ? 'left' : g.box.x + g.box.w > bounds.x + bounds.w ? 'right' : g.box.y < bounds.y ? 'top' : 'bottom';
        issues.push({ level: 'error', code: 'OUT_OF_BOUNDS', where: `${where} element "${el.id}"`, scene: sc.id, ids: [el.id], message: `"${el.id}" spills off the ${side} of the safe area (it spans ${gridSpan(g.box)}; the board is x 0–${content.cols}, y 0–${content.rows}).`, fix: `Move it toward the centre (grid centre is [${content.cols / 2}, ${content.rows / 2}]), use size "s", or shorten its text.` });
      }
    }
    // Words alone only work as one big line. Several lines, or a small label, on an empty board reads as unfinished.
    const texts = placed.map((p) => elById.get(p.id)?.spec as any);
    if (!textAlone && texts.length && texts.every((x) => x?.type === 'text') && (texts.length > 1 || texts[0].style === 'label')) {
      textAlone = true;
      issues.push({ level: 'warn', code: 'TEXT_ALONE', where: t, message: 'Only small or stacked text is on screen, so the board looks empty.', fix: 'Show one big `text` line alone, or draw something the words belong to: a diagram, bars, icons or a list.' });
    }
    const ringOf = (id: string) => (elById.get(id)?.spec as any)?.ring as string | undefined;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (ringOf(placed[i].id) === placed[j].id || ringOf(placed[j].id) === placed[i].id) continue;
        const stampOver = [placed[i].id, placed[j].id].some((id) => (elById.get(id)?.spec as any)?.style === 'stamp');
        if (stampOver) continue; // a stamp lands on top of the picture on purpose
        const ov = intersection(inset(placed[i].box, 4), inset(placed[j].box, 4));
        if (ov > 0) {
          const cell = Math.round(content.w / content.cols);
          issues.push({ level: 'error', code: 'OVERLAP', where: `${where}`, scene: sc.id, ids: [placed[i].id, placed[j].id], message: `"${placed[i].id}" (spans ${gridSpan(placed[i].box)}) and "${placed[j].id}" (spans ${gridSpan(placed[j].box)}) overlap by ~${Math.round(ov)}px.`, fix: `Move them apart by at least ${Math.max(1, Math.ceil((ov + 24) / cell))} grid unit(s), use size "s", or hide one before showing the other.` });
        }
      }
    }
    // A note is read last and rests on the board, so it needs clear space, not just no collision.
    for (const n of placed) {
      if (elById.get(n.id)?.spec.type !== 'note') continue;
      for (const o of placed) {
        if (o.id === n.id || elById.get(o.id)?.spec.type === 'ring') continue;
        if (intersection(inset(n.box, -NOTE_CLEARANCE), o.box) > 0 && intersection(inset(n.box, 4), inset(o.box, 4)) === 0) {
          issues.push({ level: 'warn', code: 'NOTE_CROWDED', scene: sc.id, ids: [n.id, o.id], where: `${where} note "${n.id}"`, message: `Note "${n.id}" sits too close to "${o.id}".`, fix: 'Move the note into open space.' });
        }
      }
    }
    if (placed.length >= peak.n) peak = { n: placed.length, boxes: placed.map((p) => p.box) };
    // Dimmed parts are finished context, not things competing for attention.
    const lit = placed.filter((p) => !st.els[p.id].dimmed).length;
    if (lit > maxVisible) {
      issues.push({ level: lit > maxVisible + 3 ? 'error' : 'warn', code: 'CLUTTER', where: t, message: `${lit} elements lit at once (max ${maxVisible}).`, fix: 'Hide or move things to a new scene; a viewer can track ~7 things.' });
    }
    // arrows: endpoints visible; route clear of other shapes
    for (const el of ps.elements) {
      if (el.spec.type !== 'arrow' || !st.els[el.id].visible) continue;
      const a = el.spec;
      const fromRect = rectOf(a.from, st, elById);
      const toRect = rectOf(a.to, st, elById);
      if (!fromRect || !toRect) {
        issues.push({ level: 'error', code: 'ARROW_DANGLING', where: `${where} arrow "${el.id}"`, message: `Arrow is visible while "${!fromRect ? a.from : a.to}" is not.`, fix: 'Show both endpoints before (or in the same step as) the arrow; hide the arrow when hiding an endpoint.' });
        continue;
      }
      const g = arrowGeometry(fromRect, toRect, a.bend ?? 0);
      if (a.label) {
        const lr = arrowLabelRect(a.label, g, format, arrowLabelSide(el, ps.elements));
        for (const n of placed) {
          if (elById.get(n.id)?.spec.type === 'note' && intersection(inset(n.box, -NOTE_CLEARANCE), lr) > 0) {
            issues.push({ level: 'warn', code: 'NOTE_CROWDED', scene: sc.id, ids: [n.id, el.id], where: `${where} note "${n.id}"`, message: `Note "${n.id}" sits too close to the label on arrow "${el.id}".`, fix: 'Move the note into open space.' });
          }
        }
      }
      if (Math.hypot(g.p1.x - g.p0.x, g.p1.y - g.p0.y) < (format === '9:16' ? 40 : 3)) {
        issues.push({ level: 'warn', code: 'ARROW_CRAMPED', scene: sc.id, ids: [a.from, a.to], where: `${where} arrow "${el.id}"`, message: `"${a.from}" and "${a.to}" are too close for their arrow to read.`, fix: 'Move them further apart, split the scene, or lay it out in two columns instead of one long stack.' });
      }
      for (const p of placed) {
        if (p.id === a.from || p.id === a.to) continue;
        if (elById.get(p.id)?.spec.type === 'ring') continue;
        if (isInGroup(p.id, a.from, ps) || isInGroup(p.id, a.to, ps)) continue;
        const r = inset(p.shape, 8);
        for (let k = 1; k < 20; k++) {
          const q = quadPoint(g.p0, g.c, g.p1, k / 20);
          if (q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h) {
            issues.push({ level: 'warn', code: 'ARROW_THROUGH', scene: sc.id, ids: [p.id, el.id], where: `${where} arrow "${el.id}"`, message: `Arrow "${el.id}" passes through "${p.id}".`, fix: 'Add `bend` (e.g. 0.4 or -0.4) or reposition elements so the path is clear.' });
            break;
          }
        }
      }
    }
  }

  if (format === '9:16' && ps.narrationEnd - ps.narrationStart > 25 * fps) {
    issues.push({ level: 'warn', code: 'LONG_BOARD', where, message: 'This board runs over 25 s without a beat.', fix: 'Split it into shorter boards, joined with `continue: true` while the same picture carries on. Same narration and cues.' });
  }

  // A trace must not give away the ending: something already ticked when the flow reaches it.
  for (const a of ps.actions as any[]) {
    if (a.do !== 'flow') continue;
    const hops = (a.path ?? a.hops ?? []) as Array<string | { id?: string }>;
    const last = hops[hops.length - 1];
    const arrow = ps.elements.find((e) => e.id === (typeof last === 'string' ? last : last?.id))?.spec as any;
    if (!arrow) continue;
    const dest = a.reverse ? arrow.from : arrow.to;
    if (foldScene(ps, a.frame).els[dest]?.mark?.kind === 'check') {
      issues.push({ level: 'warn', code: 'TICK_EARLY', where, scene: sc.id, ids: [dest], message: `"${dest}" already has a tick when the flow reaches it.`, fix: 'Add the tick only when the story arrives there. `unmark` it first, or move the `mark` to the arrival cue.' });
      break;
    }
  }

  // composition: the busiest moment of the scene should use the board and sit near its centre
  if (peak.n >= 2) {
    const x1 = Math.min(...peak.boxes.map((b) => b.x)), y1 = Math.min(...peak.boxes.map((b) => b.y));
    const x2 = Math.max(...peak.boxes.map((b) => b.x + b.w)), y2 = Math.max(...peak.boxes.map((b) => b.y + b.h));
    const coverW = (x2 - x1) / content.w, coverH = (y2 - y1) / content.h;
    // Vertical boards are tall: a diagram bunched in the top half reads as unfinished even if it is wide enough.
    if ((coverW < 0.55 && coverH < 0.55) || (format === '9:16' && peak.n >= 3 && coverH < 0.62)) {
      issues.push({ level: 'warn', code: 'SPARSE_LAYOUT', where, message: `At its busiest the diagram uses only ${Math.round(coverW * 100)}% × ${Math.round(coverH * 100)}% of the board.`, fix: 'Spread elements across the grid and/or use size "l" so the diagram fills ~60–85% of the board.' });
    }
    const cellW = content.w / content.cols, cellH = content.h / content.rows;
    const dx = (content.x + content.w / 2 - (x1 + x2) / 2) / cellW, dy = (content.y + content.h / 2 - (y1 + y2) / 2) / cellH;
    if (Math.abs(dx) > content.cols * 0.14 || Math.abs(dy) > content.rows * 0.16) {
      issues.push({ level: 'warn', code: 'OFF_CENTER', where, scene: sc.id, data: { dx: Math.round(dx * 4) / 4, dy: Math.round(dy * 4) / 4 }, message: `The diagram's centre is off the board centre by ${dx.toFixed(1)}, ${dy.toFixed(1)} grid units.`, fix: `Shift every element by about [${dx.toFixed(1)}, ${dy.toFixed(1)}] grid units.` });
    }
  }

  // markers on the same ring need breathing room (labels sit outside; arcs between them must be readable)
  const byRing = new Map<string, Array<{ id: string; angle: number }>>();
  for (const el of ps.elements) {
    const sp: any = el.spec;
    if (sp.type === 'marker') byRing.set(sp.ring, [...(byRing.get(sp.ring) ?? []), { id: el.id, angle: sp.angle }]);
  }
  for (const [ring, ms] of byRing) {
    const sorted = [...ms].sort((p, q) => p.angle - q.angle);
    for (let i = 0; i < sorted.length && sorted.length > 1; i++) {
      const p = sorted[i], q = sorted[(i + 1) % sorted.length];
      const gap = (q.angle - p.angle + 360) % 360 || 360;
      if (gap < 32) {
        issues.push({ level: 'warn', code: 'MARKER_CROWDED', where: `${where} ring "${ring}"`, scene: sc.id, ids: [p.id, q.id], message: `Markers "${p.id}" (${p.angle}°) and "${q.id}" (${q.angle}°) are only ${Math.round(gap)}° apart.`, fix: 'Keep markers ≥ 35° apart so labels and the arc between them stay readable; spread the angles around the ring.' });
      }
    }
  }

  // step targets must be visible when acted on
  for (const a of ps.actions) {
    const st = foldScene(ps, a.frame + 12);
    const sw = `${where} steps[${a.stepIndex}] (${a.do})`;
    if (a.do === 'flow') {
      for (const id of a.path) {
        if (elById.has(id) && !st.els[id]?.visible) {
          issues.push({ level: 'error', code: 'FLOW_HIDDEN', where: sw, message: `Flow travels over arrow "${id}" which is not visible yet.`, fix: `Show "${id}" at or before this step.` });
        }
      }
    } else if (a.do === 'travel') {
      for (const id of [a.target!, a.to]) {
        if (elById.has(id) && !st.els[id]?.visible) issues.push({ level: 'error', code: 'TARGET_HIDDEN', where: sw, message: `"${id}" must be visible for travel.`, fix: `Show "${id}" first.` });
      }
    } else if (['highlight', 'pulse', 'shake', 'mark', 'strike', 'set', 'reveal', 'move', 'span'].includes(a.do) && a.target && elById.has(a.target)) {
      if (!st.els[a.target]?.visible) {
        issues.push({ level: 'error', code: 'TARGET_HIDDEN', where: sw, message: `"${a.target}" is not visible when "${a.do}" fires.`, fix: `Show "${a.target}" first.` });
      }
    }
    if (a.do === 'focus') {
      for (const id of a.targets) {
        if (elById.has(id) && !st.els[id]?.visible) issues.push({ level: 'error', code: 'TARGET_HIDDEN', where: sw, message: `Focus target "${id}" is not visible.` });
      }
    }
  }

  // things defined but never shown
  for (const el of ps.elements) {
    if (!ever.has(el.id)) issues.push({ level: 'warn', code: 'NEVER_SHOWN', where: `${where} element "${el.id}"`, message: `"${el.id}" is defined but never shown.`, fix: 'Add a show step or delete it.' });
  }

  // Lists said aloud: viewers expect to see what's named, around the moment it's named.
  const said = parseNarration(sc.narration).tokens;
  for (const list of findSpokenLists(said)) {
    const unseen = list.items.filter((item) => {
      // Seen if it's up at any point from the end of its words to 2 s later: it may rightly be cleared soon after.
      const end = ps.words[item.lastToken]?.endFrame ?? ps.durationInFrames - 1;
      const onScreen = new Set<string>();
      for (const f of [end, end + fps, end + 2 * fps]) {
        const st = foldScene(ps, Math.min(ps.durationInFrames - 1, f));
        for (const el of ps.elements) if (st.els[el.id].visible) for (const w of screenWords(effectiveSpec(el, st.els[el.id]))) onScreen.add(w);
      }
      return !item.keywords.some((k) => onScreen.has(k));
    });
    if (unseen.length) issues.push({ level: 'warn', code: 'SPOKEN_LIST_UNSEEN', where, message: `The narration lists ${list.items.map((i) => `"${i.text}"`).join(', ')}, but ${unseen.map((i) => `"${i.text}"`).join(', ')} never appears on screen as it is said.`, fix: 'Give each item its own small element with a short label, shown on a cue placed just before that item is spoken (the words stay the same). Do not squeeze the list into one label. To keep the board uncluttered, `hide` these items when the narration moves on. If this is not really a list of things, ignore it.' });
  }

  // Key figures said aloud must be on screen in big type (headline/statement/stamp text, or labelled bars), not a small chip.
  const bigFigure = (f: number) => {
    const st = foldScene(ps, Math.min(ps.durationInFrames - 1, f));
    return ps.elements.some((el) => {
      if (!st.els[el.id]?.visible) return false;
      const spec: any = effectiveSpec(el, st.els[el.id]);
      if (spec.type === 'bars') return true;
      return spec.type === 'text' && spec.style !== 'label' && /\d/.test(spec.text ?? '');
    });
  };
  for (const fig of findKeyFigures(said)) {
    const end = ps.words[fig.last]?.endFrame ?? ps.durationInFrames - 1;
    if (!bigFigure(end + fps)) issues.push({ level: 'error', code: 'FIGURE_SMALL', where, message: `The narration says "${fig.text}", but that figure is not on screen in big type a second later.`, fix: `Add a \`text\` element with style "headline" showing the figure in digits (for example "$22,200 per million"), shown on a cue placed just before it is said, and keep it up for at least 2 s. Labelled \`bars\` also count. A chip or note is too small for a key number.` });
  }

  // Something said to travel ("tickets go into the queue, which triggers the function") must be seen travelling the
  // route, through boxes carrying the names the narrator uses.
  const arrows = sc.elements.filter((e) => e.type === 'arrow').length;
  if (arrows) {
    const flows = ps.actions.filter((a) => a.do === 'flow') as Array<{ frame: number; path: string[]; count?: number }>;
    for (const mv of findMovements(said)) {
      const from = (ps.words[mv.first]?.startFrame ?? 0) - fps / 2;
      const to = ps.words[mv.last]?.endFrame ?? ps.durationInFrames - 1;
      const during = flows.filter((f) => f.frame >= from && f.frame <= to);
      const quote = mv.text.length > 90 ? `${mv.text.slice(0, 90)}…` : mv.text;
      if (!during.length) issues.push({ level: 'error', code: 'MOVEMENT_STILL', where, message: `The narration says "${quote}", but nothing moves on screen while it is said.`, fix: 'Add a `flow` step on a cue inside that sentence that travels the whole route it describes: a multi-hop `path` over the arrows in order (or `count` 3 for a stream of items), with a `label` naming what moves (for example "ticket"). Show every box the sentence names by the time the flow reaches it.' });
      else if (!during.some((f) => f.path.length >= Math.min(mv.moves, arrows) || (f.count ?? 1) >= 2)) issues.push({ level: 'error', code: 'MOVEMENT_FAINT', where, message: `The narration says "${quote}", but only one item crosses one arrow, which is easy to miss.`, fix: 'Make the flow follow the whole route the sentence describes (a multi-hop `path`, for example ["in-queue", "queue-fn"]) or send a stream (`count` 3). Start it with an arrow INTO the first box, so the viewer sees things arrive.' });
      // Names the sentence uses for things (SQS, Lambda, AppConfig) must be on the boxes by the end of the sentence.
      const st = foldScene(ps, Math.min(ps.durationInFrames - 1, to + fps / 2));
      const onScreen = new Set<string>();
      for (const el of ps.elements) if (st.els[el.id]?.visible) for (const w of screenWords(effectiveSpec(el, st.els[el.id]))) onScreen.add(w);
      // Names: acronyms (SQS), mixed case (AppConfig) or a capital mid-sentence (a Lambda function); not a sentence's first word.
      const named = said.slice(mv.first + 1, mv.last + 1).flatMap((t, k) => {
        const w = t.display.replace(/[^\p{L}\p{N}]/gu, '');
        const prev = said[mv.first + k].display;
        const name = /^\p{Lu}{2,}\d*$/u.test(w) || /^\p{Lu}\p{Ll}+\p{Lu}/u.test(w) || (/^\p{Lu}\p{Ll}/u.test(w) && !/[,.:;!?—–"“]$/.test(prev));
        return name && w.length >= 3 ? [w] : [];
      });
      const missing = [...new Set(named)].filter((w) => ![...screenWords({ text: w })].some((k) => onScreen.has(k)));
      if (missing.length) issues.push({ level: 'error', code: 'NAME_UNSEEN', where, message: `The narration names ${missing.map((m) => `"${m}"`).join(', ')} while describing the route, but no box on screen is labelled with ${missing.length > 1 ? 'those names' : 'that name'}.`, fix: 'Label the boxes with the names the narrator uses (an "SQS queue" box, a "Lambda" box with its real icon), shown by the time they are said.' });
    }
  }

  // cues defined but unused
  const used = new Set<string>();
  for (const s of sc.steps) if (typeof s.at === 'string') { const m = parseAt(s.at, Object.keys(ps.cueFrames)); if (m) used.add(m[1]); }
  for (const cue of Object.keys(ps.cueFrames)) {
    if (!used.has(cue)) issues.push({ level: 'warn', code: 'UNUSED_CUE', where, message: `Cue {${cue}} is never used.`, fix: 'Attach a step to it or remove it.' });
  }

  // pacing: something visual should change regularly while the narrator talks
  const events = [...new Set(ps.actions.filter((a) => a.do !== 'unhighlight' && a.do !== 'undim').map((a) => a.frame))].sort((a, b) => a - b);
  const marks = [ps.narrationStart, ...events.filter((f) => f >= ps.narrationStart && f <= ps.narrationEnd), ps.narrationEnd];
  for (let i = 1; i < marks.length; i++) {
    const gap = (marks[i] - marks[i - 1]) / fps;
    if (gap > 11) issues.push({ level: 'error', code: 'DEAD_AIR', where, message: `${gap.toFixed(1)}s with no visual change (${(marks[i - 1] / fps).toFixed(1)}s → ${(marks[i] / fps).toFixed(1)}s).`, fix: 'Show what the narrator is talking about in that stretch: a new element, a `flow` or a `reveal` on a cue. Use a highlight or pulse only when the words point at something already on screen. Splitting the narration also works.' });
    else if (gap > 7) issues.push({ level: 'warn', code: 'SLOW_PACING', where, message: `${gap.toFixed(1)}s with no visual change (${(marks[i - 1] / fps).toFixed(1)}s → ${(marks[i] / fps).toFixed(1)}s).`, fix: 'Viewers drift after ~6s of a static frame; add a beat.' });
  }
  if (events.length && events[0] > ps.narrationStart + 2.5 * fps && !sc.continue) {
    issues.push({ level: 'warn', code: 'LATE_START', where, message: `First visual arrives ${((events[0] - ps.narrationStart) / fps).toFixed(1)}s into the narration.`, fix: 'Put a cue in the first sentence so the board is not empty.' });
  }

  // narration shape
  const sentences = sc.narration.replace(/\{[a-z0-9-]+\}/g, '').split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const n = s.split(/\s+/).filter(Boolean).length;
    if (n > 32) issues.push({ level: 'warn', code: 'LONG_SENTENCE', where, message: `Sentence of ${n} words: "${s.slice(0, 60)}…"`, fix: 'Split it. Spoken explanations land best at 8–20 words per sentence.' });
  }
  const wordCount = ps.words.length;
  if (wordCount > 130) issues.push({ level: 'warn', code: 'LONG_SCENE', where, message: `${wordCount} words in one scene (~${Math.round(wordCount / 2.5)}s).`, fix: 'Split into multiple scenes with `continue: true` to keep the board.' });
}

function rectOf(id: string, st: ReturnType<typeof foldScene>, elById: Map<string, any>): Rect | null {
  const el = elById.get(id);
  if (!el) return null;
  if (el.spec.type === 'group') {
    const kids = el.spec.contains
      .map((c: string) => elById.get(c))
      .filter((k: any) => k && st.els[k.id]?.visible && st.els[k.id].pos)
      .map((k: any) => footprint(effectiveSpec(k, st.els[k.id]), st.els[k.id].pos!).box);
    return kids.length && st.els[id].visible ? groupRect(kids) : null;
  }
  const s = st.els[id];
  if (!s?.visible || !s.pos || !isPlaced(el.spec)) return null;
  const g = footprint(effectiveSpec(el, s), s.pos);
  return g.label ? arrowEnd(g) : g.shape;
}

function isInGroup(childId: string, groupId: string, ps: PlanScene): boolean {
  const g = ps.elements.find((e) => e.id === groupId);
  return !!g && g.spec.type === 'group' && g.spec.contains.includes(childId);
}

export function formatIssues(r: ValidationResult): string {
  const lines: string[] = [];
  if (r.stats) lines.push(`Scenes: ${r.stats.scenes} · ~${r.stats.seconds}s · ${r.stats.words} words${r.stats.estimatedTiming ? ' · (timings estimated — run tts for exact sync)' : ''}`);
  for (const e of r.errors) lines.push(`✖ [${e.code}] ${e.where}: ${e.message}${e.fix ? `\n    → ${e.fix}` : ''}`);
  for (const w of r.warnings) lines.push(`⚠ [${w.code}] ${w.where}: ${w.message}${w.fix ? `\n    → ${w.fix}` : ''}`);
  lines.push(r.ok ? `✔ VALID (${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'})` : `✖ INVALID: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
  return lines.join('\n');
}
