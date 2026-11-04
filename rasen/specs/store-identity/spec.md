# store-identity Specification

## Purpose

Give a Store a permanent identity that survives renames and cannot collide across machines, demote its readable id to a display alias, let a project declare which Store it plans in durably, and make a Store that cannot be resolved an explicit, diagnosable, repairable state rather than one that silently reads as "this project has no Store".
## Requirements
### Requirement: A Store has a permanent identity distinct from its display name

Every Store SHALL carry an immutable identity that is created once, recorded in the Store's own metadata, and travels with the Store's repository. The Store's `id` SHALL be a display alias only: it MAY be renamed, it MAY be shared by two different Stores, and it SHALL NOT decide which Store is meant when a permanent identity is available. For a newly created Store the alias SHALL also be the new directory's final path segment. It SHALL NOT be restricted to a machine-oriented kebab-case grammar: readable values such as `Acme Store`, `研发计划.v2`, `acme_context`, and `-team` SHALL be valid. Only an empty or whitespace-only value, `.`, `..`, a path separator, a control character, or leading/trailing whitespace SHALL be rejected at the alias boundary. Creating a Store SHALL mint the permanent identity automatically; no command SHALL accept it as user input, and no command SHALL change it once written.

#### Scenario: Creating a Store mints a permanent identity

- **WHEN** a user creates a new Store
- **THEN** the Store's metadata records a newly minted permanent identity alongside the display alias
- **AND** the same identity is reported by every command that names that Store afterwards

#### Scenario: A readable Store name is not forced into a slug

- **WHEN** a user creates Stores named `Acme Store`, `研发计划.v2`, `acme_context`, or `-team`
- **THEN** each name is accepted unchanged as the Store's display alias and new directory name
- **AND** each Store receives a separate automatically minted permanent identity

#### Scenario: A value that is not one safe directory segment is rejected

- **WHEN** a user supplies an empty or whitespace-only Store name, `.`, `..`, a path separator, a control character, or leading/trailing whitespace
- **THEN** the Store name is rejected before metadata or registry state is written
- **AND** the diagnostic explains the directory-segment constraint rather than asking for kebab-case

#### Scenario: Renaming the display alias keeps the identity

- **WHEN** a Store's display alias is renamed
- **THEN** the Store's permanent identity is unchanged
- **AND** anything that named the Store by its permanent identity continues to resolve to the same Store

#### Scenario: The permanent identity cannot be supplied or overwritten

- **WHEN** a user registers a checkout of a Store that already has a permanent identity, passing a display alias
- **THEN** the existing permanent identity is preserved exactly
- **AND** no command offers an option to set or replace it

#### Scenario: A malformed identity is reported rather than accepted

- **WHEN** a Store's metadata carries an identity value that is not a well-formed identifier
- **THEN** reading that Store reports an invalid-metadata diagnostic naming the metadata file
- **AND** the value is never treated as a usable identity

### Requirement: A Store created before permanent identities keeps working

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

### Requirement: A project states which Store it plans in durably

A project's Store declaration SHALL be able to record the Store's permanent identity, its display alias for readability, and a credential-free remote so the Store can be located on a machine that has never seen it. The permanent identity SHALL be the authority. A declared alias that no longer matches the Store's own alias SHALL be reported as drift without blocking resolution, and a declared remote that differs from the Store's canonical remote SHALL be reported as an informational note. The existing single-name declaration SHALL keep working and SHALL resolve whenever that name matches exactly one Store on the machine.

#### Scenario: Durable declaration resolves by permanent identity

- **WHEN** a project declares a Store by permanent identity, alias, and remote, and that Store is registered on the machine
- **THEN** the Store resolves by permanent identity
- **AND** the output states that the identity, not the alias, was what resolved

#### Scenario: Alias drift is reported, not fatal

- **WHEN** a project's declaration names alias `team-store` but the Store's own alias is now `platform-store`, and the permanent identities agree
- **THEN** the Store still resolves
- **AND** a drift warning names both aliases and the command that refreshes the declaration

#### Scenario: Remote divergence is informational

- **WHEN** a project's declaration records a remote that differs from the Store's canonical remote
- **THEN** the Store still resolves
- **AND** an informational note shows both values side by side

#### Scenario: A single-name declaration still works

- **WHEN** a project declares a Store by name only and exactly one registered Store carries that name
- **THEN** the Store resolves
- **AND** the output notes the declaration is in the older form and names the command that upgrades it

#### Scenario: Nothing machine-specific is written into the project declaration

