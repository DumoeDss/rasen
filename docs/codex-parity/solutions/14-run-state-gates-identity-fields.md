# 14 — Run-state & gates (auto-run.json / goal-run.json, `rasen pipeline resume`, gate pauses)

**Status: live-verified**

## Experiments

E01 (identity fields from both `--json` and plain output), E02 (resumability), E03/E07 (fields
available for run-state records).

## Solution

For a Codex worker record in rasen's run-state files (`auto-run.json`/`goal-run.json`), the
identity fields resolvable from a real `codex exec` invocation are:

- **`threadId`**: from `--json`'s `thread.started` event (`{"type":"thread.started",
  "thread_id":"<uuid>"}`), or from plain (non-`--json`) output's header line
  (`session id: <uuid>`) — either mode works, live-verified in E01.
- **`turnId`**: not directly exposed by `codex exec`'s `--json` event stream (which reports
  `turn.started`/`turn.completed` without an explicit turn id in the exec-mode JSONL schema
  observed this round — E01/E02/E04/E05 JSONL samples all show bare `{"type":"turn.started"}`
  with no id field). The **rollout file** does carry a `turn_id` per `task_started`/`task_complete`
  `event_msg` payloads (E03) if the run-state record needs one; alternatively, the app-server
  protocol (solution 12) exposes `turn.id` directly in its `turn/start` result and
  `turn/started`/`turn/completed` notification payloads — prefer app-server over `codex exec` if
  turn-level granularity in the run-state record matters.
- **Sandbox/model metadata**: plain output's header block (E01) prints `model`, `provider`,
  `approval`, `sandbox`, `reasoning effort` directly — cheap to capture without `--json` even. The
  app-server `thread/start` result (E07) gives the same fields structured, plus
  `multiAgentMode` and the rollout file `path`.
- **Rollout file path** (useful for a run-state record to point directly at the transcript rather
  than re-deriving it): only exposed by app-server's `thread/start`/`thread/resume` result
  (`thread.path`) — `codex exec`'s own output does not print the rollout path, only the thread id
  (from which the path is derivable via the deterministic
  `~/.codex/sessions/<Y>/<M>/<D>/rollout-<ts>-<id>.jsonl` pattern, or a `grep -rl` fallback, per
  solution 06).

## Recommended run-state record shape for a Codex worker

```json
{
  "runtime": "codex",
  "threadId": "019f5504-86db-7cf1-9b59-5cdcf0f70672",
  "turnId": null,
  "model": "gpt-5.6-sol",
  "modelProvider": "proxy",
  "sandbox": "workspace-write",
  "reasoningEffort": "low",
  "rolloutPath": null
}
```
(`turnId`/`rolloutPath` populate from the rollout JSONL post-hoc via solution 06's glob, if not
using app-server directly.)

## Resumability confirmed

`rasen pipeline resume` on a paused/gated Codex worker record maps directly onto `codex exec
resume <threadId>` (solutions 03/04/06) — live-verified across process boundaries, cwd changes,
and even after a hard kill mid-turn. No gate/pause-flow breakage specific to Codex workers was
found this round; the one asymmetry worth flagging (solution 10) is that `codex exec` has no
`-a/--ask-for-approval` flag, so a rasen gate that expects to pause a worker *mid-turn* for human
approval (rather than pausing *between* dispatches) would need the app-server bridge
(`ServerRequest` approval callbacks, solution 12), not plain `codex exec`.

## Failure modes

Transient `429 Too Many Requests` (E02/E05) should be classified as retryable in run-state,
distinct from a genuine `turn.failed` (e.g. model 404, E05) which should be classified as
non-retryable-without-a-config-change.
