## ADDED Requirements

### Requirement: Archive recovery proves cleaner deletion ownership losslessly
An archive plan SHALL bind every planned cleaner deletion to lossless file identity and content authority captured from the opened file. Apply and exact-token recovery SHALL validate the complete authority collection before interpreting cleaner progress or absence. The source SHALL prove the complete plan-time identity immediately before claim; when rename changes platform metadata, the engine SHALL verify a rename-stable transition and bind the private claim to the complete post-rename identity before deletion. Rounded numeric identity SHALL NOT authorize either boundary.

#### Scenario: Unchanged Windows candidate reaches the planned late phase
- **WHEN** a Windows file identifier cannot be represented exactly as a JavaScript number and the planned cleaner candidate remains unchanged
- **THEN** apply accepts its lossless authority, accounts for the deletion, and continues to the planned accounting or source-removal operation

#### Scenario: Source-removal fault is not masked by cleaner identity rounding
- **WHEN** a transaction with unchanged planned cleaner candidates injects a failure at source removal
- **THEN** the recoverable result reports the injected source-removal operation and error rather than `archive_cleaner_ownership_unverified`
- **AND** applying the exact token after the injected fault is removed resumes and completes the transaction

#### Scenario: Replaced cleaner candidate fails closed
- **WHEN** a planned cleaner candidate is replaced or its exact identity or content changes before deletion
- **THEN** apply refuses cleaner ownership, retains recovery evidence, and leaves the unproved object undeleted

#### Scenario: Same bytes with changed exact metadata fail closed
- **WHEN** a candidate keeps the planned bytes, device, inode, mode, and size but its exact timestamps change before claim, or its complete identity changes after the verified rename transition
- **THEN** apply refuses cleaner ownership and retains the candidate or private claim for manual recovery

#### Scenario: Verified claim restoration remains exactly replayable
- **WHEN** a cleaner attempt fails after the engine-owned claim and the engine safely restores the same object through a no-replace name transition
- **THEN** the journal records the complete restored identity
- **AND** exact-token retry uses that identity rather than weakening the original plan predicate or trusting later absence

#### Scenario: Legacy delete plan without exact authority is retained
- **WHEN** a stored legacy plan requests cleaner deletion but contains no trustworthy lossless deletion authority
- **THEN** apply refuses the deletion and retains the transaction for manual recovery or replanning

#### Scenario: Legacy plan with no cleaner deletion remains replayable
- **WHEN** a stored legacy plan has no effective cleaner deletion
- **THEN** the absence of cleaner deletion authority does not by itself block exact-token recovery
