# process-authority-provider Specification

## Purpose
Platform-neutral contract for durable process authority: a closed, manifest-validated `ProcessAuthorityProvider` registry that dispatches only to the exact registered provider/capability/protocol tuple, treating the recursive process-scope capability as one indivisible versioned contract whose subsets are rejected index-exact; a versioned opaque authority-reference envelope that keeps PID, PGID, Job, broker, namespace, and other platform-native control material below the seam; a bounded `prepare -> publish -> activate` lifecycle with distinct fail-closed outcomes (`root-exited`, `authority-unavailable`, `authority-uncertain`, `identity-drift`, `event-gap`, `timeout`, `control-loss`) in which only an exact-scope-empty receipt authorizes release and unavailability is typed - never a silent fallback to a weaker provider; and a reusable provider-neutral conformance/mutation harness. Introduced additively by the archived `ecp-platform-process-authority-foundation` change: deterministic and cross-target evidence establishes the common contract only, and actual operating-system authority acceptance remains each platform provider's separate obligation.
## Requirements
### Requirement: Exact process-authority provider selection
Rasen SHALL expose a platform-neutral process-authority provider contract and SHALL dispatch preparation or recovery only to the exact registered provider, capability, and protocol identity requested or persisted for that authority. The recursive process-scope capability SHALL include non-escape, publish-before-activate, exact root-exit distinction, exact scope-empty, exact recursive termination and abort, replacement recovery, bounded control, identity-drift detection, and event-completeness semantics as one indivisible versioned contract.

#### Scenario: Exact provider tuple is registered
- **WHEN** a caller requests a provider id, recursive-scope capability id, and protocol version that exactly match one valid registry entry
- **THEN** Rasen dispatches the operation to that entry and preserves the exact tuple in the resulting authority reference

#### Scenario: Duplicate or ambiguous registration
- **WHEN** registry construction receives duplicate provider identities, duplicate exact tuples, or conflicting descriptors for one provider
- **THEN** Rasen rejects the registry before any preparation or recovery operation can run

#### Scenario: Registry provenance is forged
- **WHEN** a coordinator receives a registry subclass, proxy, structural lookalike, or overridden public selector rather than the exact closed registry instance that completed manifest validation
- **THEN** Rasen returns `authority-unavailable` through an internal non-overridable selector and performs zero provider preparation, observation, or control dispatch

#### Scenario: No exact provider is available
- **WHEN** the requested exact provider tuple is absent or its availability probe cannot establish the required authority
- **THEN** Rasen returns `authority-unavailable` without trying a weaker provider, PID tree, process group, or registration-order fallback

#### Scenario: Capability subset would weaken authority
- **WHEN** a provider offers only a subset of the recursive-scope capability or a caller requests a subset that omits one required semantic
- **THEN** Rasen rejects negotiation and does not activate a workload under that capability name

### Requirement: Versioned opaque authority-reference envelope
Rasen SHALL represent durable process authority as one branded, versioned, closed-schema opaque reference that binds the provider id, capability id, protocol version, provider-reference version, bounded provider-owned bytes, and an integrity identity. Session, backend, API, UI, and registry projection consumers MUST NOT receive public PID, PGID, Job, broker, namespace, native handle, or platform-native control fields from this contract.

#### Scenario: Known canonical reference is reopened
- **WHEN** Rasen receives a canonical reference whose schema, integrity identity, provider tuple, and bounded fields are valid
- **THEN** the internal dispatcher reopens only the exact provider tuple while callers continue to handle the reference as an opaque value

#### Scenario: Opaque reference is tampered or malformed
- **WHEN** any encoded field, provider-owned byte, integrity digest, field order, length bound, or closed-schema rule is changed
- **THEN** Rasen returns a typed non-dispatchable retained outcome, sends no provider control request, and preserves the original reference bytes for diagnosis or future recovery

#### Scenario: Unknown future envelope version
- **WHEN** an older runtime encounters a syntactically bounded authority reference with an unknown future envelope version
- **THEN** it preserves the reference byte-for-byte, returns `authority-unavailable`, and neither rewrites, downgrades, inspects, nor terminates it

#### Scenario: Platform-native fields do not cross the seam
- **WHEN** a Session or backend observes, persists, logs, lists, or controls a process authority through the public contract
- **THEN** only the opaque reference and common typed outcomes are available and no platform-native control value is projected

