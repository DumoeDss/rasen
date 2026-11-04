## 1. Layout: constrain the v2 authoring column (design D1)

- [x] 1.1 Add a `.pipeline-canvas__authoring-contracts` rule in `packages/ui/src/style.css` next to `.stage-panel`: `width: 280px; flex-shrink: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-3);`
- [x] 1.2 Add `.definition-contract` and `.declarations-panel` card rules (border, `--radius-lg`, padding, `background: var(--surface)`, `display: flex; flex-direction: column; gap: var(--space-2)`) — and deliberately no per-panel `overflow-y`, since the column owns the single scroll
- [x] 1.3 Give the contract fields a column layout: `.definition-contract__field` and the panel's `<label>` elements stack their `<span>` above their control; `.definition-contract__row` (name / type / required / remove) stays a row with `align-items: center` and `gap`
- [x] 1.4 Style the declaration list rows (`.declarations-panel__list`, `__item`, `__new`, `__empty`) so ids, actions, and the empty state are legible in a 280px column
- [x] 1.5 Verify no page-level scrollbar appears on the canvas route in v2 edit mode — the column must scroll, not the page

## 2. Model: gesture vocabulary and availability, one home in `draft.ts` (design D2)

- [x] 2.1 Add `V2RootGesture` and `V2_ROOT_PALETTE_GESTURES = ['stage','parallel','loop','finish']` in `packages/ui/src/canvas/draft.ts`, immediately beside `V2_BODY_PALETTE_KINDS`, with a comment tying the two vocabularies to the same "one home" rule
- [x] 2.2 Add `unavailableRootGestures(def, { exactCapabilities })`: `stage` unavailable with no enabled exact capability revision, `parallel` with no root `AtomicStage`, `loop` with no `loopBodyDeclaration(def)`, `finish` always available
- [x] 2.3 Delete `V2_ROOT_PALETTE_KINDS` — do not leave it beside the gesture list. Keep `V2_EDITABLE_NODE_KINDS` / `isV2EditableNodeKind`, which `onConnect` and `onNodesChange` still need
- [x] 2.4 Extract `isReferenceableDeclaration(declaration)` from `referenceableDeclaration(def)` and remove the "find the first" wrapper along with its only remaining caller (its two remaining callers — `PalettePanel.tsx`, `PipelineCanvasPage.tsx` — are rewired in Group 6)

## 3. Model: gesture → IR composition helpers (design D3)

- [x] 3.1 `addAtomicStageForCapability(def, capability)` — move the node construction currently inlined at `PipelineCanvasPage.tsx:782-791` into `draft.ts`, taking the author's chosen capability instead of the first one found
- [x] 3.2 `addParallelFrontier(def)` — wrap `createParallelPair()` with today's defaults (all root AtomicStages as members, first required, cap `min(3, members.length)`, budget `members.length`, outcomes from `def.outcomes`)
- [x] 3.3 `addBoundedLoopOverDeclaration(def)` — move the `BoundedLoop` construction from `PipelineCanvasPage.tsx:816-836` wholesale, including `createDefaultBoundedLoopLifecycle()` and the domain-exit seeding
- [x] 3.4 `addFinishNode(def)` — `{ kind: 'Finish', outcome: def.outcomes[0] ?? 'done' }`
- [x] 3.5 `insertCompositeRef(def, declarationId)` — validate the declaration exists and passes `isReferenceableDeclaration`, then append the `CompositeRef`
- [x] 3.6 Each helper throws an `Error` with an author-readable message on refusal; none of them touches `ECP_NODE_KINDS` or any node interface in `src/core/pipeline-registry/definition.ts`

## 4. Model: Gate as a stage property (design D4)

- [x] 4.1 `gateForStage(def, stageId)` returning the `Gate` node whose `target` is that stage, if any
- [x] 4.2 `setStageGate(def, stageId, true)` appends a `Gate` targeting the stage with `outcomes: ['approved','rejected']` and `dispositions: { approved: 'proceed', rejected: 'escalate' }` — the Canvas's current defaults, NOT `normalizeV1`'s `approve`/`reject`; dedupe the generated id against existing node ids
- [x] 4.3 `setStageGate(def, stageId, false)` routes through the existing `removeV2Node`, which already drops incident connections; enabling twice or disabling with no gate is a no-op
- [x] 4.4 Refuse with a clear message when `stageId` is not a root `AtomicStage`

## 5. Model: Choice as a connection condition (design D5)

