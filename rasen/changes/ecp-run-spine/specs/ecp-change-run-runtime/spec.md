## ADDED Requirements

### Requirement: One runtime interface owns reconciler Runs

Rasen SHALL provide one `ChangePipelineRuntime` interface with
`start`, `resume`, `complete`, `inspect`, and `control` operations. A
reconciler Run SHALL freeze one immutable prepared plan and SHALL expose only
typed action receipts and a read-only Change-run view; callers SHALL NOT
receive a writable plan payload or canonical Run Record.

#### Scenario: Grant-mode unblocked start admits the first root action

- **WHEN** a supported prepared root Pipeline is started for a Change with a
  stable launch request identity, `deliveryMode: grant`, and no workspace
  compatibility blocker
- **THEN** the runtime atomically creates its frozen plan and canonical Run
  Record before returning any Action
- **AND** the receipt contains the durably granted first root Action and a view
  of that same Record version
- **AND** defer mode or workspace-reservation waiting instead returns the same
  deterministic quiescent view with `actions: []`

#### Scenario: Ordinary caller cannot write runtime truth

- **WHEN** a CLI, management, Operations, or execution-host caller receives a Run receipt or view
- **THEN** it can submit only a typed completion or version-checked control through the runtime interface
- **AND** it receives neither a mutable Record nor an interface that replaces the frozen plan

### Requirement: Direct facade admission is portable and bounded

The runtime SHALL validate every direct request before store, lock, root, or
plan resolution. Change IDs SHALL use the portable Change grammar and bound;
Run/Action/Invocation/Effect/digest values SHALL be full exact identities;
project roots SHALL resolve to an existing canonical planning root according
to the requested operation; and all nested request values SHALL stay within
closed byte/depth/key/array/string/count limits. Unsafe or oversized requests
SHALL fail with typed `invalid_run_request` or `input_too_large` and perform no
I/O or mutation.

#### Scenario: Traversal is rejected before resolution

- **WHEN** a direct facade caller supplies an absolute, traversal,
  encoded-separator, option-like, NUL, or non-kebab Change ID
- **THEN** the request fails before filesystem, registry, lock, or root access

#### Scenario: Short or malformed identity is rejected

- **WHEN** completion/control/inspect receives a displayed digest prefix or a
  malformed Run, Action, Invocation, Effect, or receipt identity
- **THEN** admission fails without probing whether any matching file exists

#### Scenario: Oversized direct value is rejected

- **WHEN** launch inputs, result/evidence, or a control reason exceeds its
  closed structural budget
- **THEN** the runtime returns `input_too_large`
- **AND** no clone, canonical digest, lock, or Record mutation occurs

### Requirement: Launch is idempotent by stable request identity

Every `start` request SHALL carry a caller-stable `launchRequestId`. Its
idempotency namespace SHALL be the frozen PlanningSpaceId and ChangeInstanceId
together with that key. Within that scope, Rasen SHALL bind the key to the first accepted
canonical caller intent and frozen plan. A retry with the same key and caller
intent SHALL return the original Run without creating a second Run or
redelivering/advancing. Reused start SHALL return `actions: []`. An exact
subsequent resume SHALL classify admitted work under the frozen recovery
policy: safe work may return the same ActionId under dispatch serialization,
while ambiguous work SHALL commit uncertain-effect and return no grant.
Reusing the scoped key with different Pipeline, normalized inputs, or engine
intent SHALL fail with a typed conflict and SHALL create no Run. The same
textual key in another planning space or Change incarnation SHALL be independent.

#### Scenario: Lost launch response retries idempotently

- **WHEN** launch publishes a Run but the process crashes before returning and
  the caller retries the same launch request identity and intent
- **THEN** start returns the already published Run and current view with an
  explicit empty `actions` field
- **AND** it creates no second Run or Record and returns `actions: []`

#### Scenario: Reused start never blindly redelivers an external effect

- **WHEN** the first start response is lost after an ambiguous writer/external
  Action may have executed, or before that Action was ever delivered
- **THEN** the same-key retry returns no executable Action and exact resume
  conservatively commits uncertain-effect
- **AND** only trusted effect observation can prove executed/not_executed

#### Scenario: Same key with different intent conflicts

- **WHEN** a caller reuses a launch request identity in the same planning space
  and Change instance with different Pipeline, normalized inputs, or engine
  intent
- **THEN** start fails with `launch_request_conflict`
- **AND** the original Run and canonical Record remain unchanged

#### Scenario: Same textual key is independent across scopes

- **WHEN** two valid start requests use the same launch request identity for
  different planning spaces or Change instances
- **THEN** each request addresses its own deterministic Run identity
- **AND** neither launch conflicts with or requires a mutable global key index

#### Scenario: Source drift after accepted launch does not fork retry

- **WHEN** the current Pipeline source changes after the first launch publishes
  and the caller retries the same request identity and original caller intent
- **THEN** start returns the Run's originally frozen plan before consulting the
  changed source as replacement truth
- **AND** the view MAY report source drift but no new Run is created

#### Scenario: Archived source does not break launch retry

- **WHEN** the accepted Run's archive effect moved/deleted the active Change
  and a fresh process retries the same launch key and intent
- **THEN** start finds and validates the existing deterministic Run with
  `{ ensure: false }` before active-Change validation or preparation
- **AND** it returns that Run idempotently without minting identity or requiring
  the source directory

#### Scenario: Same-name recreation has a new launch scope

- **WHEN** a runtime archive binds the old instance to its archive alias and a
  new active Change with the same name is created
- **THEN** start proves and persists a different ChangeInstanceId and produces a
  distinct Run for the same textual launch key
- **AND** the old Run remains archived and cannot target the new directory

#### Scenario: Historical retry can be ambiguous

- **WHEN** no active source exists and two historical Change instances have an
  accepted Run for the same launch key
- **THEN** start fails `launch_instance_ambiguous`
- **AND** an exact RunId remains inspectable without guessing an instance

#### Scenario: Concurrent same-key starts converge within one Change

- **WHEN** two processes concurrently start the same planning space and Change
  instance with the same launch request identity and canonical caller intent
- **THEN** exactly one Run is published and both callers receive the same Run ID

#### Scenario: Concurrent different keys stay distinct

- **WHEN** two valid start requests use different launch request identities
- **THEN** each publishes its own deterministic Run ID and display ordinal
- **AND** neither request can overwrite the other's launch binding

### Requirement: Launch seals complete executable meaning

