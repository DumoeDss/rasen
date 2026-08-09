# Implementer handoff - ecp-session-policy-and-control-parity

For: the LEAD (and the reviewer). Stage: implementation complete; 28/28 tasks
ticked; ready for review. Branch `wip/ecp-shared-bounded-loop-lifecycle-resume`,
SHARED worktree, Windows host.

## Tasks ticked

**28/28** (all sections). See `tasks.md` (every box ticked with a receipt below
or in `evidence/`).

## Commits (this implementation, on top of propose `53f4559f`)

- `af88932e` feat(ecp7): configurable provenance-bearing session policy source
  (Section 1 baseline + Section 4).
- `ec6ad5d7` feat(ecp7): exhaustive cross-driver parity harness + drift gate +
  audit op (Section 2).
- `07e15dc4` feat(ecp7): exhaustive cancel/restart/ack-loss fault matrix over
  shipped seam (Section 3).
- `210be9b1` feat(ecp7): face-invariant policy harness (Section 5).
- (this commit) docs(ecp7): mutation receipts + ECP-8-deferred receipts +
  handoff (Sections 6-7); plus the typecheck fixes (config-diagnostics key
  registry + policy-source readonly-assignment).

Tip: `git diff --stat 53f4559f..HEAD -- src/ test/` shows 1992 insertions, 0
deletions to existing code (purely additive: 2 config files + 4 new modules + 4
new test files).

## What was built

Four new modules under `src/core/session-policy-parity/` (consume the shipped
executor; do not modify it) + additive `sessionPolicy` config blocks + four test
files (53 guards total, all deterministic):

