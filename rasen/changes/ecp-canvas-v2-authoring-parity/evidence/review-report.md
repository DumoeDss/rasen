# Independent Review Report — ECP-6 Canvas v2 Authoring Parity

**Date:** 2026-08-02\
**Verdict:** `CHANGES_REQUIRED`\
**Finding counts:** Blocker 1, Major 3, Minor 1, Trivial 1 (6 total)

## Scope and baseline

This report independently reviews `ecp-canvas-v2-authoring-parity` against its proposal, design, delta specs, tasks, planning context, implementation handoffs, implementation report, the parent Direction slice, and the prerequisite ECP-5 artifacts/review. It reviews the relevant implementation in the cumulative shared ECP worktree; it does not change implementation or task state.

- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`
- Base: `origin/dev/0.2.0@a1306828a23b2c4adc0db81f92b09498a5e92710`
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`
- Reviewed dirty-worktree source/test fingerprint: SHA-256 `553060cb22c474b6c0cb5ed5eaa7092de3d7b2b61dca51bf2828a4f5ca840919` over 16 listed ECP-6 source/test files
- Latest file in that fingerprint: `packages/ui/test/canvas/pipeline-canvas-page.test.tsx`, 2026-08-02T07:20:42.6048839+08:00
- `pipelines/auto-decompose/pipeline.yaml` remained unchanged; blob hash `6f306544010a8950508f1223acfca5d62de407f5`
- No PR exists for this cumulative dirty worktree, so no Greptile findings were available to triage.

## Findings

### Blocker

#### B1 — The real Canvas cannot connect a normal AtomicStage as a target

The enabled catalog used by the shared acceptance fixture declares `rasen-apply-change` with `inputs: []` (`packages/ui/test/fixtures/canvas-v2-authoring.ts:22-34`), matching the kernel's documented production-shaped capability behavior. `layout.ts` derives AtomicStage target handles exclusively from those capability inputs (`packages/ui/src/canvas/layout.ts:139-154`), and `StageNode` renders target handles only from that derived array (`packages/ui/src/canvas/StageNode.tsx:50-58`). The resulting real AtomicStage has no target handle.

`PipelineCanvasPage.onConnect` then rejects every v2 connection without both handle ids (`packages/ui/src/canvas/PipelineCanvasPage.tsx:553-563`). Its immediately following fallback to the accepted `done -> input` control convention is unreachable for a missing handle (`packages/ui/src/canvas/PipelineCanvasPage.tsx:581-597`). This is specifically the convention the kernel accepts for input-less capabilities (`src/core/pipeline-registry/definition.ts:2730-2744,2793-2799`).

The mounted page test does not exercise the real node: its ReactFlow mock fabricates `sourceHandle: 'done'` and `targetHandle: 'input'` (`packages/ui/test/canvas/pipeline-canvas-page.test.tsx:119-129`). The all-eight-kinds shared fixture also has `root.connections: []` (`packages/ui/test/fixtures/canvas-v2-authoring.ts:87-159`). Thus the green test suite does not discriminate this failure.

Impact: a user cannot author the common sequential v2 graph in which one input-less AtomicStage feeds another, violating the requirement that the supported root vocabulary be genuinely connectable. This blocks real blank-Canvas authoring even though model/server tests pass.

Recommendation: render an explicit accepted control target handle for input-less AtomicStages (and keep typed handles when declared), or make the fallback and rendered affordance coherent without rejecting null handles first. Add a mounted integration test using the actual `StageNode` plus a production-shaped `inputs: []` catalog and assert the authored edge survives preparation/save/reload.

### Major

#### M1 — Entering an invalid top-level limit silently deletes the existing budget/limit

`DefinitionContractPanel.optionalPositive()` maps every blank, zero, negative, fractional, or otherwise invalid value to `undefined` (`packages/ui/src/canvas/DefinitionContractPanel.tsx:113-118`). The input handler converts that to `null` (`packages/ui/src/canvas/DefinitionContractPanel.tsx:168-179`), and `updateDefinitionContracts()` interprets `null` as deletion (`packages/ui/src/canvas/draft.ts:485-493`). Therefore, changing an existing budget such as `32` to `0` silently removes the budget instead of retaining/reporting the invalid authored value. The draft can subsequently validate and save with no budget, so the user's safety limit is lost.

The pure model correctly rejects a numeric zero (`packages/ui/src/canvas/draft.ts:472-476`; `packages/ui/test/canvas/v2-authoring-model.test.ts:255-271`), but the component never sends zero to that model. Existing mounted tests cover only positive values.

This contradicts the spec requirement that non-positive top-level limits be reported at the corresponding controls before save succeeds.

Recommendation: distinguish an empty field (explicit removal) from a non-empty invalid value. Preserve/display invalid raw input with a field-level error, do not mutate the prior limit, and block save until repaired. Add a mounted regression beginning with a non-empty budget and entering `0`, a negative, and a fraction.

#### M2 — Changing a BoundedLoop body leaves invisible stale exit mappings and makes the draft unsaveable

The body selector patches only `{ body }` (`packages/ui/src/canvas/V2NodePanel.tsx:453-460`). `updateBoundedLoopContract()` merges exit patches into the previous map and has no replacement/removal operation (`packages/ui/src/canvas/draft.ts:538-553`). After switching bodies, the panel renders only the newly selected declaration's outcomes (`packages/ui/src/canvas/V2NodePanel.tsx:495-517`), so old exit keys remain in the submitted draft but have no visible control through which the user can remove them.