Before publishing a new Run, Rasen SHALL seal a digest-bound runtime execution
profile inside the opaque version-1 plan. The profile SHALL freeze the winning
path-independent SourceRevision, exact versioned capability/result/evidence/
recovery and Adapter artifact bindings, and all effective action-shaping stage
policy with provenance, including role, model, effort, runtime, sandbox, Gate,
session reuse, handoff/reuse thresholds/limits, and supported overrides.
Launch and Record SHALL bind the profile/capability/policy/source digests.
Resume and action admission SHALL use only the stored profile. Current source,
trusted tables, installed artifacts, and config SHALL be inputs only to a new
launch or drift observation.

#### Scenario: Legacy v1 capability receives a concrete frozen profile

- **WHEN** the supported v1 `bug-fix` plan contains only authored
  `version: legacy` capabilities
- **THEN** start binds each exact stage to a concrete versioned trusted
  capability, result/evidence contract, recovery policy, and Adapter artifact
- **AND** an empty phase-1 descriptor list is not treated as executable meaning

#### Scenario: Skill update cannot change stored action

- **WHEN** a skill prompt/table contract is updated after launch
- **THEN** resume emits the same plan-bound capability, contract, artifact, and
  profile digests as before
- **AND** it reports capability drift without selecting the newer content

#### Scenario: Exact old artifact is unavailable

- **WHEN** the current skill is disabled, removed, or replaced and the exact
  plan-bound artifact digest cannot be resolved
- **THEN** execution enters typed `capability_artifact_unavailable` suspension
- **AND** no same-named current artifact executes

#### Scenario: Effective config changes after launch

- **WHEN** model, effort, runtime, sandbox, Gate, session reuse, handoff/reuse
  limit, or supported override configuration changes after launch
- **THEN** resume retains the stored effective policy and reports policy drift

#### Scenario: Unsupported effective value rejects before launch

- **WHEN** effective stage metadata contains an override/value this preview
  cannot preserve faithfully
- **THEN** support analysis rejects start before a Run or action is created

#### Scenario: Profile tampering fails closed

- **WHEN** the stored capability, Adapter, policy, SourceRevision, or profile
  bytes no longer match the accepted digests
- **THEN** the Run fails `plan_integrity` without reconciling or emitting action

#### Scenario: Provenance and raw revision drift remain visible

- **WHEN** package/user/project shadowing changes the winning layer, or authored
  content changes while normalized semantics remain equal
- **THEN** SourceRevision drift reports provenance/content changed separately
  from semantic drift
- **AND** stored execution meaning remains unchanged

### Requirement: The canonical Run Record is the only runtime truth

Each reconciler Run SHALL have one durable, versioned canonical Run Record
whose committed transitions, action admissions, action results, evidence,
waits, controls, and terminal outcome completely determine runtime progress.
Markdown, timelines, management JSON, UI state, and legacy run files SHALL be
read-only projections or separate legacy-engine state and SHALL NOT advance a
reconciler Run.

#### Scenario: Projection crash cannot fabricate or lose completion

- **WHEN** an action result commits and the process crashes before CLI,
  management, or UI projection completes
- **THEN** resume and inspect read the committed result from the canonical Record
- **AND** the completed invocation is not admitted again

#### Scenario: Uncommitted result does not advance

- **WHEN** an Adapter returns a result but the process crashes before the
  validated Record commit
- **THEN** the canonical frontier remains at the previously admitted action
- **AND** no projection reports the action as complete

#### Scenario: Compatibility artifact cannot write back

- **WHEN** a user edits `auto-run.json`, a Markdown report, or a previously
  returned Operations view for a reconciler Run
- **THEN** the runtime ignores that edit when reconciling the stored plan and Record

### Requirement: Reconciliation and identities are deterministic

For the same immutable runtime plan and committed canonical Record, Rasen SHALL
produce the same ordered root frontier, actions, waits, and terminal outcome.
`PlanningSpaceId`, `RunId`, `NodeId`, `InvocationId`, `AttemptId`, `ActionId`,
`EffectId`, and `WaitId` SHALL derive only from frozen semantic identity and committed
ordinals; clocks, randomness, process IDs, absolute paths, and filesystem
presentation SHALL NOT affect them.
Each logical effect slot SHALL have its own stable EffectId, an Action SHALL
carry a stable-sorted effect descriptor array, and ActionId SHALL bind the
digest of that complete array. A single effect is the length-one case.
PlanningSpaceId SHALL derive from the persisted registry home name rather than
projectId or an absolute path, and RunId SHALL bind ChangeInstanceId.

#### Scenario: Same plan and Record replay identically

- **WHEN** reconciliation is repeated with byte-equivalent plan and Record values
- **THEN** both results contain identical ordered decisions and identities

#### Scenario: Platform paths do not change identity

- **WHEN** the same project/Change meaning and prepared plan are exercised
  through equivalent canonical roots on Windows and POSIX
- **THEN** their semantic node/action identity derivation is identical
- **AND** native separators appear only in filesystem diagnostics, not identity inputs

#### Scenario: Clone and worktree identity scopes are exact

- **WHEN** linked worktrees resolve one persisted registry home and independent
  clones share the same display projectId but have different registry homes
- **THEN** linked worktrees share PlanningSpaceId while the clones do not
- **AND** moving the registered root or relocating RASEN_HOME preserves the
  persisted PlanningSpaceId

#### Scenario: Terminal Run stays terminal

- **WHEN** reconciliation is called on a completed, escalated, failed, or cancelled Record
- **THEN** it returns the same terminal outcome and no action

#### Scenario: Multi-effect action identity is order independent

- **WHEN** the same ship Invocation/Attempt freezes workspace commit, push, and
  PR effect descriptors in different input insertion orders
- **THEN** sorted slots yield identical EffectIds, effect-set digest, and ActionId

### Requirement: Result completion is validated and idempotent by Action receipt

`complete` SHALL decode an exact closed discriminated union:
domain-action-result permits only succeeded/failed/blocked plus capability
result/evidence; effect-observation requires EffectId and only
succeeded/failed/not_executed plus strong observation evidence; and
infrastructure-observation fixes infrastructure_failed plus Adapter code,
retryability, artifact, and evidence. Cross-variant/extra fields SHALL be
rejected. It SHALL accept a result only for an admitted active Action after
checking the exact Run/Invocation/Action relationship, actor constraints,
capability-specific result schema, required evidence, and the canonical receipt
digest. Completion SHALL NOT require an expected Record version. Repeating the
same Action with byte-identical canonical receipt content SHALL be idempotent;
reusing the same completion slot
`(ActionId, kind, EffectId-or-domain-slot)` with conflicting content SHALL fail
closed without changing the Record. Different EffectId slots SHALL commit
independently in any valid order; the domain-result slot closes only after its
required effects reconcile.

