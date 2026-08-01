# ecp-definition-preparation Specification Delta

## MODIFIED Requirements

### Requirement: Pipeline Definition v2 has one closed, typed language

Rasen SHALL accept a Pipeline Definition v2 envelope with stable definition and
node identities, typed definition inputs, artifact outputs, and named outcomes.
The root graph SHALL use only `AtomicStage`, `CompositeRef`, `BoundedLoop`,
`Choice`, `FanOut`, `Join`, `Gate`, and `Finish` nodes. Node kinds outside that
closed vocabulary SHALL be rejected rather than treated as extension hooks.
Every authored v2 `BoundedLoop` SHALL include a complete versioned lifecycle
policy; missing policy fields SHALL NOT be supplied by runtime defaults.

#### Scenario: A complete v2 definition is accepted

- **WHEN** a version 2 definition has a stable source identity, unique stable node identities, compatible typed ports, and a root graph made from the closed vocabulary
- **THEN** preparation returns one normalized v2 definition with the declared inputs, artifacts, outcomes, and identities preserved

#### Scenario: An open-ended node kind is rejected

- **WHEN** a version 2 definition contains a node kind outside the closed vocabulary
- **THEN** preparation fails with an error diagnostic at that node's `kind` path
- **AND** the diagnostic does not offer arbitrary node-kind plug-ins as a fallback

#### Scenario: Authored v2 loop without lifecycle policy is rejected

- **WHEN** an authored version 2 definition contains a `BoundedLoop` without a complete supported lifecycle policy
- **THEN** preparation fails with path-addressed diagnostics under that node's `lifecycle` path
- **AND** no runtime default is used to make the authored definition executable

### Requirement: Composite and bounded-loop declarations are statically bounded

Rasen SHALL support built-in and Custom Composite declarations through the same
version 2 semantic contract. Composite call graphs MUST be non-recursive.
Bounded loops MUST declare valid iteration, action, and budget limits, an
explicit exit for every reachable body outcome, a complete lifecycle policy for
every mechanical trigger, and a non-looping body; nested bounded loops SHALL be
rejected. A strategy disposition MUST reference an enabled trusted capability
and a positive strategy-attempt allowance.

#### Scenario: Built-in and Custom Composite declarations share one contract

- **WHEN** equivalent built-in and Custom Composite declarations expose the same typed ports, body, limits, lifecycle policy, and outcome mapping
- **THEN** preparation validates and compiles both through the same Composite definition path

#### Scenario: Recursive Composite calls fail closed

- **WHEN** Composite declarations form a direct or indirect recursive call chain
- **THEN** preparation fails with path-addressed diagnostics identifying the call sites and recursion chain

#### Scenario: Nested loops and missing exits fail closed

- **WHEN** a bounded-loop body contains another bounded loop or omits an exit mapping for a reachable body or lifecycle outcome
- **THEN** preparation fails at the nested loop or missing exit path before a plan is returned

#### Scenario: Invalid lifecycle policy reports all independent errors

- **WHEN** a bounded loop declares an impossible local budget, maps a trigger to strategy without a capability, and omits a terminal mapping
- **THEN** preparation reports all independent path-addressed diagnostics in deterministic order

## ADDED Requirements

### Requirement: Legacy loop compatibility is explicit before validation

Preparation SHALL normalize valid unversioned and version 1 loop declarations into a complete v2 lifecycle policy before v2 validation and lowering. Compatibility normalization SHALL preserve existing clean or satisfied versus exhausted behavior and SHALL NOT invent a strategy capability. The materialized policy SHALL be visible in the normalized semantic definition and included in its plan digest; merely preparing the source SHALL NOT rewrite authored v1 content.

#### Scenario: Version 1 loop gains an inspectable compatibility policy

- **WHEN** preparation receives a valid version 1 review or goal loop
- **THEN** its normalized v2 semantic definition contains a complete lifecycle policy preserving the legacy terminal behavior
- **AND** the authored source remains unchanged

#### Scenario: Compatibility normalization never invents strategy execution

- **WHEN** a legacy loop has no authored strategy capability
- **THEN** its materialized lifecycle policy contains no strategy disposition or capability
- **AND** preparation does not authorize an untrusted recovery action

### Requirement: Prepared loop plans retain every lifecycle boundary

The immutable runtime plan SHALL retain every normalized loop-local limit, lifecycle threshold, strategy capability binding, and lifecycle outcome mapping. Canonical serialization and plan digests SHALL distinguish any semantic change to those fields. A live stored plan whose format cannot represent the required lifecycle policy SHALL fail closed rather than acquire a guessed resume policy.

#### Scenario: Lowering preserves all loop-local limits

- **WHEN** a valid loop declares distinct iteration, action, and budget limits
- **THEN** the lowered runtime node preserves all three values exactly
- **AND** decoding the serialized plan returns the same lifecycle policy

#### Scenario: Unsupported live plan cannot resume with guessed policy

- **WHEN** a live stored Run references a runtime-plan format that lacks an unambiguous lifecycle policy
- **THEN** resume fails closed with an upgrade-compatible diagnostic
- **AND** Rasen does not synthesize new execution behavior for that Run
