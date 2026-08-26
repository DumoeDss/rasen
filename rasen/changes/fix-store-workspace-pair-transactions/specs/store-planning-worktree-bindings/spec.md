# store-planning-worktree-bindings Delta

## MODIFIED Requirements

### Requirement: A Change workspace is prepared through an immutable plan and a revalidated token

Preparing a Change workspace SHALL be two steps. Planning SHALL write nothing, SHALL be total — it
reports every problem it finds rather than stopping at the first — and SHALL produce an immutable plan
addressed by a token derived from the plan's own content. Applying SHALL consume only that token: it
SHALL NOT re-read the current working directory, the selectors that produced the plan, or any live
state the plan already froze.

A plan's destination containment SHALL distinguish the project repository's main checkout from a
destination nested inside a repository's checkout. The main checkout named as the execution side is
the reuse the plan itself blesses, and the plan SHALL accept it as applicable. A destination that
sits strictly inside its repository's own checkout SHALL be refused on either side, because a nested
worktree would show up in that checkout as untracked content and its removal would have to reach
inside the checkout.

When the machine index already records a pair for the same Change, planning SHALL reconcile that
record into its reported preconditions rather than ignore it. A recorded worktree that still exists
at the planned root is the reuse the plan already blesses. A recorded worktree that no longer exists
at the planned root SHALL be reported as a satisfied precondition stating that the pair is being
re-created there. A recorded pair whose worktree still exists at a root other than the planned one
SHALL be an unsatisfied precondition — one Change instance belongs to exactly one pair — naming the
recorded pair and the cleanup repair, so the second pair is refused before anything is created rather
than at apply time.

For every side the plan will create, the plan SHALL report, as a satisfied precondition in its
preview, the locator ref and the frozen commit identity that side will be created from, so an
operator can see what was frozen before applying.

A pair's branch outlives its worktrees: neither removing a worktree nor removing a pair deletes the
branch, deliberately, because a branch may carry commits. For every side it will create, planning
SHALL therefore report what it found for that side's branch — a branch that does not exist yet, which
is created from the target line's frozen tip; a branch that already exists and is checked out
nowhere, which is reattached at its OWN frozen commit identity rather than minted again or forced
back to the line's tip; or a branch another worktree already has checked out, which SHALL be an
unsatisfied precondition naming that worktree, because one branch is checked out in one worktree at a
time and preparation never moves another worktree's HEAD.

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

#### Scenario: The project main checkout is an applicable execution side

- **WHEN** an operator plans a pair naming the project repository's main checkout as the execution worktree
- **THEN** the plan reports every precondition satisfied, including destination containment, and is applicable
- **AND** the containment finding names the main checkout as a checkout a pair may legitimately use for execution
- **AND** this holds when the main checkout is addressed through a case-alias or trailing-separator spelling, on Windows as on POSIX

#### Scenario: A destination nested inside its repository's checkout is refused

- **WHEN** a planned destination sits strictly inside its own repository's checkout, on either side
- **THEN** the plan refuses it, naming the checkout it nests inside
- **AND** the refusal fires identically for a nested planning destination and a nested execution destination

#### Scenario: A vanished recorded pair is re-created visibly at its recorded root

- **WHEN** the machine index records a pair for this Change whose planning worktree no longer exists, and the operator plans the workspace again without naming a destination
- **THEN** the plan is applicable, with a satisfied precondition stating that the recorded worktree is gone and the pair is being re-created at the recorded root
- **AND** applying the plan creates the worktree and re-records the pair

#### Scenario: A live recorded pair at another root blocks a second pair

- **WHEN** the machine index records a pair for this Change whose planning worktree still exists, and the operator plans the workspace naming a different destination
- **THEN** the plan reports an unsatisfied precondition naming the recorded pair and the cleanup repair
- **AND** nothing is created and the recorded pair is untouched

#### Scenario: The preview names the tip each created side is born from

- **WHEN** an operator plans a workspace in which at least one side will be created
- **THEN** the plan preview reports, for each created side, the locator ref and the frozen commit identity it will be created from

#### Scenario: A pair branch an earlier pair left behind is reattached rather than re-minted

- **WHEN** a Change whose pair branch still exists is prepared again at a destination that does not exist
- **THEN** the plan reports that the branch will be reattached, naming its commit identity, and applying creates the worktree on that branch at that commit
- **AND** no commit the branch carries is discarded and no ref is moved

#### Scenario: A pair branch another worktree has checked out blocks the plan

