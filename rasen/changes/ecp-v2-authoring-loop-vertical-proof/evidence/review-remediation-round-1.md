# Review remediation round 1: M1 workspace identity fail-open

Date: 2026-08-02\
Role: non-original-author fixer\
Scope: verifier Major M1 only

## Outcome

The Management workspace identity helper no longer collapses an unavailable,
unreadable, or concurrently stale authority read into `[]`. It returns an
explicit discriminated result:

- `ok: true` carries a non-empty `workspaceIds` tuple and
  `registeredSource: none | active | archived`;
- `ok: false` carries typed code `workspace_identity_unavailable` and a stable
  reason.

A missing archive directory is a valid no-candidate transition and remains
`ok: true` with the selected-root legacy identity. An archive path that cannot
be enumerated is `ok: false`. Active and archived candidates are statted before
use. A suffix-matching non-directory is ignored, and a candidate that vanishes
between enumeration and stat is skipped while later legal candidates remain
eligible. If the archive itself moves during inspection, the result is
unavailable rather than a valid empty candidate set.

Consumers now fail closed consistently:

- Run list excludes a canonical Run when its per-change identity authority is
  unavailable;
- detail projects `workspace.scope: other`, clears controls, and downgrades any
  granted Action to `admitted_undelivered`;
- control returns HTTP 503 with typed code
  `workspace_identity_unavailable` before spawning, while Record bytes, digest,
  and version remain unchanged.

The normal selected-root legacy path and the legacy-to-registered active-to-
registered archived transition remain covered. Moving the active Change
directory into the archive retains the same registered physical identity and
keeps list/detail current for that Run.

## TDD evidence

Initial RED command:

`pnpm exec vitest run test/core/management-api/run-workspace-identity.test.ts test/core/change-run/runs-api.test.ts test/core/management-api/run-control.test.ts --reporter=verbose`

RED result: 3 files; 53 tests = 48 passed, 5 failed as intended.

The five discriminators proved the old implementation:

1. returned `[]` for an unavailable selected root;
2. did not expose a success/failure contract for normal transitions;
3. leaked another workspace's Run from list when archive enumeration failed;
4. returned an unredacted `scope=current` detail view for that failure;
5. admitted control and invoked the spawner instead of rejecting before
   mutation.

First GREEN rerun of the same command: 3 files, 53/53 passed.

Expanded focused Management command:

`pnpm exec vitest run test/core/management-api/run-workspace-identity.test.ts test/core/change-run/runs-api.test.ts test/core/management-api/run-control.test.ts test/core/management-api/runs.test.ts --reporter=dot`

Expanded result: 4 files, 60/60 passed.

The helper-only final discriminator rerun passed 2/2 after adding the explicit
missing-archive/no-candidate assertion.

## Gates

- `pnpm exec tsc --noEmit`: passed.
- `pnpm --dir packages/ui run typecheck`: passed.
- focused ESLint over the six production/test files: passed with no output.
- `pnpm run build`: passed.
- `node dist/cli/index.js validate ecp-v2-authoring-loop-vertical-proof --type change --strict --json`:
  1/1 valid, zero issues.
- `git -c core.safecrlf=false diff --check`: passed.
- `git hash-object pipelines/auto-decompose/pipeline.yaml`:
  `6f306544010a8950508f1223acfca5d62de407f5`.
- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`: passed;
  no diff.

The retained 87-minute full root suite was not rerun. This delta changes only
the Management identity resolution/admission seam; the focused helper,
list/detail/control suites, both typechecks, build, lint, strict validation,
and exact archive transition cover the observed risk. The independent
non-author reviewer owns the re-review and may choose a fresh vertical rerun.

## Changed files

- `src/core/management-api/run-workspace-identity.ts`
- `src/core/management-api/runs.ts`
- `src/core/management-api/run-control.ts`
- `test/core/management-api/run-workspace-identity.test.ts`
- `test/core/change-run/runs-api.test.ts`
- `test/core/management-api/run-control.test.ts`
- `rasen/changes/ecp-v2-authoring-loop-vertical-proof/evidence/review-remediation-round-1.md`

## Explicitly not touched

- no Session executor, worker/effect automation, private reducer/store path,
  or Operations projector change;
- no task 9.8, 9.9, or 9.10 checkbox change;
- no run-state, portfolio state, commit, push, ship, or archive;
- no main-workspace, safety-stash, retained temp-directory, or
  `auto-decompose` source change.

M1 remains pending independent non-author confirmation; this fixer does not
self-certify review closure.
