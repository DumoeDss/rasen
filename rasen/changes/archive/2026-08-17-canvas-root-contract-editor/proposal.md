# Proposal: canvas-root-contract-editor

## Why

Live testing of the round-one canvas (PR #167 build, 2026-08-17) dead-ended on the root
contract: a freshly assembled definition seeds `outcomes: []`
(`createBlankCanvasPipelineDefinitionV2`, `draft.ts:90`), its sinks produce the terminal
outcome `done`, and the engine's owner-contract validator (`definition.ts:3091-3113`)
correctly raises `PORT_MISMATCH: Definition graph produces terminal outcome 'done', but it
is not declared by the owner contract`. The author then has no usable path to the fix:
clicking the issue selects the producing node, whose "Finish here" endpoint pick lists zero
outcomes with a disabled confirm; the loop review's exit-outcome select is likewise empty;
and the definition contract panel that could declare the outcome exists in the left
authoring column but was not found or understood by the author. The validator's demand
must become satisfiable at the moment of need.

A premise correction this proposal bakes in (verified against the tree at `fb243e83`): the
root contract editor is NOT missing. `DefinitionContractPanel`
(`PipelineCanvasPage.tsx:2808-2816`) renders against the root draft in every v2 edit
session and writes through `patchDefinitionContract` -> `updateDefinitionContracts`
(`draft.ts:499`), and page tests drive it (`pipeline-canvas-page.test.tsx:1256-1289`). The
defect is discoverability and degenerate pickers, so this change makes the existing
surface reachable and first-class rather than building a second one.

## What Changes

- The definition contract panel's named-outcomes editor joins the established list-field
  idiom (comma-separated text, committed on blur; the same `NameListField` widget
  declaration outcomes and the review dialogs use), replacing the current input that
  patches the whole definition on every keystroke. Uniqueness and non-blank refusals keep
  coming from the model layer (`updateDefinitionContracts`), surfaced as toasts.
- A new model helper `declareDefinitionOutcome` in `draft.ts` gives every
  "declare one more outcome" call site a single-line append that reuses
  `updateDefinitionContracts` as the only rule site (blank and duplicate names refused).
- The loop review (the one surface that blocks the contract panel behind a modal overlay)
  gains an inline "declare outcome" affordance: when no definition outcomes exist, the
  author types a name and confirms; the page performs one `declareDefinitionOutcome`
  transaction and the exit-outcome select offers the new option without closing the
  review. The review's outcome list also switches from the open-time snapshot to the live
  draft (`PipelineCanvasPage.tsx:2746` currently reads the stale copy; the parallel review
  already reads live at `:2764`).
- The node panel's "Finish here" endpoint offer, when the definition declares no outcomes,
  stops dead-ending: it states that no outcomes are declared and offers a jump that
  scrolls the definition contract panel into view and focuses the outcomes field. It stays
  read-only over the contract (no inline write; the panel sits beside the contract column).
- All outcome pickers remain read-only over the contract otherwise. The definition
  contract panel is the single home for declaring outcomes; this change adds no second
  contract surface (in particular, no empty-selection pane panel).
- First spec coverage for the root contract editing surface (it predates the spec era with
  no requirement): an ADDED-only delta under `pipelines-ui`.

Author guidance documented with this change (no code): to wire a consulted expert such as
a teacher as a non-mandatory step, place it on a parallel branch and mark the member
optional (the parallel review's required/optional toggles), or feed it as an optional Join
input; the branch's terminal outcome must then be declared on the definition contract (or
the sink named via the "Finish here" offer). The `PORT_MISMATCH` on an undeclared `done`
is resolved by declaring `done` in the definition contract, not by rewiring.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: ADDED-only delta adding one requirement covering the definition
  contract editing surface: declaring named outcomes (including the loop review's inline
  declare while its modal is open and the sink endpoint offer's pointer when no outcomes
  exist), the read-only posture of the other outcome pickers, and the acceptance scenario
  (two sinks producing an undeclared terminal outcome; the author declares it in the
  definition contract; re-validation clears the issue with no other edit). Existing typed
  input and artifact row editing, already implemented and page-tested, receives its first
  spec scenarios in the same requirement.

## Impact

- `packages/ui/src/canvas/draft.ts`: one new exported helper (`declareDefinitionOutcome`)
  beside `updateDefinitionContracts`; no change to existing signatures.
- `packages/ui/src/canvas/DefinitionContractPanel.tsx`: outcomes field swaps to the shared
  `NameListField` (commit-on-blur); inputs/artifacts rows and limits untouched.
- `packages/ui/src/canvas/V2LoopReviewPanel.tsx`: live outcomes prop semantics plus the
  inline declare affordance (thin callback; no model logic in the panel).
- `packages/ui/src/canvas/V2NodePanel.tsx`: sink-promotion empty state and locate callback
  only.
- `packages/ui/src/canvas/PipelineCanvasPage.tsx`: render-site outcome list becomes live;
  wiring for declare and locate callbacks.
- Tests: `packages/ui/test/canvas/` (model unit, component, page-level acceptance) plus a
  real-browser CDP check. Baseline 67 files / 854 tests via
  `pnpm --dir packages/ui exec vitest run`.
- Frozen and untouched: `src/core/pipeline-registry/` (asserted empty diff), the IR, and
  `V2_BODY_PALETTE_KINDS`. No node synthesis, so no `legacyRuntimeOwner` risk.
- Explicit non-goals: no auto-revalidation after contract edits (Validate stays the
  explicit authority; a debounced auto-revalidate is recorded as a future idea), no change
  to the parallel review's proceed/failed picks (child-4 territory; its live-read posture
  is already correct), no persistence work (the known Save defect stays out of scope, so
  verification stays in-memory).
