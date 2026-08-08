# store-project-membership Specification

## Purpose

Make Store membership a first-class relation with its own authority: one record per member project inside the Store, named and keyed by the project's permanent identity, stating separately whether the project plans in the Store and shares knowledge with it. Give the project portable locator hints so a fresh clone can find its Stores, answer every membership question from one provider that also understands legacy data, keep machine-specific paths out of Git, and make the two-repository mutations previewable, ordered, and repairable.
## Requirements
### Requirement: A Store records each member project in its own file, keyed by project identity

A Store SHALL record membership as one file per member project, named by that project's permanent identity, under the Store's metadata directory. The record SHALL be the single authority for whether a project belongs to the Store, and no other source — including the project's own durable Store declaration — SHALL confer membership or grant Store-scoped Session eligibility. A project whose declaration names a Store but for which no Store record exists SHALL be rejected from Store-scoped sessions with a diagnostic that names the missing record and the copy-pasteable repair command (`rasen store add-project <projectId> --store <storeId>`); the declaration MAY shape that diagnostic but SHALL NOT itself decide eligibility. The project identity inside the record SHALL be the authority for which project it describes, and the file's name SHALL agree with it — a disagreement SHALL be reported as an error rather than resolved by preferring either one. The display id in the record SHALL be for reading only, and a recorded remote SHALL be credential-free. Two people adding two different projects to the same Store SHALL write two different files.

The record's schema SHALL follow the Store's declared planning layout: a Store that has not declared layout version 2 uses the legacy membership record, and a Store declaring layout version 2 uses the v2 project catalog, which carries the project's roles and its planning binding and carries no adopted spec or change name list. Readers SHALL choose the schema from the Store's declared layout version and SHALL NOT infer it from the file's contents, so a partially written file can never be read as the other schema. Only the explicit layout migration SHALL convert a record from one schema to the other.

The project's permanent identity SHALL be the only identifier either schema validates as one. The recorded display name SHALL be treated as a human label in both schemas, SHALL NOT be constrained to an identifier form, and SHALL be accepted by the v2 project catalog wherever the legacy record accepts it — a migration SHALL NOT block on a value the schema it migrates from accepted.

#### Scenario: Membership is recorded per project

- **WHEN** a project is added to a Store
- **THEN** the Store gains one membership record file for that project alone
- **AND** the record names the project by its permanent identity, not by its display name

#### Scenario: Two projects added on two machines do not collide

- **WHEN** two people each add a different project to the same Store and both commit
- **THEN** each addition wrote a separate file, and merging the two requires no conflict resolution

#### Scenario: A record whose name disagrees with its contents is rejected

- **WHEN** a membership record file is named for one project identity but declares a different one inside
- **THEN** reading the Store's membership reports an error naming the file and both identities
- **AND** neither identity is silently treated as authoritative

#### Scenario: A project identity that cannot safely name a file is refused

- **WHEN** a project's identity is not a well-formed identifier, or is a name a filesystem reserves
- **THEN** writing a membership record for it fails, naming the project and the reason
- **AND** the identity is never altered to make it fit a filename

#### Scenario: Record filenames are legal on Windows

- **WHEN** membership records are written and read back on Windows
- **THEN** every record file resolves under the Store's metadata directory using platform path resolution
- **AND** no accepted project identity can produce a filename Windows rejects

#### Scenario: A declaration alone does not establish Session eligibility

- **WHEN** a project's own durable Store declaration resolves to this Store but the Store has no membership record for that project
- **THEN** Store-scoped session eligibility for that project is denied
- **AND** the rejection diagnostic names the missing record and prints the `rasen store add-project` command that establishes it
- **AND** the project's declaration is not used to grant eligibility, only to shape the diagnostic

#### Scenario: The record schema follows the declared layout

- **WHEN** membership is read from a Store declaring layout version 2 and from a Store that has not
- **THEN** the first is read as a v2 project catalog and the second as the legacy membership record
- **AND** neither is chosen by inspecting the file's own version field

#### Scenario: A recorded display name never blocks the migration