- **`policy-source.ts`** (Section 4): `resolveSessionPolicyBlock` (project >
  store > global > DEFAULT_EXECUTOR_POLICY_BLOCK; per-field authored/default
  provenance; authoritative validation) + `resolveSessionPolicySource` (composes
  the authoritative `ResolvedReusePolicy`, feeding the executor's
  `resolveReusePolicy` unchanged and correcting its conservative `default`
  numeric-limit stamp to the source's authoritative provenance) +
  `readSessionPolicyLayers` (thin reader over `readProjectConfig`/
  `getGlobalConfig`). Closes the executor's documented "no authoring surface for
  the numeric limits yet" gap (`reuse-policy.ts:50-56`).
- **`parity-gate.ts`** (Section 2): `DRIVER_FACES` x `CONTROL_OPERATIONS` tables,
  `FaceProjection`, `assertProjectionBackedByRecord` (typed drift outcome),
  `assertProjectionsParity`, `uncoveredParityCells` coverage guard.
- **`audit-operation.ts`** (Section 2): additive read-only audit projection
  (deliveryState + matrix availability verdict); no Record mutation; does not
  widen the change-run projector contract.
- **`fault-matrix.ts`** (Section 3): `FAULT_MODES` (7 modes / 8 cells) x
  `RECOVERY_INVARIANTS` tables, `FaultModeSpec`, `uncoveredFaultModes` coverage
  guard.

Additive config surface (mirrors the `runs`/`handoff` precedent exactly):
`sessionPolicy` optional block on `GlobalConfig` (`global-config.ts`) +
`ProjectConfigSchema` (`project-config.ts`) + a resilient parse block + 5
`ConfigDiagnosticKey`s (`config-diagnostics.ts`).

## Fault-matrix evidence (7 modes, 8 cells, each at the shipped seam)

`test/core/session-policy-parity/fault-matrix.test.ts` drives every mode through
the shipped `dispatchGrantedAction` at the shipped `HostedBackendSeam`/
`InToolBackendSeam`:

| Mode | Backend | Typed outcome | Source label (anti-theater) |
| --- | --- | --- | --- |
| cancel-before-start | hosted | uncertain (host-ambiguous) | - |
| cancel-in-flight | hosted | execution-lost | lost-generation |
| host-restart | hosted | execution-lost | lost-generation |
| daemon-restart | hosted | execution-lost | daemon-death |
| worker-process-loss | in-tool | execution-lost | launcher-disappearance |
| completion-ack-loss | hosted | succeeded (committed; not redriven) | - |
| duplicate-completion | hosted | duplicate (in-flight) | - |
| stale-control | hosted | rejected (record_version_conflict) | - |

The source labels (`daemon-death` / `lost-generation` / `launcher-disappearance`)
are minted ONLY by the shipped `reconcileActionOutcome`; asserting them is the
proof the production path ran, not a parallel fixture (receipt M6c).

## Two key mutation receipts (RED + GREEN)

Both LEAD-named highest-value targets have demonstrated RED counterparts,
reverted byte-exactly:

- **Drift-prevention gate (2.3) - receipt M3:** mutating
  `assertProjectionBackedByRecord` to always return `{kind:'backed'}` REDs all
  three divergent-projection guards (runId / actionId / completionState). 3 RED.
- **Face-invariance harness (5.1) - receipt M7:** injecting a per-face policy
  source for one face (`canvas` -> handoffTokenLimit 99) REDs all three 5.1
  face-invariance guards; the 5.2 cross-authority safety guard correctly stays
  GREEN (cross-authority retire is limit-independent). 3 RED.

## Policy-config-source wiring + the 4.3 safety rejection

`resolveSessionPolicyBlock` walks project > store > global > default, stamping
each field `authored` (configured) or `default` (unset), and authoritatively
validates the selected value. `resolveSessionPolicySource` composes the
`ResolvedReusePolicy` with the authoritative provenance (the executor resolver's
conservative `default` numeric stamp is corrected here, since this source IS the
authority that knows whether a value was configured). The executor's
`resolveReusePolicy` signature and `decideReuse` safety decisions are unchanged.

4.3 safety rejection (`policy-source.test.ts`): a non-integer / non-positive /
out-of-bound limit is rejected (a non-integer could permit an off-by-one silent
past-limit reuse; an unbounded value would disable the over-limit protection);
AND a maximally permissive valid config still retires cross-authority requests
(the configured limit governs only same-authority over-limit; the cross-authority
safety decision is independent of it). Receipt M2: disabling the validator REDs
4 guards.

## validate / typecheck / lint / regression

- `node dist/cli/index.js validate ecp-session-policy-and-control-parity
  --strict` -> "Change is valid", exit 0.
- `tsc --noEmit` -> clean (no errors) after the config-diagnostics key registry
  + policy-source readonly-assignment fixes (in this commit).
- `eslint` over all changed paths -> exit 0.
- Regression (`vitest run` over executor + session-policy-parity + session-host +
  effective-config + project-config): **991 passed, 25 skipped, 0 failed** (the
  25 skipped are environment-gated real-kernel/real-capsule receipts). The
  shipped executor's own 82-guard suite passes unchanged - the proof the
  executor module is byte-identical to its shipped state after the transient
  mutation-receipt edits (also proven by `git diff --numstat` empty).

## Whitespace gate

All new/edited files are LF (0 CR in committed blobs; the autocrlf "LF will be
replaced by CRLF" notices are the checkout notice, not stored CRLF), 0 trailing
whitespace, 0 trailing blank lines at EOF. `git diff --check` clean on the full
change diff.

## Boundaries respected (no stop-on-drift)

- `git diff --numstat 53f4559f..HEAD -- src/core/frozen-action-executor/ native/`
  is EMPTY: the shipped executor module and the frozen authority crates are
  untouched. The 4 transient mutation-receipt edits to `action-outcome.ts`/
  `authority.ts` were reverted byte-exactly (the executor's own suite passes).
- No edits to the Facade, the EvidenceStore, the transactional-completion path,
  the registry record shape, the legacy ProcessCapsule, `.rasen/`, archived
  changes, or other workstream files.
- The two config files edited (`global-config.ts`, `project-config.ts`) and
  `config-diagnostics.ts` receive ADDITIVE optional fields only (mirrors the
  `runs`/`handoff` precedent); 268 existing config tests pass unchanged.
- No signing/key-custody (decision 12). `SELF_HOSTING_PROOF_SEAM` untouched.

## Dead ends / decisions worth flagging for the reviewer

1. **The resolver's hardcoded `default` provenance.** The executor's
   `resolveReusePolicy` stamps numeric limits `provenance: 'default'`
   unconditionally (`reuse-policy.ts:142-153`) - the documented gap. This change
   does NOT modify the resolver (executor module, consumed). Instead the new
   policy source is the authoritative provenance bearer: it produces the
   `ExecutorPolicyBlock` (value, fed to the resolver unchanged) AND a
   `ResolvedReusePolicy` with the correct provenance (the resolver's conservative
   `default` stamp corrected on the numeric limits). The sessionReuse-scope
   provenance and retireReasonLabel come straight from the resolver. This is the
   faithful reading of "the resolver's signature and safety decisions are
   unchanged" (4.1) + "a configured limit carries authored provenance" (4.2).
   **Reviewer check:** confirm the source's provenance override is the intended
   mechanism (vs. a future resolver change the LEAD may prefer).
2. **`definition` provenance.** The vocabulary includes `definition` (derived
   from node nature, e.g. a future role-based limit). This change's operator
   config surface produces `authored` (configured) and `default` (unset); it does
   not fabricate a `definition` derivation that does not exist. The provenance
   guard asserts the vocabulary and that configured values carry `authored`.
   `definition` is reserved for a future node-nature derivation.
3. **Fault-matrix executor mutations are TRANSIENT.** Receipts M6a-d mutated the
   shipped executor (`action-outcome.ts`, `authority.ts`) to prove the matrix's
   executor-mechanism guards discriminate, then reverted byte-exactly. This
   matches the executor change's own receipt practice. `git diff --numstat` on
   the executor is empty and the executor's own suite passes - the module is
   byte-identical to its shipped state. Flagging in case the LEAD prefers
   executor-mechanism discrimination be cross-referenced only (not re-mutated);
   the receipts are written to support either reading.
4. **Audit operation locality.** `audit-operation.ts` is a new additive
   read-only module; it deliberately does NOT touch `change-run/internal/
   projector.ts` (the frozen projector) - the design risk "adding the audit
   operation could widen the projector contract" is avoided by keeping audit in
   its own module that reads the Record.

## Deferred to ECP-8 / operator (explicit, not defaulted to pass)

See `evidence/ecp8-deferred-receipts.md`. Real-OS / real-agent-backend receipts
for the parity, fault-matrix, and face-invariance properties are environment-
gated ECP-8 known gaps with their deterministic counterparts named; acceptance 7
(self-hosting toy-Change proof) is operator-owned and `SELF_HOSTING_PROOF_SEAM`
is untouched.

## Unticked tasks

None. 28/28 ticked.