The authoritative preparation rejects every such old key as `UNREACHABLE_EXIT` (`src/core/pipeline-registry/definition.ts:2272-2303`). For example, switching from a body with `retry, done` to one with only `done` leaves `retry` hidden and permanently blocks save.

Recommendation: make body switching one coherent model operation: preserve mappings for intersecting outcomes, create visible defaults for newly reachable outcomes, and remove mappings that are not reachable in the new body (or provide an explicit visible repair/removal affordance). Cover the two-body/different-outcome transition through mounted validate/save tests.

#### M3 — A body-connection diagnostic does not identify or mark the affected connection control

The locator correctly recognizes `/declarations/<n>/graph/connections/<m>/...` as `body-connection` (`packages/ui/src/canvas/draft.ts:1350-1362`). Selection opens the declaration and derives the consuming body stage (`packages/ui/src/canvas/PipelineCanvasPage.tsx:1388-1419`), but it reduces the focused field to a tail such as `to/port` and passes that into the body-stage execution editor.

`BodyConnections` has no selected connection, focused field, or severity prop (`packages/ui/src/canvas/DeclarationsPanel.tsx:374-388`), its rendered connection row has no issue marker (`packages/ui/src/canvas/DeclarationsPanel.tsx:393-417`), and its invocation passes only stages/connections/add/remove callbacks (`packages/ui/src/canvas/DeclarationsPanel.tsx:621-626`). Consequently the affected connection is not identified or marked; `to/port` also matches none of `V2ExecutionEditor`'s execution controls. The diagnostic test covers declaration and body-node paths but contains no body-connection issue/assertion (`packages/ui/test/canvas/pipeline-canvas-page.test.tsx:3266-3326`).

This misses the explicit diagnostic-locator scenario requiring a body connection to be identified while retaining the full path.

Recommendation: carry the selected body-connection id, nested field, and actual severity into `BodyConnections`; mark the exact row and closest endpoint/port control. Add a mounted warning/error regression for `/declarations/0/graph/connections/0/to/port`.

### Minor

#### N1 — Body-node warning highlights are rendered as errors

The issue drawer preserves the server severity, but `DeclarationsPanel` constructs body-stage field issues with a hard-coded `'error'` (`packages/ui/src/canvas/DeclarationsPanel.tsx:587-594`). A server warning at a body execution/phase field is therefore visually misrepresented as an error, contrary to the requirement to consume shared diagnostic severity.

Recommendation: retain the selected issue (or derive the matching issue by path), pass its real `error | warning` severity into the declaration editor, and test both severities.

### Trivial

#### T1 — Comments still describe FanOut/Join and BoundedLoop as the pre-ECP-6 editor

`V2NodePanel.tsx:147-153` says FanOut/Join are deliberately excluded from `isV2EditableNodeKind`, while the current implementation and `draft.test.ts:490-492` explicitly include them. The duplicated BoundedLoop comments at `V2NodePanel.tsx:357-367` still describe the old `maxRounds`/read-only behavior. These comments can misdirect subsequent fixes in a high-coupling editor.

Recommendation: remove the obsolete block and leave one current BoundedLoop contract comment.

## Independent test evidence

The following commands were run against the reviewed dirty-worktree fingerprint above:

- `node bin/rasen.js validate ecp-canvas-v2-authoring-parity --strict` — PASS
- `pnpm --dir packages/ui typecheck` — PASS
- `pnpm --dir packages/ui exec vitest run test/canvas/v2-authoring-model.test.ts test/canvas/draft.test.ts test/canvas/layout.test.ts test/canvas/pipeline-canvas-page.test.tsx --reporter=dot` — PASS, 4 files / 130 tests
- `pnpm exec vitest run test/core/management-api/pipelines-api.test.ts test/core/pipeline-registry/blank-v2-ui-parity.test.ts test/core/pipeline-registry/definition.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1` — PASS, 3 files / 161 tests
- `pnpm build` — PASS
- `git diff --check` — PASS with only existing LF-to-CRLF working-copy warnings
- Worktree-scoped process check — no matching Node/Vitest process remained after verification

The pre-existing clean-isolated full-root JSON artifact at `E:\rasen-ecp6-root-temp-20260802-0833-clean-default-pool\root-suite.json` was independently parsed rather than accepted from prose: `success=true`, 433 result files, 1788/1788 suites passed, 6843 total tests, 6809 passed, 34 pending, 0 failed. Its last-write time was 2026-08-02T08:43:55.0601774+08:00, after the latest reviewed source/test mtime above.

These green gates establish broad regression safety, but they do not negate B1–M3: B1 is hidden by a fabricated ReactFlow connection, M1 is bypassed before the rejecting model sees the value, M2 lacks a body-transition case, and M3 lacks a body-connection locator case.

## Out of scope / not performed

- No implementation fixes, task/run-state edits, commits, pushes, archive, shipment, or PR operations were performed.
- No canonical ECP Run was created. ECP-7 execution/public-effect closure and ECP-8 release/legacy-retirement remain outside this child review.
- Preserved temporary directories, `rasen/changes/foo/`, external root-suite TEMP directories, and the safety stash were not modified or removed.

## Final gate

`CHANGES_REQUIRED`: ECP-6 is not acceptance-complete until B1 and M1–M3 are fixed, N1 and T1 are addressed, focused regressions are added, and an independent re-review returns clean.
