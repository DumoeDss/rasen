## Context

ECP currently commits one frozen `RunAction`, executes one backend turn, and converts the terminal result into a canonical completion. BoundedLoop lifecycle strategy is already a direct ECP-dispatched Action, but it is triggered only at a loop boundary, runs in a separate invocation, and its result is not delivered into the exact implementer Session. The hosted `SessionHost` already supplies the stable Rasen Session id needed to wake the source for another bounded turn in the same canonical cwd.

The review-cap B2 finding adds a distinct safety requirement for the Teacher turn. Production management construction currently shares one `createHostedProcessScope()` between `createSessionHost()` and `createClaudeSessionBackend()`. On Windows, Linux, and macOS that constructor selects a declared best-effort scope whose successful retirement may end with `emptiness: 'unproven'`. A settled Teacher result can therefore coexist with a delayed descendant that writes after an already-visited manifest entry. Post-read and post-enumeration checks are necessary, but no finite scan can replace exact recursive retirement of the writer authority before the final observation.

The repository already contains the stronger provider-backed process-authority Seam: a closed manifest-bound registry, exact provider selection, opaque durable references, `prepare -> publish -> activate`, provider publication ledgers and phase journals, a coordinator that authenticates `ExactScopeEmptyReceipt`, Windows/Linux provider implementations, and `createProviderBackedProcessScope`. Those mechanisms are not assembled into the production management SessionHost, the Windows production runtime bridge is not yet frame preserving, and no durable Teacher-attempt journal currently binds canonical Action/Session/request phases to the provider authority across restart.

The consultation path crosses the worker-result contract, frozen execution profile, executor, canonical Record/reducer, reconciler/facade, EvidenceStore, SessionHost, and workspace reservation registry. Full workflow templates, built-in capability registration, Definition/Canvas authoring, and UI rendering belong to the dependent portfolio children; this change defines the frozen contracts those children consume.

Dependencies by seam:

- `SessionHost` is local-substitutable: production uses the resident hosted process and tests use the existing deterministic host adapter.
- `EvidenceStore`, `RunStore`, and workspace reservations are local-substitutable and remain injected into the runtime module.
- The exact process provider is remote-but-owned across a local process/native-helper Seam: production uses authenticated Windows/Linux Adapters and tests use a deterministic Adapter against the same provider-neutral conformance contract.
- The agent provider runtime is a true external dependency behind the existing trusted execution adapter and SessionHost backend seams.
- Consultation lifecycle reduction, identity derivation, strict decoding, budgeting, and projection are in-process computation.

## Goals / Non-Goals

**Goals:**

- Let an opted-in implementer request advice while its Action is in progress, without LEAD mediation.
- Directly admit a frozen, read-only Teacher Action and deliver its actual typed advice to the exact originating hosted Session.
- Retire the exact recursive Teacher process authority before final workspace observation, advice validation, or canonical settlement, closing the delayed-writer window without widening ordinary hosted claims.
- Make every question, attempt, advice result, delivery, actor, model/runtime, and failure durable, correlated, bounded, idempotent, and restart-safe.
- Keep consultation accounting distinct from BoundedLoop strategy accounting while still respecting global Run limits.
- Preserve byte-for-byte behavior and digests when no consultation binding is present.
- Expose a small runtime interface and projection that the workflow/registry and Canvas children can bind and render.

**Non-Goals:**

- Defining the Teacher prompt, capability package, built-in registry identity, or model defaults.
- Adding Definition-v2 or Canvas authoring controls and visual sidecar rendering.
- Replacing BoundedLoop lifecycle strategy or routing lifecycle strategy through consultation state.
- Supporting nested consultation from a Teacher, arbitrary agent-to-agent delegation, or a general subagent graph.
- Simulating continuation by starting a new implementer Session. The first version requires an exact continuable hosted Session and fails closed when that contract is unavailable.
- Upgrading ordinary or source hosted Sessions from their declared best-effort process authority. Exact recursive retirement is a separate Teacher-only lane.
- Providing a macOS exact process-authority Adapter in this change. macOS Teacher execution is typed unavailable before activation; there is no best-effort fallback.
- Replacing or weakening the existing provider registry, coordinator, opaque reference, publication ledger, or exact-receipt contracts.
- Claiming replay after an ambiguous sent turn. Existing `turn-outcome-unknown` safety remains authoritative.

