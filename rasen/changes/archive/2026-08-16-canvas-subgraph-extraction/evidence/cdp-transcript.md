# Real-browser CDP transcript — canvas-subgraph-extraction task 5.1

- Date: 2026-08-16T22:41:13.717Z
- App: http://127.0.0.1:4524 (in-process `rasen ui --no-open --no-daemon --port 4524` from this worktree, serving this worktree's freshly built `packages/ui/dist` — chunk `PipelineCanvasPage-DdRc9JQM.js`, verified to contain `v2-extract-review-panel`)
- Browser: throwaway Chrome 151 headless (`--remote-debugging-port=9338` + fresh temp `--user-data-dir`); ports 9333-9337 were busy with other sessions' checks, so this run owned 9338. The user's daily Chrome was never touched.
- Route: `/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/cdp-extract-check` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).
- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).

## Steps

- PASS — authoring setup produced four nodes (nodes=4)
- PASS — three handle-to-handle drags produced the chained edges (["atomic-stage:done->atomic-stage-2:input","atomic-stage-2:done->atomic-stage-3:input","atomic-stage-3:done->finish:input"])
- PASS — box drag starts on the pane, not on a node
- PASS — box rectangle contains the pair and intersects no other node (from=(847,420) to=(1263,568))
- PASS — the middle pair is the selection (box-select, Control+click-corrected when RF dropped a node) (attempt1=["atomic-stage-3"] attempt2=["atomic-stage-3"] attempt3=["atomic-stage-3"] corrected=["atomic-stage-2","atomic-stage-3"])
- PASS — selection panel offers "Package into reusable block" (Package into reusable block)
- PASS — review defaults the declaration id to "block" (block)
- PASS — review summary states stages, internal connections, and the derived cut (2 stages · 1 internal connection · cut: 1 input, 1 outcome)
- PASS — review derived the outcome named after the severed source stage (atomic-stage-3)
- PASS — success toast names the declaration (Packaged 2 stages into 'block'.)
- PASS — review dialog closed after confirm
- PASS — root graph is upstream, finish, and one ref (["atomic-stage","finish","composite-ref"])
- PASS — the ref IS the selection after confirm (["composite-ref"])
- PASS — the ref node panel is open (composite-ref)
- PASS — ref renders the derived input port (named after the severed target stage)
- PASS — ref renders the EDITED outcome port as its source handle
- PASS — root rewired upstream->ref and ref->finish (["atomic-stage:done->composite-ref:atomic-stage-2","composite-ref:complete->finish:input"])
- PASS — declarations panel lists the extracted block as a custom row (custom)
- PASS — insert action added a second ref to the same declaration (["atomic-stage","finish","composite-ref","composite-ref-2"])
- PASS — tab is alive after the full pass (no listener freeze)

## Screenshots

01-not-found.png, 02-authored-chain.png, 03-pair-selected-package-offered.png, 04-review-open-with-defaults.png, 05-extracted-rewired.png, 06-second-ref-inserted.png

## Result: ALL CHECKS PASSED
