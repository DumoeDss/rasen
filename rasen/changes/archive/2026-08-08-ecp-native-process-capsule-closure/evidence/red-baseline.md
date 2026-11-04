# S1-S5 RED baseline

The user-approved TDD contract required vertical tracer bullets, so the planned
aggregate pre-fix command was decomposed into the same focused files one seam at
a time. No aggregate pre-fix exit code is invented here. The aggregate command
is rerun as a GREEN gate after the final slice.

| Finding | RED command / prior independent oracle | Observed failure before the slice's fix |
| --- | --- | --- |
| S1 | `pnpm exec vitest run test/core/session-host/process-capsule-macos-identity.test.ts --maxWorkers=1 --minWorkers=1` | 1 failed, 1 skipped: the source had no complete 56-byte `ProcUniqIdentifierInfo`; a second RED failed on the absent unavailable-birth mutation mode. |
| S2 | `pnpm exec vitest run test/core/session-host/process-scope-host-closure.test.ts --maxWorkers=1 --minWorkers=1` | 1 failed: `live.rootExited` was undefined because root `EXIT` was the public close event. The exact failed test root was audited and removed after its exact PIDs exited. |
| S3 | Fresh strategy review plus the old source at Change start | The one-shot POSIX path signalled only the exact controller and then waited for the supervisor PID to disappear; it had no reserved-group replacement cleanup. The actual Linux/macOS cases remain runnable unchanged but are not executed on this Windows host. |
| S4 | `pnpm exec vitest run test/core/session-host/process-capsule-control-deadline.test.ts --maxWorkers=1 --minWorkers=1` | 3 failed: both test-only modes were absent and the helper returned `unsupported ProcessCapsule mode`; ACTIVATE/abort had no bounded acknowledgement outcome. |
| S5 | `pnpm exec vitest run test/core/session-host/process-capsule-provenance.test.ts --maxWorkers=1 --minWorkers=1` | 1 failed: no isolated `RASEN_PROCESS_CAPSULE_BUILD_ROOT` seam existed. |
| Deterministic close | `pnpm exec vitest run test/core/session-host/process-scope-contract.test.ts --maxWorkers=1 --minWorkers=1` | The new root-exit/scope-empty test remained unsettled until the command timeout because deterministic terminate changed only its record and did not resolve exact scope-empty. |

Two test-fixture hypotheses were eliminated without weakening product bounds:

- a non-detached Windows grandchild did not remain independently live after its
  root exited, so the Windows oracle now uses a detached child that is still
  captured by the Job;
- a 75 ms test deadline could expire during helper PREPARE, so the injected test
  deadline is 500 ms while the production default remains 10 seconds.
