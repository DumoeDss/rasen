## Requirement: A Store created before permanent identities keeps working

A Store whose metadata predates permanent identities SHALL remain fully readable and usable. Commands SHALL resolve it, report it, and operate on it exactly as before, while noting that it has no permanent identity yet and naming the command that would add one. Reading a Store SHALL NOT modify its metadata; the permanent identity SHALL be added only when the user explicitly runs the identity upgrade — either the single-store `rasen store upgrade-identity <store> --apply` or the batch `rasen store upgrade-identity --all --apply`, or implicitly as the store-identity migration step of `rasen update` (which the user explicitly invoked).

#### Scenario: Legacy Store resolves unchanged

- **WHEN** a command resolves a Store whose metadata has no permanent identity
- **THEN** the command succeeds and operates on that Store exactly as before
- **AND** the output notes that the Store has no permanent identity yet and names the upgrade command

#### Scenario: Reading never upgrades

- **WHEN** any read-only command resolves, lists, or diagnoses a Store whose metadata has no permanent identity
- **THEN** the Store's metadata file is left byte-identical
- **AND** no permanent identity is minted

#### Scenario: Upgrading is explicit and previewable

- **WHEN** a user runs the Store identity upgrade in preview mode
- **THEN** the command reports every file it would write and changes nothing
- **AND** running it in apply mode writes the permanent identity into the Store's metadata and records it in the machine's Store registry

#### Scenario: Batch upgrade previews every affected file

- **WHEN** a user runs `rasen store upgrade-identity --all` without `--apply`
- **THEN** the command reports every Store that would gain a permanent identity, every project whose `storeMemberships` hint would gain a uid, and whether the machine registry would be re-keyed
- **AND** no file is modified

#### Scenario: Batch upgrade applies all eligible stores

- **WHEN** a user runs `rasen store upgrade-identity --all --apply`
- **THEN** every registered Store whose metadata lacks a permanent identity gains one
- **AND** every registered project whose `storeMemberships` names an upgraded Store by alias alone gains the uid in that hint
- **AND** the machine registry is re-keyed by permanent identity when every Store entry now carries one

#### Scenario: `rasen update` performs the batch migration

- **WHEN** a user runs `rasen update` (without `--only-this`) and one or more registered Stores lack a permanent identity
- **THEN** the update command performs the same batch migration as `rasen store upgrade-identity --all --apply`
- **AND** reports the outcome in its summary
- **AND** the migration is best-effort: a failure emits a warning and does not abort the update

#### Scenario: Unresolvable Stores are reported and skipped

- **WHEN** the batch migration encounters a registered Store whose path is missing, whose metadata is unreadable, or that is locked
- **THEN** the Store is skipped with a human-readable reason
- **AND** the batch continues with the remaining Stores
- **AND** the machine registry re-key reports any Stores that still block it
- **AND** the batch never throws on a per-Store failure

#### Scenario: Identityless membership hints are backfilled

- **WHEN** a Store gains a permanent identity through the batch migration
- **AND** a registered project's `storeMemberships` hint names that Store by alias without a uid
- **THEN** the hint gains the Store's permanent identity
- **AND** the hint's alias and remote fields are preserved
- **AND** re-parsing that project's configuration SHALL NOT emit the `storeMembershipsWithoutIdentity` warning for that Store

#### Scenario: Batch migration is idempotent

- **WHEN** the batch migration runs a second time after all eligible Stores have been upgraded
- **THEN** no Store metadata is written
- **AND** no project hint is modified
- **AND** the registry re-key is a no-op
- **AND** the summary reports that all Stores already carry a permanent identity

## Requirement: The machine's Store registry records Stores by permanent identity

The machine's Store registry SHALL identify Store entries by permanent identity, keeping the display alias as a lookup index that MAY match several entries. An existing registry SHALL be read exactly as written, and SHALL be rewritten in the new form only after a command the user ran to change it. A rewrite SHALL be refused, with the affected entries named, when any Store entry has no permanent identity to key on; the registry SHALL then keep its existing form rather than having identities invented for it. Registry writes SHALL be atomic, so an interrupted write never leaves a partially written registry.

The batch identity migration (`rasen store upgrade-identity --all --apply` and the `rasen update` migration step) SHALL trigger the registry re-key attempt after minting identities for all eligible Stores. Stores that cannot be resolved SHALL be named as blocking the re-key; the registry SHALL keep its alias-keyed form until those Stores are resolved or unregistered.

#### Scenario: An existing registry is read unchanged

- **WHEN** any read-only command reads a registry written before this capability
- **THEN** every entry resolves as it did before
- **AND** the registry file is left byte-identical

#### Scenario: An explicit change rewrites the registry in the new form

- **WHEN** a user runs a command that registers, unregisters, or removes a Store, and every Store entry has a permanent identity
- **THEN** the registry is rewritten keyed by permanent identity with the alias recorded in each entry

#### Scenario: A rewrite is refused rather than inventing identities

- **WHEN** a registry rewrite is attempted while some Store entry has no permanent identity
- **THEN** the command reports which entries need the identity upgrade first
- **AND** the registry keeps its existing form with no identity minted for those entries

#### Scenario: Batch migration re-keys after upgrading all eligible Stores

- **WHEN** the batch migration has minted identities for every Store whose path is reachable and whose metadata is readable
- **AND** no remaining Store entry lacks a permanent identity
- **THEN** the registry is rewritten keyed by permanent identity
- **AND** the batch summary reports the re-key succeeded

#### Scenario: Batch migration reports Stores that still block the re-key

- **WHEN** the batch migration has upgraded all reachable Stores
- **AND** one or more registered Stores remain unresolvable (path missing, metadata unreadable, or locked)
- **THEN** the registry keeps its alias-keyed form
- **AND** the batch summary names the unresolvable Stores that block the re-key
- **AND** the user is directed to unregister or repair those Stores

#### Scenario: Two Stores may share a display alias

- **WHEN** two Stores with different permanent identities are registered with the same display alias
- **THEN** both registrations are retained as distinct entries
- **AND** resolving that alias reports ambiguity rather than choosing one

## Requirement: Store identity warnings are deduplicated per invocation

The `storeMembershipsWithoutIdentity` warning SHALL fire at most once per command invocation, regardless of how many times the project configuration is parsed during that invocation. A warning that the user has already seen within the same command SHALL NOT repeat. This deduplication SHALL apply to warning-level diagnostics only; error-level diagnostics SHALL remain emitted on every occurrence.

#### Scenario: Warning fires once despite multiple parses

- **WHEN** a command parses a project configuration whose `storeMemberships` contains identityless entries multiple times during a single invocation
- **THEN** the `storeMembershipsWithoutIdentity` warning is emitted at most once

#### Scenario: Warning message names `rasen update` as the remediation

- **WHEN** the `storeMembershipsWithoutIdentity` warning is emitted
- **THEN** the message directs the user to run `rasen update`, which performs the batch identity migration automatically
