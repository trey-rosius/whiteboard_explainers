/**
 * Title-screen designs: which ones exist, how each lays out its text, and the colours they use. Pure, so a test can
 * prove every design fits every format and stays readable in every theme, and the renderer only draws the result.
 */
import { FRAME, textWidth, wrapText, type Format } from './layout';
import type { Theme } from './theme';

export const TITLE_STYLES = ['classic', 'hero', 'bigtype', 'monogram', 'stamp', 'band'] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];
/** Picked automatically when a spec doesn't ask for one. `classic` is only used on request. */
const AUTO_STYLES: TitleStyle[] = ['hero', 'bigtype', 'monogram', 'stamp', 'band'];

const bare = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '');
const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h; };

const acronymIn = (title: string) => title.split(/\s+/).map(bare).find((w) => /^[A-Z0-9]{2,5}$/.test(w) && /[A-Z]/.test(w));

/** Same title, same design; different titles spread across the designs. `hero` needs an icon, `monogram` an acronym. */
export function autoTitleStyle(title: string, hasIcon: boolean): TitleStyle {
  const options = AUTO_STYLES.filter((s) => (s !== 'hero' || hasIcon) && (s !== 'monogram' || !!acronymIn(title)));
  return options[hash(title.toLowerCase()) % options.length];
}

/** Text must stay clear of the corner logo above and the captions below. */
export function titleSafe(format: Format) {
  return format === '9:16' ? { x: 70, y: 230, w: 940, h: 1370 } : { x: 130, y: 130, w: 1660, h: 810 };
}

export interface TitleLayout {
  style: TitleStyle;
  align: 'center' | 'left';
  left: number;
  width: number;
  size: number;
  lines: string[];
  lineH: number;
  blockTop: number;
  blockH: number;
  kickerTop?: number;
  kickerSize: number;
  iconTop?: number;
  iconD: number;
  subTop?: number;
  subSize: number;
  subLines: string[];
  /** Hand-drawn frame around the title (stamp) or full-width colour band behind it (band). */
  panel?: { x: number; y: number; w: number; h: number };
  ghost?: { text: string; size: number; y: number };
  /** Extent of everything readable, used by the fit test. */
  top: number;
  bottom: number;
  maxLineW: number;
}

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'it', 'its', 'how', 'what', 'why', 'with', 'at', 'by', 'you', 'your', 'does', 'do', 'when', 'that', 'this', 'from', 'lets', "let's"]);
/** Same line count at the narrowest width that keeps it, so no word is stranded on the last line. */
function balanced(title: string, size: number, maxW: number, count: number) {
  let w = maxW;
  while (w > size * 2 && wrapText(title, size, 'display', w - 10).length === count) w -= 10;
  return wrapText(title, size, 'display', w);
}

/** Largest size at which the title fits the line count and width; the smallest size still breaks only at spaces. */
function fit(title: string, maxW: number, maxLines: number, maxSize: number, minSize: number) {
  for (let size = maxSize; size > minSize; size -= 4) {
    const lines = wrapText(title, size, 'display', maxW);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, size, 'display') <= maxW)) return { size, lines: balanced(title, size, maxW, lines.length) };
  }
  const lines = wrapText(title, minSize, 'display', maxW);
  return { size: minSize, lines: balanced(title, minSize, maxW, lines.length) };
}

/** The title's acronym; without one, the first letter of its main word (initials like "VRS" mean nothing to a viewer). */
export function monogramOf(title: string): string {
  const acronym = acronymIn(title);
  if (acronym) return acronym;
  const words = title.split(/\s+/).filter(Boolean);
  return [...bare(words[keywordIndex(title)] ?? title)][0]?.toUpperCase() ?? '';
}

/** Index (within the whole title) of the word worth emphasising: the first acronym, otherwise the longest main word. */
export function keywordIndex(title: string): number {
  const words = title.split(/\s+/).filter(Boolean);
  const acronym = words.findIndex((w) => /^[A-Z0-9]{2,5}$/.test(bare(w)));
  if (acronym >= 0) return acronym;
  let best = 0, len = -1;
  words.forEach((w, i) => { const n = [...bare(w)].length; if (!STOP.has(bare(w).toLowerCase()) && n > len) { best = i; len = n; } });
  return best;
}

