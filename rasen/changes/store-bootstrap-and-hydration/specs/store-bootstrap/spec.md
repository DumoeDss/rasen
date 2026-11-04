## Purpose

Give a machine one command that answers "what is still missing before I can work on this project?" — reading what the project and its Stores declare, computing the whole gap at once, reporting it, and closing it only when explicitly asked. Covers the separation between checking and acting, the project-first and Store-first flows, how a clone target is chosen and what is forbidden, idempotence on rerun, and the bootstrap-readiness diagnostics.

## ADDED Requirements

### Requirement: One command reports everything a machine still needs for a project

Rasen SHALL provide a bootstrap command that reads the project's identity, the Store it declares for planning, and the Stores it declares membership hints for, determines the state of each on this machine, and reports the whole result in one place. The report SHALL end in exactly one of three named states — complete, degraded, or blocked — and SHALL name, for anything missing, what is missing and the command that obtains it. The same facts SHALL be available in human and JSON output.

#### Scenario: A fresh machine gets the whole gap at once

- **WHEN** bootstrap runs in a freshly cloned project whose declared Stores are not on this machine
- **THEN** it reports every missing Store in one result, not one per invocation
- **AND** the result names what would obtain each one

#### Scenario: The result carries one of three named end states

- **WHEN** bootstrap finishes for any project
- **THEN** the result is reported as complete, degraded, or blocked
- **AND** a degraded or blocked result names what is missing and its repair

#### Scenario: Human and JSON report the same facts

- **WHEN** the same project is bootstrapped once in human mode and once with JSON output
- **THEN** both report the same states, the same missing items, and the same repair commands

### Requirement: Checking and acting are separate promises

The bootstrap command SHALL offer a check mode that only reads: it SHALL NOT contact any network, clone, register, mint an identity, create a directory, or write any file. It SHALL also offer a preview mode that additionally resolves remotes and the exact target path it would use, while still creating no directory, running no version-control operation, and writing no registration or declaration. Neither mode SHALL leave any trace on the machine.

#### Scenario: Check mode touches no network

- **WHEN** bootstrap runs in check mode
- **THEN** no remote is contacted
- **AND** the report describes the state from local information only

#### Scenario: Check mode writes nothing

- **WHEN** bootstrap runs in check mode against a project missing every Store
- **THEN** no directory is created, no registration is made, no identity is minted, and no file is written

#### Scenario: Preview mode resolves the target path

- **WHEN** bootstrap runs in preview mode for a Store that would be obtained
- **THEN** the report names the exact path the Store would be placed at

#### Scenario: Preview mode still writes nothing

- **WHEN** bootstrap runs in preview mode
- **THEN** no directory is created, no version-control operation runs, and no registration or declaration is written

### Requirement: Starting from a project clone resolves every declared Store and reports each one's state

Starting in a project checkout, bootstrap SHALL verify the project's identity, read its planning Store declaration in either the current or the earlier form, read its Store membership hints, and determine for each expected Store whether it is already available and verified, present on this machine but not registered, absent but obtainable from a recorded remote, or absent with no way to locate it. It SHALL register the current checkout, confirm that each Store's own records include this project, and prepare the project's local knowledge location. A Store with no recorded remote and no supplied path SHALL be reported as requiring one — its location SHALL NOT be inferred from a display name, a sibling directory, or any path recorded by another machine. Because the expected Store set comes entirely from declarations the user committed to their own project, a blanket confirmation option MAY cover obtaining those Stores here.

#### Scenario: An available Store is reported as needing nothing

- **WHEN** a declared Store is already registered and its identity and root verify
- **THEN** it is reported as complete with no action offered

#### Scenario: A present but unregistered Store is offered registration

- **WHEN** a declared Store exists on this machine but is not registered
- **THEN** it is reported with registration as the offered action

#### Scenario: An absent Store with a remote is offered retrieval

- **WHEN** a declared Store is absent and its declaration records a remote
- **THEN** it is reported with retrieval as the offered action, naming the remote

#### Scenario: An absent Store with no remote demands a path

- **WHEN** a declared Store is absent and no remote is recorded
- **THEN** bootstrap reports that a path or the Store's own metadata is required
- **AND** it does not infer a location from a display name, a nearby directory, or any recorded path

