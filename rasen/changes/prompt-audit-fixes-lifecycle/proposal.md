## Why

The workflow-lifecycle audit (`audit/audit-workflows.md`) found six cross-stage seam defects where one lifecycle stage promises or expects behavior that the adjacent stage never honors: office-hours promises propose auto-consumes its doc (WF-2), verify calls incomplete tasks a blocking CRITICAL while archive downgrades them to an overridable warning (WF-4), archive has no delivery precondition while apply steers straight to it (WF-5), office-hours both inlines and delegates its session with no precedence (WF-6), continue offers "archive it" before any implementation (WF-10), and ship's `local` deferral is invisible to archive (WF-11). Separately, eleven generated workflow/orchestration skill templates (auto, review-cycle, ship, verify-enhanced, retro, handoff, office-hours-command, and the four goal templates) ship with **no parity hash coverage**, so shared-block edits (like children 1–4's PREAMBLE work) change them silently and unverified.

## What Changes

- **WF-2 (implement the consumer):** `propose.ts` gains a step that reads office-hours validation as input context — `office-hours-design.md` in the just-created change dir AND `<office-hours-dir>/<change-name>.md` (the sibling dir where office-hours writes when no change existed yet, discoverable because both derive the same kebab slug). Consumer is now wired to the existing `opsx-office-hours-command` "Downstream Consumption by Propose" promise. Paths resolved from `rasen status --json` (not hardcoded — stays clear of WF-3/child #6).
- **WF-4 (give the gate teeth):** `archive-change.ts` reads `verification-report.md` and refuses to archive when `VERIFY VERDICT: BLOCKED` unless the user gives an explicit override; incomplete tasks are elevated from a soft warning to the same explicit-override hard gate, aligning archive's vocabulary with verify's "must fix before archive." Consumes child #2's `VERIFY VERDICT` contract — no new verdict vocabulary.
- **WF-5 (ship-before-archive):** `archive-change.ts` warns when no `ship-log.md` exists ("archive without delivering?"), with an explicit escape for changes that legitimately don't ship (spec-only). `apply-change.ts`'s completion nudge reroutes through verify → ship before mentioning archive.
- **WF-6 (one facilitation authority):** `office-hours.ts` (the *workflow command*, not the expert) delegates session facilitation to the `/office-hours` expert as the single authority; the inline six-questions/builder text becomes a documented fallback, and doc production is consolidated into one step.
- **WF-10 (right next step):** `continue-change.ts`'s all-artifacts-complete nudge steers toward `/rasen:apply` (implement) and mentions archive only as the post-implementation step.
- **WF-11 (portfolio awareness):** `archive-change.ts` detects a `ship-log.md` marked "delivery deferred to portfolio level" and notes the parent's pending delivery before archiving (minimal cross-reference, no portfolio machinery).
- **Parity expansion:** add the eleven unpinned workflow/orchestration skill templates and their eight command variants to `test/core/templates/skill-templates-parity.test.ts`, hash-locking them so future shared-block edits are verified.
- **F.1 resume ladder (LEAD-added):** `_orchestration.ts` Step F.1 gains one clause — a resume document counts only if it is the latest holder's own distillation; an un-exhausted latest holder with no document resumes from its transcript, which beats any earlier generation's document (plus a same-session-restart wake-by-name note). Fixes a live failure where the LEAD matched a stale older-generation document and discarded intact context.

## Capabilities

### New Capabilities
- `lifecycle-stage-sequencing`: the completion nudges of the generated apply and continue workflow skills route the user through the correct next lifecycle stage (apply → verify → ship → archive; continue → apply, not archive).
- `workflow-template-parity`: the workflow/orchestration skill and command templates that lie outside the expert set are pinned by the parity golden-master, mirroring how the 19 experts and chrome-use are pinned.

### Modified Capabilities
- `propose-workflow`: add the requirement that propose consumes office-hours validation output (both the in-change-dir doc and the slug-matched sibling doc) as input context (WF-2).
- `opsx-office-hours-command`: add a facilitation-precedence requirement — the workflow command delegates the session to the `/office-hours` expert as the single authority, with the inline description as fallback (WF-6).
- `opsx-archive-skill`: add a verification-verdict hard gate (WF-4) and a delivery-precondition check covering both missing ship-log and portfolio-deferred delivery (WF-5, WF-11); tighten the incomplete-tasks check from soft warning to explicit-override hard gate (WF-4).
- `orchestration-worker-lifecycle`: add the F.1 generation-match requirement — the resume ladder prefers a document only when it is the latest holder's own distillation, else resumes from the latest transcript (LEAD-added).

## Impact

- Template sources: `src/core/templates/workflows/propose.ts`, `office-hours.ts`, `archive-change.ts`, `apply-change.ts`, `continue-change.ts`, and one clause in `_orchestration.ts` (LEAD-granted scope exception for the F.1 fix only; embedded by auto/goal-command/review-cycle, so hash-verified via the parity expansion).
- Tests: `test/core/templates/skill-templates-parity.test.ts` (new hash entries; existing hashes for the five edited templates move).
- No runtime `src/core` behavior code changes. The goal-skill *generation-registration* debt inherited from children 2/3 is already closed (registered in `skill-generation.ts` via commit 60f8d10, asserted by `opsx-goal-command` spec); only its parity coverage remained, folded into `workflow-template-parity`.
- Off the concurrent externalize session's surface (root-selection/store files) and off child #6's store-path sweep (WF-3/WF-9). Shares `archive-change.ts` with the deferred child #6 — no concurrent collision; child #6 re-verifies after this lands.
