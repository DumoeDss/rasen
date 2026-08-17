# Handoff — implementer-1, canvas-sink-finish-inference (apply, DONE)

## State at stand-down

- 8/8 tasks complete (`rasen/changes/canvas-sink-finish-inference/tasks.md` all
  `[x]`), `rasen validate` green, apply state `all_done`.
- Working tree carries the full implementation UNCOMMITTED (shipper's job):
  exactly 5 files, 779 insertions / 0 deletions (purely additive):
  - `packages/ui/src/canvas/draft.ts` — new `===== Sink promotion =====` section
    at EOF: `PROMOTABLE_SINK_KINDS` (`AtomicStage`+`Join`), `isPromotableSink`
    (root lookup + kind + zero out-edges via the ONE `buildAdjacency`),
    `promoteSinkToFinish` (re-validates sink + outcome ∈ def.outcomes non-blank;
    appends `{ id: v2NodeIdFor('Finish'), kind: 'Finish', outcome: picked }` —
    exactly `addFinishNode`'s shape; wires sink→Finish; Join sources its
    `outcomes.proceed` VALUE per `layout.ts:256-268`, AtomicStage sources
    `CONTROL_SOURCE_PORT`, Finish target is `CONTROL_TARGET_PORT`).
  - `packages/ui/src/canvas/V2NodePanel.tsx` — optional `sinkPromotion?: {
    outcomes; onPromote }` prop group + `SinkPromotionSection` (presentational;
    `data-testid="v2-node-panel-sink-promotion"`, select
    `v2-node-panel-sink-outcome` defaulting to outcomes[0] with the same
    authoritative-reset discipline as the panel's id draft, confirm
    `v2-node-panel-sink-confirm` disabled on blank pick).
  - `packages/ui/src/canvas/PipelineCanvasPage.tsx` — imports,
    `selectedV2SinkOutcomes` memo (the ONE `isPromotableSink` call site),
    `confirmSinkPromotion` (model refusal → toast, draft unchanged; success →
    setDraft + setSelection + `recomputeFlow(next, catalog, nextSelection)`
    selectionOverride pairing + `markDraftChanged()` + plain toast
    "Finish added for this endpoint."), prop pass at the V2NodePanel render.
  - Tests: `packages/ui/test/canvas/draft.test.ts` (+12: truth table incl.
    body-graph/FanOut/Finish negatives, gesture-shape toEqual pin, exact
    connection ids, barrier proceed-VALUE pin, refusal strings,
    not.toHaveProperty('legacyRuntimeOwner'), updateV2NodeFields patch,
    id collision) and `packages/ui/test/canvas/pipeline-canvas-page.test.tsx`
    (+3: section presence/absence incl. loop end, POST-body walk with the
    legacyRuntimeOwner guard + Finish-selected-panel-open, palette gesture
    still works).
- Suite: CI-canonical `pnpm --dir packages/ui exec vitest run` =
  **67 files / 854 tests** (baseline 67/839).
- Browser gate: **ALL 24 CHECKS PASSED** — evidence/
  `cdp-transcript.md`, `cdp-results.json`, `cdp-sink-finish-check.mjs`
  (driver), 8 screenshots; app port 9342, CDP port 9344 (census: 9333-9341
  consumed). Throwaway Chrome killed; server stopped; ports released.
- Gates 4.2: evidence/gates-4-2.md — pipeline-registry zero diff vs BOTH
  74568906 and f66666d9+tree; `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`;
  `addFinishNode`/palette gesture untouched (textual + jsdom + real-browser
  behavioral proof).

## Decisions made during apply

1. **How a barrier becomes a sink in the browser gate**: child 4's synthesis
   always wires join→T, so a Join is never terminal right after the offer.
   Honest flow: take the offer → confirm (join→finish wired) → delete the
   trailing Finish (select + Backspace; the page arms
   `deleteKeyCode={['Backspace','Delete']}` in edit mode; `removeV2Node`
   drops every connection touching the removed node) → the BARRIER is now the
   sink → select it → section → confirm → new Finish wired
   `join:done->finish:input`. This also demonstrates children 4+5 compose.
2. **Section placement/copy**: rendered at the END of the supported panel
   branch (after per-kind editors), heading "Finish here", label "Endpoint
   outcome", button "Name outcome" — pull affordance, no prose beyond that.
3. **`isPromotableSink` takes the node OBJECT and re-reads the ROOT node by
   id** (kind from the root copy, not the passed object) — a stale body-graph
   object or a passed node whose id is absent from root is not promotable.
4. Page-side single call site: `selectedV2SinkOutcomes` memo passes
   `draft.outcomes` only when the selected v2 node is promotable — the offer
   cannot disagree with the model's confirm-time re-validation.

## Durable findings (driver gotchas — generalize to any canvas CDP driver)

1. **The right-column properties panel OCCLUDES right-side node cards**:
   `elementFromPoint` at such a card's center hits the panel, so a CDP center
   click silently does NOT select (the selection just stays — this failure
   mode cost one driver run). Same class as child-2's "close the summary
   panel before handle drags", but for NODE clicks. Fix in driver:
   close any open node panel (`button[aria-label="Close node properties"]`)
   before coordinate clicks.
2. **Off-screen node centers clamp to the viewport edge → click lands on the
   pane → DESELECTS.** After the graph grows past the viewport, always
   re-fit-view before coordinate clicks. Fix: `selectNode` =
   close-panel → fit-view → click → VERIFY the `selected` flag landed →
   retry (≤3) → else throw with a clear label.
3. **Chrome headless launcher exits immediately on Windows** (`& chrome.exe`
   returns while the detached browser keeps running) — don't treat the
   launcher's exit as the browser dying, and don't wait on the launching
   process; probe `/json/version` instead.

## Next action

Ship (shipper role): narrow pathspec commit of the 5 files +
`rasen/changes/canvas-sink-finish-inference/` (tasks/proposal/design/specs/
evidence/handoff). Watch the known traps: LF line endings (never
`-c core.autocrlf=false add`), `git diff --check` whitespace gate on imported
evidence files (my evidence files are ASCII, LF, written in-repo). Working
tree also contains PRE-EXISTING untracked residue NOT to commit:
`test-pipeline-e2e-ackloss-tmp/`, `.rasen-pipeline-command-*`,
`.rasen-e2e-bugfix-p7kW0o/`, sibling `.rasen/changes/*` mirrors.
This is the LAST child of the portfolio — the parent
(canvas-gesture-ir-compiler) assembles after this ships/archives; the planner
digest at `rasen/changes/canvas-gesture-ir-compiler/planning-context.md`
(~line 219) holds the portfolio assembly material.