#### Scenario: Identical completion retry succeeds

- **WHEN** an Adapter retries a completion for an already committed Action with
  the same receipt digest and canonical receipt bytes
- **THEN** the runtime returns idempotent success and the current view
- **AND** it does not create another completion transition or Record version

#### Scenario: Conflicting completion slot fails closed

- **WHEN** an already completed Action/kind/effect-or-domain slot is reused with
  a different digest or canonical body
- **THEN** completion fails with `receipt_conflict`
- **AND** the canonical Record remains byte-for-byte unchanged

#### Scenario: Distinct effect observations compose

- **WHEN** commit, push, and PR effect observations for one Action arrive in
  mixed order or retry independently
- **THEN** each distinct EffectId slot commits once, identical slot retries are
  idempotent, and the domain result closes only after required slots reconcile

#### Scenario: Independent completions compose

- **WHEN** two independent root actions were admitted from one Record version
  and complete in either order
- **THEN** each completion is serialized against the latest Record and commits exactly once
- **AND** neither completion is rejected merely because the other advanced the Record version

#### Scenario: Invalid result does not advance

- **WHEN** a completion has an unknown Action, mismatched Invocation, invalid
  actor, malformed result, missing evidence, or false receipt digest
- **THEN** the runtime returns the corresponding typed validation error and
  preserves the existing frontier

#### Scenario: Invalid completion variant matrix is rejected

- **WHEN** a receipt combines a domain result with effectId, omits effectId from
  an effect observation, uses not_executed as a domain status, attaches a result
  to infrastructure failure, or includes an unknown field
- **THEN** the codec rejects it before evidence lookup or Record mutation

#### Scenario: Receipt actions are grants not projections

- **WHEN** start creates, start reuses, completion advances, completion repeats
  idempotently, control conflicts, or resume examines an unclosed Action
- **THEN** `receipt.actions` contains only Actions newly admitted by that
  successful mutation or explicitly safe-redelivered by resume
- **AND** reused/idempotent/conflict/waiting/terminal responses carry no grants
  even if the view contains active ActionView diagnostics

#### Scenario: Downstream admission response loss is recovery classified

- **WHEN** a completion durably admits a downstream Action but its response is
  lost, whether that Action was executed or never delivered
- **THEN** retrying the completion is idempotent with `actions: []`
- **AND** exact resume redelivers safe work or suspends writer/external work for
  strong observation according to the frozen recovery policy

### Requirement: Action admission and executable delivery are distinct

Every runtime mutation SHALL receive trusted, non-wire deliveryMode. Grant
SHALL durably mark an Action granted before returning its executable payload.
Defer SHALL commit `admitted_undelivered`, return no executable Action, and
leave ActionView as diagnostics only. Trusted exact resume SHALL atomically
claim the stable undelivered frontier; only a previously granted Action is
subject to response-loss recovery.

#### Scenario: Deferred Gate continuation is claimed by CLI

- **WHEN** a Gate control in defer mode admits a downstream Action
- **THEN** the Record projects admitted_undelivered and receipt actions are empty
- **AND** the first trusted CLI resume commits granted and returns that Action

#### Scenario: Deferred browser response loss is not ambiguous execution

- **WHEN** a defer-mode response is lost after Action admission
- **THEN** the Action remains undelivered rather than uncertain
- **AND** exact trusted resume can perform its first grant safely

#### Scenario: Two first-delivery claimers serialize

- **WHEN** two trusted resumes race to claim the same undelivered frontier
- **THEN** only one commits/receives the first grants
- **AND** the other cannot first-claim them and must apply the granted-action
  safe-redelivery/uncertain recovery policy

### Requirement: Public Actions are closed executable contracts

RunAction SHALL be a closed change-run-action/1 union. Agent SHALL freeze
role/model/effort/runtime/sandbox/bounded input/session policy; Command SHALL
freeze exact artifact/executable digests, argv, env allowlist,
WorkspaceInstanceId/relative workdir, timeout and `shell:false`; Host SHALL
freeze one supported operation, effects, and bounded input. Cross-variant,
unknown, extra, unbounded, or unknown-major fields SHALL fail before dispatch.

#### Scenario: Command meaning ignores ambient process state

- **WHEN** current PATH/env/config or shell metacharacters differ after launch
- **THEN** dispatch uses exact executable/artifact, direct argv, frozen allowed
  env, and no shell, or fails artifact/workspace validation

#### Scenario: Action codec rejects variant confusion

- **WHEN** an Agent carries command fields, a Command requests shell execution
  or inherited env, a Host has unknown operation, or any variant has extra data
- **THEN** the action is rejected and no Adapter executes

### Requirement: Completion actors are closed and attestable

ActorRef SHALL be a closed change-run-actor/1 agent/command/host union with a
recomputed identityDigest. Agent SHALL bind role/provider/runtime,
principal/session identity digests, and Adapter artifact; Command SHALL bind
Adapter and executable artifacts; Host SHALL bind Adapter and principal
identity. A frozen trusted Adapter attestation SHALL prove the actor; caller
self-report has no authority. Every completion SHALL carry an exact
actorAttestation EvidenceRef validated against the frozen Adapter/Action.
Raw principals, tokens, paths, and environment
values SHALL be forbidden.

#### Scenario: Spoofed actor cannot complete

- **WHEN** a caller changes role/principal/session/artifact fields, crosses
  actor variants, supplies an unknown major, or lacks trusted attestation
- **THEN** completion fails before Record mutation

#### Scenario: Principal and session identity remain distinct

- **WHEN** later policy compares author and verifier identity
- **THEN** same-principal uses principalIdentityDigest and session separation
  uses sessionIdentityDigest without exposing either raw identity

### Requirement: Evidence is stored and verified as bound content

Completion SHALL reference closed path-free EvidenceRefs produced by a private
local-substitutable EvidenceStore/HostEvidenceWriter. Each immutable evidence
envelope digest SHALL cover content digest, media type, size, producer,
observation kind, and exact PlanningSpace/ChangeInstance/project/Run/Action/
Effect/tree/schema
binding. Before commit, EvidenceVerifier SHALL bounded-read actual stored
content without following links, recompute envelope/content digests, validate
the plan-frozen EvidenceContract and trusted attestation/query, and perform no
Record write. A trusted host identity SHALL NOT make its payload or refs
implicitly trustworthy.

