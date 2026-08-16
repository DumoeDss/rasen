# Review report — canvas-multi-selection (verify stage)

- Reviewer: reviewer-1 (independent; not the implementer). Dispatched report-only mode: no fixes applied, no commits, no subagents.
- Date: 2026-08-17. Branch `feat/canvas-gesture-ir-compiler`, base `74568906`.
- Review target: uncommitted working-tree delta vs base over `packages/ui/` (`PipelineCanvasPage.tsx`, `draft.ts`, `test/canvas/draft.test.ts`, `test/canvas/pipeline-canvas-page.test.tsx`) plus untracked `packages/ui/src/canvas/V2SelectionPanel.tsx`. `.rasen-e2e-*`, `rasen/`, `.rasen/` run-state dirs excluded per dispatch.

## Verdict: FINDINGS — 1 Blocker, 1 Major, 1 Minor, 1 Trivial

The selection model, batch-removal helper, panel component, and their unit/component tests are
well-built and spec-conformant (both documented deviations from design D3 are REQUIRED by the
spec delta — see Spec axis). But a real-browser defect class survives the entire green suite:
React Flow's selection listener reverts programmatic selection writes, breaking issue-drawer
navigation and panel close on common paths.

## Independent test gate (mandatory)

- Command: `pnpm --dir packages/ui exec vitest run` (CI-canonical form), repo root, not piped.
- Result: **67 files / 765 tests, all passed, exit 0** — matches the implementer's claim exactly
  (baseline 67/743, +22). Both changed test files ran green in this corpus:
  `test/canvas/draft.test.ts` (55 tests), `test/canvas/pipeline-canvas-page.test.tsx` (90 tests).
- Evidence sanity check: `evidence/cdp-transcript.md` and `evidence/gates-5-2.md` both exist,
  non-empty, and are internally consistent with the handoff (67/765, 764→765 pairs-first test
  history, screenshot list matches the files present in the evidence dir).

## Scope check: CLEAN

Intent: set-based canvas selection (box-select, augmented click, multi-state panels, multi-delete
with pair co-deletion, selection surviving non-destructive edits, issue navigation, v1 rides the
same model). Delivered: exactly that, in the four modified files + the new small panel + tests.
No out-of-scope files touched. Frozen-IR gates re-verified by this reviewer:

- `git status --porcelain -- src/core/pipeline-registry/` → empty; `git diff 74568906 --stat -- src/core/pipeline-registry/` → empty.
- `draft.ts:704` — `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`.
- `legacyRuntimeOwner`: only pre-existing test references (a test name at
  `pipeline-canvas-page.test.tsx:1402`, a guard type-cast at `v2-authoring-model.test.ts:828`); no writes, no new stamps.

## Standards axis

### B1 — BLOCKER: programmatic selection writes are reverted one render later by React Flow's SelectionListener

- Sites: `packages/ui/src/canvas/PipelineCanvasPage.tsx:1701-1737` (`selectIssueTarget`, all
  mirror-writing branches: 1713, 1719, 1724-1725, 1734) and the four panel close handlers
  (`PipelineCanvasPage.tsx:2302, 2340, 2348, 2357`).
- Mechanism (verified against installed source, `node_modules/@xyflow/react/dist/esm/index.mjs:157-165`):
  `SelectionListenerInner`'s effect depends on `[selectedNodes, selectedEdges, onSelectionChange]`
  and calls the callback with the store's CURRENT selection on every effect run. The page defines
  `onSelectionChange` as a plain function (`PipelineCanvasPage.tsx:859`) — a new identity every
  render — so **every re-render of `PipelineCanvasPage` re-fires the listener with RF's current
  store selection**. This is the same mechanism the implementer diagnosed for the tab freeze (the
  same-value guard at 862-872 stops the *infinite loop*, but not a *cross-value* overwrite): any
  mirror write that changes the value while RF's own selection (the `selected` flags in
  `flowNodes`, untouched by these sites) still holds the old value is overwritten on the very next
  commit.
- Concrete failure scenario A (issue navigation — spec-pinned, regression vs base): in a real
  browser, enter edit mode, validate a draft with an issue, click the issue in the issues drawer
  with nothing selected on the canvas. `selectIssueTarget` sets the mirror to `{target}`; the
  node panel renders for one frame; the listener then re-fires with RF's still-empty selection and
  clears the mirror; the panel closes. With a prior canvas selection the mirror is reverted to
  that selection instead — the wrong element's state is shown. At base this worked (the scalar had
  no listener to undo it).
- Concrete failure scenario B (panel close — regression vs base): select one node (panel opens),
  click the panel's `×`. `setSelection(EMPTY)` renders one frame without the panel, then the
  listener re-fires with RF's `[node]` and the panel reopens. The close button effectively stops
  working on all four panels.
- Why the gates miss it: the ReactFlow mock (`packages/ui/test/canvas/pipeline-canvas-page.test.tsx:72-96`)
  invokes `onSelectionChange` only from explicit interaction buttons and asserts the premise
  "the real library does not fire onSelectionChange for [programmatic writes] either" — true as an
  *event*, false as-behaved (the listener re-fires on every render with store truth). The CDP
  check exercised only interaction-driven selection, palette add, and deletes — never issue
  navigation or panel close.
