/**
 * Geometry — the single source of truth shared by the validator and the renderer.
 * If the validator says it fits, the renderer draws exactly that box.
 */
import type { PlacedElement } from './schema';

export type Format = '16:9' | '9:16';
export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

export const FRAME: Record<Format, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
};

export const CONTENT: Record<Format, Rect & { cols: number; rows: number }> = {
  '16:9': { x: 120, y: 180, w: 1680, h: 740, cols: 12, rows: 6 },
  '9:16': { x: 60, y: 300, w: 960, h: 1250, cols: 6, rows: 10 },
};

export const HEADING: Record<Format, { x: number; y: number; size: number; align: 'left' | 'center' }> = {
  '16:9': { x: 120, y: 92, size: 54, align: 'left' },
  '9:16': { x: 540, y: 190, size: 60, align: 'center' },
};

export const CAPTION: Record<Format, { y: number; maxW: number }> = {
  '16:9': { y: 1000, maxW: 1400 },
  '9:16': { y: 1690, maxW: 920 },
};

/** Element scale per format; the board is narrow on 9:16, but the screen is what the viewer holds. */
export const FORMAT_SCALE: Record<Format, number> = { '16:9': 1, '9:16': 1.3 };

export function gridToPx(format: Format, [gx, gy]: [number, number]): Pt {
  const c = CONTENT[format];
  return { x: c.x + (gx * c.w) / c.cols, y: c.y + (gy * c.h) / c.rows };
}

// ─── Text metrics (conservative estimates, slightly over-measure on purpose) ────────

export type FontKind = 'display' | 'hand' | 'mono';
const FONT_FACTOR: Record<FontKind, number> = { display: 1.1, hand: 0.94, mono: 1 };

function charEm(ch: string): number {
  if (ch === ' ') return 0.28;
  if ('ilj.,:;\'!|`'.includes(ch)) return 0.26;
  if ('mw'.includes(ch)) return 0.8;
  if ('MW'.includes(ch)) return 0.92;
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[0-9]/.test(ch)) return 0.56;
  if (/[a-z]/.test(ch)) return 0.52;
  if (/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(ch)) return 1.15;
  return 0.48;
}

export function textWidth(text: string, size: number, font: FontKind): number {
  if (font === 'mono') return [...text].length * 0.6 * size;
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * size * FONT_FACTOR[font];
}

export function wrapText(text: string, size: number, font: FontKind, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, font) > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

// ─── Element footprints ──────────────────────────────────────────────────────────

export const SIZE_SCALE = { s: 0.92, m: 1.15, l: 1.4 } as const;

export interface LabelMetrics { label?: string; sub?: string; labelSize: number; subSize: number; labelY: number; subY: number }

export interface Geometry {
  /** Main body; arrows attach to this. */
  shape: Rect;
  /** Everything incl. label/sub; used for overlap + bounds. */
  box: Rect;
  k: number;
  label?: LabelMetrics;
  /** Type-specific metrics the renderer uses verbatim. */
  m: Record<string, any>;
}

const ICONIC_SHAPE: Record<string, [number, number]> = {
  node: [136, 136],
  db: [124, 150],
  server: [124, 150],
  'client:user': [104, 132],
  'client:laptop': [190, 128],
  'client:phone': [96, 168],
  'client:browser': [210, 140],
};

/** Text drawn over the board rather than inside an element, which isn't scaled with it. */
export const OVERLAY_TEXT: Record<Format, { group: number; arrow: number; packet: number }> = {
  '16:9': { group: 30, arrow: 23, packet: 19 },
  '9:16': { group: 38, arrow: 34, packet: 30 },
};

/** Vertical videos are watched on phones: small elements shrink their shapes, but their text stops at a readable size. */
export const PHONE_TEXT = { label: 40, body: 30 } as const;
const onPhone = (el: PlacedElement, size: number, floor: number) => (((el as any).__scale ?? 1) > 1 ? Math.max(size, floor) : size);

function iconic(el: PlacedElement, c: Pt, k: number, sw: number, sh: number, label: string, sub?: string): Geometry {
  const shape = { x: c.x - sw / 2, y: c.y - sh / 2, w: sw, h: sh };
  const labelSize = onPhone(el, 30 * k, PHONE_TEXT.label);
  const subSize = onPhone(el, 20 * k, PHONE_TEXT.body);
  const labelY = shape.y + sh + 12 * k;
  const subY = labelY + labelSize * 1.18;
  const lw = textWidth(label, labelSize, 'display');
  const sw2 = sub ? textWidth(sub, subSize, 'mono') + 20 * k : 0;
  const w = Math.max(sw, lw, sw2);
  const h = sh + 12 * k + labelSize * 1.2 + (sub ? subSize * 1.7 : 0);
  return {
    shape,
    box: { x: c.x - w / 2, y: shape.y, w, h },
    k,
    label: { label, sub, labelSize, subSize, labelY, subY },
    m: {},
  };
}

