## ADDED Requirements

### Requirement: Archive workflows honor reserved evidence and engine recovery disposition

Generated single and bulk archive workflows SHALL treat `## Archive` in `ship-log.md` as engine-reserved, SHALL verify recorded PR merge state before apply, and SHALL follow the engine's typed recovery disposition. After merge verification, the workflow SHALL supply `--yes` to saved-plan apply as the merge assertion; it SHALL NOT need to rewrite or replace the reviewed plan. It SHALL replay an exact token only for `recoverable`, run the confirmed ownership-verified abort flow for `abort-required`, and surface verified manual recovery without editing engine state.

#### Scenario: Reserved section stops before saved planning

- **WHEN** the selected ship log already contains a level-two `## Archive` heading
- **THEN** the workflow SHALL stop before requesting an applicable saved plan
- **AND** it SHALL explain that only the archive engine owns the section and ask the operator to remove or rename it

#### Scenario: Verified merge is asserted at apply

- **WHEN** the workflow has verified that a recorded PR delivery merged and its saved preview has no blocker other than invocation-time confirmation
- **THEN** it SHALL apply the exact returned token with `--yes`
- **AND** it SHALL NOT regenerate intent, alter the plan, or require merge confirmation to be frozen into the saved preview

#### Scenario: Recoverable result replays the exact token

- **WHEN** the engine returns `recoverable` with an exact-token recovery command
- **THEN** the workflow SHALL rerun that command after the named repair
- **AND** it SHALL NOT re-plan or hand-edit the journal

#### Scenario: Abort-required result does not replay forever

- **WHEN** the engine returns `abort-required` for an early deterministic conflict
- **THEN** the workflow SHALL present the engine's `--abort-plan` command for explicit confirmation
- **AND** after successful abort it SHALL correct the active source and create a new saved plan
- **AND** it SHALL NOT describe replaying the failed token as recovery

#### Scenario: Manual integrity action remains manual

- **WHEN** the engine returns a verified manual-recovery action because ownership or integrity cannot be proved
- **THEN** the workflow SHALL surface that action and stop
- **AND** it SHALL NOT delete a stage, journal, plan, or archive entry itself