## Decisions

### 1. Use a canonical two-actor sidecar lifecycle, not a nested executor call

The canonical lifecycle Module is `consultation-lifecycle`. Its Interface is internal to ECP: commit an attested consultation request for an active Action and continue that exact Action from a canonical continuation grant. Its implementation hides identity derivation, state reduction, budgets, Teacher admission, advice correlation, workspace sponsorship, replay, and projection. Common execution callers do not cross this internal Seam directly; Decision 10 defines their single deep Interface after the review-cap rework.

The canonical lifecycle is:

```text
source Action turn settles as CONSULT
  -> consultation requested; source Action paused, not completed
  -> ECP admits one read-only Teacher Action directly
  -> Teacher advice completes and is correlated
  -> ECP grants one continuation of the source Action
  -> exact source Session wakes with the structured advice
  -> source returns a final result or requests another bounded consultation
```

Alternative A was to let the executor call a Teacher internally and return only the final implementer result. That is a shallow shortcut: lifecycle truth, retries, attribution, and restart decisions would be hidden outside the canonical Run. Alternative B was to finish the source Action as blocked and start a recovery Action. That loses exact in-progress Action/session semantics and collides with BoundedLoop blocker/strategy behavior. The selected sidecar lifecycle keeps the source Action canonical and non-terminal while making the Teacher a separately attributable Action.

### 2. Freeze one minimal consultation binding per eligible source profile path

`RuntimeExecutionProfile` gains an optional, undefined-dropped `consultations` collection. Each binding contains only:

- the eligible source profile path;
- the exact Teacher capability/policy profile path;
- `maxConsultationsPerInvocation` and `maxTeacherAttemptsPerConsultation`;
- bounded question/advice byte and collection limits.

The Teacher capability and effective stage remain ordinary entries in the frozen profile, so model, runtime, adapter artifact, result/evidence contracts, workspace authority, sandbox, and policy provenance use existing Action construction rather than a second profile system. Profile opening validates unique source mappings, the presence of both profile paths, an agent Teacher capability, `sandbox: read-only`, workspace access of `none` or `read`, and zero effects. A binding that violates any invariant fails before its source Action starts.

The dependent registry/Canvas change will author and resolve this optional collection. This change owns the strict profile shape and runtime validation only. A caller can neither choose a Teacher capability nor alter limits when emitting `CONSULT`.

Alternative A was to accept a capability id inside the worker's question. That would rebuild execution authority from untrusted model output. Alternative B was to add a graph node and ordinary connection for every advice turn. A static graph cannot represent a bounded, implementer-initiated mid-Action occurrence without leaking lifecycle mechanics into every pipeline.

### 3. Add a dedicated consultable worker contract without weakening ordinary leaf returns

`worker-contracts.ts` gains a separate `consultable-leaf` schema/parser. Existing `leaf` remains exactly `DONE | HANDOFF`; it does not silently gain a third outcome. The new strict `CONSULT` body carries a problem summary, one concrete question, bounded attempted approaches, bounded constraints, and optional evidence pointers. Runtime-owned identity, budgets, model/runtime, capability, and Session facts are never accepted from the worker.

Teacher input and output use versioned contracts owned by the consultation runtime:

- `teacher-consultation/invocation/1` binds the derived consultation id, source Run/Action/Invocation/attempt, consultation ordinal, bounded question, and allowed advice decisions.
- `teacher-consultation/advice/1` binds the same consultation id and Teacher attempt and returns exactly one decision (`plan | correction | stop`), rationale, bounded ordered steps, cautions, and evidence notes.
- `teacher-consultation/resume/1` binds the committed advice digest and carries the complete validated advice to the source continuation.
- `teacher-consultation/unavailable/1` is the bounded runtime feedback delivered to the same source Session when the consultation or Teacher-attempt budget is exhausted before advice is available.

