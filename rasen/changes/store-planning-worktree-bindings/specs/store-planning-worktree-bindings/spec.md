## Purpose

Turn "a project mutation requires a verified planning worktree" from a gate with nothing behind it into a real, explicitly bound pair: one Store planning worktree and one execution worktree, prepared through an immutable plan whose Git OID preconditions are revalidated under semantic locks, identified by canonical local worktree identity rather than by branch name or adjacency, bound to exactly one Change instance, frozen into the session, reported as inert locators, and removed only when removal is provably lossless. Preparation adds worktrees and never moves a ref, a HEAD, or a working tree; every disagreement between committed Change metadata, the per-worktree markers, the machine index, and live Git fails closed instead of choosing a winner.

## ADDED Requirements

### Requirement: A Change workspace is prepared through an immutable plan and a revalidated token

Preparing the planning and execution worktrees for a Change SHALL be a two-step operation. Planning SHALL be read-only and total: it SHALL resolve the scope and target line, survey both repositories, and report every unsatisfied precondition rather than stopping at the first. The plan SHALL be an immutable value carrying the resolved scope, the resolved target line with both refs and both commit OIDs, an ordered list of actions drawn from a closed set, and each action's absolute destination, source commit OID, and written-file digest. The plan SHALL be content-addressed, and applying SHALL consume only its token, re-reading no working directory, no current branch, and none of the selectors that produced the plan. Plans SHALL live in the machine data directory and SHALL NOT be written into either Git repository.

#### Scenario: Planning writes nothing and reports every problem

- **WHEN** a workspace plan is produced for a scope with several unsatisfied preconditions
- **THEN** the plan SHALL list every one of them with its values
- **AND** no file under either repository or the machine data directory SHALL be created or modified

#### Scenario: Equal inputs produce an identical plan

- **WHEN** the same scope, target line, repositories, and Change alias are planned twice with no intervening change
- **THEN** both plans SHALL serialize identically and carry the same plan identifier

#### Scenario: Apply consumes only the token

- **WHEN** a stored plan is applied after the invoking directory and selectors have changed
- **THEN** the applied result SHALL be the one the plan froze
- **AND** the current directory and selectors SHALL NOT influence any destination

### Requirement: Applying revalidates Git preconditions and creates worktrees from frozen commits

Before its first write, applying SHALL take the scope and workspace locks and revalidate the target-line catalog text, both resolved ref commit OIDs, the HEAD commit OID and checked-out ref of every reused worktree, the non-existence of every created destination, the Store's declared layout version, and the machine index fingerprint. Any mismatch SHALL abort with `workspace_plan_stale`; a stale plan SHALL be invalidated rather than repaired. A created worktree SHALL be created from the commit OID the plan froze, not from the ref name, so a ref that moved between planning and applying cannot retarget it. Applying SHALL write only inside the two planned worktree roots and the machine data directory, SHALL record its phase before each transition so an interrupted run is resumable, and SHALL be idempotent for an action that is already satisfied.

#### Scenario: A moved ref invalidates the plan

- **WHEN** the target line's Store ref or code ref moves between planning and applying
- **THEN** applying SHALL abort with `workspace_plan_stale`, naming the ref and both commit OIDs
- **AND** no worktree, marker, or index entry SHALL be created

#### Scenario: An interrupted apply leaves no orphan

- **WHEN** applying fails after any single action
- **THEN** the result SHALL be either a fully unprepared state or one complete prepared state
- **AND** re-applying the same token SHALL complete rather than duplicate

#### Scenario: Nothing outside the planned roots is written

- **WHEN** a workspace is applied
- **THEN** every created or modified path SHALL be inside one of the two planned worktree roots or the machine data directory
- **AND** the Store integration checkout and the code repository's main checkout SHALL remain byte-identical

### Requirement: Planning and execution worktrees carry verified local identities

Each side of a pair SHALL derive its `WorktreeInstanceId` from canonical repository identity and canonical physical worktree identity obtained from the Git adapter and canonicalized with the platform's path identity rules, so equivalent Windows drive-letter, short-name, junction, and separator spellings yield one identity. Every linked worktree of one repository SHALL share its repository identity and SHALL derive a distinct worktree identity. An identity input that cannot be canonicalized SHALL fail closed and SHALL NOT degrade to the literal path string. No portable repository identity SHALL be minted for the execution repository; the project's permanent identifier SHALL be the portable execution-repository fact, and canonical repository identity SHALL be used only for local drift detection.