- **WHEN** a side the plan would create names a branch that another worktree already has checked out
- **THEN** the plan reports an unsatisfied precondition naming that worktree
- **AND** nothing is created and that worktree is untouched

### Requirement: Applying revalidates Git preconditions and creates worktrees from frozen commits

Applying SHALL revalidate every Git precondition the plan recorded — the target line's Store ref and
code ref, and the head commit of every reused worktree — and SHALL create new worktrees from the
recorded commit identity rather than from a ref name. A ref that moved between planning and applying
SHALL invalidate the plan rather than silently retarget it. An interrupted apply SHALL leave no
partially created worktree behind that a later apply cannot account for.

A pair branch the plan reattaches rather than creates SHALL be revalidated against the commit
identity the plan froze for it, and a branch that moved between planning and applying SHALL
invalidate the plan exactly as a moved target-line ref does.

For a side the plan creates, revalidation SHALL treat the destination's absence as the satisfied
precondition creation requires. A recorded worktree identity SHALL be compared only against a
destination that exists on the planned ref at the same recorded root — the resumable creation this
apply itself made — and a mismatch there SHALL refuse. A recorded identity for a worktree that does
not exist, or that was recorded for a different root, SHALL NOT be held against a destination that
is yet to be created.

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
- **AND** a repository checkout the pair did not plan as one of its roots — the Store integration checkout, the project's main checkout — is untouched

#### Scenario: A main-checkout execution root receives only its binding document

- **WHEN** a plan that reuses the project repository's main checkout as its execution root is applied
- **THEN** the only path written inside that main checkout is the pair's execution association document
- **AND** no worktree is created there and no ref or HEAD is moved

#### Scenario: An absent created destination revalidates as satisfied

- **WHEN** a plan that creates a side is applied while the machine index still records an earlier pair for the same Change with a non-empty worktree identity, and the planned destination does not exist
- **THEN** revalidation passes for that side and the worktree is created from the frozen commit
- **AND** the pair is re-recorded from the newly created state

#### Scenario: A resumed created destination must be the same incarnation

- **WHEN** a create-side destination already exists on the planned ref and the index entry recorded a worktree identity for that same root that does not match the live one
- **THEN** applying refuses as stale, naming both identities
- **AND** nothing is written

#### Scenario: A reattached pair branch that moved invalidates the plan

- **WHEN** the pair branch a created side would be reattached to advances between planning and applying
- **THEN** applying refuses as stale, naming the recorded and live commit identities
- **AND** no worktree is created

### Requirement: A prepared workspace binds to exactly one Change instance

A prepared workspace SHALL be unbound until exactly one Change instance exists in its planning
worktree, at which point the pair SHALL become bound and carry its pair identity. Creating a second
Change in the same planning worktree SHALL be refused. Re-preparing a workspace for a Change at a
NEW destination SHALL produce a different pair identity rather than reuse the previous one; a pair
re-created at the SAME recorded root re-derives the SAME pair identity, because a worktree's identity
is derived from its canonical repository and worktree locations and those have not changed. The
Change instance identity is unchanged either way.

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

#### Scenario: Re-creating a vanished pair at its own recorded root keeps the pair identity

- **WHEN** a Change's planning worktree is removed and the pair is prepared again at that same recorded root
- **THEN** the re-recorded pair carries the same pair identity as before
- **AND** the Change instance identity is unchanged

## ADDED Requirements

### Requirement: A workspace pair is preparable in one invocation

Preparation SHALL be available as a single invocation that plans and applies under one continuous
hold of the same locks applying takes, so the frozen preconditions cannot go stale in a gap between
two invocations of the operator's own flow. The single invocation SHALL report the same plan preview
and the same applied result as the two-step path. A precondition that a concurrent actor moves
inside the window SHALL still refuse as stale rather than be repaired, and repeating the invocation
SHALL converge on a prepared pair once the world holds still.

#### Scenario: One invocation prepares on an active line

- **WHEN** an operator prepares a workspace in one invocation on a target line that advanced moments before
- **THEN** the plan freezes the line's tip as of the invocation and the pair is created from it, with the preview and result both reported

#### Scenario: Concurrent movement still refuses stale, and repeating converges

- **WHEN** another process advances the target line's Store ref inside the single invocation's window between planning and applying
- **THEN** the invocation refuses as stale, naming the recorded and live commit identities
- **AND** repeating the invocation after the movement stops prepares the pair
