## ADDED Requirements

### Requirement: Frozen agent authority carries logical inference identity
When an effective stage selects OmniCross, the frozen execution profile and each granted agent Action SHALL carry the normalized broker, upstream discriminated union, effective model, runtime, and non-secret broker configuration identity needed to recreate the route. They SHALL NOT carry a route token, launch environment secret, control credential value, Provider credential, or a live lease descriptor. Existing Actions without inference SHALL remain readable and executable with their prior meaning.

#### Scenario: Agent Action is created for a routed stage
- **WHEN** the runtime plan lowers an OmniCross-routed stage into a granted agent Action
- **THEN** the Action SHALL bind the same runtime, upstream, and effective model included in the frozen profile
- **AND** its digest SHALL cover those credential-free values

#### Scenario: Legacy Action has no inference
- **WHEN** the executor reads an Action produced before inference routing existed
- **THEN** the Action SHALL retain its existing authority and dispatch semantics

#### Scenario: Secret is offered as frozen inference state
- **WHEN** a caller attempts to construct or decode a frozen inference block containing token or credential material
- **THEN** the closed Action/profile contracts SHALL reject it

### Requirement: Frozen routed Actions bind their worker result contract
The canonical execution profile and each newly admitted agent Action SHALL bind a validated `leaf | evaluate` worker contract under profile and Action authority. An evaluate GoalCycle judge SHALL freeze `evaluate` from immutable Definition semantics; all other newly admitted agent Actions SHALL freeze `leaf`. Retry, reconciliation, and routed execution SHALL use only that frozen value and SHALL NOT infer it from current Pipeline state, role, or prompt. Historical profiles and Actions without the field SHALL remain decodable; an unrouted historical Action SHALL preserve its prior behavior, while a routed historical Action lacking the discriminator SHALL fail closed before Route Lease acquisition because its original result contract is unknowable.

#### Scenario: Evaluate GoalCycle judge is routed
- **WHEN** an evaluate GoalCycle judge is frozen and dispatched through either the Claude or Codex routed process bridge
- **THEN** its profile and Action SHALL bind `workerContract: evaluate`
- **AND** the runner SHALL validate and preserve the evaluate payload rather than applying the incompatible leaf schema

#### Scenario: Historical routed Action lacks worker-contract authority
- **WHEN** a routed historical Action without `workerContract` reaches the executor
- **THEN** the executor SHALL return a typed non-retryable invalid-input route failure before requesting a lease or spawning a runtime process

### Requirement: The canonical Record is the complete execution authority
Before selecting a backend, requesting a Route Lease, or starting a process, the executor SHALL require the caller's strictly decoded Action receipt to equal the complete canonical Action committed in the Record. The comparison SHALL cover the entire closed Action contract rather than a maintained subset of fields, including agent runtime, model, sandbox, reasoning effort, worker contract, inference identity, input, session authority, workspace, effects, completion authority, capability, and contract digests. After validation, every backend and lifecycle SHALL receive the Record-owned Action object, not the caller's copy. Historical Actions that omit optional fields SHALL remain decodable and executable only when the receipt and committed historical Action omit the same fields; strict decoding and routed worker-contract fail-closed behavior SHALL remain unchanged.

#### Scenario: Caller mutates execution authority after admission
- **WHEN** a caller retains a committed Action's IDs and selected digests but changes any other execution-bearing field
- **THEN** the executor SHALL return a typed receipt conflict before selecting or invoking a Route Lease or runtime process
- **AND** SHALL NOT dispatch the caller-mutated Action

#### Scenario: Historical Action receipt exactly matches its Record
- **WHEN** a historical Action and its receipt both omit an additive optional authority field
- **THEN** complete canonical equality SHALL accept that omission under the Action's prior unrouted semantics
- **AND** SHALL NOT weaken strict decoding or infer missing routed authority

### Requirement: Every executor face uses the Route Lease lifecycle seam
Every production driver face that dispatches an OmniCross-routed agent Action SHALL pass through one shared Route Lease execution seam before reaching its selected Claude or Codex backend. The seam SHALL acquire from the frozen Action, inject a validated runtime binding for one attempt, supervise renewal and cancellation, and release in a finalizer. No driver face SHALL independently derive a live route or silently dispatch without the lease.

