# E03 — Rollout transcript anatomy: token usage and context-window fields

**Codex CLI version:** 0.144.1

## Purpose

Item 5 (the hardest gap per planning-context.md): does `~/.codex/sessions/**/*.jsonl` carry
per-turn token usage / context-window occupancy comparable to Claude's JSONL `message.usage`?

## Method

Opened the rollout file from E01's baseline PONG run
(`~/.codex/sessions/2026/07/12/rollout-2026-07-12T14-29-47-019f5504-86db-7cf1-9b59-5cdcf0f70672.jsonl`)
and parsed every line as JSON, printing `type` and a payload excerpt.

## Line types observed (top-level `type` field of each JSONL row)

`session_meta`, `event_msg`, `response_item`, `world_state`, `turn_context`.

## `event_msg` → `task_started` carries the context window directly

```json
{
  "timestamp": "2026-07-12T06:29:48.065Z",
  "type": "event_msg",
  "payload": {
    "type": "task_started",
    "turn_id": "019f5504-877a-78f2-b66c-a3c4ebaed061",
    "started_at": 1783837788,
    "model_context_window": 353400,
    "collaboration_mode_kind": "default"
  }
}
```

## `event_msg` → `token_count` carries cumulative + last-turn usage, AND the context window again

```json
{
  "timestamp": "2026-07-12T06:29:53.304Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 8053, "cached_input_tokens": 7680, "output_tokens": 6,
        "reasoning_output_tokens": 0, "total_tokens": 8059
      },
      "last_token_usage": {
        "input_tokens": 8053, "cached_input_tokens": 7680, "output_tokens": 6,
        "reasoning_output_tokens": 0, "total_tokens": 8059
      },
      "model_context_window": 353400
    },
    "rate_limits": { "limit_id": "codex", "primary": null, "secondary": null, ... }
  }
}
```

**Exact JSON path for an occupancy probe:** open the newest rollout JSONL for the thread, scan
for the *last* line where `.payload.type == "token_count"`, read
`.payload.info.total_token_usage.total_tokens` and `.payload.info.model_context_window`.
`pct = total_tokens / model_context_window`. This is a direct, better-than-Claude analog — Claude
transcripts require summing `input + cache_read + cache_creation` against an externally-known
context window constant; Codex's rollout emits the context window inline per event, so no
external model-to-window lookup table is needed.

The exact same fields are pushed live over the app-server JSON-RPC channel as a
`thread/tokenUsage/updated` notification (see E07) — so a LEAD driving Codex via app-server gets
this for free as a push event, without polling the JSONL at all:
```json
{"method":"thread/tokenUsage/updated","params":{"threadId":"...","turnId":"...",
  "tokenUsage":{"total":{"totalTokens":8786,"inputTokens":8777,"cachedInputTokens":8064,
  "outputTokens":9,"reasoningOutputTokens":0},
  "last":{...same shape...},"modelContextWindow":353400}}}
```

## `response_item` rows carry the actual conversation content

`role` in `{developer, user, assistant}`; `type` in `{message, function_call,
function_call_output}` (see E11 for `function_call` rows). The **first few developer-role
messages of every fresh thread are fixed system scaffolding** (permissions instructions, skills
instructions, the multi-agent-team system prompt, and a `<multi_agent_mode>` directive — see
E11), followed by a `user`-role `<environment_context>` block, then the actual user turn.

## Reproduction

```python
import json
for line in open(rollout_path):
    d = json.loads(line)
    if d["type"] == "event_msg" and d["payload"]["type"] == "token_count":
        info = d["payload"]["info"]
        pct = info["total_token_usage"]["total_tokens"] / info["model_context_window"]
```
