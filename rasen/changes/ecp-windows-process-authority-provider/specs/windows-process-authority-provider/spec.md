## ADDED Requirements

### Requirement: Windows authority is selected by an exact manifest-bound provider tuple
The system SHALL expose Windows recursive process authority only through an exact registered provider id, recursive-scope capability id, protocol version, common-contract version, provider-reference version, complete semantic list, and adjacent artifact identity. Selection SHALL be explicit; no Windows authority SHALL be reached by falling back from another provider, from the legacy process-capsule helper, or from a process-group, process-tree, or task-listing mechanism.

#### Scenario: Exact Windows provider is selected
- **WHEN** a frozen Windows execution requests the exact `rasen.windows.job-object` provider tuple present in the validated manifest
- **THEN** the coordinator selects that provider with the complete recursive-scope semantics
- **AND** preparation uses only its declared adjacent Windows artifact

#### Scenario: Tuple mismatch fails closed
- **WHEN** provider id, capability id, protocol version, common-contract version, reference version, semantics, or artifact identity differs from the manifest
- **THEN** preparation returns typed `authority-unavailable`
- **AND** no workload code and no alternate provider starts

#### Scenario: Non-Windows runtime does not promote a cross-built artifact
- **WHEN** a Windows provider artifact is inspected or cross-compiled on a Linux or macOS runtime, or a Windows arm64 artifact is inspected on a Windows x64 runtime
- **THEN** it is treated as build or fixture evidence only
- **AND** the runtime cannot select it as actual Windows authority

### Requirement: Prepare establishes a complete inert Job authority before any workload exists
The provider SHALL create the recursive authority as one unnamed Job Object whose limit configuration is read back and proven to have kill-on-job-close enabled and both breakaway permissions disabled, SHALL associate its completion port while the Job is still empty, SHALL create the private control endpoint and the guardian that holds the Job's only handle, and SHALL prove the complete identity attestation before returning `prepared-inert`. No workload process SHALL exist at `prepared-inert`, and a failed or unavailable prerequisite SHALL be reconciled without executing workload code and SHALL NOT fall back to a process group, process tree, task listing, or the legacy capsule helper.

#### Scenario: Successful prepare stays inert
- **WHEN** all required Job, limit, completion-port, endpoint, boot-identity, state-root, guardian, and artifact-integrity probes succeed
- **THEN** prepare returns a fresh `prepared-inert` authority reference
- **AND** the Job exists with an active-process count of zero
- **AND** no workload process object has been created

#### Scenario: Breakaway permission is present
- **WHEN** the Job's limit configuration read back after configuration differs from the exact expected mask, including any breakaway or silent-breakaway permission being set
- **THEN** prepare returns a typed failure and destroys the partial authority
- **AND** no workload code executes

#### Scenario: Completion port is associated before the first member
- **WHEN** the authority's completion port is associated
- **THEN** the association happens while the Job has no member so that every later membership event is delivered
- **AND** an authority whose port was associated after a member existed is rejected rather than observed

#### Scenario: Publication precedes activation
- **WHEN** authority is prepared and its common reference has not received an exact durable publication acknowledgement
- **THEN** no workload process is created and no workload code can run
- **AND** an acknowledgement mismatch is reconciled through abort without activation

#### Scenario: Windows cannot supply the guarantee
- **WHEN** Job creation, limit configuration, completion-port association, boot-identity acquisition, trusted state-root validation, first-instance endpoint creation, or guardian construction is denied or unsupported
- **THEN** prepare returns typed `authority-unavailable` after exact partial-construction cleanup
- **AND** it neither weakens the authority nor starts workload code

#### Scenario: Prepare probe becomes ambiguous
- **WHEN** any required identity or construction probe changes, times out, or cannot be revalidated before the prepared reference is returned
- **THEN** the provider retains a typed failure for the prepare phase
- **AND** no prepared reference is published and no workload code executes

