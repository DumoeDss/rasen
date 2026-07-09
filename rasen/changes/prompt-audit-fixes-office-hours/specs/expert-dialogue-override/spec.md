# expert-dialogue-override delta

## ADDED Requirements

### Requirement: AskUserQuestion Format Re-ground defers to the Dialogue Override

The AskUserQuestion Format in the shared expert PREAMBLE (`src/core/templates/experts/_shared.ts`) SHALL state that its Re-ground step (step 1: state the project, branch, and current plan/task) defers to the Dialogue Override's re-ground rule — the restatement belongs at the start of a session or after a genuine long gap, NOT on every consecutive AskUserQuestion call in a continuous back-and-forth. The Format's "for every AskUserQuestion call" framing SHALL NOT read as requiring the full project/branch/plan opener between consecutive replies.

#### Scenario: Format step 1 points to the Dialogue Override

- **WHEN** the AskUserQuestion Format section of the regenerated preamble is inspected
- **THEN** its Re-ground step SHALL state that re-grounding follows the Dialogue Override rule (session start / after a genuine gap)
- **AND** SHALL state that the full project/branch/plan opener is not repeated on every consecutive AskUserQuestion call in continuous conversation
