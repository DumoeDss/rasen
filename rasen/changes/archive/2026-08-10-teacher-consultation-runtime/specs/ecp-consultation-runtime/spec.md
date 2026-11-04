## ADDED Requirements

### Requirement: Consultation eligibility and Teacher authority are frozen before execution

ECP SHALL treat implementer consultation as an opt-in frozen execution binding from one eligible source Action profile to one exact Teacher capability and effective policy. The binding SHALL freeze the Teacher capability/contract/adapter identity, model, runtime, sandbox, workspace authority, and consultation limits before the source Action begins. A binding SHALL be executable only when the Teacher is an agent capability with a read-only sandbox, `none` or `read` workspace access, and no workspace or external effects. Worker output and driver input SHALL NOT select or replace the Teacher authority. Pipelines without a consultation binding SHALL retain their existing execution profile digest and behavior.

#### Scenario: Valid binding freezes the exact Teacher
- **WHEN** a Run is prepared with an eligible source profile and a valid Teacher binding
- **THEN** the sealed execution profile SHALL contain the exact source path, Teacher profile path, capability and adapter digests, effective model/runtime/sandbox/workspace facts, and limits
- **AND** every consultation from that source SHALL use those frozen facts

#### Scenario: Write-capable Teacher fails before source execution
- **WHEN** a consultation binding resolves a Teacher with workspace-write sandbox, write workspace access, or any declared effect
- **THEN** preparation or execution preflight SHALL fail with a typed invalid-consultation-binding result
- **AND** the eligible source Action SHALL NOT start under that binding

#### Scenario: Unbound pipeline is unchanged
- **WHEN** a pipeline has no consultation binding
- **THEN** it SHALL emit no consultation profile fields, lifecycle transitions, continuation grants, or view section
- **AND** its pre-change execution profile digest and scheduling behavior SHALL remain unchanged

### Requirement: An implementer can request direct Teacher advice without completing its Action

An eligible active source Action SHALL be able to return a strict `CONSULT` worker step containing one bounded problem summary, concrete question, attempted approaches, constraints, and optional evidence pointers. ECP SHALL validate and attest that step, pause the source Action without committing a domain result, derive one consultation identity, and directly admit the bound Teacher Action. The data path from the source question to the Teacher and from Teacher advice back to the source SHALL NOT require a LEAD Action or LEAD-authored relay.

#### Scenario: Valid request directly admits a Teacher
- **WHEN** an eligible source Action returns a valid `CONSULT` step
- **THEN** the canonical Run SHALL record the source Action as paused for the derived consultation
- **AND** ECP SHALL grant exactly one Teacher Action with the validated question and exact frozen Teacher authority
- **AND** no LEAD Action SHALL be admitted on the consultation data path

#### Scenario: Malformed request changes no Run state
- **WHEN** a source turn returns a malformed, oversized, or non-eligible `CONSULT` step
- **THEN** ECP SHALL reject it with a typed validation result before Teacher admission
- **AND** no consultation transition, Teacher Action, or advice delivery SHALL be committed

#### Scenario: Caller cannot substitute a Teacher
- **WHEN** a worker or driver includes a capability, model, runtime, or limit different from the frozen binding
- **THEN** ECP SHALL ignore no field silently and SHALL reject the request as an authority mismatch
- **AND** no alternate Teacher SHALL execute

### Requirement: Questions and advice are typed, durable, correlated, and attributable

Every consultation SHALL use versioned `teacher-consultation/invocation/1`, `teacher-consultation/advice/1`, and `teacher-consultation/resume/1` contracts. The canonical Run SHALL durably bind the normalized question and advice to the consultation id, source Run/Action/Invocation/Attempt/occurrence, source stable Session, Teacher Action/attempt, actors, model/runtime, evidence, and consultation ordinal. Teacher advice SHALL contain exactly one decision from `plan`, `correction`, or `stop`, with bounded rationale, ordered steps, cautions, and evidence notes. A mismatched consultation id, attempt, actor authority, or result contract SHALL fail before advice commitment. The Session host registry SHALL retain only bounded lifecycle/digest facts and SHALL NOT retain the question or advice body.

