## Context

Rasen currently resolves a runtime and opaque model for each Pipeline stage, then dispatches Claude Code or Codex through either a host-native subagent path or an external CLI bridge. The external runners already accept a child-process environment. Codex's invocation builder also supports a custom `model_providers` override, but `RunCodexExecOptions` does not expose it and `rasen agent dispatch` has no inference-route input.

The approved baseline in `docs/architecture/omnicross-inference-routing.md` assigns Pipeline/session/agent ownership to Rasen and upstream credentials, account scheduling, protocol conversion, and resident proxy routing to OmniCross. The external dependency is the OmniCross contract in `rasen-managed-route-lease-requirements.md`: a long-lived loopback daemon exposes authenticated, versioned Route Lease create/renew/delete endpoints and returns a one-attempt runtime launch descriptor. This Rasen change consumes that contract; it does not implement or mutate the sibling OmniCross repository.

A key constraint is that same-runtime native workers cannot receive a new process environment. A Codex-hosted LEAD cannot safely give one native Codex subagent token A and another token B, and the equivalent limitation holds for Claude. Therefore a routed stage needs a controllable child-process boundary even when the target runtime equals the LEAD host.

The implementation must coexist with two execution forms already in the repository:

- legacy/autopilot run-state, where the LEAD consumes `pipeline show --for-execution`, drives the stage, and writes `auto-run.json`;
- canonical Change Run Actions, where a `RuntimeExecutionProfile` and granted `RunAction` are frozen and the frozen-action executor owns dispatch authority.

## Goals / Non-Goals

**Goals:**

- Deliver one real Rasen vertical slice from typed Pipeline inference declaration through frozen logical route, authenticated Route Lease acquisition, Claude/Codex process injection, renewal/cancellation, cleanup, resume, and redacted evidence.
- Keep the caller interface small: callers provide one credential-free frozen route and one attempt identity; the OmniCross module hides HTTP, schema validation, descriptor reduction, timers, retries, and cleanup.
- Force OmniCross-routed stages through a controllable Claude/Codex process bridge while leaving unconfigured stages on their current dispatch path.
- Preserve existing model precedence and use the already-resolved effective model as the route model, avoiding a second model source inside `inference`.
- Fail before spawning an agent whenever Rasen cannot prove the requested route and descriptor are valid.
- Make the implementation testable with an in-process fake daemon and fixture CLI while retaining an opt-in real-daemon/real-CLI smoke path for integration environments.

**Non-Goals:**

- Implementing OmniCross's RouteLeaseManager, Admin endpoints, ProviderProxy, upstream selection, transformers, or Codex `env_key` builder.
- Creating persistent OmniCross Gateway keys/bindings or invoking OmniCross terminal-launch/integration-install flows.
- Supporting remote/TLS/multi-tenant OmniCross daemons, workflow editing UI, or arbitrary user-defined ingress/transformer chains.
- Persisting or restoring live lease ids/tokens, or changing user Codex/Claude configuration and credential files.
- Enabling Codex response storage before OmniCross supports its stateful Responses semantics.
- Running paid-provider smoke tests in default CI.

## Decisions

### 1. Add `stage.inference`, but keep `stage.model` as the single model source

The Pipeline v1 stage gains this optional closed shape:

```ts
type OmniCrossUpstream =
  | { kind: 'provider'; providerId: string; keyId?: string }
  | { kind: 'account'; providerId: string; accountId: string }
  | { kind: 'account-group'; providerId: string; group: string }
  | { kind: 'account-pool'; providerId: string };

type StageInference = {
  broker: 'omnicross';
  upstream: OmniCrossUpstream;
};
```

The route model is the stage's existing effective model after the current stage → role → project → store → global → runtime-default chain. Execution preflight rejects an OmniCross stage if that resolution is empty. This keeps model presets, model-source reporting, and role overrides coherent.

Alternative A put `model` inside `inference`. It was rejected because a stage could then have two conflicting models and two resolution chains. Alternative B stored a free-form `upstreamRef` string. It was rejected because Provider keys, accounts, groups, and pools have different required identities and fallback semantics that must fail structurally before HTTP.

The registry's structural view preserves the declaration. The execution view reports safe inference plus resolved runtime/model. Legacy stage objects omit the field and remain byte-compatible in behavior.

### 2. A routed stage always uses the target runtime's exec bridge

`resolveDispatchRoute` gains inference-binding context. Without inference, the existing host × target matrix is unchanged. With OmniCross inference:

