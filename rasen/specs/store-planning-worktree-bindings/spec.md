# store-planning-worktree-bindings Specification

## Purpose
TBD - created by archiving change store-worktree-bindings-v2. Update Purpose after archive.
## Requirements
### Requirement: A Change workspace is prepared through an immutable plan and a revalidated token

Preparing a Change workspace SHALL be two steps. Planning SHALL write nothing, SHALL be total — it
reports every problem it finds rather than stopping at the first — and SHALL produce an immutable plan
addressed by a token derived from the plan's own content. Applying SHALL consume only that token: it
SHALL NOT re-read the current working directory, the selectors that produced the plan, or any live
state the plan already froze.

#### Scenario: Planning writes nothing and reports every problem

- **WHEN** an operator plans a workspace whose target line is unresolvable AND whose destination is occupied
- **THEN** both problems are reported in one result
- **AND** no file, worktree, lock, or index entry is created anywhere

#### Scenario: Equal inputs produce an identical plan

- **WHEN** the same selectors and the same live Git state are planned twice
- **THEN** both plans carry the same token
- **AND** that token equals the value pinned for those exact inputs, so a change to how a plan is
  addressed is visible rather than absorbed

#### Scenario: Apply consumes only the token

- **WHEN** a plan is applied after the operator has changed directory and altered the selectors
- **THEN** the applied result matches the plan
- **AND** neither the new directory nor the new selectors influence what is created

### Requirement: Applying revalidates Git preconditions and creates worktrees from frozen commits

Applying SHALL revalidate every Git precondition the plan recorded — the target line's Store ref and
code ref, and the head commit of every reused worktree — and SHALL create new worktrees from the
recorded commit identity rather than from a ref name. A ref that moved between planning and applying
SHALL invalidate the plan rather than silently retarget it. An interrupted apply SHALL leave no
partially created worktree behind that a later apply cannot account for.

#### Scenario: A moved ref invalidates the plan

- **WHEN** the target line's Store ref advances between planning and applying
- **THEN** applying refuses as stale, naming the recorded and live commit identities
- **AND** no worktree is created at the moved position

#### Scenario: An interrupted apply leaves no orphan

- **WHEN** applying is interrupted after creating the first worktree
- **THEN** re-applying the same token either completes the same pair or refuses with a named conflict
- **AND** no unaccounted worktree remains

#### Scenario: Nothing outside the planned roots is written

- **WHEN** a plan is applied successfully
- **THEN** the only paths created or modified inside either repository are the two planned worktree roots
- **AND** the Store integration checkout and the project's main checkout are untouched

### Requirement: Planning and execution worktrees carry verified local identities

Each side of a pair SHALL carry a worktree identity derived from canonical repository and canonical
physical worktree identity. Different spellings of one location — a case alias on a
case-insensitive filesystem, a short path, a symbolic link, a trailing separator — SHALL resolve to
one identity on Windows, macOS, and Linux alike. Two worktrees of one repository SHALL stay distinct.
A location that cannot be canonicalized SHALL be refused rather than guessed.

#### Scenario: Path aliases resolve to one worktree identity

- **WHEN** the same worktree is addressed through a case alias, a link, and a trailing-separator spelling
- **THEN** all three derive the same worktree identity
- **AND** this holds on Windows as well as on POSIX hosts

#### Scenario: Two worktrees of one repository stay distinct

- **WHEN** one repository has two worktrees at different locations
- **THEN** their worktree identities differ

#### Scenario: An uncanonicalizable path is refused

- **WHEN** a supplied worktree location cannot be canonicalized
- **THEN** identity derivation is refused
- **AND** no physical location is guessed

### Requirement: A prepared workspace binds to exactly one Change instance

A prepared workspace SHALL be unbound until exactly one Change instance exists in its planning
worktree, at which point the pair SHALL become bound and carry its pair identity. Creating a second
Change in the same planning worktree SHALL be refused. Re-preparing a workspace for a Change SHALL
produce a different pair identity rather than reuse the previous one.

#### Scenario: Creating the Change completes the pair

- **WHEN** the first Change is created in a prepared planning worktree
- **THEN** the workspace becomes bound and reports its pair identity

