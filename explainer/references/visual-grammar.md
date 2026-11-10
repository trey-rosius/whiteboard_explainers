# Visual grammar — making the board read instantly

## 1. Colour semantics (use names, never hex)

| Colour | Means | Typical use |
|---|---|---|
| `blue` | people & clients (default for `client`) | users, browsers, phones |
| `cyan` | compute (default for `node`, `server`) | services, servers, functions, routers |
| `purple` | data at rest (default for `db`) | databases, storage, buckets |
| `orange` | async / in-flight (default for `queue`) | queues, streams, events, jobs |
| `yellow` | attention, the active thing, the "key" | routers/keys/indexes, highlights (default highlight + flow colour) |
| `green` | success, healthy, correct, fast | cache hits, replies, check marks, the good option |
| `red` | failure, overload, slow, the bad option | errors, hot spots, attacks, the bad option |
| `pink` | a third category when cyan/green are taken | shard 3, region C |
| `gray` | inactive, external, background | third-party systems, idle nodes |
| `ink` | neutral (default for text, tables, code, arrows) | structure |

Rules: the same entity keeps its colour all video. Use at most 3 accent colours per scene besides `ink`.
Red and green carry meaning — don't use them decoratively.

## 2. Picking elements

| You are showing… | Use |
|---|---|
| a person / caller | `client` `variant: "user"` (or `phone`, `laptop`, `browser`) |
| a service/component with a known logo | `node` + icon (`aws:lambda`, `si:redis`, `si:kubernetes`, `lucide:shield`) |
| a generic server / fleet | `server` (`stack: 2–3` for "many") |
| a database / store | `db` (optional small `icon`) |
| a buffer / queue / log | `queue` with `items` (≤ 4 chars each, e.g. "J1", "#42") |
| rows, keys, indexes, routing tables | `table` (≤ 5 cols, ≤ 7 rows; highlight rows) |
| a rule, query, config, API call | `code` (≤ 12 lines; highlight lines) |
| steps, takeaways, pros/cons | `list` (`stepwise: true` + `reveal` per item) |
| what someone typed to a chatbot, and its reply | `chat` (`stepwise: true` + `reveal` per message; `highlight` a `row` to flag a message) |
| a metric comparison or load | `bars` (+ `set values` to animate change; set `max` so the scale stays fixed) |
| a boundary (cluster, region, VPC, service) | `group` around existing elements |
| anything circular: hash ring, token ring, round-robin, clock | `ring` + `marker`s (server / key / vnode) |
| the one-sentence big idea | `text` `style: "statement"` (or `headline` for a punchline) |
| a side remark / gotcha | `note` (sticky) |

## 3. Layout recipes (16:9 grid, x 0..12, y 0..6)

Footprints (size `m`): node ≈ 1.1 × 1.7 cells, server/db ≈ 1 × 1.9, laptop ≈ 1.6 × 1.6, queue(5) ≈ 2.8 × 1.3,
bars ≈ 3.8 × 2.6, note ≈ 2.5 wide. Keep icon-element centres **≥ 2.2 apart horizontally and ≥ 2 apart vertically**.

- **Pipeline (left → right):** `[1.6,3] → [6,3] → [10.4,3]`; 4 stages: `x = 1.5, 4.5, 7.5, 10.5`.
- **Request with a side lookup (cache/auth):** client `[1.6,3]`, app `[6,3]`, side service `[6,0.9]` or `[9.5,1.4]`, db `[10.4,3]`.
- **Fan-out (1 → 3):** source `[2,3]`; targets `[9,1.1]`, `[9,3]`, `[9,4.9]` (or below: `[2.5,4.4] [6,4.4] [9.5,4.4]` from source `[6,1.6]`).
- **Fan-in (3 → 1):** mirror of fan-out.
- **Hub & spoke:** hub `[6,3]`; spokes `[2,1.2] [10,1.2] [2,4.8] [10,4.8]`.
- **Layers (top → bottom):** `y = 0.8, 2.7, 4.6` at `x = 6` (a 4th layer needs size `s` and `y = 0.6, 2.1, 3.6, 5.1`).
- **Before / after:** left half `x ≈ 3`, right half `x ≈ 9`; a `text` label above each at `y ≈ 0.6`; dim the loser.
- **Concept + detail:** diagram on the left (`x 1.5–7`), `code`/`table`/`list` on the right (`x ≈ 9.5–10`).
- **Centre stage:** a single `list`, `bars` or `text` at `[6, 2.6]` with a takeaway `text` at `[6, 5.3]`.

