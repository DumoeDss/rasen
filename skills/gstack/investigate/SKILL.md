---
name: investigate
version: 1.0.0
description: |
  Systematic debugging with root cause investigation. Four phases: investigate,
  analyze, hypothesize, implement. Iron Law: no fixes without root cause.
  Use when asked to "debug this", "fix this bug", "why is this broken",
  "investigate this error", or "root cause analysis".
  Proactively suggest when the user reports errors, unexpected behavior, or
  is troubleshooting why something stopped working.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - WebSearch
hooks:
  PreToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/../freeze/bin/check-freeze.sh"
          statusMessage: "Checking debug scope boundary..."
    - matcher: "Write"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/../freeze/bin/check-freeze.sh"
          statusMessage: "Checking debug scope boundary..."
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

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

# Systematic Debugging

<!-- The feedback-loop-first phase, minimise step, ranked-falsifiable hypotheses, the "no correct seam is itself the finding" rule, and the HITL sidecar are adapted from mattpocock/skills (MIT, Copyright Matt Pocock). -->

## Iron Law

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

Fixing symptoms creates whack-a-mole debugging. Every fix that doesn't address root cause makes the next bug harder to find. Find the root cause, then fix it.

---

## Phase 1: Build a red-capable feedback loop

**This is the skill.** Everything downstream — bisection, hypothesis testing, instrumentation — just consumes a pass/fail signal that goes **red** on _this_ bug. Build that signal first. If you catch yourself reading code to form a theory before the signal exists, **stop** — jumping straight to a hypothesis is the exact failure this phase prevents.

1. **Capture the exact symptom.** Read the error messages, stack traces, and reproduction steps, and pin down the *user's* exact symptom — the specific error, wrong output, or slow timing — because that is what your loop must assert on. If context is missing, ask ONE question at a time via AskUserQuestion.

2. **Construct the loop.** Reach for a signal in roughly this order — earlier options are tighter:
   1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.
   2. **Curl / HTTP script** against a running dev server.
   3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
   4. **Headless browser script** (Playwright / Puppeteer) driving the UI, asserting on DOM/console/network.
   5. **Replay a captured trace** — save a real request / payload / event log to disk, replay it through the code path in isolation.
   6. **Throwaway harness** — a minimal subset of the system (one service, mocked deps) that hits the bug path in a single call.
   7. **Property / fuzz loop** — for "sometimes wrong output", run 1000 random inputs and look for the failure mode.
   8. **Bisection harness** — if the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" for `git bisect run`.
   9. **Differential loop** — run the same input through old vs new (or two configs) and diff outputs.
   10. **HITL bash script** (last resort) — if a human must click, drive _them_ with `scripts/hitl-loop.template.sh` so the loop stays structured; captured output feeds back to you.

3. **Tighten the loop.** Treat it as a product: make it **faster** (cache setup, skip unrelated init, narrow test scope), the signal **sharper** (assert the specific symptom, not "didn't crash"), and **more deterministic** (pin time, seed RNG, isolate filesystem, freeze network). A 2-second deterministic loop is a debugging superpower; a 30-second flaky one is barely better than none.

4. **Non-deterministic bugs:** the goal is a **higher reproduction rate**, not a clean repro. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it is.

5. **If you genuinely cannot build a loop:** stop and say so explicitly. List what you tried and ask the user for (a) access to an environment that reproduces it, (b) a captured artifact (HAR file, log dump, core dump, timestamped recording), or (c) permission to add temporary instrumentation. Do **not** proceed to hypotheses without a loop.

**Completion criterion — the hard gate.** You can name **one command** — a test invocation, a curl, a script path — that you have **already run at least once** (paste the invocation and its output), and that is:

- [ ] **Red-capable** — drives the actual bug code path and asserts the **user's exact symptom**, so it goes red on this bug and green once fixed. Not "runs without erroring" — it must catch *this* bug.
- [ ] **Deterministic** — same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — you can run it unattended; a human in the loop only via `scripts/hitl-loop.template.sh`.

