# Design: Context Sensing & Handoff

## Principles (settled with the user)

1. **Blackboard first.** Continuous externalization (tasks.md ticks, notes on disk) is the base persistence; the handoff document only carries what the blackboard cannot: decision rationale, eliminated hypotheses, gotchas, the next concrete action.
2. **Discrete checkpoints, never a running meter.** Probes run at decision points (auto entry, SendMessage warm-continue, worker return). Injecting a live countdown breaks the prompt-cache prefix and induces context anxiety (model prematurely wraps up).
3. **Single writer.** Only the LEAD writes `auto-run.json` / `portfolio-run.json`. Workers write handoff docs + return structured results; the LEAD does the accounting.
4. **Minimize hard interruptions.** Session handoff is user-invoked; quality/relay escalations go to the LEAD first; humans see parked escalations at natural pause points (gates, run end), not mid-run stops.
5. **Decompose is the primary tool; handoff is the safety net.** Repeated relays signal a task that should be split, not relayed harder.

## Sensing

`openspec agent context`:

- Input: `--transcript <path>` or `--latest` (newest main-session `*.jsonl` — not `agent-*.jsonl` — under the Claude projects dir for the cwd, resolved via the same cwd-slug convention the playbook's glob uses; overridable with `--dir`).
- Computation: scan the jsonl for the last assistant entry carrying `message.usage`; `contextTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Model comes from the same entry.
- Limit: built-in map (known model-id prefixes → window: current Opus/Sonnet/Fable 1M; Haiku 4.5 and older 200k; default 200k as the conservative fallback), overridable with `--limit`.
- Output: text or `--json` `{ model, contextTokens, limit, pct, transcript }`. Exit 0 even when above thresholds (it is a probe, not a gate); non-zero only on unreadable/missing transcript.

Workers cannot self-probe (they do not know their own transcript path). Worker-side triggers are therefore: (a) LEAD-supplied soft budget in the spawn prompt, (b) the compaction marker (conversation prefix replaced by a summary) as a hard trigger, (c) self-assessment. LEAD-side probes cover the rest (their transcript paths are in run-state).

## Handoff document

Written to `openspec/changes/<id>/handoff/<role>-<n>.md` (session-level: `lead-<n>.md`; `<n>` increments). Template sections: original intent; pipeline position; done/remaining (referencing tasks.md, not copying it); key decisions + why; dead ends / gotchas; **eliminated hypotheses + evidence** (mandatory for fixer/debugger roles); working set (files); next concrete action.

## Config resolution

```yaml
handoff:            # pipeline level (all optional)
  threshold: 0.5    # 0-1 fraction of the context window
  roles: { reviewer: 0.65, fixer: 0.65 }
  maxRelays: 3      # Nth+1 handoff request on one stage triggers LEAD review
  stallLimit: 2     # consecutive no-progress handoffs that trigger LEAD review early
stages:
  - id: review-loop
    handoff: { threshold: 0.7, maxRelays: 5 }   # stage overrides win
```

Resolution: stage.handoff > pipeline.handoff.roles[stage.role] (threshold only) > pipeline.handoff > built-in defaults `{ threshold: 0.5, maxRelays: 3, stallLimit: 2 }`. `stallLimit` deliberately has no per-role loosening default: hard problems slow progress, they don't zero it — eliminating a hypothesis counts as progress.

## Run-state additions (all optional, backward compatible)

```json
{
  "sessionHandoff": { "path": "handoff/lead-1.md", "pct": 0.52, "afterStage": "apply", "at": "<iso>" },
  "stages": {
    "apply": {
      "status": "in_progress",
      "handoffs": [
        { "n": 1, "path": "handoff/implementer-1.md", "reason": "compaction", "completed": ["1.1","1.2"], "remaining": ["1.3"], "at": "<iso>" }
      ],
      "strategyAttempts": [ { "round": 3, "action": "re-prompt", "rationale": "...", "result": "..." } ]
    }
  }
}
```

`pipeline resume` surfaces `sessionHandoff` and per-stage `handoffs` (latest doc path per stage) so a new session reads the distillate before (or instead of) raw-transcript warm-seeding — handoff doc preferred, transcript fallback.

## Escalation ladder (shared by relay-cap, stall, and review-loop rounds-exhausted)

1. **LEAD review (no human gate).** Triggered by: (maxRelays+1)th handoff request, `stallLimit` consecutive no-progress handoffs, or review-loop round cap with open Blocker/Major. Every retry must change a material variable; options ordered by cost: change approach/re-prompt (incl. better seeding to cut bootstrap burn), design-level rework via the planner, isolate/decompose the stubborn slice. Attempts recorded in `strategyAttempts`.
2. **Strategy budget** (default 3 attempts per stage) exhausted → **non-blocking escalation**: mark the stage `escalated` with full history, park it, continue unblocked work (other portfolio children; later stages only if the open findings do not block them), and present parked items at the next gate or the run-end report. Never report clean while a Blocker/Major is open; never silently pass.

## Worker contract (spawn-prompt clause)

Return either `DONE` (+ summary) or a structured handoff block:
`HANDOFF { path, reason: compaction|budget|self-assessment, completed: [...], remaining: [...] }`.
On `HANDOFF`: LEAD appends to the stage's `handoffs[]`, compares `remaining` against the previous relay for stall detection, and (below caps) spawns a successor seeded with the handoff doc + remaining tasks — same stage, same session. On abnormal death (no doc): cold-reconstruct from the blackboard. A `DONE` with unticked tasks is treated as a handoff without a doc.

## Out of scope

- Hook-based per-turn usage injection (rejected: cache/noise/anxiety).
- Automatic main-session restart (platform cannot; auto-compact remains the backstop).
- Codex-worker thread probing (threadId resume already exists; handoff docs work cross-runtime as-is).
