# Explainer — skill + harness for whiteboard explainer videos

```
LLM (follows SKILL.md)                Harness (deterministic)
──────────────────────               ─────────────────────────────────────────────────────────────
writes  video spec (JSON DSL)  ──▶   engine/validate   schema · layout · arrows · pacing · text limits
fixes   from precise errors    ◀──   engine/compile    cues→frames · grid→px · icons · SFX · captions
                                     node/tts          ElevenLabs word-timestamps, cached
looks at QA contact sheets     ◀──   remotion/         hand-drawn renderer: draw-on strokes, springs, packets,
                                                       camera, title cards, karaoke captions, ducked music
                                     cli/ · pipeline/  local CLI  ·  Lambda durable function (end-to-end)
```

## Quick start

```bash
npm run explainer -- setup                                   # once: synthesise SFX, write Studio preview plan
npm run explainer -- validate explainer/examples/database-sharding.json
npm run explainer -- studio   explainer/examples/database-sharding.json   # scrub it in Remotion Studio
npm run explainer -- tts      explainer/examples/database-sharding.json   # needs ELEVENLABS_API_KEY + _VOICE_ID in .env
npm run explainer -- qa       explainer/examples/database-sharding.json   # contact sheets → out/explainer/<id>/qa
npm run explainer -- render   explainer/examples/database-sharding.json   # → out/explainer/<id>/<id>.mp4
npm run explainer:test                                       # recipes + hardening + renderer smoke tests
```

To generate a new video with Claude Code, just ask: *"Make a 3-minute explainer on consistent hashing"* — the
skill is linked at `.claude/skills/explainer-video`. For other LLMs, give them `SKILL.md` + `references/*` +
`examples/database-sharding.json` as the system prompt and let them call the CLI (or use the pipeline).

## Production on AWS (everything renders in the cloud)

The Blocks app (`aws-blocks/`, frontend in `src/`) is the front door: create a video (16:9 or 9:16), browse the
paginated library, and open any job to watch its workflow move live.

```
Blocks app ──explainer.start──▶ durable Lambda (pipeline/durable-handler.ts) ──▶ Remotion Lambda
     ▲                               │ every stage: status.json + explainer.report (token-auth)
     └──── Realtime channel ◀────────┘
```

One-time setup (after `npm run deploy`, which creates the pipeline, bucket and `remotion-lambda-role`):

```bash
npm run explainer -- deploy-remotion        # Remotion render function → SSM
npm run explainer -- deploy-site --cloud    # renderer bundle → S3 → SSM (re-run after renderer/engine changes)
npm run -s explainer -- set-secrets         # ElevenLabs key + default voice from .env → SSM (run it yourself)
npm run explainer -- set-voices             # narrator choices shown in the app (YOUNG_JAMAL_VOICE_ID, ROSIUS_VOICE_ID)
```

Start/follow a job from a terminal through the deployed app API:
`npx tsx explainer/cli/start-cloud.ts --url https://<app>/aws-blocks/api --topic "…" --minutes 2 [--format 9:16]`

Inspect a job's stills on Lambda: `FN=… SERVE=… npx tsx explainer/test/lambda-still.ts <plan.json> <outDir>`.
Calibrate the length estimator against a real job: `npx tsx explainer/test/calibrate.ts <spec.json> <timings.json>`.

## Layout

| Path | What |
|---|---|
| `SKILL.md`, `references/`, `examples/` | the skill (what the LLM reads) |
| `engine/` | schema, layout geometry, narration/cues, compiler, validator — pure TS, shared by everything |
| `remotion/` | renderer (`Explainer` + `ContactSheet` compositions) |
| `node/` | icons (lucide / AWS / simple-icons, inlined), TTS providers, SFX synthesis |
| `cli/explainer.ts` | the harness CLI |
| `pipeline/durable-handler.ts` | Lambda durable function |
| `test/` | recipe, hardening and renderer smoke tests |

## Extending

New element or step = schema (`engine/schema.ts`) → footprint (`engine/layout.ts`) → state (`engine/plan.ts` fold) →
renderer (`remotion/elements.tsx` / `SceneView.tsx`) → validator limits → docs (`references/dsl.md`). Keep the DSL
small: every addition is something the LLM can misuse.