#### Scenario: Advice is committed with full attribution
- **WHEN** the bound Teacher completes a valid advice result
- **THEN** the canonical consultation SHALL identify the exact source and Teacher Actions, Invocations, attempts, actors, model/runtime facts, decision, content digest, and EvidenceRefs
- **AND** the stored advice SHALL decode as `teacher-consultation/advice/1`

#### Scenario: Crossed answer is rejected
- **WHEN** a Teacher result names another consultation id or attempt
- **THEN** ECP SHALL reject the completion before mutating consultation state
- **AND** the result SHALL NOT become deliverable to either source Action

#### Scenario: Stop remains advisory
- **WHEN** a valid Teacher returns decision `stop`
- **THEN** ECP SHALL deliver that complete advice to the source implementer
- **AND** SHALL NOT treat the Teacher decision as implementation completion, gate satisfaction, Run cancellation, or source Action self-certification

#### Scenario: Session registry contains no consultation content
- **WHEN** a consultation question and advice have traversed a hosted Session
- **THEN** the Session host registry SHALL contain request/result digests and lifecycle facts only
- **AND** the question and advice bodies SHALL remain in the canonical Run and bound EvidenceStore

### Requirement: Teacher reads are advisory and mechanically non-mutating

A Teacher Action SHALL execute with read-only sandbox authority, at most read access to the source workspace, and no declared effects. When read access is configured and the source holds a writer reservation, ECP SHALL grant only a consultation-sponsored read tied to the exact paused source Action and consultation; unrelated readers and writers SHALL remain excluded. Any write-capable authority, workspace mutation, effect observation, or sponsor mismatch SHALL fail closed and SHALL NOT produce committed advice.

#### Scenario: Teacher reads the paused implementer's workspace
- **WHEN** a paused source Action holds the workspace writer reservation and its bound Teacher requires read access
- **THEN** ECP SHALL admit one sponsored read for the exact same Run, source Action, and consultation
- **AND** the Teacher SHALL observe the source workspace without releasing the source writer exclusion

#### Scenario: Sponsored read does not become a general bypass
- **WHEN** another Action or Run requests read or write access while the source writer is paused
- **THEN** it SHALL remain blocked by the writer reservation
- **AND** only the exact read-only Teacher for the active consultation SHALL be eligible for sponsorship

#### Scenario: Mutation attempt cannot become advice
- **WHEN** the Teacher execution attempts to mutate the workspace or reports any effect
- **THEN** the executor SHALL return a typed authority or observation failure
- **AND** no advice SHALL be committed or delivered from that attempt

### Requirement: Actual advice continues the exact originating implementer Session

After valid Teacher advice commits, ECP SHALL issue one canonical continuation grant for the original source Action and stable Rasen Session. The grant SHALL carry the complete validated advice, not merely a Teacher-completed signal, and SHALL be bound to the original Invocation, role, workspace, backend, expected Record version, consultation id, and advice digest. The executor SHALL wake that exact stable Session and SHALL reject a cross-authority or caller-substituted continuation. A `stop` decision SHALL use the same delivery path as other advice.

#### Scenario: Advice wakes the same source Session
- **WHEN** an idle hosted source Session has one committed advice result
- **THEN** the continuation turn SHALL use the same stable Rasen Session id and exact backend Session identity as the source question turn
- **AND** its input SHALL contain the complete committed `teacher-consultation/resume/1` advice envelope

#### Scenario: Notification-only delivery is insufficient
- **WHEN** a continuation grant is projected after Teacher completion
- **THEN** the grant SHALL bind and carry the validated advice body and digest
- **AND** an input that states only that a Teacher ran SHALL fail continuation validation

#### Scenario: Cross-authority continuation fails closed
- **WHEN** a continuation addresses another Session, Invocation, role, workspace, backend, consultation, or advice digest
- **THEN** the executor SHALL reject it before sending input
- **AND** the canonical advice SHALL remain undelivered to the wrong source

#### Scenario: Another consultation remains possible within the frozen limit
- **WHEN** the continued implementer returns another valid `CONSULT` step and its per-Invocation consultation budget remains
- **THEN** ECP SHALL create the next gap-free consultation ordinal
- **AND** SHALL preserve the same source Action and stable Session identity

### Requirement: Continuation support is declared and unavailable routes fail before work

