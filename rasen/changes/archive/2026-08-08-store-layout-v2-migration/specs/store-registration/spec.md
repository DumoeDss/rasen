## MODIFIED Requirements

### Requirement: Doctor detects migration drift states

`rasen store doctor` SHALL additionally diagnose three drift states and name the repairing command for each: a repo whose `store:` pointer references an unregistered store id (error — work is unaddressable); a repo with both planning shape and a `store:` pointer (warning — mode derivation resolves to in-repo, which may surprise after an interrupted adopt); and adoption-manifest entries referencing specs or changes absent from the store (warning, with the missing names listed).

Both `rasen doctor` and `rasen store doctor` SHALL also diagnose planning-layout drift for the store itself, with identical codes and identical repair commands in human and JSON output: local refs that still carry flat planning content, a store declaring layout version 2 that still holds flat planning content, an unfinished or failed layout migration recorded for that store and ref, a project partition with no project catalog, and a project catalog declaring a bound planning binding with no partition. Each finding SHALL name the affected ref, path, or project and carry the copy-pasteable command that migrates, resumes, or recovers it. A store whose planning layout cannot be diagnosed SHALL be reported as such rather than reported as a store with no layout findings. These findings SHALL be read-only: reporting them SHALL modify nothing in the store, in any project repository, or in the machine data directory, and SHALL rewrite no Git history even when a layout inconsistency was produced by a manual merge.

A store that declares layout version 2, still holds flat planning content, and records a completed retirement SHALL be diagnosed as a re-introduced flat tree rather than as a retirement that has not run: the finding SHALL NOT offer the retirement command, and every planning mutation SHALL refuse while that state persists.

#### Scenario: Pointer to unregistered store

- **WHEN** a repo's config declares `store: ghost` and no store with id `ghost` is registered
- **THEN** doctor reports an error naming the id and suggests `rasen store register` or correcting the pointer

#### Scenario: Ambiguous shape plus pointer

- **WHEN** a repo has a `specs/` directory and a `store:` pointer at the same time
- **THEN** doctor warns that the project resolves as in-repo and suggests resuming `store adopt` or removing the pointer

#### Scenario: Manifest references missing content

- **WHEN** the store's adoption manifest lists a change that no longer exists in the store
- **THEN** doctor warns with the missing name and suggests inspecting the store's git history or running `store eject --force`

#### Scenario: Flat refs are reported with their migration command

- **WHEN** a store has local refs that still carry flat planning content
- **THEN** doctor reports each such ref and the command that migrates it
- **AND** it states that migrating one ref does not migrate the others

#### Scenario: Half-migrated store is distinguished

- **WHEN** a store declares layout version 2 and still holds flat planning content
- **THEN** doctor reports the residue and any recorded unfinished migration run distinctly from an unmigrated flat store
- **AND** it names the recovery command rather than repairing anything

#### Scenario: Partition and catalog disagree

- **WHEN** a project partition exists with no project catalog, or a catalog declares a bound planning binding with no partition
- **THEN** doctor reports the affected project and path with its repair command

#### Scenario: Layout diagnosis writes nothing

- **WHEN** any planning-layout drift finding is reported
- **THEN** the store, every project repository, and the machine data directory are left byte-identical

#### Scenario: Both doctors report the same layout findings

- **WHEN** a store carries planning-layout drift and both `rasen doctor` and `rasen store doctor` are run against it
- **THEN** both report the same codes with the same repair commands
- **AND** the human rendering carries each code, not only its prose

#### Scenario: A flat tree re-introduced after retirement is not pending retirement

- **WHEN** a store's flat planning tree was retired and flat planning content is present again
- **THEN** doctor reports it as a re-introduced flat tree and does not offer the retirement command
- **AND** adopt, eject, archive relocation, and membership record writes all refuse while it persists