#### Scenario: Missing or tampered evidence fails

- **WHEN** required evidence is absent, oversized, content-tampered, linked,
  replaced during verification, or bound to another tree/schema
- **THEN** completion fails closed and the Record remains unchanged

#### Scenario: Evidence cannot be relabeled

- **WHEN** identical content bytes are reused with another Action, Effect,
  tree, producer, or observation label
- **THEN** the envelope digest/attestation check fails
- **AND** the content cannot satisfy the new frozen EvidenceContract

#### Scenario: Non-execution needs strong observation

- **WHEN** a caller submits a generic log or self-reported binding as proof
  that an irreversible effect did not execute
- **THEN** `not_executed` is rejected
- **AND** only the frozen `effect-not-executed` trusted attestation/query can
  authorize another Attempt

#### Scenario: Evidence staging is crash-idempotent

- **WHEN** trusted-host staging crashes before or after atomic evidence publish
- **THEN** pre-publish content is invisible and post-publish retry returns the
  same EvidenceRef
- **AND** a staged but unreferenced orphan cannot advance a Run

#### Scenario: Evidence budgets and orphan cleanup are bounded

- **WHEN** uploads exceed per-request/per-Run file or byte budgets, use sparse
  or changing sources, or an orphan maintenance page races a new reference
- **THEN** staging fails typed before publish or cleanup retains the uncertain
  object
- **AND** cleanup scans at most its fixed page, runs only explicitly, and never
  runs during status, inspect, or list

### Requirement: External effects prove exact Run ownership

Every external effect contract SHALL freeze an operation key and provider-
specific ownership marker bound to EffectId. Commit/ref/trailer, push lease, PR
head/metadata, and archive manifest/receipt evidence SHALL prove that exact
ownership. Same-content artifacts with another or absent owner SHALL NOT be
credited; a provider that cannot atomically mark/query SHALL remain uncertain.

#### Scenario: Two Runs target the same remote resource

- **WHEN** two Runs target one branch, PR, or archive name with distinct
  EffectIds
- **THEN** distinct operation keys avoid collision or one receives typed
  `effect_owner_conflict`; neither observes the other's artifact as success

#### Scenario: Response loss queries the ownership marker

- **WHEN** provider response is lost after an effect request
- **THEN** the Adapter reports succeeded only if a trusted query proves the
  exact marker and operation key, otherwise it remains uncertain

#### Scenario: Identical preexisting artifact is not credited

- **WHEN** identical commit/content/PR/archive output preexists without the
  exact marker, or its marker is tampered
- **THEN** verification rejects attribution and does not advance the effect

### Requirement: Workspace revision guards code-changing actions

Start SHALL freeze a path-independent initial HEAD/tree/dirty-worktree
WorkspaceRevision. Every Action SHALL independently declare frozen
`workspace.access: none|read|write`, workspace resources, exact `effects[]`,
and expected before revision.
Workspace-writing completion SHALL prove real before/after revision and delta,
and the Record SHALL update current revision only after verification.
Unexpected workspace state SHALL enter a typed workspace-drift wait.

#### Scenario: External edit blocks a pending writer

- **WHEN** the workspace HEAD/tree/dirty digest changes while no
  workspace-writer Action is active
- **THEN** the runtime records workspace drift and emits no writer action

#### Scenario: Tree change with active writer is an uncertain effect

- **WHEN** apply, ship, or archive may have changed the workspace before its
  result committed
- **THEN** the runtime enters uncertain-effect bound to that original
  Action/Invocation/Effect rather than generic workspace drift
- **AND** only strong succeeded/failed/not_executed observation can close it

#### Scenario: Dirty submodule cannot hide behind unchanged HEAD

- **WHEN** a submodule gitlink/HEAD is unchanged but its index, tracked bytes,
  modes, symlinks, or untracked content is dirty
- **THEN** WorkspaceObserver fails `workspace_submodule_dirty` and admits no
  workspace Action
- **AND** nested, uninitialized, unreadable, racing, or over-budget submodules
  fail typed rather than being recursively or partially interpreted

#### Scenario: Writer completion has wrong tree evidence

- **WHEN** apply completion reports a false/stale before tree, after tree, or
  delta
- **THEN** completion fails closed and downstream verification is not admitted

#### Scenario: Non-executed writer proves no delta

- **WHEN** a workspace writer is resolved as `not_executed`
- **THEN** trusted evidence must prove the expected tree and delta are unchanged

#### Scenario: Parallel safety is conservative

- **WHEN** independent ready actions in any Changes/Runs sharing one physical
  WorkspaceInstanceId need workspace read access
- **THEN** they may run together only while no writer is admitted
- **AND** a writer is mutually exclusive with every workspace reader/writer,
  while workspace-access-none Actions may remain parallel
- **AND** a stale reader or writer completion is rejected

#### Scenario: Ready reader and writer choose one stable batch

- **WHEN** ready candidates sorted by NodeId include access-none plus readers
  and writers and no external reservation exists
- **THEN** access-none is admitted; if the first workspace candidate is writer
  only that writer is admitted, otherwise all readers are admitted
- **AND** unselected writers remain frontier without an invented completion

#### Scenario: Two ready writers choose the lower NodeId

- **WHEN** two writers are ready with no active workspace reservation
- **THEN** only the lower full NodeId writer is selected under the workspace
  lease and the other remains ready

#### Scenario: External reservation is rechecked under the lease

- **WHEN** another Run has a writer or readers, or changes reservation while
  this Run is selecting candidates
- **THEN** a writer blocks every new reader/writer; readers admit only readers;
  and the authoritative locked recheck decides
- **AND** blocked local intents enter a durable `workspace-reservation` wait
  containing only WorkspaceInstanceId and stable local candidate identities,
  never the other Run identity

#### Scenario: Workspace reservation wait is retryable and non-churning

- **WHEN** start is blocked before its first workspace admission
- **THEN** it may publish version zero waiting with `actions: []`
- **AND** resume/control while still blocked is idempotent without a new version

#### Scenario: Reservation release admits deterministically

- **WHEN** the external reservation releases and exact facade resume or a
  version+WaitId resume control rechecks the workspace-reservation wait
- **THEN** the wait closes and the stable compatible subset is admitted
- **AND** defer-mode browser control leaves those Actions undelivered for
  trusted CLI claim

#### Scenario: Cross-Run reservation survives crash