#### Scenario: A second Change in one planning worktree is refused

- **WHEN** a second Change creation is attempted in a planning worktree that is already bound
- **THEN** it is refused, naming the Change already bound there

#### Scenario: Re-preparing an existing Change changes the pair identity

- **WHEN** a Change's workspace is torn down and prepared again with new worktrees
- **THEN** the new pair has a different pair identity
- **AND** the Change instance identity is unchanged

### Requirement: Applying for an already-created Change completes its binding

Applying a plan for an already-created Change SHALL complete its binding to bound with a verified
pair identity, through the same path used after Change creation, once both planned worktrees and
their local binding documents are present. A missing execution worktree identity SHALL leave
the binding prepared rather than fabricate a pair. Disagreement between the recorded and live facts
SHALL refuse completion. Repeating the application SHALL be idempotent, and cleanup SHALL still be
able to remove the completed pair.

#### Scenario: Existing-change apply records a verified pair

- **WHEN** a plan for an already-created Change is applied and both worktrees are present
- **THEN** the result reports the binding as bound with a verified pair identity

#### Scenario: Inspection sees the completed pair

- **WHEN** the workspace is inspected after that apply
- **THEN** it reports the same bound pair and the same pair identity

#### Scenario: Re-applying the plan is idempotent

- **WHEN** the same plan is applied again
- **THEN** the binding is unchanged and no duplicate state is created

#### Scenario: Missing execution identity leaves an incomplete pair

- **WHEN** the execution worktree is absent at apply time
- **THEN** the binding remains prepared
- **AND** no pair identity is reported

#### Scenario: Drift refuses binding completion

- **WHEN** a recorded worktree identity or target line disagrees with the live one at apply time
- **THEN** completion is refused, naming both values

### Requirement: Binding facts have a stated authority and disagreement fails closed

The binding SHALL be recorded in four carriers with an explicit authority order: the Change's
committed identity is the portable authority; the planning-worktree marker and the execution-worktree
association are per-worktree local locators; the machine index is a rebuildable cache that SHALL be
re-verified before every use and SHALL NEVER be authority on its own. A missing index entry SHALL be
repaired from the markers and Git. A disagreeing carrier SHALL refuse, naming the disagreeing facts,
and SHALL NOT be corrected silently.

#### Scenario: A stale index entry never wins over Git

- **WHEN** the machine index names a worktree that Git no longer reports
- **THEN** the operation refuses or repairs from Git and the markers
- **AND** the index value is never treated as the truth

#### Scenario: A missing index entry is repaired, not fatal

- **WHEN** the machine index has no entry for a healthy, marker-consistent pair
- **THEN** the entry is rebuilt from the markers and Git
- **AND** the operation proceeds

#### Scenario: A marker contradicting committed metadata is refused

- **WHEN** a planning-worktree marker names a Store, project, or target line other than the Change's committed identity
- **THEN** the operation is refused, naming both
- **AND** neither the marker nor the committed metadata is rewritten

#### Scenario: An execution checkout with no planning side is refused

- **WHEN** an execution checkout carries an association whose planning worktree does not exist
- **THEN** the operation is refused
- **AND** no planning worktree is created to satisfy it

### Requirement: A planning worktree is verified rather than assumed

A planning-worktree marker SHALL NOT be sufficient on its own. It SHALL declare its resolved Store,
project, and target line; its target line SHALL resolve to an existing Store ref; and its worktree
identity SHALL re-derive from the live repository. A healthy hand-assembled pair SHALL be accepted and
indexed on first use. The Store integration checkout SHALL NOT be accepted as a planning worktree.

#### Scenario: An unresolvable target line disqualifies the worktree

- **WHEN** a marker names a target line whose Store ref does not resolve
- **THEN** the worktree is not accepted as a planning worktree, naming the unresolvable ref

#### Scenario: A healthy hand-assembled pair is accepted

- **WHEN** an operator has assembled a consistent worktree and marker by hand
- **THEN** it is accepted and recorded in the machine index on first use
- **AND** nothing about it is rewritten

#### Scenario: The integration checkout stays unauthorized

- **WHEN** the Store's own integration checkout is offered as a planning worktree
- **THEN** it is refused