#### Scenario: Path aliases resolve to one worktree identity

- **WHEN** the same worktree is addressed through spellings differing only in drive-letter case, short name, junction, or separator form
- **THEN** every spelling SHALL derive the same worktree instance identity
- **AND** no second binding SHALL be created

#### Scenario: Two worktrees of one repository stay distinct

- **WHEN** two linked worktrees of one repository are identified
- **THEN** they SHALL share a repository identity and SHALL derive different worktree instance identities

#### Scenario: An uncanonicalizable path is refused

- **WHEN** a recorded worktree root cannot be canonicalized
- **THEN** identity derivation SHALL fail closed
- **AND** no operation SHALL proceed against the literal path

### Requirement: A prepared workspace binds to exactly one Change instance

A prepared workspace SHALL record its scope, both worktree roots and instance identities, the frozen commit OIDs, and the intended Change alias, and SHALL be `unbound` until one Change instance exists in its planning worktree. Creating that Change SHALL complete the binding by deriving and verifying the `WorkspacePairId` from the minted Change instance identity and the two worktree instance identities, and recording it. A second Change creation in the same planning worktree SHALL fail with `workspace_already_bound`, decided from the recorded binding rather than from a directory scan. Binding an already-created Change to a newly prepared pair SHALL verify its recorded identity instead of minting one, and SHALL produce a different pair identity because a worktree instance changed.

#### Scenario: Creating the Change completes the pair

- **WHEN** a Change is created in a prepared planning worktree
- **THEN** the binding SHALL record the Change instance and a verified workspace pair identity
- **AND** the binding state SHALL become bound

#### Scenario: A second Change in one planning worktree is refused

- **WHEN** a second Change creation targets a planning worktree that is already bound
- **THEN** it SHALL fail with `workspace_already_bound`, naming the bound Change
- **AND** no Change directory SHALL be created

#### Scenario: Re-preparing an existing Change changes the pair identity

- **WHEN** an existing Change is bound to a newly created planning worktree
- **THEN** its Change instance identity SHALL be verified and unchanged
- **AND** the workspace pair identity SHALL differ from the previous pair's

### Requirement: Binding facts have a stated authority and disagreement fails closed

The binding SHALL be carried by four artifacts with fixed authority: the Change's committed v2 identity metadata is the portable authority for Store, project, target line, and Change instance; the planning-worktree marker and the execution-worktree association are ignored, machine-local locators for their own worktree; and the machine workspace index is a rebuildable projection that is authority for nothing. Before use, every index field SHALL be re-verified against live Git and the markers. A missing index entry SHALL be repaired idempotently from the markers and live Git, writing no fact not already true on disk. A local carrier that names a different Store, project, target line, or Change instance than the committed metadata SHALL fail with `workspace_marker_conflict` or `planning_execution_binding_mismatch`. Two claimants for one worktree or one Change instance SHALL fail with `workspace_binding_ambiguous`, listing every claimant and choosing none. An execution worktree with no planning side SHALL fail with `planning_execution_binding_missing` and SHALL NOT infer one from an adjacent directory, a branch name, or the Store integration checkout.

#### Scenario: A stale index entry never wins over Git

- **WHEN** the index records a worktree root that is no longer a worktree of the recorded repository
- **THEN** the entry SHALL be treated as a conflict rather than as truth
- **AND** no operation SHALL proceed against the recorded root

#### Scenario: A missing index entry is repaired, not fatal

- **WHEN** a healthy pair has markers on both sides and no index entry
- **THEN** the entry SHALL be reconstructed from the markers and live Git
- **AND** repeating the reconstruction SHALL produce byte-identical state

#### Scenario: A marker contradicting committed metadata is refused

- **WHEN** a planning-worktree marker names a different project or target line than the Change's committed identity
- **THEN** the operation SHALL fail naming both values
- **AND** neither the marker nor the metadata SHALL be rewritten to agree

#### Scenario: An execution checkout with no planning side is refused

- **WHEN** a project mutation runs in an execution worktree with no recorded planning worktree
- **THEN** it SHALL fail with `planning_execution_binding_missing`
- **AND** it SHALL NOT resolve the Store integration checkout or any adjacent directory as the planning worktree

### Requirement: A planning worktree is verified rather than assumed

