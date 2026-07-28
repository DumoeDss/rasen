## MODIFIED Requirements

### Requirement: Starting from a project clone, every declared Store is classified and reported
Starting in a project checkout, bootstrap SHALL verify the project's identity, read its planning Store declaration in either the current or the earlier form, read its Store membership hints, and determine for each expected Store whether it is already available and verified, present on this machine but not registered, absent but obtainable from a recorded remote, or absent with no way to locate it. Each expected Store SHALL be reported in exactly one of those states together with what would resolve it. Bootstrap SHALL NOT search the machine for an unregistered Store: it reports a Store as present but unregistered only when the user names a location holding it, and otherwise reports it as absent. A Store with no recorded remote and no supplied path SHALL be reported as requiring one — its location SHALL NOT be inferred from a display name, a sibling directory, or any path recorded by another machine.

When the user asks bootstrap to act in apply mode, it SHALL register the current project checkout, register each Store the user names a location for that is present on this machine but not yet registered, obtain and register each declared Store that is absent with a recorded remote when the user consents, prepare the project's local knowledge location as empty base directories, and re-verify a Store's record of this project once that Store becomes available through registration or retrieval. A blanket confirmation MAY cover obtaining the Stores the project itself declares from their recorded remotes, because the expected Store set comes from the user's own committed declarations.

#### Scenario: An available Store is reported as needing nothing

- **WHEN** a declared Store is already registered and its identity and root verify
- **THEN** it is reported as complete with no repair offered

#### Scenario: A present but unregistered Store is reported with registration as its repair

- **WHEN** a declared Store is not registered and the user names a location that holds it
- **THEN** it is reported as present but unregistered, with registration of that location named as the repair

#### Scenario: An unregistered Store is not searched for

- **WHEN** a declared Store is not registered and the user names no location for it
- **THEN** bootstrap reports it as absent rather than searching the machine for it

#### Scenario: An absent Store with a remote is reported with its remote

- **WHEN** a declared Store is absent and its declaration records a remote
- **THEN** it is reported as obtainable, naming the remote

#### Scenario: An absent Store with no remote demands a path

- **WHEN** a declared Store is absent and no remote is recorded
- **THEN** bootstrap reports that a path or the Store's own metadata is required
- **AND** it does not infer a location from a display name, a nearby directory, or any recorded path

#### Scenario: A declaration in the earlier form is still read

- **WHEN** a project declares its planning Store in the earlier form rather than the current one
- **THEN** that Store appears in the report with its state determined the same way

#### Scenario: A declaration that cannot be read is reported, not skipped

- **WHEN** a project's Store declaration cannot be understood
- **THEN** the result is reported as blocked, naming the declaration and what to correct

#### Scenario: The current checkout is registered during apply

- **WHEN** bootstrap runs in apply mode from a project checkout
- **THEN** the current project checkout is registered in the machine project registry
- **AND** a second run reports it as already registered and writes nothing

#### Scenario: A present-unregistered Store is registered during apply

- **WHEN** bootstrap runs in apply mode and a declared Store is present on this machine but not registered
- **AND** the user names a location for it, or confirms it under a blanket confirmation
- **THEN** that Store is registered through the same path `rasen store register` uses
- **AND** the registry holds exactly one entry for it after the run

#### Scenario: An absent Store declared by the project is obtained during apply

- **WHEN** bootstrap runs in apply mode and a Store the project declares is absent with a recorded remote
- **AND** the user consents to obtaining it, or confirms it under a blanket confirmation
- **THEN** the Store is cloned from its remote to the location bootstrap previewed
- **AND** it is registered through the same path `rasen store register` uses
- **AND** its membership is re-verified against the now-readable records

#### Scenario: Membership is re-verified after a Store becomes available

- **WHEN** a Store's record of this project could not be verified because the Store was not registered
- **AND** bootstrap registers or obtains that Store during apply
- **THEN** the membership answer is re-verified against the Store's now-readable records
- **AND** it is reported as confirmed or not-recorded, never left as unverifiable

#### Scenario: The project's knowledge location is prepared

- **WHEN** bootstrap completes in apply mode for a project
- **THEN** the project's local knowledge location exists as empty base directories
- **AND** no knowledge content is invented or imported by this step

#### Scenario: Apply does not retrieve from a remote

- **WHEN** bootstrap runs in apply mode and a declared Store is absent with a recorded remote
- **AND** the user does not consent to obtaining it
- **THEN** the Store is reported as absent with retrieval named as the next step
- **AND** no repository is cloned for it and no version-control operation runs for it

