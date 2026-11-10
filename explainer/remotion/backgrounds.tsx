/**
 * Procedural, frame-deterministic backgrounds, one per art direction. Everything is CSS and tiled SVG, with no assets,
 * so each is sharp at any size. Motion stays slow so it never competes with the diagram. `seed` (the video id) varies
 * details such as glow positions, so two videos in a theme don't look stamped from one template.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { hashSeed } from './sketch';
import type { Theme } from '../engine/theme';

type P = { theme: Theme; frame: number; seed: string; width: number; height: number };
const fill = (style: React.CSSProperties) => <AbsoluteFill style={style} />;
const CENTER_MASK = 'radial-gradient(ellipse at 50% 50%, black 40%, transparent 95%)';

/** Cheap paper grain: a small noise tile is rasterised once by the browser, then just repeated. */
const grain = (freq: number, color: string, alpha: number, size = 320) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.4 -0.45'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='${alpha}' fill='${color}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
const grainLayer = (freq: number, alpha: number, blend: React.CSSProperties['mixBlendMode'] = 'multiply') =>
  fill({ backgroundImage: grain(freq, '#000', alpha), mixBlendMode: blend, opacity: 0.9 });

/** Seeded pseudo-random in [0, 1). */
const rnd = (seed: number, i: number) => { const x = Math.sin(seed * 0.0001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); };

const glowBlob = (x: number, y: number, rx: number, ry: number, color: string, opacity = 1): React.CSSProperties => ({
  position: 'absolute', left: x - rx, top: y - ry, width: rx * 2, height: ry * 2, borderRadius: '50%', opacity,
  background: `radial-gradient(closest-side, ${color}, transparent)`,
});

const Dots: React.FC<P> = ({ theme, frame }) => (
  <>
    {fill({ background: `radial-gradient(ellipse at 50% 45%, ${theme.bg} 0%, ${theme.bg} 55%, ${theme.bgEdge} 100%)` })}
    {fill({
      backgroundImage: `radial-gradient(${theme.grid} 1.6px, transparent 1.7px)`, backgroundSize: '38px 38px',
      backgroundPosition: `${(frame * 0.06) % 38}px ${(frame * 0.03) % 38}px`, maskImage: CENTER_MASK, WebkitMaskImage: CENTER_MASK,
    })}
  </>
);

/** The closing card's pink and orange glow, kept faint so the board stays dark and readable. */
const Educloud: React.FC<P> = (p) => (
  <>
    <Dots {...p} />
    <div style={glowBlob(p.width * 0.2, p.height * 0.22, p.width * 0.75, p.height * 0.42, 'rgba(236,72,153,0.16)')} />
    <div style={glowBlob(p.width * 0.85, p.height * 0.78, p.width * 0.75, p.height * 0.42, 'rgba(251,146,60,0.13)')} />
  </>
);

const Greenboard: React.FC<P> = ({ theme, seed, width, height }) => {
  const s = hashSeed(seed);
  return (
    <>
      {fill({ background: `radial-gradient(ellipse at 50% 42%, ${theme.bgStops![0]} 0%, ${theme.bg} 55%, ${theme.bgEdge} 100%)` })}
      {/* half-erased chalk: wide soft smears */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ ...glowBlob(rnd(s, i) * width, rnd(s, i + 9) * height, width * 0.5, height * 0.09, 'rgba(255,255,255,0.05)'), transform: `rotate(${-14 + rnd(s, i + 5) * 28}deg)` }} />
      ))}
      {grainLayer(0.9, 0.35, 'overlay')}
      {/* wooden frame */}
      {fill({ boxShadow: 'inset 0 0 0 16px #6B4A2B, inset 0 0 0 19px #3E2A18, inset 0 0 90px rgba(0,0,0,0.45)' })}
    </>
  );
};

