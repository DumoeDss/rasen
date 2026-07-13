# 2 — Parallel dispatch (`parallelGroup`)

**Status: live-verified** (light load; no stress test)

## Experiments

E08 (two concurrent `codex exec` against the same repo).

## Solution

The LEAD launches N independent `codex exec` subprocesses concurrently (standard OS-level
concurrency — background each process, `wait` on all). Live-verified with 2 simultaneous runs
against the same throwaway git repo, each writing a distinct file under `-s workspace-write`: both
completed cleanly, both files landed correctly, no lock errors, no cross-talk. Each concurrent
`codex exec` gets its own thread id and rollout file automatically (fresh-thread-per-invocation
default), so there is no shared-thread race to worry about as long as the LEAD does not `resume`
the same thread id from two processes simultaneously (untested, presumed unsafe — treat one
thread id as single-writer).

## Locking / contention notes

`~/.codex` global state (sqlite dbs for logs/state/goals/memories, `session_index.jsonl`,
`history.jsonl`) is written by every concurrent `codex exec` process; no `SQLITE_BUSY`-style
errors were observed in either process's stderr at N=2. Not stress-tested at higher N or for
same-file write races (two workers editing the same source file concurrently) — flagged as a
round-2 follow-up if rasen ever dispatches a `parallelGroup` where Codex workers' write sets
could overlap.

## Resume/identity handle, structured output

Same as solution 01 — each parallel dispatch is an independent `codex exec` process with its own
thread id; capture via `--output-schema` (solution 08) same as any single dispatch.

## Failure modes

None observed at N=2. Rate-limiting (429, see E02) is a shared-resource failure mode across
*any* set of concurrent or sequential calls against this environment's proxy — not specific to
parallel dispatch, but more likely to surface under burst load; a production dispatcher should
implement backoff/retry on `turn.failed` messages containing `429`.
