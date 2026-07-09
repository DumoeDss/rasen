# review-cycle-workflow — Delta

## ADDED Requirements

### Requirement: Gate-Run Test Evidence Is Recorded for Ship

The cycle report SHALL record test evidence consumable by the ship stage's evidence-based test gate: for the final clean round (and for every Tier C gate-run), the exact test/gate command(s) executed, their result, and the git code state they ran against (HEAD plus whether the working tree was dirty).

#### Scenario: Final clean round records test evidence

- **WHEN** a review cycle ends clean
- **THEN** `review-cycle-report.md` SHALL record the test/gate command(s) of the final round, their passing result, and the git state (HEAD, working-tree dirty or clean) they ran against

#### Scenario: Ship consumes the evidence

- **WHEN** a later ship stage evaluates its evidence-based test gate
- **THEN** the recorded evidence SHALL be sufficient to decide whether the code state is unchanged since the last green run
