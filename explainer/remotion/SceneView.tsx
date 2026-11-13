/**
 * SceneView renders ONE scene at an explicit frame (pure: no useCurrentFrame).
 * That lets the same code drive the video, Studio, and the QA contact sheets.
 */
import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import type { PlanElement, PlanScene, RenderPlan, SceneState } from '../engine/plan';
import { effectiveSpec, foldScene } from '../engine/plan';
import { CAPTION, CONTENT, HEADING, arrowEnd, arrowGeometry, footprint, groupRect, quadPoint, quadTangent, wrapText, textWidth, OVERLAY_TEXT, arrowLabelRect, arrowLabelSide, type Format, type Geometry, type Pt, type Rect } from '../engine/layout';
import { THEMES, withAlpha, type Theme } from '../engine/theme';
import { isPlaced } from '../engine/compile';
import { ElementBody, MarkBadge, PAD, StrikeLine } from './elements';
import { P, Strokes, roughPath } from './sketch';
import { Background } from './backgrounds';
import { TitleDesign } from './titlecards';
import { Captions } from './captions';
import { clamp01, easeInOutCubic, easeOutCubic, fontVars, fonts, lerp, mixHex, prog, sp } from './anim';

const FormatContext = createContext<Format>('16:9');

interface Vis {
  el: PlanElement;
  g?: Geometry;
  opacity: number;
  scale: number;
  shakeX: number;
  stroke: string;
  glow: number;
  glowColor: string;
  drawP: number;
  contentP: number;
  hl: { intensity: number; color: string; row?: number };
}

export const SceneView: React.FC<{ plan: RenderPlan; scene: PlanScene; frame: number; showCaptions?: boolean }> = ({ plan, scene, frame, showCaptions = true }) => {
  const theme = THEMES[plan.theme];
  const fps = plan.fps;
  const fadeIn = scene.fadeIn ? easeOutCubic(prog(frame, 0, 10)) : 1;
  const fadeOut = scene.fadeOut ? 1 - prog(frame, scene.durationInFrames - 9, 9) : 1;
  return (
    <FormatContext.Provider value={plan.format}>
    <AbsoluteFill style={{ overflow: 'hidden', ...fontVars(theme) }}>
      <Background theme={theme} frame={frame} seed={plan.id} width={plan.width} height={plan.height} />
      <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
        {scene.kind === 'title' ? (!scene.title?.style || scene.title.style === 'classic' ? <TitleCard plan={plan} scene={scene} frame={frame} theme={theme} /> : <TitleDesign plan={plan} scene={scene} frame={frame} theme={theme} />) : <Board plan={plan} scene={scene} frame={frame} theme={theme} />}
      </AbsoluteFill>
      {plan.brandKit ? <Img src={staticFile(plan.brandKit.mark)} style={{ position: 'absolute', ...(plan.format === '9:16' ? { left: 46, top: 58 } : { right: 48, top: 40 }), width: plan.format === '9:16' ? 132 : 118, opacity: 0.96 }} /> : null}
      {plan.brand ? (
        <div style={{ position: 'absolute', right: 44, top: 36, fontFamily: fonts.mono, fontWeight: 700, fontSize: 20, letterSpacing: '0.12em', color: theme.inkFaint }}>{plan.brand}</div>
      ) : null}
      {showCaptions && plan.captions !== 'off' ? <Captions plan={plan} scene={scene} frame={frame} theme={theme} /> : null}
    </AbsoluteFill>
    </FormatContext.Provider>
  );
};

// ─── Title card ─────────────────────────────────────────────────────────────────

