# orchestration-handoff Delta Specification

## ADDED Requirements

### Requirement: Dual-form threshold interpretation

The orchestration playbook SHALL state how a resolved threshold of either form is compared against a probe. A fraction threshold `t` SHALL fire a handoff when the probe's `pct >= t` and SHALL permit reuse when `pct <= t` (unchanged behavior). An absolute threshold `{ remainingTokens: N }` SHALL fire a handoff when the probe's `remainingTokens <= N` and SHALL permit reuse when `remainingTokens >= N`. The playbook SHALL also state that a probe reporting `limit: 0` (no window known — e.g. a Codex rollout with zero completed turns) fires NEITHER form: a young rollout is by definition not near its limit.

#### Scenario: Playbook states both comparison rules
- **WHEN** the orchestration playbook template's Step H threshold guidance is inspected
- **THEN** it SHALL state the fraction rule (`pct >= t` hands off) and the absolute rule (`remainingTokens <= N` hands off; reuse requires `remainingTokens >= N`)
- **AND** it SHALL state that the resolution order includes the model-preset layer between pipeline config and built-in defaults

#### Scenario: Zero-limit probe fires no threshold
- **WHEN** the playbook's guidance for interpreting a probe with `limit: 0` is inspected
- **THEN** it SHALL direct the LEAD to treat neither threshold form as fired
