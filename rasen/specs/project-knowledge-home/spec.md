# project-knowledge-home Specification

## Purpose

Give a project one canonical place for its own learned knowledge on a machine, keyed by the project's identity rather than by whichever clone a command happened to run in — kept separate from where applicability is evaluated and from where generated files are written — and move existing per-clone catalogs there without ever choosing between divergent copies or deleting anything unverified.
## Requirements
### Requirement: A project's knowledge lives in one place per project identity

A project's own learned knowledge SHALL be stored in one canonical location on a machine, determined by the project's identity. Every clone and every linked worktree of that project SHALL share it. That location SHALL be separate from the clone-specific working directory, from clone-specific archive and working ephemera, and from the place a tool's generated files are written inside a checkout.

#### Scenario: Two clones share one catalog

- **WHEN** the same project is checked out twice on one machine and knowledge is recorded from one of them
- **THEN** both checkouts resolve the same stored knowledge
- **AND** only one canonical location exists for that project

#### Scenario: Worktrees share the project's catalog

- **WHEN** a project has linked worktrees
- **THEN** every worktree resolves the same stored knowledge as the main checkout

#### Scenario: Storage is separate from working ephemera

- **WHEN** the canonical location is resolved for a project
- **THEN** it is not the clone-specific working directory and not the clone-specific archive area

#### Scenario: Storage is separate from generated files

- **WHEN** knowledge is materialized into a checkout
- **THEN** the generated files are written in that checkout
- **AND** the canonical stored copy is unchanged

#### Scenario: The location resolves cross-platform

- **WHEN** the canonical location is resolved on Windows
- **THEN** it is composed with platform path resolution
- **AND** two checkouts differing only by drive-letter case or separator form resolve to the same project

### Requirement: Existing per-clone catalogs are moved by an explicit, previewable migration

Moving a project's existing knowledge into its canonical location SHALL happen only when the user runs the migration. The migration SHALL offer a preview that changes nothing, SHALL be safe to run more than once, and SHALL report what it found in every clone it scanned.

#### Scenario: Preview reports the plan and writes nothing

- **WHEN** the migration runs in preview mode
- **THEN** it lists every catalog it found, what it would move, and what it would report as a conflict
- **AND** nothing is created, moved, or deleted

#### Scenario: Re-running is safe

- **WHEN** the migration is applied a second time with nothing left to move
- **THEN** it reports there is nothing to do and writes nothing

#### Scenario: A single catalog is moved

- **WHEN** exactly one clone holds a catalog for the project
- **THEN** it is moved into the canonical location

#### Scenario: Identical catalogs are deduplicated

- **WHEN** several clones hold catalogs whose contents are identical
- **THEN** one copy is moved into the canonical location and the duplicates are reported as such

### Requirement: Divergent catalogs are reported and nothing is chosen or deleted

When several clones hold catalogs that differ for the same knowledge, the migration SHALL report a conflict naming every location and the differing knowledge, SHALL NOT choose a winner, and SHALL NOT delete or overwrite any of them. No old catalog SHALL be removed until its replacement has been written to the canonical location and read back successfully. A failure at any point SHALL leave every existing catalog exactly as it was.

#### Scenario: A divergence stops the move and picks nothing

- **WHEN** two clones hold catalogs that differ for the same knowledge identifier
- **THEN** the migration reports the conflict naming both locations and the identifier
- **AND** neither is chosen, moved, overwritten, or deleted

#### Scenario: Old data survives until the new location is verified

- **WHEN** the migration writes to the canonical location and the verification read fails
- **THEN** every original catalog is still present and unmodified
- **AND** the failure names what could not be verified

#### Scenario: Unaffected knowledge still migrates

- **WHEN** two clones conflict on one knowledge identifier but agree on the rest
- **THEN** the agreeing knowledge is migrated and the conflicting identifier is reported and left alone

#### Scenario: A partial run leaves a usable state

- **WHEN** the migration is interrupted part-way
- **THEN** re-running it completes the remaining work without duplicating what already moved

