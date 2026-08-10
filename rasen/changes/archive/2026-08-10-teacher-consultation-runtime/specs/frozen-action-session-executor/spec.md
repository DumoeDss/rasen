## ADDED Requirements

### Requirement: The executor exposes typed non-terminal agent steps with stable Session attribution

The frozen Action session executor SHALL preserve the settled hosted result body, result digest, replay fact, stable Rasen Session id, and request identity long enough for the trusted adapter to decode either the Action's terminal result contract or an explicitly selected consultable non-terminal worker contract. A valid consultation step SHALL remain non-terminal for the source Action and SHALL be attestable against the exact frozen Action authority. Existing terminal-only worker contracts SHALL remain unchanged and SHALL reject `CONSULT`.

#### Scenario: Consultable step returns stable Session attribution
- **WHEN** a consultation-eligible hosted Action settles a valid `CONSULT` worker result
- **THEN** the executor result SHALL identify the exact frozen Action, request, stable Rasen Session, result digest, and parsed consultation body
- **AND** SHALL NOT classify the source Action as succeeded, failed, or blocked

#### Scenario: Ordinary leaf contract still rejects CONSULT
- **WHEN** an Action using the existing `leaf` worker contract returns `CONSULT`
- **THEN** the worker result SHALL fail strict contract validation
- **AND** no consultation request SHALL be produced

#### Scenario: Host output remains untrusted until adapter validation
- **WHEN** SessionHost returns a settled result body and Session identity
- **THEN** those facts SHALL remain untrusted execution input until the frozen trusted adapter validates the selected worker/result contract and attests the step
- **AND** SessionHost success alone SHALL NOT mutate the canonical Run

### Requirement: Continuation grants wake only the exact same-invocation hosted Session

The executor SHALL accept a source continuation only through a canonical grant bound to the original frozen Action, stable Session id, consultation and advice digest, expected Record version, and reuse authority tuple. It SHALL resolve reuse against the same Invocation, role, workspace, and backend and SHALL send runtime-serialized committed advice to that exact Session. Fresh and continuation turns SHALL have distinct deterministic request ids. A duplicate settled request SHALL replay; a cross-authority, stale, caller-substituted, retired, or ambiguous continuation SHALL fail closed without sending a second input.

#### Scenario: Same-invocation continuation is permitted
- **WHEN** a current canonical grant addresses the idle hosted Session established by the same Invocation, role, workspace, and backend
- **THEN** the executor SHALL wake that exact stable Session with the committed continuation envelope
- **AND** SHALL record reuse and request attribution for the continuation turn

#### Scenario: Teacher Session is not reused as the source Session
- **WHEN** a Teacher Action finishes and the source continuation is granted
- **THEN** the Teacher's distinct Invocation/role authority SHALL be ineligible for source reuse
- **AND** the continuation SHALL address only the source implementer's stable Session

#### Scenario: Caller-substituted text is rejected
- **WHEN** a driver supplies continuation text that does not match the canonical advice contract and digest
- **THEN** the executor SHALL reject the continuation before backend input
- **AND** SHALL NOT send either the supplied text or a partial notification

#### Scenario: Acknowledgement loss replays one settled continuation
- **WHEN** the same deterministic continuation request is dispatched after SessionHost already settled it
- **THEN** the executor SHALL surface the settled replay
- **AND** SHALL NOT send the advice to the backend again

### Requirement: The capability matrix declares exact turn continuation support

Every executor backend declaration SHALL include a `continuableTurns` fact visible to every driver before Action start. In 0.2.0 the hosted backend SHALL declare `continuableTurns: true` because it owns a stable wakeable Session, and the in-tool backend SHALL declare `continuableTurns: false` because launcher-owned worker continuation is not a durable ECP authority. A consultation-eligible Action SHALL require an available cell whose declaration is true; failure SHALL be typed and SHALL NOT silently reroute.

#### Scenario: Matrix distinguishes hosted and in-tool continuation
- **WHEN** the current-host capability cells are queried
- **THEN** hosted SHALL report `continuableTurns: true` and in-tool SHALL report `continuableTurns: false`
- **AND** the existing durability, headless, cancel, scope-empty, and usage-attribution facts SHALL remain unchanged

#### Scenario: Uncontinuable selection fails before Action dispatch
- **WHEN** an eligible source Action is resolved against an unavailable hosted cell or an in-tool cell
- **THEN** the executor SHALL return typed `consultation-continuation-unavailable`
- **AND** SHALL NOT run the source Action or select another backend in response

### Requirement: Teacher attempts activate only on an exact recursive process provider

The executor SHALL derive an exact-recursive-retirement requirement from canonical Teacher Action authority and SHALL resolve one authenticated, manifest-bound provider tuple before Teacher activation. Windows and Linux MAY report the exact Teacher lane available only when their production provider Adapter, durable publication path, and runtime bridge are usable on the current host. macOS SHALL report typed exact-Teacher authority unavailable until an exact provider exists. Provider unavailability SHALL occur before workload activation and SHALL NOT fall back to the ordinary hosted best-effort ProcessScope, in-tool execution, PID/name discovery, or a weaker provider.

