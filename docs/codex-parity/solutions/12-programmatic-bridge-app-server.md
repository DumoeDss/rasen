# 12 — Programmatic bridge: `codex app-server` JSON-RPC and MCP mode

**Status: live-verified** (the JSON-RPC lifecycle; `codex mcp-server` mode was located but not
live-exercised this round)

## Experiments

E07 (full method-surface dump + live initialize→thread/start→turn/start→turn/completed round
trip), E03/E05 (cross-references for token usage and thread fields surfaced by app-server).

## Solution

The playbook's vocabulary ("app-server threads", `threadId`/`turnId`) is now **live-verified,
with the exact real method names** (the seed list's method names were placeholder fiction; these
are the actual 0.144.1 surface, extracted from `codex app-server generate-json-schema
--experimental`):

**Thread/turn lifecycle (`ClientRequest` methods the LEAD calls):**
```
initialize → thread/start (or thread/resume, thread/fork) → turn/start
  → [turn/interrupt | turn/steer during flight] → (turn completes)
thread/list, thread/read, thread/items/list, thread/turns/list, thread/archive/unarchive/delete,
thread/compact/start, thread/goal/{set,get,clear}, thread/backgroundTerminals/*,
thread/shellCommand, thread/rollback
```

**Push events (`ServerNotification`) the LEAD should subscribe to:**
```
thread/started, thread/status/changed, thread/tokenUsage/updated (solution 05's occupancy feed),
turn/started, turn/completed, item/started, item/completed, item/agentMessage/delta (streaming),
item/reasoning/*Delta (streaming reasoning), error, warning
```

**Approval callbacks (`ServerRequest`, server asks client for permission):**
```
applyPatchApproval, execCommandApproval, item/commandExecution/requestApproval,
item/fileChange/requestApproval, item/permissions/requestApproval, item/tool/call,
item/tool/requestUserInput
```
A LEAD wanting `on-request`/`untrusted` approval semantics (rather than `never`, which `codex
exec` effectively defaults to per solution 10) must implement handlers for these — untested live
this round (thread/start's default approvalPolicy was `on-request` per E07's captured response,
but no approval request was actually triggered since the one live turn/start call didn't attempt a
denied action).

## Live-verified round trip (transport: stdio, newline-delimited JSON-RPC)

```
codex app-server -c 'model_providers.proxy.name="proxy"' -c 'model_providers.proxy.base_url="..."' ...
```
then over stdin/stdout: `initialize` → (unsolicited `remoteControl/status/changed` notification)
→ `initialized` → `thread/start {cwd}` → result carries `thread.id`, `thread.path` (the rollout
JSONL path), `sandbox`, `approvalPolicy`, `model`, `reasoningEffort`, `multiAgentMode` — then
`turn/start {threadId, input:[{type:"text",text:...}]}` → streamed `item/started` /
`item/agentMessage/delta` / `item/completed` → `thread/tokenUsage/updated` →
`thread/status/changed{idle}` → `turn/completed`. Full transcript in E07.

## `codex mcp-server` (Codex as an MCP server callable FROM Claude Code)

`codex mcp-server --help` confirms this exists as a separate stdio MCP server mode, distinct from
`app-server`. **Not live-exercised this round** (budget) — flagged for round 2. Given the
app-server protocol's richer surface (thread/turn granularity, streaming deltas, explicit approval
callbacks, `thread/fork` matching the native multi-agent mechanism in item 1), **app-server is the
recommended bridge for a LEAD that wants full programmatic control**; `codex mcp-server` is more
plausible as a lighter-weight "Codex as one tool Claude Code can call" integration (e.g. for the
existing `/codex` second-opinion skill) rather than as the backbone for dispatching/tracking
full Codex workers.

## Resume/identity handle

`thread.id` from `thread/start`/`thread/resume`'s result (identical id space to `codex exec`'s
`thread_id` — confirmed same UUID format, and E07's app-server-created thread produced the same
`~/.codex/sessions/**/*.jsonl` rollout file layout as any `codex exec` thread).

## Structured output capture

Confirmed via schema inspection (not a live call): `TurnStartParams` (in the downloaded schema
bundle, `schema/v2/TurnStartParams.json`) has an `outputSchema` field, described as *"Optional
JSON Schema used to constrain the final assistant message for this turn"* — the exact app-server
equivalent of `codex exec --output-schema`. Not live-exercised over app-server this round (E10's
live test used `codex exec`), but the schema-level presence plus `codex exec`'s confirmed working
behavior gives high confidence it works identically. Round 2 should do one live `turn/start` call
with `outputSchema` set to close this out.

## Failure modes

None observed in the one live round trip. Cancellation (`turn/interrupt`) exists per the method
list but was not exercised.