ECP SHALL consult the frozen Action executor capability matrix before starting a consultation-eligible source Action. The selected backend SHALL explicitly declare exact multi-turn continuation support and be available on the current host. In 0.2.0, hosted execution SHALL declare this support and in-tool execution SHALL declare it unavailable. ECP SHALL return typed `consultation-continuation-unavailable` rather than starting an eligible source on an uncontinuable route or substituting another backend.

#### Scenario: Hosted route declares continuation before start
- **WHEN** an eligible source is routed to an available hosted backend
- **THEN** every driver face SHALL show `continuableTurns: true` before the Action starts
- **AND** the runtime MAY execute the consultation lifecycle through the stable hosted Session

#### Scenario: In-tool route is refused for an eligible source
- **WHEN** an explicit request or explicit default selects in-tool execution for a consultation-eligible source
- **THEN** ECP SHALL return `consultation-continuation-unavailable` before that Action starts
- **AND** SHALL NOT silently select hosted execution or promise a replacement-session equivalent

### Requirement: Consultation attempts and content are independently bounded

The frozen binding SHALL define positive `maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`, question/advice byte bounds, and collection bounds within server-owned maxima. ECP SHALL count consultation questions and Teacher attempts independently from BoundedLoop strategy attempts. Teacher Actions SHALL also consume the existing global Run Action/Attempt budgets. When a consultation-specific limit is exhausted before advice exists, ECP SHALL durably record typed unavailability and continue the exact source Session with `teacher-consultation/unavailable/1`; it SHALL NOT fabricate advice or increment a loop strategy counter.

#### Scenario: Per-Invocation question limit is enforced
- **WHEN** a source Invocation requests more consultations than its frozen maximum
- **THEN** ECP SHALL admit no additional Teacher Action
- **AND** SHALL continue the source Session once with bounded consultation-unavailable feedback and the used/max counts

#### Scenario: Teacher retry limit is enforced
- **WHEN** one consultation reaches its maximum Teacher attempts without valid advice
- **THEN** ECP SHALL admit no further Teacher attempt for that consultation
- **AND** SHALL continue the source Session with the attempt failure and used/max counts

#### Scenario: Strategy and consultation counters do not alias
- **WHEN** a source Action inside a BoundedLoop performs consultation and the loop later invokes lifecycle strategy
- **THEN** consultation attempts SHALL NOT change `strategy.attempts`
- **AND** strategy attempts SHALL NOT reduce any consultation budget

### Requirement: Replay and restart preserve exactly-once consultation delivery

Consultation ids, Teacher Action identities, and source continuation request ids SHALL be deterministic from committed Run facts. Repeating an exact request or settled continuation after acknowledgement loss SHALL reuse the canonical entry or SessionHost settled result and SHALL NOT duplicate Teacher work or advice delivery. Restart SHALL resume from the last committed consultation state: pending Teacher, committed advice awaiting continuation, or settled source result. If a source continuation was sent but its outcome is unknown, ECP SHALL record a durable `continuation-outcome-unknown` wait and SHALL NOT automatically resend or claim delivery.

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

### Requirement: One canonical projection exposes consultation truth across product planes

The Change Run view SHALL project a versioned consultation section from the canonical Record, including source and Teacher identities, lifecycle state, advice decision, evidence digests, continuation state, typed failure, and independent used/max counters. CLI, Management API, and Canvas SHALL consume this one projection. BoundedLoop strategy/recovery contracts and projections SHALL remain unchanged; only the source Action's eventual final domain result SHALL feed loop progress, blocker, and strategy decisions.

#### Scenario: Every plane sees the same consultation
- **WHEN** a consultation is requested, advised, continued, or becomes ambiguous
- **THEN** CLI, Management API, and Canvas projections SHALL report the same consultation id, state, identities, decision, counters, and failure reason from one ChangeRunView

#### Scenario: Consultation does not masquerade as loop progress
- **WHEN** an Action inside a BoundedLoop pauses for consultation or receives advice
- **THEN** those intermediate transitions SHALL NOT advance loop iteration, progress fingerprint, blocker streak, or strategy attempts
- **AND** the final source Action result SHALL continue through the existing loop lifecycle unchanged

### Requirement: Canonical Teacher settlement waits for exact authority disposition

