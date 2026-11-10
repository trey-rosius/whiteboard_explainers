/**
 * Element bodies. Each draws in LOCAL coordinates where (0,0) = (box.x - PAD, box.y - PAD).
 * Geometry comes from engine/layout.ts so it matches what the validator checked.
 */
import { formatValue } from '../engine/number-format';
import React from 'react';
import type { Geometry, Rect } from '../engine/layout';
import type { PlacedElement } from '../engine/schema';
import type { Theme } from '../engine/theme';
import { withAlpha } from '../engine/theme';
import { P, Strokes, roughMany, roughPath } from './sketch';
import { clamp01, easeOutCubic, fonts, prog, sp } from './anim';

export const PAD = 44;

export interface BodyProps {
  id: string;
  spec: PlacedElement;
  g: Geometry;
  theme: Theme;
  frame: number;
  fps: number;
  /** Base element colour. */
  color: string;
  /** Current stroke colour (base mixed with highlight / alarm). */
  stroke: string;
  icon?: string;
  drawP: number;
  contentP: number;
  hl: { intensity: number; color: string; row?: number };
  shownAt: number;
  setAt: number;
  revealAt: number[];
  /** Previous bar values for smooth `set values` transitions. */
  prevValues?: number[];
  /** Ring only: active arc highlights in degrees (clockwise a0→a1), with fade-in progress. */
  spans?: Array<{ a0: number; a1: number; color: string; p: number; o: number }>;
}

const loc = (g: Geometry, r: Rect): Rect => ({ x: r.x - g.box.x + PAD, y: r.y - g.box.y + PAD, w: r.w, h: r.h });

const Svg: React.FC<{ g: Geometry; children: React.ReactNode }> = ({ g, children }) => (
  <svg width={g.box.w + PAD * 2} height={g.box.h + PAD * 2} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
    {children}
  </svg>
);

const textFade = (p: BodyProps) => (p.setAt > -999 ? 0.25 + 0.75 * prog(p.frame, p.setAt, 10) : 1);

export const LabelBlock: React.FC<{ p: BodyProps }> = ({ p }) => {
  const L = p.g.label;
  if (!L?.label) return null;
  const s = loc(p.g, p.g.shape);
  const cx = s.x + s.w / 2;
  const top = L.labelY - p.g.box.y + PAD;
  const a = clamp01((p.contentP - 0.2) / 0.8) * textFade(p);
  return (
    <>
      <div
        style={{
          position: 'absolute', left: cx - 400, width: 800, top, textAlign: 'center',
          fontFamily: fonts.display, fontWeight: 700, fontSize: L.labelSize, lineHeight: 1.15, color: p.theme.ink,
          opacity: a, transform: `translateY(${(1 - a) * 8}px)`, whiteSpace: 'nowrap',
        }}
      >
        {L.label}
      </div>
      {L.sub ? (
        <div style={{ position: 'absolute', left: cx - 400, width: 800, top: L.subY - p.g.box.y + PAD + 4, textAlign: 'center', opacity: a * 0.95 }}>
          <span
            style={{
              fontFamily: fonts.mono, fontSize: L.subSize, color: p.color, background: withAlpha(p.color, 0.12),
              border: `1.5px solid ${withAlpha(p.color, 0.45)}`, borderRadius: 999, padding: `${L.subSize * 0.12}px ${L.subSize * 0.6}px`, whiteSpace: 'nowrap',
            }}
          >
            {L.sub}
          </span>
        </div>
      ) : null}
    </>
  );
};

const fillOf = (p: BodyProps, extra = 0) => withAlpha(p.color, p.theme.fillAlpha * clamp01(p.drawP * 1.6) + extra * p.hl.intensity);

// ─── iconic shapes ──────────────────────────────────────────────────────────────

/** Loose pencil shading across a shape, clipped to it. */
const Hatch: React.FC<{ p: BodyProps; s: Rect; d: string }> = ({ p, s, d }) => {
  const gap = 26 * p.g.k;
  const lines: string[] = [];
  for (let o = gap; o < s.w + s.h; o += gap) lines.push(`M${s.x + Math.min(o, s.w)},${s.y + Math.max(0, o - s.w)} L${s.x + Math.max(0, o - s.h)},${s.y + Math.min(o, s.h)}`);
  const paths = roughMany(lines, { seed: `${p.id}-hatch`, roughness: 1.1, strokeWidth: 2 });
  const clip = `hatch-${p.id}`;
  return (
    <g clipPath={`url(#${clip})`} opacity={0.24 * clamp01(p.drawP * 1.4)}>
      <clipPath id={clip}><path d={d} /></clipPath>
      {paths.map((x, i) => <path key={i} d={x} fill="none" stroke={p.stroke} strokeWidth={2} strokeLinecap="round" />)}
    </g>
  );
};

const NodeBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const d = P.rrect(s.x, s.y, s.w, s.h, 22 * p.g.k);
  const paths = roughPath(d, { seed: p.id, roughness: p.theme.roughness, strokeWidth: p.theme.strokeWidth });
  const iconSize = p.g.m.icon as number;
  const pop = sp(p.frame, p.shownAt + 6, p.fps, { damping: 11, stiffness: 160 });
  return (
    <>
      <Svg g={p.g}>
        <path d={d} fill={fillOf(p, 0.1)} />
        {p.theme.hatch ? <Hatch p={p} s={s} d={d} /> : null}
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth} />
      </Svg>
      {p.icon ? (
        <img
          src={p.icon}
          style={{
            position: 'absolute', left: s.x + s.w / 2 - iconSize / 2, top: s.y + s.h / 2 - iconSize / 2, width: iconSize, height: iconSize,
            transform: `scale(${pop})`, borderRadius: 10 * p.g.k, opacity: clamp01(pop * 1.5),
          }}
        />
      ) : null}
      <LabelBlock p={p} />
    </>
  );
};

const DbBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const ds = P.cylinder(s.x, s.y, s.w, s.h);
  const paths = roughMany(ds, { seed: p.id, roughness: p.theme.roughness, strokeWidth: p.theme.strokeWidth });
  const ry = Math.max(10, s.w * 0.16);
  const body = `M${s.x},${s.y + ry} L${s.x},${s.y + s.h - ry} A${s.w / 2},${ry} 0 0,0 ${s.x + s.w},${s.y + s.h - ry} L${s.x + s.w},${s.y + ry} A${s.w / 2},${ry} 0 0,0 ${s.x},${s.y + ry} Z`;
  const iconSize = 46 * p.g.k;
  return (
    <>
      <Svg g={p.g}>
        <path d={body} fill={fillOf(p, 0.1)} />
        <ellipse cx={s.x + s.w / 2} cy={s.y + ry} rx={s.w / 2} ry={ry} fill={withAlpha(p.color, 0.22 * clamp01(p.drawP * 1.5))} />
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth} />
      </Svg>
      {p.icon ? (
        <img src={p.icon} style={{ position: 'absolute', left: s.x + s.w / 2 - iconSize / 2, top: s.y + s.h * 0.58 - iconSize / 2, width: iconSize, height: iconSize, opacity: p.contentP, borderRadius: 8 }} />
      ) : null}
      <LabelBlock p={p} />
    </>
  );
};

const ServerBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const stack = (p.spec as any).stack ?? 1;
  const off = (p.g.m.stackOffset as number) ?? 0;
  const s0 = loc(p.g, p.g.shape);
  const bw = s0.w - (stack - 1) * off, bh = s0.h - (stack - 1) * off;
  const layers = Array.from({ length: stack }, (_, i) => stack - 1 - i); // back to front
  const blink = Math.floor((p.frame + p.id.length * 7) / 20) % 3;
  return (
    <>
      <Svg g={p.g}>
        {layers.map((li) => {
          const x = s0.x + li * off, y = s0.y + (stack - 1 - li) * off;
          const front = li === 0;
          const d = P.rrect(x, y, bw, bh, 14 * p.g.k);
          const seps = [1, 2].map((k) => P.line(x + 12, y + (bh * k) / 3, x + bw - 12, y + (bh * k) / 3));
          const paths = roughMany([d, ...(front ? seps : [])], { seed: `${p.id}-${li}`, roughness: p.theme.roughness, strokeWidth: p.theme.strokeWidth });
          return (
            <g key={li} opacity={front ? 1 : 0.55}>
              <path d={d} fill={front ? fillOf(p, 0.1) : withAlpha(p.color, 0.05)} />
              <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth} />
              {front
                ? [0, 1, 2].map((k) => (
                    <g key={k} opacity={p.contentP}>
                      <circle cx={x + 24 * p.g.k} cy={y + (bh * (k + 0.5)) / 3} r={5.5 * p.g.k} fill={k === blink && p.hl.intensity > 0.3 ? p.theme.colors.yellow : p.theme.colors.green} />
                      <line x1={x + 44 * p.g.k} x2={x + bw - 22 * p.g.k} y1={y + (bh * (k + 0.5)) / 3} y2={y + (bh * (k + 0.5)) / 3} stroke={withAlpha(p.color, 0.35)} strokeWidth={3} strokeDasharray="10 7" strokeLinecap="round" />
                    </g>
                  ))
                : null}
            </g>
          );
        })}
      </Svg>
      <LabelBlock p={p} />
    </>
  );
};

const ClientBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const v = (p.spec as any).variant ?? 'laptop';
  const k = p.g.k;
  let ds: string[] = [];
  let fill = '';
  const extras: React.ReactNode[] = [];
  if (v === 'user') {
    const r = s.w * 0.24;
    ds = [P.circle(s.x + s.w / 2, s.y + r + 4, r), `M${s.x + 6},${s.y + s.h} Q${s.x + 8},${s.y + s.h * 0.5} ${s.x + s.w / 2},${s.y + s.h * 0.52} Q${s.x + s.w - 8},${s.y + s.h * 0.5} ${s.x + s.w - 6},${s.y + s.h}`];
    fill = P.circle(s.x + s.w / 2, s.y + r + 4, r);
  } else if (v === 'laptop') {
    const sh = s.h * 0.74;
    ds = [P.rrect(s.x + s.w * 0.08, s.y, s.w * 0.84, sh, 10 * k), `M${s.x + s.w * 0.02},${s.y + sh + 6} L${s.x + s.w * 0.98},${s.y + sh + 6} L${s.x + s.w},${s.y + s.h} L${s.x},${s.y + s.h} Z`];
    fill = P.rrect(s.x + s.w * 0.08, s.y, s.w * 0.84, sh, 10 * k);
    extras.push(<rect key="scr" x={s.x + s.w * 0.14} y={s.y + sh * 0.14} width={s.w * 0.72} height={sh * 0.72} rx={4} fill={withAlpha(p.color, 0.1)} opacity={p.contentP} />);
  } else if (v === 'phone') {
    ds = [P.rrect(s.x, s.y, s.w, s.h, 18 * k), P.line(s.x + s.w * 0.38, s.y + 12 * k, s.x + s.w * 0.62, s.y + 12 * k), P.line(s.x + s.w * 0.35, s.y + s.h - 12 * k, s.x + s.w * 0.65, s.y + s.h - 12 * k)];
    fill = P.rrect(s.x, s.y, s.w, s.h, 18 * k);
  } else {
    ds = [P.rrect(s.x, s.y, s.w, s.h, 12 * k), P.line(s.x, s.y + 28 * k, s.x + s.w, s.y + 28 * k)];
    fill = P.rrect(s.x, s.y, s.w, s.h, 12 * k);
    [0, 1, 2].forEach((i) => extras.push(<circle key={i} cx={s.x + (16 + i * 16) * k} cy={s.y + 14 * k} r={4.5 * k} fill={[p.theme.colors.red, p.theme.colors.yellow, p.theme.colors.green][i]} opacity={p.contentP} />));
  }
  const paths = roughMany(ds, { seed: p.id, roughness: p.theme.roughness, strokeWidth: p.theme.strokeWidth });
  return (
    <>
      <Svg g={p.g}>
        <path d={fill} fill={fillOf(p, 0.1)} />
        {extras}
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth} />
      </Svg>
      <LabelBlock p={p} />
    </>
  );
};

const QueueBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const { slotW, gap, pad, slots, font } = p.g.m as any;
  const items: string[] = (p.spec as any).items ?? [];
  const slotRects = Array.from({ length: slots }, (_, i) => ({ x: s.x + pad + i * (slotW + gap), y: s.y + 16 * p.g.k, w: slotW, h: s.h - 32 * p.g.k }));
  const outer = P.rrect(s.x, s.y, s.w, s.h, 16 * p.g.k);
  const paths = roughMany([outer], { seed: p.id, roughness: p.theme.roughness, strokeWidth: p.theme.strokeWidth });
  const slotPaths = roughMany(slotRects.map((r) => P.rrect(r.x, r.y, r.w, r.h, 8)), { seed: `${p.id}-s`, roughness: p.theme.roughness * 0.8, strokeWidth: 2 });
  return (
    <>
      <Svg g={p.g}>
        <path d={outer} fill={fillOf(p, 0.06)} />
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth} />
        <Strokes paths={slotPaths} progress={clamp01(p.drawP * 1.2 - 0.2)} color={withAlpha(p.color, 0.6)} width={2} />
        {slotRects.map((r, i) =>
          i < items.length ? <rect key={i} x={r.x + 3} y={r.y + 3} width={r.w - 6} height={r.h - 6} rx={6} fill={withAlpha(p.color, 0.38)} opacity={p.contentP * textFade(p)} /> : null,
        )}
      </Svg>
      {slotRects.map((r, i) =>
        i < items.length ? (
          <div key={i} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.mono, fontWeight: 700, fontSize: font, color: p.theme.ink, opacity: p.contentP * textFade(p) }}>
            {items[i]}
          </div>
        ) : null,
      )}
      <LabelBlock p={p} />
    </>
  );
};

// ─── data shapes ────────────────────────────────────────────────────────────────

const TableBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const spec = p.spec as Extract<PlacedElement, { type: 'table' }>;
  const { font, pad, rowH, headerH, titleH, colW, titleSize } = p.g.m as any;
  const lines: string[] = [P.rrect(s.x, s.y, s.w, s.h, 14 * p.g.k), P.line(s.x, s.y + titleH, s.x + s.w, s.y + titleH)];
  let cx = s.x;
  colW.slice(0, -1).forEach((w: number) => {
    cx += w;
    lines.push(P.line(cx, s.y + titleH, cx, s.y + s.h));
  });
  lines.push(P.line(s.x, s.y + titleH + headerH, s.x + s.w, s.y + titleH + headerH));
  const paths = roughMany(lines, { seed: p.id, roughness: p.theme.roughness * 0.8, strokeWidth: p.theme.strokeWidth });
  const hlRow = p.hl.row;
  const hlW = easeOutCubic(p.hl.intensity);
  const fade = textFade(p);
  return (
    <>
      <Svg g={p.g}>
        <path d={P.rrect(s.x, s.y, s.w, s.h, 14 * p.g.k)} fill={p.theme.panel} opacity={clamp01(p.drawP * 1.5)} />
        <rect x={s.x + 2} y={s.y + titleH} width={s.w - 4} height={headerH} fill={withAlpha(p.color, 0.1)} opacity={p.contentP} />
        {hlRow !== undefined && p.hl.intensity > 0 ? (
          <rect x={s.x + 4} y={s.y + titleH + headerH + hlRow * rowH + 3} width={(s.w - 8) * hlW} height={rowH - 6} rx={6} fill={withAlpha(p.hl.color, 0.28)} />
        ) : null}
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth * 0.85} />
      </Svg>
      <div style={{ position: 'absolute', left: s.x + pad, top: s.y, height: titleH, display: 'flex', alignItems: 'center', fontFamily: fonts.display, fontWeight: 700, fontSize: titleSize, color: p.color === p.theme.ink ? p.theme.colors.yellow : p.color, opacity: p.contentP }}>
        {spec.title}
      </div>
      {[spec.columns, ...spec.rows].map((row, ri) => {
        let x = s.x;
        const y = ri === 0 ? s.y + titleH : s.y + titleH + headerH + (ri - 1) * rowH;
        const h = ri === 0 ? headerH : rowH;
        const rowReveal = ri === 0 ? p.contentP : clamp01(p.contentP * 1.4 - ri * 0.08);
        return row.map((cell, ci) => {
          const left = x;
          x += colW[ci];
          const isHl = hlRow !== undefined && ri - 1 === hlRow && p.hl.intensity > 0.3;
          return (
            <div key={`${ri}-${ci}`} style={{ position: 'absolute', left, top: y, width: colW[ci], height: h, display: 'flex', alignItems: 'center', paddingLeft: pad, boxSizing: 'border-box', fontFamily: fonts.mono, fontWeight: ri === 0 ? 700 : 500, fontSize: font, color: ri === 0 ? p.theme.inkSoft : isHl ? p.theme.ink : p.theme.inkSoft, opacity: rowReveal * (ri === 0 ? 1 : fade), whiteSpace: 'nowrap' }}>
              {cell}
            </div>
          );
        });
      })}
    </>
  );
};

