/**
 * Caption catalogue and how well each style reads on each background, with no dependencies: shared by the engine,
 * the API and the studio's picker. Ratings come from rendering every style on real videos (dark and light themes).
 */
import type { ThemeName } from './theme-list';

export const CAPTION_STYLES = ['off', 'subtle', 'karaoke', 'pop', 'highlight', 'lowerthird', 'marker'] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type CaptionChoice = CaptionStyle | 'auto';
export const isCaptionStyle = (v: unknown): v is CaptionStyle => CAPTION_STYLES.includes(v as CaptionStyle);

export const CAPTION_META: Record<CaptionStyle, { name: string; look: string }> = {
  pop: { name: 'Pop', look: '1–3 big outlined words at a time, bouncing in; numbers and names in gold' },
  highlight: { name: 'Highlight', look: 'A calm line; numbers and names turn gold and get underlined as you say them' },
  marker: { name: 'Marker', look: 'A yellow highlighter sweeps behind each word as you say it' },
  lowerthird: { name: 'Lower third', look: 'A dark news-style bar on the left, clear of your face circle' },
  karaoke: { name: 'Karaoke', look: 'Big words that light up as you say them' },
  subtle: { name: 'Subtle', look: 'Handwriting in a soft dark pill' },
  off: { name: 'Off', look: 'No captions' },
};

/** Backgrounds with a pattern (gingham, halftone dots, grid lines, newsprint): plain text over them is hard to read. */
const BUSY: ThemeName[] = ['diner', 'comic', 'graph', 'newsprint'];
const DARK: ThemeName[] = ['educloud', 'chalkboard', 'greenboard', 'blueprint', 'terminal', 'synthwave', 'aurora'];
export const isDarkTheme = (t: ThemeName) => DARK.includes(t);

export type Fit = 'best' | 'good' | 'avoid';

/** How well a caption style suits a background and format, and why, in words for the picker. */
export function captionFit(style: CaptionStyle, theme: ThemeName | 'auto', format: '16:9' | '9:16'): { fit: Fit; why: string } {
  if (style === 'off') return { fit: 'good', why: 'No captions. Most people watch Shorts on mute, so captions usually help.' };
  const busy = theme !== 'auto' && BUSY.includes(theme);
  const short = format === '9:16';
  // Text that sits straight on the background (only a soft glow behind it) gets lost in a pattern.
  if (busy && (style === 'highlight' || style === 'karaoke')) return { fit: 'avoid', why: 'Plain text over this patterned background is hard to read.' };
  if (theme === 'comic' && style === 'marker') return { fit: 'avoid', why: 'A yellow highlighter disappears on this yellow background.' };
  if (theme === 'sunset' && style === 'marker') return { fit: 'good', why: 'Works, though the highlighter is soft against the warm glow.' };
  switch (style) {
    case 'pop': return short ? { fit: 'best', why: 'The classic Shorts look, with a heavy outline that reads on any background.' }
      : busy ? { fit: 'best', why: 'The heavy outline cuts through the pattern.' } : { fit: 'good', why: 'Reads well, but a little loud over a long video.' };
    case 'lowerthird': return busy ? { fit: 'best', why: 'Its solid bar keeps words readable over the pattern.' }
      : short ? { fit: 'good', why: 'Clear, but small on a phone screen.' } : { fit: 'best', why: 'Clean and professional, and well clear of your face.' };
    case 'subtle': return busy ? { fit: 'best', why: 'Its dark pill keeps words readable over the pattern.' }
      : short ? { fit: 'good', why: 'Calm, but small on a phone screen.' } : { fit: 'best', why: 'Calm and unobtrusive for longer videos.' };
    case 'highlight': return { fit: 'best', why: 'Clean, and the numbers you say stand out.' };
    case 'marker': return short ? { fit: 'best', why: 'Lively, and fits the hand-drawn look.' } : { fit: 'good', why: 'Fun, but busy over a long video.' };
    case 'karaoke': return { fit: 'good', why: 'Clear and simple, but plainer than the newer styles.' };
  }
}

/** What Auto picks from: every style rated best for this background and format. */
export function autoCaptionChoices(theme: ThemeName, format: '16:9' | '9:16'): CaptionStyle[] {
  return CAPTION_STYLES.filter((s) => s !== 'off' && captionFit(s, theme, format).fit === 'best');
}