#### Scenario: Diagnostic projection cannot replay authority
- **WHEN** a caller requests a diagnostic or log view of a valid process-authority reference
- **THEN** Rasen returns only the redacted schema/provider tuple and a one-way reference digest, never the full sensitive reference or reversible provider-owned bytes

#### Scenario: Integrity is not treated as signer authority
- **WHEN** the common envelope integrity digest verifies
- **THEN** Rasen treats it as canonical corruption detection only and still requires the selected provider to establish its exact native authority before observation or control

### Requirement: Bounded prepare, publish, and activate ordering
Rasen SHALL prepare an inert authority, bind the exact reference to a successful durable publication acknowledgment, and activate it exactly once only after publication. Prepare, publication, activation, and prepared abort SHALL each have a bounded outcome, and no failure before activation may silently run workload code.

#### Scenario: Prepare remains inert
- **WHEN** a provider successfully prepares an authority and returns its opaque reference
- **THEN** the workload has not started and the only permitted next operations are exact publication or abort

#### Scenario: Exact publication enables activation
- **WHEN** the trusted host durably publishes the exact prepared reference and supplies the matching publication acknowledgment
- **THEN** Rasen enters `published-inert` and exposes one activation capability for that same reference

#### Scenario: Durable publication callback does not settle
- **WHEN** the trusted durable publisher exceeds the common publish deadline or loses control
- **THEN** Rasen returns typed retained `timeout` or `control-loss` for phase `publish`, aborts its operation signal, preserves the exact reference, and does not activate workload code

#### Scenario: Runtime bridge fails before activation
- **WHEN** the compatibility adapter cannot acquire and validate its runtime bridge while authority is `published-inert`
- **THEN** it performs one bounded published abort before workload activation and releases only from an authentic exact-empty receipt

#### Scenario: Activate before publication
- **WHEN** a caller or mutation attempts to activate a prepared authority before the matching publication acknowledgment
- **THEN** Rasen rejects activation, the workload remains inert, and the authority remains available for bounded abort or reconciliation

#### Scenario: Publication identity does not match preparation
- **WHEN** the publication acknowledgment names a different reference digest, version, or preparation operation
- **THEN** Rasen consumes the publication capability, returns retained `control-loss` for phase `publish`, forbids another publisher invocation, and permits only bounded abort or exact-reference reconciliation

#### Scenario: Duplicate activation or late publication
- **WHEN** a caller repeats activation, publishes after abort, or supplies a second publication acknowledgment after a state transition
- **THEN** Rasen settles exactly once, does not start a second workload, and returns a typed ordering conflict without changing the recorded state

### Requirement: Exact lifecycle observations remain distinct
Rasen SHALL keep `prepared-inert`, `published-inert`, `live`, `root-exited`, and `exact-scope-empty` as distinct lifecycle facts. Only `exact-scope-empty` SHALL authorize release of durable process authority; `root-exited`, provider loss, or a closed transport MUST NOT authorize release.

#### Scenario: Backend root exits while authority remains live
- **WHEN** the backend root exits while any descendant or provider authority may still exist
- **THEN** Rasen reports `root-exited` with the backend status, retains the exact reference, and continues to permit only exact inspect or termination reconciliation

#### Scenario: Exact natural scope empty
- **WHEN** the selected provider positively proves that no process remains in the exact recursive authority
- **THEN** Rasen emits one `exact-scope-empty` receipt and permits the host to release the corresponding durable authority

#### Scenario: Provider reference is reused
- **WHEN** a provider returns an active or retired provider-reference generation that the coordinator has already observed
- **THEN** Rasen rejects the new preparation before publication or activation, preserves the earlier lifecycle truth, and never replays its exact-empty receipt for the new attempt

#### Scenario: Replacement first observes a recovered generation
- **WHEN** a valid durable reference is first presented to a replacement coordinator for inspect or terminate
- **THEN** Rasen atomically registers that generation in the same active/retired ledger before provider dispatch and applies the same collision, receipt, and capacity rules as local preparation

#### Scenario: Reference tombstone retention is exhausted
- **WHEN** the fixed reference-lifecycle ledger cannot retain another non-reusable generation
- **THEN** Rasen atomically reserves capacity before preparation or recovered dispatch, refuses overflow before provider dispatch, and releases a preparation reservation only when failure, timeout, or collision minted no reference

#### Scenario: Replacement observes inert authority
- **WHEN** exact recovery reports `prepared-inert` or `published-inert`
- **THEN** Rasen preserves that exact state and reference for bounded termination/reconciliation without translating it to live, closed, or control loss

