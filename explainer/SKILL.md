---
name: explainer-video
description: Produce studio-quality, hand-drawn whiteboard explainer videos (KodeKloud / ByteByteGo style) about ANY topic — technology (system design, cloud, databases, algorithms, AI) and non-technical subjects (recipes, a restaurant's dishes, small-business how-tos, health, finance, science). Use when asked to make, script, storyboard, or render an explainer/educational/tech video or short. You write a validated JSON spec (script + board + cue-timed steps); the harness owns all pixels, motion, timing, voice, sound and rendering.
---

# Explainer Video Skill

You are the **writer and director**. The harness is the **animator, editor and sound engineer**.

You produce exactly one artifact: a **video spec** (`*.json`) in the Explainer DSL. You never write React, CSS, pixel
coordinates, frame numbers, hex colours, fonts or easing. If you feel the need to, you are using the wrong tool —
express it with the DSL or simplify the idea.

Why this split: LLM-authored animation code drifts, overlaps and desyncs. A typed DSL rendered by a hand-tuned engine
produces the same polish every time, and the validator turns every mistake into a precise, fixable error.

---

## The workflow (follow in order — do not skip steps)

```
1 BRIEF → 2 TEACHING PLAN → 3 SCRIPT → 4 BOARDS → 5 VALIDATE ⟲ → 6 VOICE → 7 VALIDATE ⟲ → 8 VISUAL QA ⟲ → 9 RENDER
```

1. **Brief.** Pin down: topic, audience level (default: smart beginner), format (`16:9` long-form or `9:16` short),
   target length (default 2–4 min; shorts 30–60 s). Ask only if the request is genuinely ambiguous.
2. **Teaching plan.** Before any JSON, write a 5–9 beat outline using the arc in
   `references/script-craft.md` (hook → naive approach → why it breaks → core idea → mechanism → worked example →
   trade-off → recap). One idea per beat. Each beat becomes one scene (long beats: 2 scenes joined with `continue`).
3. **Script.** Write narration per scene in the house voice (`references/script-craft.md`). Insert `{cue}` markers
   immediately **before** the word that names the thing that should appear/change.
4. **Boards.** For each scene choose elements and steps using `references/visual-grammar.md` (colour semantics,
   layout recipes with grid coordinates, motion vocabulary). Full field reference: `references/dsl.md`.
5. **Validate** — `npm run explainer -- validate <spec.json>`. Fix **every** error, then every warning you can.
   Repeat until `✔ VALID`. Never "work around" the validator; it encodes layout geometry you cannot see.
6. **Voice** — `npm run explainer -- tts <spec.json>` (cached per scene; only changed narration is re-synthesised).
7. **Validate again.** Real speech timing differs from estimates; pacing and `DEAD_AIR` checks may now fire. Fix.
8. **Visual QA** — `npm run explainer -- qa <spec.json>` writes one contact sheet per scene to
   `out/explainer/<id>/qa/`. **Open and look at every image.** Apply `references/qa-checklist.md`. Fix and re-run
   until a scene passes. Do not render a video you have not looked at.
9. **Render** — `npm run explainer -- render <spec.json>` → `out/explainer/<id>/<id>.mp4`.
   (`--draft` for a fast half-res silent preview; `--lambda` for Remotion Lambda.)

Shortcut once a spec is clean: `npm run explainer -- make <spec.json>` (validate → tts → validate → qa → render).
Need an icon id? `npm run explainer -- icons <word>`.

---

## Non-negotiable rules

1. **Narration explains; the board shows.** On-screen text is labels (≤ 3–4 words). Never put sentences on the
   board except a single `note` or `text` statement when the idea itself is the point.
2. **Every visual change is anchored to a spoken word** via a cue. No orphan animation, no unanimated paragraph.
3. **Something meaningful changes every 3–6 seconds.** The validator warns at 7 s and fails at 11 s.
4. **Build, don't dump.** Start each board empty (or carried over) and add elements as the narrator introduces
   them. Never `show` more than 3 unrelated things in one step.
5. **Show motion for every verb.** "sends/requests/writes/replicates" → `flow`. "fails/overloads" → `shake` +
   red. "succeeds/correct" → `mark check`. "focus on / zoom into" → `focus`. "splits into" → elements with
   `emergeFrom`. "compare" → `bars`/side-by-side + `highlight`.
6. **Big, centred, one concept per scene, ≤ 7 visible things.** Fill 60–85% of the board (validator: warn > 10 on 16:9, > 7 on 9:16).
7. **Colour means something** and stays consistent across the whole video (see visual grammar). Same entity →
   same id, same colour, same position across `continue` scenes.
8. **Concrete over abstract.** Use a running example (a named app, user 42, a real query, real numbers).
9. **Respect the safe area and limits.** Positions are grid units, not pixels. Text limits are hard errors.
10. **No hallucinated tech.** Facts, commands, APIs and numbers in narration and code must be correct.
    If unsure, say less rather than invent.
11. **Do not edit the engine** (`engine/`, `remotion/`) to make a spec pass. If the DSL truly cannot express
    something essential, say so explicitly and propose the smallest DSL extension instead.
13. **If it has connected parts, draw it.** If the idea has parts that connect, a process, a sequence, a branch or a loop, draw that with nodes, arrows (`bend` for loops and retries) and `flow`. A workflow scene shows an actual workflow running. Use a `list` only when the items really are separate things (rule 22).
14. **A shape must mean what it depicts.** `db` only for things that store data, `server` only for machines or services that run, `client` only for people and devices, `queue` only for queues. Anything else, including concepts, modes, types and options, is a `node` with a fitting icon, or a side-by-side `table`.
15. **Vertical videos: fewer, bigger things.** Elements are large on 9:16, so show at most 3 per column and 2 per row. A longer flow snakes through two columns (down one side, across, up or down the other), so every arrow has room.
16. **Teach a complete beginner, through one everyday example.** Unless the notes name another audience, assume the viewer has never heard of this topic and can't pause. Choose one situation they have lived through and explain the whole idea through it, from the first scene to the last. Show it first, then name it: tell the small story, then say "that is called a feedback loop". A video of 2 minutes carries about three new terms; say everything else in everyday words. A definition made of other hard words explains nothing. Show early why this matters to the viewer. See "Plain speech" in script craft.
17. **The first screen is the title, and the first line says it.** The opening title scene shows the video title (at most 44 characters) and its narration starts with those words, optionally as "Let's look at…", then at most one hook of 12 words that doesn't repeat the title (the screen holds still, so keep this under about 7 seconds; the harness trims anything longer). Set `icon` on the title scene to a fitting icon for the topic and leave `titleStyle` out, because the harness varies the design between videos; only set it when asked for a particular look. The harness adds the corner logo and closing card, so don't draw them or read the website aloud. When the narrator records their face (`presenter`, set by the harness), it sits in a circle in the bottom-right corner of every scene, so keep that corner empty; the validator flags anything placed there.
18. **Put a cue where the phrase begins, not where it ends:** `{db} The database stores it`, not `The database stores it {db}.` The viewer should see each thing as it is being named. Start every board's first visual in its first words.
19. **The narration is the storyboard.** Read each sentence and ask: what would I point at while saying this? Anything concrete the narrator names should be on screen, on its own cue, around the moment it is named. A highlight or pulse on a box is not a picture of what is being said: use them only when the words point at something already visible.
20. **Draw spoken lists, item by item.** "requirements, user stories, and acceptance criteria" is three small elements, each with a cue just before its words, never one vague label such as "drafts artifacts". A label like "Requirements & stories" that drops an item is also wrong. The validator flags this as `SPOKEN_LIST_UNSEEN`.
21. **Illustrated, never choked.** Rules 19 and 20 must not fill the screen. Show short labels, and when the narration moves on, `hide` what it has finished with, so at most about 5 or 6 things are visible at once. Prefer a fresh board moment to a crowded one: clear the old items, then bring in the new. If a scene still feels crowded, split it.
22. **Choose the visual from what the sentence means**, not from habit. A good video mixes them, and each moment gets the one that explains it best:

| What the narration is doing | Best visual |
|---|---|
| How things connect, or something moving between them | `node`/`server`/`db` with arrows and `flow` |
| One example passing through stages | a `chip` you `move` and `set` |
| One thing becoming many | `emergeFrom` |
| Steps in order | arrows, or an `ordered` `stepwise` list when nothing really connects them |
| Separate items, reasons, tips or takeaways | a `stepwise` `list`, or a row of icons when each is a real thing |
| A comparison | side-by-side nodes, `table`, or `bars` |
| A key figure the narrator says (money, a percentage, "44 times cheaper") | a big `headline` `text` with the figure in digits ("$22,200 per million tickets"), or labelled `bars`; never only a chip or note |
| A smaller number that belongs to a part | a `sub` on that part |
| The one line to remember, or a turning point | one big `text` alone (`headline` or `statement`) |
| A warning or an aside on what's showing | short `note` or `mark` |
| A conversation with a chatbot or agent, or what someone typed | `chat` (`stepwise` + `reveal` per message) |
| Real commands, config or code | `code` |
| A named product or service | its real icon (`aws:`, `si:`, `brand:`) |

23. **Keep the picture while the idea carries on; clear it when the idea changes.** While the narration is still on the same picture, use `continue: true`, `dim` what is finished and add to it. When it moves to a new idea, a fresh board is right. A short usually has one main picture, plus a line, list or comparison where those explain better.
24. **Use concrete examples.** Prefer one specific example (a named person, a real word, real numbers) over general statements. If something moves through the system, let the viewer follow it.
25. **A chart means real measurements.** Use `bars` only for values you can source. To show something filling up with no real numbers, use a `queue` you fill with `set`, or nodes appearing. Never put placeholder values such as 1, 2, 5 on a chart.
**Words support the picture.** Text is short, large and has a reason to be there. Never leave small labels alone on an empty board. Don't put up what the narrator is saying as a sentence. A heading is optional: use one only when a fresh board starts a new idea and it helps.
26. **When you trace something, the viewer must see it travel.** Each time the narration reaches a stage: `move` the `chip` or `flow` there on that cue, light that stage with `highlight`, and `dim` the one before. The picture must look different at every stage. Never tick or highlight a stage before the story reaches it. If a `chip` isn't going to move, don't use one.
27. **Never leave the viewer looking at nothing.** Something is on screen by the first or second word of every fresh board. Reveal lists and diagrams as they're said, but make the first item or part appear right away.
28. **Example numbers must say they're examples.** A number the narrator doesn't say and the research doesn't contain (a sample TTL, a made-up chart value) is invented. Leave it out, or label it "e.g." and only when the idea needs it.
29. **Concept videos: work, break, fix.** When a video explains why something exists, first show the simple way working with a real example, so the viewer believes it. Then change one thing and show it failing on the same example. Only then bring in the fix, and run the same example through it. Under 90 seconds, keep the working part to one sentence. News, tips and how-tos don't need this.
30. **Work it out on screen.** If there's a calculation or transformation, show it with real values, `10 ÷ 4 → r2`, not just the result. The numbers must be correct: work them out yourself, and keep them simple.
31. **One colour per named example.** When following named examples (Ada, Kofi, one request), give each its own colour and use it on everything that belongs to it: the person, its chip and where it ends up. These colours track who is who; red and green still mean bad and good.
32. **Mirror the before and after.** Say the problem and the payoff in matching words: "one guess cracks everyone", then "one guess cracks no one". Keep the same headline up across boards while the problem carries on, instead of a new heading for each step.
33. **One stamp, at the turning point.** A `text` with `style: "stamp"` (at most 14 characters, one or two words) lands over the picture when the idea fails. Use it at most once, and only if something really breaks. It clears itself after about 2 seconds, so leave the things you want visible clear of it. When a rule stops working, `strike` it, and `unstrike` it if the fix brings it back.
34. **Open with something real.** If the research brief has a REAL STORY, the first board tells it concretely: who, what they typed or did, what happened, what it cost. Come back to it at the end. With no real story, open on a situation the viewer has lived. Never open with a definition or a list of problems.
35. **One everyday example, tested by every fix.** Build the video around something viewers use: an online shop's support chat, a bank app, food delivery. Show the problem happening to it, then show each part of the solution stopping that same problem, one at a time.
36. **Show the real thing.** Draw the actual message, rule, number or call: a `chat` for a conversation with a bot or agent, `code` for a rule or a function call such as `issue_refund(order, 5000)`. Name each check by the question it asks ("Is this your order?"), never "Checker 1".
37. **Key figures go up big.** Every amount of money or percentage the narrator says is shown in big type as it is said: a `headline` `text` in digits, or labelled `bars`, up for at least 2 seconds. The validator rejects a key figure shown only as a chip or note (FIGURE_SMALL).
38. **If the narrator says it moves, show it moving the whole way.** "Tickets go into an SQS queue, which triggers a Lambda function" needs: an arrow INTO the queue, the queue, an arrow to the Lambda box, and a multi-hop `flow` (or `count` 3) labelled "ticket" that starts inside that sentence. Every box is labelled with the name the narrator uses ("SQS queue", "Lambda") and has its real icon. In a scene with modes or branches, run a `flow` down each branch as that mode is described. The validator rejects a still route (MOVEMENT_STILL), a single dot over one hop (MOVEMENT_FAINT) and unnamed boxes (NAME_UNSEEN).

12. **Stop conditions.** Done = validate passes with 0 errors, QA sheets inspected and clean, render finished.
    If a validation error persists after 3 targeted fixes, simplify the scene (fewer elements, split it).

---

## DSL in 60 seconds

```jsonc
{
  "id": "kebab-id", "title": "…", "format": "16:9", "theme": "educloud",
  "voice": { "provider": "elevenlabs" }, "pronounce": { "PostgreSQL": "post-gress Q L" },
  "scenes": [
    { "id": "intro", "kind": "title", "kicker": "System Design 101", "title": "Caching", "subtitle": "…", "narration": "…" },
    {
      "id": "miss", "kind": "board", "heading": "A cache miss",
      "narration": "The app {app} first checks the cache {cache}. It's empty {miss}, so we go to the database {db}.",
      "elements": [
        { "id": "app",   "type": "server", "label": "App",      "at": [2, 3] },
        { "id": "cache", "type": "node",   "label": "Redis", "icon": "si:redis", "color": "red", "at": [6, 1.6] },
        { "id": "db",    "type": "db",     "label": "Postgres", "at": [10, 3] },
        { "id": "a1", "type": "arrow", "from": "app", "to": "cache" },
        { "id": "a2", "type": "arrow", "from": "app", "to": "db" }
      ],
      "steps": [
        { "at": "app",   "do": "show", "targets": ["app"] },
        { "at": "cache", "do": "show", "targets": ["cache", "a1"] },
        { "at": "miss",  "do": "flow", "path": ["a1"], "label": "GET k" },
        { "at": "miss+0.8", "do": "mark", "target": "cache", "kind": "cross" },
        { "at": "db",    "do": "show", "targets": ["db", "a2"] }
      ]
    }
  ]
}
```

Grid: **16:9 → x 0..12, y 0..6** (centre `[6, 3]`); **9:16 → x 0..6, y 0..10** (centre `[3, 5]`). `at` is the
element's centre. Headings and captions live outside the grid automatically.

Elements: `node` (icon box) · `server` · `db` · `client` (user/laptop/phone/browser) · `queue` · `table` · `code` ·
`list` · `text` · `chip` · `note` · `bars` · `ring` + `marker` (hash/token rings) · `group` (dashed boundary) · `arrow`.
Steps: `show` `hide` `flow` `highlight` `unhighlight` `pulse` `shake` `mark` `unmark` `dim` `undim` `focus` `unfocus`
`move` `set` `reveal` `travel` `span` `unspan`. Step `at`: `"cue"`, `"cue+0.6"`, `"start"`, `"end"`, or seconds.

## Error → fix quick table

| Code | Meaning | Fix |
|---|---|---|
| `OVERLAP` | two visible elements collide | move ≥ the suggested grid units, `size: "s"`, or hide one first |
| `OUT_OF_BOUNDS` | spills off safe area | move toward centre, shorten text, `size: "s"` |
| `UNKNOWN_CUE` | step `at` names a cue not in narration | add `{cue}` to narration or fix the name |
| `DEAD_AIR` / `SLOW_PACING` | static stretch | show what is being said (new element, `flow`, `reveal`) on a cue, or split the sentence; a highlight or pulse only if the words point at something visible |
| `SPOKEN_LIST_UNSEEN` | a list is said but an item isn't on screen | one small element per item, each on its own cue; `hide` them when the narration moves on |
| `ARROW_DANGLING` | arrow visible without both ends | show endpoints first; hide arrows with their endpoints |
| `ARROW_THROUGH` | arrow crosses another element | add `bend` (±0.3–0.6) or reposition |
| `FLOW_HIDDEN` / `FLOW_GAP` | flow over hidden/disconnected arrows | show arrows first; chain arrows end→start; use `reverse` for replies |
| `TEXT_TOO_LONG` | label exceeds limit | shorten; move detail into narration |
| `ICON_UNKNOWN` | icon id not found | `npm run explainer -- icons <word>` and use an exact id |
| `CLUTTER` | too many things on screen | hide/dim finished parts or split the scene |
| `STALE_AUDIO` | narration changed after TTS | re-run `tts` |
| `DURATION` | total length > 10/20% off `targetSeconds` | cut/add narration (~2.9 words per second) |
| `SPARSE_LAYOUT` / `OFF_CENTER` | diagram too small or off-centre | spread out, `size: "l"`, shift all elements by the suggested offset |
| `TRAVEL_RING` / `SPAN_RING` | markers on different rings | travel/span only within one ring |

## Files

- `references/script-craft.md` — the narrative arc, house voice, cue placement, pacing numbers.
- `references/visual-grammar.md` — colour semantics, layout recipes (grid coordinates), motion vocabulary, choreography patterns.
- `references/dsl.md` — every field of every element and step, footprints, limits.
- `references/qa-checklist.md` — what to check on every contact sheet.
- **Themes** (`theme`): `educloud` is the house style for all tech, cloud and AI videos. For other topics set the mood: `chalkboard` general tech · `paper` calm how-tos · `greenboard` lessons · `blueprint` how things are built · `graph` algorithms, finance · `newsprint` news and incidents · `kraft` food, craft · `diner` recipes, restaurants · `comic` myths, kids, high energy · `terminal` security, CLI · `synthwave` AI, gaming, future tech · `aurora` science, space, health · `sunset` lifestyle, wellness. Colour names in a spec work in every theme.
- **Non-technical topics:** use the same grammar with plain language and no jargon or tech metaphors. Use `node` boxes with real-world icons for things, `list` for ingredients or checklists, arrows for "this goes into that", `table` for comparisons, `note` for tips. For a recipe, show ingredients then build up the steps. Exact Lucide ids: lucide:hamburger, lucide:beef, lucide:wheat, lucide:egg, lucide:salad, lucide:carrot, lucide:chef-hat, lucide:cooking-pot, lucide:flame, lucide:utensils, lucide:timer, lucide:thermometer, lucide:sandwich, lucide:pizza, lucide:soup, lucide:fish, lucide:drumstick, lucide:ham, lucide:leaf, lucide:store, lucide:shopping-basket, lucide:heart, lucide:car, lucide:house. Do NOT use lucide:cheese, tomato, lettuce, onion or pickle: they don't exist. Use a labelled box with the closest icon instead.
- `examples/database-sharding.json` — a complete, validated reference episode. Study it before writing your first spec.
