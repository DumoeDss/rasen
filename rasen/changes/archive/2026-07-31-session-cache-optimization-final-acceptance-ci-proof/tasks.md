## 1. Correct the Final Evidence Boundary

- [x] 1.1 Update `assertFinalAcceptanceComplete` so it no longer requires the impossible local `nativeLinux` truthy value while retaining every selected-attempt, local-gate, physical-retention, arm, product-gap, delivery, and successful-CI prerequisite.
- [x] 1.2 Preserve `AcceptanceRunV2Schema`, `createAcceptanceRunV2`, `recordLocalEvidence`, and `validateCurrentLocalEvidence` semantics so local evidence remains `nativeLinux: false` and native CI continues to come only from the existing strict successful CI state/document path.

## 2. Add Focused Final-Acceptance Regressions

- [x] 2.1 Extend the deterministic protocol fixture through selected physical evidence, five retained local gates, controlled parent delivery, and successful exact-SHA five-job CI; assert final acceptance succeeds and returns `localEvidence.nativeLinux: false`.
- [x] 2.2 Assert final acceptance remains incomplete before successful CI and when a required exact-SHA CI job is missing or unsuccessful, without promoting any native-Windows or injected-POSIX local claim.
- [x] 2.3 Keep all new coverage inside temporary test directories and prove it neither reads nor mutates the canonical external attempt history, physical harness state, daemon state, or remote service.

## 3. Verify the Narrow Acceptance-Owned Delta

- [x] 3.1 Run the focused `test/acceptance/session-cache/protocol.test.ts` suite serially and record the exact result without invoking physical observation. (`pnpm exec vitest run test/acceptance/session-cache/protocol.test.ts --no-file-parallelism --maxWorkers=1`: 1 file, 31 tests passed in 27.65s.)
- [x] 3.2 Run syntax/lint checks for the changed acceptance protocol/test files and strictly validate this change package; record any unrun broader build or platform gate honestly. (`node --check scripts/session-cache-acceptance/protocol.mjs` and scoped ESLint passed with no diagnostics; `node bin/rasen.js validate session-cache-optimization-final-acceptance-ci-proof --strict` reported the change valid. Root/full tests, build, native Linux CI, and physical observation were intentionally not run under this child directive.)
- [x] 3.3 Audit the final diff to confirm it touches only `scripts/session-cache-acceptance/protocol.mjs`, `test/acceptance/session-cache/protocol.test.ts`, and this change package, with no product-owner file, ECP Direction file, package lock, external immutable attempt, daemon/scheduler action, push, PR, or remote mutation. (The parent change's three pre-existing staged planning files and the pre-existing untracked UI package lock were left untouched.)
