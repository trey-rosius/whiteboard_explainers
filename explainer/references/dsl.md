# Explainer DSL reference

Source of truth: `engine/schema.ts` (zod, strict — unknown keys are errors).

## Video

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | kebab-case | — | used for output paths |
| `title` | string | — | |
| `format` | `"16:9"` \| `"9:16"` | `16:9` | 1920×1080 or 1080×1920, 30 fps |
| `theme` | `"chalkboard"` \| `"paper"` | `chalkboard` | |
| `captions` | `"off"` \| `"subtle"` \| `"karaoke"` | subtle (16:9) / karaoke (9:16) | |
| `brand` | string ≤ 24 | — | small mono watermark top-right |
| `voice` | `{ provider: "elevenlabs" \| "none", voiceId?, model?, stability?, style?, speed? }` | elevenlabs | `none` = silent, estimated timing |
| `pronounce` | `{ "Word": "spoken form" }` | `{}` | per-token replacement for TTS only |
| `music` | `{ src, volume? }` | — | file in `explainer/public/` or https URL; auto-ducked under narration |
| `targetSeconds` | number | — | requested length; > 20% off = error, > 10% = warning |
| `scenes` | Scene[] | — | ≥ 1 |

## Scenes

**Title** — `{ id, kind: "title", kicker?, title, subtitle?, icon?, titleStyle?, narration? }` (title ≤ 48 chars, kicker ≤ 26, subtitle ≤ 80). `icon` is a topic icon such as `lucide:clock`. `titleStyle` is `hero`, `bigtype`, `monogram`, `stamp`, `band` or `classic`; leave it out to get a design picked automatically.

**Board** — `{ id, kind: "board", heading?, narration, continue?, elements[], steps[] }`
- `heading` ≤ 44 chars (28 on 9:16). With `continue: true` and no heading, the previous heading carries over.
- `continue: true` keeps every element still visible at the end of the previous board scene (same ids, positions,
  `set` changes) — reference them in steps without redefining them.
- `narration` contains `{cue}` markers (kebab-case, unique per scene).

## Elements

Common to placed elements: `id`, `at: [x, y]` (centre, grid units), `size?: "s" | "m" | "l"` (0.8× / 1× / 1.25×),
`color?`, `emergeFrom?: id` (fly out of that element when shown).

| type | fields | limits |
|---|---|---|
| `node` | `icon` (required), `label`, `sub?` | label ≤ 24, sub ≤ 30 (rendered as a mono pill) |
| `server` | `label`, `sub?`, `stack?: 1–3` | |
| `db` | `label`, `sub?`, `icon?` | |
| `client` | `variant: user\|laptop\|phone\|browser`, `label`, `sub?` | |
| `queue` | `label`, `items?: string[]` (≤ 8), `slots?: 3–8` | each item ≤ 4 chars |
| `table` | `title`, `columns` (1–5), `rows` (≤ 7, each same length as columns) | cells ≤ 22 chars |
| `code` | `title?`, `lines` (1–12) | line ≤ 52 chars (34 on 9:16); light syntax colouring automatic |
| `list` | `title?`, `items` (1–6), `ordered?`, `stepwise?` | item ≤ 46 chars (30 on 9:16) |
| `chat` | `title?` (the bot's name), `messages` (1–6 of `{from: "user"\|"bot", text}`), `stepwise?` | message ≤ 90 chars; a phone-width card, so give it a whole board on 9:16 (`at: [3, 5]`), or the top half with 2–3 short messages |
| `text` | `text`, `style: headline\|statement\|label\|stamp` | 60 / 110 / 44 / 14 chars; `stamp` is huge, tilted, and may overlap the diagram |
| `chip` | `text` | ≤ 24 chars; solid pill (default yellow), drawn above the diagram. The thing the story follows: `move` it, `set` its text |
| `note` | `text` | ≤ 90 chars (sticky note, auto-wrapped) |
| `bars` | `title?`, `unit?`, `bars: [{label, value}]` (1–6), `max?` | bar label ≤ 14 |
| `ring` | `label?`, `sub?` (centre text) | a circle (hash ring, token ring); ~3.9 × 5.6 cells at size m incl. marker labels — it is the hero: keep size m on 16:9 (l does not fit), centre it near y 3.2 |
| `marker` | `ring`, `angle` (0 = top, clockwise), `kind: server\|key\|vnode`, `label?`, `color?` | no `at`; sits on its ring; label is placed outward automatically; label ≤ 16 |
| `group` | `label`, `contains: id[]`, `color?` | no `at`; wraps its children (+ padding) |
| `arrow` | `from`, `to` (element or group ids), `label?`, `style: solid\|dashed`, `both?`, `bend?: -1..1`, `color?` | label ≤ 22 |

Icons: `lucide:<name>` (line icons, tinted to element colour — the most on-style), `aws:<service>` (official colour
AWS icons, e.g. `aws:lambda`, `aws:s3`, `aws:sqs`, `aws:dynamodb`, `aws:apigateway`), `si:<slug>` (brand logos
tinted), `brand:<slug>` (brand logos in brand colour). Find ids: `npm run explainer -- icons <word>`.

## Steps

Every step has `at`: `"cue"` | `"cue+0.5"` | `"cue-0.3"` | `"start"` | `"end"` | number (seconds from narration start).

| do | fields | effect |
|---|---|---|
| `show` | `targets[]`, `stagger?` (s) | draw-on entrance; arrows in the same step wait for their endpoints |
| `hide` | `targets[]` | fade out |
| `flow` | `path[]` (arrow ids in travel order), `label?` (≤ 16), `color?`, `count?` 1–5, `reverse?`, `speed?` slow\|normal\|fast | glowing packet(s) travel the arrows; burst on arrival |
| `highlight` | `target`, `color?`, `row?`, `for?` (s) | glow + recolour; `row` = table row / code line / list item / chat message / bar index |
| `unhighlight` | `target` | |
| `pulse` | `target` | quick scale bump |
| `shake` | `target`, `for?` (s, default 1.4) | shudder + red alarm tint |
| `strike` / `unstrike` | `target` | red pen stroke across the element; it stays, and carries into `continue` scenes, until `unstrike` |
| `mark` / `unmark` | `target`, `kind: check\|cross\|warn` | badge at the shape's top-right |
| `dim` / `undim` | `targets[]` | fade to 22% |
| `focus` | `targets[]`, `zoom?` 1.1–2.2 | camera glides to frame the targets |
| `unfocus` | — | camera returns to the full board |
| `move` | `target`, `to: [x, y]` | spring to a new grid position (arrows follow) |
| `set` | `target`, any of `label`, `sub`, `text`, `items`, `rows`, `values` | change content with a crossfade; `values` animates bars |
| `reveal` | `target` (list or chat), `count?` | reveal the next list item(s) or chat message(s) (for `stepwise` ones) |
| `travel` | `target` (marker), `to` (marker, same ring), `label?`, `color?`, `speed?` | packet walks CLOCKWISE along the ring from target to `to` |
| `span` | `target` (ring), `from`, `to` (markers), `color?`, `for?` | lights up the clockwise arc from → to (e.g. the range that moves) |
| `unspan` | `target` (ring) | clears that ring's arcs |

## Automatic behaviour (you don't specify these)

- Sound design: pop on show, whoosh on flow, tick on highlight/reveal, ding on check, error tone on cross/warn,
  thud on shake, swoosh on camera moves and title cards.
- Scene fades (none between `continue` scenes), heading underline, captions synced to the voice word-by-word,
  music ducking, background grid drift.
- Timing: 0.27 s lead-in before narration, 0.73 s tail after; cues fire 0.1 s before their word.
