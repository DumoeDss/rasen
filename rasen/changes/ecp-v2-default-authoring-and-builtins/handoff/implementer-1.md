# Handoff: ecp-v2-default-authoring-and-builtins — implementer #1

## Original intent

Complete child 2 of the `ecp-v2-authoring-loop-contract-closure` portfolio: make Definition v2 the blank/default authoring form, close native-v2 execution and built-in lowering metadata, establish one prepared execution view, then migrate exactly six package built-ins without changing the byte-identical v1 `auto-decompose` compatibility fixture. Work must remain in the isolated `wip/ecp-shared-bounded-loop-lifecycle-resume` worktree, preserve child 1's shared uncommitted baseline, and never commit or edit run state from this worker.

## Position

Pipeline: portfolio child apply. Completed stages: blank-v2/serializer, closed Atomic execution declaration, native-v2 profile resolution, minimal prepared-view boundary, typed lowering metadata validation. Current stage: typed built-in lowering metadata; preparation contracts are green, lowerer consumption is deliberately not yet finished. The six built-in manifests have not been started in this relay.

## Done / Remaining

Done: tasks 1.1-1.4, 2.1-2.6, 3.1-3.2, 4.2, and 4.4 are checked in `tasks.md`.

Remaining: task 1.5; tasks 3.3-3.5; tasks 4.1, 4.3, 4.5; all tasks 5.x-9.x. In particular, remove native-v2 lowerer fallbacks and `unknown`/pipeline-name/`legacy.*` inference before authoring the six manifests. Then migrate ReviewCycle built-ins, GoalLoop built-ins, and `full-feature`; update CLI/registry read planes and Canvas blank seed; run the acceptance matrix. Keep parent-PR remote CI task 9.5 open.

## Key decisions (and why)

- `AtomicStage.execution` is a closed version-1 object. Capability identity remains exact and trusted; execution policy is separate and includes explicit workspace access so role renames cannot change locking semantics.
- Native-v2 policy resolution now runs through the ordinary stage override chain by public logical id. `sessionReuseAuthored` is retained, while ECP-7's handoff/reuse numeric limits stay the existing truthful placeholders.
- `projectPreparedPipelineExecutionView(prepared, catalog, inputs)` is the pure inspection boundary. It reuses launch capability/policy resolution and exposes full logical/profile paths while keeping the compiled runtime plan opaque.
- Management inventory/detail consume the shared view for native v2 and no longer force executable v2 definitions to `stages: []`. CLI still has its early raw-v2 branch and must be migrated later.
- Native-v2 FanOut and Join metadata is required and validated: exact members, conditions, required flags, cap/budget, join target, required/optional partition, and distinct outcomes. Goal/Review phase tags and goal variants are typed. No new node kind or arbitrary hook was introduced.
- Join port contracts now expose the typed `outcomes.proceed` and `outcomes.failed` values instead of a hard-coded `done`, so preparation and lowerer share authored routing meaning.
- `auto-decompose/pipeline.yaml` has not been touched. The three preserved test-temp directories have not been touched or committed.

## Dead ends & gotchas

- Drive C: is full. Vitest initially failed with `ENOSPC`. For all tests set `TEMP` and `TMP` to the worktree-local `.tmp-ecp6-defaults`; that directory is this relay's untracked scratch only and must not be committed.
- `rasen-handoff` lives under the main repository skill root, not the isolated worktree. Reading it does not authorize edits outside this worktree.
- Existing child 1 changes are intentionally dirty and shared. Do not revert files outside this child, especially the bounded-loop lifecycle core/tests and parent planning artifacts.
- The current lowerer still casts/falls back for FanOut/Join metadata and goal variant. Preparation now guarantees typed fields for authored v2, and v1 normalization already materializes them; the next implementer should remove those fallbacks rather than weaken validation.
- A valid FanOut fixture now requires its matching Join and member nodes. Old one-node FanOut/Join test fixtures were updated only where they needed to reach port validation.
- `src/core/pipeline-registry/definition.ts` imports YAML after local imports; lint/import ordering may require cleanup later.

## Eliminated hypotheses

none — this relay implemented planned contracts rather than debugging an unknown fault. The previous hypothesis that native v2 could reuse review-oriented policy synthesis was disproved by failure-first profile tests: it changed workspace to write, dropped gates/models/reuse intent, and ignored config provenance.

## Working set

- Core authored contracts and serialization: `src/core/pipeline-registry/definition.ts`, `src/core/pipeline-library.ts`, `src/core/pipeline-registry/index.ts`.
- Policy/profile resolution: `src/core/pipeline-registry/profile-resolver.ts`, launch integration in `src/commands/pipeline.ts`.
- Shared view: `src/core/pipeline-registry/prepared-execution-view.ts`, Management mapping in `src/core/management-api/pipelines.ts` and `wire-types.ts`.
- Tests: `test/core/pipeline-registry/definition.test.ts`, `profile-resolver.test.ts`, `prepared-execution-view.test.ts`, `test/core/pipeline-library.test.ts`, and the focused Management API test.
- Authoritative task state: `rasen/changes/ecp-v2-default-authoring-and-builtins/tasks.md`.
- Verification completed in this relay:
  - Definition full file: 111/111 green.
  - Profile + prepared view + focused native-v2 API: 8/8 green (43 unrelated API cases skipped by filter).
  - Root `npx tsc --noEmit`: green.
  - Earlier blank serializer/library focused: 2/2; Atomic execution focused plus Definition at that point: green.
- Always run tests with:
  `$taskTemp = Join-Path (Get-Location) '.tmp-ecp6-defaults'; $env:TEMP = $taskTemp; $env:TMP = $taskTemp`.

## Next action

Add failure-first lowerer tests for native-v2 ReviewCycle, GoalLoop, Choice, FanOut/Join, Gate, Finish, and strategy/profile paths that contain no `legacy.*` fields and use a neutral pipeline name; then make `lowerer.ts` consume the validated typed fields directly, removing goal pipeline-name inference and FanOut/Join fallback defaults. Do not start the six built-in manifests until tasks 3.3-3.5 are green.