/** Ring radius in px for a ring of the given size. */
export const ringRadius = (size?: 's' | 'm' | 'l') => 228 * SIZE_SCALE[size ?? 'm'];
/** Marker position on a ring: 0° = top, clockwise. */
export function ringPoint(c: Pt, r: number, angle: number): Pt {
  const a = (angle * Math.PI) / 180;
  return { x: c.x + r * Math.sin(a), y: c.y - r * Math.cos(a) };
}

export function footprint(el: PlacedElement, c: Pt): Geometry {
  // __scale is set by the compiler per format: vertical videos are watched on phones, so everything is larger.
  const k = SIZE_SCALE[((el as any).size ?? 'm') as 's' | 'm' | 'l'] * ((el as any).__scale ?? 1);
  switch (el.type) {
    case 'ring': {
      const r = ringRadius(el.size);
      const shape = { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r };
      const margin = 72 * k; // room for marker labels outside the circle
      return {
        shape,
        box: { x: shape.x - margin, y: shape.y - margin, w: shape.w + 2 * margin, h: shape.h + 2 * margin },
        k,
        m: { cx: c.x, cy: c.y, r, labelSize: 34 * k, subSize: 21 * k },
      };
    }
    case 'marker': {
      const kind = el.kind ?? 'server';
      const half = (kind === 'server' ? 38 : kind === 'vnode' ? 28 : 16) * 1.15;
      const dir = ((el as any).__dir as Pt) ?? { x: 0, y: -1 };
      const shape = { x: c.x - half, y: c.y - half, w: 2 * half, h: 2 * half };
      const font: FontKind = kind === 'key' ? 'mono' : 'display';
      const size = (kind === 'key' ? 22 : 27) * 1.15;
      const lw = el.label ? textWidth(el.label, size, font) : 0;
      const lh = size * 1.2;
      const gap = half + 12;
      const lcx = c.x + dir.x * (gap + lw / 2);
      const lcy = c.y + dir.y * (gap + lh / 2);
      const lab = { x: lcx - lw / 2, y: lcy - lh / 2, w: lw, h: lh };
      const x1 = Math.min(shape.x, lab.x), y1 = Math.min(shape.y, lab.y);
      const x2 = Math.max(shape.x + shape.w, lab.x + lab.w), y2 = Math.max(shape.y + shape.h, lab.y + lab.h);
      return { shape, box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, k: 1.15, m: { kind, half, lab, size, font, dir } };
    }
    case 'node': {
      const [w, h] = ICONIC_SHAPE.node;
      const g = iconic(el, c, k, w * k, h * k, el.label, el.sub);
      g.m.icon = 74 * k;
      return g;
    }
    case 'db': {
      const [w, h] = ICONIC_SHAPE.db;
      return iconic(el, c, k, w * k, h * k, el.label, el.sub);
    }
    case 'server': {
      const [w, h] = ICONIC_SHAPE.server;
      const extra = ((el.stack ?? 1) - 1) * 16 * k;
      const g = iconic(el, c, k, w * k + extra, h * k + extra, el.label, el.sub);
      g.m.stackOffset = 16 * k;
      return g;
    }
    case 'client': {
      const [w, h] = ICONIC_SHAPE[`client:${el.variant ?? 'laptop'}`];
      return iconic(el, c, k, w * k, h * k, el.label, el.sub);
    }
    case 'queue': {
      const slotW = 54 * k, gap = 8 * k, pad = 18 * k;
      const slots = Math.max(el.slots ?? 5, el.items?.length ?? 0);
      const w = slots * slotW + (slots - 1) * gap + 2 * pad;
      const g = iconic(el, c, k, w, 86 * k, el.label);
      g.m = { slotW, gap, pad, slots, font: onPhone(el, 17 * k, 24) }; // 24 is the most a 4-character slot can hold
      return g;
    }
    case 'table': {
      const font = onPhone(el, 22 * k, PHONE_TEXT.body), pad = 16 * k, rowH = 42 * k, headerH = 44 * k, titleH = 50 * k;
      const colW = el.columns.map((col, i) =>
        Math.max(
          70 * k,
          textWidth(col, font, 'mono') + 2 * pad,
          ...el.rows.map((r) => textWidth(r[i] ?? '', font, 'mono') + 2 * pad),
        ),
      );
      const titleW = textWidth(el.title, 28 * k, 'display') + 2 * pad;
      const w = Math.max(colW.reduce((a, b) => a + b, 0), titleW);
      if (w > colW.reduce((a, b) => a + b, 0)) {
        const add = (w - colW.reduce((a, b) => a + b, 0)) / colW.length;
        colW.forEach((_, i) => (colW[i] += add));
      }
      const h = titleH + headerH + el.rows.length * rowH + 10 * k;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { font, pad, rowH, headerH, titleH, colW, titleSize: 28 * k } };
    }
    case 'code': {
      const font = onPhone(el, 22 * k, PHONE_TEXT.body), lineH = Math.max(34 * k, font * 1.4), pad = 24 * k, titleH = el.title ? 44 * k : 0;
      const w = Math.max(300 * k, ...el.lines.map((l) => textWidth(l, font, 'mono'))) + 2 * pad;
      const h = titleH + el.lines.length * lineH + 2 * pad - 6 * k;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { font, lineH, pad, titleH } };
    }
    case 'list': {
      const font = onPhone(el, 30 * k, 56), lineH = (font / 30) * 52, titleSize = onPhone(el, 34 * k, 60), titleH = el.title ? (titleSize / 34) * 58 : 0, bullet = (font / 30) * 40;
      const w = Math.max(
        el.title ? textWidth(el.title, titleSize, 'display') : 0,
        ...el.items.map((it) => textWidth(it, font, 'hand') + bullet),
      ) + 16 * k;
      const h = titleH + el.items.length * lineH;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { font, lineH, titleSize, titleH, bullet } };
    }
    case 'chat': {
      // Phone-sized: the card spans most of the width, bubbles wrap inside it.
      const phone = ((el as any).__scale ?? 1) > 1;
      const font = onPhone(el, 24 * k, 36), lineH = font * 1.3, pad = 22 * k, gap = 16 * k, bpadX = 22 * k, bpadY = 14 * k;
      const w = phone ? 940 : 760 * k;
      const titleH = el.title ? (phone ? 92 : 64 * k) : 0, avatar = font * 1.5;
      const maxText = w * 0.72 - 2 * bpadX;
      const bubbles = el.messages.map((msg) => {
        const lines = wrapText(msg.text, font, 'hand', maxText);
        return { lines, bw: Math.max(...lines.map((l) => textWidth(l, font, 'hand'))) + 2 * bpadX, bh: lines.length * lineH + 2 * bpadY };
      });
      const h = titleH + pad + bubbles.reduce((a, b) => a + b.bh + gap, 0) - gap + pad;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { font, lineH, pad, gap, bpadX, bpadY, titleH, avatar, bubbles } };
    }
    case 'text': {
      const style = el.style ?? 'statement';
      const font: FontKind = style === 'label' ? 'hand' : 'display';
      const base = (style === 'stamp' ? 110 : style === 'headline' ? 72 : style === 'statement' ? 46 : 36) * k;
      const size = onPhone(el, base, style === 'label' ? 46 : style === 'statement' ? 66 : base);
      const maxW = ((el as any).__scale ?? 1) > 1 ? 900 : (style === 'headline' ? 1500 : 1100) * k;
      const lines = wrapText(el.text, size, font, maxW);
      const w = Math.max(...lines.map((l) => textWidth(l, size, font)));
      const h = lines.length * size * 1.25;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { lines, size, font, lineH: size * 1.25 } };
    }
    case 'chip': {
      const size = onPhone(el, 28 * k, 38), padX = 26 * k, padY = 13 * k;
      const h = size * 1.25 + 2 * padY, w = textWidth(el.text, size, 'display') + 2 * padX;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { size } };
    }
    case 'note': {
      const size = onPhone(el, 26 * k, 40), pad = 20 * k, w = onPhone(el, 300 * k, 520);
      // Same line count at the narrowest width that keeps it: no single word stranded on the last line.
      const lineCount = wrapText(el.text, size, 'hand', w - 2 * pad).length;
      let textW = w - 2 * pad;
      while (textW > 80 && wrapText(el.text, size, 'hand', textW - 8).length === lineCount) textW -= 8;
      const lines = wrapText(el.text, size, 'hand', textW);
      const h = lines.length * size * 1.3 + 2 * pad;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { lines, size, pad, lineH: size * 1.3 } };
    }
    case 'bars': {
      const w = 460 * k, titleH = el.title ? 46 * k : 0, chartH = 190 * k, labelH = 44 * k;
      const h = titleH + chartH + labelH;
      const shape = { x: c.x - w / 2, y: c.y - h / 2, w, h };
      return { shape, box: shape, k, m: { titleH, chartH, labelH, font: onPhone(el, 20 * k, PHONE_TEXT.body), titleSize: 30 * k } };
    }
  }
}

