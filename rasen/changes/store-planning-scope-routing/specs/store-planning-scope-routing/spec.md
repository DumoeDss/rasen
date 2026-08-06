## ADDED Requirements

### Requirement: Planning resolution freezes one complete scope

Every planning command SHALL resolve one immutable scope before accessing planning content. A project scope SHALL identify its planning mode, canonical project identity, layout generation, and—when Store-backed—Store identity and stable target line. Resolution SHALL combine sources in this order: explicit selectors, frozen session facts, recorded worktree association, planning-worktree metadata, project planning binding, and finally standalone local discovery. A weaker source MAY fill an absent fact and SHALL NOT override a stronger fact; conflicting facts SHALL fail with `planning_selection_conflict`. Resolution SHALL be read-only and SHALL use canonical platform path identity so equivalent Windows spellings resolve to the same scope.

#### Scenario: Standalone project keeps its local scope

- **WHEN** a planning command runs in an unbound project with a qualifying local planning tree and no explicit selector
- **THEN** it SHALL resolve one standalone project scope rooted in that project
- **AND** it SHALL NOT invent Store or target-line identity

#### Scenario: Bound checkout resolves its Store project partition

- **WHEN** a command runs in a project checkout whose verified planning binding names Store S and project P
- **THEN** the command SHALL resolve P's planning scope inside S rather than the checkout's local `rasen/` directory
- **AND** the Store, project, and any recorded target-line facts SHALL be frozen for the command

#### Scenario: Stronger and weaker facts conflict

- **WHEN** an explicit Store or project selector disagrees with a session, association, worktree marker, or durable planning binding needed for the same scope
- **THEN** resolution SHALL fail with `planning_selection_conflict`
- **AND** no planning location SHALL be read or written

#### Scenario: Windows path aliases do not create another scope

- **WHEN** a registered root and the starting path differ only by Windows drive-letter case, separator form, or canonical filesystem spelling
- **THEN** they SHALL resolve to the same planning scope
- **AND** the command SHALL NOT report a false binding conflict

### Requirement: Planning locations are scope-owned and typed

A resolved project scope SHALL provide the authoritative locations for project home, canonical specs, project design docs, active Changes, a named active Change, and the applicable Archive line. A Store aggregate scope SHALL provide only Store-level locations and explicitly selected project locations. Locations SHALL be absolute, platform-native, containment-checked, and deterministic for the lifetime of the scope. Commands SHALL consume these resolved locations; the same invocation SHALL never derive a second Store path from a repository root, current directory, branch name, or sibling-directory assumption.

#### Scenario: Commands agree on a Store project Change path

- **WHEN** list, show, validate, status, and instructions address the same Change in Store S, project P, and target line L
- **THEN** every command SHALL resolve that Change under S's project P partition
- **AND** every machine-readable path for the Change SHALL be identical across those commands

#### Scenario: Store and project design docs are distinct addresses

- **WHEN** a Store-backed project requests its project design-doc location and a Store-level workflow requests the Store design-doc location
- **THEN** the project location SHALL resolve inside the selected project partition
- **AND** the Store-level location SHALL resolve to the Store's cross-project design-doc directory

#### Scenario: Escaping input fails before access

- **WHEN** a project, target-line, Change, capability, or other address segment would escape or alias another location on Windows or POSIX
- **THEN** location resolution SHALL fail with the Foundation validation or `planning_path_escape` diagnostic
- **AND** no filesystem access SHALL occur at the candidate location

### Requirement: Store aggregate access does not grant project mutation authority

Commands SHALL declare whether they need a Store aggregate read, a project read, or a project mutation. A Store selector without a project MAY open a Store aggregate scope for Store metadata, project discovery, and Store-level design content. A command that reads or mutates project planning content SHALL require one unambiguous project scope; a project mutation SHALL additionally require its stable target line and verified planning-worktree authority. Missing authority SHALL fail with `project_scope_required`, `target_line_required`, or `planning_worktree_required` as applicable, without falling back to the Store integration checkout.

#### Scenario: Store-only context is an aggregate read

- **WHEN** a user runs a Store-level context or project-discovery command with `--store S` and no project selector
- **THEN** the command SHALL report S as a Store aggregate scope
- **AND** it SHALL NOT imply a project Changes or specs directory

#### Scenario: Store-only project mutation is refused

- **WHEN** a user invokes a project mutation with `--store S` and no resolvable project
- **THEN** the command SHALL fail with `project_scope_required`
- **AND** no project partition or flat Store planning path SHALL be created or modified

#### Scenario: Integration checkout is not a planning worktree

- **WHEN** Store S, project P, and target line L resolve but the only Store checkout is S's integration checkout
- **THEN** a project mutation SHALL fail with `planning_worktree_required`
- **AND** the integration checkout SHALL remain unchanged

### Requirement: Layout and planning binding states fail closed

Scope resolution SHALL distinguish standalone planning, legacy flat Store planning, Store v2 aggregate planning, and Store v2 project planning from explicit metadata and verified catalogs rather than directory inference. A legacy flat Store SHALL keep its existing read and write behavior through one frozen legacy adapter, and no Store v2 destination SHALL ever be written through it; withdrawing legacy flat write capability is owned by the layout migration slice, which delivers the migration in the same release. A project recorded as Store-bound SHALL use only its Store project partition; a remaining local planning tree SHALL be reported as `split_planning_truth`, SHALL NOT be merged into Store reads, and SHALL block mutation.

#### Scenario: Legacy flat Store remains inspectable

- **WHEN** a Store has no v2 layout declaration and contains legacy flat planning content
- **THEN** supported list, show, validate, status, instructions, export, doctor, and migration inspection SHALL read that legacy content from one frozen legacy scope
- **AND** no read SHALL upgrade or copy the Store

