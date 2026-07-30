## Why

The runtime edit-boundary feature adds project hooks, startup trust prompts, and
cross-runtime state machinery without providing a complete security boundary.
Its narrow scope-control benefit is better expressed through explicit work
scope and post-change diff verification, while Rasen's generic daemon and ECP
isolation controls remain available for real execution containment.

## What Changes

- **BREAKING** Remove the public `rasen agent edit-boundary set|status|clear`
  commands, the hidden hook checker, checkout-scoped boundary state, runtime
  enforcement classification, completions, exports, and current documentation.
- Stop installing or reconciling Rasen edit-boundary hooks during `init` and
  `update`.
- Add a bounded compatibility cleanup path that removes only exact Rasen-owned
  Claude/Codex hook entries and recognized version-1 boundary state while
  preserving unrelated hooks, configuration, files, and newer/unknown state.
- Keep the existing exact cleanup and saved-selection normalization for the
  predecessor `freeze`, `guard`, and `unfreeze` artifact generation, additive
  to cleanup for the identical runtime hooks and version-1 state that may be
  present on both released 0.1.6 and 0.2.0 lines.
- Rewrite investigate, navigator, and shared expert guidance around declared
  scope, changed-file inspection, and truthful reporting of writes that did not
  land, without claiming mechanical denial.
- Preserve generic daemon/ECP `workspace.access`, sandbox, workspace
  reservations, and isolated-worktree behavior; these are execution controls,
  not a renamed freeze/unfreeze feature.

## Capabilities

### New Capabilities

- `runtime-edit-boundary-retirement`: Public surface removal, exact upgrade
  cleanup, supersession of the active runtime-boundary design, and preservation
  of independent daemon/ECP execution controls.

### Modified Capabilities

- `legacy-cleanup`: Init/update clean both generations of retired boundary
  artifacts by frozen exact identity without deleting unrelated user state.
- `investigate-diagnosing-absorption`: Investigate replaces runtime boundary
  transitions with an explicit affected-area declaration and post-fix diff
  scope audit.
- `navigator-router-skill`: Navigator stops advertising the runtime boundary
  and routes users to the remaining scope, caution, review, and verification
  controls.
- `expert-dispatch-contract`: Shared expert guidance uses actual write results
  and changed-file evidence instead of edit-boundary enforcement terminology.

## Impact

- Runtime and CLI: `src/core/edit-boundary*.ts`,
  `src/core/runtime-adapters.ts`, `src/commands/agent.ts`,
  `src/cli/index.ts`, completions, exports, locale strings, and focused tests.
- Lifecycle and migration: `src/core/init.ts`, `src/core/update.ts`,
  `src/core/legacy-cleanup.ts`, frozen retired-boundary identifiers, and
  Claude/Codex project hook configuration.
- Generated guidance: shared expert preambles, investigate, navigator,
  template parity hashes, and generated skill/catalog assertions.
- Documentation and specs: current English/Chinese guidance, the superseded
  `runtime-edit-boundary` active change, and retirement/migration contracts.
- No daemon, management API, ECP workspace-access, sandbox, reservation, or
  isolated-worktree contract is removed.
