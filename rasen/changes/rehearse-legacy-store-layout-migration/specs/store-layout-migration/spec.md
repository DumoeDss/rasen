# store-layout-migration Delta

## ADDED Requirements

### Requirement: Ownership comes only from auditable evidence, and anything less blocks apply
`rasen store migrate-layout` SHALL decide each item's owning project only from auditable evidence: the item's own recorded identity, the Store's adoption/membership records, a machine association for a member project, or the operator's explicit mapping file. Absent, conflicting, non-member, or unrecordable evidence SHALL leave the item unresolved, and a plan with any unresolved or blocked item SHALL refuse apply entirely — there is no partial migration and no force override. A name prefix, branch name, directory adjacency, or similarity to a member project SHALL never assign ownership.

#### Scenario: No evidence blocks apply and names the mapping repair
- **WHEN** a flat Change has no recorded identity, no adoption record, and no member association, and the operator runs the migration preview
- **THEN** the item is reported unresolved with an unknown-owner reason
- **AND** the repair text names the exact mapping-file key that would resolve it
- **AND** apply is refused while the item stays unresolved, writing nothing

#### Scenario: Disagreeing evidence blocks rather than picking a winner
- **WHEN** the Store's records and a machine association name two different member projects for the same Change
- **THEN** the item is reported as an evidence conflict listing the disagreeing projects
- **AND** apply is refused

#### Scenario: Evidence naming a non-member never falls back to a member
- **WHEN** the only evidence for an item names a project that is not a member of the Store
- **THEN** the item is reported unresolved with a non-member reason
- **AND** ownership is never reassigned to any member project

#### Scenario: A recorded non-member owner is repaired by membership, not by the mapping file
- **WHEN** an item records an identity naming a project that is not a Store member
- **THEN** the repair names making that project a member of this Store
- **AND** it does not offer a mapping-file entry for that item, because a mapping entry contradicting a recorded identity is refused

### Requirement: The mapping file resolves unknowns and can never relabel recorded history
The operator's mapping file SHALL be an audited assertion that resolves unknown or conflicting ownership, and SHALL be refused as a whole when any entry contradicts an item's recorded identity, names an item the inventory does not contain, or names a project that is not a Store member. The mapping file SHALL live inside the Store worktree so it can be committed beside the receipt that cites it.

#### Scenario: A mapping entry contradicting recorded identity is a mapping error
- **WHEN** the mapping file assigns a Change to project B but the Change itself records project A as its identity
- **THEN** the plan refuses with a diagnostic naming the contradicting entry
- **AND** no item from that mapping file is honored

#### Scenario: A mapping file outside the Store worktree is refused
- **WHEN** the operator passes a mapping path that resolves outside the Store worktree
- **THEN** the command refuses and explains the mapping must be committable inside the Store

#### Scenario: A mapping entry naming an item the inventory does not contain is refused
- **WHEN** the mapping file assigns a Change name that this ref's flat tree does not hold
- **THEN** the plan refuses as a mapping-file error naming that entry
- **AND** no item from that mapping file is honored

### Requirement: A canonical spec with multiple contributors requires an explicit resolution
When more than one project's Changes contributed deltas to the same flat canonical spec, the migration SHALL keep the spec unresolved until the operator declares one authoritative owner or an explicit split, and an unresolved contributing Change SHALL keep the spec unresolved rather than letting it appear single-owner.

#### Scenario: Shared spec blocks until declared
- **WHEN** two archived Changes owned by different projects both carry deltas for one canonical spec
- **THEN** the spec is reported unresolved as shared
- **AND** the repair names both the owner and split mapping declarations

#### Scenario: An unresolved contributor keeps a spec unresolved
- **WHEN** one of a spec's contributing Changes has no resolved owner
- **THEN** the spec stays unresolved even if every other contributor resolves to a single project

### Requirement: Publication is staged, verified, and recoverable, with the layout declaration flipped last
Apply SHALL copy sources into staging inside the Store, verify staged content by digest, publish by same-volume rename with each step recorded durably in a machine-local recovery run before and after it happens, and write the layout v2 declaration only after every other publication step succeeds. A failure at any copy, rename, or manifest step SHALL leave the flat tree complete and readable, and the recorded run SHALL support status inspection, resume, and rollback that removes only what the run itself created and restores any file it overwrote. Retiring the flat tree SHALL be a separate, re-runnable step that refuses to run before a completed publication, and rollback after retirement SHALL refuse and name Git as the recovery path.

