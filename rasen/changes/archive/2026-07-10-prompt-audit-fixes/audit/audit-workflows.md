# Workflow Lifecycle Prompt-Conflict Audit

Scope: core OPSX/rasen workflow lifecycle command templates under
`src/core/templates/workflows/`. Each finding cites both sides, gives a concrete
misbehavior scenario, and a fix direction. Taxonomy: A rule-vs-rule /
B missing-state / C precedence-gap / D wrong-generalization / E buried-override /
F cross-file-seam.

Line numbers reference the `.ts` template files; the quoted text is the
template STRING (the system prompt shipped to agents), not TS code.

---

## WF-1 — ship tells the user to run a verify command that produces no evidence file
- **Taxonomy:** F (cross-file seam) + B (missing state)
- **Severity:** Major
- **Sides:**
  - `ship.ts:37-39` — pre-flight (a): "Check if `rasen/changes/<name>/review-report.md` exists (or `review-cycle-report.md` … or any other expert `*-report.md` — any of these counts as verification evidence). If no verification report found, warn: **'No verification report found. Run /rasen:verify first.'**"
  - `verify-change.ts:166-173` (skill) and `verify-change.ts:338-345` (command) — the entire "Output Format" section only emits a markdown report **into the conversation**. There is NO step anywhere in `verify-change.ts` that writes a `*-report.md` file.
  - Contrast `verify-enhanced.ts:78-83` which DOES write `review-report.md`, `cso-report.md`, etc.
