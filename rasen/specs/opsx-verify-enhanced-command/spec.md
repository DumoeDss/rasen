# opsx-verify-enhanced-command Specification

## Purpose
Provide the enhanced `/opsx:verify` command with auto-scaling verification depth (full / standard / light pipelines) and a verification report.

## Requirements
### Requirement: Verify-Enhanced Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for verify-enhanced in `src/core/templates/workflows/verify-enhanced.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getVerifyEnhancedSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxVerifyEnhancedCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates

#### Scenario: Coexistence with existing verify

- **WHEN** `openspec init` generates skills
- **THEN** the existing `openspec-verify-change` skill SHALL remain unchanged
- **AND** the new `openspec-verify-enhanced` skill SHALL be generated alongside it
- **AND** users SHALL choose which verify command to use in their workflow

### Requirement: Auto-Scaling Verification Depth

Verification depth SHALL auto-scale based on change scope: Full, Standard, or Light.

#### Scenario: Full verification for multi-file or UI changes

- **WHEN** the change involves multiple files or UI components
- **THEN** verification depth SHALL be classified as Full
- **AND** the system SHALL run: artifact checks + /review + /cso (if security-relevant) + /qa + /design-review (if UI)

#### Scenario: Standard verification for small features

- **WHEN** the change is a small, single-purpose feature
- **THEN** verification depth SHALL be classified as Standard
- **AND** the system SHALL run: artifact checks + /review + conditional /cso + /qa-only

#### Scenario: Light verification for bug fixes

- **WHEN** the change is a bug fix with minimal scope
- **THEN** verification depth SHALL be classified as Light
- **AND** the system SHALL run: artifact checks + /review only

#### Scenario: Scope classification inputs

- **WHEN** determining verification depth
- **THEN** the system SHALL consider: number of files changed, presence of UI components, proposal scope description, and task count

### Requirement: Full Verification Pipeline

Full verification SHALL run artifact checks combined with multiple gstack expert reviews.

#### Scenario: Full pipeline execution with security-relevant change

- **WHEN** full verification runs
- **AND** the change touches authentication, authorization, input validation, or data handling
- **THEN** the system SHALL invoke artifact consistency checks
- **AND** SHALL invoke /review for code review
- **AND** SHALL invoke /cso for security review
- **AND** SHALL invoke /qa for quality assurance review

#### Scenario: Full pipeline execution with UI change

- **WHEN** full verification runs
- **AND** the change includes UI components
- **THEN** the system SHALL additionally invoke /design-review for UI/UX review

#### Scenario: Full pipeline execution without security or UI relevance

- **WHEN** full verification runs
- **AND** the change has no security or UI relevance
- **THEN** the system SHALL invoke artifact checks, /review, and /qa
- **AND** SHALL skip /cso and /design-review

### Requirement: Standard Verification Pipeline

Standard verification SHALL run artifact checks with code review and conditional expert reviews.

#### Scenario: Standard pipeline execution

- **WHEN** standard verification runs
- **THEN** the system SHALL invoke artifact consistency checks
- **AND** SHALL invoke /review for code review
- **AND** SHALL invoke /qa-only (abbreviated QA check)
- **AND** SHALL invoke /cso only if the change is security-relevant

### Requirement: Light Verification Pipeline

Light verification SHALL run artifact checks with code review only.

#### Scenario: Light pipeline execution

- **WHEN** light verification runs
- **THEN** the system SHALL invoke artifact consistency checks
- **AND** SHALL invoke /review for code review
- **AND** SHALL NOT invoke /cso, /qa, or /design-review

### Requirement: Report Output

Reports SHALL be saved to the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback).

#### Scenario: Report files written after verification

- **WHEN** verification completes
- **THEN** the review report SHALL be saved as `review-report.md` in the resolved work directory (or the legacy location per the fallback)
- **AND** the CSO report SHALL be saved as `cso-report.md` there (if /cso was invoked)
- **AND** the QA report SHALL be saved as `qa-report.md` there (if /qa was invoked)

#### Scenario: Consolidated summary

- **WHEN** all verification stages complete
- **THEN** the agent SHALL display a consolidated summary with pass/fail status for each stage
- **AND** SHALL list critical issues requiring resolution before shipping

