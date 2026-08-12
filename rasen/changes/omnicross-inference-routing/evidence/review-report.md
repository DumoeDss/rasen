# Independent review report: `omnicross-inference-routing`

## Verdict

**Not ready to ship.** The reviewed implementation has **2 Major** findings and **0 Blocker** findings. The first prevents every routed canonical Action from executing through the only shipped daemon/Management API face. The second permits a cancelled routed attempt to be reported as successful when a backend does not cooperatively reject its abort signal.

## Severity counts

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| Major | 2 |
| Minor | 0 |
| Trivial | 0 |

## Findings

### Major 1 — The shipped frozen-Action daemon face never wires a route-aware process bridge

**Anchors:**

- `src/core/management-api/frozen-action-executor.ts:190-198`
- `src/core/frozen-action-executor/production-executor.ts:97-104`
- `src/core/frozen-action-executor/production-executor.ts:128-143`
- `src/core/frozen-action-executor/production-executor.ts:259-292`
- `test/core/frozen-action-executor/production-executor.test.ts:337-349`
- `test/core/management-api/frozen-action-executor.test.ts:77-152`

**Failure scenario:** A canonical granted agent Action contains frozen OmniCross inference and is dispatched through `POST /api/v1/frozen-action-executor/dispatch` with the hosted backend. `handleFrozenActionDispatch()` constructs the production executor with `host`, `cwd`, `backend`, and `limits`, but does not supply `hostedSeamOptions.executeRoutedTurn`. The shared lifecycle can acquire a lease, but when it hands the validated route binding to the hosted backend, the backend throws `invalid-config` (`The hosted executor has no route-aware child-process bridge.`). The executor returns `route-failed`; no Claude or Codex turn can execute. This violates the requirement that the hosted production face reach the selected backend through the shared Route Lease seam.

**Verification performed:**

1. Traced all repository references to `executeRoutedTurn` and `executeInToolRoutedTurn`. Outside `production-executor.ts`, every supplied implementation is test-only; no production driver supplies either callback.
2. Traced all production calls to `createProductionExecutor()`. The Management API handler is the sole shipped call site, and its options at `frozen-action-executor.ts:190-198` omit both routed executors.
3. Compared production-face coverage with tests. Routed tests in `production-executor.test.ts` inject `executeRoutedTurn`/`executeInToolRoutedTurn`, while `management-api/frozen-action-executor.test.ts` tests only body validation and missing Records and never dispatches a routed Action through the real constructor.
4. Confirmed the failure is fail-closed (it does not fall back to user CLI credentials), but it makes the advertised canonical routed path unusable.

### Major 2 — External cancellation is not authoritative if the runtime callback resolves after ignoring abort

**Anchors:**

- `src/core/omnicross/lease-execution.ts:126-132`
- `src/core/omnicross/lease-execution.ts:260-280`
- `src/core/omnicross/lease-execution.ts:282-296`
- `test/core/omnicross/omnicross.test.ts:457-494`

**Failure scenario:** A routed attempt starts, its caller cancels it, and the backend callback either does not observe the `AbortSignal` or races and resolves a successful value after cancellation. The external abort sets the lifecycle controller to aborted, but `withOmniCrossRoute()` only records cancellation inside the callback's `catch`. If the callback resolves, `runFailure` and `routeFailure` remain unset; after release, line 296 returns `{ ok: true, value }`. The caller can therefore commit successful work after cancellation, contrary to the lifecycle's cancellation supervision contract.

**Verification performed:**

1. Followed the external signal from the listener at lines 126-132 through callback completion and final result selection.
2. Confirmed there is no post-callback `controller.signal.aborted` check before the success return at lines 294-296.
3. Inspected the existing cancellation test at `omnicross.test.ts:457-494`. Its callback is cooperative: it explicitly rejects in its abort listener. That test exercises only the catch path and cannot detect success-after-cancel.
4. Confirmed the Claude/Codex runners are intended to cooperate, but the shared lifecycle is also used at abstract backend seams and claims to supervise cancellation; it cannot safely treat arbitrary callback cooperation as the cancellation authority.

## Independent review coverage

### Source and contract inspection

- Read the proposal, design, all task entries, and all six delta specs.
- Inspected the complete uncommitted file scope (57 modified tracked files plus untracked OmniCross source/tests/docs/change artifacts).
- Traced Pipeline declaration and effective model/runtime resolution into legacy run-state and canonical frozen profiles/Actions.
- Traced canonical retry/resume authority from frozen Action through `createRoutedActionLifecycle()`; current Pipeline/model/upstream configuration is not consulted there.
- Inspected same-host and unknown-host route selection. Routed known-host stages select an exec bridge, including same-host; routed unknown-host stages fail closed; non-routed legacy fallback remains separate.
- Inspected closed upstream and frozen-route schemas, connection revision validation, inference-file strict decoding, response identity/expiry checks, Claude/Codex descriptor allowlists, and child environment construction.
- Inspected create retry, renewal, release, route-loss, timeout/cancellation, runner process termination, receipt sanitization, and concurrent-token tests.
- Inspected old-record compatibility: inference fields are optional, old run-state stages remain readable, and strict frozen inference blocks reject additional secret-bearing fields.
- Inspected generated orchestration instructions for legacy freeze/resume and per-attempt inference-file behavior.

### Security observations that survived review without a finding

- Frozen route state contains non-secret connection identity, not the Admin value, route token, or launch descriptor.
- The Admin token is resolved from the named environment variable at dispatch and is removed from routed child environments.
- Claude and Codex launch descriptors are reduced through explicit allowlists; unknown env/config/argv fields are rejected.
- Codex route tokens are not placed on argv; Claude route tokens are child-environment-only.
- Focused runner tests snapshot Codex and Claude configuration/credential files and use fake binaries; source runners do not add reads or writes of those files.
- CLI integration tests scan persisted test trees for sentinel secrets. This is useful evidence, though it does not repair the missing canonical production wiring above.

## Checks and outcomes

| Check | Outcome |
| --- | --- |
| `git diff --check` | Passed (exit 0); Git emitted only existing LF→CRLF working-copy warnings. |
| Focused Vitest command for OmniCross, runners, agent dispatch, Pipeline routing, production executor, and Management API | Not run: terminal permission was not granted for the command. No pass is claimed. |
| `tsc --noEmit` | Not run: terminal permission was not granted for the command. No pass is claimed. |
| Static production call-site/reference trace | Completed; produced Major 1. |
| Static cancellation falsification trace against existing test | Completed; produced Major 2. |
| Persisted `.rasen` token-pattern scan | No route/Admin credential value found; only review prompt/run metadata references were returned. |

## Open Blocker/Major findings

- **Major:** wire the actual hosted/in-tool routed child-process executor into every shipped frozen-Action driver face and add a test through `handleFrozenActionDispatch()` that proves a routed Action reaches a real fake Claude/Codex process rather than an injected abstract callback.
- **Major:** make cancellation authoritative after callback settlement (including success-after-abort races), and add a discriminating test whose callback ignores abort and resolves.

## Durable planning takeaways

1. A route-aware callback existing in an injectable executor is not production wiring; tests must start at the real Management API/driver constructor.
2. Cooperative child cancellation does not prove lifecycle cancellation authority; include an abort-ignoring callback mutation/race case.
3. Keep the current closed descriptor schemas, frozen non-secret route authority, and persisted-secret scans while repairing the two execution-control gaps.

