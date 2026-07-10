# cli-validate Specification (delta)

## MODIFIED Requirements

### Requirement: Validation SHALL provide actionable remediation steps
Validation output SHALL include specific guidance to fix each error, including expected structure, example headers, and suggested commands to verify fixes.

#### Scenario: No deltas found in change
- **WHEN** validating a change with zero parsed deltas
- **THEN** show error "No deltas found" with guidance:
  - Explain that change specs must include `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, or `## RENAMED Requirements`
  - Remind authors that files must live under `rasen/changes/{id}/specs/<capability>/spec.md`
  - Include an explicit note: "Spec delta files cannot start with titles before the operation headers"
  - Suggest running `rasen show {id} --json --deltas-only` for debugging

#### Scenario: Missing required sections
- **WHEN** a required section is missing
- **THEN** include expected header names and a minimal skeleton:
  - For Spec: `## Purpose`, `## Requirements`
  - For Change: `## Why`, `## What Changes`
  - Provide an example snippet of the missing section with placeholder prose ready to copy
  - Mention the quick-reference section in `rasen/AGENTS.md` as the authoritative template

#### Scenario: Missing requirement descriptive text
- **WHEN** a requirement header lacks descriptive text before scenarios
- **THEN** emit an error explaining that `### Requirement:` lines must be followed by narrative text before any `#### Scenario:` headers
  - Show compliant example: "### Requirement: Foo" followed by "The system SHALL ..."
  - Suggest adding 1-2 sentences describing the normative behavior prior to listing scenarios
  - Reference the pre-validation checklist in `rasen/AGENTS.md`

### Requirement: Invalid results SHALL include a Next steps footer in human-readable output
The CLI SHALL append a Next steps footer when the item is invalid and not using `--json`, including:
- Summary line with counts
- Top-3 guidance bullets (contextual to the most frequent or blocking errors)
- A suggestion to re-run with `--json` and/or the debug command

#### Scenario: Change invalid summary
- **WHEN** a change validation fails
- **THEN** print "Next steps" with 2-3 targeted bullets and suggest `rasen show <id> --json --deltas-only`
