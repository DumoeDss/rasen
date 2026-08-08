# session-runtime-context Specification

## Purpose

Make a session carry the answer it already worked out — where planning lives, which project is being worked on, and which checkout on this machine that is — and make every command run inside the session read that answer instead of re-deriving it from the working directory. Covers what the session records, the session-local context handed to its child process, the order any command resolves context in, what happens when a resumed run disagrees with its checkout, the file capability a session grants, and the planning-only restriction as the user and the agent see it.
## Requirements
### Requirement: A session records where it plans and where it executes

A session SHALL record, together, the planning space it belongs to, the project it is working on, and the exact checkout of that project on this machine. Recording the working directory alone SHALL NOT be sufficient. A session that plans in a Store without working on any project SHALL record that explicitly rather than by omission. All of this SHALL be machine-local: it SHALL NOT be written into any Git-tracked file of the project or the Store, and it SHALL be discarded when the session ends.

#### Scenario: A Store session records the project it will work on

- **WHEN** a user starts a session that plans in a Store and works on one of its projects
- **THEN** the session records the planning Store, the project's identity, and the exact checkout selected on this machine
- **AND** all three remain available for the whole life of the session

#### Scenario: A planning-only session records that it works on no project

- **WHEN** a user starts a Store session and chooses to plan only
- **THEN** the session records that it works on no project, as an explicit fact rather than a missing field

#### Scenario: The exact checkout is preserved, not re-derived

- **WHEN** the selected checkout is one of several clones of the same project, or a linked worktree
- **THEN** the session records that exact root
- **AND** later commands in the session use it without re-deriving which clone was meant

#### Scenario: Nothing about the session reaches Git

- **WHEN** a session records its planning and execution context
- **THEN** no file tracked by the project's or the Store's repository is created or modified
- **AND** the recorded roots exist only in machine-local state

### Requirement: The child process is handed its context by location, never by value

A session's agent process SHALL be told where to find its session context, and SHALL NOT be passed the context's contents in its environment. The context SHALL live in a machine-local file that may contain absolute paths, because it is never shared and never enters Git. The file SHALL be written completely before the agent starts, SHALL be removed when the session ends, and SHALL carry a version so a future shape can be distinguished from the current one. A reader that is pointed at a context file which is missing, unreadable, or does not match the session it claims SHALL report that plainly and SHALL NOT quietly fall back to deriving the context from the working directory.

#### Scenario: The agent receives a location, not a document

- **WHEN** a session's agent process is started
- **THEN** its environment carries the location of the session context file
- **AND** the context's contents do not appear in any environment variable

#### Scenario: The context is complete before the agent starts

- **WHEN** the agent process starts
- **THEN** the session context file is already fully written
- **AND** a reader never observes a partially written file

#### Scenario: A broken context is reported, not worked around

- **WHEN** a command inside a session is pointed at a context file that is missing, unparseable, or names a different session
- **THEN** the command reports the broken session context and what to do about it
- **AND** it does not silently resolve its context from the working directory instead

#### Scenario: The context file does not outlive its session

- **WHEN** a session ends for any reason, including being killed
- **THEN** its context file is removed
- **AND** a context file left behind by an earlier crash has no effect on any later session

#### Scenario: Absolute paths are allowed only here

- **WHEN** the session context file records the planning root and the execution checkout
- **THEN** those absolute paths are permitted in this file on every platform
- **AND** the same identities recorded anywhere durable carry no filesystem path

### Requirement: A command resolves its context in one stated order

For the first command in a session, context SHALL be resolved in this order and no other: an explicit selector given on the command; then the session's own context; then, only when neither applies, the working directory and the pointer nearest to it. A later step SHALL NOT be consulted once an earlier one has answered, and no step SHALL be skipped because a later one looks more convenient.

#### Scenario: An explicit selector wins over the session context

- **WHEN** a command inside a session names its target explicitly
- **THEN** the explicit target is used, even when the session context names a different one

#### Scenario: The session context wins over the working directory

- **WHEN** a command inside a session gives no explicit target
- **THEN** the session's recorded context is used
- **AND** the working directory and its nearest pointer are not consulted

#### Scenario: The working directory is the last resort

- **WHEN** a command runs with no explicit target and no session context
- **THEN** the working directory and its nearest pointer resolve the context, exactly as before this capability existed

#### Scenario: A subprocess in a Store session does not fall back to the project's own Store

