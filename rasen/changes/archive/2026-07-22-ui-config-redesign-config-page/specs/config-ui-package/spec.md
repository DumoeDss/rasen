# config-ui-package Delta Specification

## REMOVED Requirements

### Requirement: Configuration page renders the effective config with source transparency

**Reason**: The source vocabulary predates the store configuration layer (it enumerates default, global, project, environment override), store spaces are served only by a deferral notice, and inherited values are shown only as shadowed-under-a-winner. Replaced by "Configuration page renders effective config with layer transparency across project and store spaces".
**Migration**: Grouped rendering, descriptions, invalid-value warnings, never-rewriting on-disk values, and read-only environment overrides all carry over verbatim; the store layer, the inherited-value line, and store-space support are added.

### Requirement: Editing is constraint-driven and scope-explicit

**Reason**: Its "when a key is settable in more than one scope, the user chooses the scope" contract is the per-row Scope select the ratified redesign removes — scope becomes a page mode. Replaced by "Editing is constraint-driven with a page-level scope mode".
**Migration**: Control-type selection from constraints, client-side validation with the API as the authority, error surfacing levels, and explicit-scope writes are unchanged; only how the scope is chosen moves from each row to one page-level control.

### Requirement: Autopilot and Workflow groups lead the configuration page

**Reason**: Page-order prominence is superseded by a tabbed layout; the Workflow and Autopilot groups move to an interim tab pending their relocation to the pipeline surface. Replaced by "The configuration page is organized into scope-filtered tabs".
**Migration**: The per-role threshold and model control mandates (dual-form thresholds, suggestion-backed model inputs) carry over into the new requirement's Workflow-tab clause; nothing about the controls themselves changes.

## ADDED Requirements

### Requirement: Configuration page renders effective config with layer transparency across project and store spaces

The configuration page SHALL serve every planning space: a project space edits its project-layer values, and a store space edits that store's own values — no space type is deferred or stubbed. Every entry the API lists SHALL render with its description and effective value, annotated with where the value comes from (default, global, store, project, or environment override). When the page's local scope holds no value for a visible multi-scope key, the entry SHALL show an inherited-value line naming the providing layer and its value — the inherited store identified by its id when the store layer provides it, otherwise the global layer or the built-in default. When a narrower value shadows wider ones, the shadowed values SHALL remain revealed. A key whose effective value is inherited from a store SHALL render read-only with an affordance that navigates to that store space's configuration page, where the value is editable; in a space with no store inheritance, no store-related affordance SHALL appear anywhere. Entries whose on-disk value is invalid SHALL display the API's warning visibly, the UI SHALL never rewrite or auto-correct on-disk values, and environment-override values SHALL be displayed as read-only precedence.

#### Scenario: Store space edits its own configuration

- **WHEN** the user opens the configuration page in a store space
- **THEN** the page renders the store's entries with local writes targeting the store's own configuration, with no deferral notice

#### Scenario: Inherited-from-store line with store identified

- **WHEN** a project declaring a store pointer has no local value for a key the store sets
- **THEN** the entry shows an inherited-value line naming that store by id with the store's value, and the value annotation reflects the store layer

#### Scenario: Store-inherited row navigates to the store to edit

- **WHEN** the user activates the store-edit affordance on a store-inherited entry
- **THEN** the app switches to that store space's configuration page, where the same key is locally editable

#### Scenario: No store noise without inheritance

- **WHEN** the addressed project declares no store pointer
- **THEN** no inherited-from-store line, store navigation affordance, or store annotation renders on any entry

#### Scenario: Inherited-from-global line

- **WHEN** a multi-scope key has no local value and no store layer provides one
- **THEN** the entry shows an inherited-value line naming the global layer (or the built-in default) with its value, and remains locally editable

#### Scenario: Invalid on-disk value surfaces as a warning

- **WHEN** the API reports a warning for a hand-edited invalid value on disk
- **THEN** the entry displays the warning message and the value is not silently corrected

### Requirement: Editing is constraint-driven with a page-level scope mode