`stop` remains advice, not Run authority: it is delivered to the implementer, which must still return its own truthful terminal/blocked result. The Teacher cannot claim that code changed or that a gate passed.

### 4. Persist consultation state in the canonical Record and attest both sides

`change-run-record/1` gains an optional, undefined-dropped consultation section. Each entry is keyed by a deterministic `ConsultationId` derived from `(runId, sourceActionId, consultationOrdinal)` and records:

- exact source Action, Invocation, Attempt, node occurrence, actor, model/runtime, and stable Rasen Session id;
- normalized bounded question plus its signed EvidenceRef;
- frozen binding identity and independent budget counters;
- deterministic Teacher Action/attempt identities and correlated advice result/evidence;
- continuation request identity and delivery state;
- typed terminal or ambiguity reason.

New transitions cover request, Teacher admission linkage, advice commitment, continuation grant, continuation settlement, unavailability, and ambiguity. The reducer accepts an exact duplicate as an idempotent no-op and rejects a different payload under the same identity. The Record stores the bounded normalized bodies because Action construction and continuation must remain pure/deterministic without an EvidenceStore read inside the reconciler; the EvidenceStore retains the exact attested bytes and anti-tamper binding. SessionHost registry records only request/result digests and lifecycle, never question or advice bodies.

The source intermediate step is submitted through an attested consultation envelope bound to the Action's frozen completion authority. Teacher advice is an ordinary trusted domain Action result, additionally decoded against `teacher-consultation/advice/1` before commit. This gives both the question and answer trustworthy Action attribution without treating the SessionHost as canonical authority.

### 5. Continue the same Action and hosted Session through an explicit continuation grant

The source `CommittedAction` gains a consultation-paused execution state while remaining non-terminal. A Teacher completion does not invent a replacement implementer Action. Instead, the reconciler projects one deterministic `AgentContinuationGrant` containing the source Action identity, stable Session id, continuation request id, committed advice contract/digest/body, and expected Record version. `ChangeRunReceipt` carries continuation grants in an optional collection beside newly granted Actions.

The executor validates the grant against the current Record and original frozen Action, resolves the same `(invocation, role, workspace, backend)` reuse authority, and wakes the exact stable Session id. The continuation input is serialized by the runtime from the committed advice; a caller cannot substitute text. The request id is derived from the consultation id and advice digest, so an acknowledgement-loss retry obtains the SessionHost's settled replay instead of sending the advice twice.

The existing Session reuse policy is wired into real dispatch for this path rather than widened: Teacher uses its own invocation/session; source continuation stays inside the original invocation authority. The stable Rasen Session id may survive a daemon generation replacement while backend Session identity remains exact per the SessionHost contract.

Alternative A was a new implementer Session seeded with question/advice. That cannot prove equivalence to the in-progress context and is rejected for the first version. Alternative B was to mutate `RunAction.agent.input`; that would violate frozen Action integrity. The continuation grant is additive input authority bound by the canonical Record, not mutation of the frozen Action.

### 6. Declare continuability before work and preserve ambiguous-turn safety

The executor capability matrix gains a `continuableTurns` fact. In 0.2.0 `hosted` declares true and `in-tool` declares false. This fact authorizes stable source Session continuation only; it is not Teacher process authority. An opt-in consultation binding requires a selected, available continuable backend before the eligible source Action begins; an explicit or default in-tool route returns typed `consultation-continuation-unavailable` and never starts a substitute worker.

Teacher Action construction separately derives `exactRecursiveRetirement: true` from canonical consultation authority. The driver cannot submit or clear it. Before Teacher activation, production must resolve an available exact process provider; the generic hosted best-effort availability cell is insufficient and cannot be used as fallback.

The hosted backend seam preserves the settled result body, result digest, replay flag, stable Session id, and request state needed by the trusted step parser. Fresh and continuation turns use separate deterministic request identities. If restart finds an idle source Session, it wakes that exact Session with the next committed continuation. If the host has a settled result that the Run has not committed, the same request id replays and the Facade commits it once. If a continuation was sent but did not settle, ECP records a durable `continuation-outcome-unknown` wait and does not resend or claim that advice was consumed.