A project mutation SHALL be authorized only by a planning worktree that is a linked worktree of the selected Store repository, whose marker declares the resolved Store, project, and target line, whose target line resolves to an existing Store ref, and whose worktree instance identity re-derives from the live repository. The Store integration checkout SHALL never be authorized. A worktree failing any of these SHALL fail with `planning_worktree_required`, and the integration checkout SHALL remain unchanged. A pair assembled by hand that satisfies every condition SHALL be accepted and indexed on first use.

#### Scenario: An unresolvable target line disqualifies the worktree

- **WHEN** a marker names a target line whose catalog is absent or whose Store ref does not resolve
- **THEN** the mutation SHALL fail rather than treating the marker's presence as verification
- **AND** no planning content SHALL be written

#### Scenario: A healthy hand-assembled pair is accepted

- **WHEN** an operator creates the worktrees and markers manually and every verification condition holds
- **THEN** the mutation SHALL proceed
- **AND** the machine index SHALL be populated from what is already true on disk

#### Scenario: The integration checkout stays unauthorized

- **WHEN** a project mutation resolves the Store integration checkout as its only Store checkout
- **THEN** it SHALL fail with `planning_worktree_required`
- **AND** the integration checkout SHALL remain byte-identical

### Requirement: Preparation never moves a ref, a HEAD, or a working tree

The only Git state preparation SHALL create is a new worktree and, when the plan declares it, the branch that worktree checks out, created from the frozen commit OID. Reusing an existing worktree whose checked-out ref differs from the recorded one SHALL fail with `workspace_ref_mismatch`, naming both refs and the command the user may run themselves; preparation SHALL NOT check out, switch, reset, or detach any worktree. A dirty working tree SHALL NOT block reuse, because preparation does not touch it. A create action whose destination already exists SHALL fail with `workspace_destination_exists` rather than overwriting or merging into it.

#### Scenario: A reused worktree on another ref is refused, not switched

- **WHEN** the recorded planning worktree is checked out on a different ref
- **THEN** preparation SHALL fail with `workspace_ref_mismatch`, naming both refs
- **AND** the worktree's HEAD, index, and working tree SHALL be unchanged

#### Scenario: Uncommitted work in a reused worktree is left alone

- **WHEN** the recorded execution worktree has uncommitted modifications and is on the recorded ref
- **THEN** preparation SHALL proceed
- **AND** the modifications SHALL be untouched

#### Scenario: An occupied destination is refused

- **WHEN** a planned worktree destination path already exists
- **THEN** preparation SHALL fail with `workspace_destination_exists`, naming the path
- **AND** the existing path SHALL be unchanged

### Requirement: Workspace operations serialize on semantic locks

Workspace preparation and cleanup SHALL serialize on locks keyed by semantic scope and instance rather than by Change alias: a scope lock over Store, project, and target line, and a workspace lock over the workspace pair or, before binding, the prepared pair's provisional key. Change-instance and Store-integration lock keys SHALL be defined for the finalization owner and SHALL NOT be taken here. Locks SHALL be owner-aware machine-local files acquired in a fixed order, so a holder that is proven dead is recovered and one that may be alive is never stolen. Contention SHALL retry within a bounded deadline and then fail with `workspace_lock_unavailable`, naming the recorded holder. A semantic conflict SHALL NOT be retried. A Git-level lock failure SHALL be surfaced as itself and SHALL NOT be resolved by removing a lock file or by forcing an operation. Different projects and different target lines SHALL proceed concurrently.

#### Scenario: Two lines run concurrently

- **WHEN** two Changes on different target lines of one Store prepare their workspaces at the same time
- **THEN** both SHALL proceed without waiting on each other
- **AND** neither SHALL observe the other's unmerged planning content

#### Scenario: A live holder is waited for, then reported

- **WHEN** a second process requests a lock held by a live process for longer than the bounded deadline
- **THEN** it SHALL fail with `workspace_lock_unavailable`, naming the holder
- **AND** it SHALL NOT remove or steal the lock

#### Scenario: A semantic conflict is not retried

- **WHEN** an operation fails on a mismatched binding, a moved ref, or a dirty tree
- **THEN** it SHALL report immediately
- **AND** it SHALL NOT re-attempt the same operation within a retry loop

### Requirement: Machine-readable context reports the workspace pair as inert locators

`rasen context` SHALL report, in both human and JSON form with the same content, the resolved workspace: both worktree roots, both worktree instance identities, each side's checked-out ref and HEAD commit OID, the Store, project, target line, Change instance and workspace pair identities when they exist, a binding state of unbound, prepared, bound, or drifted, and every verification finding. Absent facts SHALL be absent rather than guessed or nulled, and a scope with no prepared workspace SHALL say so explicitly. The report SHALL be inert: serializing or replaying it SHALL confer no mutation authority, and producing it SHALL write nothing under either repository or the machine data directory.

