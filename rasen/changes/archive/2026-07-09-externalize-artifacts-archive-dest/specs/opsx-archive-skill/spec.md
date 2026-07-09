# OPSX Archive Skill Spec (delta)

## ADDED Requirements

### Requirement: Bookkeeping step is destination-aware

The archive skill SHALL resolve the destination and location from the status JSON (`archive.destination`, `archive.archiveDir`) and route its bookkeeping step: `in-repo` — the existing move; `external` — move to the payload's `archiveDir`, falling back to an in-repo move with an explicit note when the payload carries no location (a fallback relocates, it never deletes); `prune` — delete the change directory. Gates, spec sync, and their order SHALL be identical for every destination; branch conditions SHALL keep keying on recorded ship-log facts over re-resolved config wherever a delivery has already happened.

#### Scenario: External move uses the CLI-reported location

- **WHEN** the generated archive skill runs with `destination: external` and the payload carries `archiveDir`
- **THEN** its bookkeeping SHALL move the change directory to that absolute location with the same date-prefix and collision rules as in-repo

#### Scenario: Prune branch deletes instead of moving

- **WHEN** the generated archive skill runs with `destination: prune` and the safety preconditions pass
- **THEN** its bookkeeping SHALL delete the change directory and report the pruned state

#### Scenario: Missing external location falls back with a note

- **WHEN** `destination` is `external` but the payload omits `archiveDir`
- **THEN** the skill SHALL move in-repo and state explicitly that it fell back from `external`

### Requirement: Skill enforces the destructive-destination preconditions

Before an external move or a prune delete, the skill SHALL verify the recorded delivery is complete (the existing timing/merge gates cover the pr-mode case) and that the change directory pathspec is both clean and tracked in git history — per the `archive-destination` capability's git-state check (`git status --porcelain --ignored` empty AND `git ls-files` non-empty; an unverifiable state fails closed and is refused, never treated as clean) — refusing with commit-first guidance otherwise. Prune SHALL additionally require a confirmation naming the deletion, and that confirmation SHALL be SEPARATE from any other confirmation or override already used earlier in the same invocation (e.g. the merge-confirmation gate's override for a recorded `pr`-mode delivery) — satisfying an earlier gate's confirmation SHALL NEVER be treated as also satisfying the prune confirmation. Prune SHALL be refused outright in non-interactive or dispatched contexts without a confirmation naming the deletion specifically. After destructive bookkeeping, the skill SHALL write the prune tombstone (per the `archive-destination` capability) before deleting, and SHALL direct a pathspec-scoped commit containing only the spec sync and the removal.

#### Scenario: Dirty change directory blocks prune

- **WHEN** the generated archive skill reaches bookkeeping with `destination: prune` and uncommitted, untracked, ignored-but-present, or unverifiable content under the change directory pathspec
- **THEN** it SHALL refuse and direct committing the change directory first

#### Scenario: Prune refused when dispatched

- **WHEN** the skill runs prune bookkeeping in a non-interactive or dispatched context without an explicit prior override naming the deletion specifically
- **THEN** it SHALL refuse outright with the reason

#### Scenario: The merge-confirmation override does not also authorize prune

- **WHEN** the skill has already obtained the merge-confirmation gate's override for a recorded `pr`-mode delivery (step 2.6) and then reaches prune bookkeeping (step 5) for the same invocation
- **THEN** the prune confirmation SHALL still be required as its own, separate step — the merge-confirmation override SHALL NOT be treated as also authorizing the deletion

### Requirement: Already-archived detection covers every destination

The skill's pre-status already-archived detection SHALL extend beyond the in-repo scan: after the status payload is available, a change absent from the active directory SHALL also be looked for in the external archive location (payload `archiveDir` or the home archive) and, failing directory presence, in its recorded ship-log outcome (archived path or pruned state) — reporting the existing outcome and stopping cleanly rather than hard-failing. The pre-status in-repo scan remains first (it needs no CLI call and catches the common case).

#### Scenario: Externally archived change is recognized

- **WHEN** archive is invoked for a change already moved to the external archive
- **THEN** the skill SHALL report it archived at the external location and stop without re-gating or re-moving

#### Scenario: Pruned change is recognized by its record

- **WHEN** archive is invoked for a change whose ship-log records a prune
- **THEN** the skill SHALL report the pruned state and stop cleanly
