# Implementer 1 handoff

## Reason

Soft handoff budget reached at 36/63 tasks with all current S1/S2/S4/S5
implementation slices closed and a substantial preservation/gate/review tail
remaining. This is a clean atomic boundary: no command is running, no owned
process/temp residue remains, and no commit/push/ship/archive was attempted.

## Workspace

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- Change: `ecp-native-process-capsule-closure`
- Progress: 36/63 complete, 27 remaining
- Shared cumulative dirty tree: preserve every unrelated ECP file and all
  pre-existing retained temp/run-state. `.rasen/**` was not edited.

## Completed

### S1 macOS exact birth

- Replaced the incomplete 40-byte hand declaration with the complete 56-byte
  `ProcUniqIdentifierInfo`, including both trailing `u64` reserve fields.
- Added compile-time 56-byte/8-byte assertions and full-return/non-zero unique
  id/version acceptance.
- Added same-second/foreign/unavailable actual-macOS oracles, locally skipped
  honestly on Windows.

### S2 protocol/deep close semantics

- Private helper protocol is v2 with named manifest capability
  `root-exit-scope-empty-v2`.
- `ROOT_EXIT` and terminal `SCOPE_EMPTY` are distinct. The administrative
  supervisor exits after reporting root exit; the controller retains the Job or
  reserved process group and emits scope-empty only after exact empty
  observation.
- `LiveProcessScope` now exposes `rootExited` and `closed`; successful `closed`
  is only `{ state: 'scope-empty' }`. Controller loss rejects as typed
  scope-empty uncertainty.
- Claude transport fails/ends an active backend turn on root exit without
  resolving its host-facing `closed`; existing host lifecycle paths therefore
  retain registry process facts/writer claims until exact scope-empty.
- Deterministic adapter independently models root exit and scope empty.

### S3 implementation core

- Opaque internal ref is `v2|platform|controller pid/birth|supervisor
  pid/birth|reserved pgid|nonce`; no field is exposed as a public control
  argument.
- Linux revalidates controller identity around pidfd acquisition/signalling and
  validates supervisor birth/PGID before any group signal.
- macOS revalidates corrected kernel unique identities immediately around
  controller/group control.
- Replacement group cleanup uses bounded TERM then KILL and reports closed only
  after absence. The POSIX test-only orphan-group mode makes the actual
  Linux/macOS replacement oracle runnable unchanged by ECP-8.
- Task 4.5 remains open because the complete race matrix still needs explicit
  discriminator cases/repeated termination assertions.

### S4 bounded control

- One `awaitControl` helper owns PREPARE, ACTIVATE, ABORT, TERMINATE/INSPECT and
  SCOPE_EMPTY deadlines plus cancellation and one timer cleanup.
- ACTIVATE timeout throws typed `process-control-timeout` / `activate`, retains
  the ref, and exactly-once activation blocks a retry.
- Prepared abort returns retained typed uncertainty on timeout; later exact
  terminate reconciles the same ref.
- Added withheld-ACTIVATE and withheld-first-TERMINATE mutation modes. Production
  construction still selects only `--controller`.

### S5 truthful provenance

- `RASEN_PROCESS_CAPSULE_BUILD_ROOT` creates isolated clean output while the
  production default/output/staging path is unchanged.
- Manifest entries require `provenance: build-inputs`, compiler, source digest,
  protocol/platform/arch/capability/length/SHA. Docs explicitly deny a byte
  reproducibility inference.
- Two isolated Windows x64 source-identical builds were unequal but each matched
  its own manifest:
  - `fbd2495224e8c7faba81bf662b0a8364b0295410df2b43b687c56000865d0fd5`
  - `8c68eb707a008081e61a54255077347d5b8d1a3788e48a142bbd56ae0208ff1c`
- Last production adjacent helper build SHA-256:
  `1ed550a548c3d235f5652c7a0216ff86dda84b35dd6a49b77400c37b72882b6c`.

## Main files changed in this implementation leaf