## Round 1 re-review

### Verdict

**Not ready to ship.** Both original Major findings are resolved, but the M1 repair introduces **1 new Major** contract-selection defect. The routed production bridge also bypasses the hosted turn's configured input-byte limit, recorded as **1 Minor**. Current open counts are **0 Blocker, 1 Major, 1 Minor, 0 Trivial**.

### Original finding adjudication

#### Major 1 — The shipped frozen-Action daemon face never wires a route-aware process bridge: `resolved`

**Rationale:** The shipped Management API constructor now creates `createProductionRoutedTurnExecutor()` and supplies it as `hostedSeamOptions.executeRoutedTurn`. The lifecycle admits only a canonical granted Action, acquires the lease from that Action's frozen inference route, validates the daemon descriptor into a closed `RuntimeRouteBinding`, and passes that binding to the bridge. The bridge cross-checks the frozen Action runtime against both the frozen inference runtime and validated binding, takes model/sandbox/effort only from the Action, resolves only the matching Claude/Codex binary, removes the named control-token variable from the child environment, and passes the binding's secret values to runner redaction. It neither falls back to a native/default-login route nor reads or mutates user credential/configuration files.

**Anchors:**

- `src/core/management-api/frozen-action-executor.ts:193-211`
- `src/core/frozen-action-executor/production-executor.ts:84-113`
- `src/core/frozen-action-executor/production-executor.ts:121-168`
- `src/core/frozen-action-executor/production-executor.ts:196-296`
- `src/core/omnicross/lease-execution.ts:121-180`
- `src/core/omnicross/lease-execution.ts:260-299`
- `test/core/management-api/frozen-action-executor.test.ts:273-335`

**Dynamic evidence:** The repaired Management API test is parameterized over both Codex and Claude and starts the fake OmniCross daemon plus a real fake child executable. It canonically publishes the granted Record through the filesystem RunStore/reducer, invokes `handleFrozenActionDispatch()`, requires a numeric child PID/PPID marker, proves the ordinary `SessionHost.dispatch()` stub was never called, observes exactly one lease POST and one DELETE, requires zero active leases, and checks that neither Admin nor route token reaches the result. Those assertions cannot pass through the former fixture-only injected callback. The fixer/LEAD evidence records this Management API file at 9/9 and the focused set at 67/67 after its canonical-Record repair. My attempted independent rerun was permission-denied, so I do not relabel those supplied runs as independently executed.

**Adversarial qualification:** This resolves the original missing-production-wiring failure. It does not resolve the distinct worker-contract bug introduced inside the new bridge, recorded below.

#### Major 2 — External cancellation is not authoritative if the runtime callback resolves after ignoring abort: `resolved`

**Rationale:** After the runtime callback resolves, `withOmniCrossRoute()` now checks the lifecycle controller before accepting the value and records `cancelled` when external abort is authoritative. A pre-existing `routeFailure` remains higher precedence, so renewal loss cannot be relabeled as caller cancellation. Cleanup still runs exactly once; release failure remains a warning and does not overturn an otherwise successful completion. The relevant linearization is callback settlement: cancellation observed before the post-settlement check wins, while a later abort cannot race through release because the external listener is removed before release begins.

**Anchors:**

- `src/core/omnicross/lease-execution.ts:126-132`
- `src/core/omnicross/lease-execution.ts:198-258`
- `src/core/omnicross/lease-execution.ts:260-299`
- `test/core/omnicross/omnicross.test.ts:457-535`
- `test/core/omnicross/omnicross.test.ts:537-604`

**Dynamic evidence:** The new test deliberately starts a callback that ignores its `AbortSignal`, externally aborts it, then lets it resolve `runtime-success-after-cancel`; it requires a `cancelled` failure and exactly one release. This directly falsifies the original success-after-cancel implementation rather than merely exercising a cooperative rejection. Adjacent tests separately require route-loss after bounded renewal failure and successful-result precedence when release fails. The supplied focused result is 67/67; my attempted independent rerun was permission-denied and is not claimed as my own pass.

### New findings

#### Major 3 — The production routed bridge hardcodes the leaf contract for every canonical agent Action

**Anchors:**

- `src/core/frozen-action-executor/production-executor.ts:256-295`
- `src/core/change-run/contracts.ts:255-315`
- `src/core/change-run/internal/actions.ts:140-183`
- `src/core/worker-contracts.ts:47-62`
- `src/core/worker-contracts.ts:81-106`
- `src/core/templates/workflows/_orchestration.ts:65-95`
- `test/core/management-api/frozen-action-executor.test.ts:273-335`

**Failure scenario:** A canonical routed agent Action represents an evaluate-gate turn, whose exec-bridge contract is `{ satisfied, gaps, summary? }`. The new production bridge unconditionally invokes both `runCodexExec()` and `buildClaudePrintInvocation()` with `contract: 'leaf'`, whose incompatible result is `{ status: 'DONE' | 'HANDOFF', summary?, handoffReason? }`. The worker is therefore instructed and schema-constrained to return the wrong shape. It can either fail contract validation when it returns a valid evaluate result or succeed with a leaf result that cannot carry the gate decision. The Action freezes only opaque result/evidence contract digests and no `WorkerContract` discriminator, so the bridge cannot recover the correct choice from validated frozen authority; inferring it from mutable role/prompt state would also be unsafe.

**Why Major:** The change promises that any stage with OmniCross inference uses the target runtime's exec bridge, and the shipped orchestration explicitly supports both `leaf` and `evaluate` contracts. Hardcoding one contract silently breaks routed evaluate work at the canonical execution boundary. Repair requires freezing an authoritative contract discriminator (or an equivalent validated mapping) and threading it to both runners, plus tests that force the evaluate schema through the real Management API/fake-process path.

**Dynamic evidence:** The new real-process test uses only `MODE=success`, which the fake runners satisfy under the hardcoded leaf schema. There is no corresponding `MODE=evaluate` production-constructor test. Because the fake executables inspect the supplied output schema and emit different leaf/evaluate payloads, adding that case would discriminate this defect; the current green test cannot.

#### Minor 1 — Routed hosted turns bypass `TurnLimits.maxInputBytes`

**Anchors:**

- `src/core/frozen-action-executor/production-executor.ts:91-100`
- `src/core/frozen-action-executor/production-executor.ts:138-163`
- `src/core/frozen-action-executor/production-executor.ts:203-296`
- `src/core/session-host/contracts.ts:312-356`
- `src/core/management-api/frozen-action-executor.ts:169-220`

**Failure scenario:** A hosted routed dispatch supplies a non-empty `turnInput` whose UTF-8 size exceeds `hostedSeam.limits.maxInputBytes`. An unrouted hosted turn is rejected by SessionHost command validation, but the routed branch bypasses `host.dispatch()` and the new bridge consumes only `timeoutMs` and `maxOutputBytes`; it starts Claude/Codex with the oversized prompt. The same advertised `TurnLimits` object therefore has route-dependent enforcement.

**Why Minor:** This weakens a configured resource bound and makes routed/unrouted behavior inconsistent, but the request is already resident in the Management API process and the defect does not by itself grant route authority or expose credentials. Add a byte-length check before binary spawn and a real-face test proving an oversized routed input acquires no process execution (and preferably no lease if validation is moved before lifecycle acquisition).

