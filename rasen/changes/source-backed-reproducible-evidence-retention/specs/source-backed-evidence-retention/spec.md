## ADDED Requirements

### Requirement: Evidence distinguishes regeneration from historical observation

Rasen's generated evidence guidance SHALL distinguish deterministic regeneration, reanalysis of retained historical observations, and experimental reruns. Users SHALL receive the actual evidence mode and verification limits with a claim. A source revision SHALL identify code, while an actual run record SHALL establish what was observed.

#### Scenario: Deterministic fixture is replaced by a verified recipe

- **WHEN** a fixture can be generated from pinned source, identified inputs, and a seed where relevant
- **THEN** guidance SHALL allow its durable representation to be the recipe and expected digest after successful regeneration verification
- **AND** a check that has not run SHALL be reported as unverified rather than successful reproduction

#### Scenario: Performance measurement is rerun

- **WHEN** the same committed measurement program is run again
- **THEN** its result SHALL be described as a new observation
- **AND** the original result and its failures SHALL retain their historical meaning

#### Scenario: Historical conclusion is reanalyzed

- **WHEN** retained original samples are processed by an identified analysis program
- **THEN** the record SHALL distinguish the reanalysis from a new experiment and identify the original observation set
- **AND** verification SHALL compare the declared aggregates and verdict, or exact output digest when byte identity is claimed

### Requirement: Reproduction recipes identify the actual dependencies of a claim

Generated guidance SHALL require a compact recipe when generated or collected evidence supports a claim. The recipe SHALL identify the question, mode, generator/analysis source, measured source when different, relevant executed-source deviations, inputs, command and working-directory base, configuration, relevant environment, expected output/result domain, and performed checks. Fields SHALL be proportional to the claim and SHALL reuse existing report/index metadata instead of duplicating it per sample. Ordinary source-review findings SHALL retain their source references without inventing a collection recipe.

#### Scenario: Analysis source differs from the measured implementation

- **WHEN** a report generator and the measured implementation come from different repositories or revisions
- **THEN** their repository and full commit identities SHALL be recorded separately
- **AND** the entry point, inputs, toolchain/dependency identity, and relevant execution conditions SHALL be available to a later reader

#### Scenario: Execution includes uncommitted source

- **WHEN** the actual execution uses modified or untracked source files
- **THEN** the record SHALL identify preserved deviations and their content digests or state that executed-source identity is incomplete
- **AND** a clean commit identity alone SHALL not be presented as the complete identity of that execution

#### Scenario: Generated report contains variable metadata

- **WHEN** output contains timestamps or other intentionally variable fields
- **THEN** the recipe SHALL state the stable comparison domain and the check actually performed
- **AND** a semantic comparison SHALL remain distinguishable from whole-file byte verification

### Requirement: Compact summaries reference a sufficient original observation set

Generated guidance SHALL keep the current decision, essential aggregates, limitations, and evidence references in the canonical report or existing index. It SHALL direct agents to retain each required observation once and regenerate derived detail on demand, rather than embed full sample arrays or raw logs into successive summaries. The retained observation set SHALL be sufficient to audit the reported claim, including relevant failures, exclusions, and incomplete attempts.

#### Scenario: Aggregate report references detailed samples

- **WHEN** a summary and a detailed report are produced from retained attempt records
- **THEN** the summary SHALL identify the originals and the analysis recipe without copying the full observation arrays
- **AND** the detailed report SHALL be treated as regenerable when the declared regeneration check succeeds

#### Scenario: Claim requires distribution-level evidence

- **WHEN** a percentile or repeatability claim depends on individual samples
- **THEN** the guidance SHALL preserve the samples and their inclusion/exclusion meaning needed to recompute that claim
- **AND** storage reduction SHALL not substitute aggregate values for the required observations

#### Scenario: Collection has an explicit decision scope

- **WHEN** a new evidence collection campaign is planned
- **THEN** guidance SHALL establish the intended claim, required observations, stopping condition, and retention handling before collection
- **AND** this scope SHALL preserve applicable acceptance gates and required sample counts

### Requirement: Evidence availability and execution authority remain explicit