ECP SHALL treat Teacher result bytes as quarantined execution input until the exact Teacher attempt is correlated to its canonical Run, Action, Invocation, attempt, stable Session, and request; its durable hosted receipt is verified; its exact recursive process authority produces an authenticated exact-scope-empty receipt; and the final workspace observation is stable. Only then SHALL strict advice validation and canonical advice settlement occur. A post-activation failure that has not proved exact scope empty SHALL retain the exact authority and consultation reservations, and SHALL produce neither advice nor source continuation while that authority remains unsafe.

#### Scenario: Exact empty and stable observation permit advice settlement
- **WHEN** a Teacher turn settles once, its durable hosted receipt matches the canonical attempt, exact recursive retirement returns an authenticated exact-scope-empty receipt, and the final workspace manifest equals the stable baseline
- **THEN** ECP SHALL validate the quarantined bytes against `teacher-consultation/advice/1` and commit at most one canonical advice settlement
- **AND** only that committed settlement SHALL become eligible for exact source continuation

#### Scenario: Delayed child cannot outrun final observation
- **WHEN** a contained Teacher child waits until valid-looking result bytes exist and then attempts to mutate or create an early-sorted ignored entry while a later bounded entry is being observed
- **THEN** exact recursive retirement SHALL prevent the delayed write from surviving into the observation window, or the manifest stability fence SHALL classify the observation as unstable
- **AND** the valid-looking bytes SHALL NOT be committed as advice or delivered to the source from that attempt

#### Scenario: Unsafe retirement failure retains authority and reservations
- **WHEN** retirement or recovery reports root exit without exact empty, declared-unproven emptiness, timeout, provider/control loss, foreign or stale reference, identity drift, event gap, or an unauthenticated receipt
- **THEN** ECP SHALL durably retain or recover the exact Teacher authority and keep the sponsored Teacher reservation and paused source writer reservation in their safe dispositions
- **AND** SHALL emit no advice, no advice continuation, and no optimistic unavailable continuation while the attempt remains unsafe

#### Scenario: Safe failed attempt can reach bounded unavailability
- **WHEN** an attempt has not produced valid advice but either never activated or later proved authentic exact scope empty, and the frozen Teacher-attempt budget is exhausted
- **THEN** ECP SHALL release the sponsored Teacher reservation, retain the paused source writer for its canonical continuation, and settle one typed consultation-unavailable result
- **AND** any source continuation SHALL be derived only from that canonical unavailable settlement rather than directly from the failed execution outcome

### Requirement: Final workspace observation is a stable bounded no-follow manifest

The final Teacher workspace observation SHALL cover tracked, untracked, and ignored entries plus separate HEAD and index identities within fixed entry and byte bounds. Every regular file SHALL retain the same identity, type/mode, size, `mtimeNs`, and `ctimeNs` from initial observation through a post-read `fstat`; every directory SHALL retain those facts through enumeration and all child visits followed by a post-children `lstat`. Symlinks and Windows junctions SHALL be represented without following them. Only explicitly classified internal instability MAY trigger a bounded whole-observation retry; permission, path, decoding, unsupported-entry, bounds, or persistent-instability failures SHALL fail closed.

#### Scenario: File changes after its bytes were read
- **WHEN** a regular file changes identity, type/mode, size, `mtimeNs`, or `ctimeNs` after its initial `lstat` or open but before its post-read `fstat`
- **THEN** the final observation SHALL be unstable and the Teacher result SHALL remain uncommitted

#### Scenario: Directory changes after enumeration
- **WHEN** a directory is replaced, gains or loses a child, changes its required metadata after enumeration, or is swapped with a symlink or junction before or during child traversal
- **THEN** handle-bound/no-follow traversal where available or post-enumeration/post-children validation SHALL detect the drift
- **AND** no escaping link target SHALL be traversed or accepted into a successful manifest

#### Scenario: Retry is restricted to classified instability
- **WHEN** the observer encounters a transient race that is explicitly classified as internal manifest instability
- **THEN** it MAY retry the complete bounded observation no more than the frozen retry limit
- **AND** permission, path, decoding, entry/byte-bound, or persistent-instability failures SHALL terminate the attempt without a successful manifest
