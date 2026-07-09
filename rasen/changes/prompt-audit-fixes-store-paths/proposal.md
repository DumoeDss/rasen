## Why

The workflow-lifecycle audit's last two open findings are path-resolution seams (WF-3, WF-9): several lifecycle templates hardcode repo-local `rasen/changes/<name>/…` and `rasen/specs/…` paths even though they embed the store-selection guidance that tells the agent specs/changes may live outside the cwd — so in a registered store they read/write the wrong location. This child was deliberately deferred to last so it could be reconciled with the concurrent `externalize-artifacts` portfolio, whose converged design (`rasen/office-hours/externalize-openspec-artifacts.md`) redefines where some of these artifacts live. That reconciliation is done (see design Decision 1) and determines a **narrowed** scope: fix only the path resolution the externalize design keeps in-repo, and hand the rest to the externalize child that already owns it.

## What Changes

Fix the **externalization-proof** path-resolution offenders — the artifacts the externalize design keeps in-repo (or in-store), which just need to be resolved from `rasen status --json` instead of hardcoded, exactly as the already-correct lifecycle commands (`new`/`continue`/`apply`) and `bulk-archive` do:

- **WF-9 — single archive matches bulk archive:** `archive-change.ts`'s task-completion check resolves the tasks file via `artifactPaths.tasks.existingOutputPaths` instead of the literal `tasks.md`, matching `bulk-archive-change.ts`.
- **WF-3 (T1 main specs) — archive + sync:** `archive-change.ts`'s delta-vs-main comparison and `sync-specs.ts`'s main-spec target resolve the main-specs directory from the planning home (the `specs/` sibling of `planningHome.changesDir`) instead of the literal `rasen/specs/<capability>/spec.md`, so they land in the store's specs in store mode.
- **WF-3 (T4 knowledge) — office-hours output:** `office-hours.ts` (the workflow) resolves its design-doc write paths (the in-change-dir doc and the sibling office-hours directory) from `changeRoot`/`planningHome` instead of hardcoded `rasen/changes/<name>/…` and `rasen/office-hours/…`. This completes the symmetry with child #5's WF-2 fix, which already made `propose` *read* those locations resolved.

**Explicitly deferred (not fixed here) — the T3 process-ephemera offenders** WF-3 names in `ship.ts` (ship-log), `verify-enhanced.ts` (report writes), `retro.ts` (retro output), plus `verify-change.ts` (verification-report) and run-state: these are owned by the live `externalize-artifacts-t3-workdir` child, whose design moves them out of the repo to an external `workDir`. See design Decision 1.

## Capabilities

### New Capabilities
<!-- none — all fixes land in existing capability specs -->

### Modified Capabilities
- `opsx-archive-skill`: add a path-resolution requirement — resolve the tasks file and the main-specs comparison path from status JSON (`artifactPaths`, planning home), not hardcoded repo-local paths (WF-9 + WF-3 T1).
- `specs-sync-skill`: add a path-resolution requirement — resolve the main-spec target from the planning home, not literal `rasen/specs/` (WF-3 T1).
- `opsx-office-hours-command`: add a path-resolution requirement — resolve the office-hours output paths from status JSON (WF-3 T4).

## Impact

- Template sources: `src/core/templates/workflows/archive-change.ts`, `sync-specs.ts`, `office-hours.ts` (workflow). No `bulk-archive-change.ts` edit needed — it is the correct reference.
- No `src/core` runtime code (that surface belongs to the externalize session); templates only, riding existing status-JSON fields (`changeRoot`, `planningHome`, `artifactPaths`) — no dependency on the not-yet-exposed `workDir` field.
- Tests: `test/core/templates/skill-templates-parity.test.ts` — `rasen-archive-change`, `rasen-sync-specs`, and `rasen-office-hours-command` are now hash-pinned (via child #5's registry expansion), so these edits move their hashes; predict and re-lock.
- **Coordination flag (VERIFIED against t3-workdir's proposal):** `archive-change.ts` is edited by BOTH this child (steps 3/4 — tasks + main-spec paths) and the live `externalize-artifacts-t3-workdir` change ("read side only" — repointing archive's verification/ship-log gate READS to the external workDir). Non-overlapping regions, same file; both also add a delta spec to `opsx-archive-skill` (different requirements). Both are in propose; neither has applied. Recommend the LEAD serialize the two changes' apply on `archive-change.ts` (trivial rebase). `sync-specs.ts` (pending archive-timing surface) and `office-hours.ts` (no claimant) are clean of t3-workdir. This child touches NO T3 ephemera templates and NO `src/core` runtime.
