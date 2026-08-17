## Context

Round-one live testing (PR #167 build) dead-ended on the root contract: a fresh v2
definition seeds `outcomes: []` (`createBlankCanvasPipelineDefinitionV2`, `draft.ts:90`),
its sinks produce `done`, and the owner-contract validator (`definition.ts:3091-3113`,
frozen IR, read-only) raises `PORT_MISMATCH`. The path from that issue to the fix is
broken in three places, all verified at `fb243e83`:

1. The issue click maps `/root/nodes/<i>/capability` to a node target
   (`definitionIssuePathTarget`, `draft.ts:1974`), which opens the node panel's "Finish
   here" offer; with no declared outcomes its select is empty and confirm is disabled
   (`V2NodePanel.tsx:431-476`) — the issue's own navigation dead-ends.
2. The loop review's exit-outcome select lists only `definitionOutcomes`
   (`V2LoopReviewPanel.tsx:97,149`), which the page captures as an open-time snapshot
   (`PipelineCanvasPage.tsx:1363`, rendered at `:2746`) — empty on a fresh definition, and
   stale if the contract changes while open. The parallel review already reads the live
   draft at `:2764`, so the two reviews disagree.
3. The root contract editor that resolves all of this exists — `DefinitionContractPanel`
   at `PipelineCanvasPage.tsx:2808-2816`, writing through `patchDefinitionContract` ->
   `updateDefinitionContracts` (`draft.ts:499`) — but its named-outcomes input commits a
   full definition patch on every keystroke (`DefinitionContractPanel.tsx:198-216`), a
   different idiom from every other outcome list on the canvas, and nothing on the canvas
   points at it.

Constraints carried from the portfolio: the IR is frozen (`src/core/pipeline-registry/`
untouched); one home for the vocabulary (rules in `draft.ts`, panels render and decide
nothing); `V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`; never stamp
`legacyRuntimeOwner` (no node synthesis happens here at all); UI tests run CI-canonically
as `pnpm --dir packages/ui exec vitest run` (baseline 67 files / 854 tests).

One engine fact shapes the design: `resolveGraphTerminalOutcomes` (`definition.ts:2952`)
is not exported. The UI cannot structurally recompute which outcomes a graph produces
without duplicating a frozen engine rule, so no affordance tries to derive "the outcome
this issue complains about" from the graph; the author names it in the contract panel.

## Goals / Non-Goals

**Goals:**

- Make declaring a root outcome reachable at the moment the validator demands it: the
  acceptance scenario (two sinks produce an undeclared `done`; author declares `done`;
  issue clears with no other edit) works end-to-end.
- One declaring rule site (`updateDefinitionContracts`) and one primary editing surface
  (the existing definition contract panel). Every other surface either points at it or,
  where a modal blocks it, calls a one-line model helper.
- The named-outcomes editor uses the same list-field idiom as every other outcome list.

**Non-Goals:**

- No second contract surface (no empty-selection pane panel; the left column panel is the
  home; empty selection keeps rendering no right-side panel).
- No auto-revalidation after contract edits. Validate stays the explicit authority; a
  debounced auto-revalidate is a recorded future idea, not this change.
- No change to the parallel review's proceed/failed picks (child-4 territory; it already
  reads the live contract; its fresh-definition blank-select corner is noted in the
  portfolio digest for later children).
- No persistence work: the known Save defect stays out; verification is in-memory.
- No new engine surface: the validator, its messages, and `resolveGraphTerminalOutcomes`
  stay untouched behind the frozen boundary.

## Decisions

**D1 — The surface stays the existing left-column panel; no empty-selection pane panel.**
Alternative rejected: a right-side "Definition" panel on empty selection. It would be a
second rendering of the same editor beside an always-visible first one, and the empty
selection state is not where the author looks when an issue names the contract. The
defect was reachability, not real estate.