**Dynamic evidence:** Static branch comparison shows `host.dispatch()` receives all three limits for unrouted turns, while the routed runner forwards only timeout/output limits. The current production routed tests use a small prompt and include no over-limit mutation, so their 9/9 result is non-discriminating for this bound.

### Round 1 checks and outcomes

| Check | Outcome |
| --- | --- |
| Exact-fix-file `git diff --check` | Passed; Git emitted only an LF→CRLF working-copy warning for `production-executor.test.ts`. |
| Independent focused Vitest rerun | Permission denied; no independent pass claimed. |
| Fixer/LEAD Management API test | Supplied as 9/9 after canonical RunStore/reducer repair. |
| Fixer/LEAD focused suite | Supplied as 67/67. |
| Production authority/lifecycle trace | Completed through Management API constructor → canonical admission → lease create/descriptor reduction → real Claude/Codex runner → release. |
| Cancellation/route-loss/release race trace | Completed; original M2 is resolved with route-loss precedence and best-effort-release semantics preserved. |
| Worker-contract adversarial trace | Completed; produced new Major 3. |
| Routed input-limit branch comparison | Completed; produced Minor 1. |

### Round 1 open Blocker/Major findings

- **Major 3:** Freeze and honor the authoritative `leaf` versus `evaluate` worker contract for routed canonical Actions, and add a real Management API/fake-process evaluate test that fails under the current hardcoded leaf schema.

There are **no open Blockers**. Original Major 1 and Major 2 are resolved; the change remains not ready because new Major 3 is open.

## Round 2 re-review

### Verdict

**Not ready to ship.** Round 2 resolves Major 3 and Minor 1 without regressing the two original Major fixes, but the full authority trace exposes **1 open Major**: the executor accepts and executes caller-mutated agent authority so long as a small subset of Action fields still matches the committed Record. Round 2 also exposes **1 Minor** result-integrity defect: recursive secret sanitization silently truncates valid evaluate gaps. Current open counts are **0 Blocker, 1 Major, 1 Minor, 0 Trivial**.

### Round 1 finding adjudication

#### Major 3 — The production routed bridge hardcodes the leaf contract for every canonical agent Action: `resolved`

**Rationale:** `workerContract` is now a closed `leaf | evaluate` discriminator. Every newly resolved policy stage freezes it explicitly; only an AtomicStage that is the `judge` phase of an immutable Definition `BoundedLoop` whose `goalCycleVariant` is `evaluate` receives `evaluate`, while all other native, compatibility-remapped, and default stages receive `leaf`. The field is inside the effective-policy digest and therefore the runtime-profile digest, is copied into the canonical agent Action and canonical Record, and is preserved whenever the frozen profile builds a new attempt. Historical profiles and Actions remain decodable because the field is optional at decode, but a routed historical Action without it fails before Route Lease acquisition. Both the Claude and Codex production runners consume the Action value and validate the incompatible leaf/evaluate payload schemas.

**Anchors:**

- `src/core/worker-contracts.ts:38-63`
- `src/core/pipeline-registry/profile-resolver.ts:556-626`
- `src/core/pipeline-registry/profile-resolver.ts:699-720`
- `src/core/pipeline-registry/profile-resolver.ts:850-909`
- `src/core/pipeline-registry/execution-plan-internal.ts:297-320`
- `src/core/pipeline-registry/execution-plan-internal.ts:391-414`
- `src/core/change-run/contracts.ts:280-295`
- `src/core/change-run/internal/actions.ts:140-183`
- `src/core/frozen-action-executor/executor.ts:204-263`
- `src/core/frozen-action-executor/production-executor.ts:205-329`
- `test/core/management-api/frozen-action-executor.test.ts:339-393`

**Adversarial test assessment:** The real Management API test is contract-discriminating for both fake processes. Each fake emits `{ satisfied, gaps, summary }`; the strict leaf parser rejects that shape, so the expected successful evaluate payload cannot be produced if either bridge still selects leaf. The tests also prove a real child process and real lease create/release. Action/profile tests cover closed decode, historical absence, digest changes, Action propagation, and evaluate-judge-only derivation. The committed/granted test proves the new discriminator comparison itself, but does not prove equality of the rest of the Action; that separate failure is Major 4 below.

#### Minor 1 — Routed hosted turns bypass `TurnLimits.maxInputBytes`: `resolved`

**Rationale:** SessionHost and routed hosted execution now call the same `validateTurnInputBytes()` helper, whose policy is the exact `Buffer.byteLength(input, 'utf8') > maxInputBytes` comparison and stable typed message. The production executor invokes it after authority/backend selection but before `routedActionLifecycle.execute()`, so failure precedes lease creation. The direct process bridge repeats the same helper before binary resolution or spawn as defense in depth. The Management API multibyte case uses three UTF-8 cats against an eight-byte limit and requires typed non-retryable `invalid-input`, no daemon requests, no active lease, and no process marker.

**Anchors:**

- `src/core/session-host/contracts.ts:268-280`
- `src/core/session-host/contracts.ts:318-375`
- `src/core/frozen-action-executor/executor.ts:221-255`
- `src/core/frozen-action-executor/production-executor.ts:216-245`
- `test/core/frozen-action-executor/production-executor.test.ts`
- `test/core/management-api/frozen-action-executor.test.ts:395-446`

### Regression adjudication for the original findings

- **Original Major 1 remains resolved.** The Management API still constructs `createProductionRoutedTurnExecutor()`, supplies it to the hosted seam, and reaches both real runner bridges under the shared lease lifecycle. There is no default-credential/native fallback. Major 4 concerns accepting a caller-mutated Action before this otherwise-real wiring, not a regression to missing wiring.
- **Original Major 2 remains resolved.** The lifecycle still converts a callback success observed after external abort into `cancelled`, retains route-loss precedence, and performs best-effort release exactly once. Round 2 did not alter that settlement sequence.

### New findings

#### Major 4 — Partial Action equality lets a caller retarget committed routed execution after admission

**Anchors:**

- `src/core/frozen-action-executor/authority.ts:92-129`
- `src/core/frozen-action-executor/authority.ts:166-195`
- `src/core/frozen-action-executor/authority.ts:243-248`
- `src/core/frozen-action-executor/executor.ts:204-207`
- `src/core/frozen-action-executor/executor.ts:255-263`
- `src/core/frozen-action-executor/omnicross-lifecycle.ts:64-110`
- `src/core/frozen-action-executor/production-executor.ts:205-329`
- `src/core/management-api/frozen-action-executor.ts:153-159`
- `src/core/management-api/frozen-action-executor.ts:212-223`

**Failure scenario:** Admit and grant a routed Action, then call the Management API with a strictly decodable Action that retains its action/run/invocation/node/attempt IDs, profile/policy/result/evidence digests, capability contract tuple, worker contract, effects, and expected workspace, but changes `agent.inference` (for example endpoint/upstream/model/connection identity), `agent.runtime`, `agent.model`, `agent.sandbox`, `agent.reasoningEffort`, `agent.input`, or session authority. `sameActionIdentity()` and `sameAuthority()` compare none of those fields. Validation returns `dispatched`, returns the caller's `grantedAction`, and dispatch uses that same caller object to decide whether routing applies, create the lease, choose runtime/model/sandbox/effort, and construct the child environment. The committed Record's full Action is never substituted. Action IDs do not close the gap because their derivation does not include these agent execution fields.

