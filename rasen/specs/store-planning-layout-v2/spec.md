# store-planning-layout-v2 Specification

## Purpose
Give each member project its own planning home under a Store: canonical specs, design docs, active Changes, and target-line-partitioned Archives no longer share one flat Store root, so two projects can hold the same Change alias without collision and archive placement derives from stable target-line identity.
## Requirements
### Requirement: Layout v2 partitions Store planning content by project

A Store that declares layout version 2 SHALL place each member project's canonical specs, project
design docs, active Changes, and Archives under that project's own planning home. Store-level design
docs SHALL remain a Store-level address, while the flat Store spec and Change locations SHALL NOT be
valid project-planning addresses in layout v2. An active Change address SHALL be independent of
target-line names, because unmerged target-line state is isolated by the Store's own Git worktree;
an Archive address SHALL be partitioned by stable target-line id.

#### Scenario: Two projects can use the same Change alias

- **WHEN** layout v2 resolves an active Change named `refresh-cache` for two different project ids in one Store checkout
- **THEN** the two resolved addresses fall under different project planning homes
- **AND** neither address uses a flat Store Change directory

#### Scenario: Store and project design docs remain distinct

- **WHEN** layout v2 resolves a Store-level design doc and a project-level design doc with the same name
- **THEN** the Store document resolves below the Store design-doc location
- **AND** the project document resolves below that project's planning home

#### Scenario: Target line scopes Archive but not active Change addresses

- **WHEN** a project uses Change alias `release-notes` on target lines `line-0.1` and `line-0.2`
- **THEN** the active Change address contains no target-line segment
- **AND** each Archive address contains its stable target-line id

### Requirement: Layout version is declared explicitly and independently

Store metadata SHALL represent layout v2 with its own layout declaration, separate from the metadata
schema version, so the two version meanings never collide. Store metadata without that declaration
SHALL remain a legacy-layout Store. Reading or writing Store metadata SHALL NOT infer the declaration
from directories found on disk, and SHALL NOT add it to a record that did not carry it. `rasen store
setup` SHALL author the declaration at creation when the operator explicitly requests layout 2,
writing a store whose metadata carries the declaration and whose created scaffold is the layout-2
shape with no flat planning tree to retire; without the explicit request, setup SHALL create exactly
what it creates today, and no other command SHALL add the declaration to a legacy record.

#### Scenario: Existing permanent-identity metadata stays legacy-layout

- **WHEN** Store metadata carries a permanent Store identity but no layout declaration
- **THEN** it parses as a Store whose layout version is not declared
- **AND** writing it back does not introduce a layout declaration

#### Scenario: Layout v2 is declared explicitly

- **WHEN** Store metadata carries both its metadata schema version and an explicit layout version 2
- **THEN** the Store is recognized as declaring layout v2
- **AND** the two version fields retain their separate meanings

#### Scenario: Directories on disk never upgrade a Store

- **WHEN** a legacy-layout Store checkout already contains project-partitioned directories
- **THEN** its metadata still parses as legacy layout
- **AND** no implicit upgrade is performed

#### Scenario: Setup authors layout 2 when explicitly asked

- **WHEN** `rasen store setup` runs with the operator's explicit layout-2 request
- **THEN** the created store's metadata carries the layout version 2 declaration beside its schema version
- **AND** the store creates no flat planning tree that a later layout-2 use would have to retire

#### Scenario: Setup without the request stays legacy

- **WHEN** `rasen store setup` runs with no layout request
- **THEN** the created store's metadata carries no layout declaration
- **AND** the created scaffold is exactly what setup creates without the capability

### Requirement: V2 project identifiers are portable canonical path segments

A v2 project id SHALL be an already-canonical lowercase textual UUID or lowercase kebab id. Validation
SHALL reject an empty value, a current- or parent-directory name, either path separator, control
characters, a trailing dot or space, a Windows reserved device name, and non-canonical case — on
macOS, Linux, and Windows alike. Validation SHALL never sanitize an invalid value into a different
identifier.

#### Scenario: Existing permanent project identity forms are accepted

- **WHEN** a v2 project record uses a lowercase UUID or a lowercase kebab id that is not reserved
- **THEN** the id is accepted unchanged as both the catalog key and the planning-home segment

#### Scenario: Traversal and Windows device names are rejected everywhere

- **WHEN** a v2 project id is a parent-directory name, contains a path separator, or is a Windows device name such as `con`
- **THEN** validation rejects it on Windows, macOS, and Linux alike
- **AND** no replacement path segment is returned

#### Scenario: Case aliases are not silently folded

- **WHEN** a v2 project record uses an uppercase or mixed-case spelling of an otherwise valid id
- **THEN** validation rejects the non-canonical spelling
- **AND** it cannot alias a lowercase project's planning home on a case-insensitive filesystem

### Requirement: Target-line identifiers support portable release-line names