**No red-capable command → no Phase 4 hypotheses.**

---

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red — the bug appears. Confirm:

- [ ] The failure is the one the **user** described — not a different failure nearby. Wrong bug = wrong fix.
- [ ] It reproduces across multiple runs (or, for non-deterministic bugs, at a high enough rate to debug against).

**Minimise:** once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut — keep only what's load-bearing for the failure. Done when removing any remaining element makes the loop go green. A minimal repro shrinks the hypothesis space in Phase 4 (fewer moving parts to suspect) and becomes the clean regression test in Phase 6.

Do not proceed until you have reproduced **and** minimised.

---

## Scope Lock

With a minimised repro in hand you know the affected module — lock edits to it to prevent scope creep.

```bash
[ -x "${CLAUDE_SKILL_DIR}/../freeze/bin/check-freeze.sh" ] && echo "FREEZE_AVAILABLE" || echo "FREEZE_UNAVAILABLE"
```

**If FREEZE_AVAILABLE:** Identify the narrowest directory containing the affected files. Write it to the freeze state file:

```bash
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.gstack}"
mkdir -p "$STATE_DIR"
echo "<detected-directory>/" > "$STATE_DIR/freeze-dir.txt"
echo "Debug scope locked to: <detected-directory>/"
```

Substitute `<detected-directory>` with the actual directory path (e.g., `src/auth/`). Tell the user: "Edits restricted to `<dir>/` for this debug session. This prevents changes to unrelated code. Run `/unfreeze` to remove the restriction."

If the bug spans the entire repo or the scope is genuinely unclear, skip the lock and note why.

**If FREEZE_UNAVAILABLE:** Skip scope lock. Edits are unrestricted.

---

## Phase 3: Pattern Analysis

Check if this bug matches a known pattern:

| Pattern | Signature | Where to look |
|---------|-----------|---------------|
| Race condition | Intermittent, timing-dependent | Concurrent access to shared state |
| Nil/null propagation | NoMethodError, TypeError | Missing guards on optional values |
| State corruption | Inconsistent data, partial updates | Transactions, callbacks, hooks |
| Integration failure | Timeout, unexpected response | External API calls, service boundaries |
| Configuration drift | Works locally, fails in staging/prod | Env vars, feature flags, DB state |
| Stale cache | Shows old data, fixes on cache clear | Redis, CDN, browser cache, Turbo |

Also check:
- `git log --oneline -20 -- <affected-files>` — **was this working before?** A regression means the root cause is in the diff.
- `TODOS.md` for related known issues
- `git log` for prior fixes in the same area — **recurring bugs in the same files are an architectural smell**, not a coincidence

**External pattern search:** If the bug doesn't match a known pattern above, WebSearch for:
- "{framework} {generic error type}" — **sanitize first:** strip hostnames, IPs, file paths, SQL, customer data. Search the error category, not the raw message.
- "{library} {component} known issues"

If WebSearch is unavailable, skip this search and proceed with hypothesis testing. If a documented solution or known dependency bug surfaces, present it as a candidate hypothesis in Phase 4.

---

## Phase 4: Hypothesis Testing

Generate **3–5 ranked hypotheses** before testing any of them — single-hypothesis generation anchors on the first plausible idea. Each must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> makes the bug disappear / <changing Z> makes it worse."

If you cannot state the prediction, the hypothesis is a vibe — discard or sharpen it. **Show the ranked list to the user before testing** — they often re-rank it instantly ("we just deployed a change to #3") or know hypotheses already ruled out. Cheap checkpoint, big time saver. Don't block on it — proceed with your ranking if the user is AFK. Then test the top hypothesis; Phase 5 instruments it.

1. **If the hypothesis is wrong:** Before forming the next, consider searching for the error. **Sanitize first** — strip hostnames, IPs, file paths, SQL fragments, customer identifiers, and any internal/proprietary data from the error message. Search only the generic error type and framework context: "{component} {sanitized error type} {framework version}". If the message is too specific to sanitize safely, or WebSearch is unavailable, skip. Then gather more evidence — do not guess.