export function groupRect(children: Rect[], k = 1): Rect {
  const pad = 26 * k;
  const x1 = Math.min(...children.map((r) => r.x)) - pad;
  const y1 = Math.min(...children.map((r) => r.y)) - pad - 30; // room for label
  const x2 = Math.max(...children.map((r) => r.x + r.w)) + pad;
  const y2 = Math.max(...children.map((r) => r.y + r.h)) + pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.min(w, h) : 0;
}

export function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d };
}

// ─── Arrow geometry ──────────────────────────────────────────────────────────────

/** Point where the ray from rect centre toward `toward` exits the rect (plus a gap). */
export function rectExit(r: Rect, toward: Pt, gap: number): Pt {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  const len = Math.hypot(dx, dy);
  return { x: cx + dx * s + (dx / len) * gap, y: cy + dy * s + (dy / len) * gap };
}

export interface ArrowGeom { p0: Pt; c: Pt; p1: Pt; mid: Pt; length: number }

/** An endpoint's shape, plus how far its label hangs below it (so vertical arrows don't run through the text). */
export type ArrowEnd = Rect & { below?: number };
export const arrowEnd = (g: Pick<Geometry, 'shape' | 'box'>): ArrowEnd => ({ ...g.shape, below: Math.max(0, g.box.y + g.box.h - (g.shape.y + g.shape.h)) });

