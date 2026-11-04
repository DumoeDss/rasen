# Teacher Advisor Contracts Reference

This file is a sidecar reference for the `rasen-teacher-advisor` expert skill.

## Invocation Contract: `teacher-consultation/invocation/1`

Fields: `contract`, `consultationId`, `consultationOrdinal`, `teacherAttempt`, `source`, `question`, `allowedDecisions`.

## Advice Contract: `teacher-consultation/advice/1`

Fields: `contract`, `consultationId`, `teacherAttempt`, `decision`, `rationale`, `steps`, `cautions`, `evidenceNotes`.

## Decisions

- `plan` — propose a path forward
- `correction` — adjust the current approach
- `stop` — advise stopping (advisory only, no Run authority)

## Posture

The Teacher Advisor is strictly read-only: no file edits, no command execution, no external effects.
