# Implementer Handoff #1 — ecp-review-cycle

**Session**: 2026-07-29. **Branch**: `feat/ecp-review-cycle`.

## Completed Task Groups (committed)

### Group 1: CommittedDomainResult enrichment — `131afaea`
- Added `actor?: ActorRef` and `actorAttestation?: EvidenceRef` to `CommittedDomainResult` in record.ts
- Extended Zod `ResultSchema` + `commit-action-result` stimulus schema
- Fixed 3 TS errors in `review-cycle-runtime.ts`
- Updated `parseCommittedAction` to decode `actorAttestation` via `decodeEvidenceRef`

### Groups 2+4: Reconciler bounded-loop execution + pre-commit validation — `118e50cb`
- **Reconciler** (`reconciler.ts`): Added bounded-loop pass between atomic succeeded-set and atomic classification. For each bounded-loop whose requires are met, calls `projectReviewCycleProgress`:
  - `clean` → add to succeeded set (downstream nodes proceed)
  - `exhausted` → emit escalate with `loop.outcomes.exhausted`
  - `ready` → emit admit with `input.reviewCycle` payload (loopPath, round, phase, openFindingIds) and top-level `profilePath`
  - `waiting`/`failed` → no candidate (surface via projection)
- Guarded `finishCandidate()` over ALL nodes (atomic + bounded-loop)
- **Facade** (`facade-runtime.ts`): Calls `validateReviewCycleCompletion` after `verifyCompletion` before commit stimulus. Passes `actor`/`actorAttestation` through to commit stimulus. Extended `buildAction` descriptor to accept optional `profilePath` and `input`. Passes plan to all `projectRunView` calls.
- **Key design decision**: The admit action carries `profilePath` at the top level (not inside `input.reviewCycle`) and `input.reviewCycle` carries `loopPath` (not `profilePath`). This matches the existing lowerer test expectations.

### Group 3: Failure-first guard tests — `30e78aac`
- 4 tests: malformed review result, same-actor rejection, ship guard (open Major), malformed triage
- All assert Record is NOT mutated on rejection
- **Gotcha**: Evidence digest characters must be valid hex (0-9, a-f). The test initially used 'g' which failed the regex.

### Group 5: Happy-path and identity tests — `98f1a417`
- Clean round-1 review immediately finishes completed
- Hierarchical identity reconstruction from canonical Record alone
- **Gotcha**: After `complete()`, the reconciler already admits the next phase. So `projectReviewCycleProgress` returns `waiting` (not `ready`) because the triage action is already active.

### Group 6: Recovery and fault-injection tests — `4d14b8da`
- 4 tests: crash-before-commit, crash-after-commit, ack-loss, mid-fix-reviews boundary
- All use fresh-facade simulation (new `createChangePipelineRuntime` with same store+plan)

### Group 7: Built-in migration routing — `cb430720`
- **Normalizer** (`definition.ts` normalizeV1): Stages with `loop.kind === 'review-cycle'` or `verifyPolicy === 'adaptive'` now produce a v2 BoundedLoop with 4-phase ReviewCycle body declaration instead of an AtomicStage. The BoundedLoop keeps the same root node ID (`stage:${stage.id}`) so connections work unchanged.
- **Support checker**: `supportsV2ReviewCycleRuntime` now allows mixed AtomicStage+BoundedLoop+Gate+Choice root plans (previously required ALL non-Finish nodes to be BoundedLoop).
- **Lowerer** (`lowerer.ts`): `lowerV2ReviewCyclePlanInput` now handles AtomicStage root nodes alongside BoundedLoop and Finish. Removed the requirement for at least one BoundedLoop (mixed plans are valid).
- **Gotcha**: The `provenance` field on CompositeDeclaration is a NON_SEMANTIC key (stripped by `semanticCanonicalizeDefinition` in `definition-plan-internal.ts`). The execution-plan test was updated to compare against the canonicalized definition from the sealed plan, not the raw normalizeV1 output.
- **Gotcha**: After changing normalizeV1, `node build.js` MUST be run before CLI-based E2E tests pass (stale dist trap).

### Group 8: Projection parity — `75d39a4e`
- **Projector** (`projector.ts`): `projectRunView` now accepts an optional `RuntimePlan` parameter. When the plan has a bounded-loop, emits a `review-cycle/1` section alongside `root-dag/1` with round, phase, outcome, findings, actors, waitReason, maxRounds.
- **Facade**: All receipt/inspect paths now pass `deps.plan` to `projectRunView`.

### Group 10: Thin launcher — `240dad02`
- Rewrote `src/core/templates/workflows/review-cycle.ts` as a thin launcher. Removed all prompt-owned mechanical state (round counter, phase sequencing, max-rounds, escalation ladder). The skill now launches/resumes the canonical Run and reads progress from the ChangeRunView.

## Remaining Task Groups

### Group 9: Canvas constrained view (4 tasks, acceptance #11)
- **9.1**: Update `packages/ui/src/canvas/V2NodePanel.tsx` to display BoundedLoop body details (4 phases, max rounds, exits)
- **9.2**: Update `packages/ui/src/canvas/StageNode.tsx` badge to show "Review Cycle"
- **9.3**: Expose maxRounds as configurable scalar in detail panel
- **9.4**: Verify support status display
- **Note**: These are additive UI changes. Check `packages/ui/src/canvas/` for existing component structure. The `EngineSupportPanel.tsx` already has executionMode labels.

### Group 8 (remaining): Contracts + CLI + parity test
- **8.2**: Extend `ChangeRunViewSection` in contracts.ts (the section is already emitted as a plain object; just needs the type)
- **8.3**: CLI `pipeline status` rendering (check `src/commands/pipeline.ts`)
- **8.5**: Parity test

### Group 10 (remaining): Launcher test
- **10.4**: Test that skill instructions don't contain prompt-owned mechanical state

### Group 11: Real dogfood (acceptance #8)
- Run a real Change through the ReviewCycle pipeline
- Record evidence to slice `result.md`

### Group 12: Regression verification
- Full test suite, tsc, UI build, cross-platform checks

## Test Baseline
- `test/core/change-run/`: **341 passed / 0 failed** (was 328+3 failing)
- `npx tsc --noEmit`: **clean**
- Commit SHAs: `131afaea`, `118e50cb`, `30e78aac`, `98f1a417`, `4d14b8da`, `cb430720`, `75d39a4e`, `240dad02`

## Durable Findings

1. **`provenance` is non-semantic**: The `NON_SEMANTIC_DEFINITION_KEYS` set in `definition-plan-internal.ts` includes `provenance`, `canvas`, `position`, `sourcePath`. These are stripped during canonicalization. Any test comparing raw definitions against sealed/opened definitions must account for this.

2. **CLI E2E tests require fresh build**: After changing normalizeV1 or any code used by the CLI, `node build.js` must be run before `runCLI`-based tests pass. The CLI reads from `dist/`, not from source.

3. **Reconciler bounded-loop ordering**: The bounded-loop pass runs AFTER atomic succeeded-set computation but BEFORE atomic classification. This ensures downstream atomic nodes (ship, archive) see the bounded-loop in the succeeded set when it's clean. The bounded-loop admit candidates are processed AFTER atomic admits, both going through workspace-compatible selection.
