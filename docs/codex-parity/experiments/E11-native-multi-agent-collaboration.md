# E11 — Codex has a NATIVE multi-agent system: `spawn_agent`/`wait_agent`/`send_message`

**Codex CLI version:** 0.144.1

## Purpose

While inspecting E01's baseline rollout for item 5 (token usage), the fixed system-scaffolding
`response_item`s at the start of every fresh thread turned out to contain a full multi-agent
system prompt — unrelated to anything in the goal-plan's seed list, which assumed Codex would
need to be *bridged into* multi-agent behavior via app-server. This experiment verifies whether
that system prompt corresponds to a real, working tool surface, or is dead/vestigial text.

## Finding 1: every fresh thread's developer-role messages include a full multi-agent system prompt

From E01's baseline rollout (`response_item`, `role: developer`):
```
You are `/root`, the primary agent in a team of agents collaborating to fulfill the user's goals.
At the start of your turn, you are the active agent.
You can spawn sub-agents to handle subtasks, and those sub-agents can spawn their own sub-agents.
All agents in the team, including the agents that you can assign tasks to, are equally
intelligent and capable, and have access to the same set of tools.
You can use `spawn_agent` to create a new agent, `followup_task` to give an existing agent a new
task and trigger a turn, and `send_message` to pass a message to a running agent without
triggering a turn.
Child agents can also spawn their own sub-agents.
You can decide how much context you want to propagate to your sub-agents with the `fork_turns`
parameter.
You will receive messages in the analysis channel in the form:
Message Type: MESSAGE | FINAL_ANSWER
Task name: <recipient>
Sender: <author>
Payload:
<payload text>
They may be addressed as to=/root
```
Immediately followed by a guardrail directive in a separate developer message:
```
<multi_agent_mode>Do not spawn sub-agents unless the user or applicable AGENTS.md/skill
instructions explicitly ask for sub-agents, delegation, or parallel agent work.</multi_agent_mode>
```
`codex doctor --json`'s `config.load` check lists `multi_agent` among 35 **enabled** feature
flags — this is not an opt-in experiment, it's on by default in 0.144.1. The app-server
`thread/start` response (E07) also surfaces this directly as a per-thread field:
`"multiAgentMode":"explicitRequestOnly"`.

## Finding 2 (live proof): `spawn_agent` is a real, working tool call, not vestigial prompt text

```
codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  "Spawn a sub-agent (using your spawn_agent tool if available) whose only task is to reply with
   the exact word SUBAGENT_PONG. Then report back what the sub-agent said. If you do not have a
   spawn_agent tool available in this session, just say NO_SPAWN_TOOL and explain why."
```
Result: `EXIT:0`, final message: `"The sub-agent said: SUBAGENT_PONG"`. JSONL:
```json
{"type":"item.started","item":{"id":"item_1","type":"collab_tool_call","tool":"wait",
  "sender_thread_id":"019f5505-6b61-...","receiver_thread_ids":[], "status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"collab_tool_call", ...,"status":"completed"}}
```
Full rollout inspection (`response_item.type == "function_call"`) shows the real tool
invocations:
```
FUNCTION_CALL: spawn_agent {"task_name":"pong","fork_turns":"all",
  "message":"gAAAAABqUzShQXucCHGtM_N9g7jfnAfMGtLRs4y3ybJrEsAzW8Z5rvTbacYk-..." (Fernet-encrypted)}
EVENT: sub_agent_activity {"agent_thread_id":"019f5505-9956-7b70-9441-d08ba01b049c",
  "agent_path":"/root/pong","kind":"started"}
FUNCTION_OUTPUT: {"task_name":"/root/pong"}
FUNCTION_CALL: wait_agent {"timeout_ms":30000}
FUNCTION_OUTPUT: {"message":"Wait completed.","timed_out":false}
```

## Finding 3: the child agent is a genuine separate rollout/thread, forked from the parent