**D2 — Named outcomes edit through `NameListField` (comma text, commit on blur).**
`NameListField` (`DeclarationsPanel.tsx:245`) is the established widget for outcome name
lists (declaration outcomes, loop review, extraction review); its commit-on-blur draft
keeps intermediate keystrokes (`a,` with a trailing separator) out of the model, and its
parse CANONICALIZES the text (trim, drop blanks, dedupe) — the committed list is always
in the form `updateDefinitionContracts`' own `assertNamedOutcomes` (`draft.ts:492`)
accepts, so the list-field commit never submits a blank or duplicate for that rule site
to refuse; refusals remain reachable through the panel's row editors and the declare
helper, which is where the rule site's diagnostics surface. This replaces the
per-keystroke `onChange` patch (`DefinitionContractPanel.tsx:198-216`), which rewrites
the definition and re-runs `recomputeFlow` on every keystroke. Alternative rejected:
per-outcome rows with add/remove buttons (the proposal's "rows" phrasing). Rows exist in
this codebase only for two-column `name: type` port pairs; a one-field-per-row editor
for bare names would be a new outcome-list vocabulary, exactly the drift the one-home
rule exists to prevent. The field keeps `data-testid="definition-outcomes"` and the
`outcomes` focused-field key so existing focus-ring and issue-navigation behavior
carries over.

**D3 — Single home for declaring, with one carve-out: write where blocked, point where
visible.** The definition contract panel is the single home for declaring outcomes; all
pickers stay read-only over the contract. Two exceptions-by-mechanism, both thin:
- Loop review (modal): its overlay covers the contract panel, so the single home is
  unreachable while it is open, and canceling to declare loses the drawn-back-edge
  context. It gains an inline declare affordance, shown only while the definition
  declares no outcomes: a text input plus confirm that calls one new model helper and
  leaves the review open. This is the brief's escape clause: a thin call into the same
  model function, not a second vocabulary; the panel decides nothing.
- Sink endpoint offer (side panel): the contract column is visible beside it, so the
  empty state states the situation and offers a locate action (scroll the contract panel
  into view within the authoring column and focus the outcomes field) instead of an
  inline write. Alternative rejected: an inline declare here too. It buys one saved
  glance at the cost of a second write path in a non-blocking context.

**D4 — `declareDefinitionOutcome(def, name)` in `draft.ts` beside
`updateDefinitionContracts`.** Trims, refuses blank and duplicate names (the refusal
text comes from the existing `assertNamedContractRows`/`assertNamedOutcomes` family via
the underlying call), appends preserving order, and returns the next definition. Gap
cited per the brief: `updateDefinitionContracts` accepts only full arrays, so without
the wrapper the loop review would re-implement the append-plus-guard at its call site,
which is a second rule site in the making. No existing signature changes.

**D5 — The loop review reads the live draft outcomes.** The render site
(`PipelineCanvasPage.tsx:2746`) passes `draft?.version === 2 ? [...draft.outcomes] : []`
exactly as the parallel review does at `:2764`; the `definitionOutcomes` snapshot field
is dropped from the `loopReview` state object. Without this, the inline declare's new
option would land in the definition but never reach the open review's select.

**D6 — Locate mechanism for the sink offer.** The page passes a callback; the handler
focuses the outcomes field (a ref on the `NameListField` input inside
`DefinitionContractPanel`) and calls `scrollIntoView` on the contract panel. jsdom
performs no layout, so tests assert focus and the callback wiring, not scroll geometry;
the real-browser check covers visibility.

**D7 — Author guidance, no code.** The teacher-style optional wiring is documented
guidance (proposal + this design): a consulted expert joins as an optional parallel
member or an optional Join input, and its branch's terminal outcome is declared on the
contract (or named via the sink offer). The engine already accepts both shapes; the
canvas already authors both; nothing here changes the wiring itself.

## Risks / Trade-offs

- [The outcomes field's commit-on-blur changes the page-test contract for
  `definition-outcomes`] → the existing page test that drives it with a bare input event
  (`pipeline-canvas-page.test.tsx:1276-1279`) is updated to the focus/blur pattern the
  declaration-outcomes test already uses (`:1309-1317`); the component's direct-render
  test is updated in the same task so both layers move together.
- [An inline declare writes the definition while a review holds local derived state] →
  the write touches only `outcomes`; the review's derived contract fields are untouched
  local state, and D5's live read is what makes the new option appear. Component tests
  pin: review stays open, other edits intact, refusal paths leave the definition
  unchanged.
- [Focus/scroll behavior differs between jsdom and the real browser] → jsdom asserts
  `document.activeElement` and handler wiring; the CDP check asserts the panel is on-screen
  and the field focused after the locate click. No layout claims are made from jsdom.
- [Message-derived affordances would couple UI to engine prose] → avoided by design:
  nothing parses validator messages; the author names the outcome, the engine keeps
  authority.
- [Spec base drift between this branch and dev/0.2.0's unmerged round-one sync] → the
  delta is ADDED-only (round-one digest discipline), so it applies regardless of merge
  order; no MODIFIED block touches any round-one requirement.

## Migration Plan

Single forward-only UI change behind existing panels; no wire, storage, or engine
migration. Rollback is reverting the commit; the definition contract panel's behavior
returns to the per-keystroke input.

## Open Questions

- None blocking. The debounced auto-revalidate after contract edits (issues clearing
  without an explicit Validate press) is deliberately deferred; if the user asks for it,
  it is a small follow-up on top of D2's commit-on-blur seam.
