/** Every theme stays readable: contrast of text and element colours against all its background colours (WCAG). npx tsx explainer/test/themes.ts */
import { THEMES } from '../engine/theme';
import { THEME_IDS, THEME_META } from '../engine/theme-list';
const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
let fails = 0;
for (const id of THEME_IDS) {
  const t = THEMES[id];
  const bgs = [t.bg, t.bgEdge, ...(t.bgStops ?? [])];
  const worst = (c: string) => Math.min(...bgs.map((b) => ratio(c, b)));
  const ink = worst(t.ink);
  const colors = Object.entries(t.colors).map(([k, c]) => [k, worst(c)] as const);
  const low = colors.filter(([, r]) => r < 3);
  const hot = worst(t.captionHot);
  const bad = ink < 7 || low.length > 0 || hot < 3;
  if (bad) fails++;
  console.log(`${bad ? '✖' : '✔'} ${id.padEnd(11)} ink ${ink.toFixed(1)}:1 · weakest colour ${Math.min(...colors.map(([, r]) => r)).toFixed(1)}:1 · caption word ${hot.toFixed(1)}:1${low.length ? ` · LOW: ${low.map(([k, r]) => `${k} ${r.toFixed(1)}`).join(', ')}` : ''}`);
  if (!THEME_META[id] || t.name !== id) { console.log(`✖ ${id}: metadata mismatch`); fails++; }
}
console.log(fails ? `\n✖ ${fails} theme(s) failed` : `\n✔ all ${THEME_IDS.length} themes readable`);
process.exit(fails ? 1 : 0);
