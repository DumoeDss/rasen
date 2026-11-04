# Result: router/runs/management-api seams (L7)

**Status:** passed
**Outcome:** Store-scoped routing is reconciled against 0.2.0's management-api per-endpoint:
the uid-addressed Store HTTP route family is live (`GET/POST /api/v1/stores/:storeUid/issues`,
issue plans, projects, lines, changes, and
`POST .../changes/:instance/finalize`), aggregate queries refuse cross-store aggregation and
carry partition-aware reads with explicit completeness (unsearched refs AND unread items lower
`complete`; nothing is silently dropped for being broken), and the finalize bridge spawns the
real CLI without taking git's optional locks.

Delivered as a direct git port in two commits, both in PR #161 (merge `cdbe7d0a`, first-try
green): `6fcd75b7` ("port the L7 management-api seams — Store route family, aggregate refusal,
partition-aware reads") and `2a9e904a` ("close the last L7 deferral — finalize inspections stop
taking git's optional locks").

## Evidence

- `src/core/management-api/stores-routes.ts` — the route family, typed refusals, partition-aware
  reads; `src/core/management-api/finalize.ts` — the finalize route with
  `GIT_OPTIONAL_LOCKS: '0'` in the spawned child env (line ~281), the NTFS byte-snapshot
  closure.
- `test/core/management-api/store-finalize-api.test.ts` — 36 tests through the spawned-CLI
  bridge: outcome recording, phase timeouts releasing the cap-one gate, refusal diagnostics
  leaving no partial entry, sole-merge preview precedence. Live re-run green 2026-08-16 on
  Windows/NTFS: 36/36, zero skips.
- Partition-aware read completeness (`AggregateProblem`, `presentedDiagnostic`) is covered in
  the store query suites and surfaced through both HTTP and CLI (`store-add-project.test.ts`
  asserts the WARNING + exitCode-0 plain path).
- PR #161's matrix was green on the first run — no reconciliation rounds needed for this slice.

## Attempts / history

- 2026-08-13..16 - Ported as PR #161 (the only slice of the wave that did not need a CI fix
  round); the optional-locks fix rode the same PR after the byte-snapshot flake was
  root-caused.
- 2026-08-16 - Post-merge review verified routes, refusals, and the live 36/36; slice closed
  `passed`.
