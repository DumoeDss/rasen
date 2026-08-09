# APPLY green progress

This receipt is deterministic/common evidence only. It is not Linux, Windows, macOS, or ProcessCapsule runtime acceptance.

| Tasks | Command | Result |
| --- | --- | --- |
| 1.2-2.7 | `pnpm exec vitest run test/core/session-host/process-authority-public-surface.test.ts test/core/session-host/process-authority-registry.test.ts --maxWorkers=1 --minWorkers=1` | Exit 0; 2 files and 8 tests passed. Exact class-provider dispatch, descriptor closure/copying, no-fallback unavailability, native-field exclusion, and an empty production registry were green. |
| 2.7 | `pnpm exec tsc --noEmit` | Exit 0, including the public-surface negative type assertions. |
| 3.1-3.8 | `pnpm exec vitest run test/core/session-host/process-authority-reference.test.ts --maxWorkers=1 --minWorkers=1` | Exit 0; 12 tests passed. Canonical round trip, corruption-only digest, closed-schema/base64/bounds mutations, duplicate/non-canonical fields, exact tuple/ref-version mismatch, future-version byte retention, zero invalid-reference provider calls, and the log-safe/no-public-decoder seam were green. |
| 3.8 | `pnpm exec tsc --noEmit` | Exit 0 after the internal codec and exact resolution seam were added. |
| 4.1-4.9 | `pnpm exec vitest run test/core/session-host/process-authority-lifecycle.test.ts --maxWorkers=1 --minWorkers=1` | Exit 0; 9 tests passed. The suite includes 20 deterministic injected-clock/scheduler repetitions and covers prepare inertness, exact publication identity, early/duplicate activation, duplicate/late publication, abort/publication and activation/abort races, exactly-once workload start, exact-empty abort, and late provider settlement. |
| 4.9 | `pnpm exec tsc --noEmit` and scoped `git diff --check` | Exit 0 after the lifecycle coordinator and publication capability were added. |
