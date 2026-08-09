# Prepare-unavailability implementation report

Date: 2026-08-05

## Result

- `ProcessAuthorityProvider.prepare()` now returns the closed `ProviderPreparationResult` union.
- The coordinator exact-key captures a bounded typed unavailable result before prepared-authority capture/reference encoding, preserves its diagnostic and exact selection, and releases the reserved reference slot.
- Provider rejection remains prepare `control-loss`; malformed unavailable lookalikes remain no-reference fail-closed results.
- The shared provider conformance fixture now supplies its publisher. Every exact publication in the suite uses that publisher; the acknowledgement-mismatch mutation wraps the real publisher, while the publish-timeout scheduler still prevents dispatch.
- Retained conformance assertions now require exact state/reference, non-empty diagnostic bounded to 2,048 characters, and no optimistic release without hard-coding deterministic diagnostic text. This lets a production adapter project closed native codes without a fixture wrapper or arbitrary native-text passthrough.
- Recovered inert conformance now constructs authentic monotonic phases: prepared recovery is inspected before publication, while published recovery is inspected only after the fixture publisher commits. No ledger deletion or state override is used.
- The deterministic provider exposes the prepare-unavailable scenario and canonical in-memory publisher. Platform fixtures can now supply a real durable publisher without hidden activation-side publication.

## TDD and verification

- RED: `pnpm exec vitest run test/core/session-host/process-authority-prepare-unavailable.test.ts` — 1 failed / 4 passed; exact provider diagnostic was replaced by the old invalid-preparation diagnostic.
- Initial GREEN focused: same command — 6/6 passed, including 1,025 unavailable preparations followed by one successful preparation to prove slot release.
- Review round 1 found one Major hybrid-discriminator smuggling path: an object carrying unavailable state plus valid prepared fields could fall through to prepared capture. The fix replaced two independent parsers with one accessor-safe discriminated snapshot, added a reproducing RED mutation, and turned it GREEN.
- Review round 2 found one Blocker: a non-enumerable `authority-unavailable` discriminator could bypass the enumerable-key gate and fall through to prepared capture. The fix now captures `state` for every object before prepared parsing while retaining the exact enumerable-key requirement for a valid unavailable outcome. Non-enumerable and inherited discriminators therefore fail closed.
- Final focused + shared common conformance: 51/51 passed, including hybrid, alternating-getter, and non-enumerable-discriminator mutations. The real Linux conformance fixture also passed in the combined run (79/79 across the three selected files).
- Complete established common process-authority set (all ten `process-authority-*.test.ts` files, excluding the concurrent unfinished `linux-*` Change tests): 176/176 passed.
- `pnpm exec tsc --noEmit`: passed on the final implementation.
- Path-scoped ESLint: passed for all owned product/test files.
- Final `pnpm build`: passed; TypeScript compiled and the unchanged ProcessCapsule Windows artifact built.
- Path-scoped `git diff --check`: passed; only expected line-ending notices were printed.
- `pnpm rasen validate process-authority-prepare-unavailability-outcome --strict`: passed.

Concurrent incomplete Linux provider tests are intentionally not counted in this common blocker receipt. No Linux file or result is attributed to this Change.
