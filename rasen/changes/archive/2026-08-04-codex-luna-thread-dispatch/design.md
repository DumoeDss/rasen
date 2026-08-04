## Context

Rasen already has most Codex primitives: `buildCodexExecInvocation()` composes fresh and exact-thread resume arguments, shared JSON Schemas define leaf/evaluate results, JSONL parsing captures `thread.started`, rollout helpers recover transcript/occupancy, and lifecycle helpers classify failures and guard one writer in-process. The missing piece is an owned process boundary. The orchestration template currently asks a LEAD to render and run a shell command itself, while `rasen agent dispatch` owns that boundary only for Claude.

This is generic Codex worker configuration: model and effort are independent values, whether the model is `gpt-5.6-luna`, `gpt-5.6-terra`, or another non-empty Codex model id. Native Codex full-history forks inherit the parent model/agent type, while a no-history native spawn can apply the resolved model and effort and a process-backed `codex exec` dispatch creates a durable thread resumable by exact id from a later process. Luna Max is the concrete runtime probe: direct smoke evidence established that an inherited/open stdin is the post-completion hang cause and that independent Luna Max processes can run concurrently.

Constraints are: retain the flat leaf hierarchy and shared result contracts; remain compatible with Node.js 20.19+ on Windows, macOS, and Linux; preserve existing run-state shapes; avoid user-global Codex configuration changes; and do not depend on PR #133's Claude resident-process work.

## Goals / Non-Goals

**Goals:**

- Make a fresh or resumed Codex process an owned, bounded `rasen agent dispatch --runtime codex` operation with exactly one JSON receipt.
- Preserve the exact Codex thread id, strict leaf/evaluate result, resolved model/effort, and useful bounded diagnostics for the LEAD.
- Make Luna Max, Terra, and arbitrary non-empty Codex model ids selectable through normal pipeline and project/store/global configuration, with model and effort resolved independently and reported with explicit precedence and provenance.
- Make multiline Unicode prompts and process teardown behave consistently on Windows, macOS, and Linux.
- Teach orchestration when to use a no-history Codex-native model override and when to use the process bridge, without adding a dispatch-mode field to pipeline YAML.

**Non-Goals:**

- A resident Codex daemon, process pool, or cross-change cache service.
- Replacing Codex-native collaboration for ordinary same-host stages.
- A new run-state dispatch mode; the existing `exec-bridge` value remains canonical.
- Model discovery, a built-in model allow-list, or a model-specific preset. Model ids remain opaque non-empty strings supplied by users or existing runtime configuration.
- Modifying `$CODEX_HOME/config.toml` or global custom-agent files.
- PR #133 or any Claude resident/session-cache optimization.

## Decisions

### 1. Extend `exec-bridge`; do not add a model-specific route

`rasen agent dispatch --runtime codex` will select a `codex-exec` implementation and return receipts with `runtime: "codex"`, `dispatchMode: "exec-bridge"`, and `bridge: "codex-exec"`. Fresh success includes the captured `threadId`; resume accepts only an explicit `--resume <threadId>`. There is no latest-thread lookup and no model-specific dispatch mode: Luna, Terra, and any other non-empty model id use the same route.

This fits the existing run-state and resume taxonomy, which already treats a Codex `threadId` as the durable handle for `exec-bridge`. A new route name or pipeline field would duplicate that contract and create migration work without changing lifecycle semantics.

Alternative considered: add `dispatchMode: process-thread` or one route per known model family. Rejected because model choice and process topology are independent axes, archived run-state already recognizes Codex threads as `exec-bridge` workers, and model discovery/allow-list maintenance is outside Rasen's contract.

### 2. Put process ownership in a Codex runner behind the existing command

A new Codex runner/result boundary will mirror the proven Claude bridge shape while reusing Codex-specific primitives. `AgentCommand.dispatch()` will perform common input checks once, then narrow by runtime. The Codex branch resolves `RASEN_CODEX_BIN`/`codex`, builds the existing invocation, runs one child in the canonicalized `--cwd`, parses the event stream and last-message file, and emits exactly one receipt. Child stdout/stderr never pass through to command stdout.

The runner will use the existing shared agent CLI launcher so POSIX binaries, Windows native executables, and npm `.cmd`/`.bat` shims share one quoting and `windowsHide` implementation. Paths are built with `path.join()`/`path.resolve()` and canonicalized with the existing filesystem helper.

