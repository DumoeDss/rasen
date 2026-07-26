## Purpose

Give a machine one command that answers "what is still missing before I can work on this project?" — reading what the project and its Stores declare, computing the whole gap at once, and reporting it. Covers what bootstrap reads, how it classifies each expected Store, the report's three end states, the separation between checking and previewing, the project-first and Store-first reporting flows, how a previewed location is chosen, and the rule that every command bootstrap prints resolves unambiguously. Closing the gap — obtaining, registering, and writing declarations — is specified separately and is not part of this capability yet.

## ADDED Requirements

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

Starting from a Store checkout, bootstrap SHALL verify the Store's identity, read the Store's project records, and report which of those projects are already on this machine and which could be obtained. A recorded project that is neither here nor obtainable from a recorded remote SHALL be reported as neither, rather than as obtainable, and one whose presence cannot be determined SHALL be reported as undetermined rather than as any of the three. The result SHALL NOT be reported as complete when any of the Store's records could not be read. It SHALL obtain no project, register nothing, and write nothing, in either mode and however many projects the Store records.

#### Scenario: The Store's projects are listed with their local state

- **WHEN** bootstrap runs against a Store holding several project records
- **THEN** each project is listed as already present on this machine, as obtainable from a recorded remote, or as neither

#### Scenario: Nothing is obtained and nothing is registered

- **WHEN** bootstrap runs against a Store holding several obtainable projects
- **THEN** no project is obtained, no checkout is registered, and nothing is written

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