- **WHEN** a membership record carries a display name that is not an identifier, such as `Elftia` or `my app`
- **THEN** the layout migration plans and applies, carrying the name forward unchanged
- **AND** the v2 project catalog accepts it, because the permanent identity is the only identifier either schema validates

#### Scenario: A legacy record inside a partitioned Store is a finding

- **WHEN** a Store declares layout version 2 and one member file is still the legacy record
- **THEN** it is reported as a diagnostic naming the file and the migration command
- **AND** it is not silently accepted as a second valid membership schema

### Requirement: Membership states what it is for, and never states where work is executed

A membership record SHALL express planning membership and knowledge membership as separate, independently readable facts, so that "this project plans in the Store" and "this project shares knowledge with the Store" are never the same claim. Membership SHALL express roster and eligibility only. It SHALL NOT determine, imply, or be presented as the decision of where a change is implemented. When membership roles are inferred from legacy data rather than declared, the inference SHALL be reported.

#### Scenario: A knowledge-only member is expressible

- **WHEN** a project is recorded as a knowledge member of a Store but not a planning member
- **THEN** membership reports it as a knowledge member and not a planning member
- **AND** the project's own planning binding is unaffected

#### Scenario: A planning-only member is expressible

- **WHEN** a project is recorded as a planning member but not a knowledge member
- **THEN** membership reports exactly that, with no ambiguity about which role applies

#### Scenario: Roles inferred from legacy data are labelled

- **WHEN** membership is derived from legacy adoption data that declares no roles
- **THEN** the reported roles state that they were inferred rather than declared
- **AND** knowledge membership is not asserted on the strength of an adoption alone

#### Scenario: Membership does not decide execution

- **WHEN** a user reads the membership documentation or a membership record
- **THEN** it states that membership expresses roster and eligibility only
- **AND** it does not present any role as deciding where a change is implemented

### Requirement: A project carries portable locator hints for the Stores it belongs to
A project SHALL be able to record, in its own configuration, a list of the Stores it belongs to — each named by permanent identity, display alias, and a credential-free remote — so that a fresh clone of the project can discover those Stores. These hints SHALL be locators only and SHALL NOT confer membership: the Store's own record remains the authority. A malformed hint SHALL be dropped with a warning while every other hint survives. Nothing machine-specific SHALL be written into these hints on any platform.

The hint list is itself a read-modify-write over the project's shared configuration YAML. Two concurrent Rasen commands appending hints for DIFFERENT Stores SHALL both take effect: each SHALL re-read the list under an owner-aware lock and append its own entry next to the other's, rather than replacing the list with a snapshot taken before the other's write. A hint appended concurrently with another for the SAME Store (same permanent identity) SHALL NOT produce a duplicate — the existing identity-keyed deduplication SHALL run under the same lock. The lock SHALL be owner-aware, with the same contract as the Store's authority record lock, and SHALL NOT live inside the project's repository.

#### Scenario: Hints let a fresh clone name its Stores

- **WHEN** a project declaring membership hints is cloned onto a machine that has never seen those Stores
- **THEN** the project can report which Stores it belongs to and how to obtain each one
- **AND** no Store is contacted, cloned, or registered in the process

#### Scenario: A hint alone is not membership

- **WHEN** a project declares a hint for a Store that has no record for this project
- **THEN** the project is not reported as a member of that Store
- **AND** the discrepancy is reported as a diagnostic

#### Scenario: A malformed hint degrades to a warning

- **WHEN** one entry in the hint list cannot be read as a Store reference
- **THEN** that entry is dropped with a warning and the remaining entries are used

#### Scenario: Hints contain no machine paths

- **WHEN** a command writes or refreshes a project's membership hints
- **THEN** the written entries contain only the permanent identity, the display alias, and a credential-free remote
- **AND** no filesystem path from this machine appears in the file, on any platform

#### Scenario: Concurrent appends of hints for different Stores both survive

- **WHEN** two Rasen commands run concurrently, each appending a locator hint for a different Store to the same project's configuration
- **THEN** the final hint list contains both appended entries alongside any entries that were present before
- **AND** neither append is silently lost to the other