### Requirement: Preparation never moves a ref, a HEAD, or a working tree

Preparation SHALL NOT move a ref, move a HEAD, switch a branch, or modify a working tree. Reusing an
existing worktree that sits on a different ref SHALL be refused rather than switched. Uncommitted work
in a reused worktree SHALL be left untouched. An occupied destination SHALL be refused rather than
overwritten or merged into.

#### Scenario: A reused worktree on another ref is refused, not switched

- **WHEN** the worktree selected for reuse is checked out on a ref other than the planned one
- **THEN** preparation refuses, naming both refs
- **AND** the worktree stays on its current ref

#### Scenario: Uncommitted work in a reused worktree is left alone

- **WHEN** a reused worktree has uncommitted or untracked changes
- **THEN** they are still present, unmodified, after the operation

#### Scenario: An occupied destination is refused

- **WHEN** the planned worktree destination already contains files
- **THEN** preparation refuses, naming the destination
- **AND** nothing at that destination is created, removed, or overwritten

### Requirement: Workspace operations serialize on semantic locks

Workspace operations SHALL serialize on owner-aware machine-root locks with named kinds, acquired in a
fixed order with bounded retry. Contention SHALL retry within that bound; a semantic conflict SHALL
NOT be retried. A lock whose recorded owner is provably gone SHALL NOT be reported as a blocking
holder, so a crashed process cannot leave a precondition no amount of waiting can satisfy. Operations
on independent target lines SHALL be able to run concurrently.

#### Scenario: Two lines run concurrently

- **WHEN** workspaces on two different target lines are prepared at the same time
- **THEN** both complete without either waiting on the other

#### Scenario: A live holder is waited for, then reported

- **WHEN** a lock is held by a live process for longer than the retry bound
- **THEN** the operation reports the lock as unavailable, naming the holder
- **AND** it does not steal the lock

#### Scenario: A crashed holder does not wedge the operation

- **WHEN** a lock file records an owner the kernel affirmatively reports as gone
- **THEN** the read-only probe does not report it as a blocking holder
- **AND** the operation proceeds under the same rule the acquirer applies

#### Scenario: A semantic conflict is not retried

- **WHEN** an operation fails because two facts disagree rather than because a lock was held
- **THEN** it refuses immediately without consuming the retry budget

### Requirement: A prepared or bound workspace is fully auditable in machine-readable form

Inspecting a workspace SHALL report, in both human and machine-readable form with the same content:
both worktree roots, their worktree identities, their checked-out refs and head commits, the target
line, the Change instance, the pair identity, the binding state, and every verification finding. Those
values SHALL be inert locators that confer no authority to mutate anything. Drift between recorded and
live facts SHALL be reported, not repaired. A scope with no workspace SHALL say so explicitly rather
than report an empty or guessed pair.

#### Scenario: A bound pair is fully auditable

- **WHEN** a bound workspace is inspected
- **THEN** both roots, both worktree identities, both refs and head commits, the target line, the Change instance, the pair identity, and the binding state are all reported
- **AND** the machine-readable form carries the same facts as the human form

#### Scenario: Drift is reported, not repaired

- **WHEN** a recorded worktree has been moved or switched to another ref
- **THEN** inspection reports the drift, naming the recorded and live values
- **AND** nothing is rewritten to make them agree

#### Scenario: A scope with no workspace says so

- **WHEN** a scope that has no prepared workspace is inspected
- **THEN** the absence is reported explicitly
- **AND** no pair is resolved from the current working directory

### Requirement: Cleanup removes only what it can prove is safe to remove

Cleanup SHALL be plan then apply, and SHALL remove a worktree only when it can prove all of: the
worktree is one the pair recorded, it sits on the ref the pair recorded, it is clean, every commit on
its branch is reachable from the recorded integration or target ref, no live session references it,
and no lock is held on it. Cleanup SHALL NOT delete a branch, merge, reset, force a removal, or touch
the Store integration checkout, the project's main checkout, the Change directory, the Archive, or
another pair's state. An interrupted cleanup SHALL resume from the phase it reached.

#### Scenario: Unmerged work blocks removal

- **WHEN** the worktree's branch carries a commit not reachable from the recorded integration or target ref
- **THEN** cleanup refuses, naming the unreachable commit
- **AND** the worktree remains

