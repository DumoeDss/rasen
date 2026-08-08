# Implementation report

## Delivered result

ECP-7 child 1 now has a daemon-owned, backend-neutral durable Session host
beside the unchanged legacy one-shot supervisor.

- `src/core/session-host/` contains public lifecycle contracts, strict command
  validation, bounded NDJSON protocol, backend/transport seam, Claude resident
  adapter, atomic registry, exact ownership adapter, and orchestration host.
- One stable Rasen UUID is distinct from backend Session identity and process
  generation. Create/wake reuses one resident process; recovery uses the exact
  backend identity and original canonical cwd.
- Durable request phases prevent automatic replay. Active crash, cancel, or
  retirement without proof becomes ambiguous/interrupted.
- Writer nonce and worker-tree token reuse the existing Claude session-state
  ownership primitive. Exact stale owners can be reaped; PID-only or mismatched
  owners remain fail-closed.
- Management adds authenticated `/api/v1/hosted-sessions` routes and additive
  hosted fields to legacy list/detail views. Existing one-shot launch behavior
  remains intact.
- `rasen session exec|list|inspect|cancel|restart|retire` uses only the verified
  same-version daemon. The caller never owns the live pipes.

## Verification performed

Fresh results from the isolated worktree on 2026-08-04:

| Gate | Result |
| --- | --- |
| `pnpm run build` | pass |
| Post-fix SessionHost/registry/protocol/backend + real Claude fixture + Management recovery + daemon convergence + CLI E2E | 13 files, 71/71 pass |
| Host cancel/retire race repetition | 10 consecutive 11-test file runs passed after registry visibility fix |
| `pnpm run lint` | pass |
| `pnpm exec tsc --noEmit` | pass |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | valid |
| UI typecheck | pass |
| UI test | 59 files, 651/651 pass |
| UI production build | pass |
| Isolated root `pnpm run test` with `VITEST_MAX_WORKERS=1` | 452 files, 6947 pass, 34 skip, exit 0 |

The real CLI journey builds the product, starts the actual detached daemon,
launches the no-network `.cmd` resident through the production adapter, exits
the first CLI, wakes from a second CLI, verifies stable Session/backend/PID
facts and prompt absence in registry/argv facts, then retires and stops.

## Important implementation findings

1. Registry `current` state must not become visible before exact lease release.
   Early cache publication created an intermittent same-process `registry-busy`
   race for cancel/retire; publication now becomes visible only after release,
   and the race test was repeated ten times.
2. Raw stdout budgets belong to one turn, not the lifetime of a resident
   process. The decoder is now reconstructed for each turn and any event after
   a terminal result poisons the transport instead of leaking into the next
   request.
3. A random registry owner token is not process authority. The durable process
   fact now stores the exact hard-link writer nonce, paired with its worker
   token/root PID.
4. A replacement daemon cannot adopt old pipes. Exact positive stale ownership
   permits cleanup; any ownership uncertainty retains interruption and refuses
   signals. Recovery never uses PID alone.
5. The historical design assumption that P1 should directly grow the one-shot
   supervisor was superseded. Reusing its process/daemon primitives while
   keeping a deep module beside it preserved compatibility and isolated the
   durable state machine.
6. Active cancellation can close a real event stream by throwing before the
   normal post-collection cancellation fence runs. The execute failure path now
   uses the durable ambiguous request plus recorded control intent to return
   `turn-outcome-unknown`, rather than leaking a generic protocol failure to the
   waiting caller.
7. A machine-data directory named `rasen` under an ancestor can resemble a
   planning root during interactive config tests. Project config rows now
   require an actual project config marker, preventing `%LOCALAPPDATA%/rasen`
   style data from becoming an editable project layer.

## TDD evidence after interrupted history

The interrupted session did not retain a trustworthy historical RED transcript
for every test-first task, so this report does not invent one. A real failing
CLI E2E exposed the cancel/transport mapping defect before its implementation
fix. Separately, `evidence/mutation-discriminator.md` records a reversible
production mutation: disabling the pruned-request Bloom guard made the target
test accept and execute the old request id; restoration made the same test
green. This is discriminator evidence, not a retroactive claim about chronology.

## Deferred by design

- Frozen Action admission, trusted completion production, private signer
  custody, and canonical Record mutation are child 2.
- Reuse/handoff/touch/capacity policy and public cross-plane control parity are
  child 3.
- Product self-hosting is child 4.
- Actual Linux/macOS remote runs, final clean-branch transfer, unique PR, and
  release audit are ECP-8.
- Independent security/code review, local ship, and archive remain later
  stages. Apply-stage focused, static, UI, and isolated full-root gates are
  green; exact machine-readable commands, totals, exit marker, and log hashes
  are retained in `evidence/apply-gates.json`.

## Strategy attempt 1 implementation delta

The original implementation above was subsequently found by Round 3 review to
have two Major containment/identity defects: Windows controller death did not
close the Job-owned tree, and the remaining POSIX branch used
second-resolution `ps lstart` as process identity. Strategy attempt 1 replaced
that authority model rather than patching the old PID surface.

The durable host now depends on an opaque `ProcessScope`; a source-owned Rust
`ProcessCapsule` owns native containment and exact process-birth checks. The
backend is prepared inert, its opaque ref is committed to registry schema v2,
and only then is it activated. Cancellation, reconcile, restart, retirement,
and shutdown all return the ref to the scope adapter. Unobserved prepared or
live closure retains authority for retry.

The native helper is part of normal build/package/release assembly. Its
adjacent manifest pins protocol, platform, architecture, capabilities, byte
length, helper hash, source digest, and compiler. Resolver mismatches fail
before activation without runtime compile/download/PATH/shell fallback.

Final author verification for this delta:

| Gate | Result |
| --- | --- |
| ProcessScope/package/v1 migration/native discriminators | 4 files, 17/17 pass |
| Complete focused durable-host set | 20 files, 136/136 pass |
| CLI E2E after fixture-boundary repair | 3/3 pass |
| TypeScript + root ESLint + strict Change validation | pass |
| Build + `npm pack --dry-run --json` | pass; native manifest/helper included |
| Linux/macOS target compile checks | pass (compile-only, not runtime evidence) |

The focused rerun also caught an obsolete E2E assumption that test-only
fixture environment variables would be inherited by the backend. The fixture
now reads test configuration from its isolated cwd; the production environment
allowlist remains closed.

This is author implementation evidence only. Tasks 9.8-9.10, local ship, and
archive remain pending fresh non-author review.
