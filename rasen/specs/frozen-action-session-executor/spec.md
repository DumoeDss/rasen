# frozen-action-session-executor Specification

## Purpose
The execution layer that actually runs a reconciler-granted agent Action through a real, recoverable, auditable Session instead of the launcher implicitly acting as the worker manager. The executor consumes only committed, plan-frozen, currently-executable Actions and rebuilds no authority; a computed, queryable OS-by-backend capability matrix (exactly two 0.2.0 tiers — `in-tool`, where the host tool owns the worker and rasen makes no process-authority claim, and `hosted best-effort`, where the rasen daemon owns a daemon-lifetime process behind the shipped best-effort ProcessScope tiers) decides what each driver face can do before start, and a hosted request the platform cannot serve returns typed `authority-unavailable` rather than silently rerouting. Daemon or launcher death composes into a typed `execution-lost` Action outcome at the executor's reconciliation point, and the Run resumes only from the last committed frontier with no reattach or identity revalidation. Completion is written with transactional integrity (complete-set verification before publish, re-read and re-verification before Record mutation) and no cryptographic signing, and every driver face routes the same granted Action through one contract so no face maintains a second Run or Session truth.
## Requirements
### Requirement: The executor consumes only granted frozen Actions and rebuilds no authority

The frozen-action session executor SHALL execute only agent Actions that are committed, plan-frozen, and currently executable, as granted by the canonical Run Facade. Before dispatch the executor SHALL validate the Run id, Action id, invocation, effect, workspace, profile, adapter authority, and Record version against the granted ActionView, and SHALL NOT rebuild execution authority from the live Definition, chat history, or caller self-report. A duplicate dispatch, a stale Record version, a workspace that does not match the granted ActionView, or an Action that is not currently executable SHALL fail closed with a typed outcome and SHALL execute no backend work.

#### Scenario: A granted Action is executed exactly as granted
- **WHEN** the Facade grants a frozen Action and the executor dispatches it
- **THEN** the executor validates the Action, invocation, workspace, profile, adapter authority, and Record version against the granted ActionView
- **AND** the backend receives exactly that frozen Action and no authority is rebuilt from chat or caller input

#### Scenario: A stale Record version fails closed
- **WHEN** the executor is asked to complete an Action against a Record version that is not the current committed version
- **THEN** it returns a typed `record_version_conflict` outcome and executes no backend work
- **AND** the canonical Record is not mutated

#### Scenario: A wrong workspace fails closed
- **WHEN** the executor is asked to run a granted Action in a workspace that does not match the granted ActionView
- **THEN** it returns a typed `workspace-scope-mismatch` outcome before any backend process receives input
- **AND** no Session is created in the wrong workspace

#### Scenario: A duplicate dispatch is rejected
- **WHEN** the executor receives a second dispatch for an Action whose invocation is already in flight or already settled
- **THEN** it returns the recorded in-flight or settled state without sending the input again
- **AND** no second backend execution occurs

### Requirement: A queryable OS-by-backend capability matrix decides what each driver can do before start

The executor SHALL compute a single capability matrix from declared backend capabilities and current-platform availability, joining the operating system axis with the execution-backend axis, and SHALL expose it as a queryable value before any Run starts. The 0.2.0 backend roster SHALL be exactly two tiers: `in-tool`, where the host tool owns the worker process and rasen declares no process-authority claim (not durable, not headless, no exact-termination claim), and `hosted` best-effort, where the rasen daemon owns a daemon-lifetime subprocess through the shipped best-effort ProcessScope tiers (POSIX process group on linux and darwin, Job object on win32) and declares `exactCancel: false` and `scopeEmptyProof: false` before start with a `cancelled / emptiness-unproven` cancel terminal. The kernel-enforced authority tier SHALL NOT appear as a 0.2.0 backend. Every matrix cell SHALL report the declared capability facts (`durable`, `headlessDriver`, `exactCancel`, `scopeEmptyProof`, `usageAttribution`) and a typed availability verdict.

**Locked decision 13 scope.** The `hosted` backend is the shipped declared best-effort tier on all three OSes; the kernel-enforced exact-cancel and exact-scope-empty contracts are parked to the upgrade path together with the two frozen authority crates and are not 0.2.0 acceptance. The dispatch-topology axis (`native | exec-bridge | legacy-fallback` from `runtime-adapter-registry`) and this process-authority backend axis are kept distinct in the matrix.

#### Scenario: The matrix is computed and visible before start
- **WHEN** a Run is prepared on a supported OS
- **THEN** the capability matrix reports the available backends, their declared capability facts, and a typed availability verdict for each cell
- **AND** the matrix is queryable before any backend process starts

