## MODIFIED Requirements

### Requirement: Dual-form threshold interpretation

The orchestration playbook SHALL state how a resolved threshold of either form is compared against a probe. A fraction threshold `t` SHALL fire a handoff when the probe's `pct >= t` and SHALL permit reuse when `pct <= t` (unchanged behavior). An absolute threshold `{ remainingTokens: N }` SHALL fire a handoff when the probe's `remainingTokens <= N` and SHALL permit reuse when `remainingTokens >= N`. The playbook SHALL also state that a probe reporting `limit: 0` (no window known—e.g. a Codex rollout with zero completed turns) fires NEITHER form: a young rollout is by definition not near its limit.

For mid-task handoff, Step H SHALL state the complete server resolution order: configured `pipelines.<name>.handoff.<stage>` instance > stage YAML handoff > runtime-bound scheme (`handoffRoles[actual role]` before scheme scalar) > pipeline YAML role/scalar > legacy project role/scalar > inherited-store role/scalar > global role/scalar > model preset > built-in default. It SHALL state that an explicit effective-runtime row is considered across project/store/global before the `default` row across those scopes, and a missing/invalid scheme warns and falls through. The LEAD SHALL consume the resolved values and metadata reported by `rasen pipeline show` or `rasen agent context` rather than reading scheme/config files and recreating precedence.

#### Scenario: Playbook states both comparison rules

- **WHEN** the orchestration playbook template's Step H threshold guidance is inspected
- **THEN** it SHALL state the fraction rule (`pct >= t` hands off) and the absolute rule (`remainingTokens <= N` hands off; reuse requires `remainingTokens >= N`)
- **AND** it SHALL state the binding-aware resolution order with the model-preset layer between legacy machine config and built-in defaults

#### Scenario: Explicit runtime row precedes default row

- **WHEN** Step H describes how a bound handoff scheme is selected
- **THEN** it SHALL place the actual worker runtime's project/store/global binding candidates before all project/store/global `default` candidates
- **AND** SHALL direct dangling or invalid candidates to warn and fall through

#### Scenario: Actual dispatched role and runtime drive the scheme

- **WHEN** a loop stage dispatches a worker whose actual role or effective runtime differs from the stage's nominal role/runtime
- **THEN** Step H SHALL direct resolution using the dispatched worker's actual role and effective runtime

#### Scenario: Zero-limit probe fires no threshold

- **WHEN** the playbook's guidance for interpreting a probe with `limit: 0` is inspected
- **THEN** it SHALL direct the LEAD to treat neither threshold form as fired
