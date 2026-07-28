## Context

Rasen currently conflates three separate questions:

1. Which tool host is running the LEAD?
2. Which target runtime should execute a stage?
3. Which mechanism can this host use to dispatch that target?

The implementation answers only part of question 2. `resolveStageRuntimeConfig()` ultimately falls back to `claude`, and the runtime adapter registry exposes only target capabilities such as `canDispatch`. Execution preflight therefore knows that Codex is a valid target, but cannot distinguish Codex-native collaboration from a Claude-hosted `codex exec` bridge or reject a Codex-hosted request for a nonexistent Claude bridge.

The existing detector in `src/core/keepalive/index.ts` is local to `rasen agent wait`. It recognizes `CODEX_SANDBOX`, but unrestricted Codex tool shells can omit that variable while still reliably carrying `CODEX_THREAD_ID`. In the diagnosed session the environment contained `CODEX_THREAD_ID` and an inherited `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, but neither `CODEX_SANDBOX` nor `CLAUDECODE`; the current detector returned `unknown`.

Runtime provenance is also coupled incorrectly to the rest of the stage runtime bundle. `stageHasOverride` becomes true for `model`, `sandbox`, `effort`, or `sessionReuse`, so a stage that only declares `model: sonnet` is currently reported as `runtimeSource: stage` even though no stage runtime was declared. The same problem exists in role objects because `AgentRuntimeConfigSchema` injects `runtime: claude` when an object contains only a model or lifecycle field. This hides whether Claude was explicitly selected and prevents a safe host-aware fallback.

Finally, the generated orchestration playbook assumes:

- Claude workers use native Task/`SendMessage`;
- every Codex worker is an external `codex exec` process;
- every worker must send `DONE`/`HANDOFF` through an explicit message;
- repeated bounded waits are an acceptable way to join a Codex-native worker.

Codex native multi-agent collaboration instead forwards a child’s final output to the parent mailbox automatically, and `wait_agent` is an event-driven mailbox wait. The diagnosed rollout used 278 waits for 8 workers, mostly short timeouts, even though one longer wait would have woken on meaningful mailbox activity.

## Goals / Non-Goals

**Goals:**

- Detect Claude and Codex LEAD hosts once, with stable provenance and unrestricted Codex support through `CODEX_THREAD_ID`.
- Preserve all explicit runtime layers while replacing only the implicit Claude fallback with the detected host.
- Resolve runtime independently from model, sandbox, effort, and session reuse.
- Represent and validate the host × target dispatch route before workers start.
- Report host runtime, runtime source, and dispatch mode on pipeline execution inspection surfaces.
- Use Codex-native spawn/completion/wait semantics for same-host Codex stages while preserving Claude-native and external `codex exec` behavior.
- Keep threshold-scheme selection aligned with the same effective runtime used for dispatch.
- Retain a diagnosable compatibility path for commands run outside a recognized agent host.

**Non-Goals:**

- Implement a Codex-host → Claude-target bridge. That pair is unsupported until a concrete adapter exists.
- Replace or remove the shipped `codex exec` core; it remains the Claude-host → Codex-target bridge.
- Change Codex TUI rendering of wait outcomes; that issue belongs to the neighboring Codex repository.
- Add a new runtime id, model policy, threshold scheme, dependency, or persistent configuration family.
- Redesign general DAG synchronization, portfolio scheduling, or keepalive policy beyond the Codex-native completion/wait corrections required here.

## Decisions

### D1 — One structured host detector, shared by pipeline execution and keepalive

Move host detection to a runtime-core module (preferably alongside `runtime-adapters.ts`, or a focused `host-runtime.ts` re-exported from that module). It returns a structured value rather than a bare runtime:

```ts
type HostRuntime = 'claude' | 'codex' | 'unknown';

interface DetectedHostRuntime {
  runtime: HostRuntime;
  source:
    | 'env-override'
    | 'codex-thread-id'
    | 'codex-sandbox'
    | 'claude-code'
    | 'unknown';
}
```

Detection uses explicit property lookups in this order:

```text
RASEN_AGENT_RUNTIME=claude|codex
  > non-empty CODEX_THREAD_ID
  > non-empty CODEX_SANDBOX
  > non-empty CLAUDECODE
  > unknown