- target Claude → `exec-bridge`, `claude-print`;
- target Codex → `exec-bridge`, `codex-exec`;
- bridge availability is checked during execution preflight, including a same-host target;
- unknown hosts cannot use `legacy-fallback` for a routed stage.

This is the only route that gives each concurrent stage an isolated environment and a process tree Rasen can terminate if the lease is lost. Attempting to retrofit mutable environment into native subagent tools was rejected: those workers inherit the already-running host and would introduce process-global routing and cross-stage token leakage.

Generated `rasen-auto` orchestration instructions are updated to consume the execution view's effective dispatch route; the LEAD does not override a routed stage back to native.

### 3. Introduce one deep `core/omnicross` module

The external seam is intentionally small:

```ts
interface FrozenInferenceRoute {
  broker: 'omnicross';
  runtime: 'claude' | 'codex';
  upstream: OmniCrossUpstream;
  model: string;
  connection: {
    endpoint: string;
    controlTokenEnv: string;
    configRevision: string;
  };
}

interface RouteAttemptIdentity {
  runId: string;
  stageId: string;
  attempt: number;
  sessionId?: string;
}

async function withOmniCrossRoute<T>(
  route: FrozenInferenceRoute,
  attempt: RouteAttemptIdentity,
  run: (binding: RuntimeRouteBinding, signal: AbortSignal) => Promise<T>
): Promise<RouteExecutionResult<T>>;
```

Internally the module is split for locality, not exposed as caller policy:

- `contracts.ts`: closed Zod request/response/error/upstream schemas;
- `config.ts`: effective config normalization, loopback enforcement, environment-backed control credential lookup, and non-secret revision;
- `client.ts`: bounded authenticated HTTP create/renew/release with injectable transport/clock;
- `launch-binding.ts`: reduce the daemon descriptor to a runtime-specific allowlisted binding;
- `lease-execution.ts`: idempotency, renewal safety window, abort, final release, and safe result projection.

Deletion-test rationale: without this module, every CLI/hosted/canonical caller would need to know authentication, schemas, launch allowlists, timers, redaction, and cleanup. With it, those callers know only a frozen route and a callback.

Alternative A passed OmniCross's raw `extraArgs` directly into runners. It was rejected because a compromised or incompatible daemon could override Rasen-owned sandbox, prompt, output schema, result file, model, effort, or resume arguments. Alternative B created one thin lease wrapper in each runner. It was rejected because lifecycle and security behavior would diverge between Claude, Codex, legacy auto, and canonical execution.

### 4. Connection settings are ordinary non-secret config; the credential value is environment-only

The config registry adds these fixed keys, supported at the existing effective scopes:

- `omnicross.endpoint`: required for routed execution, normalized to an `http:` loopback origin;
- `omnicross.controlTokenEnv`: environment variable name, default `OMNICROSS_ADMIN_TOKEN`;
- `omnicross.requestTimeoutMs`: bounded local control-call timeout;
- `omnicross.leaseTtlSeconds`: optional bounded request TTL.

The frozen broker identity includes the normalized endpoint, credential environment-variable name, and a digest/revision of non-secret resolved settings. The credential value is looked up immediately before lease creation and is never frozen. Rotating the control token therefore does not change logical route identity; changing the endpoint/config revision is visible and cannot be silently substituted during an admitted Action.

Automatic daemon state-file/port discovery was considered but rejected for this slice because OmniCross has not versioned such a discovery contract. A configured loopback origin is deterministic and testable. Capability discovery, if added by OmniCross, can later deepen `config.ts` without changing callers.

### 5. Freeze credential-free routing in both execution records

For canonical runs, `RuntimeExecutionProfile` effective stages and `RunAction.agent` gain an optional closed `inference` block. It covers broker, upstream, model, runtime, and broker config identity and participates in the existing profile/Action digests. Tokens and descriptors are structurally impossible in that schema. Old records omit the optional field.

For legacy/autopilot runs, a stage entry in `auto-run.json` gains optional `frozenInference`. The LEAD writes it before the first dispatch from the authoritative execution view, and `pipeline resume` returns it with the stage frontier. A continuation uses this frozen value rather than re-resolving edited Pipeline/config route fields. A stage not yet authorized may still resolve its current declaration when it first becomes ready.

