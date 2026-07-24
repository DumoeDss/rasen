## ADDED Requirements

### Requirement: Temporary user-invoked retro compatibility wrapper

The system SHALL provide `rasen-retro` only as a temporary compatibility wrapper for direct user invocation. The wrapper SHALL declare `disable-model-invocation: true`, SHALL forward the user's scope and change arguments to `rasen-retain`, and SHALL force `report` mode regardless of the active profile's retention mode. It SHALL NOT be selectable in current or named profiles, participate in workflow dependency closure, appear as a model-invokable workflow, or invoke codification.

#### Scenario: User invokes retro while retention is off
- **WHEN** a user directly invokes `rasen-retro` while the active profile retention mode is `off`
- **THEN** the wrapper SHALL run `rasen-retain` in forced `report` mode with the same arguments
- **AND** it SHALL NOT change the saved profile retention mode

#### Scenario: User invokes retro while retention is codify
- **WHEN** a user directly invokes `rasen-retro` while the active profile retention mode is `codify`
- **THEN** the wrapper SHALL run only the report branch
- **AND** it SHALL NOT create, update, promote, or retire a learned skill

#### Scenario: Wrapper cannot be model-invoked or selected
- **WHEN** workflow metadata, the model-invocation surface, or a profile picker is enumerated
- **THEN** `rasen-retro` SHALL be marked `disable-model-invocation: true` and absent from selectable workflow IDs
- **AND** it SHALL remain available only through the temporary direct user-invocation compatibility surface

## MODIFIED Requirements

### Requirement: Three Retro Scopes

The `report` branch of `rasen-retain` SHALL preserve three retrospective scopes: change-scoped, general, and global. General and global reporting SHALL run the existing self-contained git-analysis contract and SHALL NOT delegate to a legacy `/retro` expert skill. The temporary `rasen-retro` wrapper SHALL preserve the same scope selection by forwarding its arguments while forcing report mode.

#### Scenario: Change-scoped report invocation
- **WHEN** `rasen-retain` runs in `report` mode for a specific change, or a user invokes `rasen-retro <change-name>`
- **THEN** reporting SHALL run in change-scoped mode
- **AND** SHALL read artifacts from the specified change directory and its resolved work directory

#### Scenario: General report invocation
- **WHEN** `rasen-retain` runs in `report` mode without a change name, or a user invokes `rasen-retro` without a change name
- **AND** the user selects general scope
- **THEN** reporting SHALL gather recent commit, author, and LOC data from git and compute metrics itself
- **AND** SHALL produce insights based on commit patterns, frequency, code areas touched, and a per-author breakdown
- **AND** SHALL complete without invoking any legacy `/retro` expert skill

#### Scenario: Global report invocation
- **WHEN** `rasen-retain` runs in `report` mode with global scope, or a user invokes `rasen-retro global`
- **THEN** reporting SHALL run cross-project analysis using its own git-analysis contract
- **AND** SHALL produce insights spanning multiple repositories if available
- **AND** SHALL complete without invoking any legacy `/retro` expert skill

### Requirement: Change-Scoped Artifact Reading

Change-scoped report mode SHALL read all available change artifacts: review material (proposal, design, tasks, delta specs) from the change directory, and process ephemera (review/qa/cso reports, ship-log, verification report, run-state) from the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability), falling back to the change directory for ephemera that live there for legacy changes.

#### Scenario: Full artifact set available
- **WHEN** running a change-scoped report
- **AND** the change directory contains proposal.md, design.md, and tasks.md, and the resolved ephemera location contains review-report.md, qa-report.md, and ship-log.md
- **THEN** reporting SHALL read and analyze all of these artifacts
- **AND** SHALL correlate planning artifacts (proposal, design) with outcome artifacts (review, qa, ship-log)

#### Scenario: Partial artifact set
- **WHEN** running a change-scoped report
- **AND** some artifacts are missing from both the work directory and the change directory
- **THEN** reporting SHALL analyze whatever artifacts are available
- **AND** SHALL note which artifacts were missing and what analysis was skipped

#### Scenario: Legacy change reads its change-dir ephemera
- **WHEN** running a change-scoped report on a change whose reports predate the work directory
- **THEN** reporting SHALL find and analyze those reports in the change directory via the fallback

#### Scenario: Specs directory reading
- **WHEN** running a change-scoped report
- **AND** `specs/` directory exists in the change
- **THEN** reporting SHALL read delta specs to understand what was specified vs what was delivered

#### Scenario: Artifact paths are cross-platform
- **WHEN** change-scoped report mode resolves planning artifacts, the registry-backed work directory, or the legacy fallback on POSIX or Windows
- **THEN** every location SHALL be constructed and compared with platform-native path handling
- **AND** Windows drive-letter, separator, and case-insensitive aliases SHALL resolve to the same registered change and work locations

### Requirement: Retro Report Output

The report branch SHALL preserve retrospective report output. A change-scoped report SHALL be written to the change directory as `retro.md`; general reporting SHALL preserve the latest general report location. Report mode SHALL display the same summary and actionable takeaways whether invoked through `rasen-retain` or the temporary `rasen-retro` wrapper.

#### Scenario: Report written for change-scoped retro
- **WHEN** a change-scoped report completes
- **THEN** the report SHALL be written to the platform-resolved equivalent of `rasen/changes/<name>/retro.md`
- **AND** the report SHALL include: what went well, what could improve, key metrics (time from proposal to ship, number of review iterations), and actionable takeaways

#### Scenario: Report written for general retro
- **WHEN** a general report completes
- **THEN** the report SHALL be written to the platform-resolved equivalent of `rasen/retro-latest.md`
- **AND** the report SHALL include: commit pattern analysis, areas of high churn, and improvement suggestions

#### Scenario: Report display
- **WHEN** the retrospective report is written
- **THEN** the agent SHALL also display the report summary to the user
- **AND** SHALL highlight the top 3 actionable takeaways

#### Scenario: Report paths are cross-platform
- **WHEN** report output is written on POSIX or Windows
- **THEN** the destination SHALL be joined from the resolved planning root or change root with platform-native path operations
- **AND** no hardcoded separator or Unix home assumption SHALL be required

## REMOVED Requirements

### Requirement: Retro Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for retro in `src/core/templates/workflows/retro.ts`.

#### Scenario: Template file exports
- **WHEN** the template file is loaded
- **THEN** it SHALL export `getRetroCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxRetroCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates

#### Scenario: Skill installation via rasen init
- **WHEN** user runs `rasen init`
- **THEN** the retro skill SHALL be generated into `.claude/skills/`
- **AND** the retro command SHALL be generated into `.claude/commands/`

**Reason**: The standalone profile-selectable and model-invoked retro workflow is replaced by the `report` branch of `rasen-retain`, and the command delivery surface is retired. Keeping the old workflow and command templates would allow report and codify to be selected independently and would preserve a model-invokable identity that no longer belongs in the workflow catalog.

**Migration**: Use `rasen-retain` with profile retention `report` for the canonical workflow. Existing version 1 profile selections migrate `retro-command` to `retention: report` and remove that workflow ID. Direct user invocations of `rasen-retro` continue temporarily through the `disable-model-invocation` compatibility wrapper defined above.