#### Scenario: Hosted executor dispatches a routed Action
- **WHEN** a hosted backend receives a granted OmniCross-routed agent Action
- **THEN** it SHALL acquire and supervise one Route Lease through the shared seam before executing the turn

#### Scenario: Lease creation fails before backend execution
- **WHEN** the Route Lease seam cannot acquire a valid route for a granted Action
- **THEN** the executor SHALL return a typed authority/route failure and SHALL NOT call the agent backend

#### Scenario: Routed hosted input exceeds the turn limit
- **WHEN** a routed hosted turn's UTF-8 input bytes exceed the same `maxInputBytes` bound used by SessionHost
- **THEN** the executor SHALL return a typed non-retryable invalid-input route failure before requesting a lease or spawning a runtime process

### Requirement: Recovery preserves route identity and replaces only ephemeral authority
Reconciliation and resume SHALL use the frozen agent Action's inference identity rather than current Pipeline configuration. Each new attempt MAY receive a new lease id and token, but SHALL keep the frozen runtime, upstream, and model. A live Pipeline edit, model override, or broker failure SHALL NOT retarget an admitted Action.

#### Scenario: Pipeline changes after Action admission
- **WHEN** the Pipeline's inference or model declaration changes after an Action was frozen
- **THEN** retrying or resuming that Action SHALL use the original frozen inference identity

#### Scenario: Ephemeral lease was lost
- **WHEN** a retry begins after the prior lease expired or the daemon restarted
- **THEN** the executor SHALL request a new lease for the frozen logical route
- **AND** SHALL not persist or reuse the old token

### Requirement: Canonical agent Actions authenticate their executable turn input
Every newly admitted canonical agent Action SHALL bind the exact trusted driver-rendered base turn input by a closed versioned rendering contract, exact UTF-8 byte length, and domain-separated content digest under normal Action authority. The structured `agent.input` SHALL retain its orchestration meaning and SHALL NOT be treated as an executable prompt unless a future rendering contract explicitly defines that meaning. A frozen-action dispatch request MAY transport the rendered string, but the request string SHALL be only an assertion: the executor SHALL compare its exact UTF-8 length and digest with the Record-owned binding before backend selection, Route Lease acquisition, SessionHost generation creation/resume, launcher execution, or process spawn. Claude/Codex runtime-owned contract and flat-hierarchy framing SHALL continue to derive from the committed worker contract and runtime rather than caller text.

The authority check SHALL apply to hosted and in-tool backends, whether routed or unrouted. A mismatch SHALL return typed non-retryable `execution_input_mismatch`; a matching authenticated input that exceeds the effective shared UTF-8 turn bound SHALL return typed non-retryable `execution_input_too_large`. A historical routed Action without the binding SHALL return typed non-retryable `execution_input_authority_missing` before lease or process. A historical unrouted Action without the binding SHALL remain decodable and retain its prior caller-rendered turn behavior. The executor SHALL NOT backfill either historical case from current Pipeline/skill content or by serializing `agent.input`.

#### Scenario: Caller changes only the transported prompt
- **WHEN** the caller supplies a receipt that remains canonically equal to the committed Action but changes only the sibling request `turnInput`
- **THEN** the executor SHALL return `execution_input_mismatch` before selecting or invoking a backend, acquiring a Route Lease, creating or resuming a hosted generation, or spawning a runtime process
- **AND** SHALL NOT execute the changed request bytes under the committed Action metadata

#### Scenario: Authenticated prompt is dispatched through a routed runner
- **WHEN** a new routed Claude or Codex Action and the transported UTF-8 turn input match the Record-owned rendering contract, byte length, and digest
- **THEN** the runner SHALL execute those authenticated base-prompt bytes with only deterministic runtime-owned framing selected from the committed Action
- **AND** exact retry or resume SHALL require the same authenticated base-prompt bytes while allowing a replacement ephemeral Route Lease

#### Scenario: New unrouted hosted Action receives changed request text
- **WHEN** a new unrouted hosted Action carries turn-input authority and the request string does not match it
- **THEN** the executor SHALL return `execution_input_mismatch` before calling SessionHost
- **AND** route absence SHALL NOT weaken work authority