const Blueprint: React.FC<P> = ({ theme, width, height }) => (
  <>
    {fill({ background: `radial-gradient(ellipse at 50% 40%, ${theme.bg} 0%, ${theme.bgEdge} 100%)` })}
    {fill({
      backgroundImage: `linear-gradient(${theme.grid} 2px, transparent 2px), linear-gradient(90deg, ${theme.grid} 2px, transparent 2px), linear-gradient(rgba(190,220,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(190,220,255,0.08) 1px, transparent 1px)`,
      backgroundSize: '200px 200px, 200px 200px, 40px 40px, 40px 40px',
    })}
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} fill="none" stroke="rgba(234,242,255,0.55)" strokeWidth={2}>
      {/* drawing sheet border and registration marks */}
      <rect x={26} y={26} width={width - 52} height={height - 52} />
      {[[26, 26], [width - 26, 26], [26, height - 26], [width - 26, height - 26]].map(([x, y], i) => (
        <g key={i}><path d={`M${x - 16} ${y}H${x + 16}M${x} ${y - 16}V${y + 16}`} /><circle cx={x} cy={y} r={8} /></g>
      ))}
    </svg>
  </>
);

const Graph: React.FC<P> = ({ theme, width }) => (
  <>
    {fill({ background: theme.bg })}
    {fill({ backgroundImage: `linear-gradient(${theme.grid} 1.5px, transparent 1.5px), linear-gradient(90deg, ${theme.grid} 1.5px, transparent 1.5px)`, backgroundSize: '44px 44px' })}
    {grainLayer(1.1, 0.08)}
    {/* the notebook's red margin */}
    <div style={{ position: 'absolute', top: 0, bottom: 0, left: Math.round(width * 0.055), width: 3, background: 'rgba(220,38,38,0.5)' }} />
    <div style={{ position: 'absolute', top: 0, bottom: 0, left: Math.round(width * 0.055) + 7, width: 2, background: 'rgba(220,38,38,0.28)' }} />
  </>
);

