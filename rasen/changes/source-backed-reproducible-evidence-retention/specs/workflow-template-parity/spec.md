## REMOVED Requirements

### Requirement: Workflow and orchestration templates are covered by the parity golden master

**Reason**: Retire the permanent template hash gate and its hash-specific scenarios.
**Migration**: Use generated workflow delivery validation below; preserve orchestration behavior and canonical-source ownership.

### Requirement: Direction workflow template is parity-pinned

**Reason**: Retire Direction's mandatory hash-pinning mechanism.
**Migration**: Use generated Direction delivery validation below; preserve selection guidance and workflow references.

## ADDED Requirements

### Requirement: Generated workflow skills are validated through delivery

Workflow and orchestration skill templates outside the expert set SHALL be validated through actual generation and installation rather than template function/content hashes. Covered skills SHALL include `rasen-office-hours-command`, `rasen-verify-enhanced`, `rasen-ship`, `rasen-retro`, `rasen-auto`, `rasen-review-cycle`, `rasen-handoff`, `rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, and `rasen-goal`. Retired command templates SHALL remain absent.

When shared orchestration source or its feature-reduced replacement prose changes, the maintained delivery flow SHALL compile the template source and refresh installed/dogfooding generated skills with the built CLI update command. Verification SHALL inspect actually affected generated skills and record proportionate behavioral evidence without permanent prompt-string, wiring, or hash assertions. Generated skill output SHALL reflect canonical source and SHALL NOT be edited as an independent source of truth.

#### Scenario: Workflow skills are generated and installed

- **WHEN** workflow template changes are verified
- **THEN** validation SHALL exercise generation and installation of the covered skills through the normal product path
- **AND** it SHALL record exercised commands, affected consumers, observed results, and limits

#### Scenario: Retired command templates remain absent

- **WHEN** workflow skills are generated and installed
- **THEN** the delivery flow SHALL NOT restore retired command templates

#### Scenario: Shared Step H edit follows build and update

- **WHEN** the canonical orchestration template's threshold precedence prose changes
- **THEN** the implementation SHALL run the repository build before `node dist/cli/index.js update`
- **AND** the refreshed generated skill content SHALL carry the binding-aware Step H text

#### Scenario: Shared changes are checked in affected consumers

- **WHEN** shared Step H changes are verified
- **THEN** verification SHALL inspect the affected full and reduced generated consumers for the intended handoff behavior
- **AND** it SHALL NOT substitute recomputed template hashes for that evidence

#### Scenario: Feature-reduced orchestration text cannot retain old precedence

- **WHEN** a workflow renders a reduced orchestration feature set that replaces the full reuse paragraph
- **THEN** its generated handoff guidance SHALL still include the runtime-bound handoff scheme layer and inherited-store layer in the correct order

### Requirement: Generated Direction skill is validated through delivery

The canonical `rasen-direction` workflow template SHALL participate in actual workflow generation and installation validation. Its generated output SHALL preserve cross-workflow references and Store/project selection guidance. Verification SHALL inspect these behaviors without requiring permanent prompt-string, wiring, or hash tests.

#### Scenario: Direction is generated and installed

- **WHEN** the Direction skill body changes
- **THEN** validation SHALL generate and install `rasen-direction` from canonical TypeScript source through the normal product path
- **AND** it SHALL record the commands, results, and any unverified scope

#### Scenario: Direction follows generated workflow guards

- **WHEN** generated workflow skill bodies are checked
- **THEN** `rasen-direction` SHALL include the shared Store/project selection guidance
- **AND** it SHALL contain no `/rasen:` colon-form cross-workflow reference

#### Scenario: Direction output derives from canonical source

- **WHEN** the Direction skill body changes
- **THEN** maintainers SHALL regenerate the installed skill from its canonical TypeScript template
- **AND** generated installed skill files SHALL NOT become an independent authored source
