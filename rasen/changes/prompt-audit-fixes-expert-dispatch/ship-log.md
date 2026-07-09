# Ship Log: prompt-audit-fixes-expert-dispatch

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** d380725c9acf829d2e5b244d283046ed5faa47d6
**Tree:** 0d966468767102f783903eb838d631c57c7de43c
**Status:** Committed (delivery deferred — portfolio delivers once at the end)

## What Shipped

Expert-dispatch contract fix (child #1 of the `prompt-audit-fixes` portfolio): closes the gap where expert skills (review/cso/qa/qa-only/benchmark/design-review) had no distinct behavior when invoked by the LEAD as a dispatched, report-only single-unit-of-work vs. standalone interactive use — dispatched runs could still trigger fix loops, `AskUserQuestion`, `git commit`, or subagent spawns that belong only to standalone mode.

1. **Canonical severity vocabulary + per-expert mapping table** (`_shared.ts` PREAMBLE) — Blocker/Major/Minor/Trivial with one-line criteria, plus a mapping table translating each expert's native scale (review CRITICAL/INFORMATIONAL, cso CRITICAL/HIGH/MEDIUM, qa/qa-only critical/high/medium/low/cosmetic, benchmark REGRESSION/WARNING/OK+Grade, design-review impact+Grade, codex P1/P2) into the canonical vocabulary, with "finding content overrides the native label" as the tiebreak rule.
2. **Dispatched vs standalone mode contract** (`_shared.ts` PREAMBLE) — trigger signature (single-unit-of-work + no-subagents + LEAD-owns-orchestration, or an explicit `MODE: dispatched (report-only)` token); dispatched mode forbids AUTO-FIX, `AskUserQuestion`, `git commit`, and subagent dispatch; a global override clause states these prohibitions override any contrary standalone instruction later in the skill.
3. **Denied-edit honesty clause** — a freeze/guard-denied edit is reported as `[BLOCKED: freeze/guard]`, never `[AUTO-FIXED]`.
4. **Mode-gated mutating steps across all six experts:** review's Fix-First AUTO-FIX (5b), batched + Greptile-triage `AskUserQuestion`, and two-axis parallel `Agent` workers; `ADVERSARIAL_STEP`'s subagent dispatch; `TEST_COVERAGE_AUDIT_REVIEW`'s generate/run/commit step; qa's and design-review's clean-tree STOP gate, fix loop, and per-fix `git commit`; cso's Phase 7 Remediation Roadmap `AskUserQuestion` — all scoped to standalone; dispatched mode reports findings only, routing fixes/decisions to the LEAD.
5. **Report-path reconciliation:** dispatched mode writes canonical `<skill>-report.md` files in the change directory (review-report.md, cso-report.md, qa-report.md, benchmark-report.md, design-review-report.md) with canonical severities; standalone mode keeps its native paths (`.rasen/security-reports/`, `.rasen/qa-reports/`, `~/.rasen/projects/`, etc.) unchanged.
6. **cso RV-8 probe/exclusion alignment:** narrowed hard-exclusion #1 to generic DoS/resource-exhaustion with an explicit exception for auth/security-endpoint brute-force (kept the A04 auth rate-limit probe); dropped the A09 audit-logging probes and annotated the generic-DoS STRIDE probe as context-only, resolving a prior self-contradiction between the probe list and the exclusion list.
7. **Orchestration Step B report-contract fix** (`workflows/_orchestration.ts`) — dropped the inaccurate "…and save NOTHING; the worker is responsible for ALSO writing…" sentence; states dispatched experts write the canonical report themselves and the worker verifies presence before returning (no double-write, no orphaned consumer).

Installed skills regenerated (`node build.js` — `pnpm build` is currently broken by the concurrent session's in-flight `pnpm-workspace.yaml`, confirmed identical output via direct `node build.js`). Parity hashes resynced for the 14 PREAMBLE-embedding templates.

## Review Outcome

Review-cycle round 1, verdict **CLEAN** (non-author confirmed). 0 Blocker, 0 Major.

- **1 Minor — fixed round 1:** the `TEST_COVERAGE_AUDIT_REVIEW` "REGRESSION IRON RULE" ("a regression test is written immediately... no skipping") sat ~60 lines before its Step 5 dispatched gate and wasn't itself scoped by mode — inconsistent with the change's own "every absolute needs a scope clause" philosophy. Fixed by adding an inline dispatched clause directly to the REGRESSION RULE block.
- **1 Trivial — fixed round 1:** review's "Important Rules" Fix-first bullet ("AUTO-FIX items are applied directly") was un-scoped; tagged `(standalone)`.
- **2 accepted-known (Informational/Trivial, no action needed):**
  - Cross-session hash bundling: the parity test's 11 `getOpsx*CommandTemplate` function-payload hashes were adopted by the concurrent openspec→rasen rebrand session directly in the shared working tree (this change's own tasks.md originally left them un-adopted; by review time they'd already moved). Verified by import-graph audit: command templates don't consume PREAMBLE/`_orchestration`, so these 11 hash lines are not this change's substantive work — they are the rebrand session's, interleaved in the same file. **LEAD ruling (both prior ships in this session): accept the bundle** — this change's pathspec commit for `skill-templates-parity.test.ts` necessarily carries these 11 rebrand lines alongside its own 25 (14 PREAMBLE-embedding templates × function+content, minus overlaps). The rebrand session's own ship supplies the matching template-content commit; this file's hash values are self-consistent either way since they're computed from actual template output, not asserted independently.
  - chrome-use parity blind spot (pre-existing, unrelated): `chrome-use.ts` embeds the PREAMBLE but isn't in the parity table, so its regenerated output is unverified by the suite. Not introduced by this change; relayed to a later portfolio child.
- **careful/freeze/guard/unfreeze hashes confirmed unmoved** (they don't embed the PREAMBLE) — same discipline as the prior office-hours-dialogue-override ship.

## Deliberate Bundling — LEAD Rulings (both accepted)

1. **Whole-file branding overlap:** the 8 source files (`_shared.ts`, `review.ts`, `cso.ts`, `qa.ts`, `qa-only.ts`, `benchmark.ts`, `design-review.ts`, `_orchestration.ts`) sit in a working tree mid openspec→rasen rebrand (concurrent session). Where this change's own edits land in the same file as in-flight branding strings (`/opsx:`→`/rasen:`, `.openspec/`→`.rasen/`, etc.), the pathspec commit captures the file at whole-file granularity — it cannot cherry-pick hunks. Accepted: the migration itself is owned and delivered separately by the rebrand session.
2. **Cross-session parity-hash lines:** `test/core/templates/skill-templates-parity.test.ts` additionally carries 11 `getOpsx*CommandTemplate` hash-constant lines that were adopted by the concurrent rebrand session directly in the shared tree (not by this change's implementer — tasks.md 8.4 explicitly left them un-adopted; they moved between then and review). We consciously co-commit them rather than attempt a hunk-level split, since the file must be internally consistent (all hash constants recomputed against the live tree) for the suite to pass. The rebrand session's own ship supplies the matching template source content these hashes describe.

## Test Gate

- Tests: ran green — `npx vitest run test/core/templates/` → 6/6 passed, re-run at ship time.
- Build note: `pnpm build` is currently broken by the concurrent session's in-flight `pnpm-workspace.yaml`; used `node build.js` directly (confirmed identical output) to regenerate installed skills.

## Pre-Flight Results

- Verification: pass (review-report.md + auto-run.json, verdict CLEAN)
- Tasks: 28/28 complete (tasks.md, all groups 1-8 checked)

## Delivery

Local mode: committed only, no push, no PR. This is child #1 of the `prompt-audit-fixes` portfolio; delivery happens once at the portfolio/parent level after all children complete, per the user's decision.
