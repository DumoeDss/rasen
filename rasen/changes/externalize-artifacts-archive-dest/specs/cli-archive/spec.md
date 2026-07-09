# cli-archive Specification (delta)

## ADDED Requirements

### Requirement: Archive command honors the destination axis

`rasen archive <change>` SHALL resolve the archive destination (per the `archive-destination` capability) and route its bookkeeping accordingly: `in-repo` moves to the root's archive directory exactly as before; `external` registers the project's machine home when needed and moves the change there, with the move safe across filesystems; `prune` deletes the change directory after the command's confirmations plus its own dedicated prune-naming confirmation (a separate flag from `--yes`; see "Timing-guard override and prune confirmation are separate consents" below), skipping quality capture visibly. The destructive-destination preconditions (delivery-complete facts, and the change directory being both clean and tracked in git history — per the `archive-destination` capability) SHALL be enforced before any external move or prune delete. JSON output SHALL report the destination and the archived path (or the pruned state).

#### Scenario: External archive via the CLI

- **WHEN** `rasen archive <change> --yes` runs with destination `external`
- **THEN** the change SHALL land under the project's machine-home archive
- **AND** the JSON result SHALL name the destination and the absolute archived path

#### Scenario: Prune via the CLI requires its own dedicated override

- **WHEN** `rasen archive <change> --json` runs with destination `prune` without the dedicated prune override
- **THEN** the command SHALL refuse with a blocked error naming the prune confirmation requirement, regardless of whether `--yes` was passed

#### Scenario: Uncommitted change directory blocks destructive CLI bookkeeping

- **WHEN** `rasen archive <change>` runs with destination `external` or `prune` and the change directory has uncommitted content
- **THEN** the command SHALL refuse and direct committing the change directory first

### Requirement: Archive command respects on-merge timing for PR deliveries

Because the CLI never invokes `gh`, and uses git only for local read-only status checks (never to make a workflow decision like a merge determination), `rasen archive` cannot verify a merge itself; when the resolved archive timing is `on-merge` and the change's recorded ship log shows a `pr`-mode delivery, the command SHALL refuse to archive without an explicit override (`--yes`), directing the user to the archive skill (which performs the merge check) or to confirm the merge themselves. This closes the path by which the CLI could bypass the merge-confirmation gate of the `archive-timing` capability.

#### Scenario: CLI blocks the merge-gate bypass

- **WHEN** `rasen archive <change>` runs for a change whose ship log records a `pr` delivery under `on-merge` timing, without `--yes`
- **THEN** the command SHALL refuse, explain that merge confirmation is required, and point to `/rasen:archive` or an explicit `--yes` after the user confirms the merge

#### Scenario: Explicit override archives anyway

- **WHEN** the same command runs with `--yes`
- **THEN** the archive SHALL proceed, treating the override as the user's merge confirmation

### Requirement: Timing-guard override and prune confirmation are separate consents

The `--yes` override that satisfies the on-merge timing guard (merge confirmation) and the confirmation that authorizes a `prune` deletion SHALL be separate consents that neither substitutes for the other. `rasen archive` SHALL expose a dedicated flag (distinct from `--yes`) for the prune confirmation, so that passing `--yes` alone — even when it successfully satisfies the timing guard — SHALL NEVER also authorize a `prune` destination's deletion. When both gates apply to the same invocation (on-merge timing with a recorded `pr` delivery, destination `prune`), the timing guard's refusal message SHALL make clear that its own override does not also authorize the deletion, so a user acting on that message is not misled into believing one flag covers both.

#### Scenario: --yes alone never authorizes a prune deletion

- **WHEN** `rasen archive <change> --yes` runs with destination `prune` and no dedicated prune confirmation was given
- **THEN** the command SHALL refuse the deletion with a blocked error naming the prune confirmation requirement, exactly as it would without `--yes`

#### Scenario: The timing-guard refusal for a prune destination does not imply --yes alone suffices

- **WHEN** the merge-confirmation timing guard refuses a change whose destination is `prune`
- **THEN** its refusal message SHALL state that the prune deletion requires its own separate confirmation, not `--yes` alone

#### Scenario: Both consents together allow the archive to proceed

- **WHEN** `rasen archive <change>` runs with destination `prune` under on-merge timing for a recorded `pr` delivery, with BOTH `--yes` (merge confirmation) and the dedicated prune confirmation supplied
- **THEN** the archive SHALL proceed