- **WHEN** a session plans in Store B while the project being worked on names Store A as its own planning Store
- **THEN** commands inside that session resolve planning to Store B
- **AND** they do not re-derive Store A from the checkout's own declaration

### Requirement: A resumed run is addressed by its frozen identity and fails closed on disagreement

When work is resumed from a frozen run, the identity recorded in that run SHALL be the authority for which project the work belongs to. The session context, or failing that the current checkout, SHALL serve only as the local address of that project, and an explicit selector SHALL only cross-check rather than retarget the run. When the frozen project identity does not match the identity of the checkout the session is executing in, the command SHALL fail, naming both identities and the checkout, and SHALL NOT continue in another clone of the same project. When there is no session context, the current directory SHALL be used only if its own identity matches the frozen one; failing that, a single registered checkout for that project SHALL be used; and when several match, the command SHALL report the ambiguity and list the candidates. Identity and path comparison SHALL be canonical, so a checkout differing only by drive-letter case or path separator form is recognized as the same checkout on every platform.

#### Scenario: A resumed run uses its frozen identity

- **WHEN** a run frozen against one project is resumed inside a session working on that project
- **THEN** the run continues against the frozen project, located through the session's recorded checkout

#### Scenario: A mismatch stops the run instead of choosing a clone

- **WHEN** a resumed run's frozen project does not match the identity of the session's execution checkout
- **THEN** the command fails, naming the frozen project, the checkout's identity, and the checkout path
- **AND** it does not continue in any other clone of the frozen project

#### Scenario: An explicit selector cannot retarget a frozen run

- **WHEN** a resumed run is given an explicit selector naming a different project
- **THEN** the command reports the disagreement and does not retarget the run

#### Scenario: Without session context, a matching working directory is used

- **WHEN** a run is resumed with no session context and the current directory's identity matches the frozen project
- **THEN** the current directory is used as the run's checkout

#### Scenario: Without session context, a single registered checkout is used

- **WHEN** a run is resumed with no session context, the current directory does not match, and exactly one registered checkout has the frozen project's identity
- **THEN** that checkout is used

#### Scenario: Several candidate checkouts are reported as ambiguous

- **WHEN** a run is resumed with no session context and several registered checkouts carry the frozen project's identity
- **THEN** the command reports the binding as ambiguous and lists every candidate checkout
- **AND** it does not choose one

#### Scenario: Checkout comparison is canonical on Windows

- **WHEN** the frozen run's recorded checkout and the session's checkout name the same location but differ in drive-letter case or path separator form
- **THEN** they are recognized as the same checkout and no mismatch is reported on that basis

### Requirement: A session states which roots it may write for planning, which for code, and which it may only read

A session's file capability SHALL state separately the roots it may write planning artifacts to, the roots it may write code to, and the roots it may only read, together with the constraints an agent is expected to respect. Planning write access SHALL be narrowed to the planning directories rather than granting a whole repository root. A session working on a project SHALL have exactly that one checkout as its code write root; the other member checkouts of the same Store SHALL NOT appear. No home directory SHALL appear in any of the three lists. Making a root visible to the agent process SHALL NOT by itself grant permission to write it.

#### Scenario: Store planning with project execution separates the three lists

- **WHEN** a session plans in a Store and works on one of its projects
- **THEN** its planning write roots are the Store's planning directories, its code write root is the selected checkout, and both roots are readable

#### Scenario: Other member checkouts are never writable

- **WHEN** the Store has several member projects with checkouts on this machine
- **THEN** only the selected checkout appears as a code write root
- **AND** no other member's checkout appears in any write list

#### Scenario: No home directory is ever granted

- **WHEN** a session's file capability is computed for any session shape
- **THEN** no user home directory appears in the planning write, code write, or read lists

#### Scenario: Planning writes are narrowed to the planning directories

- **WHEN** planning write access is granted for a root
- **THEN** the granted paths are that root's specs and changes directories rather than the repository root itself

#### Scenario: Visibility is not permission

- **WHEN** a root is made visible to the agent process without being granted for writing
- **THEN** the file capability does not list it as a write root

### Requirement: A planning-only session can write no code, and says so

A planning-only session SHALL have an empty set of code write roots — empty as a stated fact, not as a discouragement — and SHALL be able to write planning artifacts in its Store. The restriction SHALL be visible where the user launches the session and in the instructions the agent reads, so neither has to infer it. Project-scoped materialization SHALL NOT occur for such a session.

#### Scenario: Planning-only grants no code write root