The exec-bridge CLI gets `--inference-file <path>` rather than a JSON argv string or many conditional flags. The bounded UTF-8 file contains only `rasen.inference/1` credential-free route and attempt metadata. The command cross-checks its runtime/model against the frozen document, resolves the environment credential internally, then invokes `withOmniCrossRoute`. The generated orchestration template writes the file under the change's ephemera directory using a stable named schema and never writes the create response.

Alternative A persisted the whole lease response for resume. It was rejected because it would persist the route token and a stale process binding. Alternative B re-resolved current Pipeline inference on every resume. It was rejected because edits could drift an admitted stage to a different Provider/account/model.

### 6. Reduce launch descriptors to closed runtime bindings

The create response is the only token-bearing wire object. `launch-binding.ts` validates it before process spawn:

- Codex accepts only the dedicated `OMNICROSS_CODEX_ROUTE_TOKEN` environment, the reserved `omnicross` provider name, a loopback proxy base URL, `wire_api="responses"`, `env_key="OMNICROSS_CODEX_ROUTE_TOKEN"`, and `disable_response_storage=true`. It rejects `requires_openai_auth`, `OPENAI_API_KEY`, model/prompt/sandbox/output/resume overrides, unknown `-c` keys, and any token in argv.
- Claude accepts only `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, optional non-secret `ANTHROPIC_API_KEY` sentinel, and `ANTHROPIC_MODEL` equal to the frozen model. It rejects unknown environment keys and token-bearing argv.

The typed output is `CodexRouteBinding | ClaudeRouteBinding`; a mismatched runtime cannot reach the wrong runner. `RunCodexExecOptions` gains `providerOverride` plus the merged child env, while Claude consumes only the validated env. Both fresh and exact resume paths use the same binding interface.

### 7. The lifecycle wrapper owns renewal, abort, and cleanup

Create uses an attempt-derived, bounded idempotency key. A transport timeout may retry create once with the same key; a conflicting payload never retries. The wrapper schedules renewal from the server's `expiresAt` with a safety margin, using an injectable clock. Renewal returns no token and updates only in-memory expiry.

Both runners gain optional `AbortSignal` support using their existing process-tree termination. If renewal cannot prove validity before the safety deadline, the wrapper aborts the child and returns `route-lease-lost`; it never lets the child fall through to its default login. Cancellation and runner timeout also flow through the same finalizer. Release is best-effort and idempotent; a cleanup failure adds a safe warning but does not overturn a completed structured result.

The live lease object and token remain closure-local. Receipts may project `leaseId`, broker, safe upstream, model, and expiry/status, but never `launch`, request headers, or environment values.

### 8. Secret redaction is value-aware, not only key-pattern-aware

The current diagnostic sanitizer catches bearer strings and key-shaped assignments but cannot reliably catch a random token echoed without a label. The sanitizer gains an optional explicit secret set. `withOmniCrossRoute` registers the control credential and route token for the lifetime of the attempt and passes that redactor into HTTP failures, runner spawn/output diagnostics, cleanup warnings, and receipt serialization.

Tests use unique sentinel secrets and recursively inspect every returned/persisted/logged value for absence. No code logs a create response object. Runners merge lease env into a fresh child env object and never mutate `process.env`.

### 9. Stable failures are shared, then projected into runtime receipts

The OmniCross module exposes a closed failure union covering invalid configuration/input, daemon unavailable/timeout/not-ready, control unauthorized, schema/descriptor mismatch, upstream/model/format/idempotency failures, exhaustion, expiry/loss, cancellation, and cleanup warning. It preserves only safe daemon codes and retryability.

`rasen agent dispatch` projects pre-spawn and in-flight route failures into the existing single JSON receipt discipline for the selected runtime. Canonical execution maps the same failure to its Action outcome/observation vocabulary. No caller parses daemon prose to decide fallback.

### 10. Verification uses a fake daemon vertical path plus opt-in real compatibility probes

Default CI runs an in-process loopback fake implementing create/renew/delete and a fixture Claude/Codex process. The test exercises Pipeline parse/execution view → frozen inference file/Action → HTTP lease → argv/env capture → structured completion → release, plus resume with a replacement token. Concurrency tests create two different upstream/model leases and prove child environment isolation.

Contract tests hash fixture `config.toml`, `auth.json`, Claude settings, and credentials before/after dispatch. No production code needs their paths; the test proves the integration never touches them. An opt-in smoke script is documented for a real OmniCross daemon and real CLIs after the server-side requirement is delivered. A paid upstream remains manual and explicit.

## Risks / Trade-offs

- **[OmniCross endpoint is not implemented yet]** → Build against the versioned contract with a strict fake; gate the real smoke test and report `daemon_not_ready`/unsupported version clearly.
- **[Forcing same-host routed stages through exec bridges costs process startup and loses native subagent cache behavior]** → Apply it only when `inference` is present; correctness and token isolation outrank native reuse. Exact Claude/Codex session continuation still preserves runtime conversation state.
- **[A daemon descriptor may evolve additively]** → Accept safe envelope extensions but keep launch env/argv closed; version any new launch behavior deliberately.
- **[Renewal races with process completion]** → The lease wrapper owns one abort controller, stops timers before release, and makes cleanup idempotent under an injectable clock.
- **[Older Rasen binaries cannot understand new routed Actions]** → The change is additive for old records, but a routed in-progress run must not be resumed with a binary predating this capability; document this rollback boundary.
- **[The control token is inherited by the Rasen process]** → Never forward it wholesale to the child; construct child env from the existing environment with the named control key removed and only the route binding merged.
- **[Loopback name/address validation can be subtle across IPv4/IPv6]** → Use `URL` parsing plus explicit accepted loopback hosts/addresses; do not trust forwarding headers or DNS names in this slice.
- **[Canonical and legacy execution could drift]** → Both consume the same schemas, route resolver, and `withOmniCrossRoute` module; tests run equivalent fixtures through both entry points where the existing execution scaffolding permits.

## Migration Plan

1. Land the optional schemas, config keys, safe projections, and architecture-index entries with all non-OmniCross behavior unchanged.
2. Land the OmniCross module and fake-daemon contract suite without enabling any implicit routing.
3. Wire `agent dispatch`, Claude/Codex runners, abort support, and generated orchestration instructions; route only stages that explicitly declare `inference`.
4. Wire canonical execution profile/Action and legacy run-state freezing/resume, then run compatibility tests against old Pipelines, Actions, and run-state.
5. After OmniCross ships the matching daemon endpoints and Codex `env_key` descriptor, run opt-in real Codex and Claude smoke tests against a local mock upstream before documenting production enablement.

Rollback is to remove `inference` declarations and use a prior Rasen binary for runs that never froze inference. In-progress routed Actions must be completed/cancelled with a compatible binary because their new frozen authority is intentional and must not be discarded. No credential or user CLI file migration is required.

## Open Questions

- Which OmniCross release first guarantees `/admin/api/route-leases` and `omnicross.route-lease/1`? Record that minimum compatible version when it exists.
- Will OmniCross ship a stable local capability/discovery document? If so, add it behind the existing config module rather than changing Pipeline syntax.
- What TTL bounds will the daemon publish? The Rasen config validator and fake currently need contract fixtures until the capability endpoint is available.
- Should safe usage/cost attribution later persist a hashed session id and Provider/account-pool label? This slice sends bounded execution attribution but does not add a cost UI.
- When OmniCross supports stateful Codex Responses, should `disable_response_storage` remain required or become a negotiated capability? It remains required here.

## Strategy rework after review cap: bind the driver-rendered turn input

### Problem statement and traced semantics

Round 3 made the complete committed Action the object authority but left a second, unauthenticated work channel. `RunAction.agent.input` is a `JsonValue` consumed by reconciliation as structured orchestration metadata (for example `reviewCycle`, `goalCycle`, and bounded-loop recovery state); it is not generally the executable prompt. The legacy prompt-owned driver, by contrast, composes role instructions, workflow template and skill text, artifact paths, handoff clauses, and task context into a UTF-8 prompt file. The frozen executor's sibling `turnInput: string` carries that driver-rendered base prompt through the Management API to every backend. Unrouted hosted execution sends it to `SessionHost`; routed hosted and in-tool execution pass it to the Claude/Codex process bridge. Claude and Codex then add runtime-owned contract/flat-hierarchy framing selected from the frozen `workerContract`.

Consequently, serializing `agent.input` (although it is a useful pattern for the separate reusable-session API) cannot preserve the work instructions of a general stage. Complete equality of the caller Action also cannot authorize a sibling request string. A caller can currently retain a byte-identical Action receipt for work A and execute work B by changing only `turnInput`.

### Decision 11. Freeze an exact turn-input digest in every new canonical agent Action

Use a compatibility-preserving form of approach B. Every newly admitted canonical agent Action gains this optional closed sibling under `agent`:

```ts
type FrozenAgentTurnInput = {
  format: 'agent-turn-input/1';
  mediaType: 'text/plain;charset=utf-8';
  renderingContract: 'rasen.driver-rendered-turn/1';
  utf8ByteLength: number;
  contentDigest: Digest;
};
```

The trusted execution Adapter/driver SHALL finish its existing rendering before Action admission and pass the exact driver-rendered base-prompt bytes to the Action builder. The builder computes `utf8ByteLength` and a domain-separated SHA-256 digest over the exact UTF-8 bytes (`agent-turn-input/1`, a zero separator, then the bytes), commits only the closed binding, and does not let a dispatch request nominate or replace the binding. `agent.input` remains unchanged structured JSON. The profile remains unchanged because the rendered turn is Action- and occurrence-specific; the Action already freezes capability/Adapter artifact, role/runtime/model, `workerContract`, and policy authority.

The Management API retains `turnInput` as transport for compatibility and to avoid adding a transactional prompt-blob store. For a new Action it is an assertion, not authority. After strict receipt decoding and complete equality against the committed Record, the executor computes the request string's exact UTF-8 length and digest and requires both to equal the Record-owned binding. Only the matching request bytes may proceed. Exact resume/retry therefore accepts the same rendered bytes and rejects changed role text, task text, artifact paths, normalization, newline convention, or Unicode encoding. The executor continues to derive Claude/Codex contract and flat-hierarchy suffixes from the committed runtime and `workerContract`; those runtime-owned suffixes are not caller input and the leaf/evaluate schemas do not change.

The stable route-independent rejection is:

```ts
type ExecutionInputRejectionCode =
  | 'execution_input_authority_missing'
  | 'execution_input_mismatch'
  | 'execution_input_too_large';