#### Scenario: The hosted best-effort declaration is honest on every OS
- **WHEN** the `hosted` backend is available on linux, darwin, or win32
- **THEN** the matrix reports `exactCancel: false` and `scopeEmptyProof: false` for that cell
- **AND** a cancel terminal for that backend is `cancelled / emptiness-unproven`, never a clean-cancel or proven-empty claim

#### Scenario: The in-tool limitation is a declared fact
- **WHEN** the `in-tool` backend is reported for an OS
- **THEN** the matrix declares it not durable, not headless, and making no exact-termination claim
- **AND** that limitation is visible before start rather than explained after a failure

#### Scenario: Kernel-enforced authority is not a 0.2.0 backend
- **WHEN** the matrix is computed for any OS
- **THEN** no cell advertises kernel-enforced exact cancel or exact scope-empty proof
- **AND** no acceptance scenario requires such a proof

### Requirement: A hosted request the platform cannot serve is typed authority-unavailable and never silently reroutes

The executor SHALL return a typed `authority-unavailable` outcome when a `hosted` request targets a platform or backend the current host cannot serve, and SHALL NOT fall back to the `in-tool` backend in response. The `in-tool` backend SHALL be selected only by an explicit request or by an explicit default that the capability matrix showed the user before start. Silent rerouting from a stronger requested backend to a weaker available one is forbidden.

#### Scenario: Hosted unavailable returns typed authority-unavailable
- **WHEN** a `hosted` execution is requested on a platform whose hosted tier cannot serve it
- **THEN** the executor returns a typed `authority-unavailable` outcome naming the unavailable capability
- **AND** no `in-tool` backend is started in its place

#### Scenario: In-tool is chosen only explicitly
- **WHEN** an execution runs on the `in-tool` backend
- **THEN** the selection is traceable to an explicit request or to an explicit pre-start-visible default
- **AND** no code path selects `in-tool` as an automatic response to hosted unavailability

#### Scenario: A platform with only in-tool declares the headless boundary
- **WHEN** a platform offers only the `in-tool` backend
- **THEN** the matrix reports the absence of a headless driver for that platform as a declared boundary
- **AND** the boundary is visible to the user before start

### Requirement: Daemon or launcher death types the in-flight Action execution-lost and resumes only from the committed frontier

When the owning daemon dies (hosted backend) or the launcher process disappears (in-tool backend), the executor SHALL classify the in-flight Action as a typed `execution-lost` outcome that is distinct from generic uncertainty and from a workload failure, and SHALL resume the Run only from the last committed Record frontier via the Facade. The executor SHALL NOT reattach to a dead scope, SHALL NOT revalidate worker identity across the death, and SHALL NOT resend an input whose commitment state is unknown. Already-committed invocations and effects SHALL NOT be re-executed.

**Locked decision 11 scope.** Scope lifetime equals daemon lifetime: daemon death means scope death, and the Run resumes from the committed frontier with no reattach and no identity revalidation. **Locked decision 13 receipt shape.** Windows proves zero-orphan daemon-death teardown via the cutover's receipted Job `KILL_ON_JOB_CLOSE` chain; on linux and macOS the daemon-death orphan risk is a declared known limitation and the receipt proves `execution-lost` typing plus "the uncommitted frontier stays uncommitted", not zero orphans.

#### Scenario: Hosted daemon death types the in-flight Action execution-lost
- **WHEN** the owning daemon dies while a hosted Action is in flight
- **THEN** the executor classifies that Action as typed `execution-lost`
- **AND** the Run resumes from the last committed Record frontier without reattaching the dead scope or revalidating identity

#### Scenario: In-tool launcher death types the in-flight Action execution-lost
- **WHEN** the launcher process disappears while an in-tool Action is in flight
- **THEN** the executor classifies that Action as typed `execution-lost`
- **AND** the uncommitted frontier stays uncommitted and the Run is resumable by another driver

#### Scenario: execution-lost is distinct from generic uncertainty and from workload failure
- **WHEN** an Action is classified after a death
- **THEN** a `execution-lost` outcome is not labelled as generic uncertainty and not labelled as a workload failure
- **AND** a mutation that relabels a normally-completed or normally-failed Action as `execution-lost` is rejected by the guard

#### Scenario: Committed work is not re-executed after resume
- **WHEN** the Run resumes from the committed frontier after a death
- **THEN** already-committed invocations and effects are not re-executed
- **AND** only the uncommitted frontier is re-driven

#### Scenario: Linux/macOS orphan risk is a declared limitation, not a zero-orphan gate
- **WHEN** the hosted daemon-death receipt is taken on linux or macOS
- **THEN** the receipt proves `execution-lost` typing and that the uncommitted frontier stayed uncommitted
- **AND** the orphan risk is recorded as a declared known limitation rather than a gate failure