```

Codex precedes Claude because a nested Codex process may inherit Claude variables. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not a host fingerprint: it is project configuration and can be present in a Codex shell. An invalid `RASEN_AGENT_RUNTIME` does not fabricate a runtime; detection records a diagnostic or falls through to real fingerprints.

`detectAgentRuntime()` remains as a compatibility wrapper if existing imports need it, but delegates to the new detector. `rasen agent wait`, pipeline inspection, and execution preflight consume the same result.

Alternative considered: add `CODEX_THREAD_ID` only to the keepalive-local detector. Rejected because pipeline runtime selection would still have no canonical host identity and the two detection paths would drift again.

### D2 — Runtime is resolved field-wise, not bundle-wise

Change the parsed object form of `AgentRuntimeConfigSchema` so `runtime` is optional. A plain string such as `reviewer: codex` and an explicit object field such as `runtime: claude` remain explicit declarations; an object containing only `model`, `sandbox`, `effort`, or `sessionReuse` no longer manufactures an explicit Claude runtime.

Resolve the runtime with its own chain:

```text
per-role configured runtime instance (project > store > global)
  > stage.runtime
  > pipeline agents.<role>.runtime
  > detected host runtime
  > legacy Claude fallback when host is unknown
```

The auto invocation’s role flags remain above the registry result in generated guidance; they are run-local overrides and are not persisted or re-derived inside `resolveStageRuntimeConfig()`.

Other fields keep their existing chains. `ResolvedStageRuntimeConfig.runtime` remains required after resolution, while `AgentRuntimeConfig.runtime` becomes optional before resolution. The combined `source` field can retain its legacy bundle meaning for compatibility, but `runtimeSource` is computed independently and gains:

```text
host
legacy-default
```

alongside the existing configured/stage/agent sources. A model-only stage may still have `source: stage` and `modelSource: stage`, but its runtime source is `host` (or `legacy-default` under an unknown host).

Every caller that uses the effective runtime—including role runtime views, handoff bindings, reuse bindings, management effective-stage resolution, and execution preflight—receives an explicit runtime-resolution context. Pure low-level callers that omit it retain the legacy unknown-host fallback for backward compatibility.

Alternative considered: keep `runtime: claude` as a schema default and infer omission from raw YAML. Rejected because downstream normalized objects lose that provenance and every consumer would need a second raw-definition channel.

### D3 — Dispatch routes are an explicit host × target table

Keep `canDispatch` as target eligibility, but add a separate route lookup:

| Host | Target | Dispatch mode | Availability check |
|---|---|---|---|
| Claude | Claude | `native` | native tool capability checked by the LEAD tier logic |
| Claude | Codex | `exec-bridge` | bounded Codex CLI availability probe |
| Codex | Codex | `native` | native tool capability checked by the LEAD tier logic |
| Codex | Claude | `unsupported` | fail execution preflight |
| Unknown | any | `legacy-fallback` | retain pre-change behavior with a diagnostic |

The lookup is data-driven and exhaustively typed for the shipped hosts/targets. A future bridge requires an explicit table entry and implementation; setting `canDispatch: true` for the target cannot invent a route.

Unknown hosts retain compatibility: implicit target resolution falls back to Claude with `runtimeSource: legacy-default`, the route is reported as `legacy-fallback`, and execution emits a diagnostic explaining how to set `RASEN_AGENT_RUNTIME`. Existing Codex-target legacy execution continues to use/probe `codex exec`. This keeps ordinary terminal inspection and older automation working while making the uncertainty visible.

Alternative considered: fail every unknown-host execution. Rejected as an unnecessarily broad break for `rasen validate`, CI, and terminal inspection. Known unsupported pairs still fail closed; unknown is explicitly a compatibility policy rather than a false claim that a native route exists.

### D4 — Resolve one execution plan and reuse it for output and preflight

Create or extend a shared pure resolver that accepts:

- pipeline definition;
- stage/role config overrides;
- detected host;
- model and threshold resolution inputs;
- any decompose child definitions.

It returns each stage’s resolved target runtime, runtime source, dispatch mode, and the existing model/lifecycle fields. The CLI display and execution preflight consume this same plan instead of separately calling `resolveStageRuntimeConfig()` with different inputs.

This closes an existing gap: current preflight ignores persisted per-role runtime configuration because it calls the resolver without `resolvePipelineStageOverrides()`, while `pipeline show` includes those overrides. Execution validation must load the same project/store/global runtime instances and apply them to parent and child pipelines.

The execution view adds:

```json
{
  "hostRuntime": "codex",
  "hostRuntimeSource": "codex-thread-id",
  "stages": [
    {
      "runtime": "codex",
      "runtimeSource": "host",
      "dispatchMode": "native"
    }
  ]
}
```

Human output shows the same values concisely. These are additive JSON fields; existing fields retain their types. `pipeline agents` reports host-derived role defaults as host-derived rather than `default`.

The management HTTP process may not itself be an agent host. Its existing effective-stage resolver therefore receives an explicit unknown-host context rather than inheriting an unrelated server-launch environment accidentally. This change does not add a native-route claim to the management API; host/dispatch provenance belongs to the execution CLI surfaces that actually run inside the LEAD host.

### D5 — Preflight validates routes, not target names

`validatePipelineForExecution()` detects/injects the host once, resolves the full effective execution plan (including configured runtime instances and decompose children), and then:

1. rejects every `unsupported` known host × target stage before dispatch, naming the host, target, affected stage/role, and a supported override;
2. probes Codex CLI at most once only when at least one route is `exec-bridge` or a legacy Codex-target route;
3. does not probe Codex CLI for Codex-host → Codex-target native stages;
4. reports the unknown-host compatibility diagnostic without rejecting the legacy path;
5. keeps skill enablement and child-pipeline validation unchanged.

The host detector, route resolver, and Codex availability prober are injectable in tests. Errors retain a stable machine code, with a distinct code for unsupported routing versus missing bridge availability.

Alternative considered: keep “any Codex target means probe Codex CLI.” Rejected because same-host Codex-native dispatch does not require a second CLI process and would preserve the wrong architecture.

### D6 — Generated orchestration branches on dispatch mode

The shared orchestration template consumes the host/route values already emitted by `pipeline show --for-execution`; it does not re-derive target defaults from prose.

- `native` on Claude uses the existing Task/subagent, `agentId`, transcript, and Claude `SendMessage` lifecycle.
- `native` on Codex uses `spawn_agent`/`send_message`/`followup_task`/`wait_agent` as the available collaboration surface. The worker’s final `DONE` or `HANDOFF` result is its final response, which Codex forwards automatically to the parent mailbox. It does not send a duplicate completion message.
- `exec-bridge` uses the existing `codex exec` invocation, strict output schema, closed stdin, JSON event stream, last-message file, thread id, rollout, resume, and failure rules unchanged.
- `legacy-fallback` uses the existing tier fallback and names the uncertainty; `unsupported` never reaches the playbook because preflight rejects it.

Codex-native waiting follows a synchronization rule:

- call `wait_agent` only when the next critical-path action actually depends on an unfinished worker;
- use one barrier-sized, long event-driven wait rather than repeated 30/60-second timeout polling;
- after a mailbox/user event, consume the delivered result and wait again only if dependencies genuinely remain;
- do useful independent work instead of waiting when the DAG permits it.

This is distinct from `rasen agent wait`, which is a Claude cache-keepalive primitive and remains runtime-gated off for Codex by default.

Alternative considered: treat Codex-native workers as a thin wrapper around `codex exec`. Rejected because it adds a redundant process/thread lifecycle and preserves the completion/wait mismatch that caused the observed churn.

### D7 — Worker records and completion contracts identify the dispatch mode

Add an optional canonical `dispatchMode` to worker records while preserving the passthrough, optional-handle compatibility contract.

- Claude-native records the existing `agentId`/`transcript` handles.
- Codex-native records `runtime: codex`, `dispatchMode: native`, role, and only the native handle(s) actually returned by `spawn_agent`; it never fabricates an exec `threadId`.
- Codex exec-bridge records `runtime: codex`, `dispatchMode: exec-bridge`, `threadId`, rollout-as-`transcript`, sandbox/model/effort, and no fabricated turn id.

Resume/accounting chooses its runtime-specific ladder from `dispatchMode`. Archived records without the field use the existing handle-shape inference: a Codex record with `threadId` is exec-bridge; Claude `agentId` behavior is unchanged; ambiguous legacy records remain readable and fall back conservatively.

Completion is also route-specific. Claude-native keeps the proven explicit-message contract. Codex-native uses automatic final delivery and reserves `send_message` for intermediate coordination. Exec-bridge continues to parse the strict last-message artifact.

### D8 — Migration is additive and explicit

No stored pipeline or config is rewritten.

- Explicit `runtime: claude|codex` values keep their meaning and precedence.
- Object-form role declarations that omitted `runtime` begin inheriting the host; this is the intended correction, not a data migration.
- Model-only stages previously misreported as runtime-explicit become host-derived.
- Claude-host defaults remain Claude-native, so the dominant existing path is unchanged.
- Claude-host explicit Codex remains exec-bridge.
- Codex-host explicit Claude now fails early as an unsupported route; the user can remove the stale explicit override to inherit Codex or run the workflow from a Claude host.
- Unknown hosts retain the annotated legacy fallback and can opt into deterministic behavior with `RASEN_AGENT_RUNTIME`.
- Run-state additions are optional; archived files remain parseable.

Rollback is a source revert. No on-disk rollback or versioned data conversion is required.

### D9 — Tests prove the boundaries

Focused tests cover:

- detector precedence, `CODEX_THREAD_ID`-only unrestricted Codex, inherited Claude fingerprints, explicit override, and unknown;
- runtime-object omission versus explicit runtime, independent provenance for model-only stage/role declarations, and all explicit precedence layers;
- host defaults for Claude and Codex plus unknown legacy fallback;
- every shipped host × target route;
- execution preflight using persisted config overrides and decompose children;
- no Codex CLI probe for Codex-native, one probe for Claude→Codex, unsupported Codex→Claude rejection, and unknown diagnostic compatibility;
- JSON/human `pipeline show` and `pipeline agents` provenance/dispatch fields;
- threshold/reuse binding selection from host-derived effective runtimes;
- `rasen agent wait` recognition of `CODEX_THREAD_ID`;
- generated orchestration text for native Codex completion and sparse event-driven waits while retaining Claude and exec-bridge contracts;
- run-state compatibility and handle inference;
- regenerated workflow/template parity hashes.

## Risks / Trade-offs

- [Making parsed object runtimes optional exposes assumptions that runtime is always present] → Keep resolved runtime required, fix compile errors exhaustively, and add schema plus resolver tests for every object form.
- [CLI display and preflight drift again] → Both consume one resolved execution-plan function, including the same config overrides and host detection result.
- [Unknown-host compatibility can still choose the wrong legacy mechanics] → Label it `legacy-fallback`, emit an actionable diagnostic, and document `RASEN_AGENT_RUNTIME`; never present it as native.
- [Codex-native resume handles are less durable than exec thread ids] → Record only actual native handles, rely on durable artifacts/run-state across sessions, and keep exec-bridge thread semantics separate.
- [Generated template edits cause broad hash churn] → Regenerate only the named affected workflow/skill parity entries and review the exact generated delta.
- [A project intentionally requests Claude from Codex] → Fail before dispatch with the unsupported pair and remediation; do not silently substitute Codex because explicit configuration retains authority.
- [Host-derived runtime changes threshold-scheme selection] → Feed the same effective runtime into handoff/reuse binding resolution and test the resulting row metadata.

## Migration Plan

1. Land the shared detector and route table with unit tests.
2. Refactor runtime parsing/resolution and provenance, retaining the unknown-host fallback.
3. Build the shared execution-plan view and wire CLI output plus threshold/reuse consumers.
4. Replace target-only preflight with route-aware validation and diagnostics.
5. Update worker run-state handling and generated orchestration guidance.
6. Regenerate named template artifacts/hashes and run focused plus full validation.

No automatic file migration runs. If rollback is required, revert the change; existing pipeline/config/run-state data remains valid on either side.

## Open Questions

- None blocking. A future Codex→Claude bridge must be proposed as a separate adapter with its own availability, lifecycle, and security contract rather than enabled by configuration alone.
