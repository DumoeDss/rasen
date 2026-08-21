## MODIFIED Requirements

### Requirement: Acceptance matches the reconciler support boundary

The session execution acceptance suite SHALL exercise real reconciler-admitted actions from `bug-fix`, `small-feature`, `full-feature`, `goal-loop-measure`, `goal-loop-evaluate`, and `goal-loop-research`. It SHALL retain `auto-decompose` as an expected fail-closed pipeline whose production execution-profile preparation prevents session dispatch, under the truthful verdict that its decompose stage is a Dispatch-domain construct the reconciler does not execute.

#### Scenario: Every supported built-in reaches the session executor

- **WHEN** each of the six named supported pipelines produces an admitted action
- **THEN** the executor accepts that action only with its exact Run, action, session, workspace, and execution binding and records a successful supported-pipeline case

#### Scenario: Auto-decompose remains fail closed through production preparation

- **WHEN** `auto-decompose` traverses the production registry, profile preparation, and reconciler-support path
- **THEN** it fails closed before a reusable session is created or messaged, reporting the unsupported-semantics verdict for its decompose stage rather than an execution-profile unavailability, without relying on an injected null profile
- **AND** the result is recorded as expected behavior rather than a regression
