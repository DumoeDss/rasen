# OPSX Archive Skill Spec (delta)

## ADDED Requirements

### Requirement: Archive resolves the timing axis before its gates

The archive skill SHALL resolve the archive timing from the status JSON (`archive.timing`) and the delivery facts from the ship log before running its existing gates, and branch accordingly: a ship log recording an in-ship archive SHALL make the invocation an idempotent no-op reporting the already-archived location; an on-merge change with a `pr`-mode delivery SHALL pass the merge-confirmation gate (defined by the `archive-timing` capability, including its no-gh/offline degradation) before any sync or bookkeeping; an on-merge change with `push`/`local` delivery or no ship log SHALL proceed exactly as before this axis existed. Spec sync and directory bookkeeping SHALL remain the same two separable steps in the same order for every timing — the axis only decides when the skill may reach them.

#### Scenario: Merge gate runs before sync and move

- **WHEN** the generated archive skill is inspected
- **THEN** the timing resolution and merge-confirmation gate SHALL appear before the spec-sync prompt and the directory move
- **AND** an unmerged PR SHALL stop the skill before any sync or bookkeeping happens

#### Scenario: In-ship change reports already archived

- **WHEN** archive is invoked for a change whose ship log records an in-ship archive
- **THEN** the skill SHALL report the archived location and stop cleanly without gates, sync, or move

#### Scenario: Undelivered or push-delivered change behaves as today

- **WHEN** archive is invoked for an on-merge change with no ship log or with a `push`/`local` delivery
- **THEN** the skill SHALL run its existing gates and steps unchanged, with no merge-confirmation step
