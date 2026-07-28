## ADDED Requirements

### Requirement: The association registry is the persisted source of truth for ChangeInstance identity

Rasen SHALL persist one association ledger at the registered machine home
(the same home `resolveProjectHome` resolves) for every planning space that
has launched at least one reconciler Run. The ledger SHALL be the
authoritative record of `(changeId, ChangeInstanceId, physical Change
directory identity, active/archive aliases, state)` bindings. The launcher
SHALL consult this ledger on every `start` and SHALL derive `ChangeInstanceId`
from the Change directory's proven physical identity through the ledger —
not from the project root, the workspace path, or a content digest. The
ledger SHALL be immutable and append-only: every bind or archive mutation
appends a revision with a `previousDigest` chain, and any published ledger
file whose chain cannot be verified SHALL fail `run_store_corrupt` with no
semantic use. The ledger SHALL reuse the same staging → fsync → atomic-rename
publish contract as the canonical Run Record.

`PlanningSpaceId` SHALL derive from the persisted registry entry home name
that `resolveProjectHome` returns, never from `projectId`, the canonical
project root path, or a path hash. `ChangeInstanceId` SHALL incorporate that
`PlanningSpaceId` together with the canonical physical identity of the
**Change directory** (the directory at `<projectRoot>/<workspace>/changes/
<changeId>`), so archiving the Change and recreating the same name in a new
directory produces a different `ChangeInstanceId` and a different `RunId`
for the same textual `launchRequestId`.

#### Scenario: Same active Change reuses its instance across processes

- **WHEN** two `start` requests are issued in separate CLI processes for the
  same active Change directory and the same textual `launchRequestId`
- **THEN** both processes resolve the same `PlanningSpaceId` from the
  persisted registry home, the same `ChangeInstanceId` from the persisted
  association ledger, and the same `RunId`
- **AND** neither process mints a second ledger entry for the same physical
  Change directory

#### Scenario: Archive then recreate mints a new Run

- **WHEN** a Run's archive Action completes (or the archive skill relocates
  the Change directory) and afterwards a new Change directory is created
  with the same name and a new `start` is issued with the same textual
  `launchRequestId`
- **THEN** the launcher reads the archived state from the association
  ledger, observes that the new Change directory has a different physical
  identity from the archived entry, and mints a new `ChangeInstanceId`
- **AND** the resulting `RunId` differs from the archived Run's `RunId`
- **AND** the archived Run remains exactly inspectable via `pipeline status`
  and its mutations are refused with `change_instance_inactive`

#### Scenario: Project root inode changes do not alias distinct Changes

- **WHEN** the project root directory is renamed, moved, or its inode
  changes for any reason while the Change directory remains the same
  physical directory
- **THEN** the `ChangeInstanceId` for that Change is unchanged because it is
  derived from the Change directory's identity, not the project root's
- **AND** the association ledger continues to recognize the active Change

#### Scenario: Linked worktrees share PlanningSpace; independent clones do not

- **WHEN** two linked git worktrees resolve one persisted registry home, or
  two independent clones share a display `projectId` but have distinct
  registry homes
- **THEN** the linked worktrees share `PlanningSpaceId` (and therefore the
  association ledger namespace)
- **AND** the independent clones have distinct `PlanningSpaceId` values even
  when their `projectId` is identical

#### Scenario: Persisted ledger corruption fails closed

- **WHEN** the persisted ledger file is truncated, its `previousDigest` chain
  cannot be re-verified, its `planningSpaceId`/`projectId` does not match
  the resolved home, or its `format` tag is unrecognized
- **THEN** the launcher treats the ledger as `run_store_corrupt`
- **AND** no `ChangeInstanceId` is minted, no Run is created or reused, and
  no mutation is performed until the ledger is repaired
- **AND** read-only `inspect` of existing Runs remains available because the
  RunStore is keyed by `RunId` alone

#### Scenario: Ambiguous history requires an exact Run

- **WHEN** no active source exists and two historical Change instances with
  the same `changeId` have accepted Runs for the same textual
  `launchRequestId`
- **THEN** `start` fails `launch_instance_ambiguous`
- **AND** the error lists the candidate `(ChangeInstanceId, RunId)` pairs so
  the caller can supply an exact `--run` to disambiguate
- **AND** no Run is silently picked

#### Scenario: Cross-volume copy is never guessed as the same instance

- **WHEN** a Change directory is copied across volumes (different POSIX
  device or Windows volume serial) or restored from a backup, and a `start`
  is then issued with the same textual `launchRequestId`
- **THEN** the resulting `ChangeInstanceId` differs from the original
  because the physical identity codec encodes device/volume
- **AND** the original instance is `missing` (no archive receipt proved a
  relocation) rather than silently reused

### Requirement: Run-state mutations consult the registry's authoritative state before the filesystem

`complete` and `control` SHALL refuse to advance a Run whose source Change
instance is `archived` in the association ledger, regardless of whether a
same-name directory has since been created. The filesystem heuristic (an
active `rasen/changes/<id>/` directory vs an archived `<home>/archive/
*-<id>/` directory) MAY remain as a fallback only for cases the registry
cannot resolve (unregistered project, missing ledger, manually-moved source).
The registry SHALL be authoritative; the filesystem SHALL NOT override a
registry refusal. A Run that is refused remains exactly inspectable via
`pipeline status` and may still complete an already-admitted archive or
recovery observation that targets its original effects.

#### Scenario: Mutation on an archived Run is refused via the registry

- **WHEN** a `complete` or `control` request targets a Run whose Change
  instance is `archived` in the association ledger and a new same-name
  Change directory has since been created
- **THEN** the request fails `change_instance_inactive` after consulting
  the registry and before any Run Record mutation
- **AND** the new same-name Change directory is not adopted by the old Run

#### Scenario: Unregistered project falls back to the filesystem heuristic

- **WHEN** the association ledger cannot be resolved (unregistered project,
  missing home, or corrupt ledger that the launcher chose not to repair
  automatically) and a `complete` or `control` request is issued
- **THEN** the filesystem heuristic decides whether the mutation is allowed
- **AND** the behavior matches the pre-change behavior for unrecognized cases
- **AND** the registry's absence never widens the mutation surface beyond
  the filesystem fallback

#### Scenario: Status detail reflects the registry's real sourceState

- **WHEN** `pipeline status <runId>` renders the detail view for an exact Run
- **THEN** the `sourceState` field reports `active`, `archived`, or
  `missing` as the association ledger records for that Run's
  `ChangeInstanceId`
- **AND** the detail no longer reports `active` for a Run whose source is
  archived or moved
