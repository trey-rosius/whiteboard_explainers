/**
 * Deterministic auto-layout: resolves OVERLAP / OUT_OF_BOUNDS by moving elements to the nearest free grid spot
 * (falling back to size "s"). Models are bad at reasoning about pixel geometry they cannot see; the harness isn't.
 * Only positions/sizes change — narration, cues and steps are untouched, so recorded voice stays valid.
 */
import { validate } from './validate';
import type { CompileOptions } from './compile';
import type { Issue } from './plan';
import { CONTENT, type Format } from './layout';

const LAYOUT = new Set(['OVERLAP', 'OUT_OF_BOUNDS']);
const NOTE_PROBLEMS = new Set(['ARROW_THROUGH', 'NOTE_CROWDED']);

export interface AutofixResult { spec: any; changes: string[]; remaining: number }

/** Scenes linked by `continue` share elements, so they must be checked together. */
function chainOf(spec: any, idx: number): [number, number] {
  let a = idx, b = idx;
  while (a > 0 && spec.scenes[a].kind === 'board' && spec.scenes[a].continue) a--;
  while (b + 1 < spec.scenes.length && spec.scenes[b + 1].kind === 'board' && spec.scenes[b + 1].continue) b++;
  return [a, b];
}

function layoutIssues(spec: any, opts: CompileOptions): Issue[] {
  const r = validate(spec, opts);
  return r.errors.filter((e) => LAYOUT.has(e.code) && e.scene && e.ids?.length);
}

