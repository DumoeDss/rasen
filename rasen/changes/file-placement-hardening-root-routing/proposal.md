# Why

The file-placement migration and supervised-session APIs still collapse the
planning root and execution root at their caller boundaries. In a Store-planned
run this sends terminal run-state and probe migrations into the Store, resolves
legacy machine-home state against the wrong owner, and makes the Sessions API
look for a member session's terminal state under the Store. The interactive
`work migrate` path also previews one filesystem-derived plan and then creates a
second plan after confirmation, so the displayed actions are not the actions
that apply is guaranteed to execute.

The migration-safety foundation now provides an immutable, fingerprinted
`WorkMigrationPlan` and fail-closed `applyWorkMigration` seam. Root routing must
thread explicit, frozen placement context through that seam and through session
run-state reads without weakening its scoped, no-clobber, or fail-closed
contracts.

# What Changes

- Resolve and freeze a work-migration root context at the command boundary:
  planning root and changes directory, execution checkout/worktree root,
  legacy-home owner root, and explicit Windows/POSIX path-identity flavor.
- Add the shared Store/project selection surface to `rasen work migrate`.
  Store-selected planning files, evidence, handoff, and design docs remain in
  the Store while run-state, probes, and other terminal execution artifacts
  route only to the selected member checkout/worktree.
- Make every preview mode plan exactly once. Interactive confirmation passes
  the exact displayed `WorkMigrationPlan` object to `applyWorkMigration`;
  apply does not re-resolve roots, machine-home ownership, path flavor, or
  migration candidates.
- Keep migration output compatibility: existing human and JSON projections,
  `--dry-run`, `--json`, `--yes`, no-op, and no-mint preview behavior remain
  stable while root information is additive where surfaced.
- Make the Sessions API join planning metadata from the frozen session space
  and terminal state from the frozen session execution context. Missing,
  planning-only, or stale execution context never falls back to the planning
  root as an invented execution checkout.
- Add focused Store/two-worktree, exact-plan handoff, stale/missing execution
  context, and explicit Windows/POSIX path-identity coverage.

This change is deliberately limited to root-context and caller threading for
work migration and session run-state lookup. It does not change archive
behavior or accounting, workflow templates, the file classification model, or
the final documentation and generated-artifact reconciliation owned by sibling
changes.

# Capabilities

## Modified Capabilities

- `work-migration`: freeze planning, execution, and legacy-home ownership before
  preview; route Store migrations by file owner; and apply the exact confirmed
  immutable plan without replanning.
- `session-supervision`: join terminal state from each session's frozen
  execution context while retaining planning-space filtering and planning
  change metadata.
- `file-placement`: define the caller-boundary root-context invariant used by
  migration and read-only management consumers, including explicit
  path-identity flavor and fail-closed handling when execution authority is
  unavailable.

# Impact

- Primary code: `src/commands/work.ts`, root-context/caller portions of
  `src/core/work-migration.ts`, and
  `src/core/management-api/sessions.ts`.
- Compatibility types may gain additive root-context fields or helpers, but
  existing migration report projections and session wire shapes remain
  compatible.
- Tests: command and core migration tests plus Store/session integration tests,
  including two linked worktrees and both foundation `PathIdentityFlavor`
  modes.
- Dependency: consumes the completed
  `file-placement-hardening-migration-safety` plan/apply and filesystem-safety
  contracts without changing their action classification or mutation rules.
