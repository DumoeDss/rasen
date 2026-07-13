# E07 — `codex app-server` JSON-RPC: real method surface + a live thread lifecycle

**Codex CLI version:** 0.144.1

## Purpose

Item 12: the LEAD playbook names "Codex app-server threads" / `threadId`/`turnId` as **designed,
untested** fiction. Discover the real 0.144.1 protocol from the binary itself, then prove it's
genuinely wired up with one live round trip over stdio.

## Step 1 — dump the real protocol schema (no live session needed)

`codex app-server` has a `generate-json-schema` subcommand that emits the full JSON Schema bundle
for the protocol without needing to hand-speak JSON-RPC:
```
codex app-server generate-json-schema --experimental -o $SCRATCH/schema
```
produced 49 top-level files including `ClientRequest.json` (methods the client/LEAD may call),
`ServerRequest.json` (methods the server calls back on the client, e.g. approvals),
`ServerNotification.json` (push events), plus a combined `codex_app_server_protocol.schemas.json`
(650KB) and a `.v2.` variant.

### Full `ClientRequest` method list (extracted from the schema's `method.enum` fields)

Thread/turn lifecycle (the load-bearing ones for item 12):
```
thread/start, thread/resume, thread/fork, thread/rollback, thread/archive, thread/unarchive,
thread/delete, thread/list, thread/loaded/list, thread/read, thread/search, thread/name/set,
thread/metadata/update, thread/settings/update, thread/items/list, thread/turns/list,
thread/compact/start, thread/goal/set, thread/goal/get, thread/goal/clear,
thread/backgroundTerminals/{list,clean,terminate}, thread/shellCommand, thread/inject_items,
thread/increment_elicitation, thread/decrement_elicitation, thread/approveGuardianDeniedAction,
thread/unsubscribe
turn/start, turn/interrupt, turn/steer
initialize
```
Plus a large surface unrelated to item 12 but relevant to other items: `config/read`,
`config/batchWrite`, `model/list`, `modelProvider/capabilities/read`, `mcpServer/tool/call`,
`mcpServerStatus/list`, `skills/list`, `skills/config/write`, `permissionProfile/list`,
`plugin/*`, `fs/{readFile,writeFile,readDirectory,watch,...}`, `process/{spawn,kill,writeStdin,...}`,
`fuzzyFileSearch*`, `review/start`, `account/*`, `remoteControl/*`, `hooks/list`,
`experimentalFeature/{list,enablement/set}`, `windowsSandbox/*`, `collaborationMode/list`.

### `ServerRequest` (server → client approval/tool callbacks)
```
applyPatchApproval, execCommandApproval, item/commandExecution/requestApproval,
item/fileChange/requestApproval, item/permissions/requestApproval, item/tool/call,
item/tool/requestUserInput, mcpServer/elicitation/request, account/chatgptAuthTokens/refresh,
attestation/generate, currentTime/read
```

### `ServerNotification` (push events, selected relevant ones)
```
thread/started, thread/status/changed, thread/tokenUsage/updated, thread/compacted,
thread/goal/{updated,cleared}, thread/name/updated, thread/closed, thread/archived,
turn/started, turn/completed, turn/diff/updated, turn/plan/updated, turn/moderationMetadata,
item/started, item/completed, item/agentMessage/delta, item/reasoning/{summaryPartAdded,
summaryTextDelta,textDelta}, item/commandExecution/outputDelta, item/plan/delta,
item/autoApprovalReview/{started,completed}, item/mcpToolCall/progress,
command/exec/outputDelta, process/{exited,outputDelta}, model/rerouted, guardianWarning,
hook/{started,completed}, error, warning, configWarning, deprecationNotice
```

## Step 2 — live stdio round trip (proves the schema is genuinely wired up)

Spawned `codex app-server` with the same `-c model_providers.proxy.*` overrides from E01, spoke
newline-delimited JSON-RPC over its stdin/stdout via a small Python harness
(`probe2.py` in the scratchpad — a single continuous process for the whole exchange below; an
earlier, separate throwaway script (`probe.py`) was used first to sanity-check bare
`initialize`→`thread/start` in isolation and produced a *different* thread id
(`019f5507-6b2c-7211-bea3-29f3e854b327`, its own independent session, not carried forward) — that
one-off check is not part of this transcript; everything quoted below is from the single
`probe2.py` run so the thread id stays self-consistent end to end).