export function titleLayout(style: TitleStyle, t: { kicker?: string; title: string; subtitle?: string }, format: Format): TitleLayout {
  const v = format === '9:16';
  const safe = titleSafe(format);
  const { w: frameW } = FRAME[format];
  const params: Record<TitleStyle, { maxW: number; lines: number; max: number; min: number; lineH: number }> = {
    classic: { maxW: v ? 920 : 1560, lines: 5, max: v ? 92 : 112, min: 60, lineH: 1.15 },
    hero: { maxW: v ? 900 : 1500, lines: v ? 4 : 2, max: v ? 96 : 92, min: 56, lineH: 1.14 },
    bigtype: { maxW: v ? 920 : 1560, lines: v ? 6 : 3, max: v ? 168 : 150, min: 64, lineH: 1.04 },
    monogram: { maxW: v ? 880 : 1400, lines: v ? 4 : 2, max: v ? 100 : 96, min: 56, lineH: 1.14 },
    stamp: { maxW: v ? 760 : 1240, lines: v ? 5 : 2, max: v ? 96 : 100, min: 54, lineH: 1.14 },
    band: { maxW: v ? 900 : 1480, lines: v ? 4 : 2, max: v ? 104 : 104, min: 56, lineH: 1.12 },
  };
  const p = params[style];
  const { size, lines } = fit(t.title, p.maxW, p.lines, p.max, p.min);
  const lineH = size * p.lineH;
  const blockH = lines.length * lineH;
  const kickerSize = v ? 30 : 30;
  const subSize = v ? 42 : 42;
  const align: TitleLayout['align'] = style === 'bigtype' ? 'left' : 'center';
  const subW = style === 'bigtype' ? p.maxW : Math.min(p.maxW, v ? 880 : 1300);
  const subLines = t.subtitle ? wrapText(t.subtitle, subSize, 'hand', subW) : [];
  const subH = subLines.length * subSize * 1.3;
  const iconD = style === 'hero' ? (v ? 340 : 230) : 0;
  // Circling dots need room below the icon; the big letters get their own row so nothing lands on them.
  const iconGap = v ? 84 : 58;
  const ghostText = style === 'monogram' ? monogramOf(t.title) : '';
  const ghostSize = ghostText ? Math.min(v ? 400 : 250, (safe.w * 0.92) / Math.max(0.1, textWidth(ghostText, 1, 'display'))) : 0;
  const ghostH = ghostSize * 1.02;
  const panelPad = style === 'stamp' ? (v ? 64 : 56) : style === 'band' ? (v ? 52 : 44) : 0;
  const gap = v ? 48 : 34;

  // Stack everything, then centre the stack in the safe area.
  let h = blockH + 2 * panelPad;
  if (t.kicker) h += kickerSize * 1.3 + gap;
  if (iconD) h += iconD + iconGap;
  if (ghostH) h += ghostH + gap * 0.4;
  if (subH) h += subH + gap;
  let y = safe.y + Math.max(0, (safe.h - h) / 2);
  const top = y;
  let kickerTop: number | undefined, iconTop: number | undefined;
  if (iconD) { iconTop = y; y += iconD + iconGap; }
  const ghostTop = y;
  if (ghostH) y += ghostH + gap * 0.4;
  if (t.kicker) { kickerTop = y; y += kickerSize * 1.3 + gap; }
  const panelTop = y;
  y += panelPad;
  const blockTop = y;
  y += blockH + panelPad;
  let subTop: number | undefined;
  if (subH) { y += gap; subTop = y; y += subH; }

  const maxLineW = Math.max(...lines.map((l) => textWidth(l, size, 'display')));
  const left = (frameW - p.maxW) / 2;
  let panel: TitleLayout['panel'];
  if (style === 'stamp') { const w = Math.max(maxLineW, v ? 560 : 800) + 2 * panelPad; panel = { x: (frameW - w) / 2, y: panelTop, w, h: blockH + 2 * panelPad }; }
  if (style === 'band') panel = { x: 0, y: panelTop, w: frameW, h: blockH + 2 * panelPad };
  let ghost: TitleLayout['ghost'];
  if (style === 'monogram') ghost = { text: ghostText, size: ghostSize, y: ghostTop };
  return { style, align, left, width: p.maxW, size, lines, lineH, blockTop, blockH, kickerTop, kickerSize, iconTop, iconD, subTop, subSize, subLines, panel, ghost, top, bottom: y, maxLineW };
}

const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

/** Colour band for the `band` design and whichever text colour reads best on it. */
export function bandColors(theme: Theme, seed: string): { band: string; text: string } {
  const opts = (['yellow', 'cyan', 'orange', 'green'] as const).map((k) => theme.colors[k]).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const band = opts[hash(seed) % opts.length] ?? theme.colors.yellow;
  const text = ['#ffffff', '#0b1020'].sort((a, b) => contrast(b, band) - contrast(a, band))[0];
  return { band, text };
}

/**
 * The opening line should say the title and get out of the way: title, then one short hook at most.
 * A long opening, or a hook that just says the title again, holds a static screen too long.
 */
export function capTitleNarration(narration: string, title: string, maxHookWords = 12): string {
  const plain = (s: string) => s.toLowerCase().replace(/\{[^}]*\}/g, '').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  const sentences = narration.trim().split(/(?<=[.!?])\s+/);
  const inTitle = title.trim().split(/(?<=[.!?])\s+/).length;
  const opening = sentences.slice(0, inTitle);
  const rest = sentences.slice(inTitle);
  if (!rest.length) return narration.trim();
  const hook = rest[0];
  const firstTwo = plain(title).split(' ').slice(0, 2).join(' ');
  const keep = plain(hook).split(' ').length <= maxHookWords && !plain(hook).startsWith(firstTwo);
  return [...opening, ...(keep ? [hook] : [])].join(' ');
}