Recipes SHALL identify the availability and access requirements of source and data, separately from their identity. Retained byte references SHALL include a locator with an explicit base, byte size, and SHA-256 when those bytes are available for identification. Missing or inaccessible dependencies SHALL be reported as reproduction limits. Reading a recipe SHALL preserve the user's control over command execution, data retrieval, and publication.

#### Scenario: Private original is outside the planning clone

- **WHEN** a report refers to an already retained private observation set
- **THEN** it SHALL describe its availability and approved access requirements without embedding private payloads or credentials
- **AND** a digest or Git clone SHALL not be described as possession or receiver verification of the original

#### Scenario: Referenced input cannot be retrieved

- **WHEN** required source or input bytes are unavailable
- **THEN** the report SHALL identify the missing dependency and the resulting verification limit
- **AND** the recipe SHALL not be marked successfully reproduced from that reference alone

#### Scenario: Reader encounters a recorded command

- **WHEN** verification or review reads a recipe
- **THEN** the command SHALL be treated as evidence data rather than implicit authorization to execute or fetch
- **AND** execution SHALL require a trusted command within the explicitly selected scope

#### Scenario: Recipe uses Windows paths

- **WHEN** a recipe identifies a Windows repository or a path containing spaces
- **THEN** it SHALL preserve the repository/working-directory base and platform-specific path meaning
- **AND** a reader SHALL not be instructed to interpret it as an unexplained POSIX-relative or current-directory-relative path

### Requirement: Evidence guidance reaches producers and consumers without changing existing gates

Rasen SHALL deliver consistent evidence-retention guidance through generated planning, collection, orchestration, verification, and delivery/retention workflows. Users SHALL continue to receive existing canonical report names, verdicts, and machine-readable test-evidence fields. Recipe information SHALL supplement these contracts rather than authorize test skipping, archival mutation, or automatic execution.

#### Scenario: Dispatched expert reports its results

- **WHEN** a dispatched report-only expert produces evidence
- **THEN** it SHALL incorporate the relevant recipe and observation references into its allowed canonical report and report unmet retention needs for the LEAD to route to an authorized writer
- **AND** it SHALL retain its existing output and execution restrictions without imposing canonical-report-only scope on other authorized stage writers

#### Scenario: Standalone expert has no active Change

- **WHEN** a standalone benchmark or investigation records evidence
- **THEN** it SHALL use its established standalone location and include the same relevant identity and retention information
- **AND** it SHALL not invent a Change or Store execution root

#### Scenario: Standalone benchmark captures repeat

- **WHEN** standalone benchmark runs or baseline captures repeat, including on the same day
- **THEN** new completed records SHALL use collision-free, Windows-safe identifiers within the established standalone roots and SHALL NOT overwrite historical originals
- **AND** reports SHALL cite immutable measurement and baseline locators, byte sizes, and SHA-256 values rather than a mutable working baseline alone
- **AND** a baseline capture SHALL retain one authoritative baseline JSON without duplicating its measurements in a run JSON

#### Scenario: Compatible working baseline is refreshed

- **WHEN** a standalone benchmark refreshes `baseline.json` for existing readers
- **THEN** it SHALL remain a working metrics copy, not a pointer schema or a second authoritative observation
- **AND** required legacy bytes SHALL first be retained and byte-verified with an old-locator/digest-to-retained-locator mapping and byte size in the new report
- **AND** if source access or authorization is unavailable, or an existing report requires the original locator unchanged, the working file SHALL remain in place and the new capture SHALL use its immutable baseline directly
- **AND** historical reports SHALL NOT be rewritten

#### Scenario: Existing report is consumed by ship or archive

- **WHEN** ship or archive reads an existing report without a reproduction recipe
- **THEN** its established verdict and test-evidence semantics SHALL remain unchanged
- **AND** recipe absence SHALL not create a retroactive hard gate

#### Scenario: Historical archive already contains duplicated detail

- **WHEN** the new guidance is installed or used to inspect an archive
- **THEN** the archived bytes, accounting, and hashes SHALL remain unchanged
- **AND** any relocation, deletion, or repacking SHALL remain a separate authorized operation