A target-line id SHALL be lowercase alphanumeric segments separated by single hyphens or dots,
admitting stable names such as `main`, `line-0.1`, and `release-2026.08`. It SHALL satisfy the same
traversal, control-character, trailing-dot-or-space, reserved-name, and canonical-case protections a
project id satisfies, and SHALL NOT be derived from a Git branch name.

#### Scenario: Dotted release line is accepted

- **WHEN** the target-line id is `line-0.2`
- **THEN** it is accepted unchanged for catalog and Archive addressing

#### Scenario: Ambiguous punctuation is rejected

- **WHEN** a target-line id starts or ends with punctuation, contains consecutive separators, contains a path separator, or is a parent-directory segment
- **THEN** validation rejects it without sanitizing it

#### Scenario: Branch locator change does not rename the line

- **WHEN** a target-line catalog changes its Store Git ref while keeping the same stable target-line id
- **THEN** the target-line identity and everything derived from it remain unchanged

### Requirement: Project and target-line catalogs are strict portable records

A layout v2 Store SHALL validate project and target-line catalog records as versioned, strict
records. A project catalog's filename SHALL agree with its canonical project id, and the record SHALL
distinguish being a planning member from having planning truth bound: a bound project SHALL be a
planning member and SHALL carry its binding timestamp. A target-line catalog's filename SHALL agree
with its stable id and SHALL map the Store ref and per-project code refs as portable, credential-free
locators. Unknown fields, mismatched filenames, invalid project-map keys, and malformed refs SHALL
fail validation rather than be ignored or coerced, so no machine-local path or credential can become
durable Store metadata.

#### Scenario: Planning member is not silently treated as bound

- **WHEN** a v2 project catalog marks a project as a planning member whose planning binding is unbound
- **THEN** the record is valid and reports membership without claiming planning truth has moved

#### Scenario: Invalid bound record is rejected

- **WHEN** a project catalog declares its planning binding bound without planning membership, or without its binding timestamp
- **THEN** validation rejects the record

#### Scenario: A project's display name is carried, never validated as an identifier

- **WHEN** a project catalog carries a human display name such as `Elftia` or `my app` — exactly what the existing membership record accepts
- **THEN** the record is valid and the display name is carried through unchanged
- **AND** the project's identity and its planning-home segment come from its project id alone

#### Scenario: Target-line refs are locators rather than identity

- **WHEN** a valid target-line catalog maps one stable target-line id to a Store full ref and project full code refs
- **THEN** the refs are retained as portable locators
- **AND** changing a ref does not change the catalog's id

#### Scenario: Machine path in a catalog is rejected

- **WHEN** a v2 catalog carries an unrecognized field holding a local checkout path
- **THEN** strict validation rejects the record
- **AND** no machine path becomes durable Store metadata

### Requirement: Layout addresses are computed purely and proven contained

Layout v2 address computation SHALL accept only validated semantic ids, SHALL use explicitly selected
platform path semantics, and SHALL prove every result stays inside its intended Store or project
root. It SHALL return an address without reading, creating, moving, or deleting anything on disk.
Windows and POSIX computations SHALL express the same semantic layout in their own native separators,
so Windows behavior is verifiable from any host.

#### Scenario: Windows addresses use Windows semantics

- **WHEN** layout addresses are computed for a Windows Store root under Windows path semantics
- **THEN** the results match expectations built with the Windows path API
- **AND** every result remains contained by its intended root

#### Scenario: POSIX addresses use POSIX semantics

- **WHEN** the same semantic addresses are computed for a POSIX Store root under POSIX path semantics
- **THEN** the results match expectations built with the POSIX path API
- **AND** no Windows separator assumption appears in any result

#### Scenario: Escaping input fails closed

- **WHEN** a supplied id or derived leaf would resolve outside its intended root
- **THEN** address computation reports a containment failure
- **AND** returns no usable location

### Requirement: Planning addresses never depend on ambient process state

Resolving a Store planning address SHALL depend only on the values supplied to it. The Store root
SHALL be an absolute location, and under Windows semantics SHALL carry a drive, UNC share, or device
root, so a result is never completed from the process's current drive or directory. The planning
contract layer SHALL NOT read the filesystem, the Store registry, environment variables, the current
working directory, or any Git process, so the same inputs resolve identically on any machine and in
any session.

#### Scenario: Relative Store root is refused

- **WHEN** a caller asks for a planning address with a relative Store root
- **THEN** resolution refuses it and returns no address
- **AND** no location is completed from the current working directory

#### Scenario: Drive-less Windows root is refused

- **WHEN** a Windows-semantics Store root names a directory without a drive, UNC share, or device root
- **THEN** resolution refuses it
- **AND** no location is completed from the process's current drive

#### Scenario: Same inputs resolve identically anywhere

- **WHEN** the same Store root, ids, and path semantics are supplied from different working directories, environments, and machines
- **THEN** every resolved address is identical

### Requirement: Archive addresses include stable instance disambiguation

