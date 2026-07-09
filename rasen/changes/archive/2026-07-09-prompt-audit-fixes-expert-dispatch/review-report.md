# Review Report — prompt-audit-fixes-expert-dispatch

Reviewer: reviewer2 (dispatched, report-only). Independent review; did not author.
Date: 2026-07-09. Branch: main.
Scope reviewed: `git diff` of the 9 files the LEAD verified — `experts/_shared.ts`, `review.ts`, `cso.ts`, `qa.ts`, `qa-only.ts`, `benchmark.ts`, `design-review.ts`, `workflows/_orchestration.ts` (one Step B sentence), `test/core/templates/skill-templates-parity.test.ts`. Bundled openspec→rasen branding churn ignored per LEAD ruling; substantive changes only.

## Verdict

**CLEAN / ship-able (after fix round 1).** 0 Blocker, 0 Major, 0 Minor open, 0 Trivial open, 1 Trivial accepted-known (pre-existing), 1 Informational.
The contract is faithfully and consistently implemented; all in-scope audit findings are addressed; tests are fully green. The one Minor and the one review-side Trivial I filed were fixed in round 1 and re-verified; the chrome-use Trivial is accepted-known (pre-existing, relayed to a later child).

## Fix round 1 — delta re-review (reviewer2, re-verified)

- **[Minor] REGRESSION IRON RULE unscoped → RESOLVED.** `_shared.ts` `TEST_COVERAGE_AUDIT_REVIEW` (generated `rasen-review/SKILL.md:1231-1235`): the IRON RULE is retitled "**(standalone mode)**" and immediately followed by an enumerate-and-gate paragraph — "Dispatched mode overrides this IRON RULE … record the detected regression and its missing regression test as a finding (Major, or Blocker if it names data-loss / security / silent corruption) … do NOT write or commit the test yourself." This is the repo's enumerate-and-gate idiom applied correctly. No new contradiction: the severity instruction is consistent with the canonical vocabulary (a proven regression = "significant regression" = Major, escalating to Blocker on data-loss/sec/corruption via content-overrides-label), and it correctly differentiates from the Step 5 "plain coverage gap = Minor" note rather than conflicting with it — the double-gating (REGRESSION block + Step 5 + PREAMBLE override) is layered, not contradictory.
- **[Trivial] review "Fix-first" Important-Rules bullet unscoped → RESOLVED.** `review.ts:261`: now "Fix-first, not read-only **(standalone mode)**. … In dispatched mode this is suppressed — report findings only (see Step 5). Never commit, push, or create PRs — that's /rasen:ship's job." Scoped cleanly; the "Never commit" guarantee preserved.
- **[Trivial] chrome-use parity blind spot → ACCEPTED-KNOWN.** Pre-existing gap, not introduced by this change; LEAD recorded accepted-known and relayed to a later child. No action here.
- **Parity re-verified:** structurally only `getReviewSkillTemplate` (function) + `rasen-review` (content) hashes can move this round — `TEST_COVERAGE_AUDIT_REVIEW` is imported *only* by `review.ts` (confirmed by grep) and neither edit touches the PREAMBLE that the other 13 templates embed. `npx vitest run test/core/templates/` → 6/6 pass. careful/freeze/guard/unfreeze remain unmoved.

_The findings below are the round-0 record, retained for traceability; the two actionable ones are resolved as noted above._

## Contract fidelity (dimension 1) — PASS

