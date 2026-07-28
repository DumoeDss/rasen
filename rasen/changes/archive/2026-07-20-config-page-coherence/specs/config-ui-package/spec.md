## ADDED Requirements

### Requirement: Autopilot and Workflow groups lead the configuration page
The configuration page SHALL order its groups so that the `Autopilot` and `Workflow` groups appear at the top of the page, ahead of the remaining groups (Profile, Behavior, Telemetry, Project, Archive, Advanced). Within the `Workflow` group, the per-agent tuning keys SHALL render as per-role overrides of their base: the five per-role handoff threshold keys (`handoff.roles.<role>`) each as a dual-form threshold control alongside the base `handoff.threshold`, and the five per-role model keys (`models.roles.<role>`) each as a model control alongside the base `models.default`. Each per-role control SHALL be scope-explicit exactly like its base (settable at global and project scope). A per-role model control SHALL be a text input that accepts any model id, offering known model-preset ids as non-binding suggestions (e.g. a datalist) rather than restricting the value to an allow-list.

#### Scenario: Autopilot and Workflow lead the page
- **WHEN** the configuration page loads
- **THEN** the `Autopilot` group and the `Workflow` group appear before the other groups in the page order

#### Scenario: Per-role thresholds render as threshold controls
- **WHEN** the page renders the `Workflow` group
- **THEN** the base `handoff.threshold` and each `handoff.roles.<role>` key render as dual-form threshold controls (fraction or absolute `{ remainingTokens: N }`), each with a scope choice
- **AND** a per-role value set at project scope displays with a project source annotation over any global value for the same role

#### Scenario: Per-role models render as suggestion-backed text controls
- **WHEN** the page renders the `Workflow` group
- **THEN** the base `models.default` and each `models.roles.<role>` key render as text inputs that accept any model id, each with a scope choice
- **AND** known model-preset ids are offered as non-binding suggestions, and a typed id that matches no preset is still accepted (not blocked by the control)

### Requirement: The Autopilot group shows a read-only gates inventory
The configuration page SHALL render, within the `Autopilot` group, a read-only gates inventory sourced from `GET /api/v1/pipelines`. The inventory SHALL show, per pipeline, the stages that act as gates, and SHALL mark every stage whose gate value is `'vet'` as always-pausing — a gate that cannot be disabled by an `autopilot.gates: off` default or a `--no-gate` run — distinctly from an ordinary `gate: true` stage. The inventory SHALL be display-only: it never writes configuration and offers no gate-editing controls.

#### Scenario: Gates inventory lists gated stages per pipeline
- **WHEN** the user views the `Autopilot` group
- **THEN** a gates inventory lists each pipeline and its gated stages, fed by the pipelines endpoint

#### Scenario: The vet gate is marked as always-pausing
- **WHEN** the inventory renders a stage whose gate value is `'vet'`
- **THEN** that stage is marked as always pausing and not disableable by gates-off, distinctly from ordinary gates

#### Scenario: The inventory is read-only
- **WHEN** the user interacts with the gates inventory
- **THEN** no gate-editing control is offered and no configuration write is issued from it