- **WHEN** a command writes or upgrades a project's Store declaration
- **THEN** the written value contains only the permanent identity, the alias, and a credential-free remote
- **AND** no filesystem path from this machine appears in the file, on any platform

### Requirement: Naming a Store by alias has explicit arity

Resolving a Store by display alias SHALL report one of exactly three outcomes. No alias match SHALL report that the Store is not available on this machine. Exactly one match SHALL resolve successfully. Two or more matches SHALL fail as ambiguous, listing every candidate with its permanent identity, alias, and local root, and SHALL NOT pick one. Resolving by permanent identity SHALL be exact and SHALL never consult the alias index.

#### Scenario: No match reports the Store is not available here

- **WHEN** a project declares a Store whose name matches no registered Store
- **THEN** the command reports that the Store is declared but not available on this machine
- **AND** the message carries a copy-pasteable command that would make it available

#### Scenario: Exactly one match resolves

- **WHEN** a declared alias matches exactly one registered Store
- **THEN** that Store resolves and the command proceeds

#### Scenario: Several matches are reported as ambiguous

- **WHEN** two registered Stores carry the same display alias and a project declares that alias
- **THEN** the command fails as ambiguous, listing both candidates with their permanent identities and local roots
- **AND** the repair command names the permanent identity to declare instead

### Requirement: A Store that cannot be used is reported, never treated as absent

When a project declares a Store that cannot be resolved, the system SHALL report the expected Store, the reason it cannot be used, and a copy-pasteable repair command, and SHALL stop rather than continuing as though the project had declared no Store. A project that declares no Store at all SHALL be unaffected. Configuration resolution in particular SHALL NOT fall through to global or default values for a project whose declared Store is unavailable.

Exactly five surfaces are carved out of stopping, because they are how a user learns the declaration is broken and would otherwise be unreachable in the state they exist for: the two diagnosis commands, listing the Stores registered on this machine, reading machine-scope configuration (which resolves no project layer, so no Store layer applies), and initialization's declaration guard. Each SHALL report rather than resolve, and SHALL write, clone, register, and repair nothing.

#### Scenario: Configuration does not silently fall through

- **WHEN** effective configuration is resolved for a project whose declared Store is not registered on this machine
- **THEN** the command reports the unavailable Store with its reason and repair command
- **AND** it does not report configuration values as though the project had no Store

#### Scenario: No declaration is not a failure

- **WHEN** a project declares no Store at all
- **THEN** every command resolves exactly as it did before this capability existed, with no Store layer and no diagnostic

#### Scenario: The reason distinguishes each failure

- **WHEN** a declared Store fails to resolve
- **THEN** the reported reason distinguishes not registered, missing metadata, identity mismatch, unhealthy root, ambiguous alias, and unreadable declaration
- **AND** each reason carries its own repair command

#### Scenario: Diagnosis still works when resolution fails

- **WHEN** a project's declared Store is unavailable for any reason
- **THEN** `rasen doctor` and `rasen store doctor` still run, report the full diagnosis, and exit non-zero
- **AND** they write nothing, clone nothing, and register nothing

#### Scenario: Listing registered Stores still works when resolution fails

- **WHEN** a project's declared Store is unavailable and the user lists the Stores registered on this machine
- **THEN** the command succeeds and lists them
- **AND** the unresolvable declaration elsewhere neither stops it nor alters what it lists

#### Scenario: Machine-scope configuration still works when resolution fails

- **WHEN** a project's declared Store is unavailable and the user reads or edits configuration at machine scope
- **THEN** the command succeeds against machine scope, resolving no project layer and therefore no Store layer
- **AND** a project-scoped read of the same configuration still stops with the reason and the repair command

#### Scenario: Initialization reports the declaration rather than resolving it

- **WHEN** a repository whose declaration names an unavailable Store is initialized
- **THEN** initialization reports that this repository's planning is externalized to the declared Store, naming the declaration and the file it lives in
- **AND** it neither resolves the declaration nor registers, clones, or rewrites anything, and its report does not depend on whether that Store is available

### Requirement: A checkout that is not the expected Store fails without writing

When the Store checkout found for a declared permanent identity carries a different permanent identity, the command SHALL fail closed, naming both identities and the checkout path, and SHALL leave the machine's Store registry and the Store's metadata completely unmodified. This SHALL hold on every platform, including when the two roots differ only by path separator form or drive-letter case.

#### Scenario: Identity mismatch stops the command

- **WHEN** a project declares a Store by permanent identity and the registered checkout for that identity carries a different one
- **THEN** the command fails naming the expected identity, the found identity, and the checkout path

