## MODIFIED Requirements

### Requirement: Starting from a project clone, every declared Store is classified and reported
Starting in a project checkout, bootstrap SHALL verify the project's identity, read its planning Store declaration in either the current or the earlier form, read its Store membership hints, and determine for each expected Store whether it is already available and verified, present on this machine but not registered, absent but obtainable from a recorded remote, or absent with no way to locate it. Each expected Store SHALL be reported in exactly one of those states together with what would resolve it. Bootstrap SHALL NOT search the machine for an unregistered Store: it reports a Store as present but unregistered only when the user names a location holding it, and otherwise reports it as absent. A Store with no recorded remote and no supplied path SHALL be reported as requiring one — its location SHALL NOT be inferred from a display name, a sibling directory, or any path recorded by another machine.

When the user asks bootstrap to act in apply mode, it SHALL register the current project checkout, register each Store the user names a location for that is present on this machine but not yet registered, prepare the project's local knowledge location as empty base directories, and re-verify a Store's record of this project once that Store becomes available through registration. Bootstrap SHALL NOT retrieve a repository from a remote, SHALL NOT create a checkout, and SHALL NOT run any version-control operation, in any mode. A blanket confirmation MAY cover registering the Stores the project itself declares and names a location for, because the expected Store set comes from the user's own committed declarations.

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

#### Scenario: Membership is re-verified after a Store becomes available

- **WHEN** a Store's record of this project could not be verified because the Store was not registered
- **AND** bootstrap registers that Store during apply
- **THEN** the membership answer is re-verified against the Store's now-readable records
- **AND** it is reported as confirmed or not-recorded, never left as unverifiable

#### Scenario: The project's knowledge location is prepared

- **WHEN** bootstrap completes in apply mode for a project
- **THEN** the project's local knowledge location exists as empty base directories
- **AND** no knowledge content is invented or imported by this step

#### Scenario: Apply does not retrieve from a remote

- **WHEN** bootstrap runs in apply mode and a declared Store is absent with a recorded remote
- **THEN** the Store is reported as absent with retrieval named as the next step
- **AND** no repository is cloned, no version-control operation runs, and no remote is contacted for retrieval

#### Scenario: A blanket confirmation covers registering the project's declared Stores

- **WHEN** bootstrap runs in apply mode with the blanket confirmation option from a project checkout
- **AND** the project declares Stores that are present on this machine but not registered
- **THEN** those Stores are registered without stopping to ask
- **AND** only Stores the project itself declares are registered, and nothing is obtained from a remote

## ADDED Requirements

### Requirement: Running bootstrap again changes nothing that is already correct
A rerun against the same project identity and the same checkout SHALL NOT rewrite any identity, SHALL NOT create a duplicate registration, SHALL NOT change a recorded path, and SHALL NOT repeat an import. It SHALL report which items were already in place, distinguishably from items it acted on. A display name or remote that no longer matches SHALL be reported and SHALL NOT be corrected automatically.

#### Scenario: A second run reports everything already in place

- **WHEN** bootstrap is run a second time with nothing changed in between
- **THEN** it reports the registrations and preparation as already in place
- **AND** it writes nothing

#### Scenario: No duplicate registration is created

- **WHEN** bootstrap is run again for a Store that is already registered
- **THEN** the registry holds exactly one entry for that Store and its recorded path is unchanged

#### Scenario: Drift is reported, never corrected

- **WHEN** a declared display name or remote no longer matches the Store's own metadata
- **THEN** the drift is reported with the command that would refresh the declaration
- **AND** bootstrap does not change the declaration on its own

### Requirement: A declaration bootstrap writes is durable and usable
When bootstrap writes a project's Store declaration, it SHALL write the durable form recording the Store's permanent identity, and SHALL include the Store's display name whenever the Store has one, so that the declaration is usable by every surface that reads it. Bootstrap SHALL NOT write a bare display name as a declaration. When a Store has no display name at all, bootstrap SHALL report the resulting limitation and its repair rather than writing a declaration that silently fails elsewhere.

#### Scenario: The written declaration carries identity and name together

- **WHEN** bootstrap writes a Store declaration for a Store that has a display name
- **THEN** the written declaration records the permanent identity and the display name

#### Scenario: A bare name is never written

- **WHEN** bootstrap writes any Store declaration
- **THEN** it is never written as a bare display name

#### Scenario: A nameless Store's limitation is reported

- **WHEN** the Store being declared has no display name
- **THEN** bootstrap reports the limitation and its repair rather than leaving the user to discover it later
