## MODIFIED Requirements

### Requirement: Change Selection

The command SHALL support both interactive and direct change selection methods. Interactive selection SHALL list active Changes and SHALL NOT consult migration receipts. Direct selection SHALL prefer an exact real active Change and SHALL perform normal Change validation and finalization whenever one exists, even if historical evidence mentions the same spelling.

Only ordinary direct-selector planning in a resolved Store v2 scope MAY query migration receipts after the exact active source is not found. One readable version 2 receipt for the current Store identity and current ref that uniquely proves the exact alias was converted from `active-change` to a Store Issue SHALL make selection fail non-zero with `legacy_coordinator_became_issue`, the Issue id, and `rasen store issue show <issue-id> --store <store-id>`, without mutation. A version 1, invalid, unreadable, ambiguous, other-Store, other-ref, or archived-source receipt SHALL NOT prove an active-alias conversion and SHALL NOT resolve an Issue.

Token-owned `--apply-plan` and `--abort-plan` routes SHALL retain their early dispatch before root resolution, Change lookup, or receipt access. Interactive selection, `--intent-template`, and any route other than ordinary direct-selector planning SHALL NOT query conversion receipts or produce the compatibility result.

#### Scenario: Interactive selection

- **WHEN** no change-name is provided
- **THEN** display interactive list of available changes (excluding archive/)
- **AND** allow user to select one

#### Scenario: Direct selection

- **WHEN** change-name is provided and an exact active Change exists
- **THEN** use that change directly
- **AND** validate it exists

#### Scenario: Proven active coordinator conversion points to Issue show

- **WHEN** ordinary direct `rasen archive <legacy-alias>` finds no active Change and the current Store ref has one valid version 2 receipt proving that active alias became Issue `<issue-id>`
- **THEN** archive SHALL exit non-zero with `legacy_coordinator_became_issue` and the existing Issue show command
- **AND** no Issue state, Change, Archive entry, spec, receipt, Store file, member-project file, or Git state SHALL be modified

#### Scenario: Real Change lookup wins

- **WHEN** a real active version 2 Change resolves for the supplied direct selector even if a historical receipt mentions the same legacy spelling
- **THEN** archive SHALL continue through the normal Change finalization plan and apply contract
- **AND** SHALL NOT consult the receipt as a redirect or replace the Change with an Issue

#### Scenario: Other refs and version 1 receipts do not prove conversion

- **WHEN** conversion evidence exists only in another Store, another ref, an invalid or unreadable receipt, an ambiguous set of receipts, or a version 1 receipt
- **THEN** archive SHALL retain its ordinary outcome, unresolved, or unreadable-evidence ordering
- **AND** SHALL NOT claim that the alias became an Issue

#### Scenario: Archived source does not become an active-alias redirect

- **WHEN** a receipt records that a legacy Archive entry, rather than an active legacy Change, was imported as an Issue
- **THEN** direct active Change archive lookup SHALL NOT treat that receipt as an alias conversion
- **AND** SHALL preserve ordinary outcome and change-not-found ordering

#### Scenario: Non-direct routes never query conversion receipts

- **WHEN** archive uses interactive selection, `--intent-template`, `--apply-plan`, or `--abort-plan`
- **THEN** it SHALL follow that route's existing dispatch and validation without querying conversion receipts
- **AND** it SHALL NOT return `legacy_coordinator_became_issue` from that route

### Requirement: Store v2 archiving declares its outcome on the command line

`rasen archive` SHALL accept `--outcome <landed|superseded|cancelled|abandoned>`, `--reason <text>`, `--by <changeInstanceId>`, `--by-target-line <id>`, and `--commit <oid>`. In a Store v2 project scope `--outcome` SHALL be required; its absence SHALL fail with `finalization_outcome_required` before any mutation, naming all four outcomes and their reason and successor requirements. `--reason` SHALL be required by every non-landed outcome and refused for `landed`; `--by` SHALL be required by `superseded` and refused otherwise; `--by-target-line` SHALL only narrow the successor search and SHALL never substitute for successor verification; `--commit` SHALL only supply the candidate commit for a landed proof and SHALL never bypass it. There SHALL be no flag that declares a change planning-only at archive time. Outside a Store v2 project scope these options SHALL be rejected as inapplicable rather than silently ignored.

