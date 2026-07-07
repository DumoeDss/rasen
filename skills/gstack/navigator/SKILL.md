---
name: navigator
version: 1.0.0
disable-model-invocation: true
description: A map of this repo's skills and OPSX workflows and when to reach for each.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

## Preamble (run first)

```bash
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
```

**Config (embedded at install time):**
- **Proactive:** `__OPENSPEC_PROACTIVE__` — if `false`, do not proactively suggest expert skills. Only invoke them when the user explicitly asks.
- **Repo mode:** `__OPENSPEC_REPO_MODE__` — controls issue ownership behavior (see Repo Ownership Mode below).

## AskUserQuestion Format

**ALWAYS follow this structure for every AskUserQuestion call:**
1. **Re-ground:** State the project, the current branch (use the `_BRANCH` value printed by the preamble — NOT any branch from conversation history or gitStatus), and the current plan/task. (1-2 sentences)
2. **Simplify:** Explain the problem in plain English a smart 16-year-old could follow. No raw function names, no internal jargon, no implementation details. Use concrete examples and analogies. Say what it DOES, not what it's called.
3. **Recommend:** `RECOMMENDATION: Choose [X] because [one-line reason]` — always prefer the complete option over shortcuts. Include `Completeness: X/10` for each option. Calibration: 10 = complete implementation (all edge cases, full coverage), 7 = covers happy path but skips some edges, 3 = shortcut that defers significant work. If both options are 8+, pick the higher; if one is ≤5, flag it.
4. **Options:** Lettered options: `A) ... B) ... C) ...` — when an option involves effort, show both scales: `(human: ~X / CC: ~Y)`

Assume the user hasn't looked at this window in 20 minutes and doesn't have the code open. If you'd need to read the source to understand your own explanation, it's too complex.

Per-skill instructions may add additional formatting rules on top of this baseline.

## Repo Ownership Mode — See Something, Say Something

`Repo mode` from the preamble config tells you who owns issues in this repo:

- **`solo`** — One person does 80%+ of the work. They own everything. When you notice issues outside the current branch's changes (test failures, deprecation warnings, security advisories, linting errors, dead code, env problems), **investigate and offer to fix proactively**. The solo dev is the only person who will fix it. Default to action.
- **`collaborative`** — Multiple active contributors. When you notice issues outside the branch's changes, **flag them via AskUserQuestion** — it may be someone else's responsibility. Default to asking, not fixing.
- **`unknown`** — Treat as collaborative (safer default — ask before fixing).

**See Something, Say Something:** Whenever you notice something that looks wrong during ANY workflow step — not just test failures — flag it briefly. One sentence: what you noticed and its impact. In solo mode, follow up with "Want me to fix it?" In collaborative mode, just flag it and move on.

Never let a noticed issue silently pass. The whole point is proactive communication.

## Completion Status Protocol

When completing a skill workflow, report status using one of:
- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.

### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result."

Bad work is worse than no work. You will not be penalized for escalating.
- If you have attempted a task 3 times without success, STOP and escalate.
- If you are uncertain about a security-sensitive change, STOP and escalate.
- If the scope of work exceeds what you can verify, STOP and escalate.

Escalation format:
```
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
```

## Plan Status Footer

When you are in plan mode and about to call ExitPlanMode:

1. Check if the plan file already has a `## GSTACK REVIEW REPORT` section.
2. If it DOES — skip (a review skill already wrote a richer report).
3. If it does NOT — write a `## GSTACK REVIEW REPORT` section to the end of the plan file with this placeholder table:

\`\`\`markdown
## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Verify | \`/opsx:verify\` | Implementation matches the change artifacts | 0 | — | — |
| Verify (enhanced) | \`/opsx:verify-enhanced\` | Adds code-review, security, and browser passes | 0 | — | — |
| Review cycle | \`/opsx:review-cycle\` | Iterate review → triage → fix until clean | 0 | — | — |
| Codex Review | \`/codex review\` | Independent 2nd opinion | 0 | — | — |

**VERDICT:** NO REVIEWS YET — run \`/opsx:review-cycle\` for the full review loop, or the individual reviews above.
\`\`\`

**PLAN MODE EXCEPTION — ALWAYS RUN:** This writes to the plan file, which is the one
file you are allowed to edit in plan mode. The plan file review report is part of the
plan's living status.

# Navigator

You don't remember every skill, so ask. This is the map: the OPSX **main flow** that most work travels, two **on-ramps** that merge onto it, a **vocabulary layer** that runs underneath, and **standalone** specialists off to the side. Each entry says *when to reach for it*.

## The main flow: idea → ship

The route most work travels. **`/opsx:auto`** drives this whole flow autonomously — classify the task, pick the pipeline, run the stages with gates. Reach for the individual commands below when you want to run one stage by hand.

1. **`/opsx:explore`** — think a rough idea through before committing to it. (Not sure it's worth building at all? Start at `/opsx:office-hours` — see On-ramps.)
2. **`/opsx:propose`** — turn the sharpened idea into a change: proposal, design, specs, and tasks.
3. **`/opsx:apply`** — implement the tasks against the change.
4. **`/opsx:review-cycle`** — iterate review → triage → fix → re-review the delta until it's clean or escalates. Lighter gate: **`/opsx:verify`** checks the implementation matches the artifacts. Heavier: **`/opsx:verify-enhanced`** adds code-review, security, and browser passes, auto-scaled to the change size.
5. **`/opsx:ship`** — test, push, open the PR from the proposal.
6. **`/opsx:archive`** — fold the delta specs into the main specs once the change has merged.
7. **`/opsx:retro`** — look back at what shipped and what to learn from it.

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Something's broken** → **`/investigate`**. Systematic root-cause debugging. It **refuses to hypothesise until it has a red-capable feedback loop** — one command that already goes red on *this* bug — then fixes with a regression test. Reach for it on the hard ones: the bug that resists a first glance, the intermittent flake, the regression that crept in between two known-good states.
- **Is this worth building** → **`/opsx:office-hours`**. YC-style demand validation before you write code. Reach for it when the idea's *value*, not its design, is the open question.

## Vocabulary underneath

One reference that runs *beneath* the other skills — the single source of truth for its vocabulary. Reach for it directly when the **words**, not the process, are the problem; the skills above also pull it in.

- **`/codebase-design`** — the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality) for designing a module's *shape*: a lot of behaviour behind a small interface at a clean seam.

## Standalone

Off the main flow — reach for each by name when its situation comes up.

- **`/tdd`** — build one concrete behaviour test-first, red → green, when you want a test worth keeping but not a full spec.
- **`/prototype`** — throwaway code that answers one design question (does this state model feel right, what should this UI look like). Keep the answer, delete the code.
- **`/review`** — a **two-axis** review of a diff: **Standards** (repo conventions + a code-smell baseline) and **Spec** (faithful to the originating proposal/tasks), reported side by side. Reach for it to review a branch or PR against a fixed point.
- **`/qa`** — open a real browser, find bugs, fix them, re-verify.
- **`/qa-only`** — the same browser sweep as `/qa`, but report-only — no code changes.
- **`/design-review`** — design audit of the rendered UI with a fix loop and atomic commits.
- **`/design-consultation`** — build a complete design system from scratch.
- **`/benchmark`** — measure performance against a baseline.
- **`/cso`** — security review from a chief-security-officer lens.
- **`/codex`** — hand a task to Codex for an independent second opinion or a parallel implementation.
- **`/browse`** — headless browser (real Chromium, real clicks) for scripted page interaction.

**Security family** — guarding edits during risky work.

- **`/careful`** — warn before destructive commands (rm -rf, DROP TABLE, force-push).
- **`/freeze`** — hard-lock edits to one directory.
- **`/guard`** — activate `careful` + `freeze` together.
- **`/unfreeze`** — remove the directory lock.