export function autofixLayout(raw: unknown, opts: CompileOptions = {}, maxMoves = 16): AutofixResult {
  const spec: any = JSON.parse(JSON.stringify(raw));
  const changes: string[] = [];
  if (!spec?.scenes?.length) return { spec, changes, remaining: 0 };
  const format: Format = spec.format === '9:16' ? '9:16' : '16:9';
  const { cols, rows } = CONTENT[format];
  const skip = new Set<string>();

  // Nearest-first search offsets (grid units)
  const offsets: Array<[number, number]> = [];
  // fine steps near the element, coarser further out
  for (let dx = -5; dx <= 5; dx += 0.25) for (let dy = -4; dy <= 4; dy += 0.25) {
    if (!dx && !dy) continue;
    if ((Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) && (dx * 4) % 2 !== 0 && (dy * 4) % 2 !== 0) continue;
    offsets.push([dx, dy]);
  }
  offsets.sort((p, q) => Math.hypot(p[0], p[1] * 1.15) - Math.hypot(q[0], q[1] * 1.15));

  let issues = layoutIssues(spec, opts);
  for (let move = 0; move < maxMoves && issues.length; move++) {
    const iss = issues.find((i) => !skip.has(`${i.scene}|${i.ids!.join(',')}`));
    if (!iss) break;
    const si = spec.scenes.findIndex((s: any) => s.id === iss.scene);
    const sc = spec.scenes[si];
    const [a, b] = chainOf(spec, si);
    const sub = (s: any) => ({ ...s, targetSeconds: undefined, scenes: s.scenes.slice(a, b + 1).map((x: any, k: number) => (k === 0 ? { ...x, continue: undefined } : x)) });
    const total = (s: any) => layoutIssues(sub(s), opts).length;

    // movable: defined in this scene, has `at`; prefer non-ring, then the smaller/later element
    const ids = iss.ids!.flatMap((id) => {
      const e = sc.elements?.find((x: any) => x.id === id);
      return e?.type === 'marker' ? [e.ring] : [id];
    });
    const movable = [...new Set(ids)]
      .map((id) => ({ id, idx: sc.elements?.findIndex((e: any) => e.id === id) ?? -1 }))
      .filter((c) => c.idx >= 0 && Array.isArray(sc.elements[c.idx].at))
      .sort((p, q) => Number(sc.elements[p.idx].type === 'ring') - Number(sc.elements[q.idx].type === 'ring') || q.idx - p.idx);
    const touchesId = (s2: any, id: string) => {
      const markers = (sc.elements ?? []).filter((e: any) => e.type === 'marker' && e.ring === id).map((e: any) => e.id);
      return layoutIssues(sub(s2), opts).filter((i) => i.ids!.some((x) => x === id || markers.includes(x))).length;
    };
    if (!movable.length) { skip.add(`${iss.scene}|${iss.ids!.join(',')}`); continue; }

    const before = total(spec);
    let fixed = false;
    for (const { id, idx } of movable) {
      const el = sc.elements[idx];
      const orig: [number, number] = [...el.at] as [number, number];
      const origSize = el.size;
      // try the current size first, then each smaller size (rings included: an "l" ring cannot fit a 16:9 board)
      const order = ['l', 'm', 's'];
      const cur = el.size ?? 'm';
      const sizes = [cur, ...order.slice(order.indexOf(cur) + 1)];
      for (const size of sizes) {
        const shrunk = size !== cur;
        if (shrunk) el.size = size;
        for (const [dx, dy] of shrunk ? [[0, 0] as [number, number], ...offsets] : offsets) {
          // exact original position for the "just shrink it" candidate; snapped quarter-grid otherwise
          const x = dx || dy ? Math.round((orig[0] + dx) * 4) / 4 : orig[0];
          const y = dx || dy ? Math.round((orig[1] + dy) * 4) / 4 : orig[1];
          if (x < 0 || x > cols || y < 0 || y > rows) continue;
          el.at = [x, y];
          if (touchesId(spec, id) === 0 && total(spec) < before) {
            changes.push(`${sc.id}: moved "${id}" [${orig}] → [${x}, ${y}]${shrunk ? ` (size ${size})` : ''}`);
            fixed = true;
            break;
          }
        }
        if (fixed) break;
        el.at = orig;
        el.size = origSize;
        if (origSize === undefined) delete el.size;
      }
      if (fixed) break;
    }
    if (!fixed) skip.add(`${iss.scene}|${iss.ids!.join(',')}`);
    issues = layoutIssues(spec, opts);
  }
  // Re-centre: shift every positioned element of a continue-chain by the validator's suggested offset.
  const centred = new Set<string>();
  for (const iss of validate(spec, opts).warnings.filter((w) => w.code === 'OFF_CENTER' && w.scene && w.data)) {
    const si = spec.scenes.findIndex((s: any) => s.id === iss.scene);
    const [a, b] = chainOf(spec, si);
    const chainKey = `${a}-${b}`;
    if (centred.has(chainKey)) continue;
    centred.add(chainKey);
    const { dx, dy } = iss.data as { dx: number; dy: number };
    const snapshot = JSON.stringify(spec.scenes.slice(a, b + 1));
    const errorsBefore = validate(spec, opts).errors.length;
    for (let k = a; k <= b; k++) {
      for (const el of spec.scenes[k].elements ?? []) if (Array.isArray(el.at)) el.at = [Math.round((el.at[0] + dx) * 4) / 4, Math.round((el.at[1] + dy) * 4) / 4];
      for (const st of spec.scenes[k].steps ?? []) if (st.do === 'move' && Array.isArray(st.to)) st.to = [Math.round((st.to[0] + dx) * 4) / 4, Math.round((st.to[1] + dy) * 4) / 4];
    }
    if (validate(spec, opts).errors.length > errorsBefore) {
      spec.scenes.splice(a, b - a + 1, ...JSON.parse(snapshot));
    } else {
      changes.push(`${spec.scenes[si].id}: re-centred diagram by [${dx}, ${dy}]`);
    }
  }
  // Stacks too tight for their arrows: shrink the nodes a size rather than ask the model to re-lay the scene.
  for (let pass = 0; pass < 6; pass++) {
    const cramped = validate(spec, opts).warnings.filter((w) => w.code === 'ARROW_CRAMPED' && w.scene && w.ids?.length);
    let shrunk = false;
    for (const iss of cramped) {
      const sc = spec.scenes.find((s: any) => s.id === iss.scene);
      for (const id of iss.ids!) {
        const el = sc?.elements?.find((e: any) => e.id === id);
        if (!el || !Array.isArray(el.at) || el.type === 'ring') continue;
        const size = el.size ?? 'm';
        if (size === 's') continue;
        el.size = size === 'l' ? 'm' : 's';
        changes.push(`${sc.id}: resized "${id}" to ${el.size} so its arrow has room`);
        shrunk = true;
      }
    }
    if (!shrunk) break;
  }
  // Notes crossed by an arrow or crowding something: a note can go anywhere, and moving one never touches narration.
  const noteIssues = (s: any, id: string, a: number, b: number) => {
    const r = validate({ ...s, targetSeconds: undefined, scenes: s.scenes.slice(a, b + 1).map((x: any, k: number) => (k === 0 ? { ...x, continue: undefined } : x)) }, opts);
    return {
      mine: r.warnings.filter((w) => NOTE_PROBLEMS.has(w.code) && w.ids?.includes(id)).length + r.errors.filter((e) => LAYOUT.has(e.code) && e.ids?.includes(id)).length,
      others: r.warnings.filter((w) => NOTE_PROBLEMS.has(w.code)).length + r.errors.filter((e) => LAYOUT.has(e.code)).length,
    };
  };
  const tried = new Set<string>();
  for (let pass = 0; pass < 8; pass++) {
    const iss = validate(spec, opts).warnings.find((w) => NOTE_PROBLEMS.has(w.code) && w.scene && w.ids?.[0] && !tried.has(`${w.scene}|${w.ids[0]}`));
    if (!iss) break;
    const id = iss.ids![0];
    tried.add(`${iss.scene}|${id}`);
    const si = spec.scenes.findIndex((s: any) => s.id === iss.scene);
    const [a, b] = chainOf(spec, si);
    const owner = spec.scenes.slice(a, b + 1).find((s: any) => s.elements?.some((e: any) => e.id === id));
    const el = owner?.elements.find((e: any) => e.id === id);
    if (!el || el.type !== 'note' || !Array.isArray(el.at)) continue;
    const orig: [number, number] = [...el.at] as [number, number];
    const before = noteIssues(spec, id, a, b);
    let fixed = false;
    // Nearby first, then anywhere on the board: a note may be far from what it annotates, but never on top of it.
    const anywhere: Array<[number, number]> = [];
    for (let x = 0; x <= cols; x += 0.5) for (let y = 0; y <= rows; y += 0.5) anywhere.push([x - orig[0], y - orig[1]]);
    anywhere.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
    for (const [dx, dy] of [...offsets, ...anywhere]) {
      const x = Math.round((orig[0] + dx) * 4) / 4;
      const y = Math.round((orig[1] + dy) * 4) / 4;
      if (x < 0 || x > cols || y < 0 || y > rows) continue;
      el.at = [x, y];
      const now = noteIssues(spec, id, a, b);
      if (now.mine === 0 && now.others <= before.others - before.mine) {
        changes.push(`${iss.scene}: moved "${id}" [${orig}] → [${x}, ${y}] to clear it`);
        fixed = true;
        break;
      }
    }
    if (!fixed) el.at = orig;
  }
  return { spec, changes, remaining: layoutIssues(spec, opts).length };
}