**Why Major:** The canonical Record is supposed to be the immutable execution authority. This bypass permits post-admission route retargeting and execution-policy mutation while reporting that the granted view matches the Record. It directly violates the frozen inference and Action-authority contracts and can redirect a committed attempt to different non-secret route identity/configuration. Compare the full canonical Action (or dispatch the committed Action after exact receipt validation), and add independent mismatch tests for every execution-bearing agent field, especially `inference`, runtime/model/sandbox/effort/input/session.

#### Minor 2 — Result sanitization silently drops valid evaluate gaps after the first 100

**Anchors:**

- `src/core/worker-contracts.ts:47-58`
- `src/core/agent-diagnostics.ts:23-42`
- `src/core/agent-diagnostics.ts:65-70`
- `src/core/claude/runner.ts:158-185`
- `src/core/codex/runner.ts:441-476`
- `src/core/frozen-action-executor/production-executor.ts:291-327`

**Failure scenario:** A routed evaluate judge returns a schema-valid result with more than 100 legitimate `gaps`. `EvaluateGateZodSchema` places no array maximum on `gaps`, so the runner accepts the complete result. `sanitizeAgentDiagnosticValue()` then applies diagnostic bounding to every array with `slice(0, 100)` and casts the changed structure back to its original generic type. The production bridge sanitizes the result again before returning it. The Action outcome therefore silently omits gap 101 onward despite claiming a validated `EvaluateGateResult`.

**Why Minor:** The boolean decision survives and the first 100 gaps remain, but valid structured decision data is silently erased at the canonical result boundary. Secret sanitization should redact strings/keys without diagnostic truncation for typed worker results, or the worker schema must declare and enforce an explicit bound before validation. Add a result-preservation test with more than 100 gaps and nested secret-bearing strings.

### Compatibility, digest, and API checks

- The optional field preserves decode compatibility for historical profiles and Actions. Newly resolved profiles explicitly populate it, while historical routed Actions fail closed before leasing and historical unrouted Actions keep their prior path.
- Because `workerContract` is part of normalized policy, existing digest domains bind it without a digest-version fork; leaf/evaluate mutations change both policy and profile digests, and decoding recomputes all stored digests.
- The Management API success envelope was already typed with `result: unknown`; adding an optional typed worker payload inside `ExecutionDispatchResult` does not widen that public response declaration.
- Strict worker schemas reject cross-contract payloads and unknown properties. No route token, Admin credential value, provider credential, child launch environment, or live lease descriptor was added to frozen state.

### Round 2 checks and outcomes

| Check | Outcome |
| --- | --- |
| Full-tree `git diff --check` | Passed (exit 0); Git emitted only LF→CRLF working-copy warnings. |
| Independent focused Vitest rerun | Requested, but terminal permission approval was not granted; no independent pass is claimed. |
| Supplied LEAD `pnpm exec tsc --noEmit` | Reported exit 0. |
| Supplied LEAD `pnpm build` | Reported exit 0. |
| Supplied LEAD seven-file focused suite | Reported 117/117 passing. |
| Definition → profile/digests → Action/Record → retry/reconciliation → both runners trace | Completed; Major 3 is resolved. |
| Shared UTF-8 helper → pre-lease check → direct-runner defense-in-depth trace | Completed; Minor 1 is resolved. |
| Full committed/granted Action authority trace | Completed; produced Major 4. |
| Structured evaluate-result preservation trace | Completed; produced Minor 2. |

### Round 2 open Blocker/Major findings

- **Major 4:** Require the caller's complete execution-bearing Action authority to equal the committed canonical Action, or execute the committed Action after exact validation; add discriminating inference/runtime/model/sandbox/effort/input/session mismatch tests.

There are **no open Blockers**. Major 3 and Minor 1 are resolved, and original Major 1/Major 2 remain resolved; the change remains not ready because Major 4 is open.

### Round 2 durable planning takeaways

1. Comparing a newly added authority discriminator is insufficient if the executor still consumes unvalidated neighboring fields from the caller's Action; validate or replace the complete Action at the canonical boundary.
2. Structured secret redaction and diagnostic-size bounding are different operations. Do not cast a structurally truncated value back to a validated result type.
3. Real process tests should mutate each execution-bearing Action field independently, not only the field added by the current fix round.

## Round 3 re-review

### Final verdict

**Not ready to ship.** Round 3 resolves Minor 2 and closes the caller-Action-copy portion of Major 4, but **Major 4 remains open** because the shipped Management API accepts an independent caller-authored `turnInput` and executes it as the runtime prompt without deriving or validating it against the committed Action's frozen `agent.input`. The complete Action equality therefore does not make the canonical Record the complete work-execution authority.

### Final severity counts

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| Major | 1 |
| Minor | 0 |
| Trivial | 0 |

### Major 4 — Complete Action equality still leaves a caller-controlled execution-input side channel: `open`

**Anchors:**

- `rasen/specs/frozen-action-session-executor/spec.md:6-14`
- `rasen/changes/omnicross-inference-routing/specs/frozen-action-session-executor/spec.md:31-42`
- `src/core/frozen-action-executor/authority.ts`
- `src/core/frozen-action-executor/executor.ts:102-120`
- `src/core/frozen-action-executor/executor.ts:255-282`
- `src/core/frozen-action-executor/production-executor.ts:275-317`
- `src/core/management-api/frozen-action-executor.ts:169-170`
- `src/core/management-api/frozen-action-executor.ts:212-223`
- `test/core/management-api/frozen-action-executor.test.ts:102-115`
- `test/core/management-api/frozen-action-executor.test.ts:283-525`

**What Round 3 correctly fixed:** Both the caller receipt and committed Record Action pass the closed `RunAction` decoder, and `sameCanonicalAction()` compares their complete `canonicalJson()` representations. Canonicalization sorts object keys, preserves array order, includes every defined field, and treats omitted and decoded-`undefined` optional properties alike. Under the JSON-only strict Action schemas this introduces no meaningful false equality. A future additive field enters the comparison automatically when it enters the strict decoder. Successful validation returns `committed.action` by object identity, and the executor uses that Record-owned object for route selection, worker-contract selection, lease acquisition, runtime/model/sandbox/effort selection, and both routed and unrouted backend dispatch. The authority unit matrix discriminates 18 independently decodable agent-field mutations, including inference and `agent.input`; the shipped-face matrix discriminates eight representative mutations before lease/process. Historical matching omissions remain compatible, while a historical routed Action without `workerContract` still fails closed. Retries remain separately admitted canonical Actions/attempts and do not weaken the equality check.

**Remaining failure scenario:** Commit an agent Action whose `agent.input` represents workload A, then submit an otherwise byte-equivalent/strictly decoded receipt through `POST /api/v1/frozen-action-executor/dispatch` with `turnInput` containing workload B. The handler validates only that `turnInput` is a non-empty string, passes it independently to the executor, and the executor forwards it as the process prompt. Neither complete Action equality nor substitution of `committed.action` compares, derives, or authenticates this value. The backend therefore receives the correct committed Action metadata while executing caller-selected work B. The source comment that `turnInput` “forwards the frozen Action's authored input verbatim” is not enforced; `turnInput` is not read from `action.agent.input` at all.