#### Scenario: Root-exit status is incomplete
- **WHEN** any observation or control result reports `root-exited` without exact `code` and `signal` fields or with both values null
- **THEN** Rasen rejects the provider value as retained control loss and does not synthesize missing status

#### Scenario: Authority becomes unavailable after publication
- **WHEN** inspect, terminate, or abort cannot open the exact provider authority after its reference was durably published
- **THEN** Rasen returns `authority-unavailable` with the same reference and does not report exact-scope-empty

#### Scenario: Authority truth is uncertain
- **WHEN** the provider cannot prove a more specific live, empty, drift, gap, timeout, or loss outcome
- **THEN** Rasen returns `authority-uncertain` with the same reference and permits no optimistic release or restart

#### Scenario: Identity drift forbids control
- **WHEN** recovery finds that native identity no longer exactly matches the persisted provider reference
- **THEN** Rasen returns `identity-drift`, performs no signal or destructive control, retains the reference, and never translates the observation to closed

#### Scenario: Event completeness has a gap
- **WHEN** an event-backed provider detects a missing, reordered, or otherwise incomplete observation interval
- **THEN** Rasen returns `event-gap`, retains the reference, and does not claim exact empty or successful recursive termination

### Requirement: Bounded control retains authority after ambiguity
Rasen SHALL bound prepare, publish, activate, inspect, terminate, abort, and exact-empty observation with one common deadline discipline. A timeout, control loss, cancellation, duplicate outcome, conflicting outcome, or provider exception after a reference exists SHALL settle once with that exact authority retained until later exact reconciliation.

#### Scenario: Provider call exceeds its deadline
- **WHEN** a provider operation does not settle before its monotonic phase deadline
- **THEN** Rasen returns `timeout` for that phase, retains the exact reference when one exists, clears the timer once, and does not infer whether the late native action occurred

#### Scenario: Scheduler callback is delayed
- **WHEN** monotonic time reaches the recorded phase deadline before provider fulfillment or rejection but the scheduler callback has not run
- **THEN** either settlement route returns `timeout`, aborts the phase signal, and quarantines the late provider value or error

#### Scenario: Runtime operation input is hostile or mutable
- **WHEN** selection, prepare input, termination intent, or abort reason is malformed, over-bound, accessor-hostile, or mutated after the call
- **THEN** Rasen reads each allowed field once, recursively captures bounded arrays and maps, and either dispatches the one validated immutable snapshot used for operation identity or returns a typed no-dispatch failure

#### Scenario: Provider preparation capability is mutable
- **WHEN** a fulfilled inert preparation exposes accessor-backed or later-mutated reference and activation fields
- **THEN** Rasen reads each field once into a closed immutable snapshot and uses only that captured reference and callable for envelope creation, activation, abort, and exact receipt identity

#### Scenario: Adapter authority is lost
- **WHEN** the provider process, controller, channel, or adapter disappears before an exact terminal receipt
- **THEN** Rasen returns `control-loss`, retains the exact reference, and does not turn transport closure into exact-scope-empty

#### Scenario: Provider resolves after timeout
- **WHEN** a provider produces a success or failure after the coordinator has already settled the operation as timed out
- **THEN** the late result cannot activate, release, or otherwise mutate the authority state and is retained only as bounded diagnostic evidence

#### Scenario: Provider emits duplicate or conflicting outcomes
- **WHEN** a provider emits the same terminal receipt twice or emits incompatible outcomes for one operation id
- **THEN** Rasen records at most one semantic outcome, treats a conflict as retained control loss, and never starts or terminates work twice

#### Scenario: Abort or terminate is not observed closed
- **WHEN** bounded abort or termination cannot prove exact-scope-empty because of unavailability, uncertainty, drift, gap, timeout, or control loss
- **THEN** its receipt identifies that exact retained reason and the host keeps ownership, capacity, and durable authority unavailable for reuse

### Requirement: Closed capability, protocol, and manifest negotiation
Rasen SHALL validate a provider's runtime descriptor and closed manifest entry against the exact common-contract version, provider id, capability id, protocol version, and provider-reference version before dispatch. Any mismatch, unknown field, missing required semantic, or rollback attempt SHALL fail closed without invoking a mismatched provider.

#### Scenario: Provider identity mismatch
- **WHEN** a reference, requested selection, runtime descriptor, and manifest do not all name the same provider id
- **THEN** Rasen rejects dispatch and retains any persisted reference without provider control

#### Scenario: Capability identity mismatch
- **WHEN** the registered or packaged provider does not advertise the exact capability identity persisted in the reference
- **THEN** Rasen returns a typed mismatch/unavailable outcome and does not substitute another capability

