# Review fix round 2

Date: 2026-08-05

Scope: one atomic non-review-author fix for the identical 4 Blocker and 5 Major
findings in the round-2 code/spec and CSO reports. This receipt establishes only
the deterministic platform-neutral foundation contract. It does not claim an
actual Linux, Windows, macOS, ProcessCapsule, packaging, or release authority.

## RED evidence

The first five-file public discriminator run exited 1 with **25 failed and 97
passed**. Twenty-three failures directly reproduced the product gaps: forged
registry dispatch, recovered-generation reuse/capacity overflow, null/null root
exit, alternating prepare/termination accessors, mutable prepared capability,
repeat publication after bad acknowledgement, six post-deadline rejection
routes, and concurrent tombstone overflow. The run also exposed two fixture-only
failures because the closed registry had already bound the provider method used
by the failure/collision reservation tests, plus one unhandled prepare-rejection
gate for the same reason. The fixture was corrected to vary behavior behind the
already-bound method before GREEN was accepted; no product behavior was weakened
to accommodate the fixture.

The reusable mutation test treats the named `broken-abort` snapshot failure as
the required inner RED result. Its outer assertion passes only when the broken
fixture makes the unchanged measured snapshot throw and the default fixture
returns the exact GREEN snapshot.

## Finding closure

| Finding | Fix and public discriminator |
| --- | --- |
| B-001 | Registry construction installs a module-private provenance brand after manifest validation. Operational selection uses a captured base implementation and accepts only an exact base instance; subclass, proxy, and lookalike probes return unavailable with zero selector/provider dispatch. |
| B-002 | Every valid recovered reference atomically enters the same active/retired ledger before observation/control dispatch. Recovery-live, recovery-exact-empty, in-flight recovery/local collision, stale receipt, and full-ledger recovery probes prevent generation reuse. |
| B-004 | The unchanged shared suite now requires authentic exact-empty receipts for both prepared and published abort while preserving negative abort retention. `broken-abort` is a named mutation and both positive abort facts are part of the measured snapshot. |
| B-005 | A provider preparation's reference and activation callable are each read once into a closed frozen snapshot. Diagnostic fingerprints treat the provider value as opaque; envelope, activate, and abort use only the captured capability. Alternating accessors prove one read and exact-reference abort. |
| M-002 | Root exit is a closed non-empty status union: code or signal may individually be null, never both. Observation, control, shared conformance, and ProcessScope-adapter cases reject null/null as retained control loss/uncertainty. |
| M-005 | Prepare and termination fields are guarded-read once. Captured arrays and environment entries are recursively copied, bounded, frozen, and shared by operation identity and provider dispatch. Every top-level prepare/termination field has an alternating NUL/BigInt discriminator. |
| M-006 | Fulfillment and rejection now use one monotonic settlement guard. All seven phases classify rejection on or after the recorded deadline as timeout even when the scheduler callback is withheld. |
| M-007 | Prepare reserves reference capacity synchronously before provider dispatch and releases it only when no reference is minted. Concurrent final-slot success admits one call; failure, timeout, and collision release cases remain usable; recovery shares the same 1,024 bound. |
| M-008 | The first durable publisher invocation consumes publication capability. Timeout, loss, or invalid acknowledgement enters retained `publication-uncertain`; retry cannot invoke the publisher, activation remains forbidden, and bounded abort/reconciliation remains available. |

The design and delta spec now freeze provenance, recovery registration,
single-read provider/input snapshots, non-empty root status, both-route monotonic
settlement, atomic capacity reservation, positive abort conformance, and
single-attempt publication. Tasks 9.9-9.14 remain unchanged and unchecked.

## GREEN gates

- Exact task-9.1 12-file focused command with `--maxWorkers=1
  --minWorkers=1 --reporter=dot`: exit 0; **12 files, 186 passed**.
- Specified surrounding host/management/daemon/CLI regression command: exit 0;
  **32 files, 298 passed, 4 skipped**.
- `pnpm run build`: exit 0; TypeScript and source-owned ProcessCapsule win32-x64
  build completed.
- `pnpm run lint`: exit 0.
- `pnpm exec tsc --noEmit --pretty false`: exit 0.
- `node bin/rasen.js validate ecp-platform-process-authority-foundation
  --strict`: exit 0; Change valid.
- Foundation-owned tracked diff check and per-file untracked whitespace audit:
  no whitespace errors.

## Boundary

No Direction, portfolio, `.rasen`, runstate, OS-provider Change, native
ProcessCapsule contract, retained temp output, stash, commit, push, ship, or
archive action was taken. macOS/MAC/MMAC remains explicitly decision-deferred;
this fix records no platform approach and makes no support claim.
