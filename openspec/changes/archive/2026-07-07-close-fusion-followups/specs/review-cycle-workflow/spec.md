## MODIFIED Requirements

### Requirement: Gate-Run Test Evidence Is Recorded for Ship

The cycle report SHALL record test evidence consumable by the ship stage's evidence-based test gate: for the final clean round (and for every Tier C gate-run), the exact test/gate command(s) executed, their result, and the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the git code state they ran against.

#### Scenario: Final clean round records test evidence

- **WHEN** a review cycle ends clean
- **THEN** `review-cycle-report.md` SHALL record the test/gate command(s) of the final round, their passing result, and the content tree fingerprint (`git rev-parse HEAD^{tree}`) of the git state they ran against

#### Scenario: Ship consumes the evidence

- **WHEN** a later ship stage evaluates its evidence-based test gate
- **THEN** the recorded content tree fingerprint SHALL be sufficient to decide whether the code state is unchanged since the last green run, by direct comparison against the ship-time tree fingerprint
