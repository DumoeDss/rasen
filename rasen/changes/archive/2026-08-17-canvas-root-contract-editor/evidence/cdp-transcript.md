# Real-browser CDP transcript — canvas-root-contract-editor task 6.1

- Date: 2026-08-17T04:19:38.175Z
- App: http://127.0.0.1:9345 (in-process `rasen ui --no-open --no-daemon --port 9345` from this worktree, serving this worktree's freshly built `packages/ui/dist`)
- Browser: throwaway Chrome headless (`--remote-debugging-port=9346` + fresh temp `--user-data-dir`, `--window-size=1600,1000`); ports 9333-9344 were consumed by sibling sessions' checks, so this run owned 9345 (app) and 9346 (CDP). The user's daily Chrome was never touched.
- Route: `/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/cdp-root-contract-editor` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).
- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).

## The undeclared-terminal-outcome flow end-to-end (real engine)

- PASS — the fresh definition declares no outcomes (blank seed) ("")
- PASS — the palette offers a stage gesture (v2-palette-gesture-stage-rasen-propose)
- PASS — exactly the two unconnected stage sinks are on the canvas (["atomic-stage","atomic-stage-2"])
- PASS — no connections were drawn (unconnected sinks) (0)
- PASS — the real engine raises the PORT_MISMATCH naming terminal outcome done (errorPORT_MISMATCHDefinition graph produces terminal outcome 'done', but it is not declared by the owner contract./root/nodes/0/capability/root/nodes/1/capability The same undeclared terminal outcome is also produced here.atomic-stage →)
- PASS — the PORT_MISMATCH issue offers navigation to its target
- PASS — the issue click selects the producing sink node (atomic-stage)
- PASS — the Finish-here offer renders (empty contract state)
- PASS — no dead-end outcome select is rendered
- PASS — the empty state states that no outcomes are declared (The definition declares no outcomes yet, so there is no endpoint to name. Declare one in the definition contract panel:Locate outcome list)
- PASS — the locate action focuses the definition outcomes field (definition-outcomes)
- PASS — the definition contract panel is on-screen
- PASS — the outcomes field commits done on blur ("done")
- PASS — the sink offer now offers exactly the declared outcome (["done"])
- PASS — the PORT_MISMATCH is gone after the declare (["warningDropping unknown workflow id(s) from stored profile: codebase-design, navigator, prototype, tdd, workflow-review/"])
- PASS — the result chip reports zero errors (✕ 0 errors · 1 warning)
- PASS — no other edit was made (the same two nodes, still unconnected) (["atomic-stage","atomic-stage-2"])
- PASS — tab is alive after the full pass (no listener freeze)

## Screenshots

01-port-mismatch.png, 02-issue-node-panel-empty-sink.png, 03-locate-focused.png, 04-declared-validate-clean.png

## Driver notes (one iteration before this green run)

The first run failed 3/20 checks, all downstream of one driver defect: it set the
outcomes field with the sibling drivers' old pattern (native `value` setter +
synthetic `new Event('input')` + programmatic `el.blur()`). In this browser the
synthetic input/blur events never reach Preact's `onInput`/`onBlur` delegation:
the DOM value displayed the typed text while the component's local draft stayed
empty, so the blur commit parsed the empty draft and was a no-op (the sink select
stayed `[]` and the engine still raised PORT_MISMATCH on the second Validate).
A live-tab probe separated the variables: real CDP `Input.insertText` + a real
Tab key commit correctly. The driver now types with `Input.insertText` and blurs
with a real Tab (see its header). Nothing in the PRODUCT changed between runs —
the rerun above is the same build, fresh tab, fresh pipeline.

## Result: ALL CHECKS PASSED