#### Scenario: Protocol or provider-reference mismatch
- **WHEN** the runtime, manifest, selection, or reference names a different protocol or provider-reference version
- **THEN** Rasen refuses prepare, activate, inspect, terminate, and abort across that mismatch

#### Scenario: Closed manifest does not match the runtime descriptor
- **WHEN** a provider manifest contains an unknown field, missing identity, duplicate entry, unsupported common-contract version, or tuple different from the runtime descriptor
- **THEN** registry construction or provider resolution fails before workload preparation

#### Scenario: Non-empty registry has no manifest
- **WHEN** a caller attempts to construct a non-empty registry or coordinator directly from raw providers without an exact manifest binding
- **THEN** Rasen rejects construction and performs zero provider preparation, recovery, or control dispatch

#### Scenario: Rollback encounters a newer durable reference
- **WHEN** an older provider/runtime reads a reference written by a newer exact protocol or envelope version
- **THEN** it preserves the bytes and fails closed rather than downgrading, rewriting, or inferring authority from legacy PID/PGID facts

### Requirement: Reusable deterministic provider conformance harness
Rasen SHALL provide one provider-neutral conformance and mutation harness whose scenario body and expected common outcomes can be used unchanged by deterministic, Linux, Windows, and future macOS provider fixtures. Passing deterministic or cross-target evidence SHALL establish only the common contract and MUST NOT be reported as actual operating-system authority acceptance.

#### Scenario: Deterministic foundation run
- **WHEN** the foundation runs the harness against its explicit deterministic test provider and injected monotonic clock
- **THEN** all ordering, outcome, retention, negotiation, envelope, timeout, duplicate, late-result, and authority-loss scenarios run without an operating-system adapter

#### Scenario: Shared abort and replay matrix
- **WHEN** any provider fixture consumes the unchanged suite
- **THEN** prepared and published abort must each prove authentic exact empty for the exact generation while negative abort retention, manifest-gated operational dispatch, publication mismatch, canonical/tampered/future recovery, natural empty, every bounded phase, late control, and provider-reference reuse remain exercised by the shared assertions

#### Scenario: Platform provider consumes the unchanged suite
- **WHEN** a later provider Change supplies its fixture factory to the common harness
- **THEN** the same common scenario definitions and assertions execute without copying or weakening them

#### Scenario: Mutation sensitivity is demonstrated
- **WHEN** the harness enables activate-before-publication, tuple mismatch, reference tamper, authority-loss, optimistic-close, broken abort, duplicate, or late-outcome mutations one at a time
- **THEN** each mutation produces a RED invariant violation until production contract behavior makes the unchanged assertion GREEN

#### Scenario: Actual platform evidence remains separate
- **WHEN** deterministic injection, source inspection, or cross-target compilation passes
- **THEN** Rasen records only common or compile evidence and still requires each platform Change to run its escape, owner-death, recovery, empty, kill, and unavailable oracles on that actual operating system

### Requirement: Additive migration without platform or release claims
Rasen SHALL introduce the common provider contract additively, keep existing ProcessScope and legacy references recoverable under their existing behavior, and leave production provider registration and ProcessCapsule protocol integration to the platform and closure Changes. This foundation SHALL be locally terminal without an actual-platform runtime receipt and SHALL NOT make a dependent provider runnable until its real local ship and archive are complete.

#### Scenario: Foundation is installed before providers
- **WHEN** the common modules and compatibility adapter are present but no production provider is registered
- **THEN** existing production ProcessScope selection remains unchanged and the new registry cannot claim or activate an operating-system authority

#### Scenario: Legacy ProcessScope reference is encountered
- **WHEN** the additive foundation reads an existing `rasen-process-scope/1` value
- **THEN** it preserves the value under the legacy path and does not convert PID, PGID, or helper data into a new recursive-scope authority reference

#### Scenario: Foundation reaches local completion
- **WHEN** deterministic contract/mutation tests, migration tests, static/package gates, strict Change validation, and fresh independent security and code/spec review have no open Blocker or Major
- **THEN** this Change may complete its local ship/archive lifecycle without claiming Linux, Windows, macOS, ProcessCapsule closure, or release support

#### Scenario: A dependent provider is considered runnable
- **WHEN** the foundation implementation and review have passed but its local ship or archive has not completed
- **THEN** the portfolio keeps Linux and Windows providers blocked and keeps the macOS provider decision-deferred

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

