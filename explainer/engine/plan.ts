/**
 * RenderPlan — the compiled, fully-resolved output of the engine. The renderer consumes ONLY this.
 * Plus `foldScene`: a pure function giving the discrete state of every element at any frame.
 */
import type { CaptionStyle } from './captions';
import type { TitleStyle } from './title';
import type { Element, PlacedElement, Step } from './schema';
import type { Format, Pt } from './layout';
import type { ThemeName } from './theme';

export interface Issue {
  level: 'error' | 'warn';
  code: string;
  where: string;
  message: string;
  fix?: string;
  /** Scene + element ids involved (machine-readable; used by auto-layout). */
  scene?: string;
  ids?: string[];
  /** Machine-readable extras (e.g. OFF_CENTER shift in grid units). */
  data?: Record<string, unknown>;
}

export interface PlanElement {
  id: string;
  spec: Element;
  /** Resolved hex colour. */
  color: string;
  /** Centre in px (placed elements only). */
  pos?: Pt;
  /** Data URI for node/db icons. */
  icon?: string;
  initiallyVisible: boolean;
  /** State carried over from the previous scene by `continue`. */
  carry?: { dimmed: boolean; struck?: boolean; mark?: 'check' | 'cross' | 'warn'; hl?: { color?: string; row?: number } };
}

export type PlanAction = Step & {
  frame: number;
  /** Original step index (for error messages / QA labels). */
  stepIndex: number;
  /** For `move`: resolved px target. */
  toPx?: Pt;
  /** Resolved colour for flow/highlight. */
  hex?: string;
  /** For `show`/`hide`/`dim`/`undim`/`focus`: single expanded target. */
  target?: string;
  /** Frame after which a highlight/shake ends (from `for`). */
  until?: number;
};

/** `key`: a number or name the caption makes stand out. */
export interface CaptionWord { text: string; startFrame: number; endFrame: number; key?: boolean }
export interface CaptionChunk { startFrame: number; endFrame: number; words: CaptionWord[] }

export interface PlanScene {
  id: string;
  kind: 'title' | 'board';
  durationInFrames: number;
  fadeIn: boolean;
  fadeOut: boolean;
  title?: { kicker?: string; title: string; subtitle?: string; style?: TitleStyle; icon?: string };
  heading?: string;
  headingStatic: boolean;
  audio?: { src: string; startFrame: number };
  /** The narrator's face for this scene: video stretches (seconds) played back to back from `startFrame`, in step with `audio`. */
  presenter?: { src: string; startFrame: number; segments: Array<{ from: number; to: number }>; seconds: number };
  narrationStart: number;
  narrationEnd: number;
  words: CaptionWord[];
  captions: CaptionChunk[];
  cueFrames: Record<string, number>;
  elements: PlanElement[];
  actions: PlanAction[];
  sfx: Array<{ frame: number; name: SfxName; volume: number }>;
  estimatedTiming: boolean;
}

export type SfxName = 'pop' | 'tick' | 'whoosh' | 'swoosh' | 'ding' | 'error' | 'thud';

export interface RenderPlan {
  version: 1;
  id: string;
  title: string;
  format: Format;
  width: number;
  height: number;
  fps: number;
  theme: ThemeName;
  captions: CaptionStyle;
  brand?: string;
  brandKit?: { logo: string; mark: string; url: string; line?: string };
  /** The board keeps the bottom-right corner clear for the narrator's face. */
  presenter?: boolean;
  /** Frames of the closing card after the last scene (included in totalFrames). */
  endFrames?: number;
  music?: { src: string; volume: number };
  scenes: PlanScene[];
  totalFrames: number;
}

// ─── State fold ──────────────────────────────────────────────────────────────────

/** Start frame of state carried over from the previous scene: long finished, so nothing animates again. */
const CARRIED = -300;

export interface ElState {
  visible: boolean;
  shownAt: number | null;
  hiddenAt: number | null;
  pos?: Pt;
  prevPos?: Pt;
  movedAt: number;
  emergeFrom?: string;
  hl: { color?: string; row?: number; at: number } | null;
  hlLast: { color?: string; row?: number; at: number } | null;
  hlOffAt: number | null;
  dimmed: boolean;
  dimAt: number;
  mark: { kind: 'check' | 'cross' | 'warn'; at: number } | null;
  struckAt: number | null;
  markOffAt: number | null;
  markLast: { kind: 'check' | 'cross' | 'warn'; at: number } | null;
  shake: { at: number; until: number } | null;
  pulses: number[];
  ov: Partial<Record<'label' | 'sub' | 'text' | 'items' | 'rows' | 'values', any>>;
  prevOv: Partial<Record<'label' | 'sub' | 'text' | 'items' | 'rows' | 'values', any>>;
  setAt: number;
  revealAt: number[];
  /** Ring arc highlights (clockwise from marker `from` to marker `to`). */
  spans: Array<{ from: string; to: string; color?: string; at: number; until?: number; off?: number }>;
}

export interface Camera { targets: string[]; zoom?: number; at: number }

export interface SceneState {
  els: Record<string, ElState>;
  camera: Camera | null;
  prevCamera: Camera | null;
  cameraAt: number;
}

export function itemCount(spec: Element): number {
  if (spec.type === 'list') return spec.items.length;
  if (spec.type === 'chat') return spec.messages.length;
  return 0;
}

