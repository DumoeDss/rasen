# executable-review-cycle Specification Delta

## MODIFIED Requirements

### Requirement: Built-in pipelines route through the same ReviewCycle body

The `bug-fix`, `small-feature`, and `full-feature` pipelines SHALL be authored as native Definition v2 documents whose review work references the same typed 4-phase ReviewCycle body contract (review, triage, fix, re-review). Each BoundedLoop SHALL author complete loop-local limits, the shared lifecycle policy, and an exact trusted strategy capability binding. All three SHALL execute through the canonical reconciler without v1 normalization, authored legacy payloads, or prompt-owned mechanical loops.

#### Scenario: bug-fix authors adaptive ReviewCycle directly

- **WHEN** the package `bug-fix` definition is prepared for a reconciler Run
- **THEN** its authored v2 root contains the bounded ReviewCycle in the adaptive verification position
- **AND** the immutable plan preserves its gates, adaptive verification behavior, lifecycle policy, and tail
- **AND** no `LEGACY_NORMALIZED` warning or authored legacy runtime marker is present

#### Scenario: small-feature authors standard verify plus ReviewCycle

- **WHEN** the package `small-feature` definition is prepared for a reconciler Run
- **THEN** its authored v2 graph preserves the standard independent verify stage followed by the bounded ReviewCycle
- **AND** the ReviewCycle body uses the same phase contract and lifecycle mechanics as `bug-fix`

#### Scenario: full-feature reuses the same ReviewCycle contract

- **WHEN** the native v2 `full-feature` graph reaches its post-expert review loop
- **THEN** the loop references the same typed phase/body contract used by the other review built-ins
- **AND** its dependency on the expert Join is preserved in the immutable plan

#### Scenario: Corresponding phases share capability contracts

- **WHEN** the three authored ReviewCycle declarations are compared
- **THEN** review, triage, and re-review declare the exact `rasen-review` capability contract while fix declares the exact `rasen-review-fix` contract
- **AND** fix remains write-capable and cannot certify itself while re-review is a separate reviewer Action with read intent

#### Scenario: Review phase mismatch is rejected before execution

- **WHEN** a ReviewCycle fix phase uses a capability that does not advertise `review-cycle/fix`, or a re-review phase uses a write-capable fixer declaration
- **THEN** preparation fails at the phase capability or execution path
- **AND** no review Run is admitted

#### Scenario: Built-in ReviewCycle consumes the shared strategy contract

- **WHEN** iteration-limit or stall policy selects the authored review strategy
- **THEN** the frozen strategy capability receives the versioned bounded-loop strategy invocation and must return `bounded-loop/strategy-result/1`
- **AND** failed, blocked/resumed, material-recovery, and exact-exhaustion behavior follows the shared canonical lifecycle

## ADDED Requirements

### Requirement: Review built-in authoring and execution views are equivalent

The prepared execution view for each ReviewCycle built-in SHALL expose the same logical stage order, roles, gates, verification policy, capability paths, workspace access, lifecycle policy, and engine support that launch freezes. Compatibility-normalized v1 fixtures MAY be used as migration oracles but SHALL NOT remain the authored package truth.

#### Scenario: Review built-in matrix preserves product behavior

- **WHEN** pre-migration compatibility plans and the three native v2 built-ins are compared by semantic execution fields
- **THEN** proposal/apply/verify/review/ship/archive or retain ordering, gates, roles, and review safety remain equivalent except for the explicitly authored shared strategy behavior
- **AND** native v2 inspection contains no prompt-owned compatibility marker