// ─── Text fitting ────────────────────────────────────────────────────────────────
// Models count characters badly (they see tokens), so "31 chars, max 30" can survive several repair rounds.
// On-screen text is a label; shortening it never desyncs narration, so the harness does it deterministically.

const ABBREV: Array<[RegExp, string]> = [
  [/\s+and\s+/gi, ' & '], [/\bthird[- ]party\b/gi, '3rd-party'], [/\s*=\s*/g, '='], [/\s*->\s*/g, '→'],
  [/\bwith\b/gi, 'w/'], [/\bwithout\b/gi, 'w/o'], [/\bconfiguration\b/gi, 'config'], [/\bapplication(s?)\b/gi, 'app$1'],
  [/\bdatabase(s?)\b/gi, 'DB$1'], [/\bmilliseconds?\b/gi, 'ms'], [/\bseconds?\b/gi, 's'], [/\bnumber\b/gi, '#'],
  [/\bversus\b/gi, 'vs'], [/\bthrough\b/gi, 'thru'], [/[.]$/, ''],
];

export function shortenText(text: string, max: number): string {
  const len = (s: string) => [...s].length;
  let t = text.trim().replace(/\s+/g, ' ');
  if (len(t) <= max) return t;
  for (const [re, to] of ABBREV) { t = t.replace(re, to).replace(/\s+/g, ' ').trim(); if (len(t) <= max) return t; }
  t = t.replace(/^(the|a|an)\s+/i, '').replace(/\s+(the|a|an)\s+/gi, ' ');
  if (len(t) <= max) return t;
  // cut at a word boundary, leaving room for the ellipsis
  const chars = [...t].slice(0, max - 1).join('');
  const cut = chars.lastIndexOf(' ');
  const head = (cut >= Math.floor(max * 0.5) ? chars.slice(0, cut) : chars).replace(/[\s,;:&=→\-–]+$/, '');
  return `${head}…`;
}

export function autofixText(raw: unknown, opts: CompileOptions = {}): AutofixResult {
  const spec: any = JSON.parse(JSON.stringify(raw));
  const changes: string[] = [];
  for (const iss of validate(spec, opts).errors) {
    if (iss.code !== 'TEXT_TOO_LONG' || !Array.isArray(iss.data?.path)) continue;
    const path = iss.data!.path as Array<string | number>;
    const max = Number(iss.data!.max);
    let parent: any = spec;
    for (const k of path.slice(0, -1)) parent = parent?.[k];
    const key = path[path.length - 1];
    if (!parent || typeof parent[key] !== 'string') continue;
    const before = parent[key];
    parent[key] = shortenText(before, max);
    changes.push(`${iss.where}: "${before}" → "${parent[key]}"`);
  }
  return { spec, changes, remaining: validate(spec, opts).errors.filter((e) => e.code === 'TEXT_TOO_LONG').length };
}