- **WHEN** one Run durably reserves workspace-write admission and crashes before
  completion while another Change Run on that workspace requests read/write
- **THEN** the bounded workspace reservation registry blocks the second
  admission and cross-validates the reservation with the first Record
- **AND** only typed completion/recovery releases it; time does not

#### Scenario: Workspace reservation protocol recovers every boundary

- **WHEN** a crash occurs after pending reservation, after admitted Record, after
  registry finalize, after closing Record, or before reservation deletion
- **THEN** recovery deletes pending-only state only when the exact predecessor
  version/digest remains and the expected next revision is absent, finalizes
  when the exact admitted Record exists, and deletes a close residue only after
  proving the exact closed Record
- **AND** another digest/version, an advanced head without the reservation, or
  ledger abnormality remains busy/corrupt rather than being cleaned
- **AND** any other mismatch remains busy/fails closed while a concurrent waiter
  admits no conflicting access

#### Scenario: One Record performs workspace self-handoff

- **WHEN** completing an upstream writer/read settles one downstream writer,
  one or more readers, or access-none Actions in the same candidate Record
- **THEN** one reservation-delta token retains old final entries, writes all
  compatible new pendings, commits old closure plus new admission, finalizes all
  new entries, then deletes the old entries
- **AND** the runtime returns no new Action until the whole delta is durable

#### Scenario: Self-handoff crashes remain conservative

- **WHEN** a crash occurs at any multi-new pending/finalize/old-delete boundary
- **THEN** exact predecessor recovery removes all new pendings and keeps old
  finals, while exact committed-Record recovery finalizes all new entries
  before idempotently removing any old entry
- **AND** a concurrent Run never sees false free access or a partial grant

#### Scenario: Distinct worktrees do not block each other

- **WHEN** equivalent Runs act in two physically distinct linked worktrees
- **THEN** their WorkspaceInstanceIds and admission leases differ
- **AND** each may admit a writer independently

#### Scenario: Mutation cannot cross a worktree scope

- **WHEN** a selected project root resolves another WorkspaceInstanceId or
  ChangeInstanceId than the exact stored Run
- **THEN** resume, complete, control, and host dispatch fail
  `workspace_scope_mismatch` with zero writes
- **AND** exact read-only inspect may show top-level `workspace.scope: other`
  with no controls or receipt Action grants

#### Scenario: Workspace drift cannot be resumed without evidence

- **WHEN** a Run is in a general workspace-drift wait
- **THEN** ordinary resume is absent
- **AND** only escalate, cancel, or a policy-allowed versioned
  `accept-workspace-revision` decision is offered

#### Scenario: Accepted revision is explicit and race safe

- **WHEN** a current-version accept decision carries strong evidence for the
  exact revision reobserved by WorkspaceObserver
- **THEN** the Record commits that revision and invalidates stale admissions
- **AND** a stale/concurrent decision writes nothing

### Requirement: Blocked and infrastructure outcomes have bounded recovery

A domain `blocked` receipt SHALL close the original Attempt and enter a durable
typed blocked wait with reason, evidence, and projected controls. A trusted
`infrastructure_failed` observation SHALL record Adapter/artifact, stable code,
retryability, and evidence without fabricating a domain result. An allowed
versioned retry SHALL create a new AttemptId/ActionId while retaining the same
EffectId for the same logical Invocation/effect slot. Confirmed
`not_executed`, blocked retry, and infrastructure retry SHALL all obey sealed
finite maxAttempts/maxActions/budget and SHALL fail/escalate durably at limit.

#### Scenario: Blocked resume creates a new bounded attempt

- **WHEN** an allowed current-version resume closes a domain-blocked wait below
  the sealed limit
- **THEN** the completed blocked Action is not reused
- **AND** exactly one next Attempt/Action with the same logical EffectId is
  admitted

#### Scenario: Partial effect is not domain blocked

- **WHEN** an effect is partial or its execution outcome is unknown
- **THEN** it uses uncertain-effect recovery rather than a blocked receipt

#### Scenario: Infrastructure failure is typed and idempotent

- **WHEN** exact artifact resolution, spawn, timeout, or sandbox setup fails
- **THEN** the trusted observation commits an infrastructure wait/terminal
  policy rather than domain failed/blocked
- **AND** an identical observation is idempotent while conflicting content is
  rejected

#### Scenario: Retry limit closes the Run

- **WHEN** any new-Attempt path reaches its sealed attempt/action/budget limit
- **THEN** the configured failed or escalated outcome commits
- **AND** no additional Action or revision loop is generated

### Requirement: Human controls are version checked and closed

Human and Operations controls SHALL be limited to resume, an allowed Gate or
wait decision, escalation, and cancellation. Every wait-scoped control SHALL
carry the exact active WaitId, and every control SHALL carry the Record version
the human observed, append a validated transition rather than patch a view, and
fail without mutation when that version/WaitId is stale or the command is not
currently allowed.

#### Scenario: Gate decision advances from the observed wait

- **WHEN** a Run waits at a Gate and a permitted decision is submitted against
  its exact WaitId and current Record version
- **THEN** the decision commits once and reconciliation returns the resulting
  frontier or terminal outcome

#### Scenario: Stale decision loses safely

- **WHEN** a control cites a Record version older than the current canonical version
- **THEN** the runtime returns `record_version_conflict` with the current view
- **AND** it does not overwrite the newer decision

#### Scenario: Wrong wait identity loses safely

- **WHEN** two Gates share a decisionId or a later occurrence repeats it and a
  control carries another active/closed WaitId
- **THEN** control fails `wait_identity_conflict` without a Record write

### Requirement: Independent branches may expose actions and waits together

Root DAG settling SHALL treat waits as branch-local. The canonical root-dag/1
projection SHALL expose stable-sorted `waits[]`, each with exact contextual
identity and WaitId, and MAY expose independent active Actions at the same time.
Top-level status SHALL be running while an action/ready branch can progress,
waiting only when all unfinished branches are wait-bound, and terminal only
when no Action or wait remains. Allowed controls SHALL be the exact sorted
composition of per-wait and Run-global controls.

#### Scenario: Two independent Gates are addressable

- **WHEN** two ready root branches each enter a Gate, including equal authored
  decision IDs at different occurrences
- **THEN** the view contains two distinct sorted WaitIds and controls target one
  without advancing the other

#### Scenario: Gate does not block independent read action

- **WHEN** one root branch waits at a Gate and another admits a workspace-read
  Action
- **THEN** the same committed view exposes that wait and Action and has running
  status

#### Scenario: Concurrent completions retain remaining waits

