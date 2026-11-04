# Real-browser CDP transcript — canvas-parallel-frontier-inference task 4.1

- Date: 2026-08-17T01:02:55.219Z
- App: http://127.0.0.1:4550 (in-process `rasen ui --no-open --no-daemon --port 4550` from this worktree, serving this worktree's freshly built `packages/ui/dist` — chunk `PipelineCanvasPage-BLQjnmM9.js`, verified to contain `Run in parallel`)
- Browser: throwaway Chrome 151 headless (`--remote-debugging-port=9341` + fresh temp `--user-data-dir`, `--window-size=1600,1000`); ports 9333-9340 were busy with sibling sessions' checks, so this run owned 9341. The user's daily Chrome was never touched.
- Route: `/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/cdp-parallel-frontier-check` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).
- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).

## The frontier flow end-to-end

- PASS — the first dispatch half (S -> b1) offers nothing
- PASS — the first barrier half (b1 -> T) offers nothing (one clean branch)
- PASS — the first chain drew exactly two edges (["atomic-stage:done->atomic-stage-2:input","atomic-stage-2:done->finish:input"])
- PASS — the second dispatch half (S -> b2) still offers nothing
- PASS — the completing reconverge (b2 -> T) surfaces the non-blocking offer (Detected a parallel frontier: atomic-stage fans out to 2 branches that reconverge at finish.Run in parallel×)
- PASS — the offer action is labeled "Run in parallel" (Run in parallel)
- PASS — review shows the read-only route S -> fan-out -> 2 branches -> barrier -> T (atomic-stage → fan-out → 2 branches → barrier → finish)
- PASS — both branches default required (createParallelPair own default) ([{"id":"atomic-stage-2","checked":true},{"id":"atomic-stage-3","checked":true}])
- PASS — review defaults the cap to max(1, min(3, 2)) = 2 (2)
- PASS — review defaults the budget to max(1, 2) = 2 (2)
- PASS — review defaults proceed to the first definition outcome (done)
- PASS — review defaults failed to the second definition outcome (archived)
- PASS — the flipped branch reads optional in the review (false)
- PASS — success toast names the frontier synthesis (Parallel frontier created over 2 branches.)
- PASS — review dialog closed after confirm
- PASS — root graph keeps S, both branches, T, and adds fan-out + join (["atomic-stage","atomic-stage-2","atomic-stage-3","finish","fan-out","join"])
- PASS — the fan-out IS the selection after confirm (["fan-out"])
- PASS — the fan-out node panel is open (fan-out)
- PASS — the drawn sandwich is gone — no S->b or b->T edge survives (["atomic-stage:done->fan-out:input","fan-out:atomic-stage-2->atomic-stage-2:input","atomic-stage-2:done->join:atomic-stage-2","fan-out:atomic-stage-3->atomic-stage-3:input","atomic-stage-3:done->join:atomic-stage-3","join:done->finish:input"])
- PASS — the four wiring families are present with exact endpoint/port ids (["atomic-stage:done->fan-out:input","fan-out:atomic-stage-2->atomic-stage-2:input","atomic-stage-2:done->join:atomic-stage-2","fan-out:atomic-stage-3->atomic-stage-3:input","atomic-stage-3:done->join:atomic-stage-3","join:done->finish:input"])
- PASS — the fan-out renders one dispatch handle named by the branch id
- PASS — the join renders one barrier handle named by the branch id
- PASS — the review's optional flip landed in the pair's contract (required: b1 only) (required: atomic-stage-2)
- PASS — the panel edits membership metadata (b2 back to required) (required: atomic-stage-2, atomic-stage-3)
- PASS — removing the branch from the pair drops its dispatch handle
- PASS — re-adding the branch restores its dispatch handle
- PASS — the palette gesture mints the second pair beside the inferred one (["atomic-stage","atomic-stage-2","atomic-stage-3","finish","fan-out","join","fan-out-2","join-2"])
- PASS — tab is alive after the full pass (no listener freeze)

## Screenshots

01-not-found.png, 02-first-branch-drawn-no-offer.png, 03-completing-edge-offer.png, 04-review-open-with-defaults.png, 05-frontier-synthesized.png, 06-membership-edited-through-panel.png, 07-explicit-gesture-still-works.png

## Result: ALL CHECKS PASSED