- **Scenario:** User runs `/rasen:verify add-auth` (the plain verify, which `verify-change`'s own description bills as "validate … before archiving"). It prints a clean report. User then runs `/rasen:ship`. Pre-flight finds no `*-report.md` file and warns "Run /rasen:verify first." The user re-runs `/rasen:verify` — which again writes no file — and ship warns again. The only escape is the "confirm proceeding without verification" prompt, so the user learns to routinely bypass the ship verification gate.
- **Fix direction:** Either (a) point the warning at `/rasen:verify-enhanced` (the verify variant that actually writes a report), or (b) make `verify-change` persist its report to the change directory so ship can detect it. Prefer (a)+(b): ship should name the command whose output it looks for.

---

## WF-2 — office-hours promises propose auto-consumes its doc; propose has no such step and the file usually lands elsewhere
- **Taxonomy:** F (cross-file seam, missing consumer)
- **Severity:** Major
- **Sides:**
  - `office-hours.ts:78-79`: "This document will be automatically consumed by `/rasen:propose` as input context" and `office-hours.ts:113-115`: "The `/rasen:propose` command auto-detects `office-hours-design.md` in the change directory and incorporates its insights into the proposal."
  - `propose.ts` (both getters, whole file): no step reads `office-hours-design.md`. Propose creates artifacts purely from `rasen instructions … --json` `dependencies` (`propose.ts:74-77`). Grep confirms `office-hours-design` appears only in `office-hours.ts`, `retro.ts`, `auto.ts` — never in `propose.ts` nor in the instruction-loader/resolver, so the CLI does not inject it either.
  - Location mismatch compounds it: `office-hours.ts:75-84` writes to the change dir ONLY when "an active Rasen change context exists"; otherwise it writes `rasen/office-hours/<topic-slug>.md`. But office-hours is "Positioned between /rasen:explore … and /rasen:propose" (`office-hours.ts:23`), and `propose` itself runs `rasen new change` first (`propose.ts:42-46`) — so at office-hours time there is normally NO active change, the doc goes to `rasen/office-hours/`, and the later-created change dir never contains it.
- **Scenario:** User validates an idea with `/rasen:office-hours` (no change yet) → doc saved to `rasen/office-hours/real-time-collab.md`. User runs `/rasen:propose` → new change created, proposal drafted with zero awareness of the validation session. The promised hand-off silently no-ops.
- **Fix direction:** Add an explicit step to `propose.ts`: before drafting proposal, look for `office-hours-design.md` in the (just-created) change dir AND scan `rasen/office-hours/<slug>.md` matching the topic, and read it as context. Or have office-hours, when it wrote to `rasen/office-hours/`, tell propose the path to import.

---

## WF-3 — ship / verify-enhanced / retro / office-hours hardcode repo-local paths, contradicting the store-selection guidance they embed
- **Taxonomy:** E (buried override) + F (cross-file seam)
- **Severity:** Major (Critical for store-scoped users)
- **Sides:**
  - `store-selection.ts:7` (interpolated into every one of these files) instructs threading `--store <id>` onto `status`, `instructions`, `archive`, etc., because "a store is a standalone Rasen repo registered on this machine," i.e. specs/changes may NOT live under the cwd's `rasen/`.
  - Yet these files hardcode repo-local paths:
    - `ship.ts:37,42,99,120` — `rasen/changes/<name>/review-report.md`, `…/tasks.md`, `…/proposal.md`, writes `…/ship-log.md`.
    - `verify-enhanced.ts:80-83` — writes `rasen/changes/<name>/review-report.md` etc.
    - `retro.ts:150-154` — writes `rasen/changes/<name>/retro.md`, `rasen/retro-latest.md`.
    - `office-hours.ts:76,82` — `rasen/changes/<name>/office-hours-design.md`, `rasen/office-hours/<slug>.md`.
    - `archive.ts:64` and `sync-specs.ts:57` — read/write main specs at `rasen/specs/<capability>/spec.md`.
  - Contrast the correctly-threaded lifecycle commands: `new-change.ts:52`, `continue-change.ts:44`, `apply-change.ts:41`, `archive-change.ts:36` all say to use `planningHome`/`changeRoot`/`artifactPaths` from status JSON "instead of assuming repo-local paths."
- **Scenario:** User works in a registered store: `/rasen:ship --store acme add-auth`. Ship reads `rasen/changes/add-auth/tasks.md` from the cwd (which does not contain that change) → "no tasks found," reports 0/0 complete, and writes `ship-log.md` into a stray cwd path instead of the store. Same class of breakage for verify-enhanced reports, retro output, and sync-specs' main-spec target.
- **Fix direction:** Replace hardcoded `rasen/changes/<name>/…` and `rasen/specs/…` in ship/verify-enhanced/retro/office-hours/archive/sync-specs with paths resolved from `rasen status --change <name> --json` (`changeRoot`, `planningHome`, `artifactPaths`), matching the lifecycle commands.

---

## WF-4 — verify calls incomplete tasks CRITICAL "must fix before archive"; archive treats them as an overridable warning
- **Taxonomy:** A (rule-vs-rule) + C (precedence gap)
- **Severity:** Major
- **Sides:**
  - `verify-change.ts:64-66,131-133,147`: incomplete tasks → "Add CRITICAL issue"; CRITICAL is defined "(Must fix before archive)"; final assessment "X critical issue(s) found. **Fix before archiving.**"
  - `archive-change.ts:51-54,113-116`: incomplete tasks → "Display warning … confirm user wants to proceed … Proceed if user confirms," and guardrail "**Don't block archive on warnings** - just inform and confirm."
- **Scenario:** verify reports 3 incomplete tasks as CRITICAL blockers. User goes to archive anyway; archive downgrades the same condition to a soft warning and lets them confirm through. The two stages disagree on whether unticked tasks are a hard gate, so the "verify before archive" discipline is unenforceable — verify's CRITICAL verdict has no teeth at the stage it names.
- **Fix direction:** Decide the contract. Either archive must refuse (not just warn) when verify-class CRITICALs exist, or verify should phrase task-incompleteness as a strong warning (not "must fix / blocking") to match archive's advisory posture. Align the vocabulary in both.

---

## WF-5 — archive has no delivery precondition, and apply steers the user straight to archive, bypassing ship
- **Taxonomy:** B (missing state) + F (cross-file seam)
- **Severity:** Major
- **Sides:**
  - `apply-change.ts:125` (skill) "All tasks complete! Ready to archive this change." and `apply-change.ts:287` (command) "You can archive this change with `/rasen:archive`." — completion nudge jumps from apply directly to archive.
  - `archive-change.ts` (whole file): preconditions are artifact-status, task-status, and delta-spec sync only. There is NO check for `ship-log.md`, commit state, or any delivery evidence.
  - Meanwhile `ship.ts:118-143` is the stage that commits/PRs/pushes and writes `ship-log.md`, and `ship.ts:168-172` positions archive AFTER ship ("After shipping, suggest … Run /rasen:archive").
- **Scenario:** User finishes `/rasen:apply` (7/7), follows its advice, runs `/rasen:archive`. The change is moved to `archive/YYYY-MM-DD-<name>/` while never committed, PR'd, or pushed — the work is "archived" but undelivered, and the change dir (with proposal/specs) is now buried in archive. archive gives no signal that ship never ran.
- **Fix direction:** Have archive check for `ship-log.md` (or committed/delivered state) and warn if absent ("This change has no ship log — archive without delivering?"), and/or have apply's completion message route through verify→ship before suggesting archive.

---

## WF-6 — office-hours both inlines the session and delegates it to the /office-hours expert, with no precedence
- **Taxonomy:** A (rule-vs-rule) + B (missing state)
- **Severity:** Minor
- **Sides:**
  - `office-hours.ts:45-58` "### 2. Execute the Session" fully describes running the six questions / builder brainstorm AND "After all six questions, **synthesize findings into a design document**."
  - `office-hours.ts:60-62` "### 3. Invoke Expert Skill — Invoke the `/office-hours` expert skill for the detailed session execution. The expert skill contains the full facilitation logic."
  - `office-hours.ts:64-72` "### 4. Produce Output — Generate a design document …" (produced again).
- **Scenario:** The agent runs the whole session itself per step 2, then step 3 tells it the facilitation actually lives in the expert skill — so it either re-runs the session via `/office-hours` (double questioning the user) or ignores step 3 (dead instruction). The design doc is described as produced in both step 2 and step 4. Authority between inline and delegated facilitation is undefined; if the `/office-hours` expert skill is absent, step 3 fails after step 2 already did the work.
- **Fix direction:** Pick one path: either delegate to `/office-hours` (make steps 1-2 a thin pre-brief) or inline it (drop step 3). Consolidate doc production into a single step.

---

## WF-7 — the two verify entry points use different verdict vocabularies and target different gates
- **Taxonomy:** D (wrong-generalization) + F (cross-file seam)
- **Severity:** Minor
- **Sides:**
  - `verify-change.ts:129-149`: verdicts CRITICAL / WARNING / SUGGESTION; final states "Ready for archive."
  - `verify-enhanced.ts:94-113`: per-stage PASS/FAIL plus "Critical Issues (must fix before **shipping**)" / "Warnings."
  - Consumer `ship.ts:37-39` only checks whether a report FILE exists — it never parses the verdict; `retro.ts:44-47` reads report files by fixed name.
- **Scenario:** A caller (or the `auto` orchestrator) that keys off "verification passed" gets no stable vocabulary: plain verify says "Ready for archive," enhanced says "must fix before shipping," and neither maps to a machine-checkable status. Plain verify additionally writes no file (see WF-1), so its verdict is a pipeline dead-end. Low blast radius because ship only file-exists-checks, but any future verdict-gating will break.
- **Fix direction:** Standardize a shared verdict vocabulary and a written status line both verify variants emit, so downstream stages can gate on it.

---

## WF-8 — ship's evidence-based test-skip depends on tree-fingerprint evidence that the standard verify producer never records
- **Taxonomy:** F (cross-file seam)
- **Severity:** Minor
- **Sides:**
  - `ship.ts:83-90`: skip the test run only if "green test evidence exists … whose recorded content tree fingerprint (`git rev-parse HEAD^{tree}`) matches the current one" — evidence sources listed: "`review-report.md`, `review-cycle-report.md`, another verification report, or run-state."
  - `verify-enhanced.ts:78-113`: the report format it writes records PASS/FAIL counts and issue lists — NO recorded test run and NO tree fingerprint. Only `review-cycle.ts` (grep-confirmed) records a fingerprint.
- **Scenario:** User runs `/rasen:verify-enhanced` (the recommended full verification), then `/rasen:ship`. `review-report.md` exists but carries no fingerprinted test evidence, so ship's gate finds no matching proof and re-runs the full suite every time. This is safe (the gate "skips on proof, never on hope") but the documented skip optimization is unreachable through the standard verify path — only the review-cycle loop unlocks it.
- **Fix direction:** Have verify-enhanced record the test result + `git rev-parse HEAD^{tree}` into its report when it runs tests, so ship can honor the skip; or note in ship that only review-cycle produces skip-eligible evidence.

---

## WF-9 — single archive uses loose "tasks.md"/`rasen/specs` paths while bulk archive uses resolved artifactPaths
- **Taxonomy:** D (wrong-generalization)
- **Severity:** Minor
- **Sides:**
  - `archive-change.ts:47` "Read the tasks file (typically `tasks.md`)" and `archive-change.ts:64` compares main spec at literal `rasen/specs/<capability>/spec.md`.
  - `bulk-archive-change.ts:47-53` uses `artifactPaths.tasks.existingOutputPaths` and `artifactPaths.specs.existingOutputPaths` from status JSON.
- **Scenario:** In a schema whose tasks artifact isn't literally `tasks.md`, single `/rasen:archive` reads the wrong/nonexistent file and reports "no tasks" (skipping the incomplete-task guard), while `/rasen:bulk-archive` handles the same change correctly. Two paths for one operation diverge. (Overlaps with WF-3's store-path issue.)
- **Fix direction:** Make single archive resolve tasks/specs via `artifactPaths.*.existingOutputPaths` exactly as bulk archive does.