Edit controls SHALL be rendered from each entry's serialized constraints — toggles for booleans, selection lists for enumerations, bounded numeric inputs for ranged numbers, a form-picker plus bounded numeric input for dual-form thresholds, text inputs for strings — unchanged. The scope of every write SHALL be selected by a single page-level Global / Local segmented control, not per row: Global targets the global scope; Local targets the current space's own scope — the project layer at a project space, the store layer at a store space. The active mode SHALL also filter visibility: only keys settable in the active mode's scope are shown, and a key not settable there is simply absent rather than badged. Every write and unset SHALL carry the active mode's explicit scope, and the unset action SHALL be offered only when the active mode's scope holds a value. Client-side validation gives immediate feedback, but the API's verdict is authoritative: API errors SHALL be surfaced with their message and fix guidance at the level they apply — on the field for value and scope errors, on the page for space-resolution errors — and a successful write SHALL update the entry's displayed value and annotations from the API's re-resolved response. Switching modes SHALL re-target writes and re-filter the visible keys without a reload.

#### Scenario: Mode selects the write target

- **WHEN** the user edits a dual-scope key in Global mode and then the same key in Local mode at a project space
- **THEN** the first write carries the global scope and the second the project scope, with no per-row scope control involved

#### Scenario: Local mode at a store space writes store scope

- **WHEN** the user edits a key in Local mode at a store space
- **THEN** the write carries the store scope and lands in that store's own configuration

#### Scenario: Mode filters visibility

- **WHEN** the user switches from Global to Local mode
- **THEN** keys settable only globally disappear, keys settable only locally appear, and no reload occurs

#### Scenario: Unset follows the mode

- **WHEN** a key has a value in the active mode's scope and the user unsets it
- **THEN** the unset carries that scope and the entry re-renders showing the value now inherited from the wider layers

#### Scenario: Control types follow constraints

- **WHEN** the page renders a boolean key, an enum key, and a ranged numeric key
- **THEN** they render as a toggle, a selection list, and a bounded numeric input respectively

#### Scenario: Invalid scope surfaces the API's guidance

- **WHEN** a write is rejected by the API as invalid for its scope
- **THEN** the field shows the API's message and its guidance naming where the key is settable

### Requirement: The configuration page is organized into scope-filtered tabs

The configuration page SHALL present its keys in tabs mapped from the registry's group metadata: General (Profile, Appearance, and Behavior groups), Project (Project and Archive groups), Privacy (Telemetry group), Advanced (the Advanced group), and — until the pipeline surface takes them over — a Workflow tab carrying the Workflow and Autopilot groups exactly as they render today, including the read-only gates inventory. A tab none of whose keys are visible in the active scope mode SHALL not be shown; a key whose group maps to no tab SHALL still be reachable in a trailing bucket rather than hidden. Each entry SHALL title on a human-readable label with its dot-path key as secondary text. Within the Workflow tab, the per-role tuning keys SHALL keep their existing controls: the base and per-role handoff thresholds as dual-form threshold controls, and the base and per-role model keys as text inputs offering known model-preset ids as non-binding suggestions with any typed id accepted.

#### Scenario: Tabs map the registry groups

- **WHEN** the configuration page loads
- **THEN** the keys appear under General, Project, Privacy, Advanced, and Workflow tabs per their registry groups, each row titled on a readable label with the dot-path visible as secondary text

#### Scenario: Empty tab is absent

- **WHEN** the active mode leaves a tab with no visible keys (for example Privacy in Local mode, since telemetry is global-only)
- **THEN** that tab is not offered until the mode changes

#### Scenario: Workflow tab preserves the role-matrix controls

- **WHEN** the page renders the Workflow tab
- **THEN** the handoff threshold keys render as dual-form threshold controls, the model keys as suggestion-backed text inputs accepting any id, and the gates inventory renders read-only within the Autopilot group section

#### Scenario: Unmapped group stays reachable

- **WHEN** an entry's group matches no tab mapping
- **THEN** the entry still renders in a trailing bucket rather than disappearing
