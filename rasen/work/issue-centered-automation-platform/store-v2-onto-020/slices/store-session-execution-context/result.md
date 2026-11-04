# Result: store-session-execution-context (L6)

**Status:** passed
**Outcome:** 0.2.0's execution-root resolution is now the explicit-capability model (locked
decision D2): cwd-probe `resolveExecutionRoot` is replaced by `resolvedExecutionProjectRoot`,
space vs execution selectors are split, `resolveSessionLaunchContext` resolves the launch root
for a Store-selected run, and the Supervisor attaches the Store root without making it the
agent's cwd. Unavailable execution authority refuses rather than infers (no `.git`-ancestor
probing).

Delivered as a direct git port in two commits plus one CI reconciliation round: `4dfebd59`
(spine) + `789643c0` (rim) + `ed301828` ("reconcile the L6 port's CI fallout — 15 suites + the
submit/router space grafts"), all in PR #160 (merge `958b75dd`).

## Evidence

- `test/core/management-api/session-launch-context.test.ts` pins the launch-context contract
  (member-project cwd as execution root, Store root attachment, refusal on unavailable
  authority).
- Supervisor behavior (attach-without-cwd-collapse, `--add-dir <store-root>`) is covered by the
  ported `test/core/management-api/supervisor*.test.ts` family (lifecycle, windows, injection).
- Store/project root selection pairing (`--store S --project P` orthogonal selection,
  `project_not_in_store` refusal) is covered by `test/commands/store-root-selection.test.ts` and
  `test/commands/pipeline-store-root-selection.test.ts`.
- The L6 CI round (`ed301828`, 15 suites) reconciled the ported-test premises against 0.2.0's
  submit/router space; recorded in `handoff/lead-5.md`.

## Attempts / history

- 2026-08-13..16 - Ported as spine + rim in PR #160; sequenced immediately after the foundation
  could host a launch, per the roadmap's ordering note.
- 2026-08-16 - Post-merge review found zero unexplained divergence in the execution-context
  seams; slice closed `passed`.
