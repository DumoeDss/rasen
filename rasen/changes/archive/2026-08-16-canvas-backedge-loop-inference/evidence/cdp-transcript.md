# Real-browser CDP transcript — canvas-backedge-loop-inference task 5.1

- Date: 2026-08-16T23:28:25.720Z
- App: http://127.0.0.1:4531 (in-process `rasen ui --no-open --no-daemon --port 4531` from this worktree, serving this worktree's freshly built `packages/ui/dist` — chunk `PipelineCanvasPage-DoKwXOt1.js`, verified to contain `v2-loop-review-panel`)
- Browser: throwaway Chrome 151 headless (`--remote-debugging-port=9339` + fresh temp `--user-data-dir`); ports 9333-9338 were busy with sibling sessions' checks, so this run owned 9339. The user's daily Chrome was never touched.
- Route: `/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/cdp-backedge-check` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).
- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).

## Phase A — m2 box-select repeat-probe (FIRST, per the portfolio standing order)

- middle pair: geometry verified; expected ["atomic-stage-2","atomic-stage-3"]; got ["atomic-stage-3"]; full membership **NO**
- singleton: geometry verified; expected ["atomic-stage-3"]; got []; full membership **NO**
- region triple: geometry verified; expected ["atomic-stage-2","atomic-stage-3","atomic-stage-4"]; got ["atomic-stage-3","atomic-stage-4"]; full membership **NO**

**The containment miss REPRODUCED.** Recorded here and routed to child 1 (canvas-multi-selection) as a follow-up — NOT fixed in this change, per the standing order. This change's back-edge flow does not lean on box-select and proceeded unaffected.

## Phase B — back-edge loop inference end-to-end

- PASS — four handle-to-handle drags produced the chained edges (["atomic-stage:done->atomic-stage-2:input","atomic-stage-2:done->atomic-stage-3:input","atomic-stage-3:done->atomic-stage-4:input","atomic-stage-4:done->finish:input"])
- PASS — m2 repeat-probe ran three verified rectangles (middle pair:full=false; singleton:full=false; region triple:full=false)
- PASS — m2 CONTAINMENT MISS REPRODUCED — recorded, routed to child 1 (not fixed here) ([{"label":"middle pair","selected":["atomic-stage-3"]},{"label":"singleton","selected":[]},{"label":"region triple","selected":["atomic-stage-3","atomic-stage-4"]}])
- PASS — draw-time refusal toast stands (Rejected: atomic-stage-4 → atomic-stage-2 would create a cycle)
- PASS — review shows the drawn back-edge endpoints (Drawn back-edge: atomic-stage-4 → atomic-stage-2)
- PASS — review shows the enclosed region (3 stages, endpoints included, finish excluded) (Enclosed region (3): atomic-stage-2, atomic-stage-4, atomic-stage-3)
- PASS — review defaults the declaration id to "loop-body" (loop-body)
- PASS — review defaults the iteration bound to 3 (3)
- PASS — review defaults the exit outcome to the first definition outcome (done)
- PASS — review derived the outcome named after the severed source stage (atomic-stage-4)
- PASS — an invalid bound blocks confirm in the real browser ({"invalid":"true","confirm":true,"error":"Max iterations must be a positive integer."})
- PASS — success toast names the loop synthesis (Loop created from back-edge over 3 stages ('loop-body').)
- PASS — review dialog closed after confirm
- PASS — root graph is lead, finish, and one bounded-loop (the region left the root) (["atomic-stage","finish","bounded-loop"])
- PASS — the loop IS the selection after confirm (["bounded-loop"])
- PASS — the loop node panel is open (bounded-loop)
- PASS — the loop's properties panel shows the author's repaired bound (5)
- PASS — loop renders the derived input port (named after the severed target stage)
- PASS — loop renders the derived outcome port as its source handle
- PASS — root rewired lead->loop and loop->finish; no back-edge edge exists (["atomic-stage:done->bounded-loop:atomic-stage-2","bounded-loop:atomic-stage-4->finish:input"])
- PASS — declarations panel lists the loop body as a custom row (custom)
- PASS — the explicit palette loop gesture still mints a BoundedLoop over the body declaration (["atomic-stage","finish","bounded-loop","bounded-loop-2"])
- PASS — tab is alive after the full pass (no listener freeze)

## Screenshots

01-not-found.png, 02-authored-chain.png, 03-m2-probe-done.png, 04-review-open-with-defaults.png, 05-invalid-bound-blocks-confirm.png, 06-loop-synthesized-rewired.png, 07-explicit-gesture-still-works.png

## Result: ALL CHECKS PASSED (m2 probe REPRODUCED — routed to child 1)