**Why this remains within Major 4:** The governing executor requirement says the backend receives the frozen Action and that no authority is rebuilt from caller input. The Round 3 delta expressly names Action `input` as part of complete execution authority. The independently supplied string is the actual Claude/Codex work prompt, so labeling it a pre-existing “driver-rendered” interface does not put it outside the finding: no trusted renderer identity, digest, deterministic derivation, or equality proof binds that rendering to the Record. The current real-face mutation tests change `agent.input`, but keep exercising arbitrary `turnInput`; they prove metadata substitution is closed, not that committed work input is authoritative.

**Required strategy-level repair:** Remove caller freedom at this boundary by deriving the executable prompt from the committed `agent.input`, or freeze and authenticate the exact rendered prompt (or a canonical rendering contract/digest) in the Action and validate it before lease/process. Then add a shipped-face mutation that keeps the complete Action receipt equal while changing only the request's rendered input and proves rejection or committed-input execution. This is why the configured-cap post-review ladder needs a strategy-level authority redesign rather than another field-list patch.

### Minor 2 — Typed result sanitization truncates schema-valid data: `resolved`

**Rationale:** `sanitizeAgentDiagnosticValue()` now uses a separate structure-preserving traversal. It does not apply breadth limits, depth limits, array slicing, field dropping, or byte truncation; those remain confined to diagnostic rendering. Explicit in-memory secrets are replaced in every string at arbitrary array/object depth. Claude and Codex both validate the provider value under the strict leaf/evaluate schema before successful receipt propagation, each runner applies the structure-preserving sanitizer, and the production bridge repeats only that same non-truncating operation. The two real fake-process Management API cases each return 105 ordered evaluate gaps, echo a route token in every gap and summary, reparse the final outcome with `EvaluateGateZodSchema`, require gaps 1 and 105, and prove the complete response excludes the token.

Cycles and non-JSON values are outside the strict worker-result schemas; the defensive `WeakMap` does not enlarge that contract. The structured helper's sensitive-key shortcut applies directly only to string values, but every schema-valid leaf/evaluate payload consists solely of fixed scalar string/boolean fields and a string array. Arbitrary sensitive-key objects cannot survive strict result validation, while explicit configured secrets are recursively removed from all allowed strings. No reachable typed-result leak or preservation defect follows from that implementation nuance.

### Regression and new-finding adjudication

- **Original Major 1 remains resolved.** The Management API still constructs the real routed production bridge, and both Claude and Codex fake-process tests traverse lease create, process execution, result parsing, and lease release without credential fallback.
- **Original Major 2 remains resolved.** Post-settlement cancellation authority, route-loss precedence, and best-effort single release are unchanged by Round 3.
- **Major 3 remains resolved.** The Record-owned Action's frozen `leaf | evaluate` discriminator still selects the strict result schema; historical routed absence still fails before leasing.
- **Minor 1 remains resolved.** The shared exact UTF-8 input-byte guard still runs before lease/process on the routed hosted path.
- No separate new Blocker, Major, Minor, or Trivial finding survived adversarial review. The remaining `turnInput` defect is the still-open execution-input portion of Major 4, not a newly numbered finding.

### Test-path and supplied-evidence accounting

The requested files `test/core/claude/result.test.ts` and `test/core/codex/result.test.ts` do not exist and were not collected. Relevant direct contract/result coverage lives in the actual Claude/Codex runner suites, while the Round 3 real-process Management API cases are the stronger end-to-end proof for result preservation because they cross both process bridges and revalidate the final canonical outcome.

| Check | Outcome |
| --- | --- |
| Supplied LEAD `pnpm exec tsc --noEmit` | Reported exit 0. |
| Supplied LEAD `pnpm build` | Reported exit 0. |
| Supplied focused command | Requested 9 paths, but Vitest collected 7 files and reported 133/133 passing. |
| Collected file accounting | OmniCross 42; production executor 18; authority 35; agent diagnostics 4; Actions 10; Management API 15; execution plan 9. |
| Nonexistent/uncollected paths | Claude result test and Codex result test are not counted. |
| Independent Round 3 dynamic rerun | Not performed; this report does not convert supplied LEAD evidence into an independent run claim. |

### Final open and accepted-known lists

- **Open Blockers:** none.
- **Open Majors:** Major 4 — caller-controlled `turnInput` can retarget the actual runtime prompt despite complete committed-Action equality.
- **Accepted-known Minors:** none.
- **Accepted-known Trivials:** none.

### Round 3 durable planning takeaways

1. Authenticating an Action object is not complete execution authority when a sibling request field supplies the bytes the worker actually executes; bind rendered work input at the same canonical boundary.
2. A comment describing request input as frozen or verbatim is not an authority proof. Require derivation, a frozen value, or a digest-backed rendering contract and mutate the request field independently.
3. Keep validated structured-result preservation separate from bounded diagnostics; validate first, redact allowed strings without shape changes, and revalidate at the shipped face.

## Round 5 re-review — the atomic publication path

> Scope note: Round 4 was conducted but its verdict was never appended to this
> file, so this report jumps from Round 3 to Round 5. Round 4 returned one
> residual **Major** (lost update through a shared, deterministic staging path)
> plus four **Minors** on the same publication primitive. Round 5 adjudicates
> the fix for those five findings. It does not re-open Rounds 1-3.

### Verdict

**The Round 4 Major is RESOLVED. All four Round 4 Minors are RESOLVED. No Blocker
or Major remains on this path.** Six new findings, all Minor or Nit; none blocks
ship. N4, N5 and N6 have since been fixed; N1, N2 and N3 are accepted as known
non-blocking Minors with follow-ups recorded below.

### Round 5 severity counts

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| Major | 0 |
| Minor (accepted-known) | 3 |
| Minor (fixed this round) | 2 |
| Nit (fixed this round) | 1 |

### Delta reviewed

Uncommitted, worktree `…/OpenSpec-code-wt-omnicross-inference-routing`:

| File | Insertions |
| --- | ---: |
| `src/core/change-run/internal/publish-atomic.ts` | +94 |
| `src/core/change-run/internal/run-store-fs.ts` | +113 |
| `test/core/change-run/fault-journeys.test.ts` | +145 |
| `test/core/change-run/publish-atomic.test.ts` | +110 |

`run-store-fs.ts` was not previously in this change's delta, and the fix changed
the **production publication verb** (`existsSync` precheck + `renameSync` →
`linkSync` + best-effort `unlinkSync`), not only the staging name. Both were
reviewed as new surface rather than as an extension of Round 4.

### Q1 — What the publication verbs actually do (measured on this host)

Measured directly on win32 / NTFS, Node v24.14.0, earlier in this session:

| Operation | Measured result |
| --- | --- |
| `renameSync(a, t)` where `t` exists | **REPLACED** — `t` becomes `a`'s content, no error |
| `linkSync(a, t)` where `t` exists | **THREW `EEXIST`**, `t` unchanged |
| `linkSync(a, t)` where `t` absent | created; `nlink=2`, same inode as `a` |
| `unlinkSync(a)` after the link | `t` survives, `nlink=1`, content intact |
| write through a surviving staging name | **the published target's content changes** |
| `linkSync` on the repo volume (E:) and on machine home (C:) | OK, `nlink=2` on both |

