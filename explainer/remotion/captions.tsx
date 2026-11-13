/**
 * Caption designs. Each reads over any drawing, stays clear of the narrator's face circle (bottom right) and the
 * board, and makes numbers and names (`key` words) stand out.
 */
import React from 'react';
import { CAPTION } from '../engine/layout';
import type { CaptionWord, PlanScene, RenderPlan } from '../engine/plan';
import { withAlpha, type Theme } from '../engine/theme';
import { wordGroups } from '../engine/captions';
import { easeOutBack, easeOutCubic, fonts, prog } from './anim';

interface Props { plan: RenderPlan; scene: PlanScene; frame: number; theme: Theme }

const halo = (theme: Theme) => theme.dark
  ? '0 4px 0 rgba(0,0,0,0.55), 0 0 18px rgba(0,0,0,0.6)'
  : `0 0 3px ${theme.captionHalo}, 0 0 14px ${theme.captionHalo}, 0 0 26px ${theme.captionHalo}`;
/** A heavy outline that reads on any background, the usual short-video look. */
const outline = (w: number) => Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return `${(Math.cos(a) * w).toFixed(1)}px ${(Math.sin(a) * w).toFixed(1)}px 0 #0B0B0F`;
}).join(', ') + `, 0 ${w + 4}px 0 rgba(0,0,0,0.45)`;

const isActive = (w: CaptionWord, frame: number) => frame >= w.startFrame && frame < Math.max(w.endFrame, w.startFrame + 4);
/** Bright gold for captions on their own dark outline, bar or as a highlighter: the theme's "yellow" is brown on some themes. */
const GOLD = '#FFD23F';
/** Numbers and names on the theme's own background: gold on dark themes, the theme's highlight colour on light ones. */
const keyColor = (theme: Theme) => theme.dark ? theme.colors.yellow : theme.captionHot;

export const Captions: React.FC<Props> = (p) => {
  const chunk = p.scene.captions.find((c) => p.frame >= c.startFrame && p.frame < c.endFrame);
  if (!chunk || p.plan.captions === 'off') return null;
  const a = easeOutCubic(prog(p.frame, chunk.startFrame, 4));
  switch (p.plan.captions) {
    case 'karaoke': return <Karaoke {...p} words={chunk.words} a={a} />;
    case 'pop': return <Pop {...p} words={chunk.words} />;
    case 'highlight': return <Highlight {...p} words={chunk.words} a={a} />;
    case 'lowerthird': return <LowerThird {...p} words={chunk.words} a={a} start={chunk.startFrame} />;
    case 'marker': return <Marker {...p} words={chunk.words} a={a} />;
    default: return <Subtle {...p} words={chunk.words} a={a} />;
  }
};

type Line = Props & { words: CaptionWord[]; a: number };