#### Scenario: Windows or Linux exact provider is available
- **WHEN** the current Windows or Linux host has a matching authenticated provider manifest, production Adapter, durable publisher, and runtime bridge
- **THEN** the Teacher capability cell SHALL expose exact recursive retirement as available before activation
- **AND** the selected provider tuple SHALL remain fixed for the complete attempt and its recovery

#### Scenario: macOS has no exact provider
- **WHEN** a Teacher attempt is prepared on macOS while no exact process provider is registered
- **THEN** the executor SHALL return typed exact-Teacher authority unavailable before workload activation
- **AND** SHALL NOT run the Teacher through the ordinary POSIX best-effort hosted scope

#### Scenario: Caller cannot choose or weaken process authority
- **WHEN** any driver submits cwd, backend, limits, an exactness flag, provider identity, ProcessRef, PID, process name, hosted receipt, or phase-order instruction for a Teacher attempt
- **THEN** the executor SHALL reject the submitted authority fields and resolve the attempt only from its canonical locator and server-owned policy
- **AND** no submitted field SHALL select a provider or reorder execution and settlement

#### Scenario: Ordinary and source hosted Sessions remain compatible
- **WHEN** an ordinary hosted Action or consultation source Session executes, continues, cancels, restarts, or retires outside the Teacher exact lane
- **THEN** its existing hosted best-effort declaration, SessionHost Interface, lifecycle result, and compatibility behavior SHALL remain unchanged
- **AND** exact Teacher availability or unavailability SHALL NOT upgrade, disable, or reinterpret that Session's process authority

### Requirement: One deep Teacher attempt Interface owns ordering and settlement

Every common execution face SHALL invoke Teacher work through one domain-specific operation addressed only by a canonical Teacher-attempt locator. The executor SHALL internally enforce canonical preflight, stable baseline observation, exact provider prepare and durable publication, exactly-once activation and execution, result quarantine, durable hosted-receipt verification, exact recursive retirement, stable final manifest fencing, strict advice validation, and canonical advice or safe unavailable settlement in that order. Callers SHALL receive only the canonical settlement or retained-authority outcome and SHALL NOT receive reorderable lifecycle primitives.

#### Scenario: Successful Teacher attempt follows the complete order
- **WHEN** a common caller executes a canonical Teacher-attempt locator
- **THEN** every required phase SHALL durably precede the next phase and strict advice validation SHALL occur only after hosted-receipt verification, exact-scope-empty retirement, and final manifest stability
- **AND** the operation SHALL return the resulting canonical advice or unavailable settlement rather than raw hosted result bytes

#### Scenario: Result bytes remain quarantined before retirement
- **WHEN** SessionHost has durably settled result bytes but exact retirement or final observation has not completed
- **THEN** the bytes SHALL remain quarantined and unavailable to trusted completion, advice projection, source continuation, and canonical settlement
- **AND** a restart SHALL recover the quarantine identity without executing the Teacher request again

#### Scenario: Only an authenticated exact-empty receipt authorizes final observation
- **WHEN** the exact Teacher lane receives root exit, declared-unproven close, a structurally fabricated receipt, a receipt for another ProcessRef, or any retained provider outcome
- **THEN** it SHALL refuse final observation and settlement, preserve the exact authority for reconciliation, and emit no advice or source continuation from that outcome
- **AND** only the coordinator-authenticated `ExactScopeEmptyReceipt` for the persisted reference SHALL authorize progress

### Requirement: Exact Teacher attempt authority survives restart at every phase

The executor SHALL durably bind the exact provider tuple, opaque ProcessRef, canonical Run/Action/Invocation/attempt, stable Session, deterministic request, hosted receipt identity, quarantine identity, and current phase before any later irreversible phase. On restart, the canonical Record, exact Teacher-attempt journal, SessionHost registry, and provider publication ledger SHALL be reconciled as one authority union. Recovery SHALL dispatch only through the persisted provider tuple and opaque reference, never by inferring ownership from PID, process name, current registry order, or a newly enumerated descendant set.

#### Scenario: Restart at each durable phase resumes one attempt
- **WHEN** the daemon restarts after any durable phase from canonical preflight through settlement
- **THEN** recovery SHALL resume or safely reconcile the same exact attempt from its committed frontier
- **AND** SHALL neither activate nor send the Teacher request more than once nor validate quarantined bytes before their required gates

#### Scenario: Persisted provider tuple is unavailable after restart
- **WHEN** restart cannot authenticate or dispatch the exact persisted provider tuple and opaque ProcessRef
- **THEN** recovery SHALL report retained typed authority unavailable and preserve the reference and reservations
- **AND** SHALL NOT select a different provider, PID/name control path, or best-effort SessionHost

#### Scenario: Journal and registry identities disagree
- **WHEN** the canonical Action/attempt, stable Session, request, provider tuple, ProcessRef, hosted receipt, quarantine, or phase differs across durable stores
- **THEN** recovery SHALL fail closed with a typed identity or event-gap outcome
- **AND** no advice, unavailable continuation, authority release, or reservation release SHALL be inferred from the conflicting records