#### Scenario: Historical prompt authority is unknowable
- **WHEN** a historical routed Action lacks the turn-input binding
- **THEN** the executor SHALL return `execution_input_authority_missing` before lease or process
- **BUT WHEN** a historical unrouted Action lacks the binding
- **THEN** it SHALL retain its prior request-rendered behavior without inferred or backfilled authority

#### Scenario: Matching multibyte input exceeds the effective limit
- **WHEN** the exact UTF-8 request bytes match the committed turn-input binding but exceed the selected production host's effective `maxInputBytes`
- **THEN** the executor SHALL return `execution_input_too_large` before lease, session creation/resume, or process spawn
- **AND** SHALL measure bytes rather than JavaScript character count

#### Scenario: Structured orchestration input remains independently usable
- **WHEN** bounded-loop reconciliation reads a new Action after turn-input authority is added
- **THEN** `agent.input` SHALL retain the same closed JSON orchestration payload used for review, goal, recovery, and strategy lifecycle decisions
- **AND** leaf/evaluate result schemas SHALL remain selected only by the separately frozen `workerContract`

### Requirement: Agent admission uses a stable quiescent candidate preview
The canonical runtime SHALL expose each ready agent candidate as a closed prompt-free preview before creating any Action authority. `start`, `resume`, `complete`, and `control` SHALL stop at that preview boundary whenever the next executable candidate is an agent, while still settling durable waits, terminal transitions, and non-agent command/host candidates. A preview SHALL identify the Run, canonical head Record version, node, occurrence, optional frozen profile path, and structured orchestration input with a runtime-derived candidate identity bound to the complete descriptor and current head digest. The preview and its prompt SHALL NOT be persisted in the canonical Record, run-state, evidence, logs, or telemetry.

A trusted source workflow SHALL render the complete base prompt for the exact preview and place bounded UTF-8 strings in private ephemera under the closed `agent-turn-input-manifest/1` contract. A subsequent explicit admission operation SHALL re-reconcile the same head, require exact one-to-one coverage of the entire current agent frontier, verify every candidate identity and Record version, and atomically build, admit, and grant the Actions. Only the Action builder SHALL compute the `agent-turn-input/1` length and digest. Admission SHALL reject stale, missing, duplicate, extra, wrong-Run, or wrong-candidate manifests before Action construction or Record mutation.

#### Scenario: Start reaches an agent frontier
- **WHEN** a new Run's first ready candidate is an agent
- **THEN** start SHALL create the Run and return a stable candidate preview with no admitted or granted Action
- **AND** the Record SHALL contain neither the candidate nor prompt bytes

#### Scenario: Completion unlocks an agent successor
- **WHEN** an Action completion makes an agent candidate ready
- **THEN** completion SHALL commit the result and return the successor preview
- **AND** SHALL NOT auto-admit or grant that successor

#### Scenario: Crash and exact resume occur before admission
- **WHEN** the driver crashes after preview and resumes against an unchanged canonical head
- **THEN** reconciliation SHALL reproduce the identical candidate descriptor and candidate identity from the frozen plan and Record
- **AND** SHALL NOT read mutable Pipeline or skill content

#### Scenario: Trusted manifest is admitted
- **WHEN** a private bounded manifest exactly covers the current candidate frontier
- **THEN** explicit admission SHALL compute turn-input authority from each exact prompt string and atomically admit/grant the resulting Actions
- **AND** the admission receipt and canonical Record SHALL not expose prompt bodies

#### Scenario: Manifest is stale or belongs to another candidate
- **WHEN** the current Record/frontier no longer matches a manifest candidate, or an entry is missing, duplicated, extra, or for another Run
- **THEN** admission SHALL return typed `candidate_stale` before Action construction or Record mutation

#### Scenario: Non-agent candidate is ready
- **WHEN** a command or host candidate reaches the frontier
- **THEN** the runtime SHALL preserve its existing trusted builder and admission/grant behavior without requiring a turn-input manifest

#### Scenario: Legacy prompt-file dispatch is used
- **WHEN** a caller invokes legacy `rasen agent dispatch --prompt-file`
- **THEN** the candidate-preview protocol SHALL not alter its byte-for-byte prompt-file behavior
