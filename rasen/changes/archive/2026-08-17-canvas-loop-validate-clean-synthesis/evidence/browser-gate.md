# Browser gate — canvas-loop-validate-clean-synthesis (task 6.2)

Date: 2026-08-17. Build: `pnpm --dir packages/ui run build` on the working
tree. Serve: `node bin/rasen.js ui --no-open --no-daemon --port 9352` (fresh
ports — child-1 had consumed 9349/9350/9351). Browser: throwaway headless
Chrome 151 (`--window-size=1600,1000`, fresh user-data-dir, direct CDP
9353). Driver + screenshots:
`.rasen/changes/canvas-loop-validate-clean-synthesis/ephemera/`
(`zero-edit-browser-gate.mjs`, `01`–`09*.png`) — child-1's proven
`browser-gate.mjs` scaffolding (fit-view + in-pane guards before every
drag) with the three author edits of `author-edits-to-green.mjs`
DELIBERATELY absent: their work is now done by the synthesis itself.

## The zero-edit flow, as driven through the real UI

1. Entry URL → space bootstrap → `/p/<project>/pipelines` → **New
   pipeline** (`loop-clean-gate`) → empty v2 canvas (0 nodes asserted).
2. Two stages from the palette Stage gesture (first enabled skill card,
   capability `skill:rasen-propose`): `atomic-stage`, `atomic-stage-2`;
   forward edge drawn as a real CDP handle drag.
3. Back-edge `atomic-stage-2 → atomic-stage` → refused → the review opened
   with the engine-clean derived rows (screenshot `04-review-open.png`):
   - entry input `atomic-stage` (the back-edge's target — child-1's naming,
     kept) **typed `ecp/control`** (the class-2 fix; was the port name
     `'input'`),
   - outcome rows **`done`** — the body's producible terminal outcome (the
     class-1 fix; was the back-edge source id, unproducible),
   - the declare-notice line: "Confirming will declare iteration-limit …"
     (the class-3 transparency).
4. Blank drafts declare no outcomes, so the review's own inline declare
   exercised once for `done` (the one review-time design input the
   acceptance allows), then **Create loop** — no other edit anywhere.
5. The loop rendered BOTH handles (screenshot `05-loop-node.png`): target
   `atomic-stage`, source `done`; card labels `in: atomic-stage / out: done`.
6. A third stage connected onto the entry handle
   (`atomic-stage:done->bounded-loop:atomic-stage`), a palette Finish added,
   and the loop onward onto it (`bounded-loop:done->finish:input`) — real
   CDP drags both (screenshots `06`, `07`).
7. **Validate: `✕ 0 errors · 1 warning`** (screenshot `08`) — the 1 warning
   is this machine's known unrelated workflow-profile warning ("Dropping
   unknown workflow id(s) from stored profile…"), present on every
   validation on this box including child-1's green endpoint; the assertion
   is on the error count, never on "no issues at all".
8. The palette Loop gesture over the just-created well-formed declaration
   body minted `bounded-loop-2` and **Validate again: `✕ 0 errors · 1
   warning`** (screenshot `09`) — the shared-mint-layer fix covers the
   gesture live, matching the core pin.

## Result

**ZERO-EDIT BROWSER GATE PASS** on the first complete run (after one driver
fix: the project route is derived from the `?space=` param, not the entry
pathname). Child-1's variant table measured the same wired shape at 6
errors unedited → 0 only after three authored contract repairs; this change
delivers the 0 with zero contract edits for both gestures.