### Requirement: The workload root enters the authority before it executes
Activation SHALL create the workload root exactly once, in a suspended state, with its Job membership established as part of process creation rather than afterwards, and SHALL prove membership and authority identity before the root is allowed to run. A root that cannot be proven inside the authority SHALL be destroyed while still suspended and SHALL never execute.

#### Scenario: Root is created suspended and assigned at creation
- **WHEN** activation creates the workload root
- **THEN** the root is created suspended with its Job membership applied as part of creation
- **AND** no workload instruction, loader initialization, or module entry point has run before membership exists

#### Scenario: Membership proof precedes execution
- **WHEN** the root has been created and membership, the authority limit configuration, and the membership event have all been confirmed for that exact process
- **THEN** the root's initial thread is resumed exactly once and the authority reports live

#### Scenario: Membership cannot be proven
- **WHEN** membership, the limit configuration, or the membership event cannot be confirmed for the created root
- **THEN** the root is terminated while still suspended and a typed failure is returned
- **AND** the workload command has not executed

#### Scenario: Activation is repeated
- **WHEN** activation is requested again for the same authority
- **THEN** no second workload root is created and the recorded lifecycle truth is unchanged

### Requirement: Durable publication truth projects the recovered inert phase
The system SHALL use one concrete trusted durable publication ledger with the existing common publisher callback to distinguish a provider-native inert authority that is prepared from one whose exact common reference is published. The ledger SHALL bind the canonical full-reference digest, preparation operation id, publication version, provider generation, and immutable launch digest, SHALL commit durably before returning acknowledgement, and SHALL be revalidated before activation or recovered phase reporting. Activation SHALL NOT create, imply, or replace publication truth.

#### Scenario: Prepared inert has no publication record
- **WHEN** the authority is natively inert and the trusted ledger proves no publication record exists for the exact reference generation
- **THEN** provider inspection reports `prepared-inert`
- **AND** activation remains unavailable

#### Scenario: Publisher commits before acknowledgement
- **WHEN** the common publisher receives the exact binding
- **THEN** it atomically and durably commits the exact ledger record before returning the matching acknowledgement
- **AND** the acknowledgement does not itself create the workload root

#### Scenario: Process crashes after publication commit
- **WHEN** the publisher commits the exact record and the process crashes before acknowledgement delivery or before the later activate call
- **THEN** replacement inspection reconstructs the canonical reference digest and reports `published-inert`
- **AND** the recovered owner may reconcile or terminate it without executing workload code

#### Scenario: Activation checks durable publication
- **WHEN** the in-memory published authority invokes provider activation
- **THEN** the provider verifies one exact durable ledger record for its preparation operation, generation, and launch digest before the workload root is created
- **AND** no hidden publish command is sent as part of activation

#### Scenario: Publication ledger is forged or ambiguous
- **WHEN** the ledger source is structurally forged, unavailable, malformed, conflicting, wrong-generation, wrong-operation, wrongly owned, reached through a reparse point, or bound to a different launch or reference digest
- **THEN** inspect or activate returns retained authority uncertainty, event gap, or control loss
- **AND** the workload remains inert and no exact-empty receipt is fabricated

### Requirement: Job membership prevents recursive escape
Every activated root and descendant SHALL remain inside the authority for its lifetime. Requesting breakaway at creation, detaching from a console, creating a new console or process group, double-forking through an intermediate process, reparenting, and creating nested Job Objects SHALL NOT remove a live process from the authority, and recursive control SHALL NOT depend on enumerating or sampling descendants.

#### Scenario: Descendant requests breakaway
- **WHEN** a member attempts to create a process that breaks away from the authority
- **THEN** the creation is refused by the operating system and no process is created outside the authority

#### Scenario: Descendant detaches or double-forks
- **WHEN** the root or a descendant detaches from its console, creates a new console or process group, double-forks through an intermediate process that then exits, and keeps running
- **THEN** the surviving process remains a member of the authority
- **AND** recursive termination reaches it without enumerating process identifiers