`spawn_agent`'s `fork_turns:"all"` created a **second rollout file**
(`rollout-2026-07-12T14-30-58-019f5505-9956-7b70-9441-d08ba01b049c.jsonl`) whose `session_meta`
carries:
```json
{"session_id":"019f5505-6b61-...","id":"019f5505-9956-...",
 "forked_from_id":"019f5505-6b61-79e2-a756-c920294454eb",
 "parent_thread_id":"019f5505-6b61-79e2-a756-c920294454eb", ...}
```
i.e. `thread/fork` (the same app-server method discovered in E07's schema dump) is the underlying
mechanism — `spawn_agent` is a tool-call-level wrapper around a `thread/fork`-equivalent
operation. The forked child's rollout starts with the **entire parent conversation replayed**
(same developer/user messages as the parent, since `fork_turns:"all"`), plus one new
developer-role message specific to child agents:
```
You are an agent in a team of agents collaborating to complete a task.
```
and a synthesized task-delivery message in the child's context:
```
Message Type: NEW_TASK
Task name: /root/pong
Sender: /root
Payload:
<the decrypted content of spawn_agent's `message` param>
```
The child then runs its own turn and produces `SUBAGENT_PONG` as its `agent_message`, which the
parent receives back via `wait_agent` and relays verbatim.

## Interpretation — this changes the whole design for items 1, 2, 3

The goal-plan's premise for items 1/2/3 was: *"how does a Claude LEAD launch a Codex worker
non-interactively... how is role isolation preserved... [design] the Codex equivalent of
continuing the same conversation."* That premise assumed Codex has no native multi-agent
primitive and rasen would need to bridge orchestration itself (spawning separate `codex exec`
processes, tracking threadIds by hand). **That assumption is wrong for the in-process case**:
Codex 0.144.1 ships its own multi-agent orchestration (`spawn_agent`/`followup_task`/
`send_message`/`wait_agent`) with:
- Hierarchical, not flat, agent trees by default (`agent_path` like `/root/pong`, children can
  spawn grandchildren) — the **opposite** of rasen's flat-hierarchy invariant.
- A prompt-level guardrail (`<multi_agent_mode>explicitRequestOnly</multi_agent_mode>`) that
  already suppresses unsolicited spawning — this is directly reusable/extendable: rasen's own
  dispatch prompts could rely on this native guard plus explicit instruction to enforce
  "do not spawn agents" for leaf workers, rather than inventing a new mechanism.
- `followup_task`/`send_message` are the **native Codex equivalent of Tier-A SendMessage/warm
  continuation to a live agent** (item 3) — untested live this round (budget), but their
  existence in the same tool family as the proven `spawn_agent`/`wait_agent` pair makes them
  high-confidence candidates for round 2 live verification.

**This does NOT replace the process-level `codex exec resume <id>` mechanism validated in E02** —
that remains the correct primitive for a rasen LEAD (running as a *separate* Claude process) to
warm-continue a *previously-dispatched, separate* `codex exec` process/thread across LEAD-driven
dispatches. The native `spawn_agent` family is a **second, complementary layer**: it's what
happens *inside* a single Codex thread if that thread itself decides to delegate a subtask — which
matters if rasen ever dispatches "one Codex worker that internally fans out," or if rasen wants to
mirror its own Task-tool semantics as closely as possible using Codex's own idiom instead of
process-level orchestration from outside.

## Open follow-up for round 2

- Live-test `followup_task`/`send_message` to a *running* (not-yet-completed) child agent — this
  round only observed `spawn_agent` + `wait_agent` (blocking wait), not async messaging to a
  live agent mid-run.
- Verify whether `<multi_agent_mode>explicitRequestOnly</multi_agent_mode>` can be set via a
  config flag/CLI flag rather than relying on the model reading a fixed system prompt (grep
  turned up no obvious `-c` key this round; the app-server thread field `multiAgentMode` suggests
  a `thread/start` param may control it, unconfirmed).

## Reproduction

```
codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  "Spawn a sub-agent whose only task is to reply with the exact word SUBAGENT_PONG. Then report
   back what the sub-agent said."
```
Then inspect the resulting rollout JSONL for `function_call` items named `spawn_agent`/
`wait_agent`, and `grep -rl <child_thread_id_from_sub_agent_activity_event>
~/.codex/sessions` to find the child's own rollout file.
