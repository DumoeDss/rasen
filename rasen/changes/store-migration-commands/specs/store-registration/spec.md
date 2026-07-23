## ADDED Requirements

### Requirement: Doctor detects migration drift states
`rasen store doctor` SHALL additionally diagnose three drift states and name the repairing command for each: a repo whose `store:` pointer references an unregistered store id (error — work is unaddressable); a repo with both planning shape and a `store:` pointer (warning — mode derivation resolves to in-repo, which may surprise after an interrupted adopt); and adoption-manifest entries referencing specs or changes absent from the store (warning, with the missing names listed).

#### Scenario: Pointer to unregistered store
- **WHEN** a repo's config declares `store: ghost` and no store with id `ghost` is registered
- **THEN** doctor reports an error naming the id and suggests `rasen store register` or correcting the pointer

#### Scenario: Ambiguous shape plus pointer
- **WHEN** a repo has a `specs/` directory and a `store:` pointer at the same time
- **THEN** doctor warns that the project resolves as in-repo and suggests resuming `store adopt` or removing the pointer

#### Scenario: Manifest references missing content
- **WHEN** the store's adoption manifest lists a change that no longer exists in the store
- **THEN** doctor warns with the missing name and suggests inspecting the store's git history or running `store eject --force`