#### Scenario: Descendant creates a nested authority
- **WHEN** a member creates its own Job Object and assigns descendants to it
- **THEN** those processes remain members of the outer authority
- **AND** the outer authority cannot report exact empty until they are gone

#### Scenario: Work proxied through an out-of-authority service
- **WHEN** a member asks a pre-existing service outside the authority to create a process on its behalf
- **THEN** the created process is outside the authority and the provider does not claim, count, or control it
- **AND** the authority's exact-empty receipt remains exact for the processes the authority actually contains
- **AND** the limitation is recorded as demonstrated evidence rather than described as absolute containment

### Requirement: Root exit and exact scope empty are distinct exact facts
The provider SHALL report the activated root's exact exit status once, as an unsigned value with no signal name, while continuing to own the authority and its surviving descendants. It SHALL report `exact-scope-empty` only from a positive membership-event proof that the authority became empty with a complete event history; root exit, transport closure, guardian absence, a sampled active-process count, or a quiet polling interval SHALL NOT substitute for that proof.

#### Scenario: Root exits while a descendant remains
- **WHEN** the root exits and a detached, reparented, or nested-authority descendant remains live
- **THEN** inspection reports `root-exited` with exactly one non-null status branch
- **AND** exact-scope-empty observation remains pending or live

#### Scenario: Root exit status is read only after the wait completes
- **WHEN** the root exits with a status value that is indistinguishable from the still-running sentinel
- **THEN** the provider reports `root-exited` with that exact status
- **AND** it never reports the exited root as live

#### Scenario: Root exit status is unsigned and carries no signal
- **WHEN** the root is terminated by the authority or exits with a status whose high bit is set
- **THEN** the reported status is the exact unsigned value with no truncation or sign extension
- **AND** the signal branch is null, because no signal name is ever synthesized on this platform

#### Scenario: Scope becomes naturally empty
- **WHEN** the root and every descendant exit naturally
- **THEN** the provider emits the root result if not already emitted
- **AND** emits one authentic `exact-scope-empty` outcome from the authority's own empty event

#### Scenario: Membership event history is incomplete
- **WHEN** the membership event stream is missing, duplicated, reordered, or otherwise incomplete around root exit or emptiness
- **THEN** the provider returns `event-gap` or `control-loss`
- **AND** retains authority without producing exact empty

#### Scenario: Guardian dies while members exist
- **WHEN** the process holding the authority's only handle is forcibly killed while workload members exist
- **THEN** the operating system destroys the authority and terminates its members
- **AND** the provider returns exact empty only when the last-handle attestation and identity proof complete, otherwise it retains a typed uncertain result

### Requirement: Abort and recursive termination converge on exact authority empty
The provider SHALL implement prepared abort, published abort, activated termination, and repeated reconciliation against the authority itself. Any graceful step SHALL be bounded and SHALL NOT by itself produce an empty receipt. Forced termination SHALL act on the authority as a whole, SHALL converge even when members create processes during teardown, and SHALL return an exact-empty receipt only after the authority itself reports empty.

#### Scenario: Prepared authority is aborted
- **WHEN** abort is requested after prepare and before publication
- **THEN** the authority is destroyed with no workload root ever created and exact empty is observed
- **AND** workload code never executes

#### Scenario: Published inert authority is aborted
- **WHEN** publication succeeds but runtime-bridge opening or later activation setup fails
- **THEN** abort destroys the still-inert authority and returns exact empty when proven
- **AND** the workload command remains unexecuted

#### Scenario: Recursive force follows escape attempts
- **WHEN** an activated authority contains roots or descendants that ignore any graceful step, detach, double-fork, or create a nested authority
- **THEN** forced termination operates on the revalidated authority as a whole
- **AND** returns exact empty only after the authority reports empty

