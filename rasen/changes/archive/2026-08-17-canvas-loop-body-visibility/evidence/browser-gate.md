# Browser gate — canvas-loop-body-visibility (task 5.2)

Port 9354 server (`node bin/rasen.js ui --no-open --no-daemon --port 9354`,
serving the freshly built `packages/ui/dist`), throwaway Chrome 151
`--window-size=1600,1000` with a fresh user-data-dir, CDP on 9355, direct
WebSocket driver. The project route derived from the `?space=` query param
(child-2's handoff: the entry pathname is `/`; deriving from it 404s the SPA
route).

Driver + transcript: `.rasen/changes/canvas-loop-body-visibility/ephemera/`
(`body-visibility-browser-gate.mjs`, `gate-final.log`; screenshots
`01-…png`…`12-…png`).

## Flow (all gates green, one run, final clean build)

1. **Gates 1-4** — entry, pipelines page, new pipeline (`body-visibility-gate-…`),
   empty canvas, two stages from the palette.
2. **Gates 5-7** — forward edge, refused back-edge → loop review, inline-declare
   `done`, confirm.
3. **GATE 8 — the loop opens EXPANDED** (the moment-of-formation default):
   the frame card carries its header strip + collapse chevron
   (`stage-node-frame-toggle` data-expanded="true"), explicit rendered size
   668×208 (>> the compact 200×92), BOTH body children as namespaced flow
   nodes (`bounded-loop::atomic-stage`, `bounded-loop::atomic-stage-2`), the
   internal connection rendered as `body:bounded-loop:atomic-stage:done->atomic-stage-2:input`,
   both clickable body cards, and the node's EXTERNAL handles intact (entry
   `atomic-stage` control-typed target, exit `done` source).
4. **GATE 9 — body selection**: clicking a body card opens the read-only
   panel with the stage's facts (`data-stage=atomic-stage-2`,
   `data-declaration=loop-body`, kind AtomicStage, capability id, the
   future-change note); the panel offers exactly one button (close); closed
   before any further interaction.
5. **GATE 10 — collapse**: the compact card returns (rendered width ≤ 260,
   no frame chrome, chevron data-expanded="false"), zero body children and
   zero body edges, target/source handle sets byte-identical to pre-collapse,
   external edges unchanged.
6. **GATE 11 — re-expand**: children and the body edge return (asserted by
   id).
7. **GATES 12-13 — composite-ref symmetry**: two fresh stages, click +
   Control-click selection, package-into-reusable-block → the replacing
   `composite-ref` opens EXPANDED (auto-expand at formation covers the
   extraction path too) with its body children namespaced
   `composite-ref::…` and its `body:composite-ref:…` edge; manual collapse
   and re-expand through its own chevron both verified.

## Two real product defects the gate caught (both fixed in this change)

- **The body edge did not render after synthesis** (frame + children visible,
  store held the edge, zero `.react-flow__edge` elements): React Flow's
  controlled adoption re-initializes any node whose object identity changed,
  clearing `measured`/`handleBounds`; the per-render node-object churn from
  the affordance wiring kept re-adopting, and a re-observed element whose
  size did not change never re-delivers its ResizeObserver observation — the
  body children's `handleBounds` never landed, and an edge whose endpoint is
  uninitialized renders NOTHING. Fixed three ways, composing:
  1. the wiring is memoized on `flowNodes` with stable (`useCallback([])`)
     callbacks reading live state through a ref — the nodes-prop identity now
     changes exactly when the flow rebuilds, never on unrelated renders;
  2. `recomputeFlow` carries `measured` across rebuilds by id (adoption keeps
     `handleBounds` alive through rebuilds);
  3. `CanvasFlow` forces one batched `useUpdateNodeInternals` refresh when
     the node ID SET changes (mount/add/remove/expand/collapse) — measurement
     is deterministic instead of observer-dependent.
  Proven live: the edge renders at GATE 8 on the first post-confirm commit,
  and a forced size-nudge experiment (the old failure mode's reproducer) is
  no longer needed.
- **The body panel opened and closed again intermittently**: the body click's
  own `replaceSelection([])` re-fires the selection listener against the
  render's pre-replace mirror; reading that as a "selection change" wiped
  `bodySelection` one commit after it opened. Fixed: only a selection WITH
  CONTENT clears the body panel in `onSelectionChange` (the pane-click
  handler owns the empty case).

## Driver traps recorded (for the next gate)

- **`Page.bringToFront` is REQUIRED.** Preact schedules renders through
  `requestAnimationFrame`, and Chrome suspends rAF in an occluded tab: state
  updates landed but did not PAINT until some unrelated timer flushed them
  (observed as the body panel opening ~2.4s after the click — exactly the
  toast-dismiss timer — while the DOM queries raced). Every UI-state
  assertion in an unfocused tab is a lottery without it.
- CDP `Input.dispatchMouseEvent` takes a modifier BITMASK (Shift=8, Ctrl=2),
  never an array — `modifiers: []` / `['Shift']` both return "Invalid
  parameters".
- The dirty editor's `beforeunload` guard turns any navigation away from a
  leftover dirty canvas into a BLOCKED debugger session (the modal stops even
  `Runtime.enable`); the driver now auto-accepts `Page.javascriptDialogOpening`
  and each run uses a fresh user-data-dir.
- Clicks in the ~2.5s post-confirm window (toast auto-dismiss churn) are
  unreliable; the gate settles 3.2s before the body-card click and uses
  click-retry + `waitFor` for every chevron interaction.
- Don't run the browser gate concurrently with the full vitest suite —
  `Page.captureScreenshot` times out under the CPU contention.