Alternative considered: keep teaching the LEAD to run rendered shell commands. Rejected because it cannot guarantee one receipt, bounded capture, redaction, process-tree teardown, or safe Windows multiline transport.

### 3. Send the prompt through stdin and end it exactly once

The process runner will use the invocation builder's fully assembled prompt but select a spawn form whose argv omits the final prompt argument. It will write the bounded UTF-8 prompt to child stdin and immediately call `end()`, delivering EOF. The builder's existing argv/shell rendering remains available for compatibility and diagnostics, but the first-class runner never relies on shell redirection.

This simultaneously fixes the open-stdin hang and transports newlines, CJK, quotes, spaces, and shell metacharacters safely through Windows npm shims. The shared 2 MiB prompt-file/stdin limit remains the input bound. Tests will use a fake Codex executable in native/POSIX and `.cmd` forms and assert byte-preserving prompt receipt plus observed EOF.

Alternative considered: keep the prompt as the final argv token and spawn with stdin ignored. Rejected because `cmd.exe` cannot represent multiline argument data reliably. Temporary prompt-file indirection was also rejected because Codex prompt-file discovery is not a reliable invocation surface; the existing client-side inlining contract remains authoritative.

### 4. Treat schema, result, and event capture as one atomic dispatch receipt

For each call the runner creates a private temporary directory under `os.tmpdir()` and writes the selected shared JSON Schema plus a named last-message path. Fresh/resume argv uses `--json`, `--output-schema`, and `-o`. After a zero exit, success requires:

1. a fresh call captured one non-empty `thread.started.thread_id` (a resume uses the requested id and rejects a conflicting surfaced id),
2. the last-message file exists within its byte bound,
3. its JSON validates through `parseWorkerContractValue()`, and
4. no timeout or stream/output bound was crossed.

The success receipt carries the validated `result`, `threadId`, canonical `cwd`, selected sandbox/model/effort when present, invocation warnings, and a rollout `transcript` path when it can be found. Failure receipts use stable kinds for invalid input, unavailable runtime, spawn failure, busy thread, timeout, output limit, non-zero exit, missing/mismatched thread identity, missing/invalid last message, and contract invalidity. Diagnostics are redacted and UTF-8 byte-bounded using a runtime-neutral extraction of the existing Claude sanitizer.

Temporary files are tracked by explicit names and cleaned in `finally`; cleanup failure is diagnostic-only so a Windows lock cannot replace the real dispatch outcome.

Alternative considered: infer `DONE` from the terminal agent message or return raw JSONL. Rejected because orchestration already has strict shared contracts and must not guess completion from prose.

### 5. Bound time, memory, and process-tree lifetime

The Codex branch keeps the existing command timeout contract (default 30 minutes, accepted range 1..86,400,000 ms), bounds stdout and stderr capture, bounds the last-message file before parsing, and terminates the complete child process tree on timeout, capture overflow, or input/setup failure. Timers are cleared and writer claims released only after the child close path has been observed. `windowsHide: true` applies to all non-interactive child processes.

Resume claims the exact thread id before spawn. The current in-memory thread guard will be backed by the same durable process-tree ownership pattern used by the Claude bridge so separate Rasen CLI processes cannot concurrently write one thread. A claim records the spawned tree root before the prompt is released; a dead bridge parent does not make the thread claimable while its worker tree remains alive. Independent thread ids stay concurrent.

Alternative considered: rely on the operator-only one-writer warning. Rejected because the new bridge is explicitly process-based, so in-process locking alone does not enforce its advertised lifecycle.

### 6. Resolve effort symmetrically with model, then validate at the dispatch boundary

Configuration gains `efforts.default`, `efforts.roles.<role>`, and `pipelines.<name>.efforts.<stage>` at project, inherited-store, and global scopes. `resolveStageRuntimeConfig()` receives effort layers and a per-stage effort override, and reports `effortSource` independently of runtime and model provenance.

The effective effort precedence is:

1. scope-resolved `pipelines.<name>.efforts.<stage>` (project > store > global),
2. stage YAML `effort`,
3. pipeline `agents.<role>.effort`,
4. project `efforts.roles.<role>`, then `efforts.default`,
5. inherited store `efforts.roles.<role>`, then `efforts.default`,
6. global `efforts.roles.<role>`, then `efforts.default`,
7. the runtime's own default (the flag is omitted).

