# Real-browser verification — canvas-authoring-surface (2026-08-16)

Method: throwaway Chrome instance (separate profile, port 9250) driven via the
repo's CDP proxy (`skills/experts/chrome-use/scripts/cdp-proxy.mjs`, port
3457), against a `rasen ui` daemon serving this worktree's own build. No
playwright/puppeteer. The user's everyday Chrome profile/session was never
touched.

- Chrome: `Chrome/151.0.7922.75` (`GET http://127.0.0.1:9250/json/version`)
- App: `rasen ui` daemon, `dist/` built from this worktree (`packages/ui`)
- Route: `http://127.0.0.1:8791/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/canvas-eval-demo`
- Definition opened: `canvas-eval-demo` (v2 pipeline), edit mode. Confirmed
  present at open: declaration rows (built-in `review-cycle-body`) and
  contract rows (inputs/artifacts/outcomes), satisfying the precondition for
  10.4/10.5 ("declarations and contract rows present").
- Viewport: `innerWidth=1424, innerHeight=805`

## Task 1.5 — no page-level scroll in v2 edit mode

Measured directly in the live page (`documentElement.scrollHeight` vs.
`window.innerHeight`):

```
docScrollHeight: 805
innerHeight:     805
```

`805 === 805` — the document itself does not scroll; only the authoring
column scrolls (`overflow-y: auto`, confirmed below). **Result: PASS.**

## Task 10.4 — authoring column is a fixed, independently-scrolling rail

Measured via `getComputedStyle` on `.pipeline-canvas__authoring-contracts`
and the flow column, in the same page load as the 1.5 measurement:

```
authoringWidth (measured):        280   px
computedAuthoringOverflowY:       "auto"
computedAuthoringFlexShrink:      "0"
flowWidth (measured):             856   px
```

- Authoring column is a **fixed 280px** rail (design D1), not the pre-fix
  ~800px unconstrained flex item described in `proposal.md`'s "before" state.
- `overflow-y: auto` and `flex-shrink: 0` are the live computed values, not
  just present in the stylesheet source.
- The flow column (856px) measures wider than the authoring column (280px).

All three required D8 measurements are satisfied. **Result: PASS.**

## Task 10.5 — gesture and property-affordance parity against the real app

All four root gestures and all three property affordances were exercised
once each in this browser session, each verified against a live DOM-state
change immediately after the action (not inferred):

| Affordance | Action | Live verification |
|---|---|---|
| Stage gesture | clicked `v2-palette-gesture-stage-<skillId>` | new `[data-testid="rf__node-atomic-stage"]` node appeared in the React Flow graph |
| Parallel gesture | clicked `v2-palette-gesture-parallel` | new `fan-out` + `join` node pair appeared (FanOut/Join, as `addParallelFrontier` specifies) |
| Loop gesture | clicked `v2-palette-gesture-loop` | new `bounded-loop` node appeared |
| Finish gesture | clicked `v2-palette-gesture-finish` | new `finish-2` node appeared |
| Stage gate checkbox | toggled `v2-node-panel-gate-toggle` on a stage | re-queried panel state confirmed the toggle persisted (a `Gate` node targeting that stage was added to the graph) |
| Connection condition | drew a `propose → apply` edge via a real CDP `Input.dispatchMouseEvent` drag (synthetic `PointerEvent`s do not trigger React Flow's connection drag — see finding below), selected it, set `v2-connection-panel-condition` | re-queried the field confirmed the expression persisted |
| Declaration insert | used a declaration row's "Insert into graph" action | confirmed a new `CompositeRef` node referencing that declaration appeared |

Final live declaration list (`[data-testid=declaration-row]`), confirming the
insert genuinely happened and persisted for the rest of the session:

```
review-cycle-body (built-in)
eval-loop-body                 <- inserted this session
```

**All 7 interactions are independently confirmed against the real app** —
this is the core parity claim of 10.5, and it holds.

### Not captured: "resulting definition JSON" artifact

The task also asks to capture the resulting definition JSON as an evidence
artifact. This sub-step is **not completed** — reporting honestly rather than
fabricating a JSON blob:

- **Save does not persist to the expected location.** Clicking
  `pipeline-canvas-save` shows the normal "saved" UI transition (Save
  disables, Discard enables), but `C:\Users\Sayo\.rasen\pipelines\canvas-eval-demo\pipeline.yaml`
  is never modified — confirmed by `LastWriteTime` staying pinned to before
  any of this session's edits, both before and after clearing the draft's
  validation errors. Checked and ruled out: the project-scoped location
  implied by `mode: "in-repo"` for this project in
  `C:\Users\Sayo\.rasen\projects\registry.json` (both the main-repo checkout
  root and the project's `home` directory,
  `C:\Users\Sayo\.rasen\projects\openspec-code-1e42477e\`) — neither contains
  a `canvas-eval-demo` pipeline file. Where Save actually writes for a
  project-scoped v2 canvas pipeline in this build is unresolved.
- **Export requires a prior save of a validated draft**
  (`pipeline-canvas-export-message`: "Save the validated draft before
  exporting it."), so it depends on the same unresolved persistence path
  above and could not be used as a workaround.
- Combining all four gestures onto one draft (needed to exercise each once)
  produces real `PORT_MISMATCH` validation errors (the new `fan-out`'s
  branches reference outcomes the owner contract doesn't declare, etc.) — an
  expected consequence of composing gestures ad hoc rather than wiring a
  coherent graph, not a product defect. This keeps `v2DefinitionValid` false
  and the Export button gated off for as long as the draft carries all four
  additions at once.

Given the persistence-path uncertainty is itself unresolved (and risks being
mistaken for something it verified rather than something it didn't), 10.5 is
left unticked in `tasks.md`. The gesture/affordance parity evidence above —
independently verified via live DOM state, not jsdom — is genuine and
complete; only the JSON-artifact sub-step is outstanding.

## Findings for future real-browser verification work

1. **Worktree UI packages need an explicit module-resolution check before
   trusting a served build.** `node_modules/@atelierai/rasen-ui` in a worktree
   can resolve to a *different* worktree's/checkout's build of
   `packages/ui` (pnpm workspace linking), silently serving stale/wrong UI
   under a correctly-running daemon. Verify the served asset hashes/CSS
   against the worktree's own `dist/assets/` before trusting any measurement,
   especially after switching worktrees.
2. **Hash-only URL navigation does not reload the document, even with
   `Page.reload({ignoreCache:true})`.** Chrome treats a same-path,
   different-`#fragment` navigation as same-document; `performance.getEntriesByType('navigation')`
   and stale `<script src>`/`<link href>` hashes will silently prove this.
   Navigate to `about:blank` first, then to the real target URL, to force a
   genuine cross-document reload with a new `loaderId`.
3. **React Flow's connection-drag is not triggerable via synthetic
   `PointerEvent`s dispatched in page JS.** A real CDP `Input.dispatchMouseEvent`
   down → move(×N) → up sequence, via a second independent WebSocket
   connection to the browser-level debugger endpoint (`Target.attachToTarget`
   with `flatten:true`), is required to draw an edge for real.

## Cleanup performed

- Throwaway Chrome instance (port 9250) and its temp profile: terminated.
- Pinned `cdp-proxy.mjs` process (port 3457): terminated.
- Temporary helper scripts (`cdp-drag-connect.mjs`, `cdp-key-press.mjs`) in
  `%TEMP%`: deleted.
- `rasen ui` daemon (PID 52020) and the `node_modules/@atelierai/rasen-ui`
  junction: see final report to `main` for disposition.