#### Scenario: Membership is confirmed against the Store's own records

- **WHEN** a declared Store is available
- **THEN** bootstrap reports whether that Store's own records include this project
- **AND** a Store that does not record the project is reported as degraded with the repair

#### Scenario: A blanket confirmation may obtain the project's own declared Stores

- **WHEN** bootstrap runs from a project checkout with the blanket confirmation option and the project declares Stores that are absent but obtainable
- **THEN** those Stores are obtained and registered without stopping to ask
- **AND** only Stores the project itself declares are obtained

#### Scenario: The project's knowledge location is prepared

- **WHEN** bootstrap completes in apply mode for a project
- **THEN** the project's local knowledge location exists as empty base directories
- **AND** no knowledge content is invented or imported by this step

### Requirement: Starting from a Store lists its projects and obtains none without being asked

Starting from a Store, bootstrap SHALL verify the Store's identity, register the checkout, read the Store's project records, and report which of those projects are already on this machine and which could be obtained. It SHALL obtain and register a project only when the user explicitly selects it or supplies a path for it. A blanket confirmation option SHALL NOT count as selection here: a Store's roster is authored by other people and can grow without the local user knowing, so confirming ahead of time SHALL cover only registering the Store's own checkout and other actions that do not expand what is obtained. It SHALL NOT obtain every project a Store records, under any option.

#### Scenario: The Store's projects are listed with their local state

- **WHEN** bootstrap runs against a Store holding several project records
- **THEN** each project is listed as already present on this machine or as obtainable

#### Scenario: Nothing is obtained without an explicit choice

- **WHEN** bootstrap runs against a Store holding several obtainable projects and the user selects none
- **THEN** no project is obtained and no project checkout is registered

#### Scenario: An explicitly chosen project is obtained

- **WHEN** the user explicitly selects one project, or supplies a path for it
- **THEN** only that project is obtained and registered

#### Scenario: A blanket confirmation does not obtain a Store's projects

- **WHEN** bootstrap runs from a Store with the blanket confirmation option and no project selected or named
- **THEN** the Store's own checkout is registered and its projects are listed
- **AND** no project is obtained, however many the Store records

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

### Requirement: Every hint bootstrap prints can be pasted and will work

A command bootstrap prints for the user to run SHALL name a selector that resolves unambiguously on this machine. When a Store's display name matches more than one Store here, the printed command SHALL name the permanent identity instead of the display name.

#### Scenario: An unambiguous display name is used

- **WHEN** bootstrap prints a follow-up command for a Store whose display name matches only that Store
- **THEN** the command names the display name

#### Scenario: An ambiguous display name is replaced by the identity

- **WHEN** bootstrap prints a follow-up command for a Store whose display name matches more than one Store on this machine
- **THEN** the command names the permanent identity
- **AND** pasting it resolves to exactly that Store

### Requirement: Commands that cannot resolve a Store name bootstrap as the repair

A command that fails because a declared Store is not available on this machine SHALL name bootstrap as the repair. A command that fails because a declared Store has no way to be located SHALL say that a path or remote is required. A checkout that turns out to be a different Store SHALL fail without writing anything. Diagnosis SHALL remain read-only and SHALL report bootstrap readiness across the same checks, with copy-pasteable repairs.

#### Scenario: An unavailable Store points at bootstrap

- **WHEN** an ordinary command fails because a declared Store is not available here
- **THEN** the failure names bootstrap as the repair

#### Scenario: An unlocatable Store asks for a path or remote

- **WHEN** an ordinary command fails because a declared Store has no recorded remote
- **THEN** the failure states that a path or remote is required

#### Scenario: A mismatched checkout writes nothing

- **WHEN** the checkout registered for a declared Store carries a different identity
- **THEN** the command fails and the registry and the Store's metadata are both unchanged

#### Scenario: Diagnosis reports readiness without changing anything

- **WHEN** diagnosis runs on a machine that is not fully bootstrapped
- **THEN** it reports each unmet requirement with a copy-pasteable repair
- **AND** no file under the project, any Store, or the machine data directory is modified
