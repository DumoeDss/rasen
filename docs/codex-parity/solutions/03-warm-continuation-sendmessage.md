# 3 — Warm continuation / SendMessage (Tier A)

**Status: live-verified** (process-level mechanism; in-thread native mechanism is
code-analysis-only pending round-2 live test)

## Experiments

E02 (resume across processes and cwd), E11 (native `followup_task`/`send_message` — observed in
system prompt, not live-tested this round).

## Solution — process-level (the one to build on)

`codex exec resume <thread-id>` (or `--last` for "the most recently touched thread") re-engages a
previously-created thread with a brand-new user message, and the model **retains full prior-turn
context** — live-verified in E02 by teaching a fact (`ZEBRA-19`) in turn 1 and correctly recalling
it in a `resume` call from a completely separate process, and again from a different `cwd`. This
is the direct Codex counterpart to Claude's Tier-A SendMessage warm continuation: instead of
sending a message to a *live, still-running* agent process, the LEAD terminates the `codex exec`
process after each turn and **reconstitutes** the same thread by id whenever it needs to
re-engage. Functionally equivalent for rasen's purposes (delta re-review, goal-loop
warm-reused implementer, planner reuse) since rasen's own warm-continuation pattern is also
message-then-wait, not a persistent bidirectional channel.

```
codex exec resume <thread-id> --json -o <out-file> "<new message>"
# or: codex exec resume --last --json -o <out-file> "<new message>"
```

## Solution — in-thread native (code-analysis-only this round)

E11 found Codex ships `followup_task` ("give an existing agent a new task and trigger a turn")
and `send_message` ("pass a message to a running agent without triggering a turn") as native
tool-call primitives available to any thread with multi-agent mode active, in the same tool
family as the live-verified `spawn_agent`/`wait_agent` pair. These were **not live-tested** this
round (budget) — only their presence in the system prompt and their conceptual pairing with the
proven `spawn_agent` mechanism give confidence they work. **Round-2 action:** have a parent thread
`spawn_agent` a child, then `send_message` to it *before* calling `wait_agent`, and confirm the
child's next turn reflects the injected message (proves live bidirectional mid-run messaging,
which the process-level `resume` mechanism cannot do — `resume` always waits for the prior turn
to fully finish first).

## Resume/identity handle

The `thread_id` (from `thread.started`/`session id:` — E01) is the sole handle needed; `resume`
accepts it or `--last`.

## Structured output capture

Same `--output-schema` mechanism as any dispatch (solution 08); works identically on a `resume`
call.

## Failure modes

`429 Too Many Requests` observed transiently on a `resume` call in E02 (unrelated to resume
correctness — a provider rate limit, retried successfully ~20s later). No evidence found this
round of context/history loss on resume, even after a `kill -9` mid-turn (see solution 04).