const TitleCard: React.FC<{ plan: RenderPlan; scene: PlanScene; frame: number; theme: Theme }> = ({ plan, scene, frame, theme }) => {
  const t = scene.title!;
  const vertical = plan.format === '9:16';
  const size = vertical ? 92 : 112;
  const lines = wrapText(t.title, size, 'display', vertical ? 920 : 1560);
  const cy = plan.height / 2;
  const blockH = lines.length * size * 1.15;
  const top = cy - blockH / 2;
  let wi = 0;
  const lineW = Math.max(...lines.map((l) => textWidth(l, size, 'display')));
  const under = roughPath(`M${plan.width / 2 - lineW * 0.42},${top + blockH + 24} Q${plan.width / 2},${top + blockH + 40} ${plan.width / 2 + lineW * 0.42},${top + blockH + 18}`, { seed: `${scene.id}-u`, roughness: 1.6, strokeWidth: 7 });
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: plan.width / 2 - 700, top: cy - 520, width: 1400, height: 1040, background: `radial-gradient(ellipse at center, ${withAlpha(theme.colors.yellow, 0.08)} 0%, transparent 60%)` }} />
      {t.kicker ? (
        <div style={{ position: 'absolute', width: '100%', top: top - 86, textAlign: 'center', fontFamily: fonts.mono, fontWeight: 700, fontSize: vertical ? 30 : 32, letterSpacing: '0.32em', color: theme.colors.yellow, opacity: easeOutCubic(prog(frame, 2, 14)), transform: `translateY(${(1 - easeOutCubic(prog(frame, 2, 14))) * 10}px)` }}>
          {t.kicker.toUpperCase()}
        </div>
      ) : null}
      {lines.map((ln, li) => (
        <div key={li} style={{ position: 'absolute', width: '100%', top: top + li * size * 1.15, textAlign: 'center', whiteSpace: 'nowrap' }}>
          {ln.split(' ').map((w, i) => {
            const s = sp(frame, 6 + (wi++) * 3, plan.fps, { damping: 14, stiffness: 120 });
            return (
              <span key={i} style={{ display: 'inline-block', marginRight: size * 0.25, fontFamily: fonts.display, fontWeight: 700, fontSize: size, lineHeight: 1.15, color: theme.ink, opacity: clamp01(s * 1.4), transform: `translateY(${(1 - s) * 40}px)` }}>
                {w}
              </span>
            );
          })}
        </div>
      ))}
      <svg width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Strokes paths={under} progress={easeOutCubic(prog(frame, 16, 18))} color={theme.colors.yellow} width={7} />
      </svg>
      {t.subtitle ? (
        <div style={{ position: 'absolute', left: plan.width / 2 - (vertical ? 460 : 700), width: vertical ? 920 : 1400, top: top + blockH + 70, textAlign: 'center', fontFamily: fonts.hand, fontSize: vertical ? 40 : 44, color: theme.inkSoft, opacity: easeOutCubic(prog(frame, 22, 16)) }}>
          {t.subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ─── Board ──────────────────────────────────────────────────────────────────────

function animPos(id: string, st: SceneState, frame: number, fps: number): Pt | undefined {
  const s = st.els[id];
  if (!s?.pos) return undefined;
  let pos = s.pos;
  if (s.movedAt > -999 && s.prevPos) {
    const t = sp(frame, s.movedAt, fps, { damping: 20, stiffness: 80, mass: 1 });
    pos = { x: lerp(s.prevPos.x, s.pos.x, t), y: lerp(s.prevPos.y, s.pos.y, t) };
  }
  if (s.emergeFrom && s.shownAt !== null && s.shownAt > -999) {
    const src = st.els[s.emergeFrom]?.pos;
    if (src) {
      const t = sp(frame, s.shownAt, fps, { damping: 17, stiffness: 90 });
      pos = { x: lerp(src.x, pos.x, t), y: lerp(src.y, pos.y, t) };
    }
  }
  return pos;
}

function computeVis(scene: PlanScene, st: SceneState, frame: number, fps: number, theme: Theme): Map<string, Vis> {
  const out = new Map<string, Vis>();
  for (const el of scene.elements) {
    const s = st.els[el.id];
    if (s.shownAt === null) continue;
    let opacity = 1;
    if (!s.visible) {
      if (s.hiddenAt === null) continue;
      const e = prog(frame, s.hiddenAt, 10);
      if (e >= 1) continue;
      opacity *= 1 - e;
    }
    const enter = sp(frame, s.shownAt, fps, { damping: 20, stiffness: 120 });
    opacity *= clamp01(enter * 1.6);
    if (s.dimAt > -999) {
      const d = prog(frame, s.dimAt, 12);
      opacity *= s.dimmed ? lerp(1, 0.22, d) : lerp(0.22, 1, d);
    }
    const emerging = !!(s.emergeFrom && s.shownAt > -999);
    let scale = emerging ? 0.4 + 0.6 * sp(frame, s.shownAt, fps, { damping: 17, stiffness: 90 }) : 0.9 + 0.1 * enter;
    for (const p of s.pulses) {
      const u = prog(frame, p, 18);
      if (u > 0 && u < 1) scale *= 1 + Math.sin(Math.PI * u) * 0.09;
    }
    let shakeX = 0;
    let alarm = 0;
    if (s.shake && frame >= s.shake.at) {
      const amp = frame <= s.shake.until ? 1 : 1 - prog(frame, s.shake.until, 12);
      shakeX = Math.sin((frame - s.shake.at) * 1.9) * 7 * amp;
      alarm = amp * clamp01((frame - s.shake.at) / 4);
    }
    const hlI = s.hl ? sp(frame, s.hl.at, fps, { damping: 22, stiffness: 170 }) : s.hlOffAt !== null ? 1 - prog(frame, s.hlOffAt, 10) : 0;
    const hlSrc = s.hl ?? s.hlLast;
    const hlColor = hlSrc?.color ?? theme.colors.yellow;
    const rowHl = hlSrc?.row !== undefined;
    let stroke = mixHex(el.color, hlColor, rowHl ? hlI * 0.4 : hlI);
    stroke = mixHex(stroke, theme.colors.red, alarm);
    const pos = animPos(el.id, st, frame, fps);
    const g = isPlaced(el.spec) && pos ? footprint(effectiveSpec(el, s), pos) : undefined;
    out.set(el.id, {
      el,
      g,
      opacity,
      scale,
      shakeX,
      stroke,
      glow: Math.max(rowHl ? hlI * 0.35 : hlI, alarm),
      glowColor: alarm > hlI ? theme.colors.red : hlColor,
      drawP: s.shownAt <= -999 ? 1 : easeOutCubic(prog(frame, s.shownAt, 22)),
      contentP: s.shownAt <= -999 ? 1 : easeOutCubic(prog(frame, s.shownAt + 8, 14)),
      hl: { intensity: hlI, color: hlColor, row: hlSrc?.row },
    });
  }
  return out;
}

function endpointRect(id: string, vis: Map<string, Vis>, scene: PlanScene): Rect | null {
  const v = vis.get(id);
  if (!v) return null;
  if (v.el.spec.type === 'group') {
    const kids = v.el.spec.contains.map((c) => vis.get(c)?.g?.box).filter(Boolean) as Rect[];
    return kids.length ? groupRect(kids) : null;
  }
  return v.g ? (v.g.label ? arrowEnd(v.g) : v.g.shape) : null;
}

const onTop = (spec: any) => spec.type === 'chip' || spec.style === 'stamp';

const Board: React.FC<{ plan: RenderPlan; scene: PlanScene; frame: number; theme: Theme }> = ({ plan, scene, frame, theme }) => {
  const fps = plan.fps;
  const st = foldScene(scene, frame);
  const vis = computeVis(scene, st, frame, fps, theme);
  const content = CONTENT[plan.format];

  // camera
  const camFor = (cam: SceneState['camera']) => {
    if (!cam) return { z: 1, cx: plan.width / 2, cy: content.y + content.h / 2 };
    const boxes = cam.targets.map((t) => vis.get(t)?.g?.box).filter(Boolean) as Rect[];
    if (!boxes.length) return { z: 1, cx: plan.width / 2, cy: content.y + content.h / 2 };
    const x1 = Math.min(...boxes.map((b) => b.x)), y1 = Math.min(...boxes.map((b) => b.y));
    const x2 = Math.max(...boxes.map((b) => b.x + b.w)), y2 = Math.max(...boxes.map((b) => b.y + b.h));
    const fit = Math.min((content.w * 0.85) / (x2 - x1), (content.h * 0.85) / (y2 - y1));
    const z = cam.zoom ?? Math.min(1.7, Math.max(1.15, fit));
    return { z, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  };
  const cNow = camFor(st.camera);
  const cPrev = camFor(st.prevCamera);
  const ct = sp(frame, st.cameraAt, fps, { damping: 24, stiffness: 60, mass: 1 });
  const z = lerp(cPrev.z, cNow.z, ct), ccx = lerp(cPrev.cx, cNow.cx, ct), ccy = lerp(cPrev.cy, cNow.cy, ct);
  const anchorX = plan.width / 2, anchorY = content.y + content.h / 2;
  const camTransform = `translate(${anchorX - ccx * z}px, ${anchorY - ccy * z}px) scale(${z})`;

  const groups = [...vis.values()].filter((v) => v.el.spec.type === 'group');
  const arrows = [...vis.values()].filter((v) => v.el.spec.type === 'arrow');
  // Chips travel over the diagram, so they draw last.
  const placed = [...vis.values()].filter((v) => v.g).sort((a, b) => Number(onTop(a.el.spec)) - Number(onTop(b.el.spec)));

  return (
    <AbsoluteFill>
      <Heading plan={plan} scene={scene} frame={frame} theme={theme} />
      <AbsoluteFill style={{ transform: camTransform, transformOrigin: '0 0' }}>
        <svg width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          {groups.map((v) => <GroupShape key={v.el.id} v={v} vis={vis} scene={scene} theme={theme} />)}
          {arrows.map((v) => <ArrowShape key={v.el.id} v={v} vis={vis} scene={scene} theme={theme} frame={frame} st={st} />)}
        </svg>
        {groups.map((v) => <GroupLabel key={v.el.id} v={v} vis={vis} scene={scene} theme={theme} />)}
        {placed.map((v) => {
          const g = v.g!;
          const s = st.els[v.el.id];
          const ox = g.box.x - PAD, oy = g.box.y - PAD;
          const scx = g.shape.x + g.shape.w / 2 - ox, scy = g.shape.y + g.shape.h / 2 - oy;
          const prevValues = s.prevOv.values ?? (v.el.spec.type === 'bars' && s.setAt > -999 ? (v.el.spec as any).bars.map((b: any) => b.value) : undefined);
          const angleOf = (id: string) => (scene.elements.find((e) => e.id === id)?.spec as any)?.angle ?? 0;
          const spans = v.el.spec.type === 'ring'
            ? s.spans
                .map((sp) => {
                  const end = sp.off ?? sp.until;
                  const o = end !== undefined && frame >= end ? 1 - prog(frame, end, 10) : 1;
                  return { a0: angleOf(sp.from), a1: angleOf(sp.to), color: sp.color ?? theme.colors.yellow, p: prog(frame, sp.at, 18), o };
                })
                .filter((sp) => sp.o > 0 && sp.p > 0)
            : undefined;
          return (
            <div
              key={v.el.id}
              style={{
                position: 'absolute', left: ox, top: oy, width: g.box.w + PAD * 2, height: g.box.h + PAD * 2,
                opacity: v.opacity, transform: `translateX(${v.shakeX}px) scale(${v.scale})`, transformOrigin: `${scx}px ${scy}px`,
                filter: v.glow > 0.02 ? `drop-shadow(0 0 ${16 * v.glow}px ${withAlpha(v.glowColor, 0.75 * v.glow)})` : undefined,
              }}
            >
              <ElementBody
                p={{
                  id: v.el.id, spec: effectiveSpec(v.el, s), g, theme, frame, fps, color: v.el.color, stroke: v.stroke, icon: v.el.icon,
                  drawP: v.drawP, contentP: v.contentP, hl: v.hl, shownAt: s.shownAt ?? 0, setAt: s.setAt, revealAt: s.revealAt, prevValues, spans,
                }}
              />
              {s.struckAt !== null ? <StrikeLine g={g} theme={theme} frame={frame} at={s.struckAt} seed={v.el.id} /> : null}
              {s.mark || s.markLast ? (
                <MarkBadge kind={(s.mark ?? s.markLast)!.kind} g={g} theme={theme} frame={frame} fps={fps} at={(s.mark ?? s.markLast)!.at} off={s.mark ? null : s.markOffAt} seed={v.el.id} />
              ) : null}
            </div>
          );
        })}
        <Flows scene={scene} vis={vis} frame={frame} theme={theme} plan={plan} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * A group's outline covers its visible children and where the others will appear. A boundary shown before its contents
 * ("A VPC…") is drawn right away at its full size, so it neither stays blank while the narrator talks nor jumps as they arrive.
 */
function groupBoxes(spec: Extract<PlanElement['spec'], { type: 'group' }>, vis: Map<string, Vis>, scene: PlanScene): Rect[] {
  return spec.contains.flatMap((c) => {
    const shown = vis.get(c)?.g?.box;
    if (shown) return [shown];
    const el = scene.elements.find((e) => e.id === c);
    return el?.pos && isPlaced(el.spec) ? [footprint(el.spec as any, el.pos).box] : [];
  });
}

const GroupShape: React.FC<{ v: Vis; vis: Map<string, Vis>; scene: PlanScene; theme: Theme }> = ({ v, vis, scene, theme }) => {
  const spec = v.el.spec as Extract<PlanElement['spec'], { type: 'group' }>;
  const kids = groupBoxes(spec, vis, scene);
  if (!kids.length) return null;
  const r = groupRect(kids);
  const d = P.rrect(r.x, r.y, r.w, r.h, 24);
  const paths = roughPath(d, { seed: v.el.id, roughness: theme.roughness, strokeWidth: 2.2 });
  return (
    <g opacity={v.opacity}>
      <path d={d} fill={withAlpha(v.el.color, 0.045 * v.drawP)} />
      <Strokes paths={paths} progress={v.drawP} color={withAlpha(v.stroke, 0.85)} width={2.2} dash="12 10" />
    </g>
  );
};

const GroupLabel: React.FC<{ v: Vis; vis: Map<string, Vis>; scene: PlanScene; theme: Theme }> = ({ v, vis, scene, theme }) => {
  const spec = v.el.spec as Extract<PlanElement['spec'], { type: 'group' }>;
  const fontSize = OVERLAY_TEXT[useContext(FormatContext)].group;
  const kids = groupBoxes(spec, vis, scene);
  if (!kids.length) return null;
  const r = groupRect(kids);
  return (
    <div style={{ position: 'absolute', left: r.x + 18, top: r.y + 6, fontFamily: fonts.display, fontWeight: 700, fontSize, color: v.stroke, opacity: v.opacity * v.contentP, whiteSpace: 'nowrap' }}>
      {spec.label}
    </div>
  );
};

const ArrowShape: React.FC<{ v: Vis; vis: Map<string, Vis>; scene: PlanScene; theme: Theme; frame: number; st: SceneState }> = ({ v, vis, scene, theme }) => {
  const spec = v.el.spec as Extract<PlanElement['spec'], { type: 'arrow' }>;
  const a = endpointRect(spec.from, vis, scene);
  const b = endpointRect(spec.to, vis, scene);
  if (!a || !b) return null;
  const geo = arrowGeometry(a, b, spec.bend ?? 0);
  const format = useContext(FormatContext);
  const labelBox = arrowLabelRect(spec.label ?? '', geo, format, arrowLabelSide(v.el, scene.elements));
  const r = (n: number) => Math.round(n);
  const d = `M${r(geo.p0.x)},${r(geo.p0.y)} Q${r(geo.c.x)},${r(geo.c.y)} ${r(geo.p1.x)},${r(geo.p1.y)}`;
  const base = spec.color ? v.el.color : theme.inkSoft.startsWith('rgba') ? theme.ink : theme.inkSoft;
  const color = v.hl.intensity > 0 ? mixHex(spec.color ? v.el.color : theme.ink, v.hl.color, v.hl.intensity) : base;
  const width = 3 + v.hl.intensity * 1.5;
  const body = roughPath(d, { seed: v.el.id, roughness: 0.9, strokeWidth: width, bowing: 0.4 });
  const head = (tip: Pt, tan: Pt) => {
    const L = Math.hypot(tan.x, tan.y) || 1;
    const ux = tan.x / L, uy = tan.y / L;
    const s = 17;
    return `M${tip.x - ux * s - uy * s * 0.6},${tip.y - uy * s + ux * s * 0.6} L${tip.x},${tip.y} L${tip.x - ux * s + uy * s * 0.6},${tip.y - uy * s - ux * s * 0.6}`;
  };
  const heads = [head(geo.p1, quadTangent(geo.p0, geo.c, geo.p1, 1))];
  if (spec.both) {
    const t0 = quadTangent(geo.p0, geo.c, geo.p1, 0);
    heads.push(head(geo.p0, { x: -t0.x, y: -t0.y }));
  }
  const headP = clamp01((v.drawP - 0.75) / 0.25);
  const opacityBase = theme.dark && !spec.color ? 0.75 + 0.25 * v.hl.intensity : 1;
  return (
    <g opacity={v.opacity * opacityBase}>
      <Strokes paths={body} progress={v.drawP} color={color} width={width} dash={spec.style === 'dashed' ? '12 11' : undefined} />
      {heads.map((h, i) => (
        <path key={i} d={h} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={headP} />
      ))}
      {spec.label ? <ArrowLabel text={spec.label} at={{ x: labelBox.x + labelBox.w / 2, y: labelBox.y + labelBox.h / 2 }} theme={theme} opacity={v.contentP} color={v.hl.intensity > 0.5 ? v.hl.color : undefined} /> : null}
    </g>
  );
};

const ArrowLabel: React.FC<{ text: string; at: Pt; theme: Theme; opacity: number; color?: string }> = ({ text, at, theme, opacity, color }) => {
  const size = OVERLAY_TEXT[useContext(FormatContext)].arrow;
  const h = size * 1.56;
  const w = textWidth(text, size, 'hand') + 22;
  return (
    <g opacity={opacity}>
      <rect x={at.x - w / 2} y={at.y - h / 2} width={w} height={h} rx={h / 2} fill={theme.bg} stroke={withAlpha(color ?? theme.ink, 0.25)} strokeWidth={1.5} />
      <text x={at.x} y={at.y + size * 0.3} textAnchor="middle" fontFamily={fonts.hand} fontSize={size} fill={color ?? theme.inkSoft}>{text}</text>
    </g>
  );
};

// ─── Flows (data packets travelling along arrows) ───────────────────────────────

const SPEED = { slow: 13, normal: 21, fast: 32 } as const;

const Flows: React.FC<{ scene: PlanScene; vis: Map<string, Vis>; frame: number; theme: Theme; plan: RenderPlan }> = ({ scene, vis, frame, theme, plan }) => {
  const nodes: React.ReactNode[] = [];
  // keys travelling clockwise around a ring to their owner
  for (const a of scene.actions) {
    if (a.do !== 'travel' || a.frame > frame) continue;
    const from = vis.get(a.target!)?.el.spec as any;
    const to = vis.get(a.to)?.el.spec as any;
    const ring = from ? vis.get(from.ring) : undefined;
    if (!from || !to || !ring?.g) continue;
    const { cx, cy, r } = ring.g.m as { cx: number; cy: number; r: number };
    const sweep = ((to.angle - from.angle + 360) % 360) || 360;
    const dur = Math.min(70, Math.max(18, Math.round(((sweep * Math.PI) / 180) * r / SPEED[a.speed ?? 'normal'])));
    const t = frame - a.frame;
    if (t > dur + 14) continue;
    const color = a.hex ?? theme.colors.yellow;
    const at = (u: number) => {
      const ang = ((from.angle + sweep * easeInOutCubic(u)) * Math.PI) / 180;
      return { x: cx + r * Math.sin(ang), y: cy - r * Math.cos(ang) };
    };
    if (t <= dur) {
      const p = at(t / dur);
      for (let k = 4; k >= 1; k--) {
        const q = at(Math.max(0, (t - k * 1.8) / dur));
        nodes.push(<circle key={`tr-${a.stepIndex}-${k}`} cx={q.x} cy={q.y} r={10 - k * 1.6} fill={withAlpha(color, 0.16 * (5 - k))} />);
      }
      if (a.label) {
        const size = OVERLAY_TEXT[plan.format].packet;
        const h = size * 1.9;
        const w = textWidth(a.label, size, 'mono') + 26;
        nodes.push(
          <g key={`tv-${a.stepIndex}`} transform={`translate(${p.x} ${p.y})`}>
            <rect x={-w / 2 - 3} y={-h / 2 - 3} width={w + 6} height={h + 6} rx={h / 2 + 3} fill={withAlpha(color, 0.25)} />
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={color} />
            <text x={0} y={size * 0.36} textAnchor="middle" fontFamily={fonts.mono} fontWeight={700} fontSize={size} fill={theme.dark ? '#0B0F17' : '#FFFFFF'}>{a.label}</text>
          </g>,
        );
      } else {
        nodes.push(<circle key={`tvg-${a.stepIndex}`} cx={p.x} cy={p.y} r={20} fill={withAlpha(color, 0.22)} />, <circle key={`tvd-${a.stepIndex}`} cx={p.x} cy={p.y} r={10} fill={color} />);
      }
    } else {
      const u = (t - dur) / 14;
      const end = at(1);
      nodes.push(<circle key={`tb-${a.stepIndex}`} cx={end.x} cy={end.y} r={14 + u * 36} fill="none" stroke={color} strokeWidth={3 * (1 - u)} opacity={1 - u} />);
    }
  }
  for (const a of scene.actions) {
    if (a.do !== 'flow' || a.frame > frame) continue;
    const ids = a.reverse ? [...a.path].reverse() : a.path;
    const hops = ids.map((id) => {
      const v = vis.get(id);
      if (!v) return null;
      const spec = v.el.spec as any;
      const r1 = endpointRect(spec.from, vis, scene), r2 = endpointRect(spec.to, vis, scene);
      if (!r1 || !r2) return null;
      const g = arrowGeometry(r1, r2, spec.bend ?? 0);
      return a.reverse ? { p0: g.p1, c: g.c, p1: g.p0, len: g.length } : { p0: g.p0, c: g.c, p1: g.p1, len: g.length };
    });
    if (hops.some((h) => !h)) continue;
    const durs = hops.map((h) => Math.min(48, Math.max(12, Math.round(h!.len / SPEED[a.speed ?? 'normal']))));
    const total = durs.reduce((x, y) => x + y, 0);
    const color = a.hex ?? theme.colors.yellow;
    for (let j = 0; j < (a.count ?? 1); j++) {
      const t = frame - (a.frame + j * 9);
      if (t < 0 || t > total + 14) continue;
      const pointAt = (tt: number): Pt => {
        let acc = 0;
        for (let h = 0; h < hops.length; h++) {
          if (tt <= acc + durs[h] || h === hops.length - 1) {
            const u = easeInOutCubic((tt - acc) / durs[h]);
            const hp = hops[h]!;
            return quadPoint(hp.p0, hp.c, hp.p1, clamp01(u));
          }
          acc += durs[h];
        }
        return hops[0]!.p0;
      };
      if (t <= total) {
        const p = pointAt(t);
        const appear = clamp01(t / 4);
        for (let k = 3; k >= 1; k--) {
          const q = pointAt(Math.max(0, t - k * 1.6));
          nodes.push(<circle key={`${a.stepIndex}-${j}-tr${k}`} cx={q.x} cy={q.y} r={9 - k * 1.8} fill={withAlpha(color, 0.18 * (4 - k))} />);
        }
        if (a.label) {
          const size = OVERLAY_TEXT[plan.format].packet;
        const h = size * 1.9;
          const w = textWidth(a.label, size, 'mono') + 26;
          nodes.push(
            <g key={`${a.stepIndex}-${j}`} opacity={appear} transform={`translate(${p.x} ${p.y}) scale(${0.6 + 0.4 * appear})`}>
              <rect x={-w / 2 - 3} y={-h / 2 - 3} width={w + 6} height={h + 6} rx={h / 2 + 3} fill={withAlpha(color, 0.25)} />
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={color} />
              <text x={0} y={size * 0.36} textAnchor="middle" fontFamily={fonts.mono} fontWeight={700} fontSize={size} fill={theme.dark ? '#0B0F17' : '#FFFFFF'}>{a.label}</text>
            </g>,
          );
        } else {
          nodes.push(
            <g key={`${a.stepIndex}-${j}`} opacity={appear}>
              <circle cx={p.x} cy={p.y} r={20} fill={withAlpha(color, 0.22)} />
              <circle cx={p.x} cy={p.y} r={10} fill={color} />
            </g>,
          );
        }
      } else {
        const u = (t - total) / 14;
        const end = hops[hops.length - 1]!.p1;
        nodes.push(<circle key={`${a.stepIndex}-${j}-burst`} cx={end.x} cy={end.y} r={10 + u * 34} fill="none" stroke={color} strokeWidth={3 * (1 - u)} opacity={1 - u} />);
      }
    }
  }
  if (!nodes.length) return null;
  return (
    <svg width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      {nodes}
    </svg>
  );
};

// ─── Heading & captions ─────────────────────────────────────────────────────────

const Heading: React.FC<{ plan: RenderPlan; scene: PlanScene; frame: number; theme: Theme }> = ({ plan, scene, frame, theme }) => {
  if (!scene.heading) return null;
  const H = HEADING[plan.format];
  const p = scene.headingStatic ? 1 : easeOutCubic(prog(frame, 2, 14));
  const w = textWidth(scene.heading, H.size, 'display');
  const x0 = H.align === 'left' ? H.x : H.x - w / 2;
  const under = roughPath(`M${x0},${H.y + H.size * 0.62} L${x0 + Math.min(w, 220)},${H.y + H.size * 0.58}`, { seed: `${scene.id}-h`, roughness: 1.3, strokeWidth: 6 });
  return (
    <>
      <div style={{ position: 'absolute', left: H.align === 'left' ? H.x : 0, width: H.align === 'left' ? undefined : plan.width, top: H.y - H.size * 0.62, textAlign: H.align, fontFamily: fonts.display, fontWeight: 700, fontSize: H.size, color: theme.ink, opacity: p, transform: `translateY(${(1 - p) * 14}px)`, whiteSpace: 'nowrap' }}>
        {scene.heading}
      </div>
      <svg width={plan.width} height={H.y + 80} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Strokes paths={under} progress={scene.headingStatic ? 1 : easeOutCubic(prog(frame, 10, 14))} color={theme.colors.yellow} width={6} />
      </svg>
    </>
  );
};

