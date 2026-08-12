## ADDED Requirements

### Requirement: Canonical publication makes a stored archive transaction non-abortable
The archive command SHALL refuse stored-plan abort after any canonical spec target has been published, including when a crash occurs before the action progress or aggregate transaction phase records that publication. It SHALL preserve the transaction evidence and offer exact-token replay whenever replay can still advance safely.

#### Scenario: Publication-to-progress crash refuses abort
- **WHEN** apply publishes a canonical spec target and crashes before recording the corresponding progress or phase advancement
- **THEN** stored abort fails with `archive_abort_phase_unsafe`
- **AND** the canonical target, active source, stage, journal, and stored plan token remain byte-for-byte unchanged by the abort attempt

#### Scenario: Exact-token replay completes after refused abort
- **WHEN** a stored abort was refused in the publication-to-progress crash window and the owned recovery carriers remain intact
- **THEN** applying the exact stored token resumes the same transaction and completes it

### Requirement: Stored archive abort uses platform-correct path ownership
The archive command SHALL evaluate every destructive abort binding with one platform path-identity policy. Equivalent owned path spellings SHALL authorize cleanup only of paths derived from the stored plan, while a path that resolves outside the owned target SHALL refuse abort without modifying that outside path.

#### Scenario: Equivalent Windows spellings authorize only owned cleanup
- **WHEN** an early stored transaction on Windows records an owned binding using different drive-letter case, mixed separators, or equivalent dot segments
- **THEN** abort recognizes the binding as the same owned target
- **AND** cleanup removes only the canonical transaction targets derived from the stored plan

#### Scenario: Windows sibling or traversal spelling is refused
- **WHEN** an abort carrier on Windows spells a sibling target or resolves through traversal to a path outside the plan-owned target
- **THEN** abort reports an ownership or plan-mismatch blocker
- **AND** the outside target and its sentinel content remain unchanged
