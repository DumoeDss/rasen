# Implementer-2 handoff - ecp-native-process-capsule-closure

Role: IMPLEMENTER resuming closure under the LEAD's fresh bounded integration budget (escalation
counters untouched). Date: 2026-08-08. Integrated tree: branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD `079f0063` at authoring (shared worktree; the
cutover fix `fec34c16` is an ancestor). Windows host.

Full per-finding accounting: `evidence/closure-integration-disposition.md`. This handoff is the
resume distillate.

## What I implemented / decided

### 12.8 (RC-005 / cutover F4) - one retention lifecycle rule across THREE maps [CODE]

- New shared helper `src/core/session-host/process-capsule/scope-retention.ts`:
  `sweepSettledTerminals(map, isSettledTerminal)`. The one rule, applied identically to all three
  maps: at each `prepare()`, sweep entries at a definite settled terminal; retain every live /
  control-lost / uncertain entry for reconciliation. The successor Session's prepare is the release
  point, which preserves the one in-Session replay window (`darwin` escape-demo: terminate ->
  re-inspect declared-unproven still passes).
- Wired at prepare start in all three tiers with the per-tier "settled terminal" predicate:
  POSIX `scopes` (`terminal !== undefined`), win32 `scopes` (`terminal !== undefined`), legacy
  `clients` (`state === 'closed'`). win32 strips its test-only `retentionProbe` before delegating
  so the capsule never re-binds the same probe to its own map.
- Test `test/core/session-host/scope-retention-lifecycle.test.ts` (7 tests): a shared-rule unit
  block + POSIX + win32 + native integration cases, each proving terminal entries released on the
  successor prepare and control-lost/live entries retained.
- Mutation receipts on the shared helper (byte-exact backup/restore, helper hash `5f92ccc6` before
  and after both): (R) no-op sweep -> 4 release assertions RED across all tiers; (W) unconditional
  sweep -> retention assertions RED (control-lost entries wrongly dropped = the clean-detach shape
  the tiers forbid). Both directions discriminated.
- Additive test-helper change: `test/helpers/fake-process-capsule.ts` `capsuleSeam` now accepts a
  `nativeRef` FUNCTION for distinct per-controller refs (backward-compatible; string still works).

### 12.1 - delta spec re-author + PGID exact-claim deletion [DOCS]

- `specs/durable-process-scope-authority/spec.md` re-authored to best-effort acceptance under
  Replan 6: a non-projecting decision-13 banner + in-body scope markers (placed AFTER each
  normative statement, before the first scenario) on R1 (opaque-authority -> seam, not proven
  emptiness), R3 (terminal is declared-unproven), R7 (Windows Job now under win32 best-effort tier),
  R8 (`dependsOn: [linux, windows]`, crates parked), R9 (kernel-enforced authority PARKED - not a
  0.2.0 gate), R10 (providers frozen/parked). Diff is PURELY ADDITIVE (81 insertions, 0 deletions);
  no `### Requirement:` heading renamed, no `#### Scenario:` deleted -> archive-projection safe.
  `rasen validate --strict` = valid.
  - Trap recorded: the validator's `extractRequirementText` returns the FIRST substantial body line
    and checks only IT for SHALL/MUST (skips blank + `**x**:` metadata lines). A scope marker placed
    BEFORE the normative statement displaces it and fails validation - markers must go AFTER the
    SHALL statement (or be a single line containing SHALL, the R2/R4 style).
- PGID exact-claim deletion: confirmed no shipped production path asserts PGID/process-group as a
  proven exact authority. Best-effort tiers have no `emptiness: 'proven'` / `scopeEmptyProof: true`
  / `state: 'scope-empty'`; the declared limits are type-literal `false`. The process-group
  MECHANISM survives as declared best-effort; the exact claim lives only in the frozen/parked Rust
  crate (not modified) and the retained exact-tier capsule (permitted by cutover D3).

### 12.2 (SEC-001) / 12.7 (RC-004) / 12.5 (RC-002) - integrated-tree confirmations [EVIDENCE]

Re-derived on this tree, not from summaries - full detail in `closure-integration-disposition.md`:
- **SEC-001 CLOSED** on the integrated tree: transportLost latch + latch-independent inspect
  backstop + `receiptAuthorizesRelease` refusing `uncertain`; host inspect-before-terminate gate;
  real-host 7.3 receipt (first run failed organically) + reviewer latch mutation. Cutover review
  rounds 1+2 CLEAN. The fresh non-author security review (9.3/12.9) is the independent confirmation.
