# Post-cap strategy attempt 2 successor handoff

## Status

HANDOFF. The protocol implementation was materially tightened, but completion cannot be claimed because the required typecheck, focused tests, build, full test suite, and change validation were blocked by the command permission layer in this session.

## Eliminated hypotheses

- The reported readonly JSON incompatibility does not require a cast, deep clone, `unknown`, or a second JSON type. `JsonValueSchema` now transforms the strict decoded JSON value to the canonical readonly `JsonValue` return type.
- Candidate previews do not need a sentinel Action or agent dispatch metadata. The descriptor is limited to `format`, `candidateId`, `runId`, `recordVersion`, `nodeId`, `occurrence`, optional `profilePath`, and optional canonical `input`.
- Agent preview cannot remain an opt-in runtime switch. Agent lifecycle settlement now stops before admission whenever no trusted turn-input resolver is present.
- Admission cannot support defer mode. `AdmitAgentCandidatesContext.deliveryMode` is restricted to `grant`.
- Receipt schema closure alone is insufficient. Receipt decoding now rejects duplicate candidate identities and candidates whose Run or Record version differs from the receipt view.
- The UI wire mirror was incomplete. `packages/ui/src/api/types.ts` now mirrors prompt-free run-control candidates additively.
- Pending workspace reservations could leak if later Action construction, reduction, or store mutation failed. Facade settlement now tracks pending reservations, releases them on failure, and finalizes them only after the corresponding Record mutation succeeds.

## Exact retained protocol files

- `src/core/change-run/contracts.ts`
- `src/core/change-run/facade.ts`
- `src/core/change-run/internal/actions.ts`
- `src/core/change-run/internal/facade-runtime.ts`
- `src/core/change-run/internal/runtime-context.ts`
- `src/commands/pipeline.ts`
- `src/cli/index.ts`
- `src/core/completions/command-registry.ts`
- `src/core/management-api/run-control.ts`
- `src/core/management-api/frozen-action-executor.ts`
- `src/core/frozen-action-executor/authority.ts`
- `src/core/frozen-action-executor/executor.ts`
- `packages/ui/src/api/types.ts`
- `src/core/templates/workflows/_orchestration.ts`
- `src/core/templates/workflows/auto.ts`
- `src/core/templates/workflows/goal-command.ts`
- `src/core/templates/workflows/review-cycle.ts`

## Added or updated discriminating tests

- `test/core/change-run/contracts.test.ts`: candidate uniqueness and receipt Run/version invariants.
- `test/core/change-run/runtime-context.test.ts`: stable prompt-free preview, exact explicit admission, extra-manifest rejection, and stale reuse.
- `test/commands/pipeline-agent-turn-input.test.ts`: bounded closed manifest parsing, duplicate/missing/extra and ephemera-path controls.
- `test/core/change-run/facade-settle-completeness.test.ts`: exact fan-out admission and rollback of every pending reservation when Action construction fails before the batch can be granted.

The facade completeness fixture was also adjusted to remove the deleted `requireAgentPreview` option and to use explicit admission where agent Actions are expected.

## Verification actually completed

- `git diff --check` passed. Output contained only Windows LF-to-CRLF working-copy warnings.

## Verification attempted but not executed

Each command was intercepted as approval-required, so none may be reported as passing:

- `pnpm exec tsc --noEmit`
- `pnpm exec vitest run test/core/change-run/runtime-context.test.ts test/core/change-run/facade-settle-completeness.test.ts test/core/change-run/contracts.test.ts test/commands/pipeline-agent-turn-input.test.ts --reporter=dot`
- Direct `node node_modules/vitest/vitest.mjs run ...` equivalent

## Exact remaining work

1. Run `pnpm exec tsc --noEmit` and fix every compiler error. Pay particular attention to `facade-runtime.ts` reservation tracking and `facade-settle-completeness.test.ts` fixture typing.
2. Run the focused candidate-preview/admit tests listed above. Fix fixture expectations revealed by mandatory preview behavior.
3. Run frozen executor and Management API authority suites, including authority, executor, production executor, and management frozen-action executor tests.
4. Add or identify a discriminating real retry/resume test proving replacement Route Lease acquisition while preserving Claude session or Codex thread identity. Static inspection alone is insufficient for this AT claim.
5. Audit command/host Action construction semantically. The pre-existing production builder calls `buildAgentAction` for every descriptor; confirm whether shipped profiles can contain command/host capabilities and, if so, restore their prior construction through `buildCommandAction`/`buildHostAction` without changing their inputs.
6. Run `pnpm build`.
7. Run the broader focused AT-1–AT-14 suites and record exact file/test counts.
8. Run full `pnpm test -- --reporter=dot` in the requested background mode, with foreground checks no more than 270 seconds apart.
9. Run change validation, UTF-8 replacement-character scan, JSON/YAML parsing, persistence prompt/secret scans, and a final `git diff --check`.
10. Re-open and verify the architecture-index edits in `detail/quick-locate.md`, `detail/modules/workflow-pipeline.md`, and `detail/modules/ai-integration.md`; earlier write attempts were denied, although the current diff shows index modifications from the shared worktree.
11. Append the exact heading `Post-cap strategy attempt 2 fix` to `evidence/review-cycle-report.md`, including the prior churn audit, exact protocol files, exact commands/counts, and residual risk.
12. Check tasks 7.1–7.8 only after every required proof passes.

## Residual risk

- The new reservation rollback/finalization code is not dynamically verified.
- Mandatory agent preview changes assumptions in older facade tests; more fixtures may require explicit `admit` calls.
- Command/host production construction remains an unresolved semantic audit item.
- Exact replacement-lease retry/resume identity preservation has not yet been proven by a real-path test.
- No typecheck, build, focused suite, full suite, or change validation result is available from this session.
