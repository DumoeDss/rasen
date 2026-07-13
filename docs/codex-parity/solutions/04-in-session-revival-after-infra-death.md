# 4 — In-session revival after infra death (Step H.4a(b)) and DONE-with-unticked-tasks nudge (H.4b)

**Status: live-verified**

## Experiments

E02 (kill mid-turn with `kill -9`, then resume).

## Solution

`codex exec resume <thread-id>` works after a hard kill (`kill -9`) mid-turn, and **all
already-persisted turns survive** — E02's test taught a fact ("PANTHER-7"), then triggered a
`sleep 30` shell command specifically so the process could be killed while a command was actively
executing, then killed the process with `kill -9` (no graceful shutdown). Resuming afterward, the
model correctly recalled "PANTHER-7" from the pre-kill turn. This works because Codex appends each
`response_item` to the rollout JSONL as it's produced during a turn (confirmed by E02's partial
capture showing `thread.started`/`turn.started` before the kill, with the killed turn's own
`turn.completed` never appearing) — so only the **in-flight, uncommitted turn's final answer** is
lost; every prior committed turn (and the user message that started the killed turn, since that
gets appended before the model even starts responding) is intact.

**Practical implication for H.4a(b)/H.4b:** a rasen LEAD revives an infra-dead Codex worker
exactly like a Claude one conceptually — by re-engaging with a new message — but the mechanism
differs: instead of "SendMessage to a still-alive process," it's "start a brand-new `codex exec
resume <thread-id>` process." The LEAD should treat "the last JSONL line for a thread has
`turn.started` with no matching `turn.completed`/`turn.failed`" as the death signal (equivalent to
Claude's transcript-based detection), then issue a `resume` call with either (a) a nudge message
("continue where you left off" / "you were interrupted, please finish and report DONE/HANDOFF"),
matching H.4b's unticked-tasks nudge pattern, or (b) a fresh instruction if the LEAD wants to
redirect rather than continue.

## Resume/identity handle

Same thread id as any other resume (solution 03). Detecting death: absence of a `turn.completed`
event following the last `turn.started` in the thread's rollout JSONL, or (for an app-server-driven
LEAD) the process/websocket connection dying without a `turn/completed` notification (E07).

## Structured output capture

Same `--output-schema` mechanism (solution 08) — a revival `resume` call can still request
schema-conformant DONE/HANDOFF output.

## Failure modes

Only the in-flight turn's uncommitted content is lost; a command that was mid-execution when
killed (in E02's case, `sleep 30`) simply never completes and its output is absent from the
resumed context — the LEAD's revival prompt should account for "the last action may not have
finished" (e.g. re-verify file state rather than trusting the pre-kill turn's claims about a
command's result).
