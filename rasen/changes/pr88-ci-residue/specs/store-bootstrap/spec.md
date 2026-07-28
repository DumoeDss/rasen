## MODIFIED Requirements

### Requirement: A clone target is chosen by stated priority and never overwrites anything
Bootstrap SHALL choose where to place an obtained repository in this order: an explicitly supplied path; otherwise a supplied parent directory combined with a safe name derived from the source; otherwise by asking. It SHALL NOT place a repository into a directory that already has contents, SHALL NOT overwrite an existing checkout, and SHALL NOT choose a location from a path recorded by another machine. The remote SHALL be passed as an argument to the version-control operation and never assembled into a shell command line. The derived name SHALL be safe on every platform, containing no path separator, no traversal, and no name a filesystem reserves. When the target was absent at the start of an obtain call but another process publishes a checkout there before this call can act, bootstrap SHALL report that case as a failed obtain (a lost race) rather than as a refusal to act on pre-existing content.

#### Scenario: An explicit path wins

- **WHEN** a path is supplied for a Store or project
- **THEN** it is used regardless of any other candidate

#### Scenario: A parent directory plus a safe derived name is used next

- **WHEN** no explicit path is supplied but a parent directory is
- **THEN** the repository is placed in that parent under a safe name derived from its source

#### Scenario: A non-empty directory is refused

- **WHEN** the chosen target directory already has contents that predate this obtain call
- **THEN** bootstrap refuses, names the directory, and obtains nothing

#### Scenario: An existing checkout is never overwritten

- **WHEN** the chosen target is an existing checkout that predates this obtain call
- **THEN** bootstrap refuses and reports the existing checkout rather than replacing it

#### Scenario: A concurrent race at the same target is reported as a lost race, not a refusal

- **WHEN** two obtain calls target the same path concurrently
- **AND** the winner publishes its checkout before the loser's location probe runs
- **THEN** the loser reports its action as a failed obtain (it lost the race)
- **AND** it does NOT delete or modify the winner's checkout

#### Scenario: A path recorded by another machine is never used

- **WHEN** legacy shared data records an absolute path from another machine
- **THEN** that path has no influence on where anything is placed

#### Scenario: The remote is never passed through a shell

- **WHEN** a repository is obtained from a remote
- **THEN** the remote is supplied as an argument to the version-control operation
- **AND** it is never concatenated into a shell command line

#### Scenario: The derived name is safe on Windows

- **WHEN** a name is derived from a source to place a repository
- **THEN** it contains no path separator or traversal and is not a name Windows reserves