#### Scenario: Mid-publication failure leaves a readable flat Store and a recoverable run
- **WHEN** publication fails after some items were renamed into place but before the layout declaration is written
- **THEN** the Store still reads as a legacy flat Store with its flat tree intact
- **AND** status reports the failed run with the paths it created
- **AND** rollback removes only those paths and restores every overwritten file

#### Scenario: Retirement refuses before publication and is idempotent after it
- **WHEN** the operator requests flat-tree retirement before any completed publication
- **THEN** the command refuses and names the publish step
- **AND** after a completed publication, retirement removes the flat tree and a repeated retirement completes without error

### Requirement: Every ref still carrying the flat layout is reported, and migrating one claims nothing about the others
The migration SHALL survey every local and remote-tracking ref of the Store repository, report each ref that still carries the flat layout together with the command that would migrate it, and state that migrating the checked-out ref does not migrate the others. Migration SHALL only ever write the ref checked out in the invoking worktree.

#### Scenario: A second flat branch is reported with its own migrate command
- **WHEN** the Store has another local branch whose committed content still carries the flat layout
- **THEN** the preview lists that ref with a per-ref migration command
- **AND** states that migrating the current ref does not migrate it

#### Scenario: A remote-tracking ref carrying the flat layout is reported too
- **WHEN** a surveyed remote-tracking ref still carries the flat layout
- **THEN** the preview lists that ref
- **AND** states that it is migrated where it lives, because migration only writes the ref checked out in the invoking worktree

### Requirement: An empty legacy flat Store migrates to layout v2 instead of dead-ending
A legacy flat Store whose flat collections contain no items SHALL complete a trivial migration: apply publishes the migration receipt and the layout v2 declaration, after which project-partition writes are accepted. The empty Store SHALL NOT be left in a state where partition writes are refused for being legacy while the migration is refused for being empty.

#### Scenario: Empty store completes a trivial migration
- **WHEN** the operator plans and applies a migration for a legacy flat Store with no specs, Changes, or archive entries
- **THEN** apply completes, records a receipt, and declares layout v2
- **AND** a subsequent project-partition write is no longer refused as a legacy flat Store

### Requirement: A plan reported applicable can be applied, and every unmet precondition is named
The migration SHALL keep "this plan is applicable" and "this plan can be applied" as the same statement: EVERY precondition of applying a plan SHALL be reported as a named blocking item in that plan, and a plan with no blocking item SHALL be appliable. A precondition the plan cannot express as a blocked item SHALL be a defect of this capability rather than a silent refusal. In particular, the Store's permanent identity, a checked-out ref, and a commit on that ref are preconditions of applying, so their absence SHALL be reported as blocked items naming the Store metadata and its repair — for every Store shape, including a Store holding no active Changes and a Store holding no planning content at all. The migration SHALL NOT describe a plan as ready to apply unless applying it would proceed, and an unsuccessful preview or apply SHALL name a reason rather than reporting failure only through its exit status.

#### Scenario: A Store with no permanent identity refuses instead of claiming readiness
- **WHEN** a legacy flat Store carries no permanent identity and holds no active Changes
- **THEN** the preview refuses, names the missing Store identity, and names the identity repair
- **AND** it never reports the plan as ready to apply
- **AND** the apply attempt refuses with the same reason rather than reprinting the plan

#### Scenario: A refusal never reports failure by exit status alone
- **WHEN** a preview or an apply attempt does not succeed, for any reason
- **THEN** its output names the blocking reason and its repair
- **AND** no output describing the plan as ready to apply is produced

#### Scenario: An empty Store with no permanent identity still names the identity
- **WHEN** a legacy flat Store holds no specs, Changes, or archive entries and carries no permanent identity
- **THEN** the refusal still names the missing Store identity and its repair

### Requirement: Migration refusals name the item, the reason, and a workable repair
Every migration refusal SHALL name the specific item or file it refuses, the reason class, and a concrete repair the operator can execute; a refusal whose suggested repair is itself refused by the flow SHALL be treated as a defect of this capability.

#### Scenario: A stale plan names what moved
- **WHEN** flat content changes on disk between plan and apply
- **THEN** apply refuses as stale, lists each changed path, and instructs re-planning
- **AND** confirms nothing was written, moved, or deleted

#### Scenario: An item name that cannot address a v2 destination says so
- **WHEN** a flat Change directory name is not a form the layout v2 address contract accepts, while its owning project id is
- **THEN** the refusal names the item name as the cause rather than the project id
- **AND** the repair is to rename the item in the Store worktree, stating that the mapping file cannot rename an item