- **RC-004 CLOSED**: cutover F1 containment landed + pinned (`native-process-scope.ts` digest
  `a070733c`, verified from committed bytes on this tree; both `LEGACY_PROCESS_CAPSULE_INPUTS`
  lists carry it with lineage); ordering half implemented, not waived; POSIX leg not constructed.
- **RC-002 confirmed** satisfied (exact leg superseded; bounded declared-unproven natural-exit
  terminal delivered, real-kernel 6.4).

### Surviving findings (one-line dispositions)

SEC-002 prior-disposition-stands (decision-12 superseded); SEC-003 prior-disposition-stands on the
decision-12 leg, decision-11 leg DEAD/weakened (window still exists in shipped win32 code, out of
acceptance only because decision 12 retired the attacker class); RC-001/RC-003 leave with parked
crates (RC-001's disproof preserved as load-bearing for the best-effort declaration); S2/S4/S5
satisfied on the cutover tree as predecessor evidence; S1/S3 leave with parked crates. Full text in
the disposition file.

## Gates run

- `npx tsc --noEmit` clean.
- `scope-retention-lifecycle` 7/7; win32 + darwin (behavioural/live-close/release) tier suites +
  retention = 59/59; host integration (`host`, `process-scope-host-closure`,
  `process-scope-contract`, `claude-backend`) 55 passed / 3 skipped. No regression.
- `git diff --check` whitespace CLEAN over all authored files.
- `rasen validate --strict ecp-native-process-capsule-closure` = valid.

## STOPPED-ON (blocking the final commit)

**Native-map pin rebaseline authorization.** The legacy `clients` map is in the byte-pinned
`native-process-scope.ts`. Its 4-hunk edit (import + test-only `retentionProbe` option + predicate/
probe wiring + `sweepSettledTerminals` at prepare start; TypeScript adapter only, Rust crate
untouched) is written and verified GREEN with the edit live (59/59), but committing it needs a pin
rebaseline `a070733c... -> 3e74b2c25bfde89a9db300301b7010f2a7c9521be37283ed73169be4f111b828` in
BOTH `LEGACY_PROCESS_CAPSULE_INPUTS` lists (`linux-process-authority-boundary-guards.test.ts`,
`windows-process-authority-package-ci.test.ts`) with lineage, per the F1 precedent. Authorization
requested from the LEAD (message sent); NOT committed pending the explicit yes. The two best-effort
maps + shared helper + test are landable now; the native edit + native test block + rebaseline land
as one unit on authorization.

Working-tree state while held: `native-process-scope.ts` carries the edit (digest `3e74b2c2`), so
the two pin-guard suites are EXPECTED-RED until the rebaseline lands; every other suite is green.

## Exact state of unticked tasks (owed to a DIFFERENT worker - author != verifier)

- **12.8**: implementation + test complete and verified for all three maps; native map HELD pending
  the pin-rebaseline authorization above. Tick completes when that lands.
- **9.3 / 9.4 / 9.5 -> 12.9**: fresh NON-AUTHOR security and code/spec reviews scoped by
  `decision13-rescope-input.md` + this work, zero Blocker/Major, then re-run 8.1-8.8. I authored the
  code/spec/evidence, so I cannot self-satisfy these.
- **12.6 (RC-003)**: leaves with parked crates; no 0.2.0 work (disposition recorded).
- **12.10 -> 9.7-9.10**: local ship / archive / parent-return sequencing after 12.9; do NOT mark
  `ecp-durable-agent-session-host` delivered.

## Commits

Held pending the pin authorization (see STOPPED-ON). Planned enumerated-pathspec units:
1. `feat(ecp7): one retention lifecycle rule across the three ProcessScope maps (RC-005/12.8)` -
   scope-retention.ts, the three scope modules, fake-process-capsule.ts, the test, + the pin
   rebaseline (both lists) once authorized.
2. `docs(ecp7): re-author closure delta spec to best-effort + record finding dispositions (12.1/12.2/12.5/12.7)` -
   spec.md, tasks.md, evidence/closure-integration-disposition.md, this handoff.