Model precedence remains the existing analogous chain and retains its separate `modelSource`. Model ids are validated only as non-empty strings and passed through unchanged: `gpt-5.6-luna`, `gpt-5.6-terra`, and unknown future/provider-qualified ids all follow the same path, with availability left to Codex. Rasen performs neither model discovery nor allow-list validation. Leaf reasoning effort uses one shared named list: `low`, `medium`, `high`, `xhigh`, `max`. Invalid authored stage/pipeline values fail preparation; invalid resilient config leaves are dropped with a diagnostic so a valid lower layer can win; direct `agent dispatch --effort` rejects an unsupported value before spawn. The low-level invocation builder's historical `ultra` clamp can remain for API compatibility, but the first-class leaf command and pipeline resolution never select `ultra` silently.

`pipeline show --json` and the execution view expose `effort`/`effortSource`; the orchestration bridge passes those resolved values rather than re-resolving config in `AgentCommand`.

Alternative considered: require every LEAD to pass ad hoc `--effort max`. Rejected because it loses source provenance and makes project/store policy non-operational. Putting effort under a Luna-specific key was rejected because the effort vocabulary applies to all supported worker models.

### 7. Keep native and process dispatch distinct in orchestration

The host route matrix remains unchanged: cross-host Codex workers use `exec-bridge`; ordinary same-host Codex workers remain native. A caller may explicitly use `rasen agent dispatch --runtime codex` when it needs a process-durable thread on a Codex host, and that receipt is recorded as `exec-bridge`.

For Codex-native dispatch, when the execution view supplies a model or effort override, the playbook passes those values to `spawn_agent` and sets `fork_turns: "none"`; a full-history fork is not allowed to pretend it switched model/agent type because the host inherits those properties. The prompt explicitly names all change artifacts needed to seed the isolated worker. When no override is present, existing native defaults remain available.

For Codex process dispatch, the playbook invokes the shipped CLI bridge, records its `threadId`/transcript/model/effort, and resumes with the exact thread id through the same bridge. It batches consecutive meaningful instructions when no intermediate result is needed, while each call remains one bounded process turn; this amortizes model startup cost (observed with Luna Max) without creating a resident daemon.

## Risks / Trade-offs

- **[Risk] Codex CLI event or output shape drifts.** → Keep event parsing tolerant, but make the success identity and shared result contract fail closed with bounded raw diagnostics and fixture coverage.
- **[Risk] A timeout occurs after the worker wrote files.** → Return timeout with thread id when known, kill the tree, and use the existing revival notice so the LEAD re-verifies file and command state before exact-thread continuation.
- **[Risk] Durable writer ownership has stale records after an abnormal OS failure.** → Reclaim only after proving the recorded process tree is dead; report busy/ownership diagnostics rather than launching a competing writer.
- **[Risk] Expanding effort configuration touches config UI/API and pipeline serialization.** → Add keys and provenance additively, use the existing role/stage constants, and preserve absence as “runtime default.”
- **[Risk] Stdin prompt transport relies on Codex's documented/observed stdin form.** → Cover it with fake-binary contract tests and an opt-in real-CLI smoke test; keep the lower-level argv builder available as a rollback boundary.
- **[Trade-off] Each turn is still a new OS process.** → Exact-thread resume preserves Codex context and batching avoids microtask churn; a resident pool remains deliberately out of scope.

## Migration Plan

1. Add the effort configuration keys/resolver provenance without changing defaults; pipelines with no new keys remain byte-for-byte equivalent in resolved values.
2. Add the Codex receipt/runner and CLI branch behind `--runtime codex`; existing Claude dispatch stays on its current implementation.
3. Switch generated Codex exec-bridge playbook examples from raw shell execution to the new CLI command and update only affected golden hashes.
4. Land platform fixtures and focused unit/e2e coverage before enabling the route in generated guidance.

Rollback removes the new Codex command branch and generated guidance while leaving additive absent effort keys harmless. Existing low-level Codex invocation and lifecycle modules remain usable throughout.

## Open Questions

None. Automated fixtures must cover Luna, Terra, and arbitrary non-empty model pass-through; the optional real-CLI smoke remains Luna Max because that is the established runtime probe. No product decision depends on PR #133.
