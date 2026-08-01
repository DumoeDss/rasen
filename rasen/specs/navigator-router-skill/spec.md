# navigator-router-skill Specification

## Purpose
Adds the user-invoked `navigator` router skill (adapted from grill `ask-matt`, MIT) that maps the Rasen main flow plus the expert skills — main flow, on-ramps, a vocabulary layer, and standalone specialists, each with a one-line "when to reach for it". It cures the cognitive-load problem of holding the full expert set in mind, reflects the post-absorb reality (investigate is feedback-loop-first, review is two-axis), and registers as an expert with the count incremented by one.
## Requirements
### Requirement: Navigator maps Rasen and the experts, reflecting the post-absorb state

The navigator reference bundled with `rasen-help` SHALL present a four-part map: a main flow (`rasen-explore` or `rasen-office-hours-command` → `rasen-propose` → `rasen-apply-change` → review/verify → `rasen-ship` → `rasen-retain` → `rasen-archive-change`, with `rasen-auto` as the driver), on-ramps, a vocabulary layer supplied through the propose workflow's bundled codebase-design reference, and standalone specialists, each with a one-line "when to reach for it". `rasen-retro` SHALL remain a temporary user-invoked compatibility alias for report-mode retention outside the main lifecycle. Workflows and independently invokable experts SHALL use canonical `rasen-*` names. Host-owned methodology SHALL be described as a branch of its host rather than as a standalone skill. The map SHALL reflect the post-consolidation state and SHALL NOT reference absent grill skills, removed parallel-lifecycle skills, removed methodology identities, `rasen-qa-only`, or `rasen-workflow-review`.

#### Scenario: Four-part map present

- **WHEN** the installed help navigator reference is inspected
- **THEN** it SHALL contain a main flow, on-ramps, a vocabulary layer, and a standalone section
- **AND** each route SHALL have a one-line "when to use"
- **AND** each invokable skill SHALL use its canonical `rasen-*` name, not a `/rasen:*` colon reference

#### Scenario: Reflects absorbed skills

- **WHEN** the help navigator map is inspected
- **THEN** `rasen-investigate` SHALL be described as refusing to hypothesise before a red-capable feedback loop
- **AND** `rasen-review` SHALL be described as a two-axis (Standards + Spec) review
- **AND** codebase design, TDD, prototype, workflow review, and report-only QA SHALL be routed through their surviving hosts

#### Scenario: No fork-absent grill skills referenced

- **WHEN** the help navigator map is inspected
- **THEN** it SHALL NOT reference `/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-me`, `/grill-with-docs`, or `/setup-matt-pocock-skills`

#### Scenario: No removed parallel-lifecycle skills referenced

- **WHEN** the help navigator map is inspected
- **THEN** it SHALL NOT reference `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/document-release`, or a standalone `/retro` expert
- **AND** the main flow SHALL retain `rasen-ship` → `rasen-retain` → `rasen-archive-change`
- **AND** `rasen-retro` SHALL appear only as a compatibility alias outside that main flow

#### Scenario: No removed methodology skill referenced

- **WHEN** the help navigator map is inspected
- **THEN** it SHALL NOT present `/domain-modeling`, `rasen-codebase-design`, `rasen-tdd`, `rasen-prototype`, `rasen-workflow-review`, or `rasen-qa-only` as invokable skills

#### Scenario: Ship entry reflects the delivery modes

- **WHEN** the help navigator map's main flow is inspected
- **THEN** the `rasen-ship` one-liner SHALL name the three delivery modes (pr / push / local) and evidence-gated testing
- **AND** it SHALL remain a one-line route, not the full ship contract

### Requirement: Navigator maps Direction as an optional long-horizon on-ramp

The navigator reference bundled with `rasen-help` SHALL describe `rasen-direction` as an optional governance workflow above the normal Change flow for work spanning multiple Changes, versions, horizons, projects, or recurring principle-level choices. It SHALL keep the ordinary main flow unchanged and distinguish Direction Target State from `rasen-goal`.

#### Scenario: Direction appears outside the mandatory main line

- **WHEN** the installed help navigator reference is inspected
- **THEN** it SHALL name `rasen-direction` using its canonical skill name
- **AND** SHALL describe establish/select/project/reconcile use in a concise "when to reach for it" entry
- **AND** SHALL NOT place Direction as a required numbered step in the main Change flow

#### Scenario: Navigator preserves direct daily work

- **WHEN** the help navigator reference explains the ordinary idea-to-ship flow
- **THEN** that flow SHALL continue from exploration/office-hours to propose without a mandatory Direction step
- **AND** Direction SHALL be presented only for long-horizon governance needs

#### Scenario: Navigator separates target concepts

- **WHEN** the help navigator reference names both `rasen-direction` and `rasen-goal`
- **THEN** it SHALL identify Direction Target State as cross-Change workstream state
- **AND** SHALL identify `rasen-goal` as bounded iteration toward a gate

### Requirement: Navigator routes scope control without a runtime boundary

The navigator reference bundled with `rasen-help` SHALL contain no freeze/unfreeze or runtime edit-boundary route. It SHALL direct destructive-command caution to `rasen-careful`, root-cause isolation and declared affected-area work to `rasen-investigate`, and changed-file/diff checking to the applicable review or verification workflow. It SHALL not describe any of those routes as mechanical write denial.

#### Scenario: Safety routing uses remaining controls

- **WHEN** a user asks help how to avoid accidental scope creep
- **THEN** the navigator reference SHALL identify investigation scope declaration and changed-file review as the applicable controls
- **AND** SHALL distinguish those controls from destructive-command caution and managed sandbox execution

#### Scenario: Retired route is absent

- **WHEN** the generated `rasen-help` skill and its navigator reference are inspected
- **THEN** no `freeze`, `unfreeze`, `guard`, or `rasen agent edit-boundary` route or invocation SHALL appear
- **AND** the map SHALL make no hard, soft, or unsupported edit-boundary enforcement claim

### Requirement: Help owns and lazily loads the navigator map

`rasen-help` SHALL be the single public Rasen routing surface. It SHALL ship a bundled `references/navigator.md` map and load that reference only when the user asks a broad cross-workflow, expert-selection, scope-control, or "which route" question that needs more detail than the shallow help router. The reference SHALL retain the adapted MIT attribution and the host SHALL close with one next action.

#### Scenario: Broad routing question loads the navigator reference

- **WHEN** a user asks `rasen-help` to compare multiple Rasen workflows or experts
- **THEN** help SHALL read its bundled navigator reference before answering
- **AND** SHALL route to one next action rather than running the selected workflow itself

#### Scenario: Simple help does not load the detailed map

- **WHEN** a user asks a direct command-specific question that the shallow help body answers
- **THEN** help SHALL answer it without loading the navigator reference

