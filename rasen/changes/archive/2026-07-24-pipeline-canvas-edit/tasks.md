## 1. Mirror + client (first-consumer additions)

- [x] 1.1 `packages/ui/src/api/types.ts`: add `PipelineValidationRequest`, `PipelineValidationIssue`, `PipelineValidationResponse`, `PipelineCatalogSkill`, `PipelineCatalogResponse`; append the `save` member to `PipelineMutationRequest`; drive-by: make `PipelineAgentRuntimeConfig.runtime` required (matches core parsed-output type, review-accepted Minor from child 3)
- [x] 1.2 `packages/ui/src/api/client.ts`: add `validatePipeline(definition, selector)` and `getPipelineCatalog()`

## 2. Draft module (`packages/ui/src/canvas/draft.ts`, pure)

- [x] 2.1 Implement `addStage`, `removeStage` (drops every `requires` reference), `addRequire`, `removeRequire`, `updateStageFields` (spread-patch preservation), `renameStage` (rewrites references), `wouldCreateCycle` (reachability), `stageIdFor` (skill-derived + uniquifier), dirty check (deep-equal vs loaded definition), `issuePathTarget(path)` (stage index + field tail; unmappable → null)
- [x] 2.2 Unit tests: cycle rejection incl. transitive; delete-with-reference-cleanup; rename rewrites; EVERY-loader-field preservation test (definition using agents/handoff/reuse/goal-loop/sessionReuse/sandbox/effort — edit one field, assert the rest byte-identical in the would-be save body); issue-path mapping incl. unmappable degradation

## 3. Editor UI

- [x] 3.1 Edit mode in `PipelineCanvasPage.tsx`: mode state, Edit button gated on `editable`, draft init from detail, derived nodes/edges from draft, free-drag positions (session-only), connect handler (client cycle guard + toast), edge/stage deletion, Re-layout button; group `parentId`/`extent: 'parent'`/group-before-member ordering respected; parallelGroup changes trigger full re-layout
- [x] 3.2 `PalettePanel.tsx`: catalog fetch (once per editor entry), skill cards with description tooltips, disabled skills greyed + non-draggable with state named, HTML5 DnD → `screenToFlowPosition` stage creation
- [x] 3.3 `StagePanel.tsx`: selection-driven properties panel — id/role/skill/gate/condition/verifyPolicy/model/runtime/parallelGroup + review-cycle loop kind/maxRounds; vocabularies from the catalog response (no retyped literals); goal-loop configs shown read-only as preserved; header description editing
- [x] 3.4 `IssuesDrawer.tsx` + node/field markers: severity-tagged list, click-to-select stage, error rings/badges on mapped nodes, panel-field highlight when open

## 4. Validate + save + guards

- [x] 4.1 Validate action + pre-save gate wiring `validatePipeline`; error-severity blocks save; warnings pass; floor violation path exercised for an origin:'ui' draft
- [x] 4.2 Save flow: stamp `origin: 'ui'`, `mutatePipeline({op:'save',...})`; 201/200 distinction, dirty clear + refetch + exit to view; 422 collision → explicit Overwrite retry; 422 other → verbatim message; 409 busy → manual-retry message
- [x] 4.3 Dirty guards: unsaved chip, in-app navigation/mode-exit confirm, `beforeunload` registered only while dirty; Discard restores loaded definition
- [x] 4.4 New-draft flow: "Assemble in canvas" name-first dialog on PipelinesPage (grammar-checked client-side), in-memory pending-draft hint consumed on mount, empty draft `{name, origin:'ui', stages:[]}`; not-found view gains "Start assembling" recovery; "Duplicate to edit" on built-in view seeding from its definition

## 5. Page tests (flow mocked)

- [x] 5.1 Mode gating: no Edit button when `editable:false`; duplicate-to-edit present on built-ins
- [x] 5.2 Validate-blocks-save (errors), warnings-pass, issues render + select; save body carries origin:'ui'; collision → overwrite retry with force; busy → no auto-retry
- [x] 5.3 Dirty guards: chip appears on edit, confirm on back-while-dirty, released after save/discard; new-draft mount + refresh-degradation recovery affordance

## 6. Verification

- [x] 6.1 `pnpm run typecheck`, `pnpm run test`, `pnpm run build` in `packages/ui` (vite.config.ts AND vitest.config.ts alias parity if either is touched); full repo suite on Windows with the EBUSY-flake isolation discipline
- [x] 6.2 Browser QA (rasen-qa or manual via live `rasen ui`): assemble a two-stage pipeline from the palette, trigger a cycle rejection, validate a floor-violating draft, save, reopen, verify round-trip; confirm read-only view unchanged for built-ins
- [x] 6.3 Run `rasen validate pipeline-canvas-edit --strict` from the worktree and fix findings
