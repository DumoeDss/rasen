# RED baseline

All failures below were captured before the new production module existed. The tests exercise only the agreed public seams; they do not mock or call private implementation details.

| Task | Command | Intended RED evidence |
| --- | --- | --- |
| 1.2-1.4 | `pnpm exec vitest run test/core/session-host/process-authority-public-surface.test.ts --maxWorkers=1 --minWorkers=1` | Exit 1. Vitest could not resolve `src/core/session-host/process-authority/index.js`, so no tests were collected. This proves the platform-neutral contract, deterministic explicit-provider coordinator, and empty production registry were missing; the failure was not a syntax or fixture failure. |
| 2.1-2.3 | `pnpm exec vitest run test/core/session-host/process-authority-registry.test.ts --maxWorkers=1 --minWorkers=1` | Exit 1 with 4/5 assertions already green. The exact-dispatch discriminator failed with `selected.provider.inspect is not a function`, proving that shallow spreading a provider erased prototype methods from class-based adapters. |
| 3.1-3.4 | `pnpm exec vitest run test/core/session-host/process-authority-reference.test.ts --maxWorkers=1 --minWorkers=1` | Exit 1. Vitest could not resolve `process-authority/reference-codec.js`, proving the canonical envelope, mutation rejection, future-version retention, and internal-only provider decoder did not exist. |
| 4.1-4.4 | `pnpm exec vitest run test/core/session-host/process-authority-lifecycle.test.ts --maxWorkers=1 --minWorkers=1` | Exit 1 with 9/9 scenarios RED because `coordinator.prepare` did not exist. The failing public cases covered inert preparation, publish binding, early/duplicate activation, duplicate/late publication, abort/publication and activation/abort races, and deterministic repeated settlement. |

Future RED commands are appended per vertical slice before their matching production implementation.