#### Scenario: A bound pair is fully auditable

- **WHEN** context is requested from an execution worktree bound to a Store planning worktree
- **THEN** the payload SHALL name both worktree roots, both instance identities, both refs and HEAD commit OIDs, the target line, the Change instance, and the pair identity
- **AND** the human output SHALL state the same facts

#### Scenario: Drift is reported, not repaired

- **WHEN** a recorded worktree has been removed, moved, or switched to another ref
- **THEN** the binding state SHALL be reported as drifted with the disagreeing values
- **AND** nothing SHALL be rewritten to make the report consistent

#### Scenario: A scope with no workspace says so

- **WHEN** context resolves a project scope for which no workspace has been prepared
- **THEN** the payload SHALL state that no workspace is prepared
- **AND** it SHALL NOT report a planning or execution worktree it inferred

### Requirement: Cleanup removes only what it can prove is safe to remove

Removing a worktree SHALL be planned and applied, and the plan SHALL list each precondition as satisfied or unsatisfied with its values: the root is one the pair recorded and re-derives its recorded instance identity; it is a linked worktree and not a main checkout; it is on the recorded ref; it has no tracked modifications and no staged changes; it has no untracked files unless they are listed in the plan and explicitly accepted; every commit on its branch is reachable from the recorded Store integration ref or target code ref; no live session references it; and no scope or workspace lock is held elsewhere. Any unsatisfied precondition SHALL fail with `workspace_cleanup_unsafe`, listing each failure, with no override flag and no partial removal. Removal SHALL be non-forced and SHALL record its phase before each step so an interrupted cleanup resumes from the recorded phase rather than from an absent directory. Cleanup SHALL NOT delete a branch or any ref, SHALL NOT merge or rebase to satisfy reachability, and SHALL NOT remove the Store integration checkout, the code repository's main checkout, any path outside the two recorded roots, the Change directory, the project partition, the Archive, or another pair's markers or index entry. The pair's own index entry SHALL be removed last, after both worktrees are gone.

#### Scenario: Unmerged work blocks removal

- **WHEN** cleanup is planned for a worktree whose branch has commits not reachable from the recorded integration or target ref
- **THEN** it SHALL fail with `workspace_cleanup_unsafe`, naming the unreachable commits
- **AND** it SHALL NOT merge, rebase, or delete anything

#### Scenario: A dirty or untracked tree is not discarded

- **WHEN** a recorded worktree has tracked modifications, or has untracked files that were not explicitly accepted
- **THEN** cleanup SHALL refuse and list them
- **AND** every file SHALL remain on disk

#### Scenario: Cleanup never widens beyond the pair

- **WHEN** a cleanup completes successfully
- **THEN** only the two recorded worktree roots and this pair's index entry SHALL have been removed
- **AND** the Store integration checkout, the main code checkout, the Change directory, the project partition, the Archive, every branch, and every other pair's state SHALL be byte-identical

#### Scenario: An interrupted cleanup resumes from its phase

- **WHEN** cleanup fails after removing one worktree
- **THEN** the recorded phase SHALL reflect the completed step
- **AND** resuming SHALL continue from that phase rather than concluding from an absent directory

### Requirement: Git mutation is a closed, non-destructive verb set

The workspace Git adapter SHALL be permitted to add a worktree, remove a worktree without forcing, and prune worktree administrative state, plus read-only inspection of refs, commits, worktrees, status, ancestry, and untracked files. It SHALL NOT merge, rebase, reset, check out, switch, delete a branch or ref, fetch, pull, push, clone, or force a worktree removal, under any flag or option. No command in this capability SHALL stage or commit in either repository, and no forge or network dependency SHALL be introduced. The restriction SHALL be enforced by a source guard rather than by convention.

#### Scenario: A forbidden verb cannot be introduced silently

- **WHEN** a Git verb outside the permitted set, or a forced worktree removal, is added to the workspace adapter
- **THEN** the source guard SHALL fail
- **AND** the failure SHALL name the file and the verb

#### Scenario: No command stages or commits

- **WHEN** any workspace or target-line command completes successfully
- **THEN** the Git index of both repositories SHALL be unchanged
- **AND** the command SHALL print the pathspec the user may commit themselves
