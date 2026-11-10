# Script craft — sounding like a great tech explainer

The reference channels (KodeKloud, ByteByteGo) feel effortless because the **script does the teaching** and the
visuals only ever show what is being said *right now*. Write for the ear, not the eye.

## 1. The arc (map each beat to one scene)

| # | Beat | Purpose | Typical visual |
|---|------|---------|----------------|
| 1 | **Hook** (title card) | A concrete situation or question with stakes. ≤ 2 sentences. | `title` scene |
| 2 | **Setup** | The simple world: one app, one server, one database. Introduce the running example. | build a small diagram |
| 3 | **Pressure** | What changes (scale, failure, latency, cost). Make it hurt. | `flow` count 3–5 red, `shake`, `set` metrics |
| 4 | **Naive fix** | The obvious answer and why it is not enough. | before/after, `mark warn/cross` |
| 5 | **Core idea** | The concept in one sentence + a metaphor if it helps. | `emergeFrom` split, `group`, `text` statement |
| 6 | **Mechanism** | Step by step, how it actually works. 1–3 scenes with `continue`. | `flow`, `highlight` rows/lines, `code`, `table` |
| 7 | **Worked example** | Trace ONE concrete request end to end with real values. | multi-hop `flow` with labels, `mark check` |
| 8 | **Trade-offs / gotcha** | What it costs, when it breaks, what pros watch for. | `bars`, `shake`, `note` |
| 9 | **Recap + next** | 3–4 crisp takeaways, then a teaser. | stepwise `list`, `text` |

Shorts (9:16, 30–60 s): Title → a concrete example → how it works → the catch or payoff → one line to remember. Short boards, joined with `continue: true` while the picture carries on. Pick each visual by rules 22–25 in the skill. Concept videos use work, break, fix (rule 29), and benefit from 2–3 minutes: the part where it works is what makes the break matter.

## 2. House voice

- **Second person, present tense, conversational.** "Your app just went viral." "Now watch what happens when…"
- **Concrete nouns and numbers.** "user 42", "a 1 TB Postgres", "12 milliseconds", "ten times the traffic".
- **Short sentences.** Mostly 8–18 words; never over 30. One clause carries one idea.
- **Signpost transitions.** "But here's the catch." "So how does the router know?" "Let's trace one request."
- **Rhetorical questions** right before the answer appears on the board — they create the "click".
- **Define a term the first time, then use it consistently.** Say "shard", never alternate with "partition" unless
  you are explaining the difference.
- **No filler.** Cut "basically", "essentially", "in this video we will", "let's dive in", "it's important to note".
- **No hedging stacks.** One "usually" is fine; "it may sometimes potentially" is not.
- **Spell out what's spoken.** Write numbers the way they should be said when ambiguous ("forty-two", "p ninety-nine").
  Use `pronounce` for acronyms/brands the voice mangles: `{"K8s": "Kubernetes", "nginx": "engine X", "SQL": "sequel"}`.
  Captions keep the original spelling.

## Real stories

A real incident beats any made-up example: viewers believe it and remember it. When the research brief has a REAL STORY, open with it and show what actually happened (the real messages in a `chat`, the real number). Then explain the idea through an everyday product the viewer uses, and run the same attack or failure through each fix. Close by going back to the story: "with these checks, that one-dollar car would never have been sold."

## Plain speech

The research brief is written for specialists. Take its facts, never its wording, and leave out what doesn't serve the one idea this video teaches: a statistic or a named framework that needs its own explanation usually goes. Each scene must leave the viewer picturing something specific.

| Sounds clever, teaches nothing | Teaches |
|---|---|
| Technical debt is the accumulated cost of expedient implementation decisions. | The shelf breaks and you're late, so you tape it. It holds. Next month you stack more on it, and now fixing it means taking everything down. Programmers do this with code, and they call it technical debt. |
| Caching improves latency by serving frequently accessed data closer to the consumer. | Every morning you walk to the kitchen for sugar. So you keep some on your desk. The next trip takes one second. That desk is a cache. |
| Compounding exhibits exponential growth dynamics over long time horizons. | You save a thousand francs and it earns fifty. Next year, that fifty earns money too. Nothing changed except time, and the pile grows faster every year. |

Stay with the same example: when the next idea arrives, ask what it looks like in the same kitchen, not which new diagram it needs. A name the viewer won't use again gets dropped.

## 3. Pacing numbers

- Narration speed ≈ 175 words/min ≈ **2.9 words/s** (voice speed 0.9, measured). **Total words ≈ target seconds × 2.9** — count them; the validator fails videos > 20% off `targetSeconds`.
- **Scene length 12–45 s** (30–110 words). Longer → split with `continue: true` so the board persists.
- **A cue every 6–15 words.** That yields a visual beat every 3–6 s.
- Title card narration: 1–2 sentences.
- Whole video: 2–4 min default; up to ~12 min for deep dives (split chapters with title cards).

## 4. Cue placement — the sync secret

A cue fires ~0.1 s before the **word that follows it** (or at the end of narration if nothing follows). That
slight lead is what makes sync feel "tight".

- `goes to {db} one database` → the database draws as the narrator says "one database" (**anticipation** — best
  for introducing things).
- `goes to one database {db}, holding…` → it draws right after "database" is said (**confirmation** — fine for
  introductions in a list, best for consequences and punchlines: `and it crashes {crash}.`).
- Pick one style per scene and stay consistent; either works because elements take ~0.7 s to draw on.
- One cue may drive several steps (`show` + `highlight` at the same cue), or offset them: `"at": "db+0.6"`.
- Cue names are kebab-case, unique per scene, and descriptive (`{route}`, not `{c7}`).
- Every cue should be used by at least one step (the validator warns otherwise).

## 5. Good vs bad

❌ "In this video, we will discuss database sharding, which is a technique that is essentially used to horizontally
partition data across multiple database instances in order to improve scalability."

✅ "Your app just went viral {users}. Every request hits one database {db}. And that database is starting to choke {choke}."

❌ Board text: "The router uses consistent hashing to determine the shard"
✅ Board: node "Shard router" + code `shard = hash(id) % 3`; the sentence lives in narration.

## 6. Accuracy checklist (before validating)

- Every technical claim is true for the stated system/version.
- Code compiles in principle; commands are real; numbers are plausible and consistent across scenes.
- The worked example's values add up (e.g. `hash(42) % 3` really routes where you say).