So the new comment at `run-store-fs.ts:41-50` is accurate and the claim it
retracts ("Windows rename fails on a present target") was wrong: Node's rename
replaces on both platforms, because libuv passes `MOVEFILE_REPLACE_EXISTING`.
`link(2)` is necessary (rename cannot express exclusive-create) and sufficient
(one step, `EEXIST`).

**Portability: no new filesystem requirement.** `runtime-context.ts:223-224`
constructs the RunStore and the EvidenceStore on the same `input.storeRoot`, and
`evidence-store-fs.ts:536-543` already hard-requires `link(2)` there with no
fallback (any non-`EEXIST` code throws `pathUnsafe`). A Store root that cannot
hard-link (FAT32/exFAT, some SMB/CIFS, FUSE/cloud-sync mounts) was already broken
before this change. The "matching the EvidenceStore policy" claim at
`run-store-fs.ts:37-39` is true for the **verb**; it is not true for the
surrounding guards — see N1, N2 and N3.

### Q2 — Is the lost-update class closed, or only the reported instance?

Every path by which two publishers can reach the same Record version, walked:

1. `run-store-fs.ts:152` `headVersion !== -1` → `:158` `publish` — TOCTOU, resolved
   at the link. A loser with different bytes gets a typed `publish_target_exists`.
2. `run-store-fs.ts:175-186` version-gap + predecessor-digest checks → `:187`
   `publish` — same shape, same resolution.
3. `publish-atomic.ts:134` entry `exists` — check-then-act, but the act is now
   exclusive, so a target appearing inside that window lands in `:145-153`.
4. `publish-atomic.ts:148` `exists` → `:150` `readFinal` — now closed as a *typed*
   failure (`publish_target_unverifiable`) instead of a raw filesystem error.
5. `publish-atomic.ts:139` `writeStaging` → `:144` `publish` — closed by staging
   name uniqueness. **This was the Round 4 Major.**

**No remaining window produces a false success receipt. The class is closed, not
just the instance.**

One residual, pre-existing and unchanged by this delta: two processes creating a
Run with *byte-identical* v0 both succeed (one `published`, one `alreadyPresent`)
and both proceed as if they created it. Publication cannot distinguish them — the
bytes are the same Record — and the workspace reservation registry is in-memory
and per-process, so cross-process double-start is not excluded here. Before the
change both renames also succeeded, and `run-store-fs.ts:146` discards the
result, so no caller behaviour changed.

### Q3 — `writePlan`'s swallow

`run-store-fs.ts:197-215` swallows **only** `PublishError`; raw I/O failures
(`ENOSPC` on `writeStaging`, `EPERM`/`ENOTSUP` on `linkSync`) still propagate at
`:214`. It cannot mask a write failure. A mismatched `plan.json` cannot cause a
wrong resume: `src/commands/pipeline.ts:387-407` requires a plan and cross-checks
`runId`, `pipeline`, `planDigest`, `sourceRevisionDigest`, `capabilityDigest`,
`policyDigest` and `profileDigest` against the Record, throwing
`invalid_run_request` on mismatch. This is consistent with the store's other plan
handling (`loadPlan` → `null` on corrupt at `:223-225`; `list()` isolates
unreadable revisions at `:245-247`) and does not relax the Record path.
**Correct** — but the comment that justified it was false; see N4.

### Q4 — Exporting `FILESYSTEM_PLUMBING`

Warranted, and it widens nothing that matters.
`src/core/change-run/index.ts` does **not** re-export `internal/run-store-fs.js`
(it exports only `contracts`, `facade`, `runtime-context` and
`association-ledger-store`), so `src/core/index.ts`'s `export *` cannot reach it.
`package.json` `exports` declares a single `"."` subpath, so external consumers
cannot deep-import it at all. The module is already deep-imported in-repo by
`src/commands/pipeline.ts:131`. The exported value is a frozen, state-free object.

### Q5 — Staging lifecycle

- **Collision**: not credible — `publish-atomic.ts:72-76` composes pid, a
  monotonic per-process counter, and a 128-bit nonce.
- **Mistaken for a Record**: no. The head filter `^record-v(\d+)\.json$`
  (`run-store-fs.ts:123`) is `$`-anchored; `loadPlan` matches `plan.json` exactly
  (`:219`); `list()` iterates directories only (`:230`).
- **Leak**: yes, and newly unbounded — see N2.
- **Mutable alias**: newly possible — see N1.

At review time there was zero `.staging` residue in the machine store (`~/.rasen`).

### Q7 — Nothing previously clean was weakened

Both `assertIdempotentTarget` call sites survive (`publish-atomic.ts:135` and
`:150`) and the comparison itself is strictly stronger than Round 4's. The verb
change makes the byte-equality guard *more* reachable, not less: a losing
publisher now always reaches the catch instead of silently replacing the target.
No authority property confirmed in Rounds 1-3 touches this module.

### Round 4 finding adjudication

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| Major | Shared staging path → lost update | **RESOLVED** | `publish-atomic.ts:56-76` (`stagingPathFor`); both production call sites use it (`run-store-fs.ts:144`, `:198`); contract pinned at `publish-atomic.ts:40` and `:43-51`; regression at `fault-journeys.test.ts:381-421` reproduces the exact Round 4 interleaving |
| Minor | `writePlan` aborted `start()` on a conflicting target | **RESOLVED** | `run-store-fs.ts:197-215` |
| Minor | Unreadable target leaked a raw filesystem error | **RESOLVED** | `publish-atomic.ts:96-110`; covered by `publish-atomic.test.ts:95-116` |
| Minor | Byte comparison only exercised at equal length | **RESOLVED** | `publish-atomic.test.ts:67-91` — equal-length, longer-shared-prefix, and proper-prefix rejections |
| Minor | No coverage for a losing publisher with different bytes | **RESOLVED** | `publish-atomic.test.ts:118-148`; `fault-journeys.test.ts:328-349` |

### New findings (Round 5)

#### N1 — Minor — an orphaned staging link is a writable alias to a published Record: `accepted-known`

**Anchors:** `src/core/change-run/internal/run-store-fs.ts:83-90`;
`src/core/change-run/internal/evidence-store-fs.ts:591-600`;
`src/core/change-run/internal/evidence-store-fs.ts:328-394`.

`publish` does `linkSync(stagingPath, targetPath)` at `:85` and then a
best-effort `unlinkSync(stagingPath)` at `:89`. If that unlink fails, or the
process dies between the two calls, the published Record keeps `nlink === 2` and
the surviving staging name is a **writable alias** to it — measured on this host:
writing through the staging name changes the published target's bytes. Under
`renameSync` the staging name vanished in the same syscall, so no alias could
exist. The cited precedent guards exactly this: `evidence-store-fs.ts:591-600`
asserts `published.nlink === 1` after publication and fails closed, and `:328-394`
recovers the two-link topology by sweeping the companion. `run-store-fs.ts`
adopted the verb without either guard. Exploitability is low (per-attempt names,
never reused by a retry), but "immutable publication" is now a convention rather
than a physical property.

#### N2 — Minor — unbounded staging residue with no sweep: `accepted-known`

**Anchors:** `src/core/change-run/internal/publish-atomic.ts:72-76`;
`src/core/change-run/internal/run-store-fs.ts:120-127`;
`src/core/change-run/internal/run-store-fs.ts:227-251`.

