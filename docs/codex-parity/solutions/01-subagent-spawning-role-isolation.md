# 1 — Subagent spawning, role isolation, flat hierarchy

**Status: live-verified** (two complementary mechanisms; the flat-hierarchy default needs a
prompt-level constraint, not a code-level one)

## Experiments

E01 (system-prompt scaffolding), E11 (native `spawn_agent` live proof), E02 (process-level
`codex exec`/`resume` as the LEAD-driven equivalent).

## Two distinct ways a Claude LEAD can get a Codex "worker"

### A. Process-level (LEAD-driven, matches rasen's Task-tool model most closely)

The LEAD (a Claude process) spawns a Codex worker by launching a `codex exec` subprocess with a
role-specific prompt, sandbox mode, and model/effort overrides (see solutions 09, 10). This is
exactly analogous to today's Task-tool dispatch: one subprocess per worker, one system prompt per
role, no shared mutable state except the filesystem. Role isolation is trivially preserved because
each `codex exec` invocation gets a **fresh thread** (unless `resume` is explicitly passed) with
its own rollout file and its own developer-message scaffolding — there is no cross-contamination
between two `codex exec` calls unless the caller deliberately resumes the same thread id.
**"Do not spawn agents" for a leaf worker dispatched this way is enforced the same way Claude does
it today: by the role's dispatch prompt not instructing delegation** — Codex's own
`<multi_agent_mode>explicitRequestOnly</multi_agent_mode>` guard (present in every thread by
default, confirmed live in E01/E11) already suppresses *unsolicited* `spawn_agent` calls, so a
rasen leaf-worker prompt that never mentions delegation will not trigger Codex's native
multi-agent tools on its own.

### B. In-thread native (Codex's own multi-agent system, `spawn_agent`/`wait_agent`)

Live-verified in E11: a single Codex thread can call `spawn_agent(task_name, message, fork_turns)`
to fork a **child thread** (`forked_from_id`/`parent_thread_id` in the child's `session_meta`),
then `wait_agent(timeout_ms)` to block for its result. This is Codex's *own* idiom for
"subagent spawning" and is unrelated to rasen's Task tool — it happens entirely inside one
`codex exec` (or app-server) process tree, with **its own recursive hierarchy** (`agent_path`
values like `/root/pong`, and per Finding 1 in E11, children can spawn grandchildren — Codex
does NOT default to a flat hierarchy).

## The flat-hierarchy conflict, and how to enforce it

Rasen's flat-hierarchy invariant ("workers cannot spawn sub-workers") is **not Codex's default**.
If rasen ever lets a Codex worker's prompt mention delegation/parallelism, that worker could use
`spawn_agent` to create grandchildren, which rasen's orchestration model does not expect (no
handoff/HANDOFF-tracking machinery exists in rasen for grandchild threads it never dispatched
directly). **Recommendation:** every rasen-dispatched Codex worker prompt must include an explicit
negative instruction equivalent to Claude's "do not spawn agents" guidance — e.g. append
`"You are a leaf worker. Do not use spawn_agent, followup_task, or any sub-agent delegation tool
under any circumstances."` This relies on the model honoring the instruction (same trust model
Claude's Task-tool workers already operate under) rather than a hard code-level block, since no
`-c`/CLI flag was found this round to disable the `spawn_agent`/`wait_agent`/`send_message` tools
outright (open follow-up — round 2 should check `codex features list` for a togglable flag).

## Resume/identity handle

Process-level: the `thread_id` from `thread.started` (JSONL) or the `session id:` line (plain
output) — see E01. In-thread native: the child's own thread id, discoverable via the
`sub_agent_activity` event's `agent_thread_id` field in the parent's rollout (E11).

## Structured output capture

See solution 08 (`--output-schema`).

## Failure modes

- A worker prompt that *does* mention "delegate" or "parallel" language may unexpectedly invoke
  `spawn_agent` even for a rasen leaf role — audit dispatch prompts for accidental delegation
  language.
- No live-tested way (this round) to hard-disable the tool at the config/CLI level; only
  prompt-level suppression was verified.
