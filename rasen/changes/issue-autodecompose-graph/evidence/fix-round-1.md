# Fix round 1 — Major-1 (delta prose overclaimed lifecycle on the published intent node)

Reviewer report: `evidence/review-report.md` (Major-1). Disposition: **fixed** —
prose-only reword to the shape the implementation already had; no behavior
change anywhere.

## What changed

1. `specs/issue-plan-publication/spec.md` — ADDED requirement "A decomposition
   publishes as a reviewable intent-node revision": removed the clause claiming
   each intent node carries "an authored lifecycle where `optional` work is
   proposed (absent reads `required`)". The node's fields now list only target
   project/line, edges, suggested pipeline, and rationale/uncertainty. Added a
   sentence stating the truthful shape: the authored lifecycle is recorded in
   the decomposition document ALONE (the sole durable record of the
   required/optional proposal); the compiled intent node deliberately carries
   no lifecycle at all (schema-forbidden, exactly as `store-issue-resources`
   holds); the proposal surfaces at review time through the document — which
   this requirement preserves byte-identical for exactly that reason — and how
   the confirm flow consumes it is that flow's decision. The requirement's
   first line still carries its SHALL (the parser reads only line 1).
2. `proposal.md` — the "The decomposition channel" bullet's matching parenthetical
   reworded to the same truthful shape (lifecycle recorded in the document
   alone; plan schema forbids a lifecycle on an intent node; confirm-flow
   consumption is that flow's decision).
3. `test/core/issue-publication/issue-plan-decomposition.test.ts` — the first
   test's title said "dropping no authored guidance" while its body asserts the
   authored lifecycle IS dropped (the reviewer's evidence note inside Major-1);
   title corrected to "dropping the authored lifecycle". Title-only change,
   disclosed here because the routed instruction called the round atomic on
   code — this is the same wording-slip family inside the same finding, zero
   behavior impact.

## Explicitly not changed

- All five scenario TITLES under the reworded requirement: byte-stable (bodies
  audited — none repeats the contradiction; none mentioned lifecycle).
- `specs/opsx-auto-command/spec.md` line 8 mentions "`required` or `optional`
  lifecycle" — audited and left as-is: that sentence describes the DOCUMENT the
  LEAD authors (which genuinely carries the lifecycle), not the published
  revision's node.
- `specs/issue-status-projection/spec.md` lifecycle mentions are the MODIFIED
  requirement's pre-existing change-node read-surface wording, byte-carried
  from the main spec — untouched.

## Gates (real exit codes)

- `node bin/rasen.js validate issue-autodecompose-graph --json` → **exit 0**,
  `valid: true`, `issues: []`.
- `npx vitest run test/core/issue-publication/issue-plan-decomposition.test.ts`
  (solo) → **exit 0**, 1 file passed (1), 9 tests passed (9).

## Delta file list (this round's touched set)

- `rasen/changes/issue-autodecompose-graph/specs/issue-plan-publication/spec.md`
- `rasen/changes/issue-autodecompose-graph/proposal.md`
- `test/core/issue-publication/issue-plan-decomposition.test.ts` (title only)
