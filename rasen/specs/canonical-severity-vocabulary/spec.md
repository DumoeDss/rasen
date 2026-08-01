# canonical-severity-vocabulary Specification

## Purpose
Blocker/Major/Minor/Trivial as the single canonical severity scale plus the per-expert mapping table (review CRITICAL/INFORMATIONAL, cso CRITICAL|HIGH|MEDIUM, qa/qa-only critical/high/medium/low/cosmetic, benchmark REGRESSION/WARNING/OK+Grade, design-review impact+Grade, codex P1/P2), carried in the shared expert PREAMBLE and self-applied by experts in dispatched mode.
## Requirements
### Requirement: Canonical severity vocabulary defined in the shared expert PREAMBLE

The shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`, the `PREAMBLE` constant) SHALL carry a **Canonical severity vocabulary** section defining the single canonical scale used by the review→fix loop and the verify stage: **Blocker**, **Major**, **Minor**, **Trivial**. It SHALL give a one-line criterion for each (Blocker = must not ship / wrong on a common path / data loss / exploitable / failing gate / missing required spec behavior; Major = should not ship without a decision / wrong on a plausible path / significant regression; Minor = ship-able friction, recorded as accepted-known; Trivial = cosmetic). This vocabulary is the producer-side definition of the scale that the review-cycle and orchestration loops already consume.

#### Scenario: Canonical vocabulary present in generated preamble

- **WHEN** any expert skill that embeds the PREAMBLE is regenerated and its `SKILL.md` inspected
- **THEN** it SHALL define Blocker, Major, Minor, and Trivial as the canonical severity scale
- **AND** SHALL give a one-line criterion for each level

### Requirement: Per-expert severity mapping and self-mapping in dispatched mode

The PREAMBLE SHALL carry a per-expert mapping table for every surviving finding producer: review `CRITICAL`/`INFORMATIONAL`, cso `CRITICAL|HIGH|MEDIUM`, qa `critical/high/medium/low/cosmetic`, benchmark `REGRESSION/WARNING/OK` plus letter grade, design-review impact `high/medium/polish` plus letter grade, and codex `[P1]/[P2]`. The QA mapping SHALL apply identically to UI, dispatched, and explicit report-only/non-UI QA modes. The mapping SHALL state that finding content overrides the native label where they disagree. In dispatched mode each expert SHALL self-map and tag every finding in its canonical report so the LEAD never infers the mapping.

#### Scenario: Mapping table present in generated preamble

- **WHEN** the generated PREAMBLE is inspected
- **THEN** it SHALL contain a mapping from each surviving producer's native scale to Blocker/Major/Minor/Trivial
- **AND** SHALL define one QA mapping that covers all QA modes
- **AND** SHALL state that a data-loss, security, or corruption finding maps up regardless of its native label

#### Scenario: dispatched experts emit canonical severity

- **WHEN** the generated `review`, `cso`, `qa`, `benchmark`, or `design-review` skill is inspected
- **THEN** it SHALL state that each dispatched finding is tagged with a canonical severity in the report file
- **AND** no mapping or scenario SHALL depend on a separate `qa-only` identity