const Newsprint: React.FC<P> = ({ theme, width, height }) => (
  <>
    {fill({ background: theme.bg })}
    {grainLayer(0.75, 0.16)}
    {/* halftone fading in from opposite corners, as on a printed page */}
    {fill({ backgroundImage: 'radial-gradient(rgba(22,19,14,0.32) 2.2px, transparent 2.6px)', backgroundSize: '12px 12px', maskImage: 'linear-gradient(135deg, black 0%, transparent 26%, transparent 76%, black 100%)', WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 26%, transparent 76%, black 100%)' })}
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} stroke={theme.ink}>
      <path d={`M36 28H${width - 36}`} strokeWidth={5} /><path d={`M36 38H${width - 36}`} strokeWidth={1.5} />
      <path d={`M36 ${height - 38}H${width - 36}`} strokeWidth={1.5} /><path d={`M36 ${height - 28}H${width - 36}`} strokeWidth={5} />
    </svg>
  </>
);

const Kraft: React.FC<P> = ({ theme, seed, width, height }) => {
  const s = hashSeed(seed);
  return (
    <>
      {fill({ background: `radial-gradient(ellipse at 50% 40%, ${theme.bgStops![0]} 0%, ${theme.bg} 55%, ${theme.bgEdge} 100%)` })}
      {grainLayer(0.8, 0.2)}
      {fill({ backgroundImage: grain(0.015, '#000', 0.05, 512), mixBlendMode: 'multiply' })}
      {/* a coffee-cup ring, somewhere different in each video */}
      <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', left: (rnd(s, 1) > 0.5 ? width * 0.78 : width * 0.04) - 20, top: height * (0.06 + rnd(s, 2) * 0.08), border: '7px solid rgba(70,40,15,0.13)', boxShadow: 'inset 0 0 0 2px rgba(70,40,15,0.08)' }} />
    </>
  );
};

const Diner: React.FC<P> = ({ theme, width, height }) => {
  const band = Math.round(height * 0.034);
  const check: React.CSSProperties = {
    position: 'absolute', left: 0, width, height: band,
    backgroundColor: '#FFF6E6',
    backgroundImage: 'linear-gradient(90deg, rgba(200,16,46,0.82) 50%, transparent 50%), linear-gradient(rgba(200,16,46,0.62) 50%, transparent 50%)',
    backgroundSize: `${band / 1.5}px ${band / 1.5}px`,
  };
  return (
    <>
      {fill({ background: `radial-gradient(ellipse at 50% 42%, ${theme.bg} 45%, ${theme.bgEdge} 100%)` })}
      {grainLayer(1, 0.07)}
      <div style={{ ...check, top: 0, borderBottom: '4px solid #C8102E' }} />
      <div style={{ ...check, bottom: 0, borderTop: '4px solid #C8102E' }} />
    </>
  );
};

const Comic: React.FC<P> = ({ theme, frame, width, height }) => {
  const reach = Math.max(width, height) * 1.5;
  return (
    <>
      {fill({ background: theme.bg })}
      {/* sunburst turning very slowly */}
      <div style={{ position: 'absolute', left: width / 2 - reach / 2, top: height * 0.42 - reach / 2, width: reach, height: reach, transform: `rotate(${frame * 0.03}deg)`, background: 'repeating-conic-gradient(rgba(255,200,0,0.42) 0deg 9deg, transparent 9deg 18deg)' }} />
      {fill({ backgroundImage: 'radial-gradient(rgba(190,90,0,0.34) 3.2px, transparent 3.6px)', backgroundSize: '18px 18px', maskImage: 'radial-gradient(ellipse at 50% 42%, transparent 42%, black 100%)', WebkitMaskImage: 'radial-gradient(ellipse at 50% 42%, transparent 42%, black 100%)' })}
      {fill({ boxShadow: 'inset 0 0 0 10px #111' })}
    </>
  );
};

const Terminal: React.FC<P> = ({ theme, frame, height }) => {
  const bar = (frame * 3.2) % (height + 300) - 150;
  return (
    <>
      {fill({ background: `radial-gradient(ellipse at 50% 45%, #0C2015 0%, ${theme.bg} 55%, ${theme.bgEdge} 100%)` })}
      {fill({ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.3) 0 2px, transparent 2px 5px)' })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: bar, height: 150, background: 'linear-gradient(transparent, rgba(74,222,128,0.05), transparent)' }} />
      {fill({ boxShadow: 'inset 0 0 180px rgba(0,0,0,0.75)' })}
    </>
  );
};

const Synthwave: React.FC<P> = ({ theme, frame, seed, width, height }) => {
  const s = hashSeed(seed);
  const horizon = height * (height > width ? 0.84 : 0.8);
  const floor = height - horizon;
  const sun = Math.min(width, height) * 0.17;
  return (
    <>
      {fill({ background: `linear-gradient(${theme.bgEdge} 0%, ${theme.bg} 45%, ${theme.bgStops![0]} ${(horizon / height) * 100}%, ${theme.bgEdge} ${(horizon / height) * 100}%)` })}
      {/* stars */}
      {Array.from({ length: 60 }, (_, i) => {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.02 + i));
        return <div key={i} style={{ position: 'absolute', left: rnd(s, i) * width, top: rnd(s, i + 100) * horizon * 0.8, width: 3, height: 3, borderRadius: 3, background: '#fff', opacity: tw * 0.55 }} />;
      })}
      {/* striped sun low on the horizon, kept dim behind the diagram */}
      <div style={{ position: 'absolute', left: width / 2 - sun, top: horizon - sun * 0.8, width: sun * 2, height: sun * 0.8, overflow: 'hidden', opacity: 0.32 }}>
        <div style={{ width: sun * 2, height: sun * 2, borderRadius: '50%', background: 'linear-gradient(#FFE45E, #FF5EC4 40%)', maskImage: `repeating-linear-gradient(black 0 ${sun * 0.1}px, transparent ${sun * 0.1}px ${sun * 0.14}px)`, WebkitMaskImage: `repeating-linear-gradient(black 0 ${sun * 0.1}px, transparent ${sun * 0.1}px ${sun * 0.14}px)` }} />
      </div>
      {/* endless floor: lines radiate from the vanishing point; cross-lines slide towards the viewer */}
      <svg width={width} height={floor} style={{ position: 'absolute', left: 0, top: horizon, background: '#0B0520' }} stroke="#22E6FF" strokeWidth={2} fill="none">
        {Array.from({ length: 25 }, (_, i) => {
          const x = width / 2 + (i - 12) * width * 0.22;
          return <path key={i} d={`M${width / 2} 0L${x} ${floor}`} opacity={0.55} />;
        })}
        {Array.from({ length: 9 }, (_, i) => {
          const t = ((i + (frame * 0.012) % 1) / 9);
          const y = floor * t * t;
          return <path key={i} d={`M0 ${y}H${width}`} opacity={0.2 + t * 0.6} />;
        })}
        <path d={`M0 1H${width}`} stroke="#FF5EC4" strokeWidth={4} />
      </svg>
    </>
  );
};