- **WHEN** a planning-only Store session's file capability is computed
- **THEN** its code write roots are empty
- **AND** its planning write roots are the Store's planning directories

#### Scenario: Planning artifacts still work

- **WHEN** an agent in a planning-only session creates or edits planning artifacts in the Store
- **THEN** those operations succeed exactly as they would in any Store session

#### Scenario: The restriction is stated at launch

- **WHEN** a user chooses a planning-only run
- **THEN** the launch surface states that the run will not modify any project's code

#### Scenario: The restriction is stated to the agent

- **WHEN** an agent in a planning-only session reads its instructions
- **THEN** the instructions state that no code write root is available and that no project-scoped materialization will occur

### Requirement: A compatibility view of the older capability shape never grants more than before

Consumers reading the older single-list form of a session's file capability SHALL continue to work, and the compatibility view SHALL never grant a root that the older form would not have granted for the same session. Where the newer capability cannot be projected into the older form without widening it, the reported version SHALL change so that a consumer of the older form recognizes an unfamiliar contract and stops, rather than inheriting access it did not ask for.

#### Scenario: The compatibility view is never broader

- **WHEN** the compatibility view is computed for any session shape
- **THEN** every root it lists would also have been granted by the older form for that same session

#### Scenario: An unprojectable capability changes its reported version

- **WHEN** a session's capability cannot be expressed in the older form without granting more than before
- **THEN** the reported version identifies the newer contract
- **AND** a consumer expecting only the older form does not proceed with a widened root list

#### Scenario: Planning-only projects to no writable root

- **WHEN** the compatibility view is computed for a planning-only session
- **THEN** it grants no code root

### Requirement: Choosing a project to work on in a Store session is validated before the session starts

Before a Store session begins working on a project, the system SHALL confirm that the Store resolves and is healthy, that the chosen checkout exists on this machine, that the checkout's own recorded identity is the project that was chosen, and that the Store vouches for that project. The Store SHALL be taken to vouch for the project ONLY when the Store's own membership record for that project is present and readable: the record under the Store's metadata directory named by the project's permanent identity, normalized by the single membership provider together with any legacy sources it already understands. The project's own durable Store declaration is a LOCATOR and SHALL NOT vouch for the project on its own — a declaration that resolves to this Store but for which no Store record exists SHALL be rejected, never silently granted. The declaration MAY be consulted after the rejection is decided, ONLY to shape the diagnostic: when the declaration resolves to this Store the rejection SHALL carry a legacy-migration marker naming the missing record and stating that the project's own declaration used to be sufficient before this Store recorded it, with the copy-pasteable repair command (`rasen store add-project <projectId> --store <storeId>`); when the declaration is absent, malformed, or resolves to a different Store the rejection SHALL name the missing record and the same repair command without the legacy marker. A project whose own default planning Store is a different Store SHALL remain a valid choice once the session's Store records it, because the session records its planning Store explicitly. A failure at any step SHALL prevent the session from starting and SHALL name which check failed and the command that repairs it.

#### Scenario: A valid choice starts the session

- **WHEN** a user chooses a project that the Store's membership record permits, whose checkout exists and carries that project's identity
- **THEN** the session starts with that project as its execution target

#### Scenario: A project the Store records only by its own declaration is rejected

- **WHEN** the chosen project's own durable Store declaration resolves to this Store but the Store has no membership record for it
- **THEN** the session does NOT start — the declaration alone does not vouch for the project
- **AND** the failure carries the legacy-migration marker, names the missing membership record, and prints the `rasen store add-project` command that establishes it
- **AND** the declaration is not used to vouch for the project

#### Scenario: A checkout that is not that project is rejected

- **WHEN** the chosen checkout's own recorded identity is a different project
- **THEN** the session does not start and the failure names the identity mismatch

#### Scenario: A project the Store does not have as a member is rejected

- **WHEN** the Store's membership record does not name the chosen project
- **THEN** the session does not start and the failure names the missing membership and the command that adds it
- **AND** a declaration that names a different Store, one that cannot be resolved on this machine, or no declaration at all, does not vouch for the project
- **AND** the rejection message distinguishes the case where the project's own declaration names this Store (legacy declaration-only install) from the case where it does not, so the user knows whether running `rasen store add-project` is the only remaining step

#### Scenario: A project that plans elsewhere is still a valid choice

- **WHEN** the chosen project's own default planning Store is a different Store from the one the session plans in, and the session's Store records the project
- **THEN** the session starts, planning in the session's Store
- **AND** commands inside the session do not revert to the project's own planning Store

