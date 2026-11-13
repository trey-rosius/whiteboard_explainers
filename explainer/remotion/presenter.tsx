/**
 * The narrator's face in a circle, bottom right. Plays the kept stretches of their take back to back, so the face
 * stays in step with the edited audio; before the first word and after the last it holds or runs on, never goes blank.
 */
import React from 'react';
import { Freeze, OffthreadVideo, Sequence } from 'remotion';
import { PRESENTER } from '../engine/layout';
import type { PlanScene, RenderPlan } from '../engine/plan';
import type { Theme } from '../engine/theme';
import { easeOutCubic, prog } from './anim';

interface Piece { at: number; frames: number; from: number; hold?: boolean }

/** Scene frames → video frames: one piece per kept stretch, plus a lead-in and a run-out to fill the scene. */
export function presenterPieces(p: NonNullable<PlanScene['presenter']>, sceneFrames: number, fps: number): Piece[] {
  const pieces: Piece[] = [];
  const segs = p.segments.map((s) => ({ from: Math.round(s.from * fps), to: Math.round(s.to * fps) })).filter((s) => s.to > s.from);
  if (!segs.length) return pieces;
  let at = 0;
  // Lead-in: play the moment before the first word if the video has it, else hold the first frame.
  const lead = p.startFrame;
  const early = Math.min(lead, segs[0].from);
  if (lead > early) pieces.push({ at: 0, frames: lead - early, from: segs[0].from - early, hold: true });
  at = lead - early;
  segs[0] = { ...segs[0], from: segs[0].from - early };
  for (const s of segs) {
    if (at >= sceneFrames) break;
    const frames = Math.min(s.to - s.from, sceneFrames - at);
    pieces.push({ at, frames, from: s.from });
    at += frames;
  }
  // Run-out: keep playing past the last word while the video lasts, then hold its last frame.
  if (at < sceneFrames) {
    const last = pieces[pieces.length - 1];
    const lastFrame = last.from + last.frames;
    const room = Math.max(0, Math.floor(p.seconds * fps) - 2 - lastFrame);
    const more = Math.min(room, sceneFrames - at);
    if (more > 0 && !last.hold) { last.frames += more; at += more; }
    if (at < sceneFrames) pieces.push({ at, frames: sceneFrames - at, from: Math.max(0, last.from + last.frames - 1), hold: true });
  }
  return pieces;
}

export const Presenter: React.FC<{ plan: RenderPlan; scene: PlanScene; frame: number; theme: Theme; enter: boolean; exit: boolean }> = ({ plan, scene, frame, theme, enter, exit }) => {
  const p = scene.presenter;
  if (!p) return null;
  const G = PRESENTER[plan.format];
  const shown = (enter ? easeOutCubic(prog(frame, 0, 12)) : 1) * (exit ? 1 - prog(frame, scene.durationInFrames - 10, 10) : 1);
  const d = G.r * 2;
  return (
    <div style={{
      position: 'absolute', left: G.cx - G.r, top: G.cy - G.r, width: d, height: d, borderRadius: '50%', overflow: 'hidden',
      border: `6px solid ${theme.colors.yellow}`, boxShadow: '0 10px 30px rgba(0,0,0,0.35)', background: theme.bgEdge ?? theme.bg,
      opacity: shown, transform: `scale(${0.85 + 0.15 * shown})`,
    }}>
      {presenterPieces(p, scene.durationInFrames, plan.fps).map((piece, i) => (
        <Sequence key={i} from={piece.at} durationInFrames={piece.frames} layout="none">
          {piece.hold ? (
            <Freeze frame={0}><OffthreadVideo src={p.src} trimBefore={piece.from} muted style={video} /></Freeze>
          ) : (
            <OffthreadVideo src={p.src} trimBefore={piece.from} muted style={video} />
          )}
        </Sequence>
      ))}
    </div>
  );
};

const video: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };
