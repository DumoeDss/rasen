# Real-browser CDP transcript — canvas-durable-node-positioning task 5.1

- Date: 2026-08-17T05:25:56.137Z
- App: http://127.0.0.1:9345 (in-process `rasen ui --no-open --no-daemon --port 9345` from this worktree, serving this worktree's freshly built `packages/ui/dist`)
- Browser: throwaway Chrome 151 headless (`--remote-debugging-port=9346` + fresh temp `--user-data-dir`, `--window-size=1600,1000`). Ports 9333-9344 were consumed by sibling sessions' checks; child 1 owned 9345/9346 and released them, this run re-verified both free and re-owned them. The user's daily Chrome was never touched.
- Route: `/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/cdp-durable-positioning` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).
- Driver: this script (direct CDP over localhost). Real drag physics (`Input.dispatchMouseEvent` press/move/release), real typed input (`Input.insertText`) and real Tab blur for the rename — the Preact-delegation trap from child 1's probe. Panels closed and elementFromPoint reachability verified before every coordinate interaction; re-fit-view before drags.
- Zoom during the drag: 1.68447 (expected flow delta = screen delta / zoom).

## Durable placement end-to-end (real React Flow)

- PASS — the palette offers a stage gesture (v2-palette-gesture-stage-rasen-propose)
- PASS — the three fresh stages render at finite computed layout transforms ({"atomic-stage":"translate(0px, 0px)","atomic-stage-2":"translate(0px, 140px)","atomic-stage-3":"translate(0px, 280px)"})
- PASS — the drag physically moved the node (real drag physics, direction matches) (moved translate(0px, 0px) -> translate(135.354px, 77.7695px) (flow delta 135.4,77.8; screen delta 260,150 at zoom 1.68447))
- PASS — the dragged node keeps its exact transform across the palette-add rebuild (translate(135.354px, 77.7695px) -> translate(135.354px, 77.7695px))
- PASS — the added node renders at a finite layout position, distinct from the dragged placement (translate(0px, 420px) (vs dragged translate(135.354px, 77.7695px)))
- PASS — the rename produced the new id and the old id is gone (mover present: true)
- PASS — the dragged node keeps its exact transform through the rename (placement follows the id) (translate(135.354px, 77.7695px) -> translate(135.354px, 77.7695px))
- PASS — Re-layout returns the dragged node to computed layout (leaves the author placement) (translate(135.354px, 77.7695px) -> translate(0px, 0px))
- PASS — the never-dragged neighbor stays at its computed layout across Re-layout (translate(0px, 140px) -> translate(0px, 140px))
- PASS — after Re-layout a later edit never resurrects the departed placement (translate(0px, 0px) (dragged spot was translate(135.354px, 77.7695px)))
- PASS — the node re-added under the freed id lands on computed layout, not the departed placement (translate(0px, 560px) (the departed spot was translate(135.354px, 77.7695px)))
- PASS — tab is alive after the full pass (no listener freeze)

## Screenshots

01-after-drag.png, 02-after-followup-add.png, 03-after-rename.png, 04-after-relayout.png, 05-after-fifth-add-no-resurrection.png

## Result: ALL CHECKS PASSED
