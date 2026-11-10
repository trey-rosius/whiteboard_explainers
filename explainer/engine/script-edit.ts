/**
 * Script editor: the words a person may change before recording (narration and on-screen text),
 * and a safe way to apply those changes. Layout, icons, ids, timing and steps stay as they are;
 * the {cue} markers that time the animation must survive every narration edit.
 */
import { parseNarration } from './narration';

export interface EditField {
  /** Dot path inside the scene, e.g. "elements.3.items.2". */
  path: string;
  /** What the field is, for people: "label", "item 2", "bar 1 value". */
  name: string;
  /** The element or step this belongs to, for grouping: "chip · cost-chip", "change at {cue}". */
  group: string;
  value: string | number;
}

export interface EditableScene {
  id: string;
  name: string;
  narration?: string;
  cues: string[];
  fields: EditField[];
}

export interface SceneEdit {
  id: string;
  narration?: string;
  fields?: Array<{ path: string; value: string | number }>;
}

const TEXT_KEYS = ['kicker', 'title', 'subtitle', 'heading', 'label', 'sub', 'text', 'unit'] as const;
const STRING_LISTS: Record<string, string> = { items: 'item', columns: 'column', lines: 'line' };

export const cuesOf = (narration: string | undefined) => [...(narration ?? '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1].trim());

/** Every on-screen string (and bar value) of one element or step, with paths relative to the scene. */
function fieldsOf(obj: any, base: string, group: string): EditField[] {
  const out: EditField[] = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const k of TEXT_KEYS) if (typeof obj[k] === 'string') out.push({ path: `${base}${k}`, name: k, group, value: obj[k] });
  for (const [k, word] of Object.entries(STRING_LISTS)) {
    if (Array.isArray(obj[k])) obj[k].forEach((v: unknown, i: number) => { if (typeof v === 'string') out.push({ path: `${base}${k}.${i}`, name: `${word} ${i + 1}`, group, value: v }); });
  }
  if (Array.isArray(obj.rows)) obj.rows.forEach((row: unknown, r: number) => Array.isArray(row) && row.forEach((v, c) => {
    if (typeof v === 'string') out.push({ path: `${base}rows.${r}.${c}`, name: `row ${r + 1}, column ${c + 1}`, group, value: v });
  }));
  if (Array.isArray(obj.messages)) obj.messages.forEach((m: any, i: number) => {
    if (typeof m?.text === 'string') out.push({ path: `${base}messages.${i}.text`, name: `message ${i + 1} (${m.from === 'user' ? 'person' : 'AI'})`, group, value: m.text });
  });
  if (Array.isArray(obj.bars)) obj.bars.forEach((b: any, i: number) => {
    if (typeof b?.label === 'string') out.push({ path: `${base}bars.${i}.label`, name: `bar ${i + 1} label`, group, value: b.label });
    if (typeof b?.value === 'number') out.push({ path: `${base}bars.${i}.value`, name: `bar ${i + 1} value`, group, value: b.value });
  });
  if (Array.isArray(obj.values)) obj.values.forEach((v: unknown, i: number) => { if (typeof v === 'number') out.push({ path: `${base}values.${i}`, name: `value ${i + 1}`, group, value: v }); });
  return out;
}

export function editableScenes(spec: any): EditableScene[] {
  return (spec?.scenes ?? []).map((sc: any) => {
    const fields: EditField[] = [];
    if (sc.kind === 'title') fields.push(...fieldsOf({ kicker: sc.kicker, title: sc.title, subtitle: sc.subtitle }, '', 'title screen'));
    else if (typeof sc.heading === 'string') fields.push({ path: 'heading', name: 'heading', group: 'scene', value: sc.heading });
    (sc.elements ?? []).forEach((el: any, i: number) => fields.push(...fieldsOf(el, `elements.${i}.`, `${el.type} · ${el.id}`)));
    (sc.steps ?? []).forEach((st: any, i: number) => {
      const { label, sub, text, items, rows, values } = st ?? {};
      fields.push(...fieldsOf({ label, sub, text, items, rows, values }, `steps.${i}.`, `${st.do} at ${typeof st.at === 'string' ? `{${st.at}}` : `${st.at}s`}`));
    });
    return { id: sc.id, name: sc.kind === 'title' ? sc.title : sc.heading ?? sc.id, narration: sc.narration, cues: cuesOf(sc.narration), fields };
  });
}

/**
 * Applies edits to a copy of the spec. Only paths offered by editableScenes can change, and only to a value of the same type.
 * Returns problems instead of throwing, so the editor can show them all at once.
 */
export function applyScriptEdits(spec: any, edits: SceneEdit[]) {
  const next = structuredClone(spec);
  const problems: string[] = [];
  const respoken: string[] = [];
  const offered = new Map(editableScenes(spec).map((s) => [s.id, s]));
  for (const e of edits ?? []) {
    const sc = next.scenes?.find((x: any) => x.id === e?.id);
    const allowed = offered.get(String(e?.id));
    if (!sc || !allowed) { problems.push(`Scene "${e?.id}" is not part of this script.`); continue; }
    const where = `Scene "${allowed.name}"`;
    if (typeof e.narration === 'string' && e.narration !== sc.narration) {
      const narration = e.narration.replace(/\s+/g, ' ').trim();
      const before = cuesOf(sc.narration), after = cuesOf(narration);
      const lost = before.filter((c) => !after.includes(c));
      const added = after.filter((c) => !before.includes(c));
      if (!narration || !parseNarration(narration).spokenText.trim()) problems.push(`${where}: the narration can't be empty.`);
      else if (lost.length) problems.push(`${where}: put back the marker${lost.length > 1 ? 's' : ''} ${lost.map((c) => `{${c}}`).join(', ')}. ${lost.length > 1 ? 'They time' : 'It times'} the animation.`);
      else if (added.length) problems.push(`${where}: ${added.map((c) => `{${c}}`).join(', ')} ${added.length > 1 ? 'are' : 'is'} not a marker in this scene. Remove the curly brackets.`);
      else if (after.join('\u0000') !== before.join('\u0000')) problems.push(`${where}: keep the {markers} in their original order.`);
      else {
        if (parseNarration(narration).spokenText !== parseNarration(sc.narration ?? '').spokenText) respoken.push(sc.id);
        sc.narration = narration;
      }
    }
    const fields = new Map(allowed.fields.map((f) => [f.path, f]));
    for (const f of e.fields ?? []) {
      const known = fields.get(String(f?.path));
      if (!known) { problems.push(`${where}: "${f?.path}" can't be edited here.`); continue; }
      if (f.value === known.value) continue;
      let value: string | number = f.value;
      if (typeof known.value === 'number') {
        value = Number(f.value);
        if (!Number.isFinite(value) || value < 0) { problems.push(`${where}: ${known.group}, ${known.name} must be a number of 0 or more.`); continue; }
      } else {
        value = String(f.value ?? '').replace(/\s+/g, ' ').trim();
        if (!value && !/^(sub|kicker|subtitle|unit|heading)$/.test(known.name)) { problems.push(`${where}: ${known.group}, ${known.name} can't be empty.`); continue; }
      }
      const keys = known.path.split('.');
      let target: any = sc;
      for (const k of keys.slice(0, -1)) target = target[/^\d+$/.test(k) ? Number(k) : k];
      const last = keys[keys.length - 1];
      if (value === '') delete target[last]; else target[/^\d+$/.test(last) ? Number(last) : last] = value;
    }
  }
  return { spec: next, problems, respoken };
}