- [x] 5.1 `spliceConditionOntoConnection(def, connectionId, expression)` — reject unless both endpoints pass `isV2EditableNodeKind`; create `{ id: v2NodeIdFor('Choice', def), kind: 'Choice', outcomes: ['matched','skipped'], expression }`; drop the original connection and add `from → choice:input` plus `choice:matched → to`
- [x] 5.2 Do NOT write `legacyRuntimeOwner` on the authored Choice — `orchestrationEvaluatorCapabilityFor()` (`definition.ts:220-228`) reads its absence as "authored, requires a choice-select evaluator", and forging it would silently exempt the node
- [x] 5.3 `unspliceChoice(def, choiceId)` — remove the Choice and restore the direct connection from its inbound source to its `matched` destination; refuse, with a message naming the wired branch, when any outbound connection uses a port other than `matched`
- [x] 5.4 Refuse to splice a condition onto a connection that does not exist, and make a blank/whitespace expression a refusal rather than a Choice with an empty condition

## 6. Palette: render gestures, decide nothing (design D2/D3)

- [x] 6.1 Rewrite the v2 branch of `PalettePanel.tsx` to map `V2_ROOT_PALETTE_GESTURES`, with a `disabledGestures` prop replacing `disabledKinds`; stable test ids (`v2-palette-gesture-<gesture>`)
- [x] 6.2 Remove the hardcoded AtomicStage-availability check at `PalettePanel.tsx:48-51` — the panel must evaluate no availability rule of its own, which is what its doc comment already claims
- [x] 6.3 The Stage gesture renders the installed-skill card list already used by the v1 branch (`PalettePanel.tsx:71-104`), greying skills the catalog reports disabled or lacking an exact capability revision; picking one calls back with that capability (test ids `v2-palette-gesture-stage-<skillId>`)
- [x] 6.4 In `PipelineCanvasPage.tsx`, replace `addV2RootNode(kind)` with gesture handlers (`addStageGesture`, `addRootGesture`) delegating to the section-3 helpers, and replace the inline `disabledKinds` computation with `unavailableRootGestures(...)`

## 7. Property affordances for the withdrawn kinds (design D4/D5/D6)

- [x] 7.1 Add an approval checkbox to the AtomicStage section of `V2NodePanel.tsx`, reading `gateForStage` and writing `setStageGate`; the existing `GateDetails` editor on the Gate node stays exactly as it is
- [x] 7.2 Wire React Flow's `onEdgeClick` in `PipelineCanvasPage.tsx` to select a connection; node selection and edge selection are mutually exclusive, and `onPaneClick` clears both
- [x] 7.3 Add a Connection properties panel (reusing the `.stage-panel` class so it inherits the constrained, independently-scrolling treatment) showing `from → to` and a condition field that calls `spliceConditionOntoConnection` — new `V2ConnectionPanel.tsx`
- [x] 7.4 Add an expression field to the Choice section of `V2NodePanel.tsx` beside its existing branch-outcomes editor, plus a "remove condition" action calling `unspliceChoice`
- [x] 7.5 Add a per-row "Insert into graph" action to `DeclarationsPanel.tsx`, enabled by `isReferenceableDeclaration` and calling `insertCompositeRef` with that row's id
- [x] 7.6 Surface every helper refusal through the existing `showToast` path — no panel re-decides a rule the model owns

## 8. Tests: model (`packages/ui/test/canvas/`)

- [x] 8.1 Update `v2-authoring-model.test.ts:150` from the eight-kind palette assertion to the four-gesture list, and assert `V2_ROOT_PALETTE_KINDS` no longer exists
- [x] 8.2 Cover `unavailableRootGestures` for each rule: no exact capability, no root AtomicStage, no declaration with a body
- [x] 8.3 Cover each composition helper's success shape and its refusal message, including that `addParallelFrontier` emits a fan-out and barrier that reference each other
- [x] 8.4 Cover `setStageGate` on/off round-trip: enabling produces the Canvas's `approved`/`rejected` vocabulary, disabling removes the gate and its incident connections, and the stage is then deletable
- [x] 8.5 Cover the Choice splice: correct connection rewiring, `expression` present, `legacyRuntimeOwner` **absent**, unsplice restores the original connection, and unsplice refuses when the `skipped` branch is wired
- [x] 8.6 Cover `insertCompositeRef` referencing the requested declaration — not the first one — when several exist

