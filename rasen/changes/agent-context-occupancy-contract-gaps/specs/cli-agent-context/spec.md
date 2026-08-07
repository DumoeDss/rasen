## MODIFIED Requirements

### Requirement: Handoff threshold reporting

The command SHALL report the resolved `threshold`, its source (a scope-qualified scheme source or the existing `project`, `store`, `global`, or `default` source), and — when occupancy is measurable — a `shouldHandoff` flag alongside occupancy. The threshold SHALL accept the dual form (a bare fraction in (0, 1], or the absolute `{ remainingTokens: N }` headroom form); `shouldHandoff` compares measured occupancy against a fraction threshold (`pct >= threshold`) or `remainingTokens` against an absolute threshold (`remainingTokens <= threshold.remainingTokens`). The probe is role-agnostic, so pipeline, stage, role, and model-preset overrides SHALL NOT apply, and its exit code SHALL stay 0 even when `shouldHandoff` is true.

When the reading measured real occupancy but could not resolve the context window it occupies, no verdict exists to report: the fraction and the remaining-headroom figure are both placeholders rather than measurements, so each threshold form would answer wrongly and in opposite directions. In that case the command SHALL omit `shouldHandoff` entirely and SHALL report `window` as `unknown` instead, so a consumer distinguishes a withheld verdict from a real below-threshold reading by the field's PRESENCE. Reporting `shouldHandoff: false` for this state is prohibited, because it is indistinguishable from a genuine reading below the threshold.

A reading that measured no occupancy at all is not this state and SHALL keep reporting a verdict, so a session that has simply not sent anything yet continues to answer as it always has.

#### Scenario: An unmeasurable context window withholds the verdict

- **WHEN** a user probes a session whose recorded occupancy is greater than zero
- **AND** the context window for that session's model cannot be resolved
- **THEN** the JSON output SHALL report `window` as `unknown`
- **AND** SHALL NOT include a `shouldHandoff` field
- **AND** SHALL still report the resolved `threshold` and its source
- **AND** the CLI SHALL exit 0

#### Scenario: A measurable window still reports a verdict

- **WHEN** a user probes a session whose context window is known
- **THEN** the JSON output SHALL include `shouldHandoff` as a boolean
- **AND** SHALL NOT include a `window` field

#### Scenario: A session with no recorded occupancy keeps its existing answer

- **WHEN** a user probes a session that has recorded no occupancy and reports no context window
- **THEN** the JSON output SHALL include `shouldHandoff` as a boolean
- **AND** SHALL NOT include a `window` field

## ADDED Requirements

### Requirement: The worker occupancy estimate marks an unmeasurable window

Rasen publishes occupancy on two surfaces: the full probe receipt, and the compact per-worker estimate that `rasen pipeline resume` attaches to each recorded worker. Both feed the same orchestration decisions, so both SHALL be able to express the same states.

The per-worker estimate SHALL indicate when it measured real occupancy without resolving the context window, using the same marker and the same meaning as the probe receipt. A consumer SHALL therefore be able to apply one reading rule to either surface, and SHALL NOT be required to infer the state from a bare zero, because a fraction of zero is indistinguishable from an empty session and a remaining-headroom figure of zero satisfies every headroom floor.

Guidance that directs an orchestrator to branch on this marker SHALL be true of every surface that publishes occupancy.

#### Scenario: A resumed worker with an unmeasurable window is marked

- **WHEN** a pipeline resume reports a worker whose recorded session has real occupancy and no resolvable context window
- **THEN** that worker's occupancy estimate SHALL carry the unknown-window marker
- **AND** a warm-reuse decision SHALL NOT be taken from its reported fraction

#### Scenario: A resumed worker with a known window is unmarked

- **WHEN** a pipeline resume reports a worker whose recorded session has a resolvable context window
- **THEN** that worker's occupancy estimate SHALL carry no unknown-window marker
- **AND** its reported fraction SHALL remain the value it reports today