`stagingPathFor` mints a fresh name per attempt, so every crash between
`writeStaging` (`publish-atomic.ts:139`) and `publish` (`:144`) now leaves a
permanent file. The old deterministic name was reused and therefore
self-limiting: one residue per target, truncated by the next attempt. Nothing in
`src/` deletes run-store `.staging` files; the only sweep in the tree is
`evidence-store-fs.ts:328-394`. `headVersion` does a `readdirSync` of the run
directory on every `has`/`load`/`commit`/`create` (`run-store-fs.ts:120-127`) and
`list()` repeats it per Run (`:227-251`), so residue is a direct read-path cost.
Correctness is unaffected — residue is inert to every read path.

#### N3 — Minor — the new verb's platform failure is untyped: `accepted-known`

**Anchors:** `src/core/change-run/internal/run-store-fs.ts:85`;
`src/core/change-run/internal/publish-atomic.ts:145-153`;
`src/core/change-run/internal/publish-atomic.ts:19`;
`src/core/change-run/internal/evidence-store-fs.ts:536-543`.

`run-store-fs.ts:85` lets any `linkSync` error escape, and
`publish-atomic.ts:145-153` only converts it when the target turns out to be
present; otherwise it rethrows raw at `:153`. On a link-less filesystem the user
therefore sees a bare `EPERM`/`ENOTSUP: link '...'` surfaced through the generic
pipeline error detail. This is the same defect class as the
`publish_target_unverifiable` Minor just fixed, left in place for the more likely
failure mode; the precedent classifies it (`evidence-store-fs.ts:536-543`). Note
that `publish_staging_corrupt` (`publish-atomic.ts:19`) is declared and **never
thrown** — zero other occurrences in `src/` or `test/`.

#### N4 — Minor — the comment justifying the `writePlan` swallow was false: `fixed`

**Anchor at time of finding:** `src/core/change-run/internal/run-store-fs.ts`
(`writePlan` catch comment).

The comment claimed the swallow "keeps the pre-existing best-effort behaviour of
this write". The diff shows the previous code called `publishAtomic` bare with no
`try`/`catch`, so `publish_target_exists` propagated. The change *introduces*
best-effort behaviour; it does not preserve it. The behaviour is right (Q3); the
stated reason was not.

**Fix confirmed** at `run-store-fs.ts:199-215`: the justification now states
plainly that the write is deliberately made best-effort, that a bare
`publishAtomic` here would propagate `publish_target_exists` once the target is
byte-compared, that only the Record path must fail closed, and that raw I/O
failures still propagate. Behaviour is byte-identical to what was reviewed.

#### N5 — Minor — five stale `rename`/`wx` claims in the two files the change was about: `fixed`

