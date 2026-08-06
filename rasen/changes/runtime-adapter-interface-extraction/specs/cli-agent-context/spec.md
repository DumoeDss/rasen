## ADDED Requirements

### Requirement: A transcript from a harness with no context reader is refused, not measured

When a transcript is recognized as belonging to a harness for which Rasen ships no context reader, `rasen agent context` SHALL refuse it with a message naming that harness, and SHALL NOT measure it with another harness's reader. This applies wherever the transcript reaches the probe — an explicit `--transcript <path>`, a recorded worker transcript consulted by pipeline inspection, or any other caller — because reading one harness's file with another harness's field names yields a confident number that describes nothing.

An explicit `--transcript` naming such a file is an input error and SHALL follow the existing input-error contract: exit non-zero with an actionable message. A caller that consults a recorded transcript opportunistically SHALL receive no occupancy estimate at all, so absence stays distinguishable from an empty session.

#### Scenario: An explicitly named unreadable-format transcript is refused

- **WHEN** a user runs `rasen agent context --transcript <path>` and the file is recognized as belonging to a harness with no context reader
- **THEN** the CLI SHALL exit non-zero
- **AND** the message SHALL name the recognized harness and state that no context reader exists for it
- **AND** SHALL NOT report `contextTokens`, `limit`, `pct`, or `remainingTokens`

#### Scenario: An opportunistic estimate reports absence, never zero

- **WHEN** a caller requests an occupancy estimate for a recorded transcript belonging to a harness with no context reader
- **THEN** no estimate SHALL be produced
- **AND** the caller SHALL be able to distinguish that absence from an estimate of zero occupancy

#### Scenario: Supported transcripts are unaffected

- **WHEN** a Claude Code transcript or a Codex rollout is probed by path, by `--latest`, or by explicit `--runtime`
- **THEN** detection, discovery, reported fields, and both existing unavailable results SHALL be identical to their behavior before this capability