A layout v2 Archive entry SHALL be addressed below its project's stable target-line Archive location
by its archive date, Change alias, and a short form of that Change's verified instance identity.
Computing the address SHALL NOT inspect a branch name or anything on disk.

#### Scenario: Same-day retry has a different address

- **WHEN** two attempts share a project, target line, Change alias, and archive date but have different verified Change instance identities
- **THEN** their Archive addresses differ
- **AND** neither address can overwrite the other by construction

#### Scenario: Unverified instance identity cannot name an Archive

- **WHEN** an Archive address is requested with a malformed or unverified Change instance identity
- **THEN** address computation rejects it before returning any location

### Requirement: Layout v2 addresses Store-level Issues and Execution Plan revisions

A Store declaring layout version 2 SHALL place cross-project Issue content at the Store level, with
each Issue's record, its narrative, its Execution Plan revisions, its acceptance-conditions
revisions, and its acceptance record below that Issue's internal storage location. A newly created
Issue SHALL use its immutable lowercase UID as that location; a compatible version-1 Issue SHALL
continue using its existing legacy location. The Issue directory, the Issue record, the
plan-revisions directory, one plan-revision file, the acceptance-conditions directory, one
acceptance-conditions revision file, and the acceptance record SHALL each be its own address, so no
caller composes a filename onto a returned directory. These addresses SHALL be Store-level:
computing one SHALL require no project id and no target-line id, and supplying either SHALL NOT
change the result. Issue content SHALL NOT be a valid project-planning address, and no project
partition SHALL be a valid Issue address.

#### Scenario: New Issue addresses use UID

- **WHEN** layout v2 resolves any address for a newly created Issue
- **THEN** it resolves below the Store Issue location whose directory segment is the Issue UID
- **AND** no title, key, slug, alias, project, or target line changes the result

#### Scenario: Issue addresses need no project

- **WHEN** layout v2 resolves an Issue directory, its record, its revisions directories, one revision of either kind, and its acceptance record
- **THEN** each address resolves below the Store's Issue location without a project or target-line input
- **AND** supplying a project or target line produces the same paths

#### Scenario: Legacy Issue addresses retain their storage key

- **WHEN** layout v2 resolves content for a compatible version-1 Issue
- **THEN** it uses the resolved legacy storage location
- **AND** it does not derive a new path from the selector used by the caller

#### Scenario: A revision file is addressed, not composed

- **WHEN** a caller needs one Execution Plan revision's file or one acceptance-conditions revision's file
- **THEN** it obtains that file's own address from the layout contract
- **AND** it does not append a filename to a revisions directory

#### Scenario: Issue content is not project-planning content

- **WHEN** an Issue address and a project partition address are computed in one Store
- **THEN** the Issue address resolves below the Store-level Issue location
- **AND** no project partition path resolves to Issue content and no Issue path resolves to project-planning content

#### Scenario: Issue addresses obey the same platform semantics

- **WHEN** Issue addresses are computed under Windows semantics and under POSIX semantics
- **THEN** each matches expectations built with the matching platform path API
- **AND** every result remains contained by the Store root

### Requirement: Issue and Execution Plan revision identifiers are portable canonical segments

A newly allocated Issue UID SHALL be an already-canonical lowercase textual UUID and SHALL be the
only business identity accepted as a new Issue directory segment. A compatible version-1 storage
key SHALL continue to satisfy its existing portable canonical path-segment contract. Empty values,
current- and parent-directory names, either path separator, control characters, a trailing dot or
space, Windows reserved device names, and non-canonical case SHALL be rejected for every physical
Issue storage segment on every platform. An Execution Plan revision identifier SHALL be a canonical
zero-padded decimal ordinal of fixed width; an unpadded value, a differently padded spelling of the
same number, and a zero ordinal SHALL be rejected. No physical identifier SHALL be derived from a
Git branch name, a date, a title, a human key, a slug, or directory listing order.

#### Scenario: A generated UID is a portable directory segment

- **WHEN** a new Issue is created on Windows, macOS, or Linux
- **THEN** its lowercase UUID is accepted as the same canonical storage segment on every platform
- **AND** the path remains contained by the Store root

#### Scenario: Traversal and device names are rejected everywhere

- **WHEN** an operator selector is a parent-directory name, contains a path separator, or is a Windows device name such as `con`
- **THEN** the selector is never used directly as a physical Issue storage segment
- **AND** no replacement path is guessed from it

#### Scenario: Case aliases cannot collide on a case-insensitive filesystem

- **WHEN** a physical Issue storage key uses a non-canonical case spelling
- **THEN** validation rejects the spelling
- **AND** it cannot alias an existing Issue location

#### Scenario: A revision ordinal must be canonical

- **WHEN** a revision identifier is unpadded, padded to another width, or a zero ordinal
- **THEN** validation rejects it without sanitizing it
- **AND** the rejected value does not address any existing revision