#### Scenario: A blanket confirmation covers registering the project's declared Stores

- **WHEN** bootstrap runs in apply mode with the blanket confirmation option from a project checkout
- **AND** the project declares Stores that are present on this machine but not registered, or are absent with recorded remotes
- **THEN** those Stores are registered, or obtained and registered, without stopping to ask
- **AND** only Stores the project itself declares are covered

### Requirement: Starting from a Store checkout, its projects are listed with their local state
Starting from a Store checkout, bootstrap SHALL verify the Store's identity, read the Store's project records, and report which of those projects are already on this machine and which could be obtained. A recorded project that is neither here nor obtainable from a recorded remote SHALL be reported as neither, rather than as obtainable, and one whose presence cannot be determined SHALL be reported as undetermined rather than as any of the three. The result SHALL NOT be reported as complete when any of the Store's records could not be read.

When the user asks bootstrap to act in apply mode, it SHALL register the Store's own checkout. It SHALL obtain and register a project only when the user explicitly selects it or supplies a path for it. A blanket confirmation SHALL NOT count as selection here: a Store's roster is authored by other people and can grow without the local user knowing, so confirming ahead of time SHALL cover only registering the Store's own checkout. It SHALL NOT obtain every project a Store records, under any option.

#### Scenario: The Store's projects are listed with their local state

- **WHEN** bootstrap runs against a Store holding several project records
- **THEN** each project is listed as already present on this machine, as obtainable from a recorded remote, or as neither

#### Scenario: Nothing is obtained and nothing is registered

- **WHEN** bootstrap runs against a Store holding several obtainable projects and the user selects none
- **THEN** no project is obtained and no project checkout is registered

#### Scenario: An explicitly chosen project is obtained

- **WHEN** the user explicitly selects one project, or supplies a path for it
- **THEN** only that project is obtained and registered

#### Scenario: A blanket confirmation does not obtain a Store's projects

- **WHEN** bootstrap runs from a Store in apply mode with the blanket confirmation option and no project selected or named
- **THEN** the Store's own checkout is registered and its projects are listed
- **AND** no project is obtained, however many the Store records

#### Scenario: A Store whose identity does not verify is reported, not assumed

- **WHEN** the checkout bootstrap is run from does not verify as the Store it claims to be
- **THEN** the result is reported as blocked, naming the mismatch
- **AND** nothing is written

#### Scenario: A record that cannot be read is never reported as nothing missing

- **WHEN** bootstrap runs against a Store holding a project record that cannot be understood
- **THEN** the result is not reported as complete
- **AND** the record that could not be read is named in the result

## ADDED Requirements

### Requirement: A clone target is chosen by stated priority and never overwrites anything
Bootstrap SHALL choose where to place an obtained repository in this order: an explicitly supplied path; otherwise a supplied parent directory combined with a safe name derived from the source; otherwise by asking. It SHALL NOT place a repository into a directory that already has contents, SHALL NOT overwrite an existing checkout, and SHALL NOT choose a location from a path recorded by another machine. The remote SHALL be passed as an argument to the version-control operation and never assembled into a shell command line. The derived name SHALL be safe on every platform, containing no path separator, no traversal, and no name a filesystem reserves.
#### Scenario: An explicit path wins

- **WHEN** a path is supplied for a Store or project
- **THEN** it is used regardless of any other candidate

#### Scenario: A parent directory plus a safe derived name is used next

- **WHEN** no explicit path is supplied but a parent directory is
- **THEN** the repository is placed in that parent under a safe name derived from its source

#### Scenario: A non-empty directory is refused

- **WHEN** the chosen target directory already has contents
- **THEN** bootstrap refuses, names the directory, and obtains nothing

#### Scenario: An existing checkout is never overwritten

- **WHEN** the chosen target is an existing checkout
- **THEN** bootstrap refuses and reports the existing checkout rather than replacing it

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

### Requirement: A failed retrieval is cleaned up only when provably safe
When obtaining a repository fails, bootstrap SHALL remove the target directory only when it can establish that this run created that directory and that removing it is safe. In every other case the directory SHALL be left exactly as it is and reported, together with what to inspect.
#### Scenario: A directory this run created is cleaned up

- **WHEN** retrieval fails into a directory this run created and which contains only the failed attempt
- **THEN** the directory is removed and the failure is reported

#### Scenario: A pre-existing directory is never removed

- **WHEN** retrieval fails and the target directory existed before this run
- **THEN** the directory is left exactly as it was
- **AND** the failure report names it and what to inspect
