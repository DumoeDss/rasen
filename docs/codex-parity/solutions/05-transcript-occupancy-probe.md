# 5 — Transcript occupancy probe (`rasen agent context --transcript`)

**Status: live-verified** — and Codex's version is *strictly easier* than Claude's

## Experiments

E03 (rollout transcript anatomy), E07 (the same data pushed live over app-server).

## Solution

Every Codex rollout JSONL (`~/.codex/sessions/<Y>/<M>/<D>/rollout-<ts>-<thread_id>.jsonl`)
contains `event_msg` rows with `payload.type == "token_count"`:
```json
{"type":"event_msg","payload":{"type":"token_count","info":{
  "total_token_usage":{"input_tokens":8053,"cached_input_tokens":7680,"output_tokens":6,
    "reasoning_output_tokens":0,"total_tokens":8059},
  "last_token_usage":{...same shape, this-turn-only...},
  "model_context_window":353400
}}}
```
**Exact recipe:** open the rollout file, find the *last* line with `payload.type=="token_count"`,
compute `pct = payload.info.total_token_usage.total_tokens / payload.info.model_context_window`.
Unlike Claude's transcript format (where `agent-context.ts` must sum
`input + cache_read + cache_creation` from the last `message.usage` entry and separately know the
model's context window from an external table), **Codex emits the context window inline in the
same event**, so no model-to-window lookup table is needed at all. `task_started` events also
carry `model_context_window` independently, as a redundant cross-check.

For an app-server-driven LEAD (solution 12), the identical data arrives as a push notification
with zero polling: `thread/tokenUsage/updated` — `{threadId, turnId, tokenUsage: {total: {...},
last: {...}, modelContextWindow}}` (E07), field names camelCased but otherwise identical shape.

## Threshold family

Rasen's existing thresholds (handoff 0.5, reuse 0.25, research relay 0.35) transfer directly —
compute the same `pct` and apply the same cutoffs; no Codex-specific recalibration is needed since
`model_context_window` is exact (not estimated) for every model this environment served (verified
353400 for `gpt-5.6-sol` across every experiment in this dossier).

## Resume/identity handle

Same thread id used to locate the rollout file (glob `~/.codex/sessions/**/*<thread_id>*.jsonl`,
or read the `path` field directly from an app-server `thread/start`/`thread/resume` response —
E07 showed this field populated).

## Failure modes

None observed — this is a strictly more reliable signal than Claude's, since it's provider-emitted
rather than client-computed. One caveat: `token_count` events are only guaranteed after at least
one completed turn; a thread with zero completed turns (e.g. killed before any `turn.completed`,
see solution 04) has no `token_count` line yet — treat "no token_count event found" as "0%
occupied," not an error.
