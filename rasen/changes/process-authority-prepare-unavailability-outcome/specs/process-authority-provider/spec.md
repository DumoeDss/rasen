## ADDED Requirements

### Requirement: Selected providers report prepare unavailability explicitly

An exact selected process-authority provider SHALL be able to return one closed, bounded `authority-unavailable` preparation result when required native prerequisites cannot establish the advertised authority. The result SHALL contain no authority reference or activation capability, SHALL preserve the exact requested provider selection, and SHALL NOT trigger provider fallback, publication, workload execution, or optimistic release. Provider rejection, exception, timeout, and malformed output SHALL remain distinct fail-closed outcomes.

#### Scenario: Exact provider prerequisite is unavailable

- **WHEN** the exact selected provider determines during prepare that a required native prerequisite is denied or unsupported
- **THEN** the coordinator returns `authority-unavailable` with the exact selected provider tuple and bounded provider diagnostic
- **AND** no reference, publication capability, workload execution, or alternate provider dispatch occurs

#### Scenario: Provider rejection is not semantic unavailability

- **WHEN** provider prepare rejects or throws instead of returning the exact typed unavailable result
- **THEN** the bounded coordinator returns `control-loss` for prepare
- **AND** it does not reinterpret the exception as a native availability decision

#### Scenario: Unavailable lookalike is malformed

- **WHEN** provider prepare returns an accessor-hostile, over-bound, extra-field, or otherwise malformed unavailable lookalike
- **THEN** the coordinator fails closed without creating a reference or activation capability
- **AND** the malformed value cannot select another provider or execute workload code

### Requirement: Provider conformance uses the fixture's real publication boundary

The reusable process-authority conformance harness SHALL obtain publication acknowledgements through one publisher supplied by the provider fixture. The deterministic fixture MAY use the canonical in-memory acknowledgement helper, while a provider whose activation depends on durable publication SHALL supply its concrete durable publisher. The shared suite SHALL NOT require hidden publication during activation, prewrite publication state outside the publisher callback, or weaken a production provider to accept a fake acknowledgement.

Provider-neutral retained assertions SHALL require the exact common state, same authority reference, non-empty bounded diagnostic, and no optimistic release, but SHALL NOT require a platform adapter to reproduce deterministic fixture-specific diagnostic wording or accept arbitrary native diagnostic text.

Recovered inert-phase conformance SHALL establish `prepared-inert` before publication and `published-inert` only after the fixture publisher durably acknowledges that reference; the harness SHALL NOT delete, corrupt, or override authentic publication truth to simulate an earlier phase.

#### Scenario: Durable platform fixture runs the shared suite

- **WHEN** a platform provider fixture requires a concrete durable publication record before activation
- **THEN** every shared-suite publication call invokes the fixture's supplied durable publisher
- **AND** the unchanged activation assertions run against the same production publication boundary

#### Scenario: Deterministic fixture needs no durable store

- **WHEN** the platform-neutral deterministic fixture runs the same conformance suite
- **THEN** its fixture publisher returns the exact canonical acknowledgement
- **AND** the shared assertions do not special-case platform identity or storage