const Aurora: React.FC<P> = ({ theme, frame, seed, width, height }) => {
  const s = hashSeed(seed);
  const ribbons = [['rgba(45,212,191,0.34)', 0], ['rgba(139,92,246,0.3)', 1], ['rgba(56,189,248,0.24)', 2], ['rgba(244,114,182,0.14)', 3]] as const;
  return (
    <>
      {fill({ background: `linear-gradient(170deg, ${theme.bg}, ${theme.bgEdge})` })}
      {ribbons.map(([color, i]) => {
        const x = width * (0.15 + rnd(s, i) * 0.7) + Math.sin(frame * 0.008 + i * 2) * width * 0.14;
        const y = height * (0.12 + i * 0.2) + Math.cos(frame * 0.006 + i) * height * 0.05;
        return <div key={i} style={{ ...glowBlob(x, y, width * 0.8, height * 0.2, color), transform: `rotate(${-18 + i * 11 + Math.sin(frame * 0.005 + i) * 5}deg)` }} />;
      })}
      {Array.from({ length: 40 }, (_, i) => <div key={i} style={{ position: 'absolute', left: rnd(s, i + 20) * width, top: rnd(s, i + 70) * height, width: 2.5, height: 2.5, borderRadius: 3, background: '#fff', opacity: 0.12 + 0.25 * Math.abs(Math.sin(frame * 0.015 + i)) }} />)}
    </>
  );
};

const Sunset: React.FC<P> = ({ theme, frame, seed, width, height }) => {
  const s = hashSeed(seed);
  return (
    <>
      {fill({ background: `linear-gradient(165deg, ${theme.bg} 0%, ${theme.bgStops![0]} 55%, ${theme.bgEdge} 100%)` })}
      {[['rgba(255,236,190,0.75)', 0], ['rgba(255,176,160,0.55)', 1], ['rgba(226,180,240,0.55)', 2]].map(([color, i]) => {
        const n = i as number;
        return <div key={n} style={glowBlob(width * (0.2 + rnd(s, n) * 0.6) + Math.sin(frame * 0.007 + n) * width * 0.08, height * (0.14 + n * 0.32) + Math.cos(frame * 0.006 + n) * height * 0.03, width * 0.62, width * 0.62, color as string)} />;
      })}
      {grainLayer(1.2, 0.06)}
    </>
  );
};

const KINDS: Record<Theme['background'], React.FC<P>> = {
  dots: Dots, educloud: Educloud, greenboard: Greenboard, blueprint: Blueprint, graph: Graph, newsprint: Newsprint, kraft: Kraft,
  diner: Diner, comic: Comic, terminal: Terminal, synthwave: Synthwave, aurora: Aurora, sunset: Sunset,
};

export const Background: React.FC<P> = (p) => {
  const Kind = KINDS[p.theme.background];
  return <AbsoluteFill><Kind {...p} /></AbsoluteFill>;
};
