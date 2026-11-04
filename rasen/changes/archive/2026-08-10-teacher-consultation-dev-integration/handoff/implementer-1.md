# Handoff: teacher-consultation-dev-integration — implementer #1

## Original intent

Finish and honestly tick every apply-owned task in sections 1–6 while leaving the Teacher-first (`914c836a`) / dev-second (`96452f5c`) merge uncommitted.

## Position

Pipeline: apply. Current stage: implementation/merge integration. `MERGE_HEAD` remains `96452f5c`; there are no unmerged paths.

## Done / Remaining

Done: 1.1, 4.1, 4.2; test work added for stored task-loop reopen.

Remaining: all currently unticked tasks in sections 1–6 must be audited and checked only with cited evidence. Sections 7–9 remain stage-owned and must remain unticked unless exactly executed.

## Key decisions (and why)

- Preserve Teacher-first merge parent order: the corrected proposal/design requires `914c836a` first and `96452f5c` second.
- `src/commands/agent.ts` already rejects Codex `consultable-leaf` before binary lookup; its E2E regression is in `test/cli-e2e/agent-dispatch-codex.test.ts`.
- `runtime-context.ts` uses `createTaskLoopWorkspaceProjection` for fresh and stored runtimes; stored reopen takes `sourceSessionHost`, not HTTP cwd.
- Router/server retain three lanes: ordinary SessionHost, exact Teacher SessionHost, reusable owner.

## Dead ends & gotchas

- Stored task-loop projection is lazy. Calling `facade.resume()` alone does not emit the report; completing the Teacher advice in the added regression does and verifies the canonical `rasen/changes/.../evidence/task-loop-report.md` path.
- The inherited dev file `test/core/templates/skill-templates-parity.test.ts` has a UTF-8 BOM; do not claim whole-merge no-BOM verification without resolving or explicitly scoping it.

## Eliminated hypotheses

- The initial stored task-loop reopen is not blocked by a missing source Session at construction time; projection is evaluated later. The focused restart test passes with a daemon-owned Session view.

## Working set

- Modified `test/core/change-run/consultation-facade-journey.test.ts`: stored task-loop restart now drives Teacher advice and verifies report creation.
- Existing child evidence: `evidence/implementer-2-verification.md`.
- Latest focused command passed: `pnpm exec vitest run test/core/change-run/consultation-facade-journey.test.ts test/cli-e2e/agent-dispatch-codex.test.ts test/core/management-api/reusable-session-routes.test.ts test/core/management-api/supervisor-host-lifecycle.test.ts test/core/session-host/claude-backend.test.ts test/core/worker-contracts.test.ts --reporter=dot` (6 files, 86 tests).

## Next action

Audit the eight conflict paths and six auto-merge paths against the corrected design, record a section-1–6 task/evidence matrix, then add any still-missing mismatch/no-authority and multi-owner failure tests before ticking the remaining checkboxes.
