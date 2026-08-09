## ADDED Requirements

### Requirement: Applying an existing Change completes its workspace binding

When an applicable workspace plan carries the verified identity of an already-created Change, applying the plan SHALL complete the binding after both planned worktrees and their local binding records are available. When both live worktree identities can be verified, the apply result and workspace index SHALL report `bound` with the same valid `WorkspacePairId`; the identity SHALL remain re-verifiable from the Change instance and the two recorded worktree instances on every supported platform. Applying SHALL preserve `prepared` without a pair identity when the execution worktree identity is unavailable, and SHALL refuse rather than reconcile target-line or worktree identity disagreement.

#### Scenario: Existing-change apply records a verified pair

- **WHEN** an applicable existing-change plan is applied and both planned worktrees have verifiable identities
- **THEN** apply SHALL return `bindingState: bound` and a valid workspace pair identity
- **AND** the workspace index SHALL record the same Change instance and workspace pair identities

#### Scenario: Inspection and finalization see the completed pair

- **WHEN** workspace inspection and archive dry-run are requested after a successful existing-change apply
- **THEN** workspace inspection SHALL report the binding as bound with the recorded pair identity
- **AND** archive dry-run SHALL NOT report `workspace_pair_unavailable`

#### Scenario: Re-applying the plan is idempotent

- **WHEN** the same existing-change plan is applied again after it completed successfully
- **THEN** it SHALL return the same bound pair identity without creating another worktree or binding
- **AND** the recorded Change instance and workspace pair identities SHALL remain unchanged

#### Scenario: Missing execution identity leaves an incomplete pair

- **WHEN** binding completion cannot re-derive a live execution worktree identity
- **THEN** the binding SHALL remain `prepared` and SHALL record no workspace pair identity
- **AND** it SHALL NOT fabricate an execution identity from the planned path or another locator

#### Scenario: Drift refuses binding completion

- **WHEN** a worktree identity or the Change's target line disagrees with the frozen and recorded binding facts during existing-change apply
- **THEN** binding completion SHALL be refused with the disagreement identified
- **AND** no carrier SHALL be rewritten to make the facts agree

#### Scenario: Cleanup removes a completed existing-change pair

- **WHEN** cleanup is planned and applied for a safe pair completed by existing-change apply
- **THEN** both recorded worktrees and that pair's workspace index entry SHALL be removed
- **AND** no other worktree, binding, Change, branch, or main checkout SHALL be modified
