## Context

Child #2 of the `prompt-audit-fixes` portfolio. Scope (planning-context §2): WF-1, WF-7, WF-8 (audit-workflows.md) + SH-1, SH-2, RV-6, RV-7 (audit-shared.md / audit-reviewers.md). All re-verified against the post-rebrand + post-child-1 tree (2026-07-09):

- Rebrand landed (commit 2ebfae9, openspec→rasen copy-only migrate); child #1 landed (d380725, archived a8d38b3).
- WF-1: `ship.ts:36-37` warns "Run /rasen:verify first"; `verify-change.ts` has NO file-writing step (grep: only "Ready for archive" verdict text, no `-report.md` write) — confirmed it emits its report to the conversation only. `verify-enhanced.ts:77-83` DOES write `review-report.md` etc.
- WF-7: `verify-change.ts:131-149` (skill) + `:311-321` (command) = CRITICAL/WARNING/SUGGESTION + "Ready for archive"; `verify-enhanced.ts:102-107` = per-stage PASS/FAIL + "Critical Issues (must fix before shipping)".
- WF-8: `ship.ts:87` skip gate reads a recorded green test run + `git rev-parse HEAD^{tree}` from "review-report.md, review-cycle-report.md, another verification report, or run-state"; `verify-enhanced.ts` records neither test run nor fingerprint. Only `review-cycle.ts:51` records the fingerprint schema.
- SH-1/SH-2/RV-6/RV-7: `_shared.ts:613` (QA rule #5 "Never read source code"), `_shared.ts:949` (DESIGN rule #4 same) — both shifted +42 lines by child #1's PREAMBLE additions. Side B: QA diff-aware `_shared.ts:352` ("identify affected pages/routes from the changed files"), DESIGN diff-aware `_shared.ts:636` ("Map changed files to affected pages/routes"), plus the standalone fix loops (`qa.ts:137`, `design-review.ts:122` "Read the source code" — now standalone-only after child #1's dispatched-mode gating).
- chrome-use debt: `chrome-use.ts:11` embeds PREAMBLE, factory `getChromeUseSkillTemplate`, dirName `rasen-chrome-use`, in the production registry — but absent from `functionFactories` / `GENERATED_SKILL_FACTORIES` in `skill-templates-parity.test.ts`, so PREAMBLE changes ship unverified for it.

Constraint: TS templates only + the parity test file; do NOT touch `_orchestration.ts` (child #3), store-path resolution (child #6), or archive/sync-specs (child #5).

## Goals / Non-Goals

**Goals:**
- Every verification producer leaves a durable, discoverable evidence file; ship's pre-flight has a real consumer (WF-1).
- One canonical verdict vocabulary (reuse child #1's) + a machine-checkable status line both verify variants emit (WF-7).
- The fingerprinted test-evidence schema closes verify → ship, so the skip optimization is reachable through the standard verify path (WF-8).
- "Never read source code" scoped to its real intent (do not read source to form findings during exploration), with carve-outs for diff triage and the standalone fix loop (SH-1/2, RV-6/7).
- chrome-use covered by the parity golden master.

**Non-Goals:**
- The archive-vs-verify gate contract (WF-4: does an incomplete-task CRITICAL hard-block archive?) — child #5. This change unifies verdict *vocabulary* and the *pass rule*, not archive enforcement.
- Store-path resolution in ship/verify (WF-3) — child #6.
- `_orchestration.ts` Step B/C/D/E/H — child #3.
- Re-declaring the severity scale — it is defined in child #1's PREAMBLE (`canonical-severity-vocabulary`); this change references it.

## Decisions

### D1 — Evidence-file convention: verify-change persists `verification-report.md` (WF-1)

verify-change (both the skill getter and the command getter) gains a **Save Report** step that writes `rasen/changes/<name>/verification-report.md` containing the summary scorecard, the canonical verdict + status line (D2), and the grouped findings. This is verify-change's own canonical artifact, parallel to verify-enhanced's per-expert `*-report.md` files.

ship's pre-flight (`ship.ts:36`) evidence list gains `verification-report.md` so `/rasen:verify` (plain) now satisfies the gate. Alternatives considered: (a) point ship's warning at `/rasen:verify-enhanced` only — rejected, it abandons plain verify as a pipeline dead-end and the user still hits the warning after running plain verify; (b) make ship accept absence with a fallback — rejected, silently weakens the gate. Chosen: verify-change writes a file AND ship names it. No orphan consumers: `verification-report.md` is produced by verify-change, consumed by ship pre-flight (existence) and, when it carries fingerprinted evidence, by ship's skip gate.

### D2 — One verdict vocabulary + a machine-checkable status line (WF-7)

Both verify variants map their native verdicts onto the canonical **Blocker/Major/Minor/Trivial** scale from child #1 (reference `canonical-severity-vocabulary` in the PREAMBLE; do NOT restate the definitions). Mapping:

| Native (verify-change) | Native (verify-enhanced) | Canonical |
|---|---|---|
| CRITICAL (incomplete tasks, missing req impl) | Critical Issues / stage FAIL on a blocking check | Blocker |
| WARNING (spec/design divergence, missing scenario coverage) | Warnings | Major |
| SUGGESTION (pattern inconsistency, minor improvement) | (nice-to-fix) | Minor / Trivial |

Both variants emit ONE parseable status line into their written report (and conversation):

`VERIFY VERDICT: <CLEAN|BLOCKED> — Blocker:<n> Major:<n> Minor:<n> Trivial:<n>`

**Pass rule (unified gate semantics):** `CLEAN` iff no open Blocker and no open Major — the same clean rule as the review-cycle termination invariant and opsx-orchestration. This is the single meaning of "verification passed" downstream stages can key off. The human-facing "Ready for archive" / "must fix before shipping" prose MAY remain as narration but is no longer the machine contract. Per-stage PASS/FAIL in verify-enhanced stays as a display aid. Deliberately NOT touched: whether a BLOCKED verdict *enforces* an archive refusal (WF-4, child #5) — this change only standardizes the words and the pass rule.

### D3 — Fingerprinted test-evidence schema closes verify → ship (WF-8)

Adopt the schema `review-cycle.ts:51` already defines. When a verify variant runs the project test/gate suite as part of verification, it records into its report a **test-evidence block**: the exact command(s) executed, their result (pass/fail), and the content tree fingerprint `git rev-parse HEAD^{tree}` of the state they ran against. Format aligned to what ship's gate parses (`ship.ts:87`): a line ship can read as "green test evidence … whose recorded content tree fingerprint matches the current one."

ship already accepts "another verification report" as an evidence source, so once `verification-report.md` / the `*-report.md` files carry the block, ship's skip gate honors it with no gate-logic change; the only ship edit is naming `verification-report.md` in the evidence list for discoverability. If a verify run does NOT execute tests, it records no block (ship then correctly RUNS — "skips on proof, never on hope"). Alternative considered: only document in ship that review-cycle is the sole skip producer (audit's fallback) — rejected, it leaves the standard verify path a second-class citizen; closing the chain is cheap and symmetrical.

### D4 — Scope "Never read source code" via enumerate-and-gate (SH-1, SH-2, RV-6, RV-7)

Follow reviewer2's idiom (durable finding): a scope note that **names the specific downstream absolute(s)** and sweeps the WHOLE block for ALL mandatory absolutes, not just the tasked one (that omission is how child #1's only Minor escaped).

**QA_METHODOLOGY block sweep** ("Important Rules", `_shared.ts:609-620`): the read-source absolutes are **#5 "Never read source code. Test as a user, not a developer"** and its reinforcer **#7 "Test like a user"**. (Swept and cleared as non-conflicting: #3 credentials, #4 write incrementally, #9 never delete outputs, #12 never refuse the browser — none touch source reading.) Fix: scope #5 (and note #7) with a clause naming both downstream consumers — "Rules #5/#7 govern the exploration/testing phase: do not read source to FORM findings; test as a user. Reading source IS required and allowed for (a) **diff-aware triage** — mapping changed controller/model/view files to the routes/pages they serve (Diff-aware Step 2, `_shared.ts:352`); and (b) the **standalone fix loop** (qa Phase 8), which reads source to make the minimal fix."

**DESIGN_METHODOLOGY block sweep** ("Important Rules", `_shared.ts:946-956`): the sole read-source absolute is **#4 "Never read source code. (Exception: offer to write DESIGN.md…)"**. Its single carve-out reinforces the absolute for everything else — so extend #4's exception explicitly: "(b) reading changed files to map them to affected pages in **diff-aware mode** (`_shared.ts:636`); (c) the **standalone fix loop** (design-review Phase 8) reads source to make the minimal fix." Scope clause: #4 governs the audit phase — do not form design findings by reading code instead of the rendered site.

The carve-out explicitly points at the STANDALONE fix loop because child #1 already made the dispatched-mode reviewer report-only (no fix loop) — so the "fix loop reads source" exception only applies when a human runs the skill directly. This keeps child #1's contract intact.

### D5 — chrome-use into the parity golden master

Add `getChromeUseSkillTemplate` to `functionFactories` (line ~190) and `GENERATED_SKILL_FACTORIES` (dirName `rasen-chrome-use`) in `skill-templates-parity.test.ts`, plus its computed entries in `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`. chrome-use is already in the production `getSkillTemplates` registry (so the store-selection containment test covers it) — the gap is only the two hash maps. Fits here because child #2's regen tail already runs the parity suite; the entries are computed fresh (this change doesn't move chrome-use's content), then hand-pasted.

## Risks / Trade-offs

- [verify-change edited in two getters (skill + command) — one may drift] → Both getters get the identical Save-Report + status-line + evidence-block text; the parity suite and a grep for the status-line string in tasks catch a missed getter.
- [Status-line format must be parseable by future gating without over-engineering now] → A single fixed-prefix line (`VERIFY VERDICT:`) is enough for `grep`-level gating; no schema/JSON needed. ship still only file-exists-checks today (WF-1), so nothing breaks if a consumer ignores the line.
- [Scoping an "Important Rules" absolute could over-license source reading] → The carve-out is explicit and enumerated (diff triage + standalone fix loop only) and re-states the real intent (no source-reading to form findings); it does not weaken the exploration-phase discipline.
- [Adding chrome-use hashes when its content later moves in child #3 re-churns them] → Expected; any PREAMBLE change re-churns all embedders. Having chrome-use IN the table is the point — it now fails loudly instead of shipping unverified.
- [Shared working tree with another session] → same portfolio rule: explicit pathspec on ship, `git show --stat`, accept whole-file rebrand bundling per precedent.

## Migration Plan

Pure prompt-template + test change; no runtime migration. Deploy: `pnpm build` (fall back to `node build.js` if the workspace file is mid-flight) → `node dist/cli/index.js update` → parity suite green with hand-pasted hashes → `validate`. Rollback = revert + regenerate.

## Open Questions

- Should `verification-report.md` be a distinct filename or reuse `review-report.md`? Chosen distinct (`verification-report.md`) so verify-change's artifact-level verdict is not confused with the code-review expert's findings file, and both can coexist. Recorded as decided, not blocking.
- Does verify-enhanced actually run a full test suite today? It invokes /review·/cso·/qa·/design-review but has no explicit "run the suite" step. D3 makes the evidence block CONDITIONAL ("when a verify variant runs tests"); if neither verify variant runs the suite, the block is simply never emitted and ship correctly re-runs. Adding an explicit optional test-run step to verify-enhanced is left as a KEEP-simple default — flagged for child #3/#5 if a stronger guarantee is wanted.
