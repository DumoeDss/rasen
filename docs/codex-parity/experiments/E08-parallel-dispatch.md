# E08 — Parallel dispatch: two simultaneous `codex exec` in the same repo

**Codex CLI version:** 0.144.1

## Purpose

Item 2: can multiple `codex exec` processes run concurrently against the same repo without
lock/state contention?

## Command

Two backgrounded `codex exec` processes launched simultaneously against the **same** throwaway
git repo (`$SCRATCH/e08`), each with `-s workspace-write`, each told to write a distinct file:
```
codex exec --json --skip-git-repo-check $CODEXW_ARGS -s workspace-write \
  -o /tmp/e08a-last.txt "Run: echo AAA > parallel-a.txt   Then reply with exactly: DONE_A" &
codex exec --json --skip-git-repo-check $CODEXW_ARGS -s workspace-write \
  -o /tmp/e08b-last.txt "Run: echo BBB > parallel-b.txt   Then reply with exactly: DONE_B" &
wait
```

## Result

Both completed cleanly and concurrently:
```
=== E08a ===
DONE_A
=== E08b ===
DONE_B
```
`ls $SCRATCH/e08` after both finished: `f  parallel-a.txt  parallel-b.txt` — both files present,
no corruption, no lock errors, no cross-talk between the two threads' outputs. Each process got
its own `thread_id` and its own rollout JSONL under `~/.codex/sessions` (not independently
re-verified by id here, but consistent with every other experiment in this dossier where each
`codex exec` invocation always produces a fresh thread unless `resume` is used).

## Verdict for item 2

No observed lock or state contention for **two** concurrent `codex exec` runs against the same
repo directory. `~/.codex` global state (sessions dir, sqlite dbs for logs/state/goals/memories)
is append-only per-thread and did not visibly conflict. This is a weaker test than a stress test
(only 2 runs, not N-way, and both wrote to *different* files rather than racing on the same file —
true same-file write races were out of scope this round and would be a reasonable round-2
follow-up if rasen ever dispatches a `parallelGroup` where two Codex workers touch overlapping
paths). No evidence of sqlite `SQLITE_BUSY`-style errors in either process's stderr.

## Reproduction

Background two `codex exec` calls with `-s workspace-write` against the same repo dir, `wait`,
diff `ls` before/after.
