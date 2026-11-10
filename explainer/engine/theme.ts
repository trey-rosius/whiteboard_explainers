import type { ColorName } from './schema';
import type { ThemeName } from './theme-list';

export type { ThemeName } from './theme-list';
export type BackgroundKind = 'educloud' | 'dots' | 'greenboard' | 'blueprint' | 'graph' | 'newsprint' | 'kraft' | 'diner' | 'comic' | 'terminal' | 'synthwave' | 'aurora' | 'sunset';

export interface Theme {
  name: ThemeName;
  /** Light text on a dark background. */
  dark: boolean;
  background: BackgroundKind;
  /** Base colours; contrast is tested against these and `bgStops`. */
  bg: string;
  bgEdge: string;
  /** Other large background colours text can land on. */
  bgStops?: string[];
  grid: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  panel: string;
  captionBg: string;
  /** Karaoke captions: spoken, upcoming and current word, plus a halo so they read over any drawing. */
  captionText: string;
  captionDim: string;
  captionHot: string;
  captionHalo: string;
  /** Fill alpha applied to element colour inside shapes. */
  fillAlpha: number;
  roughness: number;
  strokeWidth: number;
  /** Pencil shading inside shapes. */
  hatch?: boolean;
  fonts: { display: string; hand: string; mono: string };
  colors: Record<ColorName, string>;
}

const rgba = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};
const KALAM = { display: 'Kalam', hand: 'Patrick Hand', mono: 'JetBrains Mono' };

type Base = Pick<Theme, 'name' | 'background' | 'bg' | 'bgEdge' | 'ink' | 'colors'> & Partial<Theme> & { hot?: string };
function make(t: Base, dark: boolean): Theme {
  const { hot, ...rest } = t;
  return {
    dark,
    grid: dark ? 'rgba(148,163,184,0.16)' : 'rgba(120,113,108,0.18)',
    inkSoft: rgba(t.ink, dark ? 0.76 : 0.78),
    inkFaint: rgba(t.ink, dark ? 0.42 : 0.5),
    panel: dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)',
    captionBg: dark ? rgba(t.bgEdge, 0.72) : 'rgba(31,36,48,0.86)',
    captionText: t.ink,
    captionDim: rgba(t.ink, 0.58),
    captionHot: hot ?? t.colors.yellow,
    captionHalo: dark ? rgba(t.bgEdge, 0.9) : rgba(t.bg, 0.92),
    fillAlpha: dark ? 0.12 : 0.14,
    roughness: 1,
    strokeWidth: 2.6,
    fonts: KALAM,
    ...rest,
  };
}