### 7. Give the Teacher a sponsored read view while retaining source writer exclusion

An implementer may have uncommitted workspace edits when it asks a question. Its writer reservation therefore remains held while the source Session is paused. A Teacher with `workspace.access: read` receives a narrowly scoped sponsored read reservation bound to the exact source Run/Action/consultation. The reservation registry admits it only while that source Action holds the writer reservation and is canonically paused for the same consultation. All unrelated readers/writers remain excluded. A Teacher with `workspace.access: none` needs no reservation.

When advice settles, the sponsored read is released and the source writer reservation remains in force for continuation. Cancel, failure, or terminal close releases both through the existing reservation-delta recovery discipline. This is not a general reader-bypasses-writer rule.

Sandbox and Action authority are defense in depth: the Teacher must be `read-only`, must carry no workspace/external effects, and may receive only `none | read` workspace access. Any write-capable binding, effectful Teacher capability, workspace mutation observation, or mismatched sponsor fails closed without advice commitment.

### 8. Bound consultation separately and resume the source on bounded unavailability

For each source Invocation, `maxConsultationsPerInvocation` limits questions. For each consultation, `maxTeacherAttemptsPerConsultation` limits Teacher infrastructure/workload retries. Both are frozen and displayed as their own used/max counters; Teacher Actions also consume the existing global Action/Attempt budgets. Bounded question/advice schemas and EvidenceStore limits protect Record and prompt size.

Consultation counters never increment BoundedLoop `strategy.attempts`, and strategy attempts never consume consultation counters. If a consultation-specific limit is reached, ECP records typed unavailability and grants a continuation carrying `teacher-consultation/unavailable/1`; it does not fabricate Teacher advice or immediately stop the Run. The source implementer can finish, report blocked, or take another path under its existing workflow contract. Exhaustion of a global Run limit keeps the existing global terminal behavior.

### 9. Project one versioned consultation view and keep downstream integration additive

`ChangeRunView` gains a versioned `consultation` section with source/Teacher identities, state, decision, used/max counters, evidence digests, continuation status, and typed failure reason. It excludes backend-private runtime refs and does not expose unbounded Session diagnostics. CLI/Management API/Canvas continue consuming the same canonical projection; the dependent Canvas child owns rendering and controls.

Optional fields are undefined-dropped in execution profiles, Records, receipts, and views. A pipeline without a binding produces no consultation state, no continuation grant, no changed profile digest, and no changed scheduling behavior. BoundedLoop strategy paths and `bounded-loop/strategy-result/1` remain unchanged; a source Action inside a bounded loop may consult, but only its eventual final result feeds loop progress/blocker/strategy logic.

### 10. Design it twice: choose a domain-specific deep Module over caller choreography or a global host upgrade

The review-cap design space was compared using Depth, Leverage, Locality, and Seam placement.

**Option A — caller-orchestrated authority primitives.** Expose preflight, baseline capture, provider selection, prepare, publish, execute, receipt verification, retire, observe, validate, and settle as separate calls. This is flexible but shallow: every management/CLI/Canvas caller must learn the ordering and failure matrix, tests can accidentally reorder it, and cwd/backend/limits/provider/reference/receipt values leak across the external Seam. Deleting the wrapper would barely change caller complexity, so it fails the deletion test and has poor Locality.

**Option B — globally replace hosted ProcessScope with exact provider authority.** Route every ordinary, source, and Teacher Session through a provider-backed exact ProcessScope. This reuses one SessionHost Interface and centralizes process truth, but it changes established ordinary best-effort availability and cancellation semantics, makes macOS generic hosted work unavailable, and couples consultation delivery to a platform migration much larger than B2. Its external Interface is small, but its migration blast radius spends that Depth where most callers do not need it.