---

## WF-10 — continue-change offers "archive it" the moment artifacts are created, before any implementation
- **Taxonomy:** B (missing state)
- **Severity:** Minor
- **Sides:**
  - `continue-change.ts:50-54`: on `isComplete: true` → "All artifacts created! You can now implement this change **or archive it**."
  - `archive-change.ts:45-54`: archive then warns on incomplete tasks (which will be 100% incomplete right after artifact creation).
- **Scenario:** User creates all planning artifacts, is told they may archive, does so, and immediately hits the "N incomplete tasks" warning — a self-inflicted friction the nudge invited. "Artifacts complete" is conflated with "change complete."
- **Fix direction:** Change the complete-state nudge to steer toward `/rasen:apply` (implement) first; mention archive only as the post-implementation step.

---

## WF-11 — ship "local" mode defers delivery to portfolio level, but archive has no portfolio awareness
- **Taxonomy:** B (missing state)
- **Severity:** Minor (decomposition/auto path only)
- **Sides:**
  - `ship.ts:61-62,116`: local mode — "For decomposed child changes sharing a working tree: delivery happens ONCE at the portfolio/parent level after ALL children complete"; local delivery records "delivery deferred."
  - `archive-change.ts` / `bulk-archive-change.ts`: no notion of parent/portfolio or deferred delivery; will move a child change dir on request regardless.
- **Scenario:** A decomposed child ships `local` (delivery deferred), then gets archived before the parent's portfolio-level delivery runs. The child's dir (and its deferred-delivery ship-log) is moved into `archive/`, and the parent delivery step loses track of it.
- **Fix direction:** Have archive detect a ship-log marked "delivery deferred to portfolio level" and refuse/warn until the parent has delivered.

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 0 | — |
| Major | 5 | WF-1, WF-2, WF-3, WF-4, WF-5 |
| Minor | 6 | WF-6, WF-7, WF-8, WF-9, WF-10, WF-11 |

No Critical (common-path guaranteed-wrong) findings: the worst offenders all
sit behind a store flag, a confirm-prompt, or a specific command sequence.
