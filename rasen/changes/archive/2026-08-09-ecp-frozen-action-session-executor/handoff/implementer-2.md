# Implementer handoff 2 (7.1 wiring wave) - ecp-frozen-action-session-executor

For: the LEAD and the next reviewer/implementer. Stage: 7.1 production driver-
face wiring DONE; review round-1 Minor fixed; task 5.4 per-field mutation
receipts added. The 4 remaining unticked tasks (8.1, 10.1, 10.2, 10.4) are the
ECP-8-deferred environment-gated real receipts. This is a delta on
`implementer-1.md`; read that for the core module's design/receipts.

## What this wave wired (task 7.1)

Routed the production driver faces to the shared `dispatchGrantedAction`
contract so a granted frozen Action reaches the executor from each face:

- **Production seam** (`src/core/frozen-action-executor/production-executor.ts`):
  `createHostedBackendSeamFromSessionHost` wraps the real `SessionHost` as the
  executor's `HostedBackendSeam` (maps `SessionHostOutcome` -> `TurnResult` +
  daemon-liveness); `createInToolBackendSeamFromLauncherLiveness` wraps a
  launcher-liveness probe; `createProductionExecutor` builds the matrix + binds
  the backends behind one `dispatch` every face calls. Daemon-lifetime posture
  (decision 11): `daemonAlive` is true in-process (the daemon IS the process);
  the in-process `execution-lost` trigger is the lost-generation case
  (`turn-outcome-unknown` + unfinished request).
- **Daemon face endpoint** (`POST /api/v1/frozen-action-executor/dispatch`,
  `src/core/management-api/frozen-action-executor.ts` + additive `router.ts`
  wiring): routes a granted Action through `dispatchGrantedAction` at the daemon
  seam. The CLI / Canvas / interactive launcher / daemon all reach the executor
  through this one endpoint. Loads the head Record read-only (run-control
  pattern), constructs the production executor bound to the daemon `SessionHost`,
  dispatches, returns the typed `ExecutionDispatchResult`. Additive route (new
  handler + new route + known-paths/isKnownPath entries); NO existing route
  changed. Drives the trusted daemon-owned host in-process (same posture as
  `hosted-sessions/execute`); performs NO Record mutation (completion is the
  Facade `complete` path's job).

## Commits (this wave, on wip/ecp-shared-bounded-loop-lifecycle-resume)

- `ab9c6560` feat(ecp7): production driver-face seam + review Minor fix +
  per-field binding tests
- `250292a3` feat(ecp7): daemon face endpoint for frozen-action executor
- (this doc + evidence delta + tasks.md ticks) — committed after this write

All narrow-pathspec; `native/`, other workstream files, and the host archive
work untouched. `git diff --check` clean; committed bytes LF.

## The gate: driver-face parity over the WIRED production path

`test/core/frozen-action-executor/production-executor.test.ts` (11 tests):
- "two driver faces dispatching the same granted Action through the production
  executor resolve to the same Run/Action/outcome" — two callers of
  `createProductionExecutor(...).dispatch(...)` with the same granted Action +
  Record + matrix verdict receive byte-identical typed results.
- The matrix is queryable before any Run starts (built at construction).
- `execution-lost` through the wired seam: hosted lost-generation ->
  `execution-lost`/`lost-generation`; in-tool launcher disappearance (via the
  liveness probe) -> `execution-lost`/`launcher-disappearance`.

Daemon-face handler: `test/core/management-api/frozen-action-executor.test.ts`
(7 tests) — body validation (runRef/grantedAction/expectedRecordVersion/
turnInput/requestedBackend) + run_not_found.

## Task 5.4 - per-field completion-binding mutation receipts

`evidence/mutation-receipts.md` receipt 9: 5 field-level mutations in
`authority.ts` (invocationId, runId, policyDigest, capability.contractDigest,
expectedBeforeWorkspace) -> 6 RED (5 per-field + 1 cascade into receipt 1),
byte-exact reverts (`git diff --numstat` empty vs `ab9c6560`). The `actionId`
binding is by admission (`not-currently-executable`), reached before
`sameActionIdentity` — the correct in-depth structure. The ActorRef-binding leg
is the Facade `verifyAttestedCompletion` (covered by the attestation/completion
regression suite).

## Review round-1 Minor fix

`reconcileActionOutcome` now records `source: 'lost-generation'` (not
`'daemon-death'`) for the hosted lost-generation case — the daemon process may
still be alive; the outcome kind (`execution-lost`) and message were already
correct, only the audit label was imprecise. `action-outcome.test.ts` asserts
`source === 'lost-generation'` for that case.

## Verification

- `rasen validate --strict`: GREEN.
- `npx tsc --noEmit`: 0 errors. `npx eslint` over the new/changed files: clean.
- Whitespace gate (`git diff --check 56b18dcc..HEAD -- src/ test/`): clean.
- Guard suite: 89 GREEN across 9 files (8 executor + 1 daemon-face handler).
- Regression-neighbor suites (management-api + session-host + executor): 52
  files / 634 tests GREEN, 1 skipped (win32 real-capsule gate). NO regression
  from the additive route — STOP-on-regression was not triggered.

## Task state: 35/39 ticked

Ticked this wave: 5.4, 7.1, 7.3. Unticked (4) — all ECP-8-deferred
environment-gated real receipts, recorded as explicit known-gaps (never
defaulted to pass):

- **8.1** [REAL-BACKEND] real-backend attribution RUN — gated by credentials.
  The attribution fact-set shape (`AttributionFactSet`) + lifecycle-only
  registry projection guard are delivered; the end-to-end real run is ECP-8.
- **10.1** [REAL-BACKEND] production-path receipt — gated by credentials + the
  wiring (now landed). Deterministic counterpart (9.1) is the correctness gate.
- **10.2** [REAL-BACKEND] execution-lost + resume receipt — gated by
  credentials. Deterministic counterpart delivered; the Windows substrate fact
  is receipted (10.3, `win32-daemon-death-receipt.md`).
- **10.4** [WSL-EXTERNAL] hosted best-effort on real Linux — gated by the
  external ext4 WSL tree (recipe: `ecp-linux-process-authority-provider/handoff/lead-2.md`).

The 0.2.0 correctness gate is the deterministic suite (89 guards, 9 mutation
receipts / 21 RED total across both waves). Acceptance 6's full operational
truth (real receipts) is NOT claimed this wave — it is ECP-8, which owns the
real-OS/real-backend matrix.

## Note for the delta re-review

The 7.1 wiring is additive and regression-clean. The one shared-surface edit is
`router.ts` (new import + new known-paths entry + new isKnownPath line + new
route block — all additive, no existing route changed). The daemon-face endpoint
drives the trusted daemon host in-process (consistent with
`hosted-sessions/execute`) and performs NO Record mutation; completion stays the
Facade `complete` path's job. The production seam (`production-executor.ts`) is
purely additive. If the re-review prefers the daemon face to ALSO route
completion in-process (rather than the Facade), that is a design question for
the LEAD, not a defect — the current wiring respects the existing defer-seal /
spawn-CLI-for-mutation posture.