- **WHEN** two independent Actions complete from the same earlier view while
  another branch is wait-bound
- **THEN** both completions commit exactly once and the unrelated wait remains
  addressable with the same WaitId

#### Scenario: Cancellation is terminal

- **WHEN** an allowed cancel control commits against a non-terminal Run
- **THEN** the Run becomes terminal cancelled and emits no further action
- **AND** a later resume does not change it back to running

#### Scenario: Unsupported control cannot patch progress

- **WHEN** a caller submits an undeclared outcome, targets a non-waiting Gate,
  or attempts to mark an arbitrary node complete
- **THEN** control fails closed and the Record is unchanged

### Requirement: Ambiguous non-idempotent recovery suspends until typed observation

Every admitted action SHALL declare a trusted recovery policy. Resume MAY
re-present the same stable Action/effect-set identity when retry is safe. When an
uncommitted action may have performed a non-idempotent effect and its outcome
cannot be reconciled, Rasen SHALL durably suspend with the exact invocation and
effect reason instead of assuming success or executing a duplicate effect.
An uncertain-effect wait SHALL be closed only when the trusted Adapter submits
an evidence-valid completion proving the original action succeeded or failed,
or proving `not_executed` so a new deterministic attempt may be admitted.
Human resume SHALL NOT clear an uncertain-effect wait.
For an Action with multiple orthogonal effects, the wait and each observation
SHALL identify exact effect slots; confirmed effects SHALL remain committed and
SHALL NOT be repeated while unresolved/not-executed slots are reconciled.

#### Scenario: Safe action resumes with the same identity

- **WHEN** a retry-safe admitted action lacks a committed result after interruption
- **THEN** resume returns the same ActionId and EffectId rather than allocating a duplicate invocation

#### Scenario: Uncertain effect waits for resolution

- **WHEN** resume finds an active `suspend-if-ambiguous` action with no
  committed result
- **THEN** the Run enters a durable `uncertain-effect` wait identifying that
  action and effect
- **AND** no replacement effect is admitted automatically

#### Scenario: Confirmed result closes the original action

- **WHEN** a trusted Adapter reconciles external state and submits an
  evidence-valid succeeded or failed receipt for the original Action and Effect
- **THEN** the runtime commits that result to the original action and settles
  the resulting frontier exactly once

#### Scenario: Confirmed non-execution admits a new attempt

- **WHEN** a trusted Adapter proves with required evidence that the original
  effect was not executed
- **THEN** a `not_executed` receipt closes that ambiguous attempt without
  marking its domain work successful
- **AND** settling MAY admit one new AttemptId and ActionId for the same logical
  invocation according to policy

#### Scenario: Human resume cannot loop an uncertain wait

- **WHEN** Operations inspects an uncertain-effect wait
- **THEN** resume is absent from its allowed human controls
- **AND** only trusted effect observation, escalation, or cancellation can
  change that wait

#### Scenario: Ship effects reconcile independently

- **WHEN** ship crashes after local commit but before push, after push but
  before PR, or after PR opens but before its receipt returns
- **THEN** the wait identifies the exact unresolved commit/push/PR EffectIds
- **AND** confirmed effects are not repeated while each remaining slot is
  observed or retried according to frozen delivery policy

#### Scenario: Archive effects reconcile independently

- **WHEN** archive mutates repository state and moves the Change before its
  whole Action result commits
- **THEN** repository and filesystem-move effect slots are observed separately
- **AND** source disappearance does not erase the machine-home Run

### Requirement: Engine and frozen-plan ownership never mix

A Run SHALL freeze exactly one engine owner, `legacy` or `reconciler`, at
launch. Existing legacy Run files SHALL continue through their established
recovery behavior and SHALL NOT be imported into a canonical Record. A
reconciler Run SHALL always resume from its stored plan; current Definition or
capability catalog changes SHALL be reported as drift but SHALL NOT replace
that plan. Every code-controlled start, resume, completion, and control path
SHALL check both engine stores before advancing. If both engines are active,
the operation SHALL fail closed without a Record write, legacy progression, or
returned action. An unreadable canonical candidate SHALL also prevent fallback
to legacy because absence of an active canonical owner has not been proven.
Symmetrically, unreadable legacy run-state SHALL prevent canonical advancement
until engine ownership can be established.

#### Scenario: Active owner conflict blocks launch

- **WHEN** a Change already has an active Run owned by the other engine
- **THEN** a new start that would create mixed active ownership fails with an
  actionable engine-owner conflict
- **AND** neither Run state is modified

#### Scenario: Legacy recovery remains legacy

- **WHEN** a Change has only an existing valid legacy `auto-run.json`
- **THEN** its normal resume follows the existing legacy stage calculation and
  does not create a canonical reconciler Record

#### Scenario: Canonical owner prevents legacy fallback

- **WHEN** a Change has an active canonical Run and no active legacy Run
- **THEN** resume without an explicit Run selects the unique canonical owner
  or reports canonical ambiguity
- **AND** it never invokes legacy resume

#### Scenario: Legacy state appears after reconciler launch

- **WHEN** an external prompt or process writes an active `auto-run.json` after
  a canonical Run is already active
- **THEN** canonical resume, completion, and control and legacy resume all fail
  with `engine_owner_conflict`
- **AND** neither owner advances or returns a new action until the conflict is
  resolved

#### Scenario: Invalid canonical presence blocks legacy dispatch

- **WHEN** canonical Run state exists but cannot be validated while legacy
  state is also available
- **THEN** resume reports the canonical integrity error
- **AND** it does not treat the unreadable canonical owner as absent or fall
  through to legacy progression

#### Scenario: Invalid legacy presence blocks canonical advancement

- **WHEN** legacy run-state is present but cannot be validated while a
  canonical mutation is requested
- **THEN** start, resume, completion, or control reports the legacy run-state
  integrity error
- **AND** the canonical Run does not write or emit a new action

#### Scenario: Legacy ownership is incarnation-bound

- **WHEN** legacy state is found under a proven active/archive alias, or an old
  machine-home legacy artifact cannot be bound after same-name recreation
- **THEN** the guard compares the proven ChangeInstanceId or reports
  `legacy_owner_unknown`
- **AND** neither engine targets or claims another Change incarnation

#### Scenario: Registered first legacy and canonical starts converge

- **WHEN** a registered project has no Change association and legacy resume
  races the first canonical start
- **THEN** both unresolved paths serialize under the stable association lease,
  derive the same physical ChangeInstanceId, and bridge to the same engine lease