export function arrowGeometry(fromEnd: ArrowEnd, toEnd: ArrowEnd, bend = 0): ArrowGeom {
  const fc = { x: fromEnd.x + fromEnd.w / 2, y: fromEnd.y + fromEnd.h / 2 };
  const tc = { x: toEnd.x + toEnd.w / 2, y: toEnd.y + toEnd.h / 2 };
  const steep = Math.abs(tc.y - fc.y) > Math.abs(tc.x - fc.x) * 0.8;
  const from: Rect = steep && tc.y > fc.y ? { ...fromEnd, h: fromEnd.h + (fromEnd.below ?? 0) } : fromEnd;
  const to: Rect = steep && tc.y < fc.y ? { ...toEnd, h: toEnd.h + (toEnd.below ?? 0) } : toEnd;
  const len = Math.hypot(tc.x - fc.x, tc.y - fc.y) || 1;
  const nx = -(tc.y - fc.y) / len, ny = (tc.x - fc.x) / len;
  const off = bend * len * 0.3;
  const ctrl = { x: (fc.x + tc.x) / 2 + nx * off, y: (fc.y + tc.y) / 2 + ny * off };
  const p0 = rectExit(from, ctrl, 10);
  const p1 = rectExit(to, ctrl, 14);
  const c = { x: (p0.x + p1.x) / 2 + nx * off, y: (p0.y + p1.y) / 2 + ny * off };
  const mid = quadPoint(p0, c, p1, 0.5);
  // approximate length
  let L = 0, prev = p0;
  for (let i = 1; i <= 16; i++) {
    const p = quadPoint(p0, c, p1, i / 16);
    L += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return { p0, c, p1, mid, length: L };
}

/** Two labelled arrows between the same pair run side by side, so their labels go on opposite sides. */
export function arrowLabelSide(arrow: { id: string; spec: any }, all: Array<{ id: string; spec: any }>): -1 | 0 | 1 {
  const same = (o: any) => o.type === 'arrow' && o.label && ((o.from === arrow.spec.from && o.to === arrow.spec.to) || (o.from === arrow.spec.to && o.to === arrow.spec.from));
  const pair = all.filter((e) => same(e.spec));
  return pair.length < 2 ? 0 : pair[0].id === arrow.id ? -1 : 1;
}

export function arrowLabelRect(label: string, geo: ArrowGeom, format: Format, side: -1 | 0 | 1): Rect {
  const size = OVERLAY_TEXT[format].arrow;
  const w = textWidth(label, size, 'hand') + 22, h = size * 1.56;
  const upright = Math.abs(geo.p1.y - geo.p0.y) >= Math.abs(geo.p1.x - geo.p0.x);
  const dx = upright ? side * (w / 2 + 8) : 0, dy = upright ? 0 : side * (h / 2 + 6);
  return { x: geo.mid.x + dx - w / 2, y: geo.mid.y + dy - h / 2, w, h };
}

export function quadPoint(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

export function quadTangent(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  return { x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x), y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y) };
}
