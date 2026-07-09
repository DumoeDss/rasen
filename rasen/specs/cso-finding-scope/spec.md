# cso-finding-scope Specification

## Purpose
cso Phase 2 assessment probes agree with Phase 5 hard exclusions — authentication brute-force stays reportable, generic DoS/resource-exhaustion/rate-limiting is excluded, and the generic audit-logging probe is dropped — so the skill never instructs the agent to assess a category that Phase 5 then always discards.

## Requirements

### Requirement: cso Phase 2 assessment agrees with Phase 5 hard exclusions

The `cso` skill (`src/core/templates/experts/cso.ts`) SHALL make its Phase 2 assessment scope consistent with its Phase 5 false-positive hard exclusions, so it never instructs the agent to assess a category that Phase 5 then always discards. Specifically:

- The authentication rate-limit / brute-force probe SHALL remain in Phase 2, and Phase 5 hard-exclusion #1 SHALL be narrowed to exclude only **generic** Denial-of-Service, resource exhaustion, and rate limiting — with an explicit exception that missing brute-force protection or rate limiting on authentication or other security-sensitive endpoints IS reportable.
- The generic audit-logging probes (authorization-failure logging, admin-action audit trails) SHALL be dropped from Phase 2 assessment, agreeing with hard-exclusion #16 (absence of logging is not a vulnerability).
- The generic Denial-of-Service STRIDE probe ("Can the component be overwhelmed?") SHALL be dropped or annotated as assessed-for-context-only, agreeing with the generic-DoS half of hard-exclusion #1.

#### Scenario: auth brute-force reportable, generic DoS still excluded

- **WHEN** the generated `cso` `SKILL.md` is inspected
- **THEN** hard-exclusion #1 SHALL exclude generic DoS / resource exhaustion / rate limiting
- **AND** SHALL carry an explicit exception that brute-force / rate-limiting gaps on authentication or security-sensitive endpoints ARE reportable

#### Scenario: generic audit-logging probe dropped

- **WHEN** the generated `cso` `SKILL.md` Phase 2 assessment is inspected
- **THEN** it SHALL NOT instruct the agent to assess whether authorization failures are logged or admin actions are audit-trailed as a finding source
- **AND** the behavior SHALL be consistent with hard-exclusion #16 (missing audit logs are not reported)