- **Ring (hero):** ring at `[6, 3.1]` alone, or `[4.6, 3.1]` with notes/code on the right at `x ≈ 10` (y 1.6 and 4.6).
  Spread markers ≥ 35° apart (labels sit outside the ring); keys use `kind: "key"`, virtual nodes `kind: "vnode"`.
  ```jsonc
  { "id": "ring", "type": "ring", "label": "Hash ring", "sub": "0 → 2³²", "at": [6, 3.1] },
  { "id": "sa", "type": "marker", "ring": "ring", "angle": 30,  "kind": "server", "label": "Server A", "color": "cyan" },
  { "id": "k1", "type": "marker", "ring": "ring", "angle": 100, "kind": "key",    "label": "user:42",  "color": "yellow" }
  // steps: { "do": "travel", "target": "k1", "to": "sb", "label": "user:42" } · { "do": "span", "target": "ring", "from": "sb", "to": "sd", "color": "orange" }
  ```
  (Full example: `examples/ring-demo.json`.)

**Composition rule:** at each scene's busiest moment the diagram should fill **60–85% of the board** and sit near
its centre. Prefer fewer, larger elements (`size: "l"` for the hero) over many small ones; never leave the middle
of the board empty while elements hug the top or bottom. The validator warns with `SPARSE_LAYOUT` / `OFF_CENTER`.

9:16 (x 0..6, y 0..10): stack vertically. Columns at `x = 1.3, 3, 4.7` (3 max, size `s` if labels are long);
rows every ~2 units: `y = 1, 3, 5, 7, 9`. Fan-out: source `[3,1.5]`, targets `[1.2,5] [3,5] [4.8,5]`.

Arrows: straight by default; give parallel or crossing arrows `bend: ±0.3–0.6`. Return trips use the same arrow
with `flow` `reverse: true`, or a second arrow with `bend` so both are visible. Request/response pairs: `both: true`.

## 4. Motion vocabulary (narration verb → step)

| Narration says… | Step |
|---|---|
| "here's X", "we add X" | `show` |
| "X sends / calls / writes / reads / replicates to Y" | `flow` along the arrow(s), `label` = payload ("GET /feed", "row 42", "ACK") |
| "lots of traffic", "a flood", "millions of" | `flow` `count: 4–5` `speed: "fast"` |
| "the reply comes back" | `flow` `reverse: true` `color: "green"` |
| "look at", "notice", "this one" | `highlight` (rows/lines via `row`) — add `for` to auto-clear |
| "X is overloaded / fails / slows down" | `shake` + `highlight color: "red"` (+ `set sub` with the metric) |
| "it works", "correct", "hit" | `mark check` · "wrong", "miss", "down" → `mark cross` · "careful" → `mark warn` |
| "X splits into…", "copies", "spawns" | new elements with `emergeFrom: "x"` then `show` them together (`stagger`) |
| "zoom into", "inside X", "let's focus on" | `focus` targets (then `unfocus` before moving on) |
| "set aside", "forget about X for now" | `dim` (later `undim`) |
| "X moves / migrates / rebalances" | `move` to a new grid position |
| "the count goes up", "now it's 95%" | `set` (`label`/`sub`/`text`/`items`/`rows`/`values`) |
| "first… second… third…" | `list` `stepwise` + `reveal` |
| "walk clockwise to the next server" | `travel` from the key marker to the owner marker |
| "these keys move", "this range" | `span` on the ring between two markers |

## 5. Choreography patterns

- **Build-up:** show the cast one at a time on their cue, then connect with arrows (arrows in a `show` step draw
  automatically after their endpoints).
- **Trace a request:** `flow` hop-by-hop on the cue for each hop, with a payload label; finish with `mark check`
  or a reverse green `flow`.
- **Failure moment:** red `flow` `count: 5` → `shake` → red `highlight` → `set sub "p99: 4.2 s"`. Let it breathe for
  one sentence before the fix.
- **The reveal / fix:** dim the problem, show the new component with `emergeFrom` or a `focus`, then replay the same
  trace successfully. Same request, different outcome = the lesson lands.
- **Spoken list:** keep the parent (a phase, an agent) on the top row. Each item is a small `node` (`size: "s"`, a short label, an icon, `emergeFrom` the parent) in a row or column beside it, with its own cue just before its words: `into {req} requirements, {stories} user stories, and {criteria} acceptance criteria.` When the narration moves on, `hide` the items in the same step that brings in the next thing, so the board never fills up.
- **Continuity:** when a scene keeps the same diagram, set `continue: true` and only add/change things. Never rebuild
  the same diagram from scratch in the next scene.
- **Camera:** `focus` at most once or twice per scene, on 1–3 elements; always `unfocus` before revealing things
  outside the focused area.

## 6. Themes and formats

- `educloud` (brand pink and orange, hand-drawn) — the default for tech topics.
- `chalkboard` (dark navy board, warm chalk ink).
- `paper` (warm off-white, dark ink) — great for light-mode brands and printed/corporate audiences.
- Captions: default `subtle` on 16:9, `karaoke` (big word-by-word) on 9:16. Set `"captions": "off"` if the platform
  adds its own.
