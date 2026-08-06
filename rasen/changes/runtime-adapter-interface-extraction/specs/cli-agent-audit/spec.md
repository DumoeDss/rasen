## ADDED Requirements

### Requirement: An audit target from a harness with no auditor is refused, not fabricated

When an audit target is recognized as belonging to a harness for which Rasen ships no token auditor, `rasen agent audit` SHALL refuse it with a message naming that harness, and SHALL NOT analyze it with another harness's parser. A report SHALL never be attributed to a runtime that did not produce the session it describes.

The refusal SHALL happen before any report file is written, so a refused audit leaves nothing on disk for a viewer or a management surface to read as a real measurement.

#### Scenario: A session file from an unauditable harness is refused

- **WHEN** a user runs `rasen agent audit <path>` and the file is recognized as belonging to a harness with no token auditor
- **THEN** the CLI SHALL exit non-zero
- **AND** the message SHALL name the recognized harness and state that no auditor exists for it
- **AND** SHALL NOT write a report file

#### Scenario: A report is never attributed to a foreign runtime

- **WHEN** any audit completes successfully
- **THEN** the report's recorded runtime SHALL be the runtime whose auditor produced it
- **AND** a session that could not be analyzed by that auditor SHALL NOT appear as a zero-valued report of that runtime

#### Scenario: Supported audit targets are unaffected

- **WHEN** a Claude transcript, a Codex rollout, or a Zed thread database is audited by session id, by path, or with an explicit `--runtime`
- **THEN** target resolution, analysis, report contents, and the report's output location SHALL be identical to their behavior before this capability