#### Scenario: Members create processes during teardown
- **WHEN** a member creates a new process while forced termination is in progress
- **THEN** termination re-applies to the authority until the authority reports empty or the phase deadline expires
- **AND** no individual descendant identifier is enumerated or targeted

#### Scenario: Termination proof is interrupted
- **WHEN** the control channel, the membership event stream, or the deadline fails before exact empty is proven
- **THEN** the outcome is retained as timeout, control-loss, authority-uncertain, or identity-drift
- **AND** a later exact reconciliation may resume from the same reference

### Requirement: Durable references reopen only the same Windows authority
Every provider-private reference SHALL be fresh, versioned, bounded, sensitive, and canonically integrity-bound by the common envelope. The envelope digest detects corruption and tuple drift but is not signer authority; control authenticity SHALL come from revalidating the provider-owned capability, endpoint, ledger, and live authority identity. Native preparation SHALL generate the random one-use scope id, common generation, and independent scope and control capabilities; the TypeScript layer SHALL validate and preserve the exact attested values and SHALL NOT generate or backfill them. A Windows reference SHALL bind the provider path, boot identity, the guardian's process identity together with its exact process birth identity, the endpoint owner identity, the attested authority limit configuration, the sole-handle attestation, and helper protocol and source identity. Replacement inspection or control SHALL open its handles and immediately revalidate the complete identity before using them.

#### Scenario: Exact replacement recovery succeeds
- **WHEN** the original controller exits and a replacement receives an authentic reference on the same boot
- **THEN** the replacement authenticates the endpoint and the guardian's process birth identity
- **AND** rereads the complete stable identity after every handle is open before reporting or controlling the existing authority

#### Scenario: Process identity is reused
- **WHEN** the referenced guardian identifier is now occupied by a process with a different birth identity
- **THEN** inspection and control return `identity-drift`
- **AND** no control request or destructive operation is issued to the new process

#### Scenario: Endpoint is impersonated or squatted
- **WHEN** the control endpoint exists but its serving process identity or owner identity differs from the reference
- **THEN** the provider returns `identity-drift` and issues no control request
- **AND** the connecting controller cannot be impersonated by the endpoint it connected to

#### Scenario: Boot identity changes
- **WHEN** a reference from a prior boot is reopened
- **THEN** the provider returns `identity-drift` or `authority-unavailable`
- **AND** does not treat a matching numeric identifier or path as authority

#### Scenario: Identity changes after a handle is opened
- **WHEN** any bound identity value differs between the pre-open read and the post-open reread
- **THEN** the provider returns `identity-drift` and performs no observation or control through that handle

#### Scenario: Reference bytes are tampered or future-versioned
- **WHEN** the common envelope, provider-private payload, version, length, discriminator, capability, or bounded field is malformed or unsupported
- **THEN** recovery fails closed before any native operation
- **AND** the sensitive full reference is absent from diagnostics and logs

#### Scenario: Expected guardian is absent without a conflicting identity
- **WHEN** an authentic same-boot reference is reopened after its guardian has exited and no conflicting live identity occupies its identifier
- **THEN** the provider applies the durable terminal record and the last-handle destruction rule
- **AND** returns exact empty only when those rules positively prove the old authority empty

### Requirement: Windows provider failures remain bounded and retained
Every prepare, publish, activate, inspect, terminate, abort, and exact-empty observation SHALL honor the common deadline and abort context, use bounded native frames and records, settle once, and map uncertainty into the frozen common outcome vocabulary. A late, duplicated, conflicting, or unavailable result SHALL NOT release authority or settle a later generation.

#### Scenario: Each lifecycle phase times out
- **WHEN** a provider operation does not complete before its phase deadline
- **THEN** it returns `timeout` for that exact phase
- **AND** no exact-empty receipt is fabricated

#### Scenario: Native transport fails
- **WHEN** the guardian exits, the private endpoint breaks, a frame exceeds its bound, or a response violates the closed protocol
- **THEN** the provider returns `control-loss` or `authority-uncertain`
- **AND** retains the reference for later reconciliation

