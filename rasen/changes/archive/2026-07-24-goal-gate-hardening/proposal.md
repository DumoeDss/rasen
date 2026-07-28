## Why

The goal-loop gate is too easy to pass and too easy to quit. On the *pass* side, an evaluate gate's fresh reviewer can wave a round through by failing to find obvious remaining work rather than by proving the goal is actually met — and an implementer can quietly redefine "done" as a smaller, easier task. On the *quit* side, an implementer can declare itself blocked on the very first round and the LEAD takes that at face value, ending a loop that a different angle might have cracked. Both failure modes were surfaced by comparing rasen's goal loop against Codex's `continuation.md` completion-audit discipline and its multi-round blocked threshold.

## What Changes

- **Completion-audit discipline in the evaluate gate.** The fresh reviewer that judges an evaluate gate (goal-command termination invariants + orchestration Step L evaluate branch) treats completion as *unproven*: it derives concrete requirements from the goal/rubric, demands authoritative evidence (files, command output, test results, runtime behavior) for each, treats uncertain or indirect evidence as not-achieved, and must *prove* completion rather than merely fail to find remaining work — never relying on intent, partial progress, or the implementer's memory as proof.
- **Fidelity guard against scope-shrink.** The implementer's self-check (goal-iterate) and the planner's goal framing (goal-plan) forbid redefining success around a smaller or easier task; the goal fixed at define-goal is the goal the gate judges.
- **Blocked-threshold guard against premature give-up.** A new `blockedThreshold` (default 3) on the goal loop: when the implementer reports it is blocked, the LEAD does not immediately accept it. The same blocking condition must recur for `blockedThreshold` consecutive rounds — each round the implementer is re-dispatched to try a materially different angle — before the loop escalates as genuinely blocked. Any progress (or a different blocker) resets the counter.
- **Config plumbing.** `blockedThreshold` is added to the goal `loop` schema (registry) and to the injected `loopConfig` in run-state, and is copied from `goal-plan.md` into the loop config at inject time, exactly parallel to `loopStallLimit`/`maxRounds`.
- **Template parity.** All four goal templates and the shared orchestration playbook change body text, so the parity golden-master hashes are regenerated and `.claude/skills` output is rebuilt per the build→update discipline.

## Capabilities

### New Capabilities
<!-- none — this hardens existing goal-loop behavior -->

### Modified Capabilities
- `goal-loop-workflow`: adds the blocked-threshold guard requirement (multi-round recurrence before a blocked verdict, counter distinct from stall/maxRounds), adds completion-audit discipline to the evaluate gate, and extends the injected `loopConfig` run-state fields with `blockedThreshold`.
- `opsx-goal-command`: the goal-command evaluate-gate termination invariant and the goal-iterate/goal-plan skill contracts carry the completion-audit + anti-scope-shrink wording; goal-plan MAY set a per-task `blockedThreshold`.

## Impact

- Templates: `src/core/templates/workflows/goal-command.ts`, `goal-plan.ts`, `goal-iterate.ts`, `_orchestration.ts` (Step L evaluate branch + counter table).
- Schema: `src/core/pipeline-registry/types.ts` (`StageLoopSchema` goal branch — `blockedThreshold`), `src/core/pipeline-registry/run-state.ts` (`loopConfig.blockedThreshold`).
- Generated output: `.claude/skills/rasen-goal*/` regenerated; parity golden master `test/core/templates/skill-templates-parity.test.ts` hashes updated.
- No version bump; no change to review-cycle loop semantics; pipeline YAMLs unchanged (blockedThreshold defaults suffice, per-task value comes from goal-plan.md).