const KW = /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|JOIN|ON|GROUP|BY|ORDER|LIMIT|CREATE|TABLE|INDEX|AND|OR|NOT|NULL|const|let|var|function|return|if|else|for|while|await|async|def|class|import|from|export|new|true|false|None|True|False|GET|POST|PUT|PATCH)\b/;

function codeTokens(line: string, theme: Theme): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\/\/.*$|#.*$|--.*$)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_\d]*)|(\s+|[^\sA-Za-z_\d"'`]+|.)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line))) {
    const [tok] = m;
    let color = theme.ink;
    if (m[1]) color = theme.inkFaint;
    else if (m[2]) color = theme.colors.green;
    else if (m[3]) color = theme.colors.orange;
    else if (m[4] && KW.test(tok)) color = theme.colors.cyan;
    else if (m[5]) color = theme.inkSoft;
    out.push(<span key={i++} style={{ color }}>{tok}</span>);
  }
  return out;
}

const CodeBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const spec = p.spec as Extract<PlacedElement, { type: 'code' }>;
  const { font, lineH, pad, titleH } = p.g.m as any;
  const paths = roughPath(P.rrect(s.x, s.y, s.w, s.h, 14 * p.g.k), { seed: p.id, roughness: p.theme.roughness * 0.7, strokeWidth: p.theme.strokeWidth });
  const panel = p.theme.dark ? 'rgba(0,0,0,0.38)' : 'rgba(24,28,38,0.94)';
  const codeTheme: Theme = !p.theme.dark ? { ...p.theme, ink: '#F4F1EA', inkSoft: 'rgba(244,241,234,0.75)', inkFaint: 'rgba(244,241,234,0.4)', colors: { ...p.theme.colors, cyan: '#67E8F9', green: '#86EFAC', orange: '#FDBA74' } } : p.theme;
  const fade = textFade(p);
  return (
    <>
      <Svg g={p.g}>
        <path d={P.rrect(s.x, s.y, s.w, s.h, 14 * p.g.k)} fill={panel} opacity={clamp01(p.drawP * 1.5)} />
        {spec.title ? [0, 1, 2].map((i) => <circle key={i} cx={s.x + 22 + i * 18} cy={s.y + titleH / 2} r={5} fill={[p.theme.colors.red, p.theme.colors.yellow, p.theme.colors.green][i]} opacity={p.contentP} />) : null}
        {p.hl.row !== undefined && p.hl.intensity > 0 ? (
          <rect x={s.x + 6} y={s.y + titleH + pad - 4 + p.hl.row * lineH} width={(s.w - 12) * easeOutCubic(p.hl.intensity)} height={lineH} rx={6} fill={withAlpha(p.hl.color, 0.25)} />
        ) : null}
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth * 0.85} />
      </Svg>
      {spec.title ? (
        <div style={{ position: 'absolute', left: s.x + 84, top: s.y, height: titleH, display: 'flex', alignItems: 'center', fontFamily: fonts.mono, fontSize: font * 0.85, color: codeTheme.inkFaint, opacity: p.contentP }}>{spec.title}</div>
      ) : null}
      {spec.lines.map((line, i) => {
        const r = clamp01(p.contentP * 1.6 - i * 0.07);
        return (
          <div key={i} style={{ position: 'absolute', left: s.x + pad, top: s.y + titleH + pad - 4 + i * lineH, height: lineH, display: 'flex', alignItems: 'center', fontFamily: fonts.mono, fontSize: font, whiteSpace: 'pre', opacity: r * fade, transform: `translateX(${(1 - r) * -8}px)` }}>
            {codeTokens(line, codeTheme)}
          </div>
        );
      })}
    </>
  );
};

const ListBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const spec = p.spec as Extract<PlacedElement, { type: 'list' }>;
  const { font, lineH, titleSize, titleH, bullet } = p.g.m as any;
  return (
    <>
      {spec.title ? (
        <div style={{ position: 'absolute', left: s.x, top: s.y, fontFamily: fonts.display, fontWeight: 700, fontSize: titleSize, color: p.color === p.theme.ink ? p.theme.colors.yellow : p.color, opacity: p.contentP, whiteSpace: 'nowrap' }}>{spec.title}</div>
      ) : null}
      {spec.items.map((it, i) => {
        const ra = p.revealAt[i];
        if (ra === undefined) return null;
        const r = ra <= -999 ? 1 : sp(p.frame, ra, p.fps, { damping: 18 });
        const isHl = p.hl.row === i && p.hl.intensity > 0;
        const c = isHl ? p.hl.color : p.color === p.theme.ink ? p.theme.colors.cyan : p.color;
        const y = s.y + titleH + i * lineH;
        return (
          <div key={i} style={{ position: 'absolute', left: s.x, top: y, height: lineH, display: 'flex', alignItems: 'center', gap: 12, opacity: r, transform: `translateX(${(1 - r) * -18}px)`, whiteSpace: 'nowrap' }}>
            <div style={{ width: bullet - 12, height: bullet - 12, borderRadius: 999, border: `2.5px solid ${c}`, color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontWeight: 700, fontSize: font * 0.62, background: isHl ? withAlpha(c, 0.2) : 'transparent' }}>
              {spec.ordered ? i + 1 : ''}
            </div>
            <div style={{ fontFamily: fonts.hand, fontSize: font, color: isHl ? p.theme.ink : p.theme.inkSoft }}>{it}</div>
          </div>
        );
      })}
    </>
  );
};

const ChatBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const spec = p.spec as Extract<PlacedElement, { type: 'chat' }>;
  const { font, lineH, pad, gap, bpadX, bpadY, titleH, avatar, bubbles } = p.g.m as any;
  const paths = roughPath(P.rrect(s.x, s.y, s.w, s.h, 22 * p.g.k), { seed: p.id, roughness: p.theme.roughness * 0.6, strokeWidth: p.theme.strokeWidth });
  const panel = p.theme.dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.7)';
  const botC = p.color === p.theme.ink ? p.theme.colors.orange : p.color;
  const userC = p.theme.colors.blue;
  const fade = textFade(p);
  let y = s.y + titleH + pad;
  return (
    <>
      <Svg g={p.g}>
        <path d={P.rrect(s.x, s.y, s.w, s.h, 22 * p.g.k)} fill={panel} opacity={clamp01(p.drawP * 1.5)} />
        {titleH ? <line x1={s.x + 12} x2={s.x + s.w - 12} y1={s.y + titleH} y2={s.y + titleH} stroke={p.theme.inkFaint} strokeWidth={2} opacity={p.contentP} /> : null}
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={p.theme.strokeWidth * 0.85} />
      </Svg>
      {spec.title ? (
        <div style={{ position: 'absolute', left: s.x + pad, top: s.y, height: titleH, display: 'flex', alignItems: 'center', gap: 14, opacity: p.contentP * fade, whiteSpace: 'nowrap' }}>
          <div style={{ width: avatar, height: avatar, borderRadius: 999, background: withAlpha(botC, 0.25), border: `2.5px solid ${botC}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: botC, fontFamily: fonts.display, fontWeight: 700, fontSize: font * 0.62 }}>AI</div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: font * 1.02, color: p.theme.ink }}>{spec.title}</div>
        </div>
      ) : null}
      {spec.messages.map((msg, i) => {
        const b = bubbles[i];
        const top = y;
        y += b.bh + gap;
        const ra = p.revealAt[i];
        if (ra === undefined) return null;
        const r = ra <= -999 ? 1 : sp(p.frame, ra, p.fps, { damping: 18 });
        const mine = msg.from === 'user';
        const c = mine ? userC : botC;
        const isHl = p.hl.row === i && p.hl.intensity > 0;
        const left = mine ? s.x + s.w - pad - b.bw : s.x + pad;
        return (
          <div key={i} style={{ position: 'absolute', left, top, width: b.bw, height: b.bh, boxSizing: 'border-box', padding: `${bpadY}px ${bpadX}px`, borderRadius: 20 * p.g.k,
            borderBottomRightRadius: mine ? 4 : 20 * p.g.k, borderBottomLeftRadius: mine ? 20 * p.g.k : 4,
            background: withAlpha(isHl ? p.hl.color : c, isHl ? 0.3 : mine ? 0.18 : 0.12), border: `2.5px solid ${isHl ? p.hl.color : withAlpha(c, 0.75)}`,
            opacity: r * fade, transform: `translateY(${(1 - r) * 16}px) scale(${0.96 + 0.04 * r})`, transformOrigin: mine ? 'right bottom' : 'left bottom' }}>
            {b.lines.map((ln: string, k: number) => (
              <div key={k} style={{ height: lineH, lineHeight: `${lineH}px`, fontFamily: fonts.hand, fontSize: font, color: p.theme.ink, whiteSpace: 'nowrap' }}>{ln}</div>
            ))}
          </div>
        );
      })}
    </>
  );
};

const TextBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const spec = p.spec as Extract<PlacedElement, { type: 'text' }>;
  const { lines, size, font, lineH } = p.g.m as any;
  const style = spec.style ?? 'statement';
  const c = style === 'headline' ? (p.color === p.theme.ink ? p.theme.ink : p.color) : p.color === p.theme.ink ? p.theme.ink : p.color;
  const under = style === 'headline' ? roughPath(`M${s.x + s.w * 0.05},${s.y + s.h + 6} Q${s.x + s.w * 0.5},${s.y + s.h + 16} ${s.x + s.w * 0.95},${s.y + s.h + 2}`, { seed: p.id, roughness: 1.4, strokeWidth: 5 }) : [];
  const fade = textFade(p);
  return (
    <>
      {lines.map((ln: string, i: number) => {
        const r = clamp01(p.contentP * 1.5 - i * 0.15);
        return (
          <div key={i} style={{ position: 'absolute', left: s.x - 200, width: s.w + 400, top: s.y + i * lineH, height: lineH, textAlign: 'center', fontFamily: font === 'hand' ? fonts.hand : fonts.display, fontWeight: font === 'hand' ? 400 : 700, fontSize: size, lineHeight: `${lineH}px`, color: c, opacity: r * fade, transform: `translateY(${(1 - r) * 12}px)`, whiteSpace: 'nowrap' }}>
            {ln}
          </div>
        );
      })}
      {under.length ? (
        <Svg g={p.g}>
          <Strokes paths={under} progress={clamp01((p.contentP - 0.5) * 2)} color={p.theme.colors.yellow} width={5} />
        </Svg>
      ) : null}
    </>
  );
};

const ChipBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const spec = p.spec as Extract<PlacedElement, { type: 'chip' }>;
  const fill = p.color === p.theme.ink ? p.theme.colors.yellow : p.color;
  return (
    <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, borderRadius: s.h / 2, background: fill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontWeight: 700, fontSize: (p.g.m as any).size, color: p.theme.dark ? p.theme.bgEdge : '#FFFFFF', whiteSpace: 'nowrap', opacity: textFade(p) }}>
      {spec.text}
    </div>
  );
};

/** Comes down hard from oversized and tilted, like a rubber stamp. */
const StampBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const { lines, size, lineH } = p.g.m as any;
  const land = sp(p.frame, p.shownAt, p.fps, { damping: 13, stiffness: 240 });
  const color = p.color === p.theme.ink ? p.theme.colors.red : p.color;
  return (
    <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, opacity: Math.min(1, land * 2.5), transform: `rotate(-6deg) scale(${1.7 - 0.7 * land})`, textAlign: 'center', fontFamily: fonts.display, fontWeight: 700, fontSize: size, lineHeight: `${lineH}px`, color, textTransform: 'uppercase', whiteSpace: 'nowrap', textShadow: `0 0 34px ${withAlpha(color, 0.55)}, 0 4px 0 ${p.theme.bgEdge}` }}>
      {lines.map((ln: string, i: number) => <div key={i}>{ln}</div>)}
    </div>
  );
};

const NoteBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const { lines, size, pad, lineH } = p.g.m as any;
  const d = P.rrect(s.x, s.y, s.w, s.h, 6);
  const paths = roughPath(d, { seed: p.id, roughness: p.theme.roughness, strokeWidth: 2.2 });
  return (
    <div style={{ position: 'absolute', inset: 0, transform: 'rotate(-1.6deg)', transformOrigin: `${s.x + s.w / 2}px ${s.y + s.h / 2}px` }}>
      <Svg g={p.g}>
        <path d={d} fill={withAlpha(p.color, 0.16 * clamp01(p.drawP * 1.5))} />
        <Strokes paths={paths} progress={p.drawP} color={p.stroke} width={2.2} />
      </Svg>
      {lines.map((ln: string, i: number) => (
        <div key={i} style={{ position: 'absolute', left: s.x + pad, top: s.y + pad + i * lineH, height: lineH, fontFamily: fonts.hand, fontSize: size, lineHeight: `${lineH}px`, color: p.theme.ink, opacity: p.contentP * textFade(p), whiteSpace: 'nowrap' }}>
          {ln}
        </div>
      ))}
    </div>
  );
};

const BarsBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const spec = p.spec as Extract<PlacedElement, { type: 'bars' }>;
  const { titleH, chartH, labelH, font, titleSize } = p.g.m as any;
  const n = spec.bars.length;
  const max = spec.max ?? (Math.max(...spec.bars.map((b) => b.value), ...(p.prevValues ?? [])) * 1.12 || 1);
  const slot = s.w / n;
  const bw = Math.min(70 * p.g.k, slot * 0.58);
  const base = s.y + titleH + chartH;
  const axis = roughPath(P.line(s.x, base, s.x + s.w, base), { seed: p.id, roughness: 1, strokeWidth: 2.5 });
  const grow = p.setAt > -999 ? sp(p.frame, p.setAt, p.fps, { damping: 20 }) : 1;
  const colors = [p.color, p.theme.colors.yellow, p.theme.colors.pink, p.theme.colors.green, p.theme.colors.purple, p.theme.colors.orange];
  return (
    <>
      {spec.title ? <div style={{ position: 'absolute', left: s.x, width: s.w, top: s.y, textAlign: 'center', fontFamily: fonts.display, fontWeight: 700, fontSize: titleSize, color: p.theme.ink, opacity: p.contentP }}>{spec.title}</div> : null}
      <Svg g={p.g}>
        <Strokes paths={axis} progress={p.drawP} color={p.theme.inkSoft} width={2.5} />
        {spec.bars.map((b, i) => {
          const from = p.prevValues?.[i] ?? b.value;
          const v = p.setAt > -999 ? from + (b.value - from) * grow : b.value;
          const appear = sp(p.frame, p.shownAt + 6 + i * 4, p.fps, { damping: 18, stiffness: 90 });
          const h = (v / max) * (chartH - 30) * appear;
          const x = s.x + slot * i + (slot - bw) / 2;
          const c = p.hl.row === i && p.hl.intensity > 0 ? p.hl.color : colors[i % colors.length];
          return <rect key={i} x={x} y={base - h} width={bw} height={Math.max(0, h)} rx={6} fill={withAlpha(c, 0.55)} stroke={c} strokeWidth={2.5} />;
        })}
      </Svg>
      {spec.bars.map((b, i) => {
        const from = p.prevValues?.[i] ?? b.value;
        const v = p.setAt > -999 ? from + (b.value - from) * grow : b.value;
        const appear = sp(p.frame, p.shownAt + 6 + i * 4, p.fps, { damping: 18, stiffness: 90 });
        const h = (v / max) * (chartH - 30) * appear;
        const x = s.x + slot * i;
        const shown = formatValue(Number.isInteger(b.value) ? Math.round(v) : v, spec.unit ?? '', Number.isInteger(b.value) ? 0 : 1);
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: x, width: slot, top: base - h - font * 1.5, textAlign: 'center', fontFamily: fonts.mono, fontWeight: 700, fontSize: font, color: p.theme.ink, opacity: appear }}>
              {shown}
            </div>
            <div style={{ position: 'absolute', left: x, width: slot, top: base + 8, height: labelH, textAlign: 'center', fontFamily: fonts.hand, fontSize: font * 1.2, color: p.theme.inkSoft, opacity: p.contentP, whiteSpace: 'nowrap' }}>
              {b.label}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

/** SVG arc path on a circle, clockwise from a0 to a1 degrees (0 = top). */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  let sweep = a1 - a0;
  if (sweep <= 0) sweep += 360;
  const pt = (a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a0 + Math.min(sweep, 359.9));
  return `M${x0},${y0} A${r},${r} 0 ${sweep > 180 ? 1 : 0},1 ${x1},${y1}`;
}

const RingBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const { r, labelSize, subSize } = p.g.m as any;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const spec = p.spec as Extract<PlacedElement, { type: 'ring' }>;
  const circle = roughPath(P.circle(cx, cy, r), { seed: p.id, roughness: p.theme.roughness * 0.8, strokeWidth: 4, bowing: 0.5 });
  const inner = roughPath(P.circle(cx, cy, r - 16), { seed: `${p.id}-in`, roughness: 0.6, strokeWidth: 1.5 });
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    const l = i % 6 === 0 ? 14 : 7;
    return P.line(cx + (r - l) * Math.sin(a), cy - (r - l) * Math.cos(a), cx + r * Math.sin(a), cy - r * Math.cos(a));
  });
  const tickPaths = roughMany(ticks, { seed: `${p.id}-t`, roughness: 0.5, strokeWidth: 2 });
  const fade = textFade(p);
  return (
    <>
      <Svg g={p.g}>
        <circle cx={cx} cy={cy} r={r} fill={withAlpha(p.color, 0.05 * clamp01(p.drawP * 1.5))} />
        {(p.spans ?? []).map((sp, i) => {
          const sweep = ((sp.a1 - sp.a0 + 360) % 360 || 360) * easeOutCubic(sp.p);
          if (sweep <= 0.5) return null;
          return (
            <g key={i} opacity={sp.o}>
              <path d={arcPath(cx, cy, r, sp.a0, sp.a0 + sweep)} fill="none" stroke={withAlpha(sp.color, 0.28)} strokeWidth={30} strokeLinecap="round" />
              <path d={arcPath(cx, cy, r, sp.a0, sp.a0 + sweep)} fill="none" stroke={sp.color} strokeWidth={6} strokeLinecap="round" />
            </g>
          );
        })}
        <Strokes paths={circle} progress={p.drawP} color={p.stroke} width={4} />
        <Strokes paths={inner} progress={clamp01(p.drawP * 1.3 - 0.3)} color={withAlpha(p.color, 0.35)} width={1.5} dash="4 10" />
        <Strokes paths={tickPaths} progress={clamp01(p.drawP * 1.2 - 0.2)} color={withAlpha(p.color, 0.7)} width={2} />
        {/* clockwise hint */}
        <path d={arcPath(cx, cy, r + 26, 20, 50)} fill="none" stroke={withAlpha(p.theme.ink, 0.35 * p.contentP)} strokeWidth={2.5} strokeDasharray="6 7" />
      </Svg>
      <div style={{ position: 'absolute', left: cx - 200, width: 400, top: cy - labelSize * 0.9, textAlign: 'center', opacity: p.contentP * fade }}>
        {spec.label ? <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: labelSize, color: p.theme.ink, lineHeight: 1.1 }}>{spec.label}</div> : null}
        {spec.sub ? <div style={{ fontFamily: fonts.mono, fontSize: subSize, color: p.color, marginTop: 6 }}>{spec.sub}</div> : null}
      </div>
    </>
  );
};

const MarkerBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  const s = loc(p.g, p.g.shape);
  const { kind, half, lab, size, font } = p.g.m as any;
  const spec = p.spec as Extract<PlacedElement, { type: 'marker' }>;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const pop = sp(p.frame, p.shownAt, p.fps, { damping: 11, stiffness: 170 });
  const L = { x: lab.x - p.g.box.x + PAD, y: lab.y - p.g.box.y + PAD };
  let body: React.ReactNode;
  if (kind === 'key') {
    body = (
      <>
        <circle cx={cx} cy={cy} r={half + 8} fill={withAlpha(p.color, 0.18)} />
        <circle cx={cx} cy={cy} r={half} fill={p.color} stroke={p.theme.bg} strokeWidth={3} />
      </>
    );
  } else {
    const d = P.rrect(cx - half, cy - half, 2 * half, 2 * half, kind === 'vnode' ? 8 : 12);
    const paths = roughPath(d, { seed: p.id, roughness: p.theme.roughness, strokeWidth: 3 });
    body = (
      <>
        <path d={d} fill={kind === 'vnode' ? withAlpha(p.color, 0.12) : p.theme.bg} />
        <path d={d} fill={withAlpha(p.color, kind === 'vnode' ? 0.06 : 0.22)} />
        <Strokes paths={paths} progress={Math.max(p.drawP, 0.001)} color={p.stroke} width={3} dash={kind === 'vnode' ? '7 6' : undefined} />
        {kind === 'server'
          ? [-0.38, 0, 0.38].map((t, i) => (
              <g key={i} opacity={p.contentP}>
                <circle cx={cx - half * 0.5} cy={cy + t * half * 1.1} r={3.2} fill={p.theme.colors.green} />
                <line x1={cx - half * 0.25} x2={cx + half * 0.55} y1={cy + t * half * 1.1} y2={cy + t * half * 1.1} stroke={withAlpha(p.color, 0.7)} strokeWidth={2.5} strokeLinecap="round" />
              </g>
            ))
          : null}
      </>
    );
  }
  return (
    <>
      <Svg g={p.g}>
        <g transform={`translate(${cx} ${cy}) scale(${0.3 + 0.7 * pop}) translate(${-cx} ${-cy})`}>{body}</g>
      </Svg>
      {spec.label ? (
        <div style={{ position: 'absolute', left: L.x, top: L.y, width: lab.w, height: lab.h, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', fontFamily: font === 'mono' ? fonts.mono : fonts.display, fontWeight: 700, fontSize: size, color: kind === 'key' ? p.color : p.theme.ink, opacity: p.contentP * textFade(p) }}>
          {spec.label}
        </div>
      ) : null}
    </>
  );
};

export const ElementBody: React.FC<{ p: BodyProps }> = ({ p }) => {
  switch (p.spec.type) {
    case 'ring': return <RingBody p={p} />;
    case 'marker': return <MarkerBody p={p} />;
    case 'node': return <NodeBody p={p} />;
    case 'db': return <DbBody p={p} />;
    case 'server': return <ServerBody p={p} />;
    case 'client': return <ClientBody p={p} />;
    case 'queue': return <QueueBody p={p} />;
    case 'table': return <TableBody p={p} />;
    case 'code': return <CodeBody p={p} />;
    case 'list': return <ListBody p={p} />;
    case 'chat': return <ChatBody p={p} />;
    case 'text': return (p.spec as any).style === 'stamp' ? <StampBody p={p} /> : <TextBody p={p} />;
    case 'chip': return <ChipBody p={p} />;
    case 'note': return <NoteBody p={p} />;
    case 'bars': return <BarsBody p={p} />;
  }
};

/** A red pen stroke drawn across the shape: this no longer works. */
export const StrikeLine: React.FC<{ g: Geometry; theme: Theme; frame: number; at: number; seed: string }> = ({ g, theme, frame, at, seed }) => {
  const s = loc(g, g.shape);
  const paths = roughPath(`M${s.x - 14},${s.y + s.h * 0.62} L${s.x + s.w + 14},${s.y + s.h * 0.38}`, { seed: `${seed}-strike`, roughness: 1.6, strokeWidth: 7 });
  return (
    <svg width={g.box.w + PAD * 2} height={g.box.h + PAD * 2} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <Strokes paths={paths} progress={easeOutCubic(prog(frame, at, 10))} color={theme.colors.red} width={7} />
    </svg>
  );
};

/** Check / cross / warn badge at the top-right of the shape. */
export const MarkBadge: React.FC<{ kind: 'check' | 'cross' | 'warn'; g: Geometry; theme: Theme; frame: number; fps: number; at: number; off: number | null; seed: string }> = ({ kind, g, theme, frame, fps, at, off, seed }) => {
  const s = loc(g, g.shape);
  const r = 26 * g.k;
  // Ring markers: badge sits on the inner side of the ring (labels are outside); others: top-right corner.
  const dir = g.m?.lab ? (g.m as any).dir as { x: number; y: number } | undefined : undefined;
  const cx = dir ? s.x + s.w / 2 - dir.x * (s.w / 2 + r * 0.9) : s.x + s.w - r * 0.3;
  const cy = dir ? s.y + s.h / 2 - dir.y * (s.h / 2 + r * 0.9) : s.y + r * 0.3;
  const pop = sp(frame, at, fps, { damping: 10, stiffness: 180 });
  const out = off !== null ? 1 - prog(frame, off, 8) : 1;
  const c = kind === 'check' ? theme.colors.green : kind === 'cross' ? theme.colors.red : theme.colors.yellow;
  const ds = kind === 'check' ? [P.check(cx, cy, r)] : kind === 'cross' ? P.cross(cx, cy, r * 0.8) : [P.triangle(cx, cy, r * 1.1)];
  const paths = roughMany(ds, { seed: `${seed}-mk-${kind}`, roughness: 1.2, strokeWidth: 5 });
  return (
    <svg width={g.box.w + PAD * 2} height={g.box.h + PAD * 2} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: out }}>
      <g transform={`translate(${cx} ${cy}) scale(${pop}) translate(${-cx} ${-cy})`}>
        <circle cx={cx} cy={cy} r={r} fill={theme.bg} stroke={c} strokeWidth={3} />
        <Strokes paths={paths} progress={prog(frame, at + 3, 10)} color={c} width={5} />
        {kind === 'warn' ? <text x={cx} y={cy + r * 0.32} textAnchor="middle" fontFamily={fonts.display} fontWeight={700} fontSize={r * 0.9} fill={c} opacity={prog(frame, at + 8, 6)}>!</text> : null}
      </g>
    </svg>
  );
};
