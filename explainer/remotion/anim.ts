import type React from 'react';
import { spring } from 'remotion';
import type { Theme } from '../engine/theme';

/** Elements read fonts through CSS variables, so each theme can swap its type without touching them. */
export const fonts = { display: 'var(--font-display)', hand: 'var(--font-hand)', mono: 'var(--font-mono)' };

const LOADERS: Record<string, () => Promise<{ loadFont: (style?: any, opts?: any) => { waitUntilDone: () => Promise<void> } }>> = {
  Kalam: () => import('@remotion/google-fonts/Kalam') as any,
  'Patrick Hand': () => import('@remotion/google-fonts/PatrickHand') as any,
  'JetBrains Mono': () => import('@remotion/google-fonts/JetBrainsMono') as any,
  'Gochi Hand': () => import('@remotion/google-fonts/GochiHand') as any,
  'Architects Daughter': () => import('@remotion/google-fonts/ArchitectsDaughter') as any,
  'Playfair Display': () => import('@remotion/google-fonts/PlayfairDisplay') as any,
  Lora: () => import('@remotion/google-fonts/Lora') as any,
  'Permanent Marker': () => import('@remotion/google-fonts/PermanentMarker') as any,
  Lobster: () => import('@remotion/google-fonts/Lobster') as any,
  Nunito: () => import('@remotion/google-fonts/Nunito') as any,
  Bangers: () => import('@remotion/google-fonts/Bangers') as any,
  'Comic Neue': () => import('@remotion/google-fonts/ComicNeue') as any,
  'Share Tech Mono': () => import('@remotion/google-fonts/ShareTechMono') as any,
  Rajdhani: () => import('@remotion/google-fonts/Rajdhani') as any,
  'Space Grotesk': () => import('@remotion/google-fonts/SpaceGrotesk') as any,
  Fredoka: () => import('@remotion/google-fonts/Fredoka') as any,
};
const WEIGHTS: Record<string, string[]> = {
  Kalam: ['400', '700'], 'JetBrains Mono': ['400', '700'], 'Playfair Display': ['400', '700'], Lora: ['400', '700'], Nunito: ['400', '700'],
  'Comic Neue': ['400', '700'], Rajdhani: ['500', '700'], 'Space Grotesk': ['400', '700'], Fredoka: ['400', '700'],
};
const started = new Map<string, Promise<void>>();

/** Loads only the fonts this theme uses. Resolves once they're ready, so frames never render with a fallback font. */
export function loadThemeFonts(theme: Theme): Promise<void> {
  const names = [...new Set([...Object.values(theme.fonts), 'Space Grotesk'])]; // the closing card's font
  return Promise.all(names.map((name) => {
    if (!started.has(name)) {
      started.set(name, LOADERS[name]().then((m) => m.loadFont('normal', { weights: WEIGHTS[name] ?? ['400'], subsets: ['latin'] }).waitUntilDone()));
    }
    return started.get(name)!;
  })).then(() => undefined);
}

export const fontVars = (theme: Theme): React.CSSProperties => ({
  '--font-display': `'${theme.fonts.display}', sans-serif`,
  '--font-hand': `'${theme.fonts.hand}', sans-serif`,
  '--font-mono': `'${theme.fonts.mono}', monospace`,
} as React.CSSProperties);

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t: number) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** Spring that is 0 before `start`. */
export function sp(frame: number, start: number, fps: number, cfg: { damping?: number; stiffness?: number; mass?: number } = {}): number {
  if (start <= -999) return 1;
  const f = frame - start;
  if (f <= 0) return 0;
  return spring({ frame: f, fps, config: { damping: cfg.damping ?? 16, stiffness: cfg.stiffness ?? 140, mass: cfg.mass ?? 0.8 } });
}

/** Linear progress 0→1 over `dur` frames from `start`. */
export function prog(frame: number, start: number, dur: number): number {
  if (start <= -999) return 1;
  return clamp01((frame - start) / dur);
}

export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return t > 0.5 ? b : a;
  const c = pa.map((v, i) => Math.round(lerp(v, pb[i], t)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parse(h: string): number[] | null {
  const m = h.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}