```
>>> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"parity-probe","version":"0.1"}}}
<<< {"id":1,"result":{"userAgent":"parity-probe/0.144.1 (Mac OS 26.2.0; arm64) ...","codexHome":"/Users/sayo/.codex", ...}}
<<< {"method":"remoteControl/status/changed","params":{"status":"disabled", ...}}   # unsolicited notification right after init
>>> {"jsonrpc":"2.0","method":"initialized","params":{}}
>>> {"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"<throwaway dir>"}}
<<< {"id":2,"result":{"thread":{"id":"019f5507-d852-7da0-bfc3-83ebc8d91372","sessionId":"019f5507-d852-7da0-bfc3-83ebc8d91372",
      "forkedFromId":null,"parentThreadId":null,"path":"/Users/sayo/.codex/sessions/2026/07/12/rollout-2026-07-12T14-33-25-019f5507-d852-7da0-bfc3-83ebc8d91372.jsonl",
      "model":"gpt-5.6-sol","modelProvider":"proxy","approvalPolicy":"on-request",
      "sandbox":{"type":"readOnly","networkAccess":false},"reasoningEffort":"low",
      "multiAgentMode":"explicitRequestOnly", ...}}}
<<< {"method":"thread/started","params":{"thread":{...same shape, id "019f5507-d852-...", same as above...}}}
```
`thread/start`'s result directly surfaces: the rollout file path, sandbox mode, approval policy,
model/provider, reasoning effort, and `multiAgentMode` — all in one call, no separate config
round trip needed. Note default `sandbox.type` was `readOnly` here (no `-s` override passed to
`app-server` at spawn time — differs from `codex exec`'s CLI default; an app-server client should
pass sandbox/approval explicitly per thread if it needs a specific policy, likely via
`thread/settings/update` or `turn/start` params, not tested further this round).

Then a full turn, on the same `019f5507-d852-...` thread from `thread/start` above:
```
>>> {"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"019f5507-d852-7da0-bfc3-83ebc8d91372",
      "input":[{"type":"text","text":"Reply with exactly the word: APPSERVER_PONG"}]}}
<<< {"id":3,"result":{"turn":{"id":"019f5507-e019-...","status":"inProgress", ...}}}
<<< {"method":"thread/status/changed","params":{"threadId":"...","status":{"type":"active",...}}}
<<< {"method":"turn/started","params":{"threadId":"...","turn":{"id":"019f5507-e019-...", ...}}}
<<< {"method":"item/started","params":{"item":{"type":"userMessage", ...}}}
<<< {"method":"item/completed","params":{"item":{"type":"userMessage", ...}}}
<<< {"method":"item/started","params":{"item":{"type":"agentMessage","id":"msg_...","text":"", ...}}}
<<< {"method":"item/agentMessage/delta","params":{..."delta":"AP"}}
<<< {"method":"item/agentMessage/delta","params":{..."delta":"PS"}}
<<< {"method":"item/agentMessage/delta","params":{..."delta":"ERVER"}}
<<< {"method":"item/agentMessage/delta","params":{..."delta":"_P"}}
<<< {"method":"item/agentMessage/delta","params":{..."delta":"ONG"}}
<<< {"method":"item/completed","params":{"item":{"type":"agentMessage","text":"APPSERVER_PONG", ...}}}
<<< {"method":"thread/tokenUsage/updated","params":{"threadId":"...","turnId":"...",
      "tokenUsage":{"total":{"totalTokens":8786,"inputTokens":8777,"cachedInputTokens":8064,
      "outputTokens":9,"reasoningOutputTokens":0}, "last":{...}, "modelContextWindow":353400}}}
<<< {"method":"account/rateLimits/updated", ...}
<<< {"method":"thread/status/changed","params":{..."status":{"type":"idle"}}}
<<< {"method":"turn/completed","params":{"threadId":"...","turn":{"id":"...","status":"completed",
      "startedAt":1783838007,"completedAt":1783838011,"durationMs":3757}}}
```
Fully confirmed: `initialize` → `thread/start` (yields `threadId`) → `turn/start` (yields
`turnId`, streams `item/*` events, ends in `turn/completed`) is a real, working lifecycle on
0.144.1. `thread/tokenUsage/updated` is pushed automatically after each turn — this is the
**cleanest occupancy-probe signal for an app-server-driven LEAD** (no JSONL polling needed at
all, see E03).

## Step 3 — `model/list`: live enumeration of models available under this auth (round 2, item 9)

