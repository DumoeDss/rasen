## MODIFIED Requirements

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
