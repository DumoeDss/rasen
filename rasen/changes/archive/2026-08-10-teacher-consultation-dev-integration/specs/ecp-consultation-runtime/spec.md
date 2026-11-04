## MODIFIED Requirements

### Requirement: Replay and restart preserve exactly-once consultation delivery

Consultation ids, Teacher Action identities, and source continuation request ids SHALL be deterministic from committed Run facts. Repeating an exact request or settled continuation after acknowledgement loss SHALL reuse the canonical entry or SessionHost settled result and SHALL NOT duplicate Teacher work or advice delivery. Restart SHALL resume from the last committed consultation state: pending Teacher, committed advice awaiting continuation, or settled source result. When the source belongs to a task-loop Run, restart SHALL recover trusted workspace observation from the canonical Run and exact daemon-owned source Session and SHALL preserve the same task-loop report and ephemera exclusions used before restart. Request-supplied workspace paths SHALL NOT authorize that recovery. If a source continuation was sent but its outcome is unknown, ECP SHALL record a durable `continuation-outcome-unknown` wait and SHALL NOT automatically resend or claim delivery.

#### Scenario: Duplicate request admits one Teacher
- **WHEN** the same attested source `CONSULT` step is submitted twice at the same consultation ordinal
- **THEN** both submissions SHALL resolve to the same consultation id and canonical state
- **AND** at most one Teacher Action/attempt SHALL be granted

#### Scenario: Restart after advice resumes exact continuation
- **WHEN** the daemon restarts after advice is committed but before source continuation settles
- **THEN** ECP SHALL recover the same source Session and deterministic continuation request id from canonical state
- **AND** SHALL send only the committed advice continuation, never rerun the Teacher

#### Scenario: Settled continuation replay commits once
- **WHEN** SessionHost settled a deterministic continuation request but the Run commit acknowledgement was lost
- **THEN** retry SHALL obtain the settled result for that request id
- **AND** the canonical Run SHALL commit the resulting source step exactly once

#### Scenario: Ambiguous continuation is not replayed
- **WHEN** restart finds the continuation request sent but without a durably settled Session result
- **THEN** ECP SHALL expose `continuation-outcome-unknown` with the exact consultation and source identities
- **AND** SHALL NOT resend the advice or mark it consumed

#### Scenario: Task-loop consultation reopens the trusted workspace
- **WHEN** the daemon restarts while a task-loop source Action is paused for consultation or has committed advice awaiting continuation
- **THEN** ECP SHALL resolve the same canonical workspace and source Session authority and SHALL observe it with the same task-loop report and ephemera exclusions as the fresh runtime
- **AND** consultation recovery SHALL NOT advance task-loop progress, strategy counters, or report authority before the eventual source result

#### Scenario: Reopened workspace identity mismatch fails closed
- **WHEN** the canonical Run and daemon-owned source Session disagree on Session, Invocation, role, workspace, backend, canonical cwd, or cwd digest during task-loop consultation recovery
- **THEN** ECP SHALL expose a typed recovery failure before Teacher admission, advice commitment, source continuation, or task-loop report generation
- **AND** a request-supplied cwd SHALL NOT repair or replace the mismatched authority
