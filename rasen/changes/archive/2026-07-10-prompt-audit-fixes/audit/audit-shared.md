# Shared-block prompt-conflict audit

Scope: `src/core/templates/experts/_shared.ts`, `src/core/templates/workflows/_orchestration.ts`,
`workflows/store-selection.ts`, `workflows/change-context.ts`, `skill-templates.ts`.

`skill-templates.ts` is a pure re-export facade (no instruction prose) — nothing to audit.
`store-selection.ts` and `change-context.ts` are each a single self-consistent paragraph — no
internal or cross conflict found. All findings are in `_shared.ts` and `_orchestration.ts`.

Embedding facts verified by grep (they determine which conflicts actually co-occur in one agent's context):
- The LEAD orchestration skills (`auto`, `review-cycle`, `goal-command`) embed `ORCHESTRATION_PLAYBOOK`
  but do **NOT** embed the expert `PREAMBLE`. So PREAMBLE rules bind the *leaf workers* (which invoke
  expert skills), not the LEAD directly.
- `/review` (`review.ts`) embeds `DESIGN_REVIEW_LITE` + `TEST_COVERAGE_AUDIT_REVIEW` + `ADVERSARIAL_STEP`,
  and orchestration Step E.1 / parallelGroup dispatches `/review` as a leaf **reviewer** worker.
- `QA_METHODOLOGY` → `qa.ts`, `qa-only.ts`; `DESIGN_METHODOLOGY` → `design-review.ts`; all run as leaf
  workers in the verify `parallelGroup`.

Severity key: Critical = wrong behavior on a COMMON path · Major = wrong behavior on a plausible path ·
Minor = ambiguity-friction.

---

## SH-1 — QA "Never read source code" vs diff-aware mode that requires reading source (COMMON path)
- **Taxonomy:** A (rule-vs-rule contradiction)
- **Severity:** Critical
- **Sides:**
  - `_shared.ts:571` (Important Rule #5): "**Never read source code.** Test as a user, not a developer."
  - `_shared.ts:302` calls diff-aware "the **primary mode** for developers verifying their work."
  - `_shared.ts:310-311` (diff-aware Step 2): "Identify affected pages/routes **from the changed files**:
    Controller/route files → which URL paths they serve … Model/service files → which pages use those
    models (**check controllers that reference them**)".
- **Why it conflicts:** Mapping changed controller/model/view files to the routes/pages they serve
  *is* reading source. Rule #5 is stated absolutely, under the section literally titled "Important
  Rules," and reinforced by "Test as a user, not a developer." A rule under "Important Rules" reads as
  outranking mode prose.
- **Concrete misbehavior:** User runs `/qa` on a feature branch (the primary/common path). The agent,
  honoring Rule #5, refuses to open the changed controllers to work out which routes they serve, so it
  "identifies no obvious pages/routes." That triggers the Step 2 fallback (`_shared.ts:318`) → it drops
  to a homepage + top-5 smoke test. The targeted, diff-scoped verification the user actually invoked is
  silently replaced by a generic smoke test — and the conflict *routes into* that degradation.
- **Fix direction:** Add an explicit carve-out to Rule #5 ("reading source to map changed files →
  routes during diff analysis is allowed; the 'test as a user' rule governs the exploration/testing
  phase, not diff triage"), or move the never-read rule out of the absolute "Important Rules" list.

---

## SH-2 — Design "Never read source code" vs diff-aware "map changed files to pages"
- **Taxonomy:** A (rule-vs-rule contradiction)
- **Severity:** Major
- **Sides:**
  - `_shared.ts:907` (Design Important Rule #4): "**Never read source code.** Evaluate the rendered
    site, not the implementation. (Exception: offer to write DESIGN.md from extracted observations.)"
  - `_shared.ts:592-593` (design diff-aware mode): "Analyze the branch diff … **Map changed files to
    affected pages/routes**".
- **Why it conflicts:** Same structure as SH-1. The single stated exception (write DESIGN.md) does NOT
  cover the file→page mapping the diff-aware mode requires, so the absolute rule wins on its face.
- **Concrete misbehavior:** `/design-review` on a feature branch → agent won't read changed component
  files to learn which pages they render → diff-scoped audit collapses to "audit the homepage,"
  defeating the "compare design quality before/after on affected pages" intent (`_shared.ts:596`).
- **Fix direction:** Extend Rule #4's exception to include "reading changed files to map them to
  affected pages in diff-aware mode."

---

## SH-3 — The `/review` skill actively fixes / commits / spawns subagents, but orchestration dispatches it as a read-only, no-subagent, non-author reviewer
- **Taxonomy:** F (cross-block seam conflict)
- **Severity:** Major (verify runs `/review` as a leaf worker on the common auto path)
- **Sides:**
  - Orchestration treats a reviewer worker as findings-only, no-spawn, non-author:
    - `_orchestration.ts:22`: "Workers never spawn their own subagents — you are the sole orchestrator".
    - `_orchestration.ts:50` (dispatch prompt): "Do only this one unit of work — **do NOT spawn
      subagents of your own**".
    - `_orchestration.ts:56`: the review skill "print[s] findings to the conversation and save[s]
      NOTHING" — i.e. the LEAD models `/review` as *emitting findings only*.
    - `_orchestration.ts:62`: "Use `read-only` for reviewers"; Step C (`:80-82`) author != verifier.
  - But `/review`'s embedded blocks make it an *active* agent:
    - `_shared.ts:1317`/`:1320`/`:1357` (ADVERSARIAL_STEP): "**Dispatch via the Agent tool**" / "Dispatch
      a subagent with the adversarial prompt … This always runs regardless of Codex availability."
    - `_shared.ts:1256` (TEST_COVERAGE Step 5): "For AUTO-FIX gaps: generate the test, run it, **commit**
      as `test: coverage for {feature}`."
    - `_shared.ts:936` (DESIGN_REVIEW_LITE): "[HIGH] mechanical CSS fix … classify as **AUTO-FIX**."
- **Concrete misbehavior (two):**
  1. **Flat-hierarchy break:** LEAD dispatches a reviewer worker to run `/review` over a 200+-line diff.
     ADVERSARIAL_STEP "Large tier" says the Claude adversarial subagent "always runs" and must be
     *dispatched via the Agent tool*. The worker either spawns a subagent (violating the flat-hierarchy
     invariant the LEAD's accounting depends on) or, obeying its dispatch prompt, silently skips a review
     pass the skill guarantees.
  2. **Author=verifier + diff contamination:** the same reviewer worker hits an AUTO-FIX coverage/CSS
     finding, generates a test and `commit`s it. Now the reviewer has authored+committed code during the
     review pass — the reviewer is no longer a non-author, and the diff under review mutated mid-review,
     so the re-review delta and `ship`'s pre-flight see a diff the LEAD never routed through a fixer.
- **Fix direction:** The reviewer dispatch prompt (Step B) must put `/review` into a report-only mode:
  no subagent dispatch, no AUTO-FIX/commit — findings go to `review-report.md`; all fixes route through
  Step E triage to a non-author fixer. Alternatively gate ADVERSARIAL_STEP's subagent dispatch and
  TEST_COVERAGE's auto-commit behind an "am I running standalone vs. as an orchestrated worker" flag.
- **Same family (noted, lower priority):** `SPEC_REVIEW_LOOP` (`_shared.ts:1452`, "Dispatch ONE
  independent reviewer via the Agent tool") has the identical spawn-a-subagent shape, but it lives in
  `office-hours.ts`, which is normally a top-level pre-build step, not a leaf worker — so it rarely
  co-occurs with the no-spawn constraint. Worth the same fix if office-hours ever runs as a stage.

---

## SH-4 — Warm-continue guard (H.2) names "planner reuse" and points at the wrong threshold; the correction is buried in B.1.5
- **Taxonomy:** E (buried override) — also C (precedence gap)
- **Severity:** Major
- **Sides:**
  - `_orchestration.ts:223` (H.2): "Before EVERY `SendMessage` to an existing worker (delta re-review,
    **planner reuse**, any Tier A continuation): probe that worker's recorded transcript. **Below its
    resolved threshold → continue warm** … At or above → retire it via handoff."
  - `_orchestration.ts:219` (H preamble): thresholds resolve from the **handoff** config, "built-in
    defaults `{ threshold: 0.5, … }`."
  - `_orchestration.ts:76` (B.1.5): "This is a CROSS-CHANGE re-staffing decision, so the threshold it
    compares against is the resolved **reuse** threshold for the planner (… default **0.25**) — **NOT
    the handoff threshold** that governs mid-task relay."
- **Why it conflicts:** H.2 explicitly enumerates "planner reuse" as one of its triggers and tells the
  reader to compare against "its resolved threshold," which — per H's own resolution order — is the
  *handoff* threshold (0.5). B.1.5 says the planner cross-change decision must instead use the *reuse*
  threshold (0.25). The two sections give different numbers for the identical decision, and H.2 (which
  names planner reuse) is the more natural place a LEAD looks.
- **Concrete misbehavior:** LEAD is about to `SendMessage`-reuse the planner for child #3's propose. It
  reads H.2 (which lists "planner reuse"), probes the planner transcript at 0.35 occupancy, sees
  0.35 < 0.5 → **keeps the planner warm**. B.1.5's rule (0.35 ≥ 0.25 → **retire**) is the intended one.
  The LEAD carries a bloated planner it should have retired, degrading later child proposals — exactly
  the context-bloat B.1.5 (Retire on bloat) exists to prevent.
- **Fix direction:** In H.2, exempt planner reuse inline: "planner reuse uses the *reuse* threshold per
  B.1.5, not the handoff threshold" — or drop "planner reuse" from H.2's trigger list and let B.1.5 own
  it entirely.

---

## SH-5 — Solo Repo Ownership "default to action / fix proactively during ANY workflow step" vs leaf-worker single-unit isolation
- **Taxonomy:** F (cross-block seam) — also D (wrong-generalization)
- **Severity:** Major
- **Sides:**
  - `_shared.ts:50` (PREAMBLE, solo mode): when you notice issues outside the current branch's changes,
    "**investigate and offer to fix proactively** … **Default to action**."
  - `_shared.ts:54`: "Whenever you notice something that looks wrong during **ANY workflow step** … flag
    it." + "Never let a noticed issue silently pass."
  - `_orchestration.ts:50` (dispatch prompt, carried into every leaf worker): "**Do only this one unit
    of work** … the LEAD owns all orchestration."
- **Why it conflicts:** Leaf workers invoke expert skills, so they carry the PREAMBLE. In a `solo` repo
  the PREAMBLE tells the worker, broadly and memorably, to investigate/fix *anything* it notices during
  *any* step. The orchestration dispatch tells the same worker to touch only its one unit. "Default to
  action" is stated as a general disposition, not scoped to standalone (non-orchestrated) use.
- **Concrete misbehavior:** A reviewer/implementer leaf worker in a solo repo notices an unrelated flaky
  test or deprecation warning. PREAMBLE solo says "Default to action / investigate proactively"; the
  worker goes off and starts investigating/fixing the unrelated issue, burning its context window and
  (if it edits) contaminating the isolated stage's diff — the exact cross-stage noise the worker-isolation
  design exists to prevent. Worse, the worker can't "offer to fix" the user (only the LEAD can
  `SendMessage`/reach the user), so the "offer" half of the rule dead-ends.
- **Fix direction:** Scope the proactive-fix disposition to non-orchestrated use, or have the worker
  dispatch prompt explicitly suppress it: "noticed out-of-scope issues → report them in your DONE
  durable-findings for the LEAD to triage; do NOT investigate or fix them yourself."

---

## SH-6 — "ALWAYS re-ground every AskUserQuestion call" vs Dialogue Override "re-ground only after a long gap"
- **Taxonomy:** A (rule-vs-rule) — also C (precedence gap)
- **Severity:** Minor
- **Sides:**
  - `_shared.ts:28-29`: "**ALWAYS follow this structure for every AskUserQuestion call:** 1. Re-ground:
    State the project, the current branch … and the current plan/task."
  - `_shared.ts:44` (Dialogue Override): "**Re-ground only after a genuine long gap.** In continuous
    back-and-forth, do not repeat the template opener … it belongs at the start of a session or after
    the user has been away, **not between consecutive replies**."
- **Why it conflicts:** "every … call" vs "not between consecutive replies." No stated tiebreaker for a
  run of legitimate *decision* questions (not free-text dialogue) inside one phase.
- **Concrete misbehavior:** During a multi-question phase the agent prepends the full
  project/branch/plan restatement to every AskUserQuestion, producing the repetitive opener the Dialogue
  Override was added to eliminate — or, reading the override broadly, drops re-grounding after a real
  gap. Friction, not wrong action.
- **Fix direction:** Make the Format's step 1 defer to Dialogue Override explicitly: "Re-ground per the
  Dialogue Override rule (session start / after a gap), not on every consecutive call."

---

## SH-7 — LEAD "do NOT author stage outputs yourself" vs Step E.2 "trivial (you fix inline)"
- **Taxonomy:** A (rule-vs-rule)
- **Severity:** Minor (a reasonable reading — "a trivial inline fix is not a whole stage output" —
  resolves it, so this is friction, not reliable misbehavior)
- **Sides:**
  - `_orchestration.ts:22`: "You orchestrate; **you do NOT author stage outputs yourself.**"
  - `_orchestration.ts:104` (Step E.2 triage): "trivial (**you fix inline**) / non-trivial (route to
    the implementer worker) / design-level (route to a SEPARATE fixer worker)".
- **Concrete misbehavior:** A strict LEAD, anchoring on the memorable opener, refuses to fix a
  one-character typo finding itself and instead spawns a full fixer worker for it (wasteful relay), or
  conversely fixes inline while believing it is violating its stated role.
- **Fix direction:** One line in the opener: "you do not author *whole* stage artifacts; you MAY apply
  trivial inline fixes per Step E.2, which are then re-reviewed by a non-author."

---

## Summary
- Critical: 1 (SH-1)
- Major: 4 (SH-2, SH-3, SH-4, SH-5)
- Minor: 2 (SH-6, SH-7)
- Total: 7

Deliberately NOT reported: `_orchestration.ts` H.4 death-taxonomy / cold-reconstruct (the pre-identified
calibration incident #2). SH-3, SH-4, and SH-5 are the *more* instances of that same family the audit
was asked to surface (right primitive exists but is buried/mis-scoped, or a broad rule bleeds across a
context boundary).
