## ADDED Requirements

### Requirement: Parked-worker beat economy discipline

The generated orchestration playbook (the shared template embedded in the autopilot, goal, and review-cycle skills) SHALL state the beat economy discipline for parked workers:

1. **Timeout pairing in park dispatches**: every dispatch instruction that tells a worker to park via `rasen agent wait` SHALL, in the same instruction, require the wait call to be issued with an explicit shell tool `timeout` of 330000 milliseconds — a fixed constant covering the maximum configurable beat (280 seconds) plus margin — so a configured beat is never killed by the shell tool's default timeout.
2. **Beat silence**: on receiving a `{beat}` outcome the worker SHALL emit no visible text and no deliberation — it immediately re-issues the identical wait call, so each continuation remains a pure tool-result extension of the cached prefix.
3. **Prompt stand-down**: the LEAD SHALL write a `standDown` signal as soon as a parked worker is no longer needed; the beat cap SHALL be described as a stop-loss backstop, not the retirement mechanism.
4. **Long-command warming**: the playbook's long-running-task discipline SHALL direct that commands expected to exceed roughly 2 minutes, or of unknown duration (test suites, builds), run via the shell tool's background mode with bounded foreground polling at intervals of at most 270 seconds — stating both rationales: background-completion notifications can be lost, and each foreground poll return refreshes the prompt cache — while short commands stay in the foreground. The polling interval bound SHALL be the fixed 270-second figure, not a value derived from the beat configuration.

#### Scenario: Park dispatch pairs beat and timeout

- **WHEN** the generated playbook's parked-worker keepalive section is inspected
- **THEN** it requires park dispatch wording to name the explicit 330000 ms tool timeout together with the `rasen agent wait` call

#### Scenario: Beat outcome is silent

- **WHEN** the playbook describes handling of a `{beat, remaining}` outcome
- **THEN** it requires the worker to re-issue the wait call immediately with no intervening prose or deliberation

#### Scenario: Stand-down is prompt, cap is backstop

- **WHEN** the playbook describes ending a park
- **THEN** it directs the LEAD to write the `standDown` signal as soon as the worker is no longer needed and characterizes the beat cap as a stop-loss backstop

#### Scenario: Long commands run backgrounded with bounded polling

- **WHEN** the playbook's long-running-task discipline is inspected
- **THEN** it directs commands over ~2 minutes or of unknown duration to background execution with foreground polling at intervals of at most 270 seconds, citing both the lost-notification and cache-refresh rationales, and keeps short commands in the foreground
