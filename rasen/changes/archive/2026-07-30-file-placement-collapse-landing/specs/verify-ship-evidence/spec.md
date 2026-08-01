## MODIFIED Requirements

### Requirement: verify-change persists a verification report file

The `verify-change` workflow (`src/core/templates/workflows/verify-change.ts`, both the skill getter and the command getter) SHALL write its verification result to a durable file `verification-report.md` in the change's evidence directory (`<changeRoot>/evidence/`, the `evidenceDir` reported by the CLI per the `file-placement` capability), with the sticky-legacy fallback: a report that already exists in the legacy machine-home work directory or the change directory is updated in place. The report SHALL contain the summary scorecard, the canonical verdict status line, and the grouped findings. It SHALL NOT emit its result only to the conversation.

#### Scenario: plain verify leaves a discoverable report

- **WHEN** the generated `verify-change` skill and command are inspected
- **THEN** each SHALL instruct writing `verification-report.md` to the evidence directory (falling back to the legacy location when a report already lives there)
- **AND** the written report SHALL include the summary scorecard and the findings

### Requirement: ship pre-flight consumes the verification report file

The `ship` workflow (`src/core/templates/workflows/ship.ts`) pre-flight verification check SHALL accept `verification-report.md` as verification evidence alongside `review-report.md`, `review-cycle-report.md`, and the other expert `*-report.md` files, looking in the change's evidence directory first, then the legacy machine-home work directory, then the change directory, so that running `/rasen-verify-change` satisfies the gate with no orphan consumer.

#### Scenario: ship recognizes verify-change output as evidence

- **WHEN** the generated `ship` skill pre-flight is inspected
- **THEN** its verification-evidence list SHALL include `verification-report.md`, resolved in the evidence directory with the legacy fallbacks
- **AND** SHALL treat its presence as satisfying the verification gate