**Option C — chosen hybrid: a Teacher-specific deep Module over existing internal provider Seams.** Common callers get one domain operation, while the implementation composes canonical Run/Session resolution with the existing manifest-bound provider registry, coordinator, publication ledger, durable journal, provider-backed ProcessScope, SessionHost, workspace observer, and canonical Facade. Ordinary/source Sessions retain the best-effort Adapter. This combines Option A's narrow domain entry with Option B's reuse of one exact authority implementation, without exposing internal Seams or applying exact availability policy globally.

The hybrid wins because its Depth is high: one locator exercises the full safe attempt. It gives every execution face Leverage without teaching it process mechanics, and gives maintainers Locality because B2 ordering, provider availability, recovery, quarantine, and settlement change in one Module. The internal Windows/Linux/deterministic Adapters make the process-authority Seam real rather than hypothetical.

### 11. Make `ExactTeacherAttemptModule.executeAndSettle` the sole common-caller Interface

The external Module is `ExactTeacherAttemptModule`. Its Interface has one entry point:

```ts
interface ExactTeacherAttemptModule {
  executeAndSettle(locator: Readonly<{
    runRef: ExactChangeRunRef;
    teacherActionId: ActionId;
    expectedRecordVersion: number;
  }>): Promise<
    | CanonicalTeacherAdviceSettlement
    | CanonicalTeacherUnavailableSettlement
    | ExactTeacherAuthorityRetained
  >;
}
```

The locator identifies canonical state; it does not carry execution authority. The Module reloads and verifies the frozen Teacher Action/attempt, source Session, workspace instance, binding limits, backend, cwd, stable Session, request identity, reservation state, and expected Record frontier. The Interface never accepts `hostedSeam`, cwd, backend, limits, an exact flag, provider selection, `ProcessRef`, PID, process name, hosted receipt, arbitrary turn input, advice text, or individual lifecycle commands. It returns canonical settlement or retained-authority state, never raw hosted result bytes.

Management HTTP, CLI, Canvas, and internal driver faces all call this Interface for Teacher work. Existing general frozen-Action dispatch remains for ordinary/source Actions, but a canonical Teacher Action cannot enter that legacy caller-supplied hosted seam. This is the external Seam and the test surface; internal provider and SessionHost Seams remain private to the implementation.

### 12. Reuse the exact process-authority Seam through platform Adapters and a durable authority union

The internal `ExactProcessAuthority` Seam is the existing provider-backed stack, not a new PID-tree implementation:

- `ProcessAuthorityProviderRegistry` admits only a closed manifest whose runtime descriptor matches the exact provider/capability/protocol tuple.
- `ProcessAuthorityCoordinator` owns bounded prepare/publish/activate/inspect/terminate ordering and is the only minter/authenticator of `ExactScopeEmptyReceipt`.
- Windows and Linux production provider bundles, their publication ledgers/phase journals, and their frame-preserving runtime bridges are production Adapters. The deterministic provider plus runtime bridge is the test Adapter.
- `createProviderBackedProcessScope` is the internal Adapter that lets the exact Teacher SessionHost reuse the existing backend/session implementation without weakening provider outcomes.

Production management construction builds two lanes. The existing ordinary/source SessionHost continues using `createHostedProcessScope()` and its declared best-effort semantics. A separate exact Teacher SessionHost/registry root uses only the provider-backed ProcessScope and is reachable only through `ExactTeacherAttemptModule`. Sharing the backend implementation is allowed; sharing a best-effort ProcessScope or treating a generic hosted receipt as exact authority is not.

No one durable store is sufficient after restart. The implementation reconciles a union of:

- canonical Record: Run, Teacher Action, Invocation, attempt, workspace, binding, reservation, and settlement frontier;
- exact Teacher-attempt journal: provider tuple, opaque `ProcessRef`, canonical identities, stable Session, deterministic request, hosted receipt/quarantine identities, and phase;
- exact Teacher SessionHost registry: stable/backend Session, request state/result reference, process generation, ownership, and opaque runtime reference;
- provider publication ledger/phase journal: provider-private generation, launch digest, durable prepared/published state, and recovery provenance.

Every identity must agree before progress. The full opaque reference is sensitive control authority and is never logged or projected. The provider tuple is persisted explicitly as well as encoded in the reference, so restart never derives selection from current registry order. PID, process name, a freshly enumerated descendant set, or a structurally similar receipt is never recovery authority.