All in-scope findings (RV-1, RV-2, RV-3, RV-4, RV-5, RV-8, RV-9, SH-3) are implemented per design + specs. RV-6/RV-7 correctly untouched (child #2 scope; verified `_shared.ts:571`/`:907` "Never read source" rules not modified).

- **RV-1/RV-2 (canonical vocabulary + mapping):** PREAMBLE gains a "Canonical severity vocabulary" section (Blocker/Major/Minor/Trivial with criteria) and a per-expert mapping table covering all six native scales. "Finding content overrides the native label" rule present with the canonical RV-1 example. Each expert self-tags in dispatched mode.
- **RV-3 (report-file contract):** `_orchestration.ts` Step B sentence rewritten — the false "save NOTHING" claim dropped; dispatched experts write the canonical `<skill>-report.md` themselves; worker verifies presence (no double-write). Consumers (resume cross-check, ship pre-flight, retro) still read the same canonical paths — no orphaned consumer.
- **RV-4/RV-5/SH-3 (mode gating):** qa/design-review clean-tree, fix loop, per-fix commit gated to standalone; review Fix-First (5b), batched + Greptile `AskUserQuestion`, and two-axis parallel `Agent` workers gated to standalone; `ADVERSARIAL_STEP` subagent dispatch and `TEST_COVERAGE` generate+commit gated off dispatched.
- **RV-8 (cso probe/exclusion alignment):** A09 audit-logging probes dropped from Phase 2; STRIDE DoS annotated context-only; hard-exclusion #1 narrowed to generic DoS with an explicit auth/security-endpoint brute-force EXCEPTION; A04 auth rate-limit probe kept.
- **RV-9 (denied-edit honesty):** PREAMBLE clause added — freeze/guard-denied edit reported as `[BLOCKED: freeze/guard]`, never `[AUTO-FIXED]`.

**KEEP/ADAPT/CUT table (design D3, 13 rows):** faithfully realized. The adaptation is modal exactly as designed — every edit is additive ("**Dispatched mode:** … **Standalone mode.** <original text>"), so standalone power is preserved and dispatched sheds fix/ask/commit/subagent. No behavior was deleted from standalone. Per-expert inline severity mappings (cso Phase 8, qa/qa-only, benchmark Phase 9, design-review Phase 8/10) are each consistent with the central PREAMBLE table.

## Instruction-prose integrity (dimension 2, CORE RISK) — one Minor

Checked the new text against the six conflict taxonomies:

- **Precedence stated over each overridden standalone rule:** YES. The PREAMBLE dispatched section carries a global override clause ("These dispatched-mode prohibitions **override** any contrary standalone instruction later in this skill (fix loops, batched questions, clean-tree gates, adversarial subagent dispatch, native report paths)"), reinforced by targeted step-level dispatched notes. clean-tree gates: double-covered (override list + inline notes in qa/design-review). Fix-First: Step 5 dispatched note + override. ADVERSARIAL "always runs": the dispatched note at the top of `ADVERSARIAL_STEP` explicitly enumerates "the large-tier pass 2" (= the "This always runs regardless of Codex availability" step) — correct enumerate-and-gate. self-save phases: inline per-expert + override "native report paths".
- **Self-trigger decidable:** YES. Conjunction of three signals (single-unit-of-work + no-subagents + LEAD-owns-orchestration) plus an explicit `MODE: dispatched (report-only)` token fallback. Reasonable and matches the Step B dispatch signature.
- **New absolutes without scope:** NONE introduced. All new imperatives are scoped under "In dispatched mode you MUST" or the denied-edit scenario.
- **Severity mapping coverage:** COMPLETE. Table covers all six scales the audit named — review CRITICAL/INFORMATIONAL, cso CRITICAL/HIGH/MEDIUM, qa/qa-only critical/high/medium/low/cosmetic, benchmark REGRESSION/WARNING/OK+Grade, design-review impact high/medium/polish+Grade, codex P1/P2. Letter grades folded correctly (summary-level → Trivial; per-finding severity carried by the primary scale).
- **"Content overrides label" ambiguity:** clear, with the RV-1 worked example (INFORMATIONAL data-corruption → Major).

### [Minor] TEST_COVERAGE "REGRESSION RULE (mandatory)" not mode-gated
`_shared.ts` `TEST_COVERAGE_AUDIT_REVIEW` (generated `rasen-review/SKILL.md:410-412`): the REGRESSION "IRON RULE" — *"a regression test is written immediately. No AskUserQuestion. No skipping. Regressions are the highest-priority test"* — sits ~60 lines before the Step 5 dispatched gate (`:473`) and is not itself scoped by mode. Writing a regression test is a code edit, which dispatched mode forbids; a dispatched reviewer anchored on this forcefully-worded local absolute could write/commit a test before reaching the Step 5 gate — the exact "memorable absolute beats a distant scope clause" family this change exists to eliminate. It is genuinely mitigated (PREAMBLE "no code edits" + global override + Step 5 note), but it is (a) inconsistent with the change's own stated philosophy ("any NEVER/ALWAYS/MANDATORY must carry a scope clause"), and (b) inconsistent with how the sibling absolute ("always runs") *was* enumerated and gated in `ADVERSARIAL_STEP`.
Suggested fix: add one clause to the REGRESSION RULE subsection — e.g. *"Dispatched mode: a detected regression becomes a Major/Blocker finding in the report; do not write the test — the LEAD routes it to a non-author fixer."* (Source-side: `src/core/templates/experts/_shared.ts`, in the `TEST_COVERAGE_AUDIT_REVIEW` REGRESSION RULE block; then rebuild + regenerate + re-paste the 14 PREAMBLE-embedding hashes.)

### [Trivial] review "Important Rules" Fix-first bullet un-scoped
Generated `rasen-review/SKILL.md` "## Important Rules": *"Fix-first, not read-only. AUTO-FIX items are applied directly."* remains un-scoped. Covered by the override enumeration ("fix loops") and the Step 5 dispatched note, so lower risk than the REGRESSION RULE, but a "(standalone)" tag would remove the last un-scoped Fix-First absolute. (`src/core/templates/experts/review.ts`, Important Rules bullet.)

## Seam check (dimension 3) — PASS

- **Step B ↔ expert self-save:** reconciled. Step B now says experts write the canonical report *themselves* and the worker *verifies presence* — the experts' inline dispatched clauses say "write ONLY `<skill>-report.md` … Then return." No double-write, no orphan consumer.
- **review-cycle / Step E:** Step E.1 collects findings as Blocker/Major/Minor/Trivial; review.ts dispatched mode now emits exactly that into `review-report.md`. Producer vocabulary matches the consumer scale (unchanged, as expected). No seam break.
- **qa-only:** never fixes; only report-path + severity changed (writes `qa-report.md` dispatched). Consistent with qa (both map to `qa-report.md`; they are never both dispatched for one change).

## Tests (dimension 4) — PASS (6/6, cleaner than the expected 5/6)

`npx vitest run test/core/templates/` → **6/6 pass** (1 file, 6 tests). The 11 `getOpsx*CommandTemplate` function-payload hashes the LEAD expected to still be *failing* have been **adopted** into the test file, so the suite is now fully green rather than 5/6.

Moved-hash audit (verified exactly, nothing else moved):
- **14 PREAMBLE-embedding templates** moved (function + content), all explained by the PREAMBLE change: benchmark, codebase-design, codex, cso, design-consultation, design-review, investigate, navigator, office-hours, prototype, qa, qa-only, review, tdd. Each of the 8 not-directly-edited ones was confirmed to `import { PREAMBLE }`.
- **11 `getOpsx*CommandTemplate`** function hashes moved (explore/new/continue/apply/ff/sync/archive/onboard/bulk-archive/verify/propose) — concurrent openspec→rasen rebrand churn, not this change's substantive work.
- **careful / freeze / guard / unfreeze hashes UNMOVED** (function + content) — confirmed; none embed the PREAMBLE.
- No other/unexpected entry moved. No REAL finding masked by the hash updates.

## Regeneration integrity (dimension 5) — PASS

`rasen-review/SKILL.md` and `rasen-cso/SKILL.md` both carry the "Canonical severity vocabulary" + mapping table, the "Dispatched vs standalone mode" section, denied-edit honesty, and per-phase dispatched clauses (cso Phase 7 skip-AskUserQuestion, Phase 8 write-only-cso-report.md with C/H/M→Blocker/Major/Minor). `node dist/cli/index.js validate` → change is valid.

## Informational / notes

- **[Informational] Cross-session hash bundling in the test file.** The parity test now includes 11 `getOpsx*CommandTemplate` rebrand hash updates that belong to the concurrent session, not this change — a deviation from tasks.md task 8.4 (which said they were left un-adopted). Benign and consistent with the LEAD's accepted whole-file rebrand-bundling precedent, but the ship pathspec for `skill-templates-parity.test.ts` will necessarily carry these 11 cross-session lines interleaved with this change's 25 — worth a `git show --stat`/hunk-level confirmation at ship so the LEAD consciously owns the bundling.
- **[Trivial] chrome-use parity blind spot (pre-existing).** `chrome-use.ts` embeds the (now-changed) PREAMBLE but is not in the parity table, so its regenerated output is unverified by the suite. Pre-existing gap, not introduced here; the audit lists chrome-use as self-consistent/out-of-scope. No action required for this change.

## Meta-note — did the dispatched contract govern MY run unambiguously?

**Yes.** The PREAMBLE I received on loading `rasen-review` contained the full "Dispatched vs standalone mode" section; my LEAD dispatch carried the exact trigger signature (single unit of work / no subagents / LEAD owns orchestration) plus an explicit "run report-only" instruction. The skill's dispatched clauses (Step 5 skip 5b/5c/5d, ADVERSARIAL skip subagent, write only `review-report.md`) left my obligations unambiguous, and I followed them: no source edits, no AskUserQuestion, no git commit, no subagents, and I wrote only this canonical report. The contract passed its first live test for a code-review dispatch. The one friction I noticed is the same [Minor] I filed: the REGRESSION IRON RULE is the one place a dispatched worker's "do not edit / do not write tests" obligation could read as ambiguous against a local mandatory absolute — for pure code review it did not bite me, but it is the residual crack in an otherwise clean contract.