- `native/process-capsule/src/main.rs`
- `src/core/session-host/process-scope.ts`
- `src/core/session-host/process-capsule/native-process-scope.ts`
- `src/core/session-host/process-capsule/resolver.ts`
- `src/core/session-host/claude-backend.ts`
- `scripts/build-process-capsule.mjs`
- `docs/session-host.md`
- `test/core/session-host/claude-backend.test.ts`
- `test/core/session-host/process-scope-contract.test.ts`
- `test/core/session-host/process-capsule-package.test.ts`
- new S1-S5 tests named in the Change's native closure command
- Change tasks/evidence files

## RED/GREEN evidence

- `evidence/red-baseline.md` records the vertical REDs and the reason the planned
  aggregate pre-fix command was decomposed under the stricter user-approved TDD
  rule.
- S1 focused: 1 pass / 2 skipped on Windows after two observed REDs.
- S2/deep boundary exact command: 4 files / 55 tests passed.
- S2 current real/native+host file: 3/3 passed, including natural scope-empty,
  descendant retention and writer/registry retention.
- S4 focused: 3/3 passed after the initial 3/3 RED.
- Deterministic ProcessScope: 4/4 passed after the exact-close RED timed out.
- S5 provenance: 2/2 passed; output printed both unequal digests.
- POSIX source/platform discriminator: 1 passed / 1 actual-platform skipped.
- `cargo +stable check`: passed on Windows.
- `cargo +1.88.0 check ... --target x86_64-unknown-linux-gnu`: passed,
  compile-only.
- `cargo +1.88.0 check ... --target aarch64-apple-darwin`: passed,
  compile-only.
- `evidence/platform-obligations.md` records the exact unexecuted actual Linux
  and macOS commands/receipts for ECP-8.

## Remaining

1. Finish task 4.5 with explicit controller PID reuse, supervisor PID/PGID
   reuse, leader-exited/group-reserved, group-empty-before-signal, daemon
   force-death and repeated-terminate discriminators. Keep Linux/mac actual
   cases platform-gated; do not claim them locally.
2. Run exact task 5.6.
3. Finish S5 package gate 6.5, including packed helper/manifest independent
   length/SHA verification.
4. Complete 7.1-7.6 preservation: real Windows controller-death + duplicate
   handle + early activation, registry-v2/v1 migration, protocol/ref rollback,
   all resolver negatives and forbidden-fallback assertions.
5. Run 8.1-8.8. Expect TypeScript/package fixture repair because public close
   types and required manifest provenance changed; fix only product-owned
   failures.
6. Produce final implementation report and dispatch the required independent
   security and code/spec reviews. Apply-stage leaf must not perform ship,
   archive, commit, push or PR itself unless reassigned under those stages.

## Fix/debug eliminated hypotheses

- **“A default non-detached Windows grandchild is a reliable resistant
  descendant oracle.”** False in the initial S2 run; it exited with its parent.
  The Windows fixture now detaches it, while the Job still contains it.
- **“75 ms isolates ACTIVATE/abort timeout.”** False because PREPARE itself can
  legitimately exceed 75 ms on this machine. The injected test bound is 500 ms;
  the production default remains 10 seconds.
- **“Natural scope-empty requires enumerating every POSIX/macOS descendant.”**
  Eliminated by treating the supervisor as administrative: it exits after
  `ROOT_EXIT`, leaving only backend members in the reserved Job/group, so exact
  empty becomes directly observable.
- **“Compiler/source digests imply reproducible bytes.”** Falsified again by two
  unequal clean Windows artifacts; the selected manifest contract is explicitly
  per-artifact integrity plus build-input provenance.

## Process/temp audit

Final read-only audit found no `rasen-process-capsule` process, no node command
line owned by the new test prefixes, and no temp directories matching the
Change-owned scope/capsule/posix/clean-build prefixes. One failed S2 RED root
`rasen-scope-root-exit-3o2ykA` was proven exact test-owned and removed after all
recorded PIDs exited. No pre-existing/unknown temp output was deleted.

## Durable findings

1. Root exit and scope-empty must remain different capabilities all the way up
   to host authority release; translating either to generic process close
   reopens S2.
2. A controller replacement may safely control a leaderless reserved POSIX
   group only after rejecting any live different-birth process at the original
   supervisor PID; numeric PGID alone is never authority.
3. Linux/macOS cross-target success is implementation evidence only. ECP-8 must
   run the exact actual-OS commands in `platform-obligations.md` before support
   or release claims.