**Anchors at time of finding:** `publish-atomic.ts` (the `PublishPlumbing` doc and
the `publishAtomic` contract doc, both describing "staging directory" and `wx`
(`O_EXCL`) semantics and "atomically rename into place"); `run-store-fs.ts` (the
`fsync` comment twice — "the rename itself remains atomic" / "atomicity of rename
still holds" — and `removeStaging` — "already cleaned by rename"). The production
adapter uses neither a staging directory nor `wx`, and no longer renames.

**Fix confirmed:** `publish-atomic.ts:31-36` now describes staging to a
per-attempt sibling and publishing by exclusive-create hard link;
`publish-atomic.ts:119-126` now states that idempotency is conditional on byte
equality and drops the rename claim; `run-store-fs.ts:66-70` and `:76` now say
exclusivity is a property of the link, not the flush; `run-store-fs.ts:92` now
reads "absent or already dropped after the link". No executable line changed.

#### N6 — Nit — one test asserted less than its name: `fixed`

**Anchor at time of finding:** `test/core/change-run/fault-journeys.test.ts`, the
"production publish verb refuses an existing final" case, which used a bare
`toThrowError()` with no matcher — so *any* throw satisfied it. Separately,
`publish-atomic.test.ts` computed a basename with a hard-coded `/`, which worked
only because the fixture path is a POSIX literal.

Credit where due: the comment at `fault-journeys.test.ts:356-363` is unusually
honest that the test cannot distinguish `link` from a prechecked rename, and that
self-limitation is accurate.

**Fix confirmed:** `fault-journeys.test.ts:373-375` now pins
`expect.objectContaining({ code: 'EEXIST' })`, `:376` keeps the winner's bytes
assertion, and `:378` adds a new assertion that the loser's staged bytes were not
published under any name. `publish-atomic.test.ts:192` now splits on
`Math.max(lastIndexOf('/'), lastIndexOf('\\'))`, so the head-filter assertion at
`:193` holds under a Windows separator. `fault-journeys.test.ts:368-369` also
writes its residue under the real `stagingPathFor` grammar rather than a
hand-written name. Both changes are strictly stronger; neither relaxes a guard.

Still uncovered after the fix: no test places `.staging` residue in a real run
directory and asserts that `headVersion`/`list()` ignore it.

### Q6 — mutation discrimination: NOT EXECUTED

The four mutation-discrimination checks were **not run**. Test execution was
unavailable for the whole of this session's write-access run: every invocation
shape for the runner (`pnpm exec vitest`, `pnpm -C <abs> exec vitest`, `npx
vitest`, `pnpm --version`, `node -e`, with and without a pipe, under both the
Bash and PowerShell surfaces) was refused at the permission layer, while
`node --version` and `git` commands passed. The worktree's `node_modules`
resolves into the parent repository, outside this session's allowed working
directory, which is consistent with the refusals. Mutating source without being
able to run the suite would have produced risk (mutation residue) and no
measurement, so no source was mutated.

The table below is therefore **static prediction, not measurement**. It is
recorded so the next run can falsify it directly; no entry should be cited as a
receipt.

| # | Mutation | Claimed red | Static prediction | Predicted failing tests |
| --- | --- | ---: | --- | --- |
| 1 | `stagingPathFor` → `return \`${targetPath}.staging\`` | 2 | **consistent** | `publish-atomic.test.ts:176` "never repeats a staging path for the same target" (`new Set(paths).size` becomes 1); `fault-journeys.test.ts:381` "a publisher interleaved between staging and publish keeps its OWN bytes" (`expect(stagingA).not.toBe(stagingB)` at `:395`) |
| 2 | `bytesEqual` → length-only | 4 | **consistent — my Round 5 count of 3 was the undercount** | `publish-atomic.test.ts:60` (same-length `{"record":2}` accepted); `publish-atomic.test.ts:118` "rejects a publish race when the winner committed different bytes" (same-length winner accepted in the catch path); `fault-journeys.test.ts:328` (same-length loser accepted); `fault-journeys.test.ts:381` (B's `{"record":"B"}` is the same length as A's `{"record":"A"}`, so `:415` no longer throws) |
| 3 | `bytesEqual` → prefix-only, loop bound `left.byteLength`, no length guard | 1 | **consistent** | `publish-atomic.test.ts:60` only — the longer-shared-prefix case at `:77-83` is accepted; the equal-length and proper-prefix cases in the same `it` still reject, and every other site differs inside the shorter prefix |
| 4 | production verb → bare `renameSync` | 1 | **consistent** | `fault-journeys.test.ts:351` "the production publish verb refuses an existing final instead of replacing it" only. Every other call site reaches `publishAtomic`'s entry `exists` guard first, and the tests that use the file-local `realFilesystemPlumbing` mirror are not affected by a mutation to `FILESYSTEM_PLUMBING` at all |

**On the claim-2 discrepancy specifically:** Round 5 reported being able to locate
only three candidate tests and flagged that a fourth would have to lie outside the
two files under review. That was wrong, and the error was mine, not the claim's.
The fourth is `publish-atomic.test.ts:118-148`: its plumbing double throws from
`publish` and *then* reports the target present, so control reaches
`assertIdempotentTarget` through the catch at `publish-atomic.ts:148-151`, where a
length-only comparison of `{"record":2}` against `{"record":1}` returns true and
the expected `publish_target_exists` is never thrown. All four predicted failures
are inside the two files under review; no wider scope is required. **The claim of
4 is right, for the reason implied.** This remains a prediction until executed.

### Test state

| Claim | Result |
| --- | --- |
| `test/core/change-run/` = 73 files / 714 tests green | **CONFIRMED** — 73/73 files, 714/714 tests, 347.68s, measured earlier in this session |
| `pnpm exec tsc --noEmit` clean | **CONFIRMED** — exit 0, measured earlier in this session |
| `capstone-journeys.test.ts` passes in isolation "~15s" | **Passes in isolation** (2/2) but took **45.08s wall / 34.15s in tests**. Against a 30s per-test timeout the margin is thinner than the claim implies. |
| Full suite 8176 passed / 59 skipped / 1 failed | **NOT RUN** |
| Post-correction re-run | **NOT RUN** — see the caveat below |

**Caveat that must not be lost:** the green run above predates the N4/N5/N6
corrections. Those corrections changed one production comment block (no
executable line) and *added* assertions at `fault-journeys.test.ts:373-375`,
`:378` and `publish-atomic.test.ts:192-193`. **Those new assertions have never
been executed.** They are the strongest guards on this path and their green
status is currently assumed, not measured. Re-running
`test/core/change-run/publish-atomic.test.ts` and
`test/core/change-run/fault-journeys.test.ts` is the minimum next action.

### Round 5 open and accepted-known lists

- **Open Blockers:** none.
- **Open Majors:** none on this path. (Major 4 from Round 3 is a separate
  authority finding and is not re-adjudicated here.)
- **Accepted-known Minors:** N1 (writable staging alias to a published Record),
  N2 (unbounded staging residue, no sweep), N3 (untyped link failure on
  link-less filesystems).
- **Fixed this round:** N4, N5, N6.

### Recommended follow-ups (none blocking)

1. **N1 + N2 together.** After `linkSync` succeeds, assert `nlink === 1` on the
   target and fail closed, mirroring `evidence-store-fs.ts:591-600`; and/or sweep
   siblings matching the staging grammar on `ensureDir`, mirroring
   `evidence-store-fs.ts:328-394`. One guard closes both the writable-alias
   window and the residue accumulation.
2. **N3.** Classify non-`EEXIST` link errors into a typed `PublishError` — either
   the declared-and-unused `publish_staging_corrupt` slot or a new code — so a
   Store root that cannot hard-link produces an actionable message instead of a
   raw `ENOTSUP`.
3. **Coverage gap.** Add a test that places `.staging` residue in a real run
   directory and asserts `headVersion` and `list()` ignore it, closing the one
   guard the head-filter regex currently has only by inspection.
4. **Execute Q6.** Run the four mutations against the table above and replace the
   predictions with measurements. An overstated receipt is a finding; so is an
   unexecuted one.

### Round 5 durable planning takeaways

1. A fix that changes the *verb* rather than the *name* is new surface, not an
   extension of the finding it closes. `run-store-fs.ts` entered this change's
   delta for the first time and brought a filesystem requirement, a residue
   policy and an error-typing gap with it.
2. Adopting a precedent's verb is not adopting its guarantees. The EvidenceStore
   pairs `link(2)` with an `nlink === 1` assertion and a residue sweep; copying
   the link alone reproduces the atomicity and drops the immutability.
3. Comments that describe a syscall's semantics rot silently when the syscall
   changes. Five stale `rename`/`wx` claims survived inside the two files the
   change was specifically about — the diff was reviewed, the prose around it was
   not.
4. A count of failing tests is a claim about the code, and it is cheap to get
   wrong by reading. My own static enumeration undercounted mutation 2 by missing
   a catch-path test; only execution settles it.

## Round 5 — LEAD closing note

Added by the LEAD after the reviewer's final handoff. Attribution matters here:
everything above is the reviewer's independent work; this section is the author's,
and is labelled so it is never read as independent confirmation.

### Q6 — measured by the author, derived independently by the reviewer

Q6 was never independently *executed*. Two dispatches failed on the same
environmental blocker (the runner is refused at the permission layer in dispatched
workers; the worktree's `node_modules` resolves outside the worker's allowed
directory). A third attempt was judged not worth its cost. **The gap is real and is
not closed by what follows.**

What exists instead is convergence from two directions. The LEAD ran all four
mutations and logged the failing test names; the reviewer, without access to those
results, derived the same four counts statically and named the same tests. The two
agree test-for-test:

| # | Mutation | Reviewer (derived) | LEAD (measured) |
| --- | --- | ---: | ---: |
| 1 | deterministic `stagingPathFor` | 2 | 2 — same two |
| 2 | length-only `bytesEqual` | 4 | 4 — same four |
| 3 | prefix-only `bytesEqual` | 1 | 1 — same |
| 4 | non-exclusive publish verb | 1 | 1 — same |

The reviewer reached count 4 by correcting its own Round 5 undercount, finding the
catch-path test it had missed. That is the strongest part of the convergence: the
verifier revised toward the claim on its own evidence, not on the author's.

Residual limitation to carry forward: **an author-measured receipt corroborated by a
verifier's static derivation is not the same as a verifier-executed receipt.** Follow-up
4 above stays open.

### Corrections to the record

1. **The reviewer's finding that the N4/N5/N6 corrections were "never executed" is
   withdrawn on evidence.** The focused two-file suite was run after those edits
   (61/61). The reviewer could not observe this, having no test execution. Its
   underlying concern was sound, however: the 714-test directory run *did* predate
   the corrections, so it was re-run on the final tree — **73 files / 714 tests
   green, 403.33s**. The `src` corrections are comment-only; only test assertions
   changed, and only in the strengthening direction.
2. **The LEAD's "~15s" characterisation of `capstone-journeys` in isolation was a
   single idle-machine sample presented as characteristic.** The reviewer measured
   45.08s wall / 34.15s in tests for the same file. Both runs pass in isolation, so
   "flaky under parallel load, not a regression" stands, but the margin against the
   30s per-test timeout is thinner than the original claim implied.
3. **N1 was introduced by this fix, not merely surfaced by it.** Under `renameSync`
   the staging name vanished atomically and no alias could exist. Adopting `link(2)`
   without the EvidenceStore's `nlink === 1` assertion created the window. Recorded
   as accepted-known rather than fixed, on the basis that the loop's exit condition
   is no Blocker/Major and further Minor work does not terminate.

### Ship decision

Review-loop exit condition met: no Blocker and no Major remain. N1, N2 and N3 are
accepted-known non-blocking Minors with follow-ups recorded above. N4, N5 and N6 are
fixed. Verification state at ship: full suite 8176 passed / 59 skipped / 1 flaky
(`capstone-journeys` journey 3, passes in isolation); `test/core/change-run/`
714/714 on the final tree; `tsc --noEmit` clean; `git diff --check` clean.
