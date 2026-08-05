## ADDED Requirements

### Requirement: Layout v2 partitions Store planning content by project

A Store that declares layout version 2 SHALL place each project's canonical specs, project design docs, active Changes, and Archives under `rasen/projects/<projectId>/`. Store-level design docs SHALL remain under the Store-level design-doc directory, while the flat Store `rasen/specs/` and `rasen/changes/` locations SHALL NOT be valid project-planning addresses in layout v2. Active Change paths SHALL be independent of target-line names because unmerged target-line state is isolated by the Store Git worktree; Archives SHALL be partitioned by stable target-line id.

#### Scenario: Two projects can use the same Change alias

- **WHEN** layout v2 resolves an active Change named `refresh-cache` for two different project ids in one Store checkout
- **THEN** the two resolved paths are under different `rasen/projects/<projectId>/changes/` directories
- **AND** neither path uses a flat Store Change directory

#### Scenario: Store and project design docs remain distinct

- **WHEN** layout v2 resolves a Store-level design doc and a project-level design doc with the same name
- **THEN** the Store document resolves below the Store design-doc directory
- **AND** the project document resolves below that project's planning home

#### Scenario: Target line scopes Archive but not active Change directories

- **WHEN** a project uses Change alias `release-notes` on target lines `line-0.1` and `line-0.2`
- **THEN** the active relative Change address contains no target-line directory segment
- **AND** each Archive line address contains its stable target-line id

### Requirement: Layout version is independent from Store metadata version

Store metadata SHALL represent layout v2 with an explicit `layoutVersion: 2` field separate from the metadata schema `version`. A Store metadata record without `layoutVersion` SHALL remain a legacy-layout record, and parsing or serializing that record SHALL NOT infer or inject layout v2 from directories found on disk.

#### Scenario: Existing permanent-identity metadata stays legacy-layout

- **WHEN** Store metadata has `version: 2` and a permanent Store identity but no `layoutVersion`
- **THEN** it parses as Store metadata whose layout version is not declared
- **AND** serializing it does not add `layoutVersion`

#### Scenario: Layout v2 is declared explicitly

- **WHEN** Store metadata contains both metadata `version: 2` and `layoutVersion: 2`
- **THEN** validation recognizes the Store as declaring layout v2
- **AND** the two version fields retain their separate meanings

### Requirement: V2 project identifiers are portable canonical path segments

A v2 project id SHALL be an already-canonical lowercase RFC 4122 textual UUID or lowercase kebab id. Validation SHALL reject empty values, `.`, `..`, path separators, control characters, trailing dot or space, Windows reserved device names, and non-canonical case on every platform. Validation SHALL never sanitize an invalid value into a different id.

#### Scenario: Existing permanent project identity forms are accepted

- **WHEN** a v2 project record uses a lowercase UUID or a lowercase kebab id that is not reserved
- **THEN** the id is accepted unchanged as the catalog key and planning-home segment

#### Scenario: Traversal and Windows device names are rejected everywhere

- **WHEN** a v2 project id is `..`, contains `/` or `\`, or is a Windows device name such as `con`
- **THEN** validation rejects it on Windows, macOS, and Linux
- **AND** no replacement path segment is returned

#### Scenario: Case aliases are not silently folded

- **WHEN** a v2 project record uses uppercase or mixed-case spelling of an otherwise valid id
- **THEN** validation rejects the non-canonical spelling
- **AND** it cannot alias a lowercase project directory on a case-insensitive filesystem

### Requirement: Target-line identifiers support portable release-line names

A target-line id SHALL be lowercase ASCII alphanumeric segments separated by single hyphens or dots, allowing values such as `main`, `line-0.1`, and `release-2026.08`. It SHALL satisfy the same traversal, control-character, trailing-dot/space, Windows-reserved-name, and canonical-case protections as a project id, and validation SHALL NOT derive it from a Git branch name.

#### Scenario: Dotted release line is accepted

- **WHEN** the target-line id is `line-0.2`
- **THEN** it is accepted unchanged for catalog and Archive addressing

#### Scenario: Ambiguous punctuation is rejected

- **WHEN** a target-line id starts or ends with punctuation, contains consecutive separators, a path separator, or a parent-directory segment
- **THEN** validation rejects it without sanitizing it

#### Scenario: Branch locator change does not rename the line

- **WHEN** a target-line catalog changes its Store Git ref while retaining the same target-line id
- **THEN** the target-line identity and all identity derivations using it remain unchanged

### Requirement: Project and target-line catalogs are strict portable records

A layout v2 Store SHALL validate project and target-line catalog records as versioned, strict schemas. A project catalog filename SHALL agree with its canonical project id and SHALL distinguish planning membership from a bound planning truth. A bound project SHALL be a planning member and SHALL carry a binding timestamp. A target-line catalog filename SHALL agree with its stable id and SHALL map the Store ref and per-project code refs without machine filesystem paths or credentials. Unknown fields, mismatched filenames, invalid project-map keys, and invalid refs SHALL fail validation rather than being ignored or coerced.

#### Scenario: Planning member is not silently treated as bound

- **WHEN** a version 2 project catalog marks a project as a planning member with `planningBinding.state` equal to `unbound`
- **THEN** the record is valid and reports membership without claiming that planning truth has moved

#### Scenario: Invalid bound record is rejected

- **WHEN** a project catalog declares `planningBinding.state: bound` without planning membership or without its required timestamp
- **THEN** validation rejects the record

#### Scenario: Target-line refs are locators rather than identity

- **WHEN** a valid target-line catalog maps one stable target-line id to a Store full ref and project full code refs
- **THEN** the refs are retained as portable locators
- **AND** changing a ref does not change the catalog id

#### Scenario: Machine path in a catalog is rejected

- **WHEN** a v2 catalog contains an unknown field holding a local checkout path
- **THEN** strict validation rejects the record
- **AND** no machine path becomes durable Store metadata

### Requirement: Layout path computation is pure and containment checked

Layout v2 path computation SHALL accept only validated semantic ids, use the selected platform path semantics, and prove every result remains inside its intended Store or project root. It SHALL return paths without reading, creating, moving, or deleting filesystem entries. Windows and POSIX computations SHALL represent the same semantic layout using their native separators.

#### Scenario: Windows paths use Windows semantics

- **WHEN** layout paths are computed for a Windows root with Windows path semantics
- **THEN** expected results can be constructed with `path.win32.join`
- **AND** every result remains contained by the intended root

#### Scenario: POSIX paths use POSIX semantics

- **WHEN** the same semantic addresses are computed for a POSIX root with POSIX path semantics
- **THEN** expected results can be constructed with `path.posix.join`
- **AND** no Windows separator assumption appears in the result

#### Scenario: Escaping input fails closed

- **WHEN** any supplied id or derived leaf would resolve outside its intended root
- **THEN** path computation reports a containment error
- **AND** returns no usable location

### Requirement: Archive entry names include stable instance disambiguation

A layout v2 Archive entry address SHALL use `YYYY-MM-DD-<changeId>--<instanceShort>` below the project's stable target-line Archive directory. `instanceShort` SHALL be derived from a verified full `ChangeInstanceId`, and computing the address SHALL NOT inspect a branch name or filesystem contents.

#### Scenario: Same-day retry has a different address

- **WHEN** two attempts use the same project, target line, Change alias, and archive date but have different verified Change instance ids
- **THEN** their Archive entry addresses have different instance suffixes
- **AND** neither address overwrites the other by construction

#### Scenario: Invalid instance id cannot name an Archive

- **WHEN** an Archive address is requested with a malformed or unverified Change instance id
- **THEN** address computation rejects it before returning a path
