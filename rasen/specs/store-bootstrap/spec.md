# store-bootstrap Specification

## Purpose

Give a machine one command that answers "what is still missing before I can work on this project?" — reading what the project and its Stores declare, computing the whole gap at once, and reporting it. Covers what bootstrap reads, how it classifies each expected Store, the report's three end states, the separation between checking and previewing, the project-first and Store-first reporting flows, how a previewed location is chosen, and the rule that every command bootstrap prints resolves unambiguously. Closing the gap — obtaining a missing Store or Project, registering it on this machine, and writing the declarations that record the binding — is part of this capability and is gated behind an explicit `--apply` mutation mode; `--check` (the default) and `--dry-run` stay read-only, and a bare `rasen bootstrap` lists the mode the machine is in without changing anything.
## Requirements
### Requirement: One command reports everything a machine still needs for a project

Rasen SHALL provide a bootstrap command that reads the project's identity, the Store it declares for planning, and the Stores it declares membership hints for, determines the state of each on this machine, and reports the whole result in one place. The report SHALL end in exactly one of three named states — complete, degraded, or blocked — and SHALL name, for anything missing, what is missing and a repair that works on this machine today. The same facts SHALL be available in human and JSON output. State this machine keeps that exists but cannot be read SHALL be reported as a blocked result naming the file that cannot be read, never raised as an unhandled failure — a machine that is broken is what the command exists to describe.

#### Scenario: A fresh machine gets the whole gap at once

- **WHEN** bootstrap runs in a freshly cloned project whose declared Stores are not on this machine
- **THEN** it reports every missing Store in one result, not one per invocation
- **AND** the result names what each missing Store needs before it can be used

#### Scenario: The result carries one of three named end states

- **WHEN** bootstrap finishes for any project
- **THEN** the result is reported as complete, degraded, or blocked
- **AND** a degraded or blocked result names what is missing and its repair

#### Scenario: Human and JSON report the same facts

- **WHEN** the same project is reported once in human mode and once with JSON output
- **THEN** both report the same states, the same missing items, and the same repair commands

#### Scenario: A machine that needs nothing is told so

- **WHEN** every declared Store is already available and verified and every membership is recorded
- **THEN** the result is reported as complete
- **AND** no repair is offered for anything

#### Scenario: Machine state that cannot be read is reported, not crashed on

- **WHEN** the record this machine keeps of its Stores exists but cannot be read
- **THEN** the result is reported as blocked, naming the file that cannot be read and the repair
- **AND** the report is produced in human and JSON output alike rather than failing

### Requirement: Checking and previewing are separate promises

The bootstrap command SHALL offer a check mode that only reads: it SHALL NOT contact any network, clone, register, mint an identity, create a directory, or write any file. It SHALL also offer a preview mode that additionally resolves remotes and the exact target path it would use, while still creating no directory, running no version-control operation, and writing no registration or declaration. Neither mode SHALL leave any trace on the machine, and the two SHALL be requested separately rather than through one combined option.

#### Scenario: Check mode touches no network

- **WHEN** bootstrap runs in check mode
- **THEN** no remote is contacted
- **AND** the report describes the state from local information only

#### Scenario: Check mode writes nothing

- **WHEN** bootstrap runs in check mode against a project missing every Store
- **THEN** no directory is created, no registration is made, no identity is minted, and no file is written

#### Scenario: Preview mode resolves the target path

- **WHEN** bootstrap runs in preview mode for a Store that could be obtained
- **THEN** the report names the exact path the Store would be placed at

#### Scenario: Preview mode still writes nothing

- **WHEN** bootstrap runs in preview mode
- **THEN** no directory is created, no version-control operation runs, and no registration or declaration is written

#### Scenario: A mode is chosen explicitly

- **WHEN** bootstrap is invoked without naming a mode
- **THEN** it reports which modes are available and does nothing else

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

### Requirement: A Store's record of this project is reported, or reported as unverifiable

When a declared Store is available on this machine, bootstrap SHALL report whether that Store's own records include this project, and SHALL report a Store that does not record the project as degraded together with the repair. Bootstrap SHALL report the membership as unverifiable whenever the Store's own record for this project could not be READ — whether because the Store is not available here or because the record exists and cannot be understood — and SHALL name what would make it verifiable. It SHALL NOT report a membership it could not read as one the Store does not hold, SHALL NOT offer a repair that changes state on a membership it could not read, and SHALL NOT infer membership from anything other than that Store's own records.

#### Scenario: Membership is confirmed against the Store's own records

- **WHEN** a declared Store is available and its records include this project
- **THEN** bootstrap reports the membership as confirmed

#### Scenario: A Store that does not record the project degrades the result

- **WHEN** a declared Store is available and its records do not include this project
- **THEN** the result is reported as degraded, naming the repair that would record it

#### Scenario: An unavailable Store makes membership unverifiable, not absent

- **WHEN** a declared Store is not available on this machine
- **THEN** bootstrap reports that its record of this project cannot be verified here
- **AND** it does not report the project as missing from that Store

#### Scenario: A record that cannot be read makes membership unverifiable, not absent

- **WHEN** a declared Store is available and its record for this project exists but cannot be understood
- **THEN** bootstrap reports that the membership cannot be verified here, naming the record that cannot be read
- **AND** it does not report the project as missing from that Store
- **AND** it offers no repair that would change what the Store records

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

