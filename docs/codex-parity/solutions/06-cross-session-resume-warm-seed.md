# 6 — Cross-session resume via transcript warm-seed (Step F.1)

**Status: live-verified**

## Experiments

E02 (resume by explicit thread id from a different cwd/process), E01 (locating the rollout file
by thread id), E03 (rollout anatomy — what "what the predecessor established" looks like).

## Solution

Rasen's Step F.1 glob-and-reseed pattern (`agent-<agentId>.jsonl` + `.meta.json` sidecar, read
back findings, seed a fresh worker) maps onto Codex as follows:

1. **Locating the session file after a restart:** `grep -rl "<thread_id>"
   ~/.codex/sessions/**/*.jsonl`, or more directly, the deterministic path
   `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO-ts>-<thread_id>.jsonl` if the LEAD recorded
   the creation timestamp alongside the thread id (recommended — avoids a full-tree grep).
2. **`codex exec resume <id>` across process/session boundaries:** live-verified in E02 — resume
   was run from a *different cwd* than the original thread's cwd, in a fresh process, and
   correctly recalled prior-turn facts. This works regardless of which shell/session invoked it;
   identity is entirely thread-id-based, not tied to any process or terminal state.
3. **Extracting "what the predecessor established":** unlike Claude's transcript (prose-only),
   Codex's rollout is a structured event log (E03) — a rasen warm-seed reader should filter
   `response_item` rows for `role in {user, assistant}` (skipping the fixed `developer`-role
   system scaffolding at the top of every thread) to reconstruct the human-readable conversation,
   and `event_msg` rows with `payload.type in {task_complete, agent_message}` for the terse
   "final answer per turn" signal — cheaper than replaying every `item.*` delta event.

## Resume/identity handle

Thread id, as in solutions 03/04.

## Structured output capture

If the predecessor's final turn used `--output-schema` (solution 08), the warm-seed reader can
parse the last `agent_message`'s text as strict JSON directly instead of parsing prose.

## Failure modes

None specific to cross-session resume beyond what's already noted in solutions 03/04 (transient
429s). One gap not tested this round: resuming a thread whose rollout file has been moved/archived
(`codex archive`/`codex delete` subcommands exist per `codex --help` — not exercised) — a
production reseed flow should check for an `archived_sessions/` fallback path (observed to exist
on this machine from pre-existing historical sessions, e.g.
`~/.codex/archived_sessions/rollout-2026-02-13T21-04-30-....jsonl`) if a plain resume by id fails.
