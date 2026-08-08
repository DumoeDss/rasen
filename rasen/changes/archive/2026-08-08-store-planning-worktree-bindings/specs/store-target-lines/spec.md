## Purpose

Give a release line a stable identity that survives every change to the Git refs that currently represent it: `targetLineId` is the partition key for Archive and a derivation input for `PlanningScopeId`, while the Store ref and the per-project code refs behind it are mutable locators an operator may re-point without inventing a new line. Target lines are authored explicitly, resolved to concrete refs and commit OIDs at use time, never inferred from a branch name, and never silently exchanged underneath a Change that has already frozen one.

## ADDED Requirements

### Requirement: Target lines are authored explicitly and never inferred

A Store SHALL gain a target line only through an explicit authoring command that validates the identifier against the portable v2 identifier contract and writes one target-line catalog. Authoring SHALL refuse an identifier that already exists rather than overwriting it, and SHALL require the Store ref locator. No command SHALL create, guess, or complete a target line from a Git branch name, a version string, a directory name, a sibling record, or "the only line that looks similar". A catalog write SHALL take the scope lock, SHALL print a pathspec-scoped commit suggestion, and SHALL stage, commit, fetch, and push nothing.

#### Scenario: A new line is authored with its Store locator

- **WHEN** an operator adds a target line to a Store declaring layout version 2, naming its Store ref
- **THEN** one target-line catalog SHALL be written for that identifier
- **AND** the command SHALL suggest the commit pathspec and SHALL leave the Git index untouched

#### Scenario: Authoring refuses to overwrite an existing line

- **WHEN** an operator adds a target line whose identifier already has a catalog
- **THEN** the command SHALL refuse and name the existing catalog
- **AND** the existing catalog SHALL remain byte-identical

#### Scenario: A branch name is never a target line

- **WHEN** a Store repository has a branch whose name embeds a plausible line identifier and no catalog declares that line
- **THEN** no command SHALL resolve, create, or offer that line
- **AND** the absence SHALL be reported as an unknown target line rather than as a resolvable one

### Requirement: Target-line identity is stable while its locators move

A target-line record SHALL carry a stable identifier, a Store ref locator, and a per-project code ref locator for each participating project. Re-pointing any locator SHALL be an edit of that record and SHALL NOT change the identifier, create a second line, or migrate any content. Locator editing SHALL refuse to remove a project's code ref while a Change bound to that line and project is still active. Identifier renaming SHALL NOT be offered at all.

#### Scenario: Moving a line from a branch to a tag keeps its identity

- **WHEN** an operator re-points a target line's Store ref from a branch to a tag
- **THEN** the identifier SHALL be unchanged and no second line SHALL exist
- **AND** every Change already frozen against that line SHALL still resolve to it

#### Scenario: Removing a locator a live Change depends on is refused

- **WHEN** an operator removes a project's code ref from a line that an active Change for that project is bound to
- **THEN** the edit SHALL be refused, naming the Change
- **AND** the record SHALL remain unchanged

### Requirement: Target-line locators resolve to concrete refs and commit OIDs

Resolving a target line SHALL produce its identifier together with the Store ref, the Store ref's commit OID, the selected project's code ref, and that code ref's commit OID, each resolved in its own repository through the read-only Git adapter. A locator that names no ref, names an ambiguous ref, or resolves to something other than a commit SHALL fail with `target_line_ref_unresolved`, naming the record field and the repository. Resolution SHALL NOT fall back to `HEAD`, to the currently checked-out branch, or to a similarly named ref, and SHALL NOT succeed partially.

#### Scenario: Both sides resolve to commits

- **WHEN** a target line is resolved for a project whose code ref exists in that project's repository
- **THEN** the result SHALL carry both refs and both commit OIDs
- **AND** the OIDs SHALL be the ones later frozen into any plan that consumes this resolution

#### Scenario: A missing locator fails closed

- **WHEN** a target line's Store ref or a project's code ref names a ref that does not exist
- **THEN** resolution SHALL fail with `target_line_ref_unresolved`, naming the field and the repository
- **AND** no fallback ref SHALL be selected and no partial resolution SHALL be returned

#### Scenario: A line with no locator for the selected project is reported as such

- **WHEN** a target line exists but carries no code ref for the selected project
- **THEN** resolution SHALL report the missing project locator rather than resolving the Store side alone
- **AND** it SHALL name the command that adds the locator

### Requirement: A Change cannot be re-pointed at another target line

A Change's target line SHALL be the one frozen in its v2 identity metadata at creation. When a command resolves a target line for an existing Change and that line differs from the frozen one, the command SHALL fail with `target_line_mismatch`, naming both lines, before reading or writing any planning content. A weaker source that supplies a different line SHALL NOT override the frozen one, and a checkout that happens to sit on another line's ref SHALL NOT change the Change's line.

#### Scenario: An explicit selector disagreeing with the Change is refused

- **WHEN** a command addresses a Change frozen against one target line while explicitly selecting another
- **THEN** it SHALL fail with `target_line_mismatch`, naming both lines
- **AND** no planning content SHALL be read or written

#### Scenario: The current checkout does not re-point a Change

- **WHEN** a command addresses a Change from a worktree whose checked-out ref belongs to a different target line
- **THEN** the Change's frozen line SHALL remain authoritative
- **AND** the disagreement SHALL be reported rather than silently resolved
