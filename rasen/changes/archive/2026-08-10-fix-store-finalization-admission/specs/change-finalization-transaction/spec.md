## MODIFIED Requirements

### Requirement: Association completion is a phase of the transaction

The binding's terminal state SHALL be a recorded phase of the finalization transaction, ordered after the record is durable and before the active Change directory is removed, and the transaction SHALL NOT report completion until it lands. The phase SHALL record the outcome, published entry address, and archive timestamp in the machine workspace binding, and SHALL mark the execution-side association's Change as finalized so a later mutation from that checkout does not resolve an archived Change as active. It SHALL NOT modify the planning-worktree marker, remove a worktree, or delete a branch.

Planning a non-noop pair SHALL unconditionally derive and freeze its execution-association path from the admitted execution root. If the association document is absent, planning SHALL report a pre-mutation `planning_execution_binding_mismatch` blocker and SHALL NOT produce an applicable saved transaction. Association/index agreement SHALL compare the immutable Store, scope, Change, pair, root, repository, and worktree identities; cached branch and head projections SHALL NOT redefine the pair. Applying SHALL still validate live Git membership, refs, and heads against the facts frozen by the plan. A missing index entry SHALL be repaired from the frozen pair plus live Git; a disagreeing entry SHALL fail closed with the published entry retained and the journal naming the phase. A scope with no workspace pair SHALL make the phase an explicitly planned no-op.

Association and index writes SHALL use the shared workspace atomic-write authority. An unjournaled exact intent may resume only the independently requested target, bytes, and before-state. A journal-bound call SHALL require its exact recorded carrier authority and SHALL NOT fall back. Every cleanup and tolerated directory-durability outcome SHALL retain the workspace module's identity revalidation contract on Windows, macOS, and Linux.

#### Scenario: A crash before the phase resumes and completes

- **WHEN** the transaction is interrupted after the record is durable and before the binding is updated
- **THEN** the transaction SHALL NOT report completion
- **AND** re-applying the same token SHALL complete the phase rather than duplicating any earlier step

#### Scenario: A disagreeing binding fails closed and stays recoverable

- **WHEN** the recorded binding names a different Change instance or a worktree that is no longer one of the recorded repository's worktrees
- **THEN** the phase SHALL fail closed naming both values
- **AND** the published entry SHALL remain and the journal SHALL identify the unfinished phase

#### Scenario: No workspace pair is a planned no-op

- **WHEN** the scope has no workspace pair, no binding entry, and no markers
- **THEN** the plan SHALL declare the phase a no-op in advance
- **AND** applying SHALL complete without writing a binding

#### Scenario: Ordinary commits before planning preserve pair identity

- **WHEN** either worktree receives a normal commit after binding but before finalization planning
- **THEN** planning freezes the current live ref and head while preserving the same immutable workspace pair
- **AND** applying that unchanged plan SHALL not fail after publication merely because the index cached an older head

#### Scenario: Git movement after planning remains stale

- **WHEN** a frozen worktree ref or head moves after finalization planning and before a fresh apply
- **THEN** apply SHALL refuse the stale plan before its first mutation
- **AND** it SHALL NOT repair the live Git fact from the older index projection

#### Scenario: Missing association blocks before transaction persistence

- **WHEN** a bound pair's derived execution association document is absent during planning
- **THEN** the non-applicable plan SHALL freeze the expected path and report `planning_execution_binding_mismatch`
- **AND** no transaction-store plan, canonical spec, archive entry, or association mutation SHALL be created

#### Scenario: Exact self-contained association intent resumes

- **WHEN** an unjournaled association/index write finds the exact durable intent for the independently requested target, bytes, and stable before-state
- **THEN** it SHALL establish or resume the proved claim, publish without clobbering, and clean only carriers whose identities are revalidated
- **AND** a different target, bytes, state, or replaced carrier SHALL remain intact and be refused

#### Scenario: Journal-bound association write never falls back

- **WHEN** association recovery supplies recorded external carrier authority that disagrees with a retained self-contained claim
- **THEN** the write SHALL retain the evidence and fail with the workspace conflict
- **AND** it SHALL NOT adopt the claim through the unjournaled recovery path

## ADDED Requirements

### Requirement: Store finalization preserves complete typed preparation blockers

Store finalization SHALL carry every `SpecReconciliationIssue` produced during archive preparation into its immutable preview and external responses with the original code, source, capability, optional requirement, optional missing-scenario list, message, and deterministic occurrence order. It SHALL produce one blocker per issue without source-wide or capability-wide deduplication. `finalization_spec_skip_conflict` SHALL be used only for an intentional spec-sync skip or decline, never as a replacement for preparation failures that happened to produce no actions.

#### Scenario: Several issues in one capability remain separate

- **WHEN** spec preparation returns several typed reconciliation issues from one source or capability, including issues for different requirements
- **THEN** the Store finalization preview SHALL contain the complete ordered issue array with every typed field unchanged
- **AND** no issue SHALL be removed because another issue shares its source or capability

#### Scenario: Failed preparation is not rewritten as a skip conflict

- **WHEN** reconciliation produces no actions because it returned typed issues
- **THEN** finalization SHALL be non-applicable with all of those issues
- **AND** it SHALL NOT replace them with `finalization_spec_skip_conflict`

#### Scenario: Intentional decline keeps the generic skip refusal

- **WHEN** a landed Change has valid preparable deltas but the operator explicitly requests or confirms skipping spec synchronization
- **THEN** finalization SHALL refuse with `finalization_spec_skip_conflict`
- **AND** the generic refusal SHALL not be used for any reconciliation failure

### Requirement: Store finalization consumes shared selection and archive recovery authority

Store finalization SHALL resolve its project through the shared canonical main-first project selection and SHALL refuse normalized registry/config identity drift or conflicting canonical aliases before planning content or transaction state is mutated. Stored apply and abort SHALL use the archive engine's cleaner deletion authority, transaction-operation lock, abort/retry phase decision, platform path identity, and plan-derived destructive operands without a finalization-specific classifier.

#### Scenario: Registry and config drift refuses finalization without side effects

- **WHEN** Store finalization selects a canonical project whose registry identity disagrees with its normalized config identity, or whose canonical alias group has conflicting live fixed metadata
- **THEN** selection SHALL fail with the established planning or registry conflict before the finalization plan is persisted
- **AND** registry, config, transaction store, canonical specs, and active Change bytes SHALL remain unchanged

#### Scenario: Finalization abort uses archive ownership semantics

- **WHEN** a stored Store finalization token is submitted for abort or retry
- **THEN** its eligibility, retained paths, destructive operands, cleaner authority, and recovery disposition SHALL be the archive engine's result
- **AND** finalization SHALL only preserve and report that result, never relax or reclassify it