- **AND** legacy may avoid publishing association state but holds engine
  ownership through its output

#### Scenario: Definition drift is diagnostic only

- **WHEN** the current winning Pipeline source differs from the source digest
  frozen at reconciler launch
- **THEN** resume uses the stored plan and reports definition drift in its view
- **AND** current source nodes do not enter the Run

#### Scenario: Capability drift is diagnostic only

- **WHEN** an installed capability is changed, disabled, or removed after launch
- **THEN** the view reports capability drift or unavailability while the
  Reconciler continues to interpret the verified frozen descriptor

#### Scenario: Stored plan mismatch fails closed

- **WHEN** the stored plan is missing, corrupt, or does not match the Record's plan digest
- **THEN** resume fails with a plan-integrity error and emits no action

### Requirement: Durable commits recover at exact atomic boundaries

Run creation and each Record-version commit SHALL publish atomically on
Windows, macOS, and Linux. A crash before publication SHALL leave the previous
canonical state visible; a crash after publication SHALL leave the new state
visible and idempotently resumable. Exact store-generated temporary or staging
entries from an interrupted pre-publication write MAY be ignored. Published
final-name revisions SHALL form one complete sequence from version zero through
the highest version with no gap, duplicate/variant/abnormal name, schema or
digest error, predecessor mismatch, or immutable-identity change. The highest
revision SHALL be canonical only when that entire sequence validates. Any
published-ledger violation SHALL fail the Run closed with a typed
`run_store_corrupt` or `plan_integrity` error; Rasen SHALL NOT fall back to an
earlier revision, reconcile, or emit an action.

#### Scenario: Crash before Run publication

- **WHEN** launch crashes after staging plan and initial Record but before atomic publication
- **THEN** list and inspect find no new Run
- **AND** retry with the same launch request identity can publish the one deterministic Run

#### Scenario: Crash after Run publication

- **WHEN** launch crashes after publication but before returning its receipt
- **THEN** status and resume discover one valid Run with its first admissions
- **AND** same-key retry returns that Run without publishing a second copy or
  incrementing its Record version

#### Scenario: Crash before Record publication

- **WHEN** completion crashes after writing a temporary next Record but before publication
- **THEN** the prior Record version remains canonical and the temporary file is ignored

#### Scenario: Crash after Record publication

- **WHEN** completion crashes after the new Record version publishes but before
  its response is projected
- **THEN** the new version is canonical on every supported platform
- **AND** retrying the same receipt returns idempotent success

#### Scenario: Corrupt published revision blocks the entire Run

- **WHEN** any final-name revision is corrupt, its predecessor chain is
  invalid, a version is missing, or a later final revision appears beyond a gap
- **THEN** inspect, resume, completion, and control fail with the typed
  corruption or plan-integrity error
- **AND** the runtime does not select an earlier valid revision, reconcile, or
  emit an action

#### Scenario: Abnormal revision namespace blocks the entire Run

- **WHEN** `records/` contains a duplicate numeric revision encoded with
  another case/width/name, an over-width final revision, or another unexpected
  non-temporary entry
- **THEN** the Run fails closed as corrupt
- **AND** only entries matching the store's exact generated temporary/staging
  naming scheme are ignored

### Requirement: Run storage is bounded and rejects linked canonical paths

RunStore SHALL stat and bounded-read every plan, launch, Record, and evidence
file before parsing; validate closed structural/count/safe-integer limits
before cloning/canonicalization; and reject pre-existing symlink, junction,
reparse, non-regular, non-directory, or containment-breaking canonical path
components. It SHALL recheck physical identity and containment around open and
publish and fail an observed replacement race as `unsafe_path` or
`run_store_corrupt`. Per-Run ledger/evidence cumulative bytes and counts SHALL
be bounded. List SHALL stable-sort, page by opaque cursor, cap candidate
directories/physical bytes/work per request, and isolate an invalid Run summary
rather than fully scan unbounded state.

#### Scenario: Oversized Record cannot exhaust a read surface

- **WHEN** a final Record, plan, launch, evidence, revision set, transition,
  action, or nested JSON structure exceeds its v1 budget
- **THEN** load marks the whole Run `run_store_corrupt` without parsing or
  canonicalizing beyond the admitted limit
- **AND** Operations can continue listing unrelated healthy Runs

#### Scenario: Aggregate legal-size inputs remain bounded

- **WHEN** a Run contains many individually valid Records/evidence whose
  cumulative logical size exceeds the sealed limit, including sparse files
- **THEN** it is isolated as `run_store_too_large` before unbounded reads

#### Scenario: Many Runs use stable cursor pagination

- **WHEN** candidate Runs exceed the list page directory, byte, or work budget
- **THEN** the response returns a stable opaque cursor and bounded summaries
- **AND** a corrupt large Run does not prevent healthy Runs on later pages

#### Scenario: Pre-existing link is rejected before target use

- **WHEN** change-runs, Run, plan, launch, records, evidence, or a final file is
  a POSIX symlink or Windows junction/reparse target
- **THEN** the operation fails typed before using that target as canonical data

#### Scenario: Observed replacement race fails closed

- **WHEN** physical identity or containment differs after open/publish recheck
- **THEN** the bytes are discarded and no runtime transition is committed

### Requirement: Coordination locks are ownership safe and registration stable

Engine/workspace/create/commit coordination SHALL use a change-run-specific global-data
lock protocol independent of project registration. A closed owner file SHALL
be fsynced in a unique staging name and claimed by atomic same-volume
hard-link-to-absent canonical name; unsupported filesystems SHALL return
`lock_unavailable` rather than downgrade. Locks SHALL carry a token-bound
Unix-domain-socket/Windows-named-pipe challenge endpoint, never steal a live or
unknown owner by mtime/PID, recover only after stable double-probed refusal
with complete unchanged token/endpoint metadata, and compare
token/listener/file identity on release
and before state publication.
Invalid/incomplete/mismatched canonical metadata or unprovable companion
topology SHALL be unknown-busy `coordination_lock_corrupt`, never automatically
stolen; repair requires an explicit offline/operator procedure.
Coordination facts SHALL NOT enter Run identity or Record.
The physically anchored global coordination path SHALL reject symlink,
junction, reparse, parent replacement, cross-device, and non-regular anomalies.

#### Scenario: Crash at lock publish boundaries recovers

- **WHEN** a process crashes before owner fsync, before hard-link claim, or
  after claim before return
- **THEN** strict staging orphans are non-owners and a published canonical lock
  has complete recoverable owner metadata

