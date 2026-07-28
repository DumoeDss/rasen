## ADDED Requirements

### Requirement: Workflow chain table
The system SHALL define a single static workflow chain table mapping each canonical workflow id to its next step(s) with a trigger condition. The table SHALL cover the interactive main line `propose → apply → verify → ship → archive`, the entry variants `new` and `continue` (both feeding `apply`), and the side branches `explore → propose`, `office-hours → propose`, and `sync` (standalone). Every node id in the table SHALL be a member of the built-in workflow id set, so the table cannot reference a workflow that does not exist.

#### Scenario: Chain nodes are real workflow ids
- **WHEN** the chain table is validated against the built-in workflow id set
- **THEN** every `to` target and every keyed node SHALL be a current built-in workflow id (e.g. `apply`, `verify`, `ship-command`, `office-hours-command`, `archive`), so a typo fails the test suite

#### Scenario: Table is pure data
- **WHEN** the chain table is consumed
- **THEN** it SHALL be static data plus a resolver function, carrying no runtime detection, filesystem access, or profile logic of its own

### Requirement: Next-step resolution filters to installed workflows and skips ahead
The system SHALL provide `resolveNextSteps(workflowId, state, installedWorkflows)` returning the canonical next step(s) for that workflow-and-state, each as `{ workflow, reason }`. A returned step SHALL be filtered against the installed workflow set; when the direct successor is not installed, resolution SHALL walk the main line forward to the nearest installed node and return that instead. When no downstream node on the main line is installed, the step SHALL be dropped.

#### Scenario: Direct successor installed
- **WHEN** `resolveNextSteps('apply', 'all_done', installed)` is called and `verify` is in the installed set
- **THEN** the result SHALL include `{ workflow: 'verify', ... }`

#### Scenario: Skip ahead to nearest installed node
- **WHEN** `resolveNextSteps('apply', 'all_done', installed)` is called for a core-profile installed set that contains `archive` but neither `verify` nor `ship-command`
- **THEN** the result SHALL be `[{ workflow: 'archive', ... }]`
- **AND** the reason SHALL indicate that the intervening steps are not installed

#### Scenario: Blocked apply routes to continue
- **WHEN** `resolveNextSteps('apply', 'blocked', installed)` is called
- **THEN** the result SHALL point at `continue` (or, when `continue` is not installed, the nearest installed authoring step), guiding the user to finish the missing artifacts

#### Scenario: No downstream node installed
- **WHEN** the only installed workflow downstream of the resolved target is absent from the installed set
- **THEN** the step SHALL be omitted from the result rather than naming an uninstalled workflow

### Requirement: Installed set derives from the profile/config selection
The installed workflow set passed to next-step resolution SHALL be derived from the profile/config selection — the same resolver the install seam uses (`resolveDesiredWorkflowSelection` over the global config's profile and workflow list) — and SHALL NOT be derived from the workflow artifact ledger. The ledger records only user-authored workflows and never contains the built-in chain workflows, so using it would report every built-in next step as uninstalled.

#### Scenario: Selection source is profile/config
- **WHEN** the installed set is computed for next-step resolution under a `core` profile
- **THEN** it SHALL contain the core workflows (`apply`, `archive`) and SHALL NOT contain `verify` or `ship-command`
- **AND** the set SHALL be the profile/config-resolved selection, not the user-authored artifact ledger

### Requirement: Next-step reasons are localized
The `reason` text for each resolved next step SHALL be available in English, Japanese, and Simplified Chinese, keyed in the locale catalogs, with the same keys and placeholders across all three.

#### Scenario: Reason localized in three catalogs
- **WHEN** a next-step reason is emitted
- **THEN** its string SHALL resolve from `en.json`, `ja.json`, and `zh-cn.json` under a shared key
