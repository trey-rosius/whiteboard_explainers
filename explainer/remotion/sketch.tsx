/**
 * Hand-drawn primitives: deterministic roughjs paths (seeded per element, so lines never
 * "boil" between frames) rendered with a sequential draw-on effect.
 */
import React from 'react';
import rough from 'roughjs';
import { getLength } from '@remotion/paths';

const gen = rough.generator();
const cache = new Map<string, string[]>();
const lenCache = new Map<string, number>();

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483646 + 1;
}

export interface RoughOpts { seed: string; roughness: number; strokeWidth?: number; bowing?: number }

/** Returns sub-paths (split at each "M") of a rough rendering of an SVG path. */
export function roughPath(d: string, o: RoughOpts): string[] {
  const key = `${o.seed}|${o.roughness}|${o.bowing ?? 1}|${d}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const drawable = gen.path(d, {
    seed: hashSeed(o.seed),
    roughness: o.roughness,
    bowing: o.bowing ?? 0.8,
    strokeWidth: o.strokeWidth ?? 2.5,
    // A second, slightly different pass of the pen is what makes a line look hand-drawn.
    disableMultiStroke: o.roughness < 1.7,
    preserveVertices: true,
    fill: undefined,
  });
  const out = gen
    .toPaths(drawable)
    .flatMap((p) => p.d.split(/(?=M)/))
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}

function pathLength(d: string): number {
  const hit = lenCache.get(d);
  if (hit !== undefined) return hit;
  let l = 0;
  try { l = getLength(d); } catch { l = 0; }
  if (lenCache.size > 8000) lenCache.clear();
  lenCache.set(d, l);
  return l;
}

/** Strokes drawn one after another (with overlap) as `progress` goes 0→1. */
export const Strokes: React.FC<{
  paths: string[];
  progress: number;
  color: string;
  width: number;
  opacity?: number;
  dash?: string;
}> = ({ paths, progress, color, width, opacity = 1, dash }) => {
  const n = paths.length;
  if (progress <= 0) return null;
  return (
    <g opacity={opacity}>
      {paths.map((d, i) => {
        const start = n > 1 ? (i / n) * 0.7 : 0;
        const span = n > 1 ? 0.3 + 0.7 / n : 1;
        const p = Math.min(1, Math.max(0, (progress - start) / span));
        if (p <= 0) return null;
        if (dash) {
          return <path key={i} d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} opacity={p} />;
        }
        const len = pathLength(d) || 1;
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p >= 1 ? undefined : `${len} ${len}`}
            strokeDashoffset={p >= 1 ? undefined : len * (1 - p)}
          />
        );
      })}
    </g>
  );
};

// ─── SVG path builders (local coordinates) ──────────────────────────────────────

export const P = {
  rrect(x: number, y: number, w: number, h: number, r = 18): string {
    r = Math.min(r, w / 2, h / 2);
    return `M${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
  },
  line(x1: number, y1: number, x2: number, y2: number): string {
    return `M${x1},${y1} L${x2},${y2}`;
  },
  ellipse(cx: number, cy: number, rx: number, ry: number): string {
    return `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`;
  },
  circle(cx: number, cy: number, r: number): string {
    return P.ellipse(cx, cy, r, r);
  },
  /** Database drum: top ellipse, sides, bottom half-ellipse, one band. */
  cylinder(x: number, y: number, w: number, h: number): string[] {
    const rx = w / 2, ry = Math.max(10, w * 0.16), cx = x + rx;
    const top = y + ry, bot = y + h - ry;
    return [
      P.ellipse(cx, top, rx, ry),
      `M${x},${top} L${x},${bot} A${rx},${ry} 0 0,0 ${x + w},${bot} L${x + w},${top}`,
      `M${x},${top + (bot - top) * 0.45} A${rx},${ry} 0 0,0 ${x + w},${top + (bot - top) * 0.45}`,
    ];
  },
  check(cx: number, cy: number, s: number): string {
    return `M${cx - s * 0.5},${cy + s * 0.02} L${cx - s * 0.12},${cy + s * 0.4} L${cx + s * 0.55},${cy - s * 0.42}`;
  },
  cross(cx: number, cy: number, s: number): string[] {
    return [P.line(cx - s * 0.42, cy - s * 0.42, cx + s * 0.42, cy + s * 0.42), P.line(cx + s * 0.42, cy - s * 0.42, cx - s * 0.42, cy + s * 0.42)];
  },
  triangle(cx: number, cy: number, s: number): string {
    return `M${cx},${cy - s * 0.55} L${cx + s * 0.55},${cy + s * 0.42} L${cx - s * 0.55},${cy + s * 0.42} Z`;
  },
};

export function roughMany(ds: string[], o: RoughOpts): string[] {
  return ds.flatMap((d, i) => roughPath(d, { ...o, seed: `${o.seed}:${i}` }));
}