#### Scenario: Legacy flat Store keeps writing its own flat layout

- **WHEN** new, archive, or another planning mutation targets a legacy flat Store
- **THEN** it SHALL resolve that Store's existing flat planning location through the frozen legacy adapter
- **AND** no Store v2 project destination SHALL be written, and no Store v2 Change identity SHALL be minted

#### Scenario: A Store v2 destination is never written through the legacy adapter

- **WHEN** a Store declares `layoutVersion: 2` and any planning mutation would resolve a flat root-level `rasen/changes` or `rasen/specs` destination inside it
- **THEN** the mutation SHALL fail rather than write that flat destination
- **AND** no project partition SHALL be written without the required project, target-line, and planning-worktree authority

#### Scenario: Legacy flat Store refuses work migration

- **WHEN** `rasen work migrate` resolves a legacy flat Store as its planning root
- **THEN** it SHALL fail with `legacy_flat_store_requires_migration` before moving any file
- **AND** neither the Store nor the member checkout SHALL be modified

#### Scenario: Bound project has residual local planning

- **WHEN** project P is verified as bound to Store S but P's checkout still has a local planning tree
- **THEN** ordinary Store-backed reads SHALL use only S as planning truth and report `split_planning_truth`
- **AND** every project planning mutation SHALL fail until migration or repair removes the conflict

### Requirement: Store v2 Change creation publishes portable identity

Creating a Change in an authorized Store v2 project scope SHALL validate the Change id and schema, mint one Foundation v2 instance seed, derive and verify the planning-scope and Change-instance identities, and publish `.openspec.yaml` together with the minimal Change scaffold at the scope-resolved active-Change location. The metadata SHALL record the verified Store, project, and target-line facts. Creation SHALL use no-clobber semantics and revalidate the scope before its first write; a stale scope SHALL fail with `scope_stale`, and failure SHALL not leave a partial Change. Standalone creation SHALL preserve its current metadata compatibility and SHALL NOT fabricate Store v2 identity.

#### Scenario: Store v2 Change receives verified identity

- **WHEN** `rasen new change add-feature --store S --project P --target-line L` runs with verified planning-worktree authority
- **THEN** the Change SHALL be created in S's P partition
- **AND** its metadata SHALL carry a v2 identity whose Store, project, target line, planning-scope id, and Change-instance id verify together

#### Scenario: Duplicate Change publishes nothing

- **WHEN** the scope-resolved active-Change location already contains that Change id
- **THEN** creation SHALL fail with `change_already_exists`
- **AND** the existing Change and every sibling path SHALL remain unchanged

#### Scenario: Scope changes before publication

- **WHEN** layout, binding, catalog, or worktree authority changes after resolution but before Change publication
- **THEN** creation SHALL fail with `scope_stale`
- **AND** no target Change directory SHALL remain partially published

#### Scenario: Standalone metadata remains compatible

- **WHEN** the same command creates a Change in a standalone project
- **THEN** the existing standalone path and metadata behavior SHALL remain valid
- **AND** no Store, target-line, or Store-derived Change identity SHALL be added

### Requirement: Machine-readable context describes scope without granting authority

Root and planning-context JSON SHALL identify whether the result is standalone, legacy Store, Store aggregate, or Store project scope and SHALL expose the resolved Store UID/alias, project id, target-line id, planning-scope id, layout version, intent, notices, and applicable planning locations. Absent facts SHALL be absent rather than guessed. Absolute paths in the description are local locators for agents and diagnostics; serializing or replaying the description SHALL NOT confer mutation authority. Existing root and planning-home fields MAY remain as compatibility projections, but their paths SHALL be derived from the same scope and SHALL never widen access.

#### Scenario: Store project context is auditable

- **WHEN** `rasen context --json` or change status resolves a Store v2 project scope
- **THEN** the payload SHALL name the Store, project, target line, layout, scope identity, and applicable project planning locations
- **AND** it SHALL distinguish the Store planning worktree from any execution checkout when those facts are available

#### Scenario: Aggregate context has no fabricated project home

- **WHEN** context resolves only a Store aggregate scope
- **THEN** project, target-line, Change, specs, and project-archive locations SHALL be absent
- **AND** the payload SHALL state that project authority is required for project content

#### Scenario: Compatibility output is derived from the selected scope

- **WHEN** a legacy consumer reads root or planning-home compatibility fields
- **THEN** every field SHALL be a projection of the selected scope's resolved locations
- **AND** no compatibility field SHALL identify a broader writable root than the current action context permits

### Requirement: Every planning consumer crosses the same scope seam

All supported planning-path consumers—including CLI workflow commands, list/show/validate/archive entry points, pipeline Change lookup, item discovery, context, generated workflow guidance, and existing management read models—SHALL receive their locations from the resolved planning scope or its read-only compatibility projection. Commands that address the same scope SHALL agree even when invoked from different directories or with equivalent selectors. Adding a new planning consumer SHALL require choosing a declared scope intent and typed planning address rather than accepting an arbitrary Store-relative path.

#### Scenario: Equivalent entry points resolve identically

- **WHEN** equivalent selector and binding facts reach CLI, pipeline, and management read entry points for the same project scope
- **THEN** they SHALL select the same planning owner and locations
- **AND** changing the current directory after scope resolution SHALL not redirect any downstream access

#### Scenario: No caller recreates the flat Store algorithm

- **WHEN** Store v2 project content is accessed through any supported consumer
- **THEN** the consumer SHALL use the project partition returned by scope resolution
- **AND** no root-level Store `rasen/changes` or `rasen/specs` path SHALL be treated as that project's planning location
