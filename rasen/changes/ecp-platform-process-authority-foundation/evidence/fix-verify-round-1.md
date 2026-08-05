# Verify fix round 1

Date: 2026-08-05

Scope: only the two Major findings from the independent foundation verification.
The fixer implemented the product and regression changes. The LEAD finalized this
receipt after the fixer turn was interrupted during documentation.

## RED evidence

- V-001 was reproduced by the independent verifier's gated concurrent-operation
  discriminator. Before the fix, two `inspect` calls with the same injected
  operation id both reached the provider (`inspectCalls === 2`) and both returned
  `live`. Receipt:
  `E:\rasen-ecp-pa-verify-20260805-r4leaf-001\finding-concurrent-operation-id.log`.
- V-002 was reproduced by the independent verifier with a provider that fulfilled
  `inspect` using a circular object. Before the fix, settlement attempted
  `JSON.stringify`, Node exited 1, and no typed authority outcome was returned.
  Receipt:
  `E:\rasen-ecp-pa-verify-20260805-r4leaf-001\finding-circular-provider-outcome.log`.
- Regression coverage was added before the GREEN implementation was accepted for
  concurrent same-identity reuse, concurrent cross-phase reuse, prepare-result
  non-reuse, bounded in-flight reservation capacity, circular/BigInt/accessor
  fulfilled values, and malformed circular exact-empty values.

## GREEN implementation

- `bounded(...)` now reserves a valid operation id synchronously before scheduling
  or provider dispatch. A duplicate or conflicting id returns typed
  `control-loss`; it cannot reach provider control.
- The ledger distinguishes `in-flight` and `settled` reservations. Only settled
  entries may be evicted at the fixed 1,024-entry bound; exhaustion by active
  reservations fails closed.
- Settlement comparison no longer serializes provider-owned values. A bounded,
  cycle-safe diagnostic fingerprint quarantines circular, BigInt, throwing
  accessor, and otherwise hostile values without deciding authority state.
- Fulfilled provider outcomes are normalized against exact closed shapes. Invalid
  values become typed `control-loss`; malformed `exact-scope-empty` values cannot
  mint the runtime-authentic release receipt.
- Scheduler cleanup and caller-abort-listener cleanup are quarantined from semantic
  settlement.

## Files changed in this fix round

- `src/core/session-host/process-authority/coordinator.ts`
- `test/core/session-host/process-authority-deadlines.test.ts`
- `test/core/session-host/process-authority-outcomes.test.ts`

## Checks

- `pnpm exec vitest run test/core/session-host/process-authority-deadlines.test.ts test/core/session-host/process-authority-outcomes.test.ts --reporter=dot`
  - exit 0; 2 files, 26 tests passed.
- Foundation focused command from `verification-report.md` over 12 files with
  `--maxWorkers=1 --minWorkers=1 --reporter=dot`
  - initial fixer-tail check: exit 0; 12 files, 115 tests passed;
  - fresh verifier round 2 after the final regression case landed: exit 0;
    12 files, 116 tests passed.
- `pnpm exec tsc --noEmit`
  - exit 0.
- Per-file `git diff --no-index --check` across the exact 19-file foundation
  product/test manifest
  - no whitespace errors; only expected LF-to-CRLF working-copy notices.
- `node bin/rasen.js validate ecp-platform-process-authority-foundation --strict`
  - exit 0; Change valid.

## Boundary

This receipt does not close V-001 or V-002 by itself. The independent verifier must
rerun both discriminators and the prescribed gates against the fixed tree. No
Direction, portfolio, runstate, OS provider, native ProcessCapsule, Mac support,
commit, push, ship, archive, stash, or retained temp state was changed by this fix
round.
