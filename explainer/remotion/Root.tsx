import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, Series, staticFile, useCurrentFrame } from 'remotion';
import type { PlanScene, RenderPlan } from '../engine/plan';
import { SceneView } from './SceneView';
import { Presenter } from './presenter';
import { continueRender, delayRender } from 'remotion';
import { BrandEndCard } from './endcard';
import { fontVars, fonts, loadThemeFonts } from './anim';
import { THEMES } from '../engine/theme';
import fallbackPlan from './defaultPlan.json';

const src = (s: string) => (/^https?:\/\//.test(s) ? s : staticFile(s));

const SceneSeq: React.FC<{ plan: RenderPlan; scene: PlanScene; prev?: PlanScene; next?: PlanScene }> = ({ plan, scene, prev, next }) => {
  const frame = useCurrentFrame();
  return (
    <>
      <SceneView plan={plan} scene={scene} frame={frame} />
      {/* The face circle carries on from scene to scene; it only grows in or out where the scene before or after has none. */}
      <Presenter plan={plan} scene={scene} frame={frame} theme={THEMES[plan.theme]} enter={!prev?.presenter} exit={!next?.presenter} />
      {scene.audio ? (
        <Sequence from={scene.audio.startFrame} layout="none">
          <Audio src={src(scene.audio.src)} />
        </Sequence>
      ) : null}
      {scene.sfx.map((s, i) => (
        <Sequence key={i} from={s.frame} durationInFrames={45} layout="none">
          <Audio src={staticFile(`sfx/${s.name}.wav`)} volume={s.volume} />
        </Sequence>
      ))}
    </>
  );
};

/** Holds rendering until this theme's fonts are in; a failed font falls back rather than failing the video. */
function useThemeFonts(name: RenderPlan['theme']) {
  const [handle] = useState(() => delayRender(`fonts:${name}`, { timeoutInMilliseconds: 60000 }));
  useEffect(() => { loadThemeFonts(THEMES[name]).catch(() => {}).finally(() => continueRender(handle)); }, [handle, name]);
}

export const ExplainerVideo: React.FC<{ plan: RenderPlan }> = ({ plan }) => {
  useThemeFonts(plan.theme);
  // Music ducks under narration (smoothed), fades in/out at the ends.
  const duck = useMemo(() => {
    if (!plan.music) return null;
    const arr = new Float32Array(plan.totalFrames).fill(1);
    let off = 0;
    for (const sc of plan.scenes) {
      if (sc.words.length) for (let f = off + sc.narrationStart; f < off + sc.narrationEnd; f++) arr[f] = 0.4;
      off += sc.durationInFrames;
    }
    const out = new Float32Array(arr.length);
    const W = 10;
    for (let i = 0; i < arr.length; i++) {
      let s = 0, n = 0;
      for (let k = -W; k <= W; k++) if (arr[i + k] !== undefined) { s += arr[i + k]; n++; }
      out[i] = s / n;
    }
    return out;
  }, [plan]);
  return (
    <AbsoluteFill style={{ background: THEMES[plan.theme].bg }}>
      <Series>
        {plan.scenes.map((sc, i) => (
          <Series.Sequence key={sc.id} durationInFrames={sc.durationInFrames}>
            <SceneSeq plan={plan} scene={sc} prev={plan.scenes[i - 1]} next={plan.scenes[i + 1]} />
          </Series.Sequence>
        ))}
        {plan.brandKit && plan.endFrames ? (
          <Series.Sequence durationInFrames={plan.endFrames}>
            <BrandEndCard plan={plan} />
          </Series.Sequence>
        ) : null}
      </Series>
      {plan.music && duck ? (
        <Audio
          src={src(plan.music.src)}
          loop
          volume={(f) => {
            const edge = Math.min(1, f / 45, (plan.totalFrames - f) / 60);
            return plan.music!.volume * (duck[f] ?? 1) * Math.max(0, edge);
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** QA contact sheet: key frames of one scene in a grid — cheap to send to a vision model. */
export const ContactSheet: React.FC<{ plan: RenderPlan; sceneIndex: number; frames: number[]; labels: string[] }> = ({ plan, sceneIndex, frames, labels }) => {
  useThemeFonts(plan.theme);
  const scene = plan.scenes[sceneIndex];
  const { cols, cw, ch } = sheetGrid(plan);
  const s = cw / plan.width;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {frames.map((f, i) => (
        <div key={i} style={{ position: 'absolute', left: (i % cols) * cw, top: Math.floor(i / cols) * ch, width: cw, height: ch, overflow: 'hidden', outline: '2px solid #000' }}>
          <div style={{ width: plan.width, height: plan.height, transform: `scale(${s})`, transformOrigin: '0 0', position: 'relative' }}>
            <SceneView plan={plan} scene={scene} frame={f} />
          </div>
          <div style={{ position: 'absolute', left: 8, top: 8, padding: '3px 10px', borderRadius: 8, background: 'rgba(255,0,128,0.85)', color: 'white', fontFamily: fonts.mono, fontWeight: 700, fontSize: 18 }}>
            {labels[i]}
          </div>
        </div>
      ))}
    </AbsoluteFill>
  );
};

export function sheetGrid(plan: RenderPlan) {
  return plan.format === '9:16' ? { cols: 4, cw: 360, ch: 640 } : { cols: 3, cw: 640, ch: 360 };
}

export const Root: React.FC = () => (
  <>
    <Composition
      id="Explainer"
      component={ExplainerVideo as any}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={300}
      defaultProps={{ plan: fallbackPlan as unknown as RenderPlan }}
      calculateMetadata={({ props }: any) => {
        const plan = props.plan as RenderPlan;
        return { width: plan.width, height: plan.height, fps: plan.fps, durationInFrames: Math.max(1, plan.totalFrames) };
      }}
    />
    <Composition
      id="ContactSheet"
      component={ContactSheet as any}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={1}
      defaultProps={{ plan: fallbackPlan as unknown as RenderPlan, sceneIndex: 0, frames: [30], labels: ['preview'] }}
      calculateMetadata={({ props }: any) => {
        const { cols, cw, ch } = sheetGrid(props.plan);
        const rows = Math.max(1, Math.ceil(props.frames.length / cols));
        return { width: cols * cw, height: rows * ch, fps: 30, durationInFrames: 1 };
      }}
    />
  </>
);