```

`ExecutionDispatchResult` gains `kind: 'execution-input-rejected'` with one of those codes, a safe message, and `retryable: false`. This is not projected as an OmniCross route failure: prompt authority exists before and independently of route selection.

### Authority and validation ordering

Every canonical driver face SHALL use the same order:

1. bound and decode the request, strict Action receipt, Record, workspace revision, and transport string;
2. validate complete receipt equality and obtain the Record-owned Action;
3. for a new Action, compute exact UTF-8 byte length and domain-separated digest from request `turnInput`; reject a length/digest mismatch as `execution_input_mismatch`;
4. enforce the effective turn's shared `maxInputBytes` against the authenticated bytes, and preassemble/measure any runtime-owned deterministic invocation framing where that runner's existing stdin limit applies; reject as `execution_input_too_large`;
5. select the backend and validate all remaining frozen runtime/contract authority;
6. only then acquire a Route Lease, create/resume a SessionHost generation, resolve/spawn a CLI, or write prompt/stdin bytes.

The admission builder also applies the canonical hard prompt bound so an unbounded string cannot be committed. Dispatch-time `maxInputBytes` remains authoritative for the selected production host and may be stricter. Digest comparison precedes the effective-limit result, so unauthenticated bytes never receive a policy-only acceptance path. The runner's final assembled-stdin check remains defense in depth and measures its exact final payload.

### Scope and migration boundary

The binding applies to **all newly admitted canonical agent Actions and all frozen-action backends**: hosted and in-tool, routed and unrouted. Route-dependent work authority is unacceptable because OmniCross changes transport credentials, not the identity of the work. Otherwise removing `inference` would silently remove prompt integrity, and the same Management API defect would remain on the unrouted SessionHost path.

Compatibility is explicit and asymmetric:

- a historical routed Action without `agent.turnInput` authority fails closed with `execution_input_authority_missing` before lease or process, just as unknowable routed `workerContract` authority already fails closed;
- a historical unrouted Action without the field remains decodable and retains its prior caller-rendered `turnInput` behavior; the executor does not invent a digest or stringify structured `agent.input` after admission;
- legacy/autopilot `rasen agent dispatch --prompt-file` is outside the canonical frozen-action executor and remains unchanged;
- old Action canonical bytes, Action/receipt digests, and IDs are not rewritten. Optional-field omission preserves their historical decoding and canonical bytes. New Action receipts naturally cover the new binding through complete canonical equality;
- there is no best-effort backfill. Operators that need prompt authority for old unrouted work must re-admit it as a new Action under a compatible runtime, not mutate its Record.

This narrow historical exception preserves the existing unrouted compatibility contract without making it the behavior of any newly admitted Action.

### Alternatives rejected

- **Render from committed `agent.input` at dispatch (approach A): rejected.** The value is structured control metadata and is consumed as such by bounded-loop lifecycle code. `JSON.stringify` loses the existing driver-rendered role, workflow/skill, artifact, handoff, and task instructions. Reconstructing those bytes later would also require freezing and resolving a richer content graph and renderer than the current profile carries.
- **Store exact prompt text in the Action: correct but larger than needed.** It removes the request transport assertion, but duplicates potentially large prompt bytes in every Record snapshot and request receipt and changes body/storage limits. A verified digest plus exact length authenticates the existing transport without a new blob lifecycle.
- **Add a separately committed prompt artifact/blob: deferred.** It is appropriate only if callers can no longer retransmit bounded prompt bytes. It introduces staging, garbage collection, atomic Record-to-blob commitment, availability, and recovery rules that are unnecessary for M4.
- **Validate only routed requests: rejected.** Route presence does not determine work authority, and the sibling input reaches unrouted hosted and in-tool seams too.

### Acceptance matrix for the repair

| Record/dispatch case | Required result | Discriminator |
|---|---|---|
| New routed Claude Action, matching request | Fake Claude receives the committed base prompt and validates the frozen leaf/evaluate contract | Real Management API, fake daemon and CLI |
| Same Claude receipt/Record, only request text changed | `execution_input_mismatch`; zero lease creates and zero process spawns | Action receipt remains canonically equal |
| New routed Codex Action, matching request | Fake Codex receives the committed base prompt plus runtime-owned framing | Real Management API, fake daemon and CLI |
| Same Codex receipt/Record, only request text/newline/Unicode changed | `execution_input_mismatch`; zero lease creates and zero process spawns | Exact UTF-8 digest/length comparison |
| New unrouted hosted Action | Matching text reaches SessionHost; changed-only request is rejected before host dispatch | Proves repair is route-independent |
| New in-tool Action | Changed-only request is rejected before launcher execution | Covers the second backend seam |
| Historical routed Action lacks binding | `execution_input_authority_missing`, no lease/process | No inferred/backfilled authority |
| Historical unrouted Action lacks binding | Existing caller-rendered behavior remains | Explicit compatibility boundary |
| Authenticated multibyte prompt exceeds effective bound | `execution_input_too_large`, no lease/session/process | Digest matches; only byte policy fails |
| Leaf and evaluate Actions | Existing schemas and complete typed results remain unchanged | Binding is a sibling authority field |

### Decision 12. Add a quiescent candidate-preview → trusted-render → bound-admission protocol

The complete workflow prompt cannot be rendered until the LEAD knows the exact next reconciler candidate, while a new canonical agent Action must never exist before that prompt is bound. The runtime therefore exposes a prompt-free preview without admitting the candidate. `start`, `resume-run`, `complete`, and `control` settle waits, terminal transitions, and non-agent admits, but return ready agent candidates under `receipt.candidates`; completion does not grant its agent successor.

Each closed `change-run-agent-candidate/1` descriptor contains a runtime-derived `candidateId`, Run id, canonical head Record version, node id, occurrence, optional frozen profile path, and optional structured orchestration input. The id is domain-derived from the Run id, head Record digest/version, and complete prompt-free candidate descriptor. It is neither an Action nor persisted authority. Reconciliation from the immutable RuntimePlan and unchanged Record reproduces it exactly after a crash without consulting mutable Pipeline or skill content.

The source LEAD renders its existing complete base prompt for every candidate and writes only those strings to a bounded private-ephemera `agent-turn-input-manifest/1`, keyed by `candidateId`. It then calls `rasen pipeline admit <change> --run <runId> --turn-input-file <path> --json`. Admission re-reconciles the current frontier, requires exact manifest/frontier coverage with no duplicates or extras, verifies Run/version/candidate identity, and atomically builds/admit/grants the batch. The Action builder computes the byte length and digest; the manifest cannot carry either. Prompt bodies do not enter the Record, run-state, receipt, log, or evidence.

An unchanged preview is idempotent. Any successful mutation changes the head or frontier, so an old/wrong manifest fails with typed `candidate_stale` before Action construction or mutation. A repeated successful admission therefore cannot mint a duplicate. Exact retries use the committed binding and identical bytes, not the manifest or current templates. Non-agent command/host candidates continue their prior automatic construction path; historical unrouted Actions and legacy `agent dispatch --prompt-file` retain their previous behavior.