/** Handwriting in a soft dark pill; words brighten as they're said. */
const Subtle: React.FC<Line> = ({ plan, frame, theme, words, a }) => {
  const C = CAPTION[plan.format];
  return (
    <div style={{ position: 'absolute', left: 0, width: plan.width, top: C.y - 26, display: 'flex', justifyContent: 'center', opacity: a }}>
      <div style={{ maxWidth: C.maxW, padding: '8px 22px', borderRadius: 14, background: theme.captionBg, fontFamily: fonts.hand, fontSize: 42, lineHeight: 1.25, textAlign: 'center' }}>
        {words.map((w, i) => (
          <span key={i} style={{ color: frame >= w.startFrame ? '#F4F1EA' : 'rgba(244,241,234,0.55)' }}>
            {w.text}{i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

/** Big words, the one being said lit and a little larger. */
const Karaoke: React.FC<Line> = ({ plan, frame, theme, words, a }) => {
  const C = CAPTION[plan.format];
  return (
    <div style={{ position: 'absolute', left: (plan.width - C.maxW) / 2, width: C.maxW, top: C.y - 60, textAlign: 'center', opacity: a, fontFamily: fonts.display, fontWeight: 700, fontSize: 64 }}>
      {words.map((w, i) => {
        const active = isActive(w, frame);
        const said = frame >= w.startFrame;
        return (
          <React.Fragment key={i}>{i ? ' ' : ''}<span style={{ display: 'inline-block', margin: '0 4px', fontFamily: fonts.display, fontWeight: 700, fontSize: 64, color: active ? theme.captionHot : said ? theme.captionText : theme.captionDim, transform: `scale(${active ? 1.08 : 1})`, textShadow: halo(theme) }}>
            {w.text}
          </span></React.Fragment>
        );
      })}
    </div>
  );
};

/** One to three words at a time, heavy outlined type; each word bounces in as it's said, numbers and names in gold. */
const Pop: React.FC<Props & { words: CaptionWord[] }> = ({ plan, frame, theme, words }) => {
  const groups = wordGroups(words, plan.format === '9:16' ? 3 : 4);
  const group = [...groups].reverse().find((g) => frame >= g[0].startFrame) ?? groups[0];
  const C = CAPTION[plan.format];
  const size = plan.format === '9:16' ? 92 : 78;
  return (
    <div style={{ position: 'absolute', left: 60, width: plan.width - 120, top: C.y - size * 0.95, textAlign: 'center', lineHeight: 1.1, fontFamily: fonts.display, fontWeight: 700, fontSize: size }}>
      {group.map((w, i) => {
        const shown = frame >= w.startFrame;
        const pop = easeOutBack(prog(frame, w.startFrame, 6));
        const active = isActive(w, frame);
        return (
          <React.Fragment key={i}>{i ? ' ' : ''}<span style={{
            display: 'inline-block', margin: `0 ${size * 0.04}px`, fontFamily: fonts.display, fontWeight: 700, fontSize: size, letterSpacing: '-0.01em',
            color: w.key ? GOLD : active ? '#FFFFFF' : '#F2F2F2', textShadow: outline(size * 0.06),
            opacity: shown ? 1 : 0, transform: `scale(${shown ? 0.6 + 0.4 * pop + (active ? 0.06 : 0) : 0.6}) rotate(${w.key && shown ? -2 : 0}deg)`,
          }}>
            {w.text}
          </span></React.Fragment>
        );
      })}
    </div>
  );
};

/** A calm line in the theme's own type; numbers and names light up and get underlined as they're said. */
const Highlight: React.FC<Line> = ({ plan, frame, theme, words, a }) => {
  const C = CAPTION[plan.format];
  const size = plan.format === '9:16' ? 58 : 46;
  return (
    <div style={{ position: 'absolute', left: (plan.width - C.maxW) / 2, width: C.maxW, top: C.y - size * 0.9, textAlign: 'center', opacity: a, lineHeight: 1.3, fontFamily: fonts.display, fontWeight: 600, fontSize: size }}>
      {words.map((w, i) => {
        const said = frame >= w.startFrame;
        const u = w.key ? easeOutCubic(prog(frame, w.startFrame, 8)) : 0;
        return (
          <React.Fragment key={i}>{i ? ' ' : ''}<span style={{ position: 'relative', display: 'inline-block', margin: `0 ${size * 0.03}px`, fontFamily: fonts.display, fontWeight: w.key ? 700 : 600, fontSize: size, color: w.key && said ? keyColor(theme) : said ? theme.captionText : theme.captionDim, textShadow: halo(theme), transform: `scale(${w.key ? 1 + 0.12 * u * (1 - prog(frame, w.startFrame + 8, 8)) : 1})` }}>
            {w.text}
            {w.key ? <span style={{ position: 'absolute', left: 0, bottom: -size * 0.04, height: size * 0.09, width: `${u * 100}%`, borderRadius: size, background: keyColor(theme) }} /> : null}
          </span></React.Fragment>
        );
      })}
    </div>
  );
};

/** A broadcast-style bar on the left, clear of the face circle on the right; words fade up as they're said. */
const LowerThird: React.FC<Line & { start: number }> = ({ plan, frame, theme, words, a, start }) => {
  const vertical = plan.format === '9:16';
  const C = CAPTION[plan.format];
  const size = vertical ? 50 : 40;
  const left = vertical ? 60 : 120;
  const maxW = vertical ? plan.width - 120 : 1380;
  const slide = easeOutCubic(prog(frame, start, 6));
  return (
    <div style={{ position: 'absolute', left, top: C.y - size * 1.05, maxWidth: maxW, opacity: a, transform: `translateX(${(1 - slide) * -24}px)`, display: 'flex' }}>
      <div style={{ width: 10, borderRadius: '6px 0 0 6px', background: GOLD, flexShrink: 0 }} />
      <div style={{ padding: `${size * 0.28}px ${size * 0.6}px`, background: 'rgba(12,12,16,0.82)', borderRadius: '0 10px 10px 0', fontFamily: fonts.display, fontWeight: 600, fontSize: size, lineHeight: 1.25 }}>
        {words.map((w, i) => (
          <span key={i} style={{ color: w.key ? GOLD : '#F5F5F5', opacity: frame >= w.startFrame ? 1 : 0.35, fontWeight: w.key ? 700 : 600 }}>
            {w.text}{i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

/** Like a highlighter pen: a marker stroke sweeps behind the word being said; numbers and names keep theirs. */
const Marker: React.FC<Line> = ({ plan, frame, theme, words, a }) => {
  const C = CAPTION[plan.format];
  const size = plan.format === '9:16' ? 60 : 48;
  const ink = theme.dark ? '#F7F4EC' : theme.ink;
  return (
    <div style={{ position: 'absolute', left: (plan.width - C.maxW) / 2, width: C.maxW, top: C.y - size * 0.9, textAlign: 'center', opacity: a, lineHeight: 1.35, fontFamily: fonts.display, fontWeight: 700, fontSize: size }}>
      {words.map((w, i) => {
        const active = isActive(w, frame);
        const said = frame >= w.startFrame;
        const sweep = easeOutCubic(prog(frame, w.startFrame, 5));
        const fade = w.key ? 1 : 1 - prog(frame, Math.max(w.endFrame, w.startFrame + 4), 6);
        const mark = said ? sweep * fade : 0;
        return (
          <React.Fragment key={i}>{i ? ' ' : ''}<span style={{ position: 'relative', display: 'inline-block', margin: `0 ${size * 0.02}px`, padding: `0 ${size * 0.1}px` }}>
            <span style={{ position: 'absolute', left: -size * 0.06, top: '18%', height: '70%', width: `calc(${mark * 100}% + ${mark * size * 0.2}px)`, background: withAlpha('#FFE45C', w.key ? 0.95 : 0.85), borderRadius: size * 0.12, transform: 'rotate(-1.5deg) skewX(-8deg)', opacity: mark > 0 ? 1 : 0 }} />
            <span style={{ position: 'relative', fontFamily: fonts.display, fontWeight: 700, fontSize: size, color: mark > 0.5 && (active || w.key) ? '#16130E' : said ? ink : withAlpha(ink, 0.5), textShadow: mark > 0.5 && (active || w.key) ? 'none' : halo(theme) }}>
              {w.text}
            </span>
          </span></React.Fragment>
        );
      })}
    </div>
  );
};
