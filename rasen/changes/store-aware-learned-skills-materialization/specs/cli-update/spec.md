## ADDED Requirements

### Requirement: Update reconciles typed effective learned-skill ownership

`rasen update` SHALL resolve the same project/store/global effective plan as
init for every configured tool. It SHALL refresh precedence or provenance
changes, add newly effective records, remove only exact unchanged copies whose
sources are authoritatively no longer effective, preserve user-owned or
uncertain files, and persist typed source identities. Effective store conflicts
and context-budget failures SHALL be detected before any learned-skill file or
learned-ledger write.

#### Scenario: Project retirement falls back to store

- **WHEN** update finds that a previously effective project record retired and an applicable member-store record now wins
- **THEN** it refreshes the unchanged managed target with store provenance
- **AND** records the new typed resolution

#### Scenario: Store membership removal prunes exact copy

- **WHEN** a store is authoritatively no longer a member and no project/store/global fallback exists
- **AND** the materialized target still matches its generated digest
- **THEN** update removes that exact copy and typed ledger entry

#### Scenario: Unavailable prior store defers pruning

- **WHEN** the typed ledger names a prior store source that cannot be evaluated
- **THEN** update preserves the unchanged target and reports deferred cleanup

#### Scenario: Conflict leaves all learned state unchanged

- **WHEN** update resolves a divergent effective store conflict
- **THEN** it performs no learned additions, refreshes, removals, or ledger migration for the run
- **AND** reports every conflicting typed source

#### Scenario: User-modified copy survives effective change

- **WHEN** a materialized target differs from the digest recorded by its ledger
- **THEN** update leaves the target byte-for-byte unchanged
- **AND** reports that Rasen no longer owns the exact bytes

### Requirement: Update migrates legacy learned ledger entries conservatively

The update command SHALL migrate legacy learned ownership conservatively. When
a project has legacy learned entries in its workflow artifact ledger and no
authoritative typed learned ledger, update SHALL migrate those entries to
typed project/global sources using the resolved project identity. It SHALL
write the dedicated learned ledger atomically before removing only the legacy
learned sections, preserve all workflow ownership, and recover idempotently if
both representations remain after interruption.

#### Scenario: Successful migration preserves ownership

- **WHEN** legacy project/global learned entries still match their generated files
- **THEN** update records their typed sources and exact file digests in the dedicated ledger
- **AND** preserves ordinary workflow entries

#### Scenario: Migration does not claim modified file

- **WHEN** a legacy tracked learned file no longer matches its recorded digest
- **THEN** update preserves the file
- **AND** does not claim it as an exact typed managed copy

#### Scenario: Retry after partial migration is idempotent

- **WHEN** both typed and legacy learned entries exist after an interrupted prior migration
- **THEN** update treats the typed ledger as authoritative
- **AND** clears duplicate legacy learned sections without regenerating or deleting the target

### Requirement: Update reports learned reconciliation outcomes

Update human and JSON output SHALL separately report learned additions,
provenance/content updates, removals, skips, equivalent-store deduplication,
conflicts, unavailable stores, deferred actions, and no-op results. Store
sources SHALL be type-qualified, result ordering SHALL be deterministic, and
the command SHALL not claim full learned reconciliation when a conflict,
budget, or unavailable-source safety condition remains.

#### Scenario: Provenance-only update is visible

- **WHEN** materialized instructions remain the same but their typed effective sources change
- **THEN** update reports the source transition and refreshes the resolution identity as needed

#### Scenario: Equivalent stores are summarized once

- **WHEN** several stores contribute one exact effective item
- **THEN** update reports one learned item with every sorted contributing store ID

#### Scenario: Already reconciled set is a no-op

- **WHEN** desired content, typed sources, exact target bytes, and ledger entries all agree
- **THEN** update reports no learned changes and does not rewrite the files or ledgers
