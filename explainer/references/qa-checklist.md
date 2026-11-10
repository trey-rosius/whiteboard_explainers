# Visual QA checklist (run on every contact sheet)

`npm run explainer -- qa <spec.json>` renders one PNG per scene into `out/explainer/<id>/qa/`. Each tile is a key
moment, labelled with its time and the step(s) that just fired. Look at **every** tile and answer each question.
Fix the spec, re-run `qa` for that scene (`--scene <id>`), repeat until all pass.

## Per tile

1. **Does the tile show exactly what the narration is saying at that moment?** (Read the caption strip.)
   If the picture lags or leads the words, move the cue.
   If the narrator names things (especially a list), can you see each one? A pulse on a box is not an illustration.
2. **Is there one obvious focal point?** A highlighted element, a moving packet, or the newest element. If the eye
   doesn't know where to go, dim the rest or use `focus`.
3. **Is the screen choked?** More than about 6 things at once means something finished should have been hidden.
   **Is anything cramped, clipped, touching, or awkwardly close?** (The harness moves notes clear of arrows and neighbours itself; don't place a note on an arrow's path.)
   Spread the composition; use the layout recipes.
4. **Is the composition balanced?** The diagram should sit near the centre of the frame, not hug one edge or the
   top. Shift the whole group by the same grid offset if needed.
5. **Are arrows clean?** No arrow through a label, no long diagonals crossing others; use `bend` or reposition.
6. **Is every label readable in under a second?** ≤ 3–4 words, no jargon soup.
7. **Do colours follow the semantics?** (red = bad, green = good, yellow = attention.) Is there colour noise?

## Per scene

8. Does the final tile ("END") summarise the scene's idea on its own, without the audio?
9. Does something change on almost every tile? Long runs of identical tiles = dead air.
10. If the next scene uses `continue`, does this end state make a good starting board for it?

## Whole video

11. Same entity → same id, same colour, same position across scenes.
12. The worked example's values (ids, numbers, keys) are consistent everywhere.
13. Recap matches what was actually taught.

When all tiles pass, render. After rendering, watch at least the first 20 seconds and one mid-video scene with
sound: check voice/visual sync, SFX loudness, and that nothing pops or flickers between scenes.
