import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';
import { PREAMBLE_DIALOGUE, PROBE_PLACEMENT_GUIDANCE } from './_shared.js';

const BODY = `
${PREAMBLE_DIALOGUE}

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
   8. **Bisection harness** — if the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" for \`git bisect run\`.
   9. **Differential loop** — run the same input through old vs new (or two configs) and diff outputs.
   10. **HITL bash script** (last resort) — if a human must click, drive _them_ with \`scripts/hitl-loop.template.sh\` so the loop stays structured; captured output feeds back to you.

3. **Tighten the loop.** Treat it as a product: make it **faster** (cache setup, skip unrelated init, narrow test scope), the signal **sharper** (assert the specific symptom, not "didn't crash"), and **more deterministic** (pin time, seed RNG, isolate filesystem, freeze network). A 2-second deterministic loop is a debugging superpower; a 30-second flaky one is barely better than none.

4. **Non-deterministic bugs:** the goal is a **higher reproduction rate**, not a clean repro. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it is.

5. **If you genuinely cannot build a loop:** stop and say so explicitly. List what you tried and ask the user for (a) access to an environment that reproduces it, (b) a captured artifact (HAR file, log dump, core dump, timestamped recording), or (c) permission to add temporary instrumentation. Do **not** proceed to hypotheses without a loop.

**Completion criterion — the hard gate.** You can name **one command** — a test invocation, a curl, a script path — that you have **already run at least once** (paste the invocation and its output), and that is:

- [ ] **Red-capable** — drives the actual bug code path and asserts the **user's exact symptom**, so it goes red on this bug and green once fixed. Not "runs without erroring" — it must catch *this* bug.
- [ ] **Deterministic** — same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — you can run it unattended; a human in the loop only via \`scripts/hitl-loop.template.sh\`.

**No red-capable command → no Phase 4 hypotheses.**

---

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red — the bug appears. Confirm:

- [ ] The failure is the one the **user** described — not a different failure nearby. Wrong bug = wrong fix.
- [ ] It reproduces across multiple runs (or, for non-deterministic bugs, at a high enough rate to debug against).

**Minimise:** once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut — keep only what's load-bearing for the failure. Done when removing any remaining element makes the loop go green. A minimal repro shrinks the hypothesis space in Phase 4 (fewer moving parts to suspect) and becomes the clean regression test in Phase 6.

Do not proceed until you have reproduced **and** minimised.

---

## Affected-area declaration

With a minimised repro in hand, record the narrowest affected area supported
by the evidence before making a fix. Name concrete directories or files (for
example \`src/auth/\` plus its focused tests) as the initial allowlist and
state why each belongs.

If root-cause evidence later proves that a necessary edit crosses that area,
record the evidence and revised allowlist **before** editing the additional
area. Do not silently widen scope because a nearby cleanup looks convenient.

This declaration is review evidence, not mechanical write enforcement. Before
completion, inspect the actual changed-file set and diff (for example with
\`git status --short\`, \`git diff --name-only\`, and \`git diff\`) against the
latest allowlist. Classify every unexpected file as either:

- a justified scope expansion whose evidence was recorded before the edit; or
- unresolved out-of-scope work that must be reverted or explicitly justified
  and verified before the investigation is complete.

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
- \`git log --oneline -20 -- <affected-files>\` — **was this working before?** A regression means the root cause is in the diff.
- \`TODOS.md\` for related known issues
- \`git log\` for prior fixes in the same area — **recurring bugs in the same files are an architectural smell**, not a coincidence

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
   \`\`\`
   3 hypotheses tested, none match. This may be an architectural issue
   rather than a simple bug.

   A) Continue investigating — I have a new hypothesis: [describe]
   B) Escalate for human review — this needs someone who knows the system
   C) Add logging and wait — instrument the area and catch it next time
   \`\`\`

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

**Tag every debug log** with a unique prefix, e.g. \`[DEBUG-a4f2]\`, so cleanup is a single grep — untagged logs survive, tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead establish a baseline measurement (timing harness, \`performance.now()\`, profiler, query plan), then bisect. Measure first, fix second.

${PROBE_PLACEMENT_GUIDANCE}

---

## Phase 6: Fix + regression test

Once root cause is confirmed:

1. **Write the regression test _before_ the fix — but only if a correct seam exists.** A correct seam exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (a single-caller test when the bug needs multiple callers, a unit test that can't replicate the triggering chain), a test there gives false confidence. **If no correct seam exists, that itself is the finding** — note it; the architecture is preventing the bug from being locked down, and Phase 7 flags it. If a correct seam exists, turn the minimised repro into a failing test at that seam and watch it fail.

2. **Fix the root cause, not the symptom.** The smallest change that eliminates the actual problem.

3. **Minimal diff:** fewest files touched, fewest lines changed. Resist the urge to refactor adjacent code.

4. **Watch the regression test pass**, then re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

5. **Risk-proportional verification.** Select the smallest verification scope
   that can credibly detect regressions from this fix, and record the scope,
   rationale, exact command(s), result, and current content tree fingerprint.
   - **Always required:** the Phase 1 feedback loop, the regression test (when a
     correct seam exists), and directly affected module or package tests.
   - **Localized fix:** when the change is confined to one behavior and has no
     cross-cutting risk trigger, stop after the regression and affected-area
     checks pass. A localized fix does not require the full repository suite
     merely because this workflow is finishing.
   - **Broaden when evidence demands it:** shared or global contracts,
     dependency/build/config/CI changes, concurrency, persistence, migrations,
     security boundaries, cross-platform behavior, broad multi-module edits,
     or a focused failure outside the expected area.
   - **Full-suite trigger:** run the full repository suite only when the user or
     project instructions explicitly require it, or when the risk assessment
     shows that affected behavior cannot be bounded more narrowly. File count
     alone is a signal to inspect, not proof that the full suite is necessary.
   - **Cost guard:** before starting a full suite expected to exceed 60 seconds,
     state the trigger and expected cost. Never repeat an unchanged full-suite
     command that already timed out; shard it, narrow it, use CI, or ask for
     direction.

6. **If the fix touches >5 files:** Use AskUserQuestion to flag the blast radius:
   \`\`\`
   This fix touches N files. That's a large blast radius for a bug fix.
   A) Proceed — the root cause genuinely spans these files
   B) Split — fix the critical path now, defer the rest
   C) Rethink — maybe there's a more targeted approach
   \`\`\`

---

## Phase 7: Verification & Report

**Fresh verification:** Reproduce the original bug scenario by re-running the
Phase 1 loop and confirm it's fixed. This is not optional. Re-run the selected
risk-proportional verification scope and paste the output.

Before declaring done:
- [ ] Original repro no longer reproduces (Phase 1 loop is green)
- [ ] Regression test passes (or the absence of a correct seam is documented)
- [ ] All \`[DEBUG-...]\` instrumentation removed (\`grep\` the prefix)
- [ ] Throwaway harnesses deleted or moved to a clearly-marked debug location
- [ ] Actual changed files and diff match the latest declared affected area;
      every expansion has recorded evidence, and no unexplained file remains

Output a structured debug report:
\`\`\`
DEBUG REPORT
════════════════════════════════════════
Symptom:         [what the user observed]
Root cause:      [what was actually wrong]
Fix:             [what was changed, with file:line references]
Evidence:        [test output, reproduction attempt showing fix works]
Regression test: [file:line of the new test, or documented absence of a correct seam]
Scope audit:      [declared area, actual changed files, justified expansions, unresolved files]
Related:         [TODOS.md items, prior bugs in same area, architectural notes]
Status:          DONE | DONE_WITH_CONCERNS | BLOCKED
════════════════════════════════════════
\`\`\`

**Post-mortem — what would have prevented this bug?** State the hypothesis that turned out correct in the commit / PR message so the next debugger learns. If the answer involves architectural change (no good test seam, tangled callers, hidden coupling), **flag the architectural finding** with the specifics — make that recommendation *after* the fix is in, when you know more than you did at the start.

---

## Important Rules

- **3+ failed fix attempts → STOP and question the architecture.** Wrong architecture, not failed hypothesis.
- **No red-capable feedback loop → no hypotheses.** Building the loop (Phase 1) precedes every theory.
- **Never apply a fix you cannot verify.** If you can't reproduce and confirm, don't ship it.
- **Never say "this should fix it."** Verify and prove it. Run the tests.
- **If fix touches >5 files → AskUserQuestion** about blast radius before proceeding.
- **Completion status:**
  - DONE — root cause found, fix applied, regression test written (or seam absence documented), and all checks required by the recorded verification scope pass
  - DONE_WITH_CONCERNS — fixed but cannot fully verify (e.g., intermittent bug, requires staging)
  - BLOCKED — root cause unclear after investigation, escalated
`;

export function getInvestigateSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-investigate',
    description: 'Systematic debugging — reproduce, isolate, and root-cause a bug with evidence before attempting any fix',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
