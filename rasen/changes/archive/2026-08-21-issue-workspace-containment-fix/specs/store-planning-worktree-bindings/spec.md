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
- **AND** a repository checkout the pair did not plan as one of its roots — the Store integration checkout, the project's main checkout — is untouched

#### Scenario: A main-checkout execution root receives only its binding document

- **WHEN** a plan that reuses the project repository's main checkout as its execution root is applied
- **THEN** the only path written inside that main checkout is the pair's execution association document
- **AND** no worktree is created there and no ref or HEAD is moved
