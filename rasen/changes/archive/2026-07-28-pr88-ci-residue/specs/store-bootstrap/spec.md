## MODIFIED Requirements

### Requirement: A clone target is chosen by stated priority and never overwrites anything
Bootstrap SHALL choose where to place an obtained repository in this order: an explicitly supplied path; otherwise a supplied parent directory combined with a safe name derived from the source; otherwise by asking. It SHALL NOT place a repository into a directory that already has contents, SHALL NOT overwrite an existing checkout, and SHALL NOT choose a location from a path recorded by another machine. The remote SHALL be passed as an argument to the version-control operation and never assembled into a shell command line. The derived name SHALL be safe on every platform, containing no path separator, no traversal, and no name a filesystem reserves. When the chosen target already holds a checkout (the target contains a `.git` directory or Store metadata), bootstrap SHALL report that case as a failed obtain — the checkout is already present, whether placed by a concurrent racer or by a prior call — rather than as a refusal to act on pre-existing user content. When the chosen target already has non-checkout contents, bootstrap SHALL refuse and obtain nothing.

#### Scenario: An explicit path wins

- **WHEN** a path is supplied for a Store or project
- **THEN** it is used regardless of any other candidate

#### Scenario: A parent directory plus a safe derived name is used next

- **WHEN** no explicit path is supplied but a parent directory is
- **THEN** the repository is placed in that parent under a safe name derived from its source

#### Scenario: A future target keeps the identity of its existing parent

- **WHEN** the selected target does not exist yet
- **AND** its existing parent is reached through an operating-system path alias
- **THEN** the reported target uses the parent's canonical filesystem identity
- **AND** later checks of the created target resolve to that same identity

#### Scenario: A non-empty directory is refused

- **WHEN** the chosen target directory already has contents that predate this obtain call
- **THEN** bootstrap refuses, names the directory, and obtains nothing

#### Scenario: An existing checkout is reported as a failed obtain

- **WHEN** the chosen target already holds a checkout (`.git` directory or Store metadata)
- **THEN** bootstrap reports a failed obtain (the checkout is already present) rather than replacing it or cloning over it
- **AND** it does NOT delete or modify the existing checkout

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