Round 1 left item 9's "which models are available under this auth" unanswered (only the
config-default `gpt-5.6-sol` and one ad-hoc `gpt-5-mini` probe were observed). `model/list` is one
of the `ClientRequest` methods surfaced by the schema dump in Step 1 — called it live in a fresh
`initialize`→`initialized`→`model/list` sequence (separate short-lived probe process,
`probe3.py`):
```
>>> {"jsonrpc":"2.0","id":2,"method":"model/list","params":{}}
<<< {"id":2,"result":{"data":[
  {"id":"gpt-5.6-sol","displayName":"GPT-5.6-Sol","description":"Latest frontier agentic coding model.",
    "defaultReasoningEffort":"low","isDefault":true,
    "supportedReasoningEfforts":["low","medium","high","xhigh","max","ultra"]},
  {"id":"gpt-5.6-terra","displayName":"GPT-5.6-Terra","description":"Balanced agentic coding model for everyday work.",
    "defaultReasoningEffort":"medium","isDefault":false,
    "supportedReasoningEfforts":["low","medium","high","xhigh","max","ultra"]},
  {"id":"gpt-5.6-luna","displayName":"GPT-5.6-Luna","description":"Fast and affordable agentic coding model.",
    "defaultReasoningEffort":"medium","isDefault":false,
    "supportedReasoningEfforts":["low","medium","high","xhigh","max"]},
  {"id":"gpt-5.5","displayName":"GPT-5.5","description":"Frontier model for complex coding, research, and real-world work.",
    "defaultReasoningEffort":"medium","isDefault":false,"supportsPersonality":true,
    "supportedReasoningEfforts":["low","medium","high","xhigh"]},
  {"id":"gpt-5.4","displayName":"GPT-5.4","description":"Strong model for everyday coding.",
    "defaultReasoningEffort":"medium","isDefault":false,"supportsPersonality":true,
    "supportedReasoningEfforts":["low","medium","high","xhigh"]},
  {"id":"gpt-5.4-mini","displayName":"GPT-5.4-Mini","description":"Small, fast, and cost-efficient model for simpler coding tasks.",
    "defaultReasoningEffort":"medium","isDefault":false,"supportsPersonality":true,
    "supportedReasoningEfforts":["low","medium","high","xhigh"]},
  {"id":"gpt-5.2","displayName":"GPT-5.2","description":"Optimized for professional work and long-running agents.",
    "defaultReasoningEffort":"medium","isDefault":false,
    "supportedReasoningEfforts":["low","medium","high","xhigh"]}
],"nextCursor":null}}
```
(response abridged to the load-bearing fields; the raw response also carries per-model
`inputModalities`, `additionalSpeedTiers`, `serviceTiers`, and `availabilityNux` marketing text —
full raw JSON is in `probe3-out.txt` in the scratchpad.)

**Seven models served under this auth**, from fastest/cheapest to most capable:
`gpt-5.4-mini` < `gpt-5.4` / `gpt-5.2` < `gpt-5.5` < `gpt-5.6-luna` < `gpt-5.6-terra` <
`gpt-5.6-sol` (default, `isDefault:true`, matches `~/.codex/config.toml`'s configured
`model = "gpt-5.6-sol"`). Every model accepts `low`/`medium`/`high`/`xhigh` reasoning effort;
`gpt-5.6-sol`/`gpt-5.6-terra` additionally accept `max` and `ultra` (`ultra` is described as
*"Maximum reasoning with automatic task delegation"* — notably, this ties reasoning effort
directly into the native multi-agent system from E11: at `ultra` effort the model may delegate
sub-tasks automatically even without an explicit user request to do so, which matters for solution
01's "do not delegate" guard — a leaf-worker dispatch should avoid `-c
model_reasoning_effort="ultra"` if flat-hierarchy enforcement is required, since `ultra` may
override the `explicitRequestOnly` multi-agent-mode guard by design).

`gpt-5.6-luna` (`"Fast and affordable"`) and `gpt-5.4-mini` (`"Small, fast, and cost-efficient...
for simpler coding tasks"`) are the two candidates for rasen's "cheap/fast" role tier;
`gpt-5.6-sol` (`"Latest frontier agentic coding model"`) for the "high-capability" tier — this
now gives round 2's model-per-role table concrete ids to assign, closing round 1's open question.

## Verdict for item 12

The playbook's vocabulary ("app-server threads", `threadId`/`turnId`) is **directionally correct
and now live-verified**, but the exact method names must be `thread/start`/`thread/resume`/
`thread/fork` + `turn/start`/`turn/interrupt`/`turn/steer` (not the placeholder names in the
seed list). `codex mcp-server` (MCP-server mode, separate from `app-server`) was not
live-tested this round — it exists (`codex mcp-server --help` confirms a stdio MCP server) and is
a plausible alternative bridge (Codex as an MCP tool callable *from* Claude Code) but the
JSON-RPC `app-server` protocol above is richer (thread/turn granularity, streaming deltas,
approval callbacks) and is the better fit for a LEAD that wants full control.

## Reproduction

`codex app-server generate-json-schema --experimental -o <dir>` for the schema dump (cheap, no
auth needed). For the live round trip (or `model/list`), spawn `codex app-server
<model_providers overrides>` as a subprocess, write newline-delimited JSON-RPC requests to its
stdin, read line-delimited JSON responses/notifications from stdout; `model/list` only needs
`initialize`+`initialized` first, no `thread/start`.