2. **3-strike rule:** If 3 hypotheses fail, **STOP**. Use AskUserQuestion:
   ```
   3 hypotheses tested, none match. This may be an architectural issue
   rather than a simple bug.

   A) Continue investigating — I have a new hypothesis: [describe]
   B) Escalate for human review — this needs someone who knows the system
   C) Add logging and wait — instrument the area and catch it next time
   ```

**Red flags** — if you see any of these, slow down:
- "Quick fix for now" — there is no "for now." Fix it right or escalate.
- Proposing a fix before tracing data flow — you're guessing.
- Each fix reveals a new problem elsewhere — wrong layer, not wrong code.

---

## Phase 5: Instrument

Each probe must map to a specific prediction from Phase 4. **Change one variable at a time.**

1. **Debugger / REPL inspection** if the env supports it — one breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`, so cleanup is a single grep — untagged logs survive, tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

---

## Phase 6: Fix + regression test

Once root cause is confirmed:

1. **Write the regression test _before_ the fix — but only if a correct seam exists.** A correct seam exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (a single-caller test when the bug needs multiple callers, a unit test that can't replicate the triggering chain), a test there gives false confidence. **If no correct seam exists, that itself is the finding** — note it; the architecture is preventing the bug from being locked down, and Phase 7 flags it. If a correct seam exists, turn the minimised repro into a failing test at that seam and watch it fail.

2. **Fix the root cause, not the symptom.** The smallest change that eliminates the actual problem.

3. **Minimal diff:** fewest files touched, fewest lines changed. Resist the urge to refactor adjacent code.

4. **Watch the regression test pass**, then re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

5. **Run the full test suite.** Paste the output. No regressions allowed.

6. **If the fix touches >5 files:** Use AskUserQuestion to flag the blast radius:
   ```
   This fix touches N files. That's a large blast radius for a bug fix.
   A) Proceed — the root cause genuinely spans these files
   B) Split — fix the critical path now, defer the rest
   C) Rethink — maybe there's a more targeted approach
   ```

---

## Phase 7: Verification & Report

**Fresh verification:** Reproduce the original bug scenario by re-running the Phase 1 loop and confirm it's fixed. This is not optional. Run the test suite and paste the output.

Before declaring done:
- [ ] Original repro no longer reproduces (Phase 1 loop is green)
- [ ] Regression test passes (or the absence of a correct seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway harnesses deleted or moved to a clearly-marked debug location

Output a structured debug report:
```
DEBUG REPORT
════════════════════════════════════════
Symptom:         [what the user observed]
Root cause:      [what was actually wrong]
Fix:             [what was changed, with file:line references]
Evidence:        [test output, reproduction attempt showing fix works]
Regression test: [file:line of the new test, or documented absence of a correct seam]
Related:         [TODOS.md items, prior bugs in same area, architectural notes]
Status:          DONE | DONE_WITH_CONCERNS | BLOCKED
════════════════════════════════════════
```

**Post-mortem — what would have prevented this bug?** State the hypothesis that turned out correct in the commit / PR message so the next debugger learns. If the answer involves architectural change (no good test seam, tangled callers, hidden coupling), **flag the architectural finding** with the specifics — make that recommendation *after* the fix is in, when you know more than you did at the start.

---

## Important Rules

- **3+ failed fix attempts → STOP and question the architecture.** Wrong architecture, not failed hypothesis.
- **No red-capable feedback loop → no hypotheses.** Building the loop (Phase 1) precedes every theory.
- **Never apply a fix you cannot verify.** If you can't reproduce and confirm, don't ship it.
- **Never say "this should fix it."** Verify and prove it. Run the tests.
- **If fix touches >5 files → AskUserQuestion** about blast radius before proceeding.
- **Completion status:**
  - DONE — root cause found, fix applied, regression test written (or seam absence documented), all tests pass
  - DONE_WITH_CONCERNS — fixed but cannot fully verify (e.g., intermittent bug, requires staging)
  - BLOCKED — root cause unclear after investigation, escalated