#### Scenario: A dirty or untracked tree is not discarded

- **WHEN** the worktree has uncommitted or untracked changes
- **THEN** cleanup refuses
- **AND** no forced removal is attempted

#### Scenario: Cleanup never widens beyond the pair

- **WHEN** cleanup runs successfully
- **THEN** the only removed paths are worktrees the pair recorded
- **AND** no branch, Change directory, Archive entry, integration checkout, or other pair's state is affected

#### Scenario: An interrupted cleanup resumes from its phase

- **WHEN** cleanup is interrupted partway
- **THEN** re-running it resumes from the recorded phase
- **AND** it does not repeat a completed destructive step or skip an incomplete one

### Requirement: Git mutation is a closed, non-destructive verb set

The workspace adapter SHALL invoke only an explicitly listed set of Git operations: adding, removing,
and pruning worktrees, plus read-only inspection. It SHALL NOT invoke merge, rebase, reset, checkout,
switch, branch deletion, push, fetch, clone, or a forced worktree removal. The list SHALL be an
explicit constant checked by a source guard, so a forbidden verb cannot be introduced without that
guard failing. No command in this capability SHALL stage, commit, fetch, or push.

#### Scenario: A forbidden verb cannot be introduced silently

- **WHEN** a forbidden Git verb is introduced into the workspace adapter
- **THEN** the source guard fails, naming the verb and the file

#### Scenario: No command stages or commits

- **WHEN** any workspace or target-line command runs to completion
- **THEN** the repository index and commit history are unchanged in both repositories
- **AND** any suggested commit is printed for the operator rather than performed

### Requirement: Workspace coordination writes recover only exact owned state

A retry of the same coordination write SHALL resume a retained claim only when its target, intended
bytes, directory, prior target, and intent all still match exactly. Corrupt, disagreeing, foreign, or
replaced state SHALL be kept intact and refused with a named conflict; retained state SHALL NEVER
authorize overwriting a changed target or deleting a file whose ownership is unproven. An interrupted
unjournaled write SHALL NOT leave state that the same write can never recover from. Filesystem
identity comparisons SHALL remain exact on Windows as on POSIX.

#### Scenario: The same write resumes its retained claim

- **WHEN** a coordination write is interrupted and the identical write is retried
- **THEN** it resumes its own retained claim and completes

#### Scenario: Changed or replaced state is retained and refused

- **WHEN** the target has been changed or replaced since the claim was retained
- **THEN** the retry refuses with a named write conflict
- **AND** the existing file is left intact

#### Scenario: Journal authority remains mandatory

- **WHEN** a claim exists without the journal entry that would authorize it
- **THEN** the write refuses rather than adopting the claim

#### Scenario: Windows filesystem identities remain exact

- **WHEN** a claim is evaluated against a target addressed through a Windows path alias
- **THEN** the identity comparison resolves to the same physical file
- **AND** an alias does not make a foreign target look owned

### Requirement: Directory durability degrades only for proven unsupported operations

A coordination write SHALL treat only a demonstrably unsupported directory-synchronization outcome as
a portability limitation to be tolerated. Permission, device, capacity, file-synchronization, and
close failures SHALL remain visible failures. An unsupported directory-synchronization result SHALL
NOT be used to conceal a failure to replace the directory entry.

#### Scenario: Unsupported directory synchronization does not wedge coordination

- **WHEN** the host filesystem reports that synchronizing a directory is unsupported
- **THEN** the write completes
- **AND** workspace planning, binding, locking, and cleanup continue to function on that filesystem

#### Scenario: Genuine I/O failure remains visible

- **WHEN** a write fails for permission, device, or capacity reasons
- **THEN** the failure is reported as itself
- **AND** it is not reclassified as a portability limitation

#### Scenario: File sync and close failures are never treated as directory portability

- **WHEN** synchronizing or closing the file itself fails
- **THEN** the failure is reported
- **AND** the portability path is not taken

#### Scenario: Unsupported result cannot hide directory replacement

- **WHEN** the directory entry was not replaced
- **THEN** the write reports that failure
- **AND** an unsupported-synchronization result does not mask it
