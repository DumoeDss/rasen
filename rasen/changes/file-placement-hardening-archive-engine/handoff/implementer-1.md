# Implementer handoff

## Scope and status

- Implemented the archive-engine child change in the shared PR review
  worktree. No commit, push, ship, archive, run-state, Store-root routing,
  session, CLI work-migration, final documentation, or historical archive edit
  was performed by this unit.
- `tasks.md`: 40/41 complete. Only the native Windows/macOS/Linux CI matrix
  remains intentionally open for `file-placement-hardening-closure`.

## Implementation

- Added `src/core/archive-engine.ts` with a versioned, stable, serializable
  `ArchivePlan`; mutation-free planning; narrow injected filesystem/Git/hash/
  time/cleaner adapters; strict blockers; immutable prepared spec actions;
  source and target preconditions; stable action ordering; sidecar, cleaner,
  quality, evidence, Git, recovery, and journal projections.
- Apply now validates the exact plan hash and current Git/probe/source facts,
  copies exclusively to a same-parent stage, verifies the staged tree, applies
  handoff intent only in the stage, finalizes ship and quality evidence before
  hashing, publishes with no clobber and no `EPERM` fallback, journals actual
  cleaner progress, atomically accounts, and removes the active source last.
- Matching interrupted transactions resume idempotently. Prepared spec actions
  are all prevalidated before the first mutation; a partial multi-spec write
  recognizes already-applied planned results on resume and continues safely.
  Unrelated stage/final collisions remain untouched.
- Exhaustive injected recovery exposed and closed two additional boundaries:
  an unrelated final target is never mutated by failure journaling, and a
  matching transaction at the `planned` phase rebuilds an owned partial/corrupt
  stage instead of merging into it. Failure reports now retain phase-specific
  operation/path/code fields, and accounting has a narrow injected seam.
- Added production-used explicit path helpers for native transaction paths,
  containment, sidecar/probe relative syntax, and date-prefixed archive name
  identity. Tests pass `path.win32`/`path.posix` and identity flavor directly;
  they do not infer semantics from the host.
- Hardened `src/core/archive-accounting.ts` with confirmed Git/non-Git/error
  states, recursive symlink-safe and drift-checked evidence hashing, typed
  errors, and atomic same-directory `archive.json` replacement plus
  parse/hash verification.
- Refactored `src/core/archive.ts` into a compatibility adapter over the shared
  plan/confirm/apply engine. Human and JSON dry-runs derive from the same plan
  and do not mutate the filesystem; apply consumes that exact plan.
- Updated the archive, bulk-archive, and ship workflow templates so generated
  consumers use the engine and contain no direct archive move, recursive
  source deletion, manual ledger write, active handoff mutation, or post-hash
  evidence append. Updated parity hashes and added golden consumer tests.
- Added equivalent-fixture integration for direct CLI, generated single,
  generated bulk, and generated in-ship invocations, plus the complete named
  fault/recovery and path-semantic acceptance suites.

## Verification

- Focused archive/accounting/ephemera/template/command/API command:
  `pnpm exec vitest run test/core/archive.test.ts test/core/archive-engine.test.ts test/core/archive-consumer-integration.test.ts test/core/archive-fault-matrix.test.ts test/core/archive-path-semantics.test.ts test/core/archive-accounting.test.ts test/core/archive-ephemera.test.ts test/core/ephemera-cleaner.test.ts test/core/templates test/commands/ship.test.ts test/commands/work.test.ts test/core/management-api/archive.test.ts test/core/management-api/archive-api.test.ts`
  - PASS: 21 files, 216/216 tests.
- `pnpm exec tsc --noEmit --pretty false`
  - PASS.
- `pnpm lint`
  - PASS.
- `pnpm build`
  - PASS.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`
  - PASS: 1 change valid, 0 issues.
- `git diff --check`
  - PASS; output contained only repository line-ending conversion warnings.
- The known no-summary repository-wide suite was not relaunched. It previously
  ran for about 430 seconds without a Vitest summary and is not represented as
  passing.

## Open closure gate

- **7.6:** Native Windows/macOS/Linux CI completion remains owned by
  `file-placement-hardening-closure`; local Windows results are not claimed as
  three-host evidence.

## Shared-worktree boundaries

- Archive-owned implementation files are `src/core/archive-engine.ts`,
  `src/core/archive-accounting.ts`, `src/core/archive.ts`, the three archive
  consumer templates, `test/core/archive-engine.test.ts`,
  `test/core/archive-consumer-integration.test.ts`,
  `test/core/archive-fault-matrix.test.ts`,
  `test/core/archive-path-semantics.test.ts`,
  `test/core/templates/archive-engine-consumers.test.ts`, the template parity
  hash update, and this change's task/evidence/handoff artifacts.
- Concurrent changes visible in root-routing, sessions, work migration,
  cleaner/path identity, locales, other tests, portfolio artifacts, and audit
  documentation belong to sibling units and were not reverted or claimed.

## Durable findings

- Source-last safety must include spec updates: immutable plans alone are not
  enough unless partially completed spec actions are recognizable and
  resumable.
- Only `ENOENT` is absence. Sidecar, handoff, Git, evidence, quality, and target
  inspection errors must remain typed blockers or recoverable failures.
- Evidence and ship-log bytes must be final before accounting; successful
  consumers must not append archive facts after hashes are recorded.
- Stage and final archive paths must share a parent. `EXDEV` is therefore an
  invariant failure, not a copy/delete fallback opportunity.
- A recovery journal may only be written into a stage/final proven to belong
  to the matching transaction. Path existence alone is never ownership.
- A partial copy cannot resume by continuing an exclusive merge. A matching
  `planned` journal authorizes rebuilding only that engine-owned stage while
  the active source remains authoritative.
