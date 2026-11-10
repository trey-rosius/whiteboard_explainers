/** Closing brand card: the same dark look on every theme, because the full logo has a white wordmark. */
import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { RenderPlan } from '../engine/plan';

export const BrandEndCard: React.FC<{ plan: RenderPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const kit = plan.brandKit!;
  const vertical = plan.format === '9:16';
  const logoIn = spring({ frame: frame - 2, fps, config: { damping: 15, stiffness: 120 } });
  const urlIn = spring({ frame: frame - 14, fps, config: { damping: 18, stiffness: 120 } });
  const fade = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: fade, background: '#0B0B10', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Grotesk', sans-serif" }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 28% 34%, rgba(236,72,153,0.26), transparent 58%), radial-gradient(ellipse at 76% 68%, rgba(251,146,60,0.22), transparent 58%)', transform: `scale(${1 + frame * 0.0006})` }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: vertical ? 54 : 36 }}>
        <Img src={staticFile(kit.logo)} style={{ width: vertical ? 860 : 900, opacity: logoIn, transform: `translateY(${(1 - logoIn) * 26}px) scale(${0.95 + 0.05 * logoIn})` }} />
        <div style={{ opacity: urlIn, transform: `translateY(${(1 - urlIn) * 18}px)`, textAlign: 'center' }}>
          {kit.line ? <div style={{ color: 'rgba(255,255,255,0.76)', fontSize: vertical ? 44 : 38, marginBottom: 16 }}>{kit.line}</div> : null}
          <div style={{ fontWeight: 700, fontSize: vertical ? 74 : 66, letterSpacing: '-0.01em', backgroundImage: 'linear-gradient(90deg, #EC4899, #FB923C)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingBottom: 8 }}>{kit.url}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