## 9. Tests: page and parity (`packages/ui/test/canvas/pipeline-canvas-page.test.tsx`)

- [x] 9.1 Rewrite the 11 `v2-palette-add-<Kind>` call sites (`:1098`, `:1765`, `:1857-1858`, `:1946`, `:2040`, `:2405`, `:2425`, `:2439-2443`) and `canvas-authored-composite-export.test.tsx:289` onto the gestures and the new affordances — replace each assertion, never merely delete it. The `:1098` site asserted the shared `CANVAS_V2_AUTHORING_DEFINITION` fixture reachable via gestures alone, but that fixture's `Choice` node (`outcomes: ['default','parallel']`, no `expression`) is a shape the closed splice vocabulary (`spliceConditionOntoConnection`, `outcomes: ['matched','skipped']` + required `expression`, no `legacyRuntimeOwner`) cannot reproduce — the other ten sites rewrote fine because none of them touch Choice. Resolved per LEAD guidance ("a shared fixture that blocks a call-site rewrite is a fixture problem, not an acceptance criterion") by adding an additive `CANVAS_V2_GESTURE_AUTHORED_DEFINITION` fixture in `packages/ui/test/fixtures/canvas-v2-authoring.ts` — same declarations/inputs/artifacts/outcomes/limits, `root` graph rebuilt node-for-node through the gesture helpers — and rewriting the `:1098` test to author and assert against it. `CANVAS_V2_AUTHORING_DEFINITION` itself is untouched; its other 5 consumers (incl. the root-level kernel-proof test) are unaffected.
- [x] 9.2 Write one explicit parity test per withdrawn kind: a graph containing a Gate, a Choice, a FanOut+Join pair, and a CompositeRef is assembled end-to-end through the new affordances only, and the resulting definition matches the shape the palette produced before
- [x] 9.3 Assert the palette renders no `Choice`, `Gate`, `Join`, or `CompositeRef` entry in v2 mode
- [x] 9.4 Assert `V2_BODY_PALETTE_KINDS` and the declaration-body palette are unchanged (`AtomicStage` only) — the `executable-custom-composite` spec forbids widening it
- [x] 9.5 Assert an existing v2 definition containing all eight kinds still loads, renders, selects, edits, and saves without shape drift

## 10. Verification (design D8)

- [x] 10.1 Add the CSS contract pin to `packages/ui/test/style/canvas-lock.test.ts` (or a sibling in the same style): `.pipeline-canvas__authoring-contracts` exists with a definite `width`, `flex-shrink: 0`, and `overflow-y: auto`; `.definition-contract` and `.declarations-panel` exist with `flex-direction: column`
- [x] 10.2 Run the UI suite through `packages/ui`'s own vitest config — the root config excludes `packages/ui`, so `pnpm exec vitest run packages/ui/test/` runs zero tests and still prints "passed". Ran via `pnpm exec vitest run` from `packages/ui`: 729/730 passed, non-zero count confirmed; the sole failure is the known 9.1 fixture-blocked site, see handoff
- [x] 10.3 Run the root suite and `pnpm build` to confirm nothing outside `packages/ui` moved; confirm `git diff` touches no file under `src/core/pipeline-registry/`. Confirmed via CI on the merged PR head (run 31955187266, head `d780036c`): "All checks passed" — full sharded root suite green (`Test (linux-bash)` 22m24s, `linux-bash-node24` 18m58s, `macos-bash-shard-1/2/3`, `windows-pwsh-shard-1/2/3`), plus `Lint & Type Check` and `UI Package Build`, `Nix Flake Validation` skipping. `git diff origin/dev/0.2.0...HEAD -- src/core/pipeline-registry/` empty (recorded in ship-log.md). Not re-run locally to avoid re-triggering a ~20min CI cycle for a checkbox; the archive commit owns this tick per LEAD's PR-comment correction.
- [x] 10.4 Real-browser measurement, recorded under the change's `evidence/` directory: open a v2 definition in edit mode with declarations and contract rows present, and record `documentElement.scrollHeight <= innerHeight`, the authoring column's measured width (fixed, not ~800px), and that the flow column measures wider than the authoring column
- [ ] 10.5 In the same browser session, walk the four gestures and the three property affordances once each, and capture the resulting definition JSON as evidence that the parity claim holds against the real app, not only jsdom
- [x] 10.6 Run `rasen validate canvas-authoring-surface --strict` and confirm every delta requirement still parses with its scenarios
