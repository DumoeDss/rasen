## Context

The goal-loop family (`/rasen-goal` → `goal-loop-{measure,evaluate,research}`) drives a bounded modify→judge loop. Two prompt-level weaknesses, surfaced by comparing rasen against Codex's `continuation.md`:

1. **Gate laxity.** The evaluate gate's fresh reviewer (Step L evaluate branch, goal-command termination invariants) returns `{satisfied, gaps}` but is not told *how* to decide satisfaction. Absent that discipline it can pass a round by not noticing remaining work, and the implementer can shrink the goal to something easier and self-report success.
2. **Premature give-up.** Nothing governs an implementer's *blocked* claim. The stall counter (`loopStallLimit`) counts non-progressing rounds against the score/gap set, and `maxRounds` bounds the whole loop — but neither handles "the implementer says it cannot proceed." A first-round blocked report ends the loop with no second angle attempted.

The existing counters are already carefully disambiguated in the Step H counter table: relay count, review rounds, strategy attempts, goal-loop rounds, goal stall (`loopStallLimit`), handoff stall (`stallLimit`), session relay. A blocked guard must slot in as a *distinct* counter, not overload any of these.

## Goals / Non-Goals

**Goals:**
- Move Codex-style completion-audit discipline (paraphrased to English, not copied) into the evaluate-gate reviewer prompt and the implementer/planner fidelity wording.
- Add a `blockedThreshold` (default 3) so a blocked verdict requires the same blocker to recur across N consecutive rounds, each round re-attempted from a different angle, resetting on any progress.
- Keep the field plumbing exactly parallel to `loopStallLimit`/`maxRounds`: registry schema default → injected `loopConfig` → copied from goal-plan.md at inject.

**Non-Goals:**
- No change to review-cycle loop semantics or to the measure gate's pass/fail arithmetic.
- No new pipeline YAML fields required — defaults suffice; per-task override lives in goal-plan.md.
- No change to the `pipeline show` goal-loop meta label (`loop=goal[{gate}](max, stall)`) — blockedThreshold is an orchestration-prompt-consumed field, not a rendered one, so the label and its three locales stay untouched.
- No version bump.

## Decisions

### D1 — Completion audit lives in the evaluate branch only, not the measure branch
The measure gate is a deterministic command; "prove completion" is already what a threshold comparison does. The audit discipline is prose that guides a *human-like reviewer*, so it attaches to (a) Step L's evaluate dispatch prompt, (b) goal-command's `author != verifier` / evaluate termination invariant, and (c) the Tier-C reset-pass fallback (same reviewer discipline, single context). The implementer-side wording (goal-iterate self-check, goal-plan goal framing) carries only the *anti-scope-shrink* fidelity clause — the implementer never certifies the rubric, so it gets the "don't redefine success smaller" half, not the "audit the evidence" half.

Rationale: keeps the audit where a judgment actually happens and avoids bloating the measure path with irrelevant prose.

### D2 — `blockedThreshold` is a new named counter, distinct from stall and maxRounds
Three orthogonal give-up conditions now exist:
- `maxRounds` (5) — total loop budget, unconditional.
- `loopStallLimit` (2) — consecutive rounds with no favorable score/gap movement → Step H.5 strategy review.
- `blockedThreshold` (3) — consecutive rounds where the implementer *reports the same blocker* → escalate as genuinely blocked.

They are independent: a loop can progress (no stall) yet the implementer hits a wall it reports (blocked); a loop can be un-blocked yet stuck (stall). The counter table in Step H gains a `blocked streak` row. Default 3 (Codex's value) is deliberately higher than the stall limit of 2: a self-reported wall deserves more benefit-of-the-doubt retries than a silent non-improvement, because the point is to force alternate angles before quitting.

Alternatives considered: (a) fold blocked into `loopStallLimit` — rejected, conflates "no score movement" with "I give up" and would make the reset semantics ambiguous; (b) make it purely prompt-level with a hardcoded 3 — rejected, per-task tuning (a genuinely hard research task may want a higher wall-tolerance) wants the same goal-plan.md → loopConfig plumbing the other two fields already have.

### D3 — Blocked recurrence requires the SAME blocker; any change resets
The LEAD compares the current round's reported blocker against the prior round's. Recurrence counts only when it is materially the same obstruction. A *different* blocker, or any measured/judged progress, resets the streak to zero — otherwise unrelated one-off obstacles across rounds would accumulate into a false escalation. Each retry round the LEAD's re-dispatch explicitly instructs the implementer to try a different angle (new approach, different tool, decompose the obstruction), mirroring Step H.5's material-change requirement. Recording: the reported blocker and streak live in the round record / `loopProgress`, so the streak survives worker relay.

### D4 — Escalation on threshold is the existing Step H.5/H.6 ladder, not a hard stop
When `blockedThreshold` is reached the loop does not silently die: it runs the same LEAD strategy review as a stall (H.5) — re-approach, design-level rework via planner, or isolate — and only a truly exhausted ladder parks the stage `escalated` and surfaces it at the next pause (H.6). This reuses machinery rather than inventing a new terminal state, and keeps the "never hard-stop mid-flight for one stuck stage" invariant.

## Risks / Trade-offs

- [Reviewer over-strictness — the completion audit could make an evaluate gate never pass, burning all `maxRounds`.] → The audit demands *proof proportional to the goal/rubric*, not perfection; `maxRounds` still bounds the loop and `maxRounds-exhausted` is reported honestly. The gaps the reviewer returns steer the next round, so a strict-but-specific reviewer accelerates convergence rather than blocking it.
- [Blocked-streak false negative — a real hard block gets retried 3× wastefully.] → Bounded by `blockedThreshold` (small) and subsumed by `maxRounds`; the alternate-angle retries are exactly the desired behavior (Codex's premise: first-round blocked is usually premature). A per-task lower value can be set in goal-plan.md for genuinely one-shot gates.
- [Prompt-length growth in already-large templates.] → Wording is paraphrased tight; parity hashes catch any unintended drift.
- [Parity/locale drift.] → Only template bodies change; `.claude/skills` regenerated and parity hashes updated in the same change. The `pipeline show` label is deliberately left alone (D-non-goal), so no locale/JSON edits and no `goal-loop-validation` label-scenario churn.

## Migration Plan

Additive and backward-compatible: `blockedThreshold` is an optional schema field with a default, so existing pipeline YAMLs, run-state files, and goal-plan.md files parse unchanged (a plan that omits it gets the default 3 at inject). No data migration. Rollback = revert the templates + schema field; no persisted state depends on it.

## Open Questions

- None blocking. Whether to eventually surface `blockedThreshold` in the `pipeline show` meta label is left as a future cosmetic decision (deliberately out of scope here to avoid locale churn).