#### Scenario: Concurrent idempotent re-appends of the same hint do not duplicate

- **WHEN** two Rasen commands run concurrently, each appending a locator hint for the SAME Store (same permanent identity) to the same project's configuration
- **THEN** the final hint list contains exactly one entry for that Store
- **AND** the lock ensures the deduplication check runs against the up-to-date list, not a stale snapshot

#### Scenario: The hint lock is not committed to the project repository

- **WHEN** a hint append holds a lock during its read-modify-write
- **THEN** the lock file lives outside the project repository
- **AND** the suggested commit command for the project repository does not include the lock file in its pathspec

### Requirement: Membership is answered by one provider that understands legacy data

Every surface that asks which projects belong to a Store, or which Stores a project belongs to, SHALL get its answer from one membership provider. The provider SHALL normalize current records and legacy data — a Store's referenced-project entries, its legacy adoption data, and the machine's project namespace — into a single shape that reports, for each member, the Store, the project identity, the roles, and which source the answer came from. A current record SHALL take precedence over any legacy source for the same project. New membership SHALL be written only as per-project records.

#### Scenario: Records and legacy data answer through one shape

- **WHEN** a Store carries both current membership records and legacy adoption data
- **THEN** membership is reported once per project, in one shape, each entry stating which source it came from

#### Scenario: A current record wins over legacy data

- **WHEN** a project appears both as a current record and in legacy adoption data
- **THEN** the current record's roles and details are what membership reports
- **AND** the legacy entry does not produce a second member

#### Scenario: An unmappable legacy reference is reported, not dropped

- **WHEN** a Store references a project by display name that cannot be mapped to a project identity on this machine
- **THEN** membership reports it as an unresolved legacy reference with its repair command
- **AND** it is neither silently discarded nor guessed into a project identity

#### Scenario: Reading membership never writes

- **WHEN** any read-only command reads a Store's membership, including one carrying only legacy data
- **THEN** the Store's files, the project's files, and the machine registries are all left byte-identical

### Requirement: A project's eligible Stores include those declared and those recorded, and an unavailable Store is not an empty one

The set of Stores a project is eligible to draw on SHALL be the union of the Stores the project declares hints for and the locally available Stores whose records include that project. A declared Store that is not available on this machine SHALL be reported as unavailable with its reason and repair, and SHALL NOT be omitted from the answer — an unavailable Store SHALL never be reported as one that simply has nothing to offer.

#### Scenario: Eligibility is the union of both sides

- **WHEN** a project declares a hint for Store A and Store B has a record for the project but the project declares no hint for it
- **THEN** both A and B are reported as eligible Stores for that project

#### Scenario: An unavailable declared Store is reported, not dropped

- **WHEN** a project declares a hint for a Store that is not available on this machine
- **THEN** that Store appears in the answer marked unavailable, with the reason and a copy-pasteable repair command
- **AND** it is not reported as available-and-empty

#### Scenario: A locally recorded member needs no project-side hint to be eligible

- **WHEN** a Store available on this machine records the project as a knowledge member and the project declares no hint for it
- **THEN** the Store is reported as eligible
- **AND** a diagnostic notes that the missing hint would break discovery on another machine

### Requirement: Adding membership writes each repository in a defined order and reports what still needs repair
A command that establishes membership SHALL write the Store's authority record first, verify it, then write the project's locator hint, then verify both sides agree. It SHALL NOT claim the two repositories change atomically: the result SHALL report what was written to each repository, and anything still needing repair with a copy-pasteable command. When the project-side write fails after the Store record was written, the Store record SHALL be kept — never rolled back — and the missing hint SHALL be reported as repair work. The command SHALL support a preview that changes nothing, SHALL write files atomically, and SHALL NOT stage, commit, push, pull, or fetch in either repository.

