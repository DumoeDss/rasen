## Context

The runtime registry currently implements three of the four Claude/Codex host-target pairs:

| Host | Target | Current route |
|---|---|---|
| Claude | Claude | `native` |
| Claude | Codex | `exec-bridge` (`codex exec`) |
| Codex | Codex | `native` |
| Codex | Claude | `unsupported` |

`validatePipelineForExecution` rejects the fourth pair before a worker can launch. The generated orchestration playbook repeats the same asymmetric matrix, and every `exec-bridge` availability check currently assumes the bridge executable is Codex.

Claude Code 2.1.220 exposes the primitives needed for a bounded 0.1.6 bridge: non-interactive print mode, JSON and JSON-Schema output, an exact `session_id`, and explicit `--resume`. Existing Rasen code already has two useful precedents: `src/core/codex/` defines invocation, result-contract, identity, and lifecycle seams, while `management-api/supervisor.ts` safely launches Claude across POSIX, native Windows executables, and Windows `.cmd` shims. The bridge must reuse those patterns without importing the 0.2.0 long-lived SessionHost design.

The root CLI and optional UI are released in lockstep. Both package manifests still declare 0.1.5, and the release contract requires a matching changelog section.

## Goals / Non-Goals

**Goals:**

- Make a preflighted Codex-host→Claude-target stage executable through a shipped, testable Claude CLI bridge.
- Provide a shell-free, cross-platform launch path that safely transports multiline/CJK prompts and JSON schemas.
- Enforce the existing leaf-worker structured contracts and return one machine-readable receipt that distinguishes success, worker-declared handoff, protocol failure, CLI failure, and timeout.
- Capture a durable Claude `sessionId`, support explicit-session continuation in the original working directory, and prevent concurrent writers to one session.
- Preserve Claude-native, Claude→Codex exec-bridge, Codex-native, and unknown-host fallback behavior.
- Advance all release-contract version surfaces to 0.1.6 and target `dev/0.1.6`.

**Non-Goals:**

- Building the 0.2.0 long-lived stream-JSON SessionHost, daemon registry, cache-touch scheduler, or generic pipeline executor.
- Replacing Claude-native Task/Agent workers on a Claude host.
- Replacing the existing Codex exec bridge or changing its thread/rollout lifecycle.
- Guaranteeing prompt-cache retention across `claude --resume`; correctness depends on the persisted session, not on a cache hit.
- Making real Anthropic requests in automated tests.

## Decisions

### D1. Add a narrow Claude bridge behind `rasen agent dispatch`

Add a core surface under `src/core/claude/` and a machine-oriented CLI entry:

```text
rasen agent dispatch \
  --runtime claude \
  --prompt-file <path> \
  --contract leaf|evaluate \
  --sandbox read-only|workspace-write \
  [--model <model>] [--effort <level>] [--resume <session-id>] \
  [--cwd <directory>] --json
```

The command is the bridge process owner: it resolves the configured Claude binary, builds argv, writes the prompt to child stdin, closes stdin, captures bounded stdout/stderr, applies a timeout, parses the result envelope, and emits one JSON receipt. The generated playbook calls this command instead of trying to quote a raw `claude` command itself.

This keeps shell/platform mechanics in tested TypeScript and gives a Codex LEAD a stable executable surface. Calling raw `claude -p` directly was rejected because multiline prompts, JSON-Schema arguments, command-line length, PowerShell quoting, and npm `.cmd` double parsing make the playbook itself an unsafe cross-platform process runner. A fully generic multi-runtime executor was rejected as 0.2.0 scope.

### D2. Build argv structurally and transport the prompt through stdin

`buildClaudePrintInvocation` returns structured process data rather than a shell string:

- command and argv as separate values;
- `-p --output-format json`;
- `--json-schema <minified-schema-json>`;
- optional model/effort;
- a fresh call or `--resume <exact-session-id>`;
- permission flags derived from the requested sandbox;
- prompt text as an explicit stdin payload, followed by EOF.

The prompt combines the inlined stage skill/template, task brief, structured-return instruction, handoff contract, and a named `CLAUDE_FLAT_HIERARCHY_GUARD`. The bridge also disables Claude subagent/delegation tools for the leaf.

Passing the prompt through stdin avoids process-table disclosure, OS command-line limits, and the known Windows `.cmd` newline truncation. The shared spawn helper will be extracted from the management supervisor so both callers use the same direct-executable path and the same double-escaped `cmd.exe` shim path. The helper continues to use `shell: false` and `windowsHide: true`.

### D3. Reuse one shared worker-contract definition