#### Scenario: An unavailable Store stops the session before it starts

- **WHEN** the session's planning Store cannot be resolved on this machine
- **THEN** the session does not start, and the failure carries the reason and a copy-pasteable repair command

### Requirement: A Store whose members have no checkout here is distinguished from a Store with no members

Where a user chooses what to work on in a Store session, the launch surface SHALL
tell apart three situations and state each one plainly: the Store has member
projects that can be worked in; the Store has member projects but none of them
has a checkout on this machine; and the Store has no member projects at all. A
member listed without a checkout on this machine SHALL be shown as a member,
SHALL NOT be selectable, and SHALL carry wording saying that it cannot be worked
in because no checkout of it exists on this machine. The wording for "no member
has a checkout here" SHALL NOT claim that the Store has no members, since that
misstates what the user needs to fix. Every message this requirement introduces
SHALL be available in each language the interface supports.

#### Scenario: A member with no local checkout says why it cannot be chosen

- **WHEN** a Store member has no checkout on this machine
- **THEN** it SHALL still be listed as a member of the Store
- **AND** it SHALL NOT be selectable as a place to work
- **AND** it SHALL state that no checkout of it exists on this machine

#### Scenario: Members without checkouts are not reported as no members

- **WHEN** a Store has member projects and none of them has a checkout on this machine
- **THEN** the surface SHALL state that the Store's members have no checkout on this machine
- **AND** it SHALL NOT state that the Store has no member projects

#### Scenario: A Store with no members is unchanged

- **WHEN** a Store has no member projects at all
- **THEN** the surface SHALL state that the Store has no member projects, as before

#### Scenario: A member that can be worked in is unaffected

- **WHEN** a Store member has a checkout on this machine
- **THEN** it SHALL be selectable as a place to work, exactly as before

#### Scenario: The distinction is available in every supported language

- **WHEN** the interface is displayed in any language it supports
- **THEN** the wording for a member without a local checkout, and the wording for a Store whose members have no checkout here, SHALL both be available in that language

### Requirement: A Store session freezes its complete planning and execution worktree pair

A session that plans in a Store and executes in a project checkout SHALL freeze the complete pair, not just the two roots: each side's worktree root, its worktree instance identity, its checked-out ref, and its HEAD commit OID, together with the Change instance and workspace pair identities when the workspace is bound. Facts that do not exist SHALL be absent rather than null or guessed, and a planning-only session SHALL record no pair. A command inside the session SHALL use the frozen pair and SHALL NOT re-derive it from the working directory. When a recorded worktree has been removed, moved, or switched to another ref, the command SHALL fail naming the frozen and live values rather than continuing in whatever the working directory resolves to. A mutation that requires the pair SHALL fail when the session records none. The frozen pair SHALL remain machine-local, SHALL NOT be written into any Git-tracked file, and SHALL be removed when the session ends. The context file version SHALL be raised so that a file written by an earlier version is reported as an unsupported version rather than read partially.

#### Scenario: The pair is frozen once and reused

- **WHEN** a session starts against a bound workspace and several commands run inside it
- **THEN** each command SHALL use the frozen planning and execution worktrees, their instance identities, and the pair identity
- **AND** none of them SHALL re-derive the pair from the working directory

#### Scenario: A planning-only session records no pair

- **WHEN** a session plans in a Store and works on no project
- **THEN** the context SHALL record no workspace pair as an explicit state
- **AND** a mutation requiring the pair SHALL fail rather than resolving one from the working directory

#### Scenario: A worktree that moved fails the command

- **WHEN** a recorded worktree is removed, relocated, or switched to another ref while the session is live
- **THEN** the next command SHALL fail, naming the frozen values and the live ones
- **AND** it SHALL NOT continue in another checkout of the same project or in the Store integration checkout

#### Scenario: An older context file is reported, not partially read

- **WHEN** a session context file written by an earlier version is read by a build that freezes the pair
- **THEN** the reader SHALL report an unsupported context version and what to do about it
- **AND** it SHALL NOT parse a subset of the file or fall back to deriving the context from the working directory

#### Scenario: Nothing about the pair reaches Git

- **WHEN** a session freezes its worktree pair
- **THEN** no file tracked by the project's or the Store's repository SHALL be created or modified
- **AND** the frozen pair SHALL exist only in machine-local state and SHALL be removed when the session ends

