/** The title-screen designs. Layout and colours come from engine/title.ts; this file only draws and animates them. */
import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import type { PlanScene, RenderPlan } from '../engine/plan';
import { bandColors, keywordIndex, titleLayout, type TitleLayout } from '../engine/title';
import { withAlpha, type Theme } from '../engine/theme';
import { P, Strokes, roughPath } from './sketch';
import { clamp01, easeOutCubic, fonts, lerp, prog, sp } from './anim';

interface Props { plan: RenderPlan; scene: PlanScene; frame: number; theme: Theme }

/** Words spring in one by one. `hot` is the emphasised word's index in the whole title. */
const Words: React.FC<{ l: TitleLayout; frame: number; fps: number; color: string; hot?: { index: number; color: string }; start?: number }> = ({ l, frame, fps, color, hot, start = 8 }) => {
  let wi = 0;
  return (
    <>
      {l.lines.map((ln, li) => (
        <div key={li} style={{ position: 'absolute', left: l.left, width: l.width, top: l.blockTop + li * l.lineH, textAlign: l.align, whiteSpace: 'nowrap' }}>
          {ln.split(' ').map((w, i) => {
            const index = wi++;
            const s = sp(frame, start + index * 3, fps, { damping: 14, stiffness: 120 });
            return (
              <span key={i} style={{ display: 'inline-block', marginRight: l.size * 0.25, fontFamily: fonts.display, fontWeight: 700, fontSize: l.size, lineHeight: `${l.lineH}px`, color: hot?.index === index ? hot.color : color, opacity: clamp01(s * 1.4), transform: `translateY(${(1 - s) * 34}px)` }}>
                {w}
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
};

const Kicker: React.FC<{ l: TitleLayout; text?: string; frame: number; color: string }> = ({ l, text, frame, color }) => (text && l.kickerTop !== undefined ? (
  <div style={{ position: 'absolute', left: l.left, width: l.width, top: l.kickerTop, textAlign: l.align, fontFamily: fonts.mono, fontWeight: 700, fontSize: l.kickerSize, letterSpacing: '0.26em', color, opacity: prog(frame, 2, 14) }}>
    {text.toUpperCase()}
  </div>
) : null);

const Subtitle: React.FC<{ l: TitleLayout; frame: number; theme: Theme; start?: number }> = ({ l, frame, theme, start = 26 }) => (
  <>
    {l.subTop !== undefined ? l.subLines.map((s, i) => (
      <div key={i} style={{ position: 'absolute', left: l.left, width: l.width, top: l.subTop! + i * l.subSize * 1.3, textAlign: l.align, whiteSpace: 'nowrap', fontFamily: fonts.hand, fontSize: l.subSize, lineHeight: `${l.subSize * 1.3}px`, color: theme.inkSoft, opacity: prog(frame, start + i * 3, 16) }}>
        {s}
      </div>
    )) : null}
  </>
);

/** Topic icon inside a hand-drawn ring, with dots slowly circling so a longer opening never sits still. */
const Hero: React.FC<Props & { l: TitleLayout }> = ({ plan, scene, frame, theme, l }) => {
  const t = scene.title!;
  const c = { x: plan.width / 2, y: l.iconTop! + l.iconD / 2 };
  const r = l.iconD / 2;
  const ring = roughPath(P.rrect(c.x - r, c.y - r, r * 2, r * 2, r), { seed: `${scene.id}-ring`, roughness: 1.3, strokeWidth: 4 });
  const pop = sp(frame, 4, plan.fps, { damping: 11, stiffness: 130 });
  const orbit = frame * 0.018;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: c.x - r * 2.1, top: c.y - r * 2.1, width: r * 4.2, height: r * 4.2, background: `radial-gradient(circle, ${withAlpha(theme.colors.yellow, 0.16)} 0%, transparent 62%)` }} />
      <svg width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Strokes paths={ring} progress={easeOutCubic(prog(frame, 2, 22))} color={theme.colors.yellow} width={4} />
        {[0, 1, 2].map((i) => {
          const a = orbit + (i * Math.PI * 2) / 3;
          return <circle key={i} cx={c.x + Math.cos(a) * (r + 26)} cy={c.y + Math.sin(a) * (r + 26)} r={i === 0 ? 10 : 6} fill={i === 1 ? theme.colors.cyan : theme.colors.yellow} opacity={prog(frame, 18, 12)} />;
        })}
      </svg>
      {t.icon ? <Img src={t.icon} style={{ position: 'absolute', left: c.x - r * 0.58, top: c.y - r * 0.58, width: r * 1.16, height: r * 1.16, transform: `scale(${pop})` }} /> : null}
      <Kicker l={l} text={t.kicker} frame={frame} color={theme.colors.yellow} />
      <Words l={l} frame={frame} fps={plan.fps} color={theme.ink} start={14} />
      <Subtitle l={l} frame={frame} theme={theme} start={34} />
    </AbsoluteFill>
  );
};

/** Poster type filling the screen, with one word marked in colour and a marker stroke under it. */
const BigType: React.FC<Props & { l: TitleLayout }> = ({ plan, scene, frame, theme, l }) => {
  const t = scene.title!;
  const rule = roughPath(`M${l.left},${l.blockTop - 22} L${l.left + Math.min(l.width, 260)},${l.blockTop - 26}`, { seed: `${scene.id}-r`, roughness: 1.2, strokeWidth: 8 });
  return (
    <AbsoluteFill>
      <Kicker l={l} text={t.kicker} frame={frame} color={theme.colors.yellow} />
      <svg width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Strokes paths={rule} progress={easeOutCubic(prog(frame, 4, 16))} color={theme.colors.yellow} width={8} />
      </svg>
      <Words l={l} frame={frame} fps={plan.fps} color={theme.ink} hot={{ index: keywordIndex(t.title), color: theme.colors.yellow }} />
      <Subtitle l={l} frame={frame} theme={theme} />
    </AbsoluteFill>
  );
};

/** The topic's acronym, huge and pale, drifting slowly above the title. */
const Monogram: React.FC<Props & { l: TitleLayout }> = ({ plan, scene, frame, theme, l }) => {
  const t = scene.title!;
  const g = l.ghost!;
  const reveal = easeOutCubic(prog(frame, 0, 26));
  const drift = lerp(8, -8, clamp01(frame / Math.max(1, scene.durationInFrames)));
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', width: '100%', top: g.y + drift, textAlign: 'center', whiteSpace: 'nowrap', fontFamily: fonts.display, fontWeight: 700, fontSize: g.size, lineHeight: 1, color: withAlpha(theme.colors.yellow, 0.3), opacity: reveal, transform: `scale(${lerp(1.06, 1, reveal)})` }}>
        {g.text}
      </div>
      <Kicker l={l} text={t.kicker} frame={frame} color={theme.colors.yellow} />
      <Words l={l} frame={frame} fps={plan.fps} color={theme.ink} start={12} />
      <Subtitle l={l} frame={frame} theme={theme} start={32} />
    </AbsoluteFill>
  );
};

/** Title inside a hand-drawn double frame, set slightly askew like a rubber stamp. */
const Stamp: React.FC<Props & { l: TitleLayout }> = ({ plan, scene, frame, theme, l }) => {
  const t = scene.title!;
  const b = l.panel!;
  const outer = roughPath(P.rrect(b.x, b.y, b.w, b.h, 18), { seed: `${scene.id}-o`, roughness: 1.5, strokeWidth: 5 });
  const inner = roughPath(P.rrect(b.x + 16, b.y + 16, b.w - 32, b.h - 32, 12), { seed: `${scene.id}-i`, roughness: 1.2, strokeWidth: 2 });
  const press = sp(frame, 2, plan.fps, { damping: 12, stiffness: 160 });
  return (
    <AbsoluteFill>
      <Kicker l={l} text={t.kicker} frame={frame} color={theme.colors.yellow} />
      <div style={{ position: 'absolute', inset: 0, transform: `rotate(-1.4deg) scale(${lerp(1.08, 1, press)})`, transformOrigin: `${b.x + b.w / 2}px ${b.y + b.h / 2}px` }}>
        <svg width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          <path d={P.rrect(b.x, b.y, b.w, b.h, 18)} fill={withAlpha(theme.colors.yellow, 0.07 * press)} />
          <Strokes paths={outer} progress={easeOutCubic(prog(frame, 2, 20))} color={theme.colors.yellow} width={5} />
          <Strokes paths={inner} progress={easeOutCubic(prog(frame, 10, 20))} color={theme.colors.yellow} width={2} />
        </svg>
        <Words l={l} frame={frame} fps={plan.fps} color={theme.ink} start={12} />
      </div>
      <Subtitle l={l} frame={frame} theme={theme} start={32} />
    </AbsoluteFill>
  );
};

/** A full-width colour band sweeps across and the title lands on it. */
const Band: React.FC<Props & { l: TitleLayout }> = ({ plan, scene, frame, theme, l }) => {
  const t = scene.title!;
  const b = l.panel!;
  const { band, text } = bandColors(theme, t.title);
  const sweep = easeOutCubic(prog(frame, 2, 18));
  const tilt = 26;
  return (
    <AbsoluteFill>
      <Kicker l={l} text={t.kicker} frame={frame} color={theme.colors.yellow} />
      <svg width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0 }}>
        <polygon points={`0,${b.y + tilt} ${plan.width * sweep},${b.y} ${plan.width * sweep},${b.y + b.h - tilt} 0,${b.y + b.h}`} fill={band} />
      </svg>
      <Words l={l} frame={frame} fps={plan.fps} color={text} start={12} />
      <Subtitle l={l} frame={frame} theme={theme} start={30} />
    </AbsoluteFill>
  );
};

const DESIGNS = { hero: Hero, bigtype: BigType, monogram: Monogram, stamp: Stamp, band: Band } as const;

export const TitleDesign: React.FC<Props> = (props) => {
  const { plan, scene, frame } = props;
  const t = scene.title!;
  const style = t.style && t.style !== 'classic' ? t.style : 'bigtype';
  const Design = DESIGNS[style];
  const l = titleLayout(style, t, plan.format);
  // A slow push-in keeps the screen alive however long the opening line runs.
  const push = 1 + 0.03 * clamp01(frame / Math.max(1, scene.durationInFrames));
  return (
    <AbsoluteFill style={{ transform: `scale(${push})` }}>
      <Design {...props} l={l} />
    </AbsoluteFill>
  );
};