export function foldScene(scene: PlanScene, frame: number): SceneState {
  const els: Record<string, ElState> = {};
  for (const el of scene.elements) {
    const spec = el.spec as any;
    const n = itemCount(el.spec);
    els[el.id] = {
      visible: el.initiallyVisible,
      shownAt: el.initiallyVisible ? -1000 : null,
      hiddenAt: null,
      pos: el.pos,
      prevPos: el.pos,
      movedAt: -1000,
      emergeFrom: spec.emergeFrom,
      hl: el.carry?.hl ? { ...el.carry.hl, at: CARRIED } : null,
      hlLast: null,
      hlOffAt: null,
      dimmed: !!el.carry?.dimmed,
      dimAt: el.carry?.dimmed ? CARRIED : -1000,
      mark: el.carry?.mark ? { kind: el.carry.mark, at: CARRIED } : null,
      struckAt: el.carry?.struck ? CARRIED : null,
      markOffAt: null,
      markLast: null,
      shake: null,
      pulses: [],
      ov: {},
      prevOv: {},
      setAt: -1000,
      revealAt: el.initiallyVisible ? Array.from({ length: n }, () => -1000) : [],
      spans: [],
    };
  }
  let camera: Camera | null = null;
  let prevCamera: Camera | null = null;
  let cameraAt = -1000;

  for (const a of scene.actions) {
    if (a.frame > frame) break;
    const id = (a as any).target as string | undefined;
    const s = id ? els[id] : undefined;
    switch (a.do) {
      case 'show': {
        if (!s) break;
        if (!s.visible) {
          s.visible = true;
          s.shownAt = a.frame;
          s.hiddenAt = null;
          const el = scene.elements.find((e) => e.id === id)!;
          const spec = el.spec as any;
          const n = itemCount(el.spec);
          s.revealAt = (spec.type === 'list' || spec.type === 'chat') && spec.stepwise ? [] : Array.from({ length: n }, (_, i) => a.frame + 8 + i * 5);
        }
        break;
      }
      case 'hide':
        if (s && s.visible) { s.visible = false; s.hiddenAt = a.frame; }
        break;
      case 'highlight':
        if (s) { s.hl = { color: a.hex, row: a.row, at: a.frame }; s.hlLast = s.hl; s.hlOffAt = null; }
        break;
      case 'unhighlight':
        if (s && s.hl) { s.hl = null; s.hlOffAt = a.frame; }
        break;
      case 'pulse':
        if (s) s.pulses.push(a.frame);
        break;
      case 'shake':
        if (s) s.shake = { at: a.frame, until: a.until ?? a.frame + 45 };
        break;
      case 'mark':
        if (s) { s.mark = { kind: a.kind, at: a.frame }; s.markLast = s.mark; s.markOffAt = null; }
        break;
      case 'strike':
        if (s) s.struckAt = a.frame;
        break;
      case 'unstrike':
        if (s) s.struckAt = null;
        break;
      case 'unmark':
        if (s && s.mark) { s.mark = null; s.markOffAt = a.frame; }
        break;
      case 'dim':
        if (s && !s.dimmed) { s.dimmed = true; s.dimAt = a.frame; }
        break;
      case 'undim':
        if (s && s.dimmed) { s.dimmed = false; s.dimAt = a.frame; }
        break;
      case 'focus':
        prevCamera = camera;
        camera = { targets: a.targets, zoom: a.zoom, at: a.frame };
        cameraAt = a.frame;
        break;
      case 'unfocus':
        prevCamera = camera;
        camera = null;
        cameraAt = a.frame;
        break;
      case 'move':
        if (s && a.toPx) { s.prevPos = currentPosApprox(s, a.frame); s.pos = a.toPx; s.movedAt = a.frame; }
        break;
      case 'set': {
        if (!s) break;
        s.prevOv = { ...s.ov };
        for (const key of ['label', 'sub', 'text', 'items', 'rows', 'values'] as const) {
          if ((a as any)[key] !== undefined) s.ov[key] = (a as any)[key];
        }
        s.setAt = a.frame;
        if (a.items) {
          const n = a.items.length;
          s.revealAt = Array.from({ length: n }, (_, i) => s.revealAt[i] ?? a.frame + i * 5);
        }
        break;
      }
      case 'span':
        if (s) s.spans.push({ from: a.from, to: a.to, color: a.hex, at: a.frame, until: a.until });
        break;
      case 'unspan':
        if (s) for (const sp of s.spans) if (sp.off === undefined) sp.off = a.frame;
        break;
      case 'reveal': {
        if (!s) break;
        for (let i = 0; i < a.count; i++) s.revealAt.push(a.frame + i * 6);
        break;
      }
      default:
        break;
    }
  }
  // time-boxed effects
  for (const s of Object.values(els)) {
    if (s.shake && frame > s.shake.until + 12) s.shake = null;
  }
  return { els, camera, prevCamera, cameraAt };
}

/** Position used as the start of a new move (ignores in-flight spring easing; good enough & deterministic). */
function currentPosApprox(s: ElState, _frame: number): Pt | undefined {
  return s.pos;
}

/** Element spec with `set` overrides applied (used for geometry at a given state). */
export function effectiveSpec(el: PlanElement, st?: ElState): PlacedElement {
  const spec = { ...(el.spec as any) };
  if (!st) return spec;
  const ov = st.ov;
  if (ov.label !== undefined) spec.label = ov.label;
  if (ov.sub !== undefined) spec.sub = ov.sub;
  if (ov.text !== undefined) spec.text = ov.text;
  if (ov.items !== undefined) spec.items = ov.items;
  if (ov.rows !== undefined) spec.rows = ov.rows;
  if (ov.values !== undefined && spec.type === 'bars') {
    spec.bars = spec.bars.map((b: any, i: number) => ({ ...b, value: ov.values[i] ?? b.value }));
  }
  return spec;
}
