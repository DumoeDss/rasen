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

The PREAMBLE SHALL carry a per-expert mapping table that maps every expert's native scale onto the canonical scale: review `CRITICAL`/`INFORMATIONAL`, cso `CRITICAL|HIGH|MEDIUM`, qa/qa-only `critical/high/medium/low/cosmetic`, benchmark `REGRESSION/WARNING/OK` plus letter grade, design-review impact `high/medium/polish` plus letter grade, and codex `[P1]/[P2]`. The mapping SHALL state that finding content overrides label where they disagree (a data-loss/security/corruption item maps up regardless of its native label — e.g. a review `INFORMATIONAL` item naming silent data corruption maps to Major, not Minor). In dispatched mode each expert SHALL self-map and tag every finding it emits with a canonical severity, written into its canonical report file, so the LEAD/loop never has to infer a mapping.

#### Scenario: Mapping table present in generated preamble

- **WHEN** the generated PREAMBLE is inspected
- **THEN** it SHALL contain a mapping from each of review, cso, qa, benchmark, design-review, and codex native scales to Blocker/Major/Minor/Trivial
- **AND** SHALL state that a data-loss/security/corruption finding maps up regardless of its native label

#### Scenario: dispatched experts emit canonical severity

- **WHEN** the generated `review`, `cso`, `qa`, `qa-only`, `benchmark`, or `design-review` `SKILL.md` is inspected
- **THEN** it SHALL state that in dispatched mode each finding is tagged with a canonical Blocker/Major/Minor/Trivial severity in the report file