export const THEMES: Record<ThemeName, Theme> = {
  educloud: make({
    name: 'educloud', background: 'educloud', bg: '#0F0D14', bgEdge: '#0B0B10', bgStops: ['#2A1420', '#2A1A12'], ink: '#FFF7F0', roughness: 1.9, strokeWidth: 3, fillAlpha: 0.1, hatch: true, hot: '#FB923C',
    colors: { ink: '#FFF7F0', blue: '#7DB4FF', cyan: '#F472B6', green: '#4ADE80', yellow: '#FDBA3B', orange: '#FB923C', red: '#FF5A5F', purple: '#C4A1FF', pink: '#F9A8D4', gray: '#A8A2B0' },
  }, true),
  chalkboard: make({
    name: 'chalkboard', background: 'dots', bg: '#0E1320', bgEdge: '#070A12', ink: '#F4F1EA', roughness: 1.1,
    colors: { ink: '#F4F1EA', blue: '#60A5FA', cyan: '#67E8F9', green: '#4ADE80', yellow: '#FACC15', orange: '#FB923C', red: '#F87171', purple: '#C084FC', pink: '#F472B6', gray: '#94A3B8' },
  }, true),
  paper: make({
    name: 'paper', background: 'dots', bg: '#FBF8F1', bgEdge: '#EFE9DC', ink: '#1F2430', roughness: 0.9, strokeWidth: 2.4, hot: '#DC2626',
    colors: { ink: '#1F2430', blue: '#2563EB', cyan: '#0E7490', green: '#15803D', yellow: '#A16207', orange: '#C2410C', red: '#DC2626', purple: '#9333EA', pink: '#DB2777', gray: '#64748B' },
  }, false),
  greenboard: make({
    name: 'greenboard', background: 'greenboard', bg: '#1E3B2E', bgEdge: '#12261C', bgStops: ['#27493A'], ink: '#F3F1E4', roughness: 1.5, strokeWidth: 3, fillAlpha: 0.1,
    fonts: { display: 'Gochi Hand', hand: 'Patrick Hand', mono: 'JetBrains Mono' },
    colors: { ink: '#F3F1E4', blue: '#A9D2F5', cyan: '#A5ECE8', green: '#C4F0B0', yellow: '#FDE68A', orange: '#FBC48F', red: '#FBB0A8', purple: '#D9C2F5', pink: '#F7BCD8', gray: '#B7C7BD' },
  }, true),
  blueprint: make({
    name: 'blueprint', background: 'blueprint', bg: '#0F3A78', bgEdge: '#0A2A5C', ink: '#EAF2FF', roughness: 0.45, strokeWidth: 2.2, fillAlpha: 0.08, grid: 'rgba(190,220,255,0.18)',
    fonts: { display: 'Architects Daughter', hand: 'Architects Daughter', mono: 'JetBrains Mono' },
    colors: { ink: '#EAF2FF', blue: '#A9D0FF', cyan: '#7FE3F5', green: '#86EFAC', yellow: '#FDE68A', orange: '#FDBA74', red: '#FCA5A5', purple: '#D8B4FE', pink: '#F9A8D4', gray: '#B6C6DE' },
  }, true),
  graph: make({
    name: 'graph', background: 'graph', bg: '#F7FAFC', bgEdge: '#EAF1F7', ink: '#18304B', roughness: 0.9, strokeWidth: 2.4, hot: '#DC2626', grid: 'rgba(96,165,250,0.34)',
    colors: { ink: '#18304B', blue: '#1D4ED8', cyan: '#0E7490', green: '#15803D', yellow: '#A16207', orange: '#C2410C', red: '#DC2626', purple: '#7E22CE', pink: '#BE185D', gray: '#526475' },
  }, false),
  newsprint: make({
    name: 'newsprint', background: 'newsprint', bg: '#F3EEE1', bgEdge: '#E6DFCD', ink: '#16130E', roughness: 0.35, strokeWidth: 2.4, fillAlpha: 0.1, hot: '#B3261E',
    fonts: { display: 'Playfair Display', hand: 'Lora', mono: 'JetBrains Mono' },
    colors: { ink: '#16130E', blue: '#1D4E89', cyan: '#0B5563', green: '#2F5D34', yellow: '#7A5900', orange: '#A8430F', red: '#B3261E', purple: '#5B2C83', pink: '#99235F', gray: '#5E574A' },
  }, false),
  kraft: make({
    name: 'kraft', background: 'kraft', bg: '#DBBB95', bgEdge: '#C8A680', bgStops: ['#E3C6A3'], ink: '#1C1008', roughness: 1.5, strokeWidth: 3.2, fillAlpha: 0.14, hot: '#7A1212', panel: 'rgba(255,240,215,0.38)', grid: 'rgba(60,35,15,0.14)',
    fonts: { display: 'Permanent Marker', hand: 'Patrick Hand', mono: 'JetBrains Mono' },
    colors: { ink: '#24150A', blue: '#10304F', cyan: '#0A3F4A', green: '#1B4220', yellow: '#4A3200', orange: '#672500', red: '#6F1414', purple: '#37195C', pink: '#651144', gray: '#3F3024' },
  }, false),
  diner: make({
    name: 'diner', background: 'diner', bg: '#FFF6E6', bgEdge: '#FBE7C6', ink: '#2B1810', roughness: 1, strokeWidth: 3, fillAlpha: 0.14, hot: '#C8102E',
    fonts: { display: 'Lobster', hand: 'Nunito', mono: 'JetBrains Mono' },
    colors: { ink: '#2B1810', blue: '#1D4E89', cyan: '#0E7490', green: '#2F7D32', yellow: '#A16207', orange: '#C2410C', red: '#C8102E', purple: '#6D28D9', pink: '#BE185D', gray: '#6B5B4D' },
  }, false),
  comic: make({
    name: 'comic', background: 'comic', bg: '#FFD93D', bgEdge: '#FFC800', ink: '#111111', roughness: 1.3, strokeWidth: 4.2, fillAlpha: 0.22, hot: '#B00020', panel: 'rgba(255,255,255,0.72)', grid: 'rgba(0,0,0,0.12)',
    fonts: { display: 'Bangers', hand: 'Comic Neue', mono: 'JetBrains Mono' },
    colors: { ink: '#111111', blue: '#0B3FBF', cyan: '#00586B', green: '#0B5D1E', yellow: '#6B4000', orange: '#9A3600', red: '#B00020', purple: '#4A148C', pink: '#A1045A', gray: '#3A3A3A' },
  }, false),
  terminal: make({
    name: 'terminal', background: 'terminal', bg: '#06120B', bgEdge: '#020604', ink: '#B8F5C8', roughness: 0.25, strokeWidth: 2.2, fillAlpha: 0.1, hot: '#FDE047',
    fonts: { display: 'Share Tech Mono', hand: 'Share Tech Mono', mono: 'Share Tech Mono' },
    colors: { ink: '#B8F5C8', blue: '#7DD3FC', cyan: '#5EEAD4', green: '#4ADE80', yellow: '#FDE047', orange: '#FDBA74', red: '#FCA5A5', purple: '#C4B5FD', pink: '#F9A8D4', gray: '#7FA08A' },
  }, true),
  synthwave: make({
    name: 'synthwave', background: 'synthwave', bg: '#140A2E', bgEdge: '#08041A', bgStops: ['#2A0F52'], ink: '#F5EDFF', roughness: 0.7, strokeWidth: 3, fillAlpha: 0.16, hot: '#22E6FF',
    fonts: { display: 'Rajdhani', hand: 'Rajdhani', mono: 'JetBrains Mono' },
    colors: { ink: '#F5EDFF', blue: '#7EB2FF', cyan: '#22E6FF', green: '#5CFFB1', yellow: '#FFE45E', orange: '#FF9E4A', red: '#FF7A7A', purple: '#C39BFF', pink: '#FF7ACB', gray: '#B7ABD2' },
  }, true),
  aurora: make({
    name: 'aurora', background: 'aurora', bg: '#07171F', bgEdge: '#030B10', bgStops: ['#123A44'], ink: '#EAF7F5', roughness: 0.6, strokeWidth: 2.6, fillAlpha: 0.14, hot: '#5EEAD4',
    fonts: { display: 'Space Grotesk', hand: 'Nunito', mono: 'JetBrains Mono' },
    colors: { ink: '#EAF7F5', blue: '#93C5FD', cyan: '#67E8F9', green: '#5EEAD4', yellow: '#FDE68A', orange: '#FDBA74', red: '#FDA4AF', purple: '#C4B5FD', pink: '#F9A8D4', gray: '#A6BDBD' },
  }, true),
  sunset: make({
    name: 'sunset', background: 'sunset', bg: '#FFD6B0', bgEdge: '#E4B8E8', bgStops: ['#FFB3BA'], ink: '#2D1238', roughness: 0.8, strokeWidth: 3, fillAlpha: 0.14, hot: '#8E0F33', panel: 'rgba(255,255,255,0.5)', grid: 'rgba(80,20,60,0.1)',
    fonts: { display: 'Fredoka', hand: 'Nunito', mono: 'JetBrains Mono' },
    colors: { ink: '#2D1238', blue: '#1E3A8A', cyan: '#0B4F5F', green: '#0F5132', yellow: '#5E3D00', orange: '#8A3200', red: '#8E0F33', purple: '#51167D', pink: '#8A1344', gray: '#4F3F58' },
  }, false),
};

/** Default element colours by type — semantic consistency across every video. */
export const DEFAULT_COLOR: Record<string, ColorName> = {
  node: 'cyan',
  db: 'purple',
  server: 'cyan',
  client: 'blue',
  queue: 'orange',
  table: 'ink',
  code: 'ink',
  list: 'ink',
  text: 'ink',
  note: 'yellow',
  bars: 'cyan',
  group: 'gray',
  arrow: 'ink',
};

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