### Requirement: Completion evidence is published and committed transactionally

The executor's evidence writer SHALL verify that the complete evidence set required by the frozen Action is present and well-formed before publishing any of it to the durable EvidenceStore. The Facade SHALL re-read that evidence set from the durable EvidenceStore and re-verify its integrity, completeness, and binding to the Action, invocation, workspace revision, and ActorRef before any Record mutation, which SHALL remain atomic under the Record-version compare-and-swap. A crash between publish and Record mutation SHALL leave a partial evidence set that the re-read completeness check rejects, so a later completion SHALL NOT treat it as complete. A completion claim whose binding does not match the granted ActionView SHALL fail closed.

**Locked decision 12 scope.** Completion integrity is transactional and SHALL NOT require producer cryptographic signing or private-key custody; ECP-6's archived Ed25519 implementation is not rolled back, only not extended into the producer. The executor SHALL accept, store, and return no signing private key or producer credential.

#### Scenario: A complete evidence set is verified before publish
- **WHEN** an Action completes and the executor prepares to publish its evidence
- **THEN** the evidence writer verifies the complete set required by the frozen Action is present and well-formed
- **AND** a partial set is not published as if complete

#### Scenario: The Facade re-reads and re-verifies before Record mutation
- **WHEN** the Facade commits a completion into the canonical Record
- **THEN** it re-reads the evidence set from the durable EvidenceStore and re-verifies integrity, completeness, and binding to Action, invocation, workspace revision, and ActorRef
- **AND** the Record mutation is atomic under the Record-version compare-and-swap

#### Scenario: A mid-publish crash leaves no complete-looking half-set
- **WHEN** a crash occurs after partial evidence publish but before Record mutation
- **THEN** a later completion re-reads the EvidenceStore and the partial set fails the completeness check
- **AND** the half-set is never treated as a complete completion

#### Scenario: A mismatched or stale completion claim fails closed
- **WHEN** a completion claim's Action, invocation, workspace revision, or ActorRef does not match the granted ActionView
- **THEN** the Facade returns a typed `receipt_conflict` outcome and does not mutate the Record

#### Scenario: No signing material enters the completion path
- **WHEN** the executor and Facade completion surfaces are inspected
- **THEN** none accepts, stores, or returns a signing private key or producer credential
- **AND** completion integrity is carried by the transactional checks, not by a signature

### Requirement: Session reuse, handoff, touch, and retire policy is authoritative and program-enforced

The executor SHALL be the authoritative source for per-invocation session reuse, handoff, touch, and retire policy, retiring the placeholder clause in `ecp-change-run-runtime` that records `handoffTokenLimit`, `reuseRoundLimit`, and `sessionReuse` as placeholder until a slice defines their authoritative source. The policy SHALL derive from the frozen Action's authored `sessionReuse` scope (preserved verbatim through `sessionReuseAuthored`) resolved against a declared executor policy block carrying `authored | definition | default` provenance, and every resolved value SHALL expose a traceable source and default. Reuse SHALL be permitted only within the same frozen invocation, role, workspace, and backend authority; an over-limit or authority-incompatible reuse request SHALL produce an auditable handoff or retire, never a silent reuse. This requirement governs per-Run, per-invocation session reuse at the executor seam and does not modify the cross-child worker reuse owned by `worker-reuse-config` and `worker-reuse-orchestration`.

#### Scenario: Authored never forbids reuse
- **WHEN** a frozen Action authors `sessionReuse: never`
- **THEN** the executor does not reuse a Session for a subsequent invocation
- **AND** the resolved policy carries `authored` or `definition` provenance, not `default`

#### Scenario: Authored same-invocation permits reuse only within the same authority
- **WHEN** a frozen Action authors a same-invocation reuse scope and a subsequent invocation requests the same Session
- **THEN** the executor reuses the Session only if the invocation, role, workspace, and backend authority all match
- **AND** a mismatch produces an auditable handoff or retire rather than a silent reuse

#### Scenario: Over-limit reuse produces an auditable retire
- **WHEN** a reuse request would exceed the resolved handoff token limit or reuse round limit
- **THEN** the executor retires the Session with an auditable reason and no silent reuse occurs
- **AND** the resolved limits carry traceable source and provenance

#### Scenario: Placeholder values are not enforced as authored
- **WHEN** a Record created before this change carries placeholder `handoffTokenLimit` or `reuseRoundLimit` values
- **THEN** the executor treats them as `default`-provenance and applies its own authoritative policy on top
- **AND** no placeholder value is enforced as if an operator or author chose it