Command-shape and token-route conflicts that are decided before ordinary planning SHALL retain first precedence. In particular, combining a change name or planning options with token-owned `--apply-plan` or `--abort-plan` SHALL return `archive_option_conflict` before root resolution and SHALL perform zero receipt queries. On ordinary direct-selector planning, a real active Change SHALL win and remain subject to the Store v2 outcome contract, including `finalization_outcome_required`. If the exact source is absent and one current-Store/current-ref receipt uniquely proves an `active-change` conversion, `legacy_coordinator_became_issue` SHALL be returned before outcome interpretation, whether or not finalization options were supplied. If conversion is not proven, the existing outcome-validation and unresolved/not-found ordering SHALL resume unchanged.

#### Scenario: Missing outcome refuses before mutation

- **WHEN** `rasen archive <change> --yes --json` resolves a real active Change in a Store v2 project scope with no `--outcome`
- **THEN** the command SHALL exit non-zero with `finalization_outcome_required` and name the four outcomes
- **AND** no spec, change directory, or archive entry SHALL be written

#### Scenario: Outcome options outside Store v2 are rejected, not ignored

- **WHEN** `--outcome` is supplied in a standalone project or a legacy flat Store
- **THEN** the command SHALL reject the option explaining where it applies
- **AND** it SHALL NOT archive while discarding the option

#### Scenario: A supplied commit still has to prove reachability

- **WHEN** `--outcome landed --commit <oid>` names a commit that is not an ancestor of the target line's code ref
- **THEN** the command SHALL refuse naming the commit and the ref
- **AND** the change SHALL remain active

#### Scenario: Token option conflict wins without receipt access

- **WHEN** `--apply-plan` or `--abort-plan` is combined with a change name or an option owned by ordinary planning
- **THEN** archive SHALL return `archive_option_conflict` before resolving a root, Change, outcome, or receipt
- **AND** receipt-query instrumentation SHALL record zero reads

#### Scenario: Proven missing-source conversion precedes outcome interpretation

- **WHEN** ordinary direct archive finds no active source and one in-scope version 2 receipt proves that alias was converted from `active-change` to an Issue
- **THEN** archive SHALL return `legacy_coordinator_became_issue` with or without `--outcome`
- **AND** no finalization option SHALL be interpreted, forwarded, or executed

#### Scenario: Inconclusive conversion restores existing outcome ordering

- **WHEN** ordinary direct archive finds no active source and conversion evidence is absent, invalid, unreadable, ambiguous, from another Store/ref, or for an archived source
- **THEN** archive SHALL resume the pre-compatibility outcome-validation and unresolved/not-found ordering
- **AND** it SHALL NOT select an Issue or invent conversion proof

## ADDED Requirements

### Requirement: Archive options never become Issue state or acceptance

The compatibility diagnostic SHALL NOT forward, translate, or apply archive confirmation, validation, outcome, reason, successor, target-line, commit, spec-sync, ephemera, dry-run, resume, or other ordinary-planning options to the Issue. Token-owned apply/abort options SHALL never reach this diagnostic and SHALL retain their own dispatch or `archive_option_conflict`. Human output MAY separately suggest the existing operator-declared Issue state command, but SHALL state that this is a distinct action and SHALL never execute it. JSON output SHALL carry the same code, Issue id, non-forwarding result, and continuation commands as human output.

#### Scenario: Finalization flags are not forwarded

- **WHEN** a proven converted alias reaches ordinary direct-selector planning with any archive outcome, reason, successor, commit, confirmation, or other option owned by that route
- **THEN** archive SHALL return `legacy_coordinator_became_issue` without applying any option to the Issue
- **AND** SHALL NOT report archive success, Issue resolution, acceptance, delivery, or Dispatch completion

#### Scenario: State suggestion remains a separate operator action

- **WHEN** human output suggests `rasen store issue state` after reporting the converted alias
- **THEN** it SHALL identify that command as an independent operator declaration rather than a continuation of archive
- **AND** the current invocation SHALL leave the Issue record byte-identical

#### Scenario: Human and JSON diagnostics agree

- **WHEN** the converted-alias diagnostic is requested in human and JSON modes
- **THEN** both SHALL report `legacy_coordinator_became_issue`, the same Store and Issue identities, and equivalent show and optional state guidance
- **AND** both SHALL report that no archive or Issue mutation occurred