#### Scenario: A mismatch writes nothing

- **WHEN** the identity mismatch above occurs
- **THEN** the machine's Store registry file is unchanged
- **AND** the Store's metadata file is unchanged
- **AND** no registration, metadata creation, or repair is performed

#### Scenario: Mismatch detection is path-form independent on Windows

- **WHEN** the registered root and the resolved root name the same location but differ in drive-letter case or path separator form
- **THEN** they are recognized as the same location and no mismatch is reported on that basis alone

### Requirement: Store metadata never carries credentials

A remote supplied for a Store SHALL be rejected when it embeds a username-and-password or token credential, and SHALL never be written into Store metadata or a project's Store declaration. Any such value appearing in existing data SHALL be redacted wherever it is displayed, in both human and JSON output. The ordinary SSH form that carries a user name but no secret SHALL remain accepted.

#### Scenario: A credential-bearing remote is rejected

- **WHEN** a user supplies a Store remote that embeds a password or token
- **THEN** the command fails naming the problem and nothing is written
- **AND** the rejected value is not echoed back in full

#### Scenario: Existing credentials are redacted in output

- **WHEN** a Store's recorded remote embeds a credential
- **THEN** every human and JSON surface that displays it shows a redacted form
- **AND** the redacted rendering is identical across both surfaces

#### Scenario: Ordinary SSH remotes are unaffected

- **WHEN** a Store remote is the ordinary SSH form carrying a user name and no secret
- **THEN** it is accepted and recorded unchanged

### Requirement: A newly assigned all-digit alias warns

Assigning an all-digit display alias to a Store SHALL succeed for compatibility and SHALL emit a warning explaining that digits read as an identity while the permanent identity is the real one. Aliases already recorded SHALL keep resolving without a warning, since resolution behavior is unchanged either way.

#### Scenario: New numeric alias warns but succeeds

- **WHEN** a user creates or registers a Store with an all-digit display alias
- **THEN** the command succeeds
- **AND** a warning explains that the alias is a display name and the permanent identity is the Store's real identity

#### Scenario: An existing numeric alias stays quiet

- **WHEN** a Store already recorded with an all-digit alias is resolved or listed
- **THEN** the command reports it without a numeric-alias warning

### Requirement: The machine's Store registry records Stores by permanent identity

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

### Requirement: Store identity diagnostics are read-only and agree across surfaces

`rasen doctor` and `rasen store doctor` SHALL report the project's Store declaration shape, whether a permanent identity or an alias resolved, alias ambiguity, identity mismatch, alias drift, remote divergence, legacy metadata, and a declared-but-unavailable Store — and SHALL write nothing, contact no network, and repair nothing. Every diagnostic SHALL carry a stable code, a message naming the affected file or Store, and a copy-pasteable repair command. Human and JSON output SHALL report the same codes, the same repair commands, and the same set of findings for the same input.

#### Scenario: Doctor reports identity findings without changing anything

- **WHEN** `rasen doctor` runs in a project whose declared Store is unavailable, whose alias has drifted, and whose Store metadata is legacy
- **THEN** all three findings are reported with their codes and repair commands
- **AND** no file under the project, the Store, or the machine data directory is modified

#### Scenario: Human and JSON diagnostics agree

- **WHEN** the same project is diagnosed once in human mode and once with `--json`
- **THEN** both report the same diagnostic codes and the same repair commands

#### Scenario: Messages state what resolved and whether anything was written

- **WHEN** a command reports a resolved or unavailable Store
- **THEN** the message states whether a permanent identity or an alias was resolved, which Store is the planning Store, and that the command performed no network access and no write

### Requirement: Store identity warnings are deduplicated per invocation

The `storeMembershipsWithoutIdentity` warning SHALL fire at most once per command invocation, regardless of how many times the project configuration is parsed during that invocation. A warning that the user has already seen within the same command SHALL NOT repeat. This deduplication SHALL apply to warning-level diagnostics only; error-level diagnostics SHALL remain emitted on every occurrence.

#### Scenario: Warning fires once despite multiple parses

- **WHEN** a command parses a project configuration whose `storeMemberships` contains identityless entries multiple times during a single invocation
- **THEN** the `storeMembershipsWithoutIdentity` warning is emitted at most once

#### Scenario: Warning message names `rasen update` as the remediation

- **WHEN** the `storeMembershipsWithoutIdentity` warning is emitted
- **THEN** the message directs the user to run `rasen update`, which performs the batch identity migration automatically