The Store's per-project authority record is itself a read-modify-write over shared YAML: a single record carries roles, adoption, remote, and knowledgeBundle as independent fields. Two concurrent Rasen commands mutating different fields of the SAME project's record SHALL both take effect — the second writer SHALL re-read the record under the same owner-aware lock the first writer held, and SHALL compose its field onto the now-first-writer's base rather than onto a stale snapshot. Neither writer SHALL silently clobber a field the other wrote. The lock SHALL be owner-aware: the holder is identified by a unique token, the lock is treated as abandoned only when the holder process is provably no longer alive (never on a wall-clock heuristic alone), and release SHALL delete the lock only if its current contents match the holder's token. A lock file SHALL NOT be committed to either repository.

#### Scenario: Preview changes nothing

- **WHEN** a membership mutation is run in preview mode
- **THEN** it reports every file it would write in each repository and changes nothing

#### Scenario: The Store record is written and verified before the project hint

- **WHEN** a membership mutation applies successfully
- **THEN** the Store's record exists and reads back correctly before the project's hint is written
- **AND** the result lists the files written in each repository

#### Scenario: A failed project write leaves the Store record standing

- **WHEN** the Store record is written and verified but the project-side hint cannot be written
- **THEN** the Store record is kept, not undone
- **AND** the result reports the missing hint as repair work with the command that completes it

#### Scenario: Neither repository is committed automatically

- **WHEN** a membership mutation completes
- **THEN** it prints a suggested, path-scoped commit command for each affected repository
- **AND** it has staged, committed, pushed, fetched, and pulled nothing

#### Scenario: Concurrent mutations of different fields on the same project record both survive

- **WHEN** two Rasen commands run concurrently against the same project's membership record, one adding a knowledge role and the other setting adoption
- **THEN** the final record carries BOTH the knowledge role AND the adoption field
- **AND** neither writer silently lost its change to the other

#### Scenario: Concurrent mutations of different projects on the same Store proceed independently

- **WHEN** two Rasen commands run concurrently against two different project records in the same Store
- **THEN** each acquires its own per-record lock and neither blocks the other
- **AND** both records are written as if the other command had not run

#### Scenario: A lock holder that is slow but alive is not treated as stale

- **WHEN** a Rasen command holds the per-project record lock for longer than any fixed wall-clock threshold while still actively running
- **THEN** a second command attempting to mutate the same record waits until the holder releases or until its own configured timeout
- **AND** the second command SHALL NOT delete the holder's lock based on time alone

#### Scenario: A lock whose holder process has died is recoverable

- **WHEN** the process holding a per-project record lock has provably exited and a new Rasen command attempts to mutate the same record
- **THEN** the new command detects the holder is no longer alive and acquires the lock
- **AND** it does not require manual intervention to proceed

#### Scenario: The lock file is not committed to either repository

- **WHEN** a membership mutation holds a lock during its read-modify-write
- **THEN** the lock file lives outside both the Store repository and the project repository
- **AND** neither suggested commit command includes the lock file in its pathspec

### Requirement: Git-shared membership data carries no machine-specific path

No command SHALL write a filesystem path from the current machine into any file that lives in a Store's or a project's Git repository. Existing shared data that still carries such a path SHALL remain readable, SHALL be reported by diagnostics, and its recorded path SHALL NOT influence the behavior of any command. This SHALL hold on every platform.

#### Scenario: Newly written shared data has no machine path

- **WHEN** membership records, membership hints, or adoption ownership are written
- **THEN** none of the written values is a filesystem path from this machine, on any platform

#### Scenario: A legacy machine path is reported and ignored

- **WHEN** a Store still carries legacy shared data recording an absolute path from the machine that created it
- **THEN** the data is still readable, a diagnostic names the file and the problem with its repair command
- **AND** no command changes what it does because of that recorded path

### Requirement: Legacy membership data is converted only by an explicit, previewable migration

Converting a Store's legacy membership data into per-project records, and converting those records into v2 project catalogs as part of the Store's planning layout migration, SHALL happen only when the user explicitly runs the migration. The migration SHALL offer a preview that changes nothing, SHALL be safe to run more than once, and SHALL keep the legacy data until every record it produced has been written and read back successfully. A project it cannot resolve SHALL be reported and left untouched rather than guessed at. Once the records are verified, the legacy data SHALL be removed and the removal SHALL be reported for the user to commit.