Move the leaf `DONE|HANDOFF` and evaluate `{satisfied,gaps}` JSON schemas and Zod parsers to a runtime-neutral module. `src/core/codex/` re-exports the same API for compatibility; the Claude bridge consumes the shared definitions.

Claude receives the selected schema through `--json-schema`. A successful `--output-format json` envelope is accepted only when:

- `type` is `result`;
- `subtype` is `success`;
- `is_error` is false;
- `session_id` is a non-empty string;
- `structured_output` exists and passes the selected shared parser.

The raw `result` prose is not treated as the authoritative completion value. This avoids two contract implementations drifting and prevents an unstructured `DONE` string from bypassing validation.

### D4. Emit explicit receipts and fail closed on process/protocol errors

The bridge receipt carries the route, runtime, contract, session ID, structured result, and bounded diagnostic metadata. Failures use stable kinds such as:

- `runtime-unavailable`;
- `spawn-failed`;
- `timeout`;
- `nonzero-exit`;
- `invalid-json`;
- `claude-error-result`;
- `structured-output-missing`;
- `contract-invalid`.

A failed bridge exits non-zero and does not fabricate `DONE`, a session ID, or a transcript. If a result envelope contains a real session ID before a later contract failure, the diagnostic may report it, but run-state records a worker as completed only after the contract passes. Stderr and raw stdout are bounded/redacted in receipts so a malformed CLI cannot exhaust memory or corrupt the parent JSON channel.

### D5. Resume only by exact Claude session ID, in the original cwd, with one writer

Fresh output captures Claude's `session_id`; continuation uses:

```text
rasen agent dispatch --runtime claude --resume <session-id> ...
```

The LEAD never uses `--continue` or “latest”, because those are ambiguous under parallel workers. Run-state records `sessionId` and `cwd` for an exec-bridge Claude worker. Before resuming, the playbook probes the recorded transcript when present, applies the normal handoff threshold, and either resumes the exact session or retires/warm-seeds a fresh worker. Resume uses the same contract and result parser as launch.

A machine-local session registry under the Rasen data directory enforces the invariant across separate `rasen agent dispatch` processes. Each exact session ID maps to a hashed record containing its canonical cwd and an atomic writer claim. The claim first publishes a complete bridge-PID + nonce owner token through no-overwrite hard-link creation, then publishes an immutable worker/process-tree root sidecar before the runner releases prompt stdin. A live bridge or worker tree rejects a contender, including after bridge-parent death; an interrupted pre-bind startup is conservatively non-reclaimable because no worker root exists to prove dead. A bound claim is recovered only after both bridge and worker tree are proven dead. Recovery is serialized by a permanent per-owner nonce tombstone, so only one contender can remove that stale generation and no late contender can move or delete its replacement. Release verifies the exact owner token before removing it. Fresh success binds cwd directly before returning its receipt; every resume validates the durable binding and acquires its claim before Claude is spawned. If the session is no longer resumable, the standard handoff/transcript/artifact reconstruction ladder applies.

Using native `agentId`/`SendMessage` for this route was rejected: those handles belong to Claude-host native subagents and do not exist when a Codex host launches an external Claude session.

### D6. Give Claude exec-bridge identity its own run-state field

Extend the passthrough, backward-compatible worker schema with optional `sessionId` and `cwd`. The canonical shapes become:

- Claude native: `runtime=claude`, `dispatchMode=native`, `agentId`, transcript when surfaced;
- Claude exec bridge: `runtime=claude`, `dispatchMode=exec-bridge`, `sessionId`, `cwd`, transcript when discoverable, model/sandbox/effort;
- Codex native: unchanged native `agentId`;
- Codex exec bridge: unchanged `threadId` plus rollout transcript.

Dispatch-mode inference treats an archived Claude record with `sessionId` as exec-bridge. Durable-handle warnings accept `sessionId` alongside `agentId`, `threadId`, and transcript. The field is not called `threadId`: Claude and Codex identities have different resume protocols, and conflating them would route continuation incorrectly.

### D7. Make bridge identity explicit in the route and preflight

Extend the route bridge discriminator to include `claude-print` alongside `codex-exec`, and carry it into execution-plan stage output. The known matrix becomes:

| Host | Target | Mode | Bridge |
|---|---|---|---|
| Claude | Claude | `native` | — |
| Claude | Codex | `exec-bridge` | `codex-exec` |
| Codex | Codex | `native` | — |
| Codex | Claude | `exec-bridge` | `claude-print` |

Preflight groups required bridge kinds and probes each required executable at most once through separate injectable probers. A Codex-host→Claude stage probes Claude availability, not Codex; native stages probe neither external bridge. Child-pipeline routes use the same plan. The existing `unsupported` mode remains available for future adapters/routes, but no shipped Claude/Codex pair is unsupported after this change.