### 13. Persist and recover one ordered exact-attempt state machine

The durable state machine is monotonic:

```text
canonical-preflight
  -> baseline-stable
  -> authority-prepared-inert
  -> authority-published-inert
  -> activated
  -> request-sent
  -> result-quarantined
  -> hosted-receipt-verified
  -> retirement-pending
  -> exact-scope-empty
  -> final-observation-stable
  -> advice-validated
  -> canonical-settled
```

Each transition writes its identity-bearing phase before the next irreversible action. Execution and request send are exactly once: restart after `request-sent` uses the deterministic request and SessionHost settled replay, never a second send. Result bytes are placed in a bounded quarantine after SessionHost settlement; only digest/reference metadata crosses the journal. Hosted receipt verification re-reads durable SessionHost facts and result bytes before retirement, but it does not validate advice yet. Exact retirement must then produce the coordinator-authenticated receipt for the persisted `ProcessRef`. Final observation and advice validation occur only afterward, followed by the existing canonical Facade compare-and-swap.

Restart at any phase reloads the authority union. A phase already proven complete is not repeated; an in-flight exact provider operation is reconciled by the persisted tuple/reference; a sent request is replayed only from a durably settled SessionHost result; a quarantined result remains inaccessible to advice/continuation; and settlement reuses the canonical idempotent transition. Unknown future phases or disagreement among stores fail closed without rewriting authority bytes.

### 14. Fail closed by authority disposition and platform policy

Only an authentic `ExactScopeEmptyReceipt` for the persisted reference authorizes final observation, release of exact Teacher authority, or transition toward settlement. Root exit, declared-unproven terminal, timeout, provider or control loss, foreign/stale reference, identity drift, event gap, journal/registry disagreement, and receipt mismatch retain the exact authority. While retained, no advice, source continuation, or unavailable continuation is emitted; the sponsored Teacher reservation stays held and the source writer remains paused.

If provider unavailability is established before activation, no workload or result exists: the attempt may safely settle typed unavailable under the frozen consultation budget. If an activated attempt later reaches authentic exact empty but has invalid result bytes or a failed/unstable final observation, its sponsored reservation may release and the attempt fails without advice; retry or eventual unavailable continuation remains governed by the existing bounded consultation state and can occur only after that safe disposition. The paused source writer releases only through the canonical source lifecycle.

Platform policy is explicit:

- Linux: assemble the authenticated primary and, where configured, broker provider Adapters with their durable publication/delivery ledgers and frame-preserving runtime bridge; select one exact tuple by server policy and persist it.
- Windows: assemble the Job-object provider only after the packaged helper, publication durability, identity probes, and a frame-preserving runtime bridge pass production conformance. Until then the exact Teacher lane is unavailable before activation.
- macOS: no exact provider is shipped by this change, so Teacher attempts are typed unavailable before activation. The ordinary/source POSIX best-effort SessionHost remains available.

No platform falls back to best-effort, in-tool, provider registration order, PID/name, or descendant enumeration for Teacher execution.

### 15. Fence the final manifest after exact retirement

Exact retirement prevents a surviving Teacher writer from waiting past every finite scan. The final manifest still detects mutations concurrent with the scan from other actors and closes path-replacement races.

For each regular file, record the initial `lstat` identity/type/mode/size/`mtimeNs`/`ctimeNs`, open no-follow where supported, verify the opened handle, read bounded bytes, then `fstat` again and compare the same facts. For each directory, record its initial `lstat`, enumerate without following links, visit its children, then `lstat` after enumeration and after all children and compare identity/type/mode/size/`mtimeNs`/`ctimeNs`. Use handle-bound directory traversal where the platform exposes it; otherwise post-validation is mandatory. Symlinks and Windows junctions are represented by no-follow link identity/target bytes and never traversed.

An explicitly classified internal instability may restart the entire bounded observation a fixed small number of times. Permission, path, UTF-8 decoding, unsupported-entry, entry/byte bound, or persistent-instability failures do not retry into success. The pre-Teacher baseline and final manifest include tracked, untracked, and ignored entries plus separately hashed HEAD and index facts.