### Requirement: A previewed location is chosen by stated priority and reported as usable or refused

When bootstrap previews where a repository would be placed, it SHALL choose the location in this order: an explicitly supplied path; otherwise a supplied parent directory combined with a safe name derived from the source; otherwise it SHALL report that a location must be supplied rather than choosing one. A location that already has contents, or that already holds a checkout, SHALL be reported as refused rather than presented as one that would be used. A path recorded by another machine SHALL NOT influence the choice. The derived name SHALL be safe on every platform, containing no path separator, no traversal, and no name a filesystem reserves.

#### Scenario: An explicit path wins

- **WHEN** a path is supplied for a Store
- **THEN** the preview names that path regardless of any other candidate

#### Scenario: A parent directory plus a safe derived name is used next

- **WHEN** no explicit path is supplied but a parent directory is
- **THEN** the preview names that parent combined with a safe name derived from the source

#### Scenario: With neither, a location is demanded rather than invented

- **WHEN** neither an explicit path nor a parent directory is supplied
- **THEN** the preview reports that a location must be supplied
- **AND** it names no candidate location

#### Scenario: A location that already has contents is reported as refused

- **WHEN** the chosen location already has contents
- **THEN** the preview names the location and reports it as refused

#### Scenario: A location holding an existing checkout is reported as refused

- **WHEN** the chosen location already holds a checkout
- **THEN** the preview reports the existing checkout rather than presenting the location as usable

#### Scenario: A path recorded by another machine is never used

- **WHEN** legacy shared data records an absolute path from another machine
- **THEN** that path has no influence on the location the preview names

#### Scenario: The derived name is safe on Windows

- **WHEN** a name is derived from a source to place a repository
- **THEN** it contains no path separator or traversal and is not a name Windows reserves

#### Scenario: The same location written two ways is one location

- **WHEN** a supplied path and an existing checkout differ only by drive-letter case or separator form
- **THEN** they are treated as the same location and the refusal still applies

### Requirement: Every hint bootstrap prints can be pasted and will work

A command bootstrap prints for the user to run SHALL name a selector that resolves unambiguously on this machine. When a Store's display name matches more than one Store here, the printed command SHALL name the permanent identity instead of the display name.

#### Scenario: An unambiguous display name is used

- **WHEN** bootstrap prints a follow-up command for a Store whose display name matches only that Store
- **THEN** the command names the display name

#### Scenario: An ambiguous display name is replaced by the identity

- **WHEN** bootstrap prints a follow-up command for a Store whose display name matches more than one Store on this machine
- **THEN** the command names the permanent identity
- **AND** pasting it resolves to exactly that Store

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

### Requirement: Commands that cannot resolve a Store name bootstrap as the repair

A command that fails because a declared Store is not available on this machine SHALL name `rasen bootstrap` as the repair, and the command it names SHALL resolve unambiguously on this machine — the permanent identity when the Store's display name matches more than one Store here, the display name otherwise. A command that fails because a declared Store has no recorded remote and no supplied path SHALL state that a path or remote is required, because bootstrap cannot infer a location either and MUST NOT suggest it can. A checkout that turns out to be a different Store SHALL fail without writing anything, and SHALL NOT name bootstrap, because bootstrap cannot repair a mismatched identity. Diagnosis SHALL remain read-only and SHALL report bootstrap readiness by composing the same facts the bootstrap command's check mode reports, with copy-pasteable repairs, so that one surface answers "what does this machine still need?"

#### Scenario: An unavailable Store points at bootstrap

- **WHEN** an ordinary command fails because a declared Store is not available on this machine
- **THEN** the failure names `rasen bootstrap` as the repair
- **AND** the command it names can be pasted and resolves to the same project

#### Scenario: The repair names an unambiguous selector

- **WHEN** an ordinary command prints a repair naming bootstrap for a Store whose display name matches more than one Store on this machine
- **THEN** the printed command names the Store's permanent identity
- **AND** pasting it runs bootstrap against the project that declared it

#### Scenario: An unlocatable Store asks for a path or remote

- **WHEN** an ordinary command fails because a declared Store has no recorded remote and no supplied path
- **THEN** the failure states that a path or remote is required
- **AND** it does not name bootstrap, because bootstrap cannot infer a location from a name, a sibling directory, or a path another machine recorded

#### Scenario: A mismatched checkout writes nothing

- **WHEN** the checkout registered for a declared Store carries a different identity
- **THEN** the command fails and the registry and the Store's metadata are both unchanged
- **AND** the failure does not name bootstrap, because a mismatched identity is not a gap bootstrap can close

#### Scenario: Diagnosis reports readiness without changing anything

- **WHEN** diagnosis runs on a machine that is not fully bootstrapped
- **THEN** it reports each unmet requirement with a copy-pasteable repair
- **AND** no file under the project, any Store, or the machine data directory is modified

#### Scenario: Diagnosis composes the same checks bootstrap performs

- **WHEN** diagnosis reports bootstrap readiness for a project
- **THEN** every Store the project declares is reflected in the readiness result
- **AND** a Store that bootstrap would classify as missing is reported as missing by diagnosis, with the same repair bootstrap itself would print

#### Scenario: Diagnosis and bootstrap agree

- **WHEN** the same project is reported by `rasen doctor` and by `rasen bootstrap --check`
- **THEN** both name the same Stores as missing and the same repairs for each