#### Scenario: Concurrent claims have one owner

- **WHEN** two processes hard-link valid staging owner files to the same
  canonical lock
- **THEN** exactly one succeeds and the other observes the holder

#### Scenario: Link-before-unlink ownership is valid

- **WHEN** a live owner or crash residual has canonical nlink two with exactly
  one strict same-inode/same-token staging companion
- **THEN** a contender challenges it as valid ownership and does not classify
  it corrupt or steal it
- **AND** nlink above two, extra/unknown companion, or identity mismatch remains
  busy/corrupt until ownership-safe cleanup

#### Scenario: Long live holder is not stolen

- **WHEN** a valid owner remains live beyond any former stale threshold
- **THEN** another process waits/fails busy and never enters the critical section

#### Scenario: Damaged live-owner metadata is never stolen

- **WHEN** a live holder has entered its critical section and canonical
  metadata or companion topology is later corrupted
- **THEN** a contender reports `coordination_lock_corrupt`/unknown-busy and
  cannot acquire or quarantine the lock

#### Scenario: Dead owner and ABA release are safe

- **WHEN** the token challenge gives stable refusal twice with unchanged lock
  identity and a new owner later acquires
- **THEN** dead-owner quarantine/recovery succeeds
- **AND** release with the old token/identity cannot unlink the new canonical lock

#### Scenario: Registration bridge converges on one stable key

- **WHEN** unregistered legacy resume and canonical start race across linked
  worktrees while start mints project identity
- **THEN** both meet under `resolveRegistrationRoot` bootstrap coordination and
  reread registration before bridging to the stable PlanningSpaceId and
  ChangeInstanceId lock
- **AND** project relocation/aliases do not create a second active engine lock

#### Scenario: First association and archive update cannot lose revisions

- **WHEN** registered concurrent first starts, path aliases, or old-instance
  archive completion race same-name recreation
- **THEN** unresolved/mutating paths serialize under
  `(PlanningSpaceId, changeId)` association before bridging to exact instance
  engine ownership
- **AND** crash retry rereads the immutable association ledger without a lost
  bind/archive revision

#### Scenario: Paused or lost challenge listener fails safe

- **WHEN** a live holder's event loop is paused, the probe times out, permissions
  deny connection, or the listener closes while work is in progress
- **THEN** a contender treats timeout/denial as busy and the owner with a lost
  listener aborts before publish

#### Scenario: PID reuse and stale socket do not determine ownership

- **WHEN** a PID is reused or a crashed Unix owner leaves a stale socket
- **THEN** only the token challenge and stable refusal protocol decide recovery
- **AND** stale socket cleanup happens only after the canonical owner is proven dead

#### Scenario: Unsafe global lock path fails closed

- **WHEN** a coordination parent is a symlink/junction/reparse target, changes
  physical identity, or hard-link claim would cross devices
- **THEN** acquisition returns `lock_unavailable` and enters no critical section

#### Scenario: Read-only observation creates nothing

- **WHEN** status, inspect, list, or candidate discovery runs
- **THEN** it creates no lock/global directory, registry identity, machine home,
  work directory, or repository file

### Requirement: Exact Runs survive source archive and remain discoverable

Only the new-Run branch of start SHALL require an active Change directory.
Existing exact Run operations SHALL resolve frozen PlanningSpaceId,
ChangeInstanceId, projectId/changeId and the registered machine-home RunStore
even after source archive/move/delete.
Operations list SHALL use a read-only union of active Changes and existing
machine-home change-run directories rather than a second writable index, then
default-filter summaries to the selected root's WorkspaceInstanceId.

#### Scenario: Archive can complete after moving the Change

- **WHEN** archive moves/deletes the source Change and its host then completes
  the exact archive Action in a fresh process
- **THEN** completion uses machine-home Run state/evidence and reaches the
  downstream or terminal Record

#### Scenario: Archive-in-flight Run stays visible

- **WHEN** source is archived while the Action is incomplete or uncertain
- **THEN** list/detail retain the Run with `sourceState: archived|missing`
- **AND** read-only discovery does not mint registry state

#### Scenario: Terminal exact detail survives source deletion

- **WHEN** a completed Run's source Change no longer exists
- **THEN** CLI status and Operations exact detail still return its canonical
  versioned view with drift unavailable

#### Scenario: Old Run cannot target same-name recreation

- **WHEN** an archived or missing instance is followed by a new active
  same-name Change instance
- **THEN** old Run resume/control that would target source fails
  `change_instance_inactive` and sourceState stays archived/missing
- **AND** already-admitted archive completion/recovery may close only its
  original exact effects

#### Scenario: Manual move is never guessed

- **WHEN** the source directory changes location without a runtime archive
  receipt proving physical identity and alias migration
- **THEN** the old instance is missing and no new directory is adopted

#### Scenario: Linked worktree lists remain branch-local

- **WHEN** two linked worktrees in one PlanningSpace run the same Change name
  and launch key
- **THEN** their distinct WorkspaceInstanceIds/ChangeInstanceIds produce
  distinct Runs and each default list shows only its own workspace
- **AND** an exact cross-worktree detail is read-only and marked other

### Requirement: The simple bug-fix route is the only dogfood path in this slice

The reconciler preview SHALL execute the supported root-DAG, Gate, atomic
action, suspend, and finish semantics needed by the simple `bug-fix` Pipeline.
Its adaptive verification result SHALL carry an explicit
`simple | complex` route. `simple` MAY advance to ship/archive; `complex`
SHALL suspend for the later ReviewCycle capability or explicitly escalate and
SHALL never fall through to legacy progression.

#### Scenario: Simple bug fix completes through one owner

- **WHEN** the built-in `bug-fix` Pipeline starts with reconciler ownership,
  each Gate is approved, and the typed verification result selects `simple`
- **THEN** propose, apply, verify, ship, and archive progress from the same
  frozen plan and canonical Record
- **AND** the root reaches its explicit success finish

#### Scenario: Complex adaptive result blocks ship

- **WHEN** the verification completion selects `complex`
- **THEN** the Run records a `review_cycle_capability_unavailable` wait
- **AND** ship and archive are absent from the ready frontier
- **AND** resume does not invoke the legacy review playbook

#### Scenario: Later node kinds are refused before launch

- **WHEN** a candidate plan requires Composite, BoundedLoop, ReviewCycle,
  GoalLoop, FanOut, or Join semantics
- **THEN** this runtime slice rejects it as unsupported without creating a partial Run
