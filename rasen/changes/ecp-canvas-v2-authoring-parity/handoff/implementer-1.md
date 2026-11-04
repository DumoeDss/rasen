# Implementer 1 handoff — Canvas v2 authoring foundation

## Scope and state

- Apply-stage work only; no commit, push, PR, archive, canonical Run, or machine run-state mutation was performed.
- Worktree: `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- Branch at entry: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- The worktree already contained the shared ECP portfolio changes. Preserve them. In particular, several Canvas files already carried ECP-5 work before this implementation; the changes below extend rather than replace that work.
- Change progress after this relay: **17/67 complete, 50 remaining**.

## Completed tasks

- 1.2–1.4: red-first wire-shape, eight-kind vocabulary, and nested locator tests.
- 2.1–2.8: closed known wire fields, lossless extension-bearing draft model, nested patch helpers, all-eight root vocabulary, complete new AtomicStage execution, coherent reference rewrites/refusals, declaration rename, and sentinel tests.
- 5.1–5.4: pure paired FanOut/Join create/update/remove transactions with coherent membership and refusal guards.
- 6.1: strict JSON-Pointer locator model for definition/root/declaration/body ownership.
- 7.1: v2 duplication identity fork preserving authored version and semantic content.

## Product changes

### `packages/ui/src/api/types.ts`

- Added closed known shapes for AtomicStage execution/workspace/handoff, Gate target/dispositions, FanOut members/limits/Join reference, Join partitions/outcomes, BoundedLoop lifecycle-v1, definition limits, review/goal phase, and goal-cycle variant.
- Kept extension-bearing objects representable so unrelated UI edits do not erase future/unknown fields.
- Execution remains optional on the read-side Atomic wire type so an invalid server-returned draft can still render and be repaired; authored new AtomicStages always receive complete execution-v1.

### `packages/ui/src/canvas/draft.ts`

- Added `duplicateV2Definition` with user identity fork (`name`, `pipeline:<name>`, `canvas:<name>`) and version preservation.
- Added lossless nested helpers for Atomic execution, definition contracts, BoundedLoop contract/lifecycle, and Gate decisions/dispositions.
- Root palette/editable vocabulary is now exactly the eight kernel v2 kinds; declaration bodies remain AtomicStage-only.
- Root rename rewrites connections, Gate targets, FanOut branch/member/path/Join references, and Join inputs/partitions.
- Root remove refuses Gate targets and incoherent parallel mutations; parallel member removal updates both halves.
- Added custom declaration rename with CompositeRef/BoundedLoop reference rewrites and built-in/identity guards.
- Added coherent paired-parallel APIs: `createParallelPair`, `setParallelMembers`, `updateParallelMember`, `updateParallelContract`, and `removeParallelPair`.
- Added strict JSON-Pointer parsing and ownership mapping for top-level definition fields, root nodes/connections, declarations, and body nodes/connections; malformed escapes, out-of-range indexes, and unknown future top-level paths remain unmapped.

### Mounted Canvas foundation

- `PipelineCanvasPage.tsx` creates execution-complete AtomicStages and lifecycle-complete BoundedLoops.
- Gate creation now supplies a same-graph Atomic target and exact decision/disposition pairs; generic Gate outcome edits keep dispositions synchronized.
- FanOut or Join palette actions create a coherent pair from existing root Atomic members.
- V2 duplicate uses the new v2 identity helper; authored-v1 duplicate behavior is unchanged.
- `layout.ts` recognizes only structurally complete v2 shapes as safely editable. FanOut/Join are selectable/connectable, but ordinary node deletion is disabled pending the explicit paired-delete UI.
- `V2NodePanel.tsx` now exposes FanOut/Join structural summaries inside the supported panel boundary. These details are intentionally still mostly read-only.

## Tests and evidence

- Initial red run for the new pure model suite: **11 failed / 2 passed**.
- Final focused command:

  `pnpm --dir packages/ui exec vitest run test/canvas/v2-authoring-model.test.ts test/canvas/draft.test.ts test/canvas/layout.test.ts test/canvas/pipeline-canvas-page.test.tsx --reporter=dot`

  Result: **4 files / 119 tests passed**.
- `pnpm --dir packages/ui typecheck`: passed.
- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`: passed; auto-decompose remains untouched by this Change.
- `git diff --check`: no whitespace errors; the dirty shared tree emits the repository's existing LF-to-CRLF warnings.
- Two existing jsdom `window.scrollTo` not-implemented messages remain on stderr in passing page tests.

## New/updated coverage

- New: `packages/ui/test/canvas/v2-authoring-model.test.ts`.
- Updated pure/model tests cover all-eight vocabulary, nested lossless patches and optional clearing, Gate disposition synchronization and absence of retired `execution.gate`, root/declaration reference rewrites, coherent parallel transactions/refusals, duplication, and positive/negative diagnostic locator cases.
- Updated mounted page journey proves visible palette actions submit execution-complete AtomicStage and lifecycle-complete BoundedLoop values.
- Updated save test preserves unexposed v2 fields through an unrelated visible edit.

## Remaining work for a fresh implementer

Do not mark the following complete until their mounted/persistence evidence exists:

1. Definition contract editor and declaration UI: tasks 3.1–3.7. Pure helpers and body execution fields are ready, but definition inputs/artifacts/outcomes/limits, declaration rename, execution/phase controls, and incompatibility journeys are not mounted.
2. Structured node panels: tasks 4.1–4.10. Atomic execution, Gate target/disposition, full loop limits/exits/lifecycle/strategy, phase/variant, and related negative journeys need controls. Gate decision mutation is already coherent in the draft model.
3. Parallel UI: tasks 5.5–5.6. Wire the existing paired transaction APIs into structured FanOut/Join controls and an explicit paired-delete action; add mounted save/reload matrices.
4. Diagnostic navigation: tasks 6.2–6.6. `locateDefinitionIssue` now returns definition/declaration/body owners, but `applyIssueMarkers` intentionally marks only root nodes/connections. Extend `IssuesDrawer` and panel/control focus/highlighting without guessing unknown paths.
5. Persistence proof: tasks 7.2–7.8. Add the all-eight visible authoring request, real Management preparation/save/detail/canonical/digest round trips, intentional-edit stabilization, portable export/import, sentinel preservation matrix, and explicit v1 compatibility coverage.
6. Final verification/review: all section 8 and 9 tasks remain open. Run full UI/root/build/lint/strict gates only after the mounted surface is complete.

## Important continuation notes

- `removeV2Node` deliberately refuses independent FanOut/Join deletion; use `removeParallelPair` from the future explicit UI action.
- `createParallelPair` currently accepts root AtomicStage members, matching the current executable parallel contract and built-in shapes.
- `updateAtomicStageExecution` can repair a missing execution block with a complete v1 default; mount this in the Atomic/body panel rather than adding a second state model.
- `createDefaultBoundedLoopLifecycle` and `updateBoundedLoopContract` are the only lifecycle draft paths needed by the future loop panel.
- FanOut/Join palette creation currently seeds all existing root AtomicStages. The structured editor must let users intentionally select and repartition members.
- Do not touch `.tmp-ecp6-defaults/`, `rasen/changes/foo/`, the preserved test temp directories, or the safety stash.