## Risks / Trade-offs

- [Hosted-only first version reduces availability] -> Advertise `continuableTurns` before execution and fail closed instead of offering an unproven new-session substitute.
- [A paused writer can hold the workspace for the duration of a slow Teacher] -> Bound Teacher attempts/time/output, retain normal cancel, and expose consultation state/counters so the hold is diagnosable.
- [Canonical question/advice bodies increase Record size] -> Enforce strict UTF-8 byte/collection bounds, count evidence against existing per-Run limits, and keep duplicate bytes content-addressed in EvidenceStore.
- [Cross-store commit and SessionHost settlement cannot be one transaction] -> Use deterministic request ids, settled replay, Record compare-and-swap, and a fail-closed ambiguous wait; never infer delivery from process liveness.
- [Sponsored read could accidentally become a general reservation bypass] -> Require the exact source writer, same Run/Invocation/consultation, canonical paused state, read-only Teacher authority, and mutation guards at the registry seam.
- [Adding an intermediate worker outcome could leak into ordinary autopilot leaves] -> Register a separate `consultable-leaf` contract; leave `leaf` parsing byte-for-byte unchanged.
- [Downstream registry/Canvas work may choose an incompatible shape] -> Export strict binding, invocation, advice, continuation, and projection schemas from core and require downstream code to consume them rather than duplicate them.
- [Exact Teacher availability is narrower than generic hosted availability] -> Publish a distinct pre-activation provider verdict, keep macOS typed unavailable, and never infer exactness from `continuableTurns` or generic hosted availability.
- [Four durable stores can disagree after a crash] -> Persist the same canonical attempt identities and phase in the authority union, reconcile exact equality on restart, and retain authority on mismatch or event gap.
- [Quarantined valid-looking bytes could be consumed early] -> Keep raw result bytes behind the Module, project only bounded identity/digest state, and parse advice only after hosted receipt, exact retirement, and stable final observation gates.
- [Windows provider code exists but its current runtime bridge cannot safely demultiplex workload output] -> Require a frame-preserving production Adapter and keep the Teacher lane unavailable until its conformance gates pass.

## Migration Plan

1. Keep the already implemented optional schemas, canonical lifecycle, continuation, sponsored-read, projection, and compatibility behavior intact.
2. Assemble manifest-bound Windows/Linux exact provider registries, coordinators, publication/delivery ledgers, and runtime bridges under a dedicated management-host Teacher state root; keep macOS pre-activation unavailable.
3. Add the exact Teacher SessionHost lane and durable attempt journal/strict decoder, then reconcile it with the canonical Record, SessionHost registry, and provider ledger at every phase.
4. Introduce `ExactTeacherAttemptModule.executeAndSettle`, route Teacher faces through its canonical locator, quarantine settled bytes, and enforce receipt -> exact retirement -> final observation -> validation -> settlement ordering.
5. Add the final manifest stability fence and deterministic delayed-child/restart-at-every-phase tests, then run provider conformance on deterministic and actual available Windows/Linux Adapters.
6. Re-run legacy ordinary/source SessionHost, no-binding, consultation, reservation, and BoundedLoop suites to prove the exact lane is additive.
7. The dependent Teacher workflow and Canvas children consume the canonical binding, availability, advice settlement, and projection only after this runtime change is review-clean.

Rollback removes production of consultation bindings first, disables new exact Teacher activation, and leaves any persisted exact authority/journal available to the compatible reconciler until authentic exact empty is established. Existing Records containing consultation state remain inspectable with this decoder; an older binary must not mutate an unknown consultation-bearing Record or opaque provider reference. No automatic downgrade, best-effort conversion, or deletion is performed.

## Open Questions

No runtime decision is blocking implementation. The exact Teacher capability id/digest and prompt are owned by `teacher-advisor-workflow`; the authoring syntax and visual sidecar are owned by `teacher-consultation-canvas`. Both must consume the frozen contracts above rather than redefining them.