- Fix directions for the routed fixer (one of, or a combination): (a) stabilize the callback
  identity (`useCallback` over `setSelection` only) so the listener effect runs only on genuine RF
  selection changes — restores base-parity semantics where programmatic writes persist; and/or
  (b) sync RF at every programmatic write by re-stamping `flowNodes` from the new selection in
  the same tick (the mechanism `recomputeFlow`'s `selectionOverride` already uses at
  `PipelineCanvasPage.tsx:373-401`). Sites already safe (for the fix map): gesture adds /
  renames / `editParallelContract` (explicit `selectionOverride` re-stamp), `enterEditWith`,
  `applyV2BatchRemoval` + `pruneSelectionToDraft`, v1 rename (preserves the `selected` flag),
  save-success and discard (listener unmounted in view mode). The fix must ship with a jsdom
  regression test, which requires m1 below — otherwise it is unverifiable in CI.

### M1 — MAJOR: v1 `deleteSelection` never updates the canvas — deleted stage cards remain as ghosts

- Site: `packages/ui/src/canvas/PipelineCanvasPage.tsx:1748-1765`.
- The v1 branch of `deleteSelection` (the summary panel's Delete button) updates the draft and
  filters `flowEdges`, but never calls `recomputeFlow`/`setFlowNodes` — unlike the v1 Delete-KEY
  path, whose `applyNodeChanges` tail (`PipelineCanvasPage.tsx:820`) removes the nodes from
  `flowNodes`.
- Concrete failure scenario: in the v1 editor, box-select two stage cards, click "Delete
  selection". The draft correctly loses both stages with all `requires` references cleaned (spec
  scenario "v1 stages delete as a set" holds at the model level), but both stage cards stay
  rendered on the canvas until an unrelated action triggers a rebuild; and because the ghosts keep
  `selected: true`, RF's store selection still contains them, so under B1's listener behavior the
  pruned mirror is immediately restored and the summary panel re-pops reporting the deleted
  stages. The existing test (`pipeline-canvas-page.test.tsx`, "deletes several v1 stages as a
  set") asserts only the submitted definition and the panel's mock-level state — not the canvas —
  so it cannot see this.

### m1 — MINOR: ReactFlow mock has no SelectionListener stand-in — the suite is structurally blind to B1's class

- Site: `packages/ui/test/canvas/pipeline-canvas-page.test.tsx:52-96` (mock `interactionSelection`
  state + comment at 72-75).
- The mock models RF's interaction selection but nothing re-fires `onSelectionChange` with it on
  re-render, so any page-vs-RF selection divergence is invisible to all 765 tests. This is how a
  Blocker passed a fully green suite plus a real-browser pass whose script didn't cover the
  affected paths. Extend the mock with a stand-in that re-emits the interaction selection on
  every render (mirroring `SelectionListenerInner`'s identity-keyed effect), then pin B1's fix
  and M1's canvas assertion against it.

### t1 — TRIVIAL: `V2SelectionPanel` renders for v1 multi-selections too

- Site: `packages/ui/src/canvas/PipelineCanvasPage.tsx:2349-2357` — the render condition is
  version-agnostic, so the v1 editor's summary panel is the v2-named component with `nodeKinds`
  always empty (v1 stages carry no kinds). Behavior is spec-conformant; naming only.

## Spec axis

- Both documented deviations from design D3 are REQUIRED by the spec delta and correctly judged:
  - Gesture handlers UNION instead of replace — the "Selection survives a non-destructive edit"
    scenario demands previously selected nodes stay selected across a palette add; union also
    preserves singleton-from-empty behavior. Design D3's "replace" wording is superseded.
  - `removeV2Nodes` pairs-first two-pass — required for "Multi-delete removes the whole selection"
    + "A fan-out deletes with its barrier" to hold for a box-select of a frontier plus its members
    (single-pass draft order would refuse the last member). The discriminating regression test
    ("removes EVERY member of a selected pair plus the pair") pins exactly this.
  - The same-state guard in `onSelectionChange` is load-bearing (verified against the installed
    listener source) — but incomplete: see B1.
- Spec scenarios verified implemented and tested at the mock level: box-select summary counts and
  kinds; multi-select-key augment/remove; mixed node+connection selection; singleton panels
  unchanged (`singletonNodeId`/`singletonConnectionId` derivation, `key={id}` remounts intact);
  multi-delete with reference cleanup; pair co-deletion selected and unselected barrier; one
  refusal summary naming each refused element with its reason; prune-on-removal; selection-carry
  across palette add; v1 set deletion (model level — view level broken per M1).
- Spec scenario BROKEN in the real app: "An issue selects exactly its target ... that stage
  becomes the only selected element and its properties panel opens" — B1. This is the Spec axis's
  failing item; everything else in the delta is delivered.

## Counts

- Blocker: 1 (B1) · Major: 1 (M1) · Minor: 1 (m1) · Trivial: 1 (t1)
- Standards axis worst: B1 (Blocker). Spec axis worst: issue-navigation scenario broken (B1).
- Test gate: 67 files / 765 tests, exit 0 — independently reproduced.