When a record is converted into a v2 project catalog, its roles SHALL be carried over unchanged, its planning binding SHALL be derived only from adoption evidence or a proven pointer-without-local-planning binding and never from membership alone, and its adopted spec and change name lists SHALL be dropped from the catalog and preserved verbatim in the committed migration receipt. A recorded value that cannot satisfy the stricter v2 catalog contract SHALL block the conversion, naming the record and the field, and SHALL NOT be rewritten to make it fit; the reported repair SHALL state what the operator must change the value to, not which validator rejected it.

Once a Store declares planning layout version 2 its legacy membership data is already converted, so the legacy membership migration SHALL report that and do nothing. It SHALL NOT read that Store's project catalogs through the legacy record schema, and SHALL NOT report a valid project catalog as an invalid membership record or advise removing it.

#### Scenario: Preview reports the plan and writes nothing

- **WHEN** the membership migration runs in preview mode against a Store with legacy data
- **THEN** it lists every record it would create and every legacy file it would remove, and changes nothing

#### Scenario: Legacy data survives until the records are verified

- **WHEN** the migration applies and a record cannot be written or read back
- **THEN** the legacy data is still present and unmodified
- **AND** the failure names the project and the file

#### Scenario: The legacy membership migration leaves a migrated Store alone

- **WHEN** the legacy membership migration runs against a Store that already declares planning layout version 2
- **THEN** it converts nothing, writes nothing, and reports that the Store's membership is already recorded as project catalogs
- **AND** it reports no error against those catalogs and never advises removing one

#### Scenario: Re-running the migration is safe

- **WHEN** the migration is applied a second time against an already-migrated Store
- **THEN** it reports that there is nothing left to convert and writes nothing

#### Scenario: An unresolvable project is left alone

- **WHEN** legacy data references a project whose identity cannot be determined on this machine
- **THEN** the migration reports it, converts the projects it can, and leaves the unresolved entry untouched

#### Scenario: Adoption data becomes a binding and a receipt entry

- **WHEN** a record carrying adoption data is converted into a v2 project catalog
- **THEN** the catalog declares a bound planning binding with a canonical timestamp and carries no name list
- **AND** the dropped spec and change names are preserved in the committed migration receipt

#### Scenario: Membership without adoption stays unbound

- **WHEN** a record declaring only a knowledge role is converted
- **THEN** its catalog declares the planning binding unbound

### Requirement: Membership diagnostics are read-only and name the repair

`rasen doctor` and `rasen store doctor` SHALL report membership health: a project whose planning Store has no record for it, a Store record with no matching project-side hint, a project-side hint whose Store cannot be verified on this machine, a machine path still present in Git-shared data, a record whose filename and identity disagree, a legacy reference that cannot be mapped, and a Store whose legacy data has not been migrated. Each finding SHALL carry a stable code, name the affected file or project, and carry a copy-pasteable repair command. These commands SHALL write nothing, contact no network, and repair nothing. Human and JSON output SHALL report the same codes and the same repair commands.

#### Scenario: A missing Store record for the planning Store is an error

- **WHEN** a project's planning Store is available but has no membership record for that project
- **THEN** doctor reports an error naming the project, the Store, and the command that adds the record

#### Scenario: A missing project-side hint is a warning

- **WHEN** a Store records a project as a member but the project declares no hint for that Store
- **THEN** doctor warns that discovery would fail on another machine and names the command that adds the hint

#### Scenario: An unverifiable hint is reported distinctly

- **WHEN** a project declares a hint for a Store that is not available on this machine
- **THEN** doctor reports that the membership cannot be verified here, distinctly from a Store that is present and missing the record

#### Scenario: Diagnosis writes nothing

- **WHEN** doctor reports any membership finding
- **THEN** no file under the project, the Store, or the machine data directory is modified

#### Scenario: Human and JSON diagnostics agree

- **WHEN** the same project is diagnosed once in human mode and once with `--json`
- **THEN** both report the same diagnostic codes and the same repair commands

