## MODIFIED Requirements

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