#### Scenario: Late or duplicate result arrives
- **WHEN** a native result arrives after deadline settlement or conflicts with an already accepted sequence or result
- **THEN** it is quarantined or classified as event gap
- **AND** it cannot activate twice, control twice under a new generation, or produce an optimistic empty receipt

### Requirement: Native artifacts have adjacent integrity and build provenance
Every Windows provider helper used by a runtime SHALL be a source-owned, adjacent, exact platform and architecture artifact whose closed manifest records length, digest, compiler, source digest, capability, and provider mode. Runtime resolution SHALL NOT compile, download, search the executable path, follow a link or reparse escape, invoke a shell, or reinterpret a legacy process-capsule artifact.

#### Scenario: Exact packaged helper resolves
- **WHEN** the provider manifest and companion artifact manifest identify an adjacent regular Windows helper with matching platform, architecture, protocol, mode, length, digest, and source provenance
- **THEN** the provider resolves that exact real path and can begin availability probing

#### Scenario: Packaged helper integrity differs
- **WHEN** the helper is missing, a link or reparse point, outside its package root, wrong platform, architecture, mode or version, wrong length, digest or source, or missing a required capability
- **THEN** resolution fails closed as authority unavailable or helper-integrity failure
- **AND** no path search, compiler, download, shell, or legacy helper fallback occurs

#### Scenario: Artifact identity is proven by digest, not by size
- **WHEN** two builds of the helper have the same byte length
- **THEN** artifact identity is decided by the recorded digest and source digest
- **AND** equal length is never reported as evidence that the artifact is unchanged

### Requirement: Verification distinguishes actual kernel truth from build and release claims
Provider acceptance SHALL consume the archived common provider conformance suite unchanged and SHALL include actual-Windows mutation receipts for every authority invariant. Every production component that faces the operating system SHALL be exercised by tests that cross the production entry point on the real kernel; an acceptance claim SHALL NOT rest on a recording stand-in, an injected fixture, or a testing-only variant. Every significant oracle SHALL be demonstrated to fail against a deliberately broken product before its passing result is accepted as evidence. Evidence SHALL identify its operating-system build, toolchain, command, helper digest, and crate source digest, and SHALL state asserting-test counts separately from headline counts.

#### Scenario: Shared common conformance remains unchanged
- **WHEN** the Windows fixture runs provider-neutral conformance
- **THEN** it imports and passes the archived shared suite body without modifying it, supplying its concrete durable publisher
- **AND** provider-specific mutations live outside the shared suite and outside the production factory

#### Scenario: Windows matrix runs on the actual kernel
- **WHEN** the acceptance runs on the Windows host
- **THEN** breakaway refusal, detached and double-forked survival, nested authority, suspended assign-before-run, membership-event ordering, guardian death under the last-handle rule, root-exit distinction and status fidelity, natural empty, recursive kill under process creation, prepared and published abort, replacement recovery, identity drift, and unavailable-configuration oracles all execute against the real operating system
- **AND** no such gate is closed on environment-unavailability grounds

#### Scenario: An oracle has no demonstrated failing counterpart
- **WHEN** a guard test passes against the current product but has not been shown to fail against a deliberately broken product
- **THEN** it is treated as non-discriminating and does not close its acceptance gate

#### Scenario: A production component is reached only through a stand-in
- **WHEN** a production type or factory that faces the operating system has no test crossing its production entry point
- **THEN** the acceptance records that gap explicitly and its dependent gates remain open

#### Scenario: Architecture and release claims are evaluated later
- **WHEN** the Windows x64 runtime gates pass
- **THEN** this Change records the exact provider capability and remaining environment gates
- **AND** Windows arm64 runtime truth, clean distribution and install truth, packaging-matrix truth, and final claimed-OS support remain later evidence rather than being inferred here
