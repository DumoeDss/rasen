## ADDED Requirements

### Requirement: Resume matches the latest generation's distillation

The Step F.1 resume ladder in the orchestration playbook (`src/core/templates/workflows/_orchestration.ts`) SHALL prefer a handoff or retirement document over a transcript ONLY when that document is the LATEST holder's own distillation of the role's final state. If the role's latest holder died un-exhausted (an unexpected interruption) leaving no document, the LEAD SHALL resume from that holder's transcript (the warm-seed of step 3); an intact transcript of the latest generation SHALL take precedence over any earlier generation's document. The LEAD SHALL NOT seed a successor from a stale predecessor's document when a newer holder's context survives unrecorded.

#### Scenario: Un-exhausted latest holder with no document, older document present

- **WHEN** the LEAD re-engages a role whose latest holder died un-exhausted without writing a handoff document
- **AND** an earlier generation of that role left a retirement or handoff document
- **THEN** the LEAD SHALL resume from the latest holder's transcript (step 3), NOT the earlier generation's document
- **AND** SHALL NOT treat the stale document as the resume source

#### Scenario: Latest holder's own document present

- **WHEN** the role's latest holder wrote its own handoff or retirement document distilling its final state
- **THEN** the LEAD SHALL seed the fresh worker from that document, as the document-first path already prescribes

#### Scenario: Same-session restart may still resolve the live handle

- **WHEN** the resume follows a restart in which the session directory survived
- **THEN** the LEAD MAY find that `SendMessage`-by-name still resolves to the latest holder
- **AND** SHALL attempt that wake first, falling back to the F.1 ladder only if the wake does not resolve