Inferring the bridge solely from the target runtime was considered, but an explicit discriminator is safer for inspection output, future adapters, and error messages.

### D8. Update the playbook as a separate lifecycle branch

The generated orchestration template gains “Claude exec-bridge” alongside Claude-native, Codex-native, and Codex exec-bridge:

- launch through `rasen agent dispatch --runtime claude`;
- inline the selected skill body and name change artifacts in the prompt;
- use a prompt file in the resolved work directory;
- parse the JSON receipt and record `sessionId`/`cwd`/transcript;
- resume by the explicit session ID after the normal occupancy guard;
- classify bridge process/protocol failure using the receipt;
- keep the handoff and author≠verifier contracts unchanged;
- never park an external Claude bridge worker in the native `rasen agent wait`/`SendMessage` protocol.

All generic “exec-bridge resumes by Codex thread” wording is narrowed to the Codex bridge. Claude-native behavior remains explicitly unchanged.

### D9. Test at the binary seam on every platform path

Add a fixture CLI with a POSIX-spawnable script and a Windows `.cmd` wrapper. It will simulate:

- successful fresh result with `session_id` and valid `structured_output`;
- successful explicit resume that verifies the same cwd/session argument;
- `HANDOFF` and evaluate results;
- non-zero exit and stderr;
- malformed JSON;
- Claude error envelopes;
- missing/invalid structured output;
- timeout;
- multiline/CJK/metacharacter prompt round-trip without shell side effects.

Unit tests cover builders/parsers/identity/route resolution, stateful UTF-8 decoding across arbitrary byte chunks, serialized multi-contender stale-claim recovery, conservative pre-bind failure, and bounded/redacted error diagnostics. CLI integration tests invoke separate `rasen agent dispatch` OS processes against the fixture to prove same-session contention, durable canonical-cwd rejection, and bridge-parent death while a held worker remains alive. Pipeline tests prove each of the four routes, the correct injectable availability probe, child-pipeline coverage, and preservation of the other routes. Template tests pin the new branch and prevent generic exec-bridge text from assuming Codex.

### D10. Release 0.1.6 in lockstep

Set both package manifests to 0.1.6, add a non-empty `## 0.1.6` changelog section (while preserving `Unreleased`), and update tests whose literals represent the running package version. Historical examples and archived 0.1.5 records remain unchanged. Run the existing release-contract and pack-version checks in addition to normal build/lint/test verification.

## Risks / Trade-offs

- **[Claude CLI protocol drift]** → Keep invocation/result parsing isolated, validate every envelope strictly, record the tested CLI premise, and fail with an actionable protocol error.
- **[Windows shim injection or prompt truncation]** → Reuse the supervisor's vetted `.cmd` escaping, pass no user prompt through argv, write stdin then close it, and test metacharacters plus multiline CJK on the platform-specific fixture wrapper.
- **[Read-only is weaker than an OS sandbox]** → Map read-only to Claude plan mode plus denied mutation/delegation tools, retain the prompt-level edit boundary, and document that the process also inherits the host/workspace boundary; use workspace-write only for artifact-writing stages.
- **[Concurrent resume loses a turn]** → Claim one writer per session ID and make the playbook prohibit concurrent resumes of the same session.
- **[Resume cache miss or stale session]** → Treat caching as an optimization only; correctness falls back to explicit handoff/transcript/artifact reconstruction.
- **[Version-literal churn in tests]** → Change only literals that model the current package version; preserve historical/release-example fixtures deliberately.
- **[Scope growth toward SessionHost]** → Keep the runner one-process-per-turn and exclude daemon persistence, touch scheduling, and long-lived stdin sessions from 0.1.6.

## Migration Plan

1. Land shared contract/spawn primitives and the Claude bridge behind tests.
2. Switch Codex→Claude routing and preflight only after the bridge command is executable.
3. Update run-state inference, generated playbooks, and documentation in the same commit series so no route is advertised without lifecycle instructions.
4. Bump both package manifests and add 0.1.6 release notes; verify release contract, CLI version, build, lint, focused tests, full tests, and platform-safe fixture coverage.
5. Open one PR from this worktree branch to `dev/0.1.6`.

Rollback is a normal revert: restore Codex→Claude to `unsupported`, remove its playbook branch and bridge command, and return both manifests/changelog to the prior release state. Existing run-state remains readable because all new worker fields are optional and passthrough.

## Open Questions

None blocking. The long-lived stream-JSON SessionHost and cache economics remain a separate 0.2.0 design; this change deliberately ships the bounded per-turn bridge needed by 0.1.6.