### Requirement: Every driver face drives the same Run within the capability matrix

The Claude/Codex interactive launcher, the bare CLI, the Management API, Canvas, and the daemon SHALL start, resume, cancel, and inspect the same canonical Run when the capability matrix reports the combination available, consuming one shared projector and one shared control contract. The headless driver SHALL NOT depend on the interactive launcher surviving. "When capability allows" SHALL be decided by the queryable capability matrix, not by a documentation assertion: each driver x backend x platform combination SHALL either be available with a real run receipt or return a typed unavailable reason, and no face SHALL maintain a second Run or Session truth.

#### Scenario: Each face addresses the same Run
- **WHEN** a Run is started from one driver face and later addressed from another
- **THEN** both faces resolve to the same canonical RunId and ActionId through the shared projector
- **AND** no face creates a duplicate Run or Session truth

#### Scenario: Availability is decided by the matrix, not prose
- **WHEN** a driver face decides whether it may start, resume, cancel, or inspect a Run
- **THEN** it queries the capability matrix and honours the cell's typed availability verdict
- **AND** no face asserts availability that the matrix does not report

#### Scenario: The headless driver is independent of the interactive launcher
- **WHEN** a Run is driven by the headless driver on a platform where the hosted backend is available
- **THEN** the headless driver does not require the interactive launcher to remain alive
- **AND** launcher exit does not end a hosted Run

### Requirement: A real backend attributes the complete execution fact set to one Run/Action

At least one real agent backend SHALL execute a granted frozen Action and associate the complete execution fact set - stable Session identity, host/backend/model, the real canonical cwd, ActorRef, start and end times, structured events, usage/cost, result, stderr/diagnostics, and evidence references - with the same Run and Action. The durable session-host registry SHALL hold host lifecycle facts only and SHALL NOT become a second completion truth; completion SHALL be written only to the canonical Record through the Facade.

#### Scenario: A real backend attributes the full fact set
- **WHEN** a real agent backend executes a granted frozen Action
- **THEN** Session identity, host/backend/model, real cwd, ActorRef, times, structured events, usage/cost, result, stderr/diagnostics, and evidence are correlated to the same Run and Action
- **AND** the canonical Record receives the completion

#### Scenario: The registry holds lifecycle facts only
- **WHEN** an Action executes and the session-host registry is inspected
- **THEN** it contains host lifecycle facts and request/result digests only
- **AND** it contains no completion truth, result body, or evidence duplicating the canonical Record

### Requirement: Acceptance uses real receipts with mutation-proven guards and no kernel-enforced proof

Acceptance for this capability SHALL include real run receipts on a real agent backend exercising the production executor path, and every guard this capability adds SHALL have a demonstrated failing counterpart (mutation receipt) proving it discriminates; an unmutated green guard is not acceptance evidence. Real-OS receipts SHALL prove: `in-tool` `execution-lost` on launcher death with the uncommitted frontier intact and the Run resumable; `hosted` best-effort on a real OS with the pre-start declaration visible and an honest `cancelled / emptiness-unproven` terminal; and Windows zero-orphan daemon-death teardown via the Job `KILL_ON_JOB_CLOSE` chain. Kernel-enforced exact-cancel or exact-scope-empty proofs SHALL NOT be acceptance criteria. Cross-target or deterministic-only evidence SHALL be labelled non-acceptance. Real Linux receipts SHALL execute in an isolated external run tree, never the repository checkout.

#### Scenario: Production-path receipt on a real backend
- **WHEN** a granted frozen Action is executed through the production executor path on a real agent backend
- **THEN** the receipts show the complete fact set attributed to the same Run and Action and the transactional completion

#### Scenario: execution-lost and resume are receipted
- **WHEN** a daemon or launcher death is injected during an in-flight Action
- **THEN** the real-OS receipt shows the typed `execution-lost` outcome and resumption from the committed frontier without reattach or identity revalidation

#### Scenario: Hosted best-effort honesty is receipted on a real OS
- **WHEN** a hosted session is started and cancelled on a real OS
- **THEN** the receipt shows the pre-start `exactCancel: false` / `scopeEmptyProof: false` declaration and the `cancelled / emptiness-unproven` terminal

#### Scenario: Guard discrimination is proven by mutation
- **WHEN** a guard for this capability is presented as green
- **THEN** a matching mutation receipt shows the guard failing against the defect it names

#### Scenario: Kernel-enforced proof is not demanded
- **WHEN** acceptance for this capability is evaluated
- **THEN** no criterion requires kernel-enforced exact recursive termination or a proven scope-empty receipt

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

