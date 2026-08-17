# Fix round 1 — issue-acceptance-close

Date: 2026-08-17. All seven findings dispositioned. Every code/spec/test edit below is in
the same uncommitted working tree on `feat/issue-layer` (on top of 63f58449).

## Minor-1 — premature close vs the delta's review clause — FIXED (delta wording + pin test)

Chose the reviewer's first option: the DELTA is the one place changed. The MODIFIED "Phase
derives…" requirement in `specs/issue-status-projection/spec.md` now scopes `review` to
exactly two cases — an OPEN Issue with every node terminal and no intent node, and a resolved
Issue without a verified record "whatever its nodes' state (the operator has declared the work
over, so the graph no longer scopes the phase and only the unproven acceptance remains)" —
matching D4/D5's intent and the code as shipped. Added the delta scenario "A premature close
reads review regardless of the graph" (resolved while a node is in flight → `review` +
`waiting-human` AND the gate still names the un-terminal node).

Pin: new test in `test/core/issue-status/issue-status-projection.test.ts` — "reads
review/waiting-human for a premature close while a child is still in flight" — asserts
phase/health over a real-Git fixture with g-001 in flight, plus the exact `un-terminal-node`
blockers for g-001 (in-flight) and g-002 (not-started). No production-code change (the code
already implemented the chosen reading; the spec text now says it).

## Minor-2 — partial coherence invariants — FIXED (invariants completed + read-path test)

`assertCoherentGateSnapshot` in `src/core/store/issues/acceptance.ts` now enforces the full
set: `completed === total` ("the gate passes only when every required node is complete") and
`health !== 'failed'` beside the existing three. One definition, enforced at both call sites
(mutation input AND `validateAcceptedRecord` on read), comment rewritten to state the full
guarantee.

Pin: `store-issue-acceptance-content.test.ts` — the serializer-refusal case gains
`completed:1/total:3` (→ `completed (1) must equal total (3)`) and `health:'failed'` (→
`health must not be failed`); and the new test "refuses a hand-crafted re-digested
contradictory record on READ" hand-assembles YAML whose digest VERIFIES over a contradictory
body and asserts `parseAcceptedRecord(..., { verifyDigest: true })` refuses it — first the
1/3 record, then a failed-health-only record. Honest callers are unaffected (an eligible
gate's snapshot satisfies every invariant by construction; all existing accept flows pass).

## Info-1 — unit count not reproducible — RECONCILED (both sets named)

The two "8 file" sets had different MEMBERSHIP. Per-file, as measured after this fix round:

- Implementer's set (now 9 files / 182 tests, exit 0): mutations 11, locator-widening 7,
  read-only-guard 5, planning-layout-v2 65, store-issue-scope 5, content 13, issue-layout 45,
  gate 9, projection 22. Pre-fix this set was 8 files / 174 (no store-issue-scope; content 12,
  gate 8, projection 21 — the +3 are this round's new tests).
- Reviewer's set (would now be 8 files / 137): mutations 11, locator-widening 7,
  read-only-guard 5, planning-layout-v2 65, content 13, scope 5, gate 9, projection 22 — i.e.
  the implementer's set with `store-issue-layout` (45) swapped for `store-issue-scope` (5).
  Pre-fix: 134, exactly as the reviewer measured.

Both are valid affected sets; the earlier "202" total came from the first set's 174 + CLI 28.
The union (182 + CLI 28 = 210) is what this round actually ran green.

## Info-2 — record written before the transition check — FIXED (trivially safe reorder)

The `open → resolved` transition check is hoisted in `accept` (`src/core/store/issues/module.ts`)
to before ANY byte is written — right after the dropped refusal, through the same
`isPermittedIssueTransition` gate and the same `issue_state_transition_refused` surface. The
write section now only writes (comment in place). Under the current table the path is
unreachable (open→resolved always permitted, as the reviewer noted), so no existing test
changes behavior; the reorder removes the wedge state where a record could outlive a refused
transition. `isPermittedIssueTransition` remains imported where it was.

## Info-3 — record-freeze scenario without a direct test — FIXED (test added)

New test in `test/core/issue-acceptance/issue-acceptance-gate.test.ts` — "freezes what was
accepted: a later conditions revision changes neither the record nor done": accepts under
0001 (through the real gate evaluation + mutation), publishes 0002 with different content,
commits both, re-reads — asserts `record.conditionsRevisionId === '0001'`, the record's
digest still equals 0001's, phase stays `done`, while `conditions.revision.revisionId` reads
`0002` (latest ≠ accepted, the separation the freeze guarantees).

## Info-4 — `acceptance` reusing `issue_scope_required` for input-shape errors — FIXED (own codes)

Two new taxonomy codes in `StoreIssueErrorCode` (`src/core/store/issues/types.ts`):
`issue_acceptance_from_file_required` (missing `--from-file`) and
`issue_acceptance_conditions_list_required` (file without a `conditions:` list), wired into
the acceptance action in `src/commands/store-issue.ts` — the same naming discipline as
`issue_plan_from_file_required` on the sibling `plan` subcommand. Locale note: error codes
carry no locale entries by design (verified: zero hits for `issue_state_undefined` /
`issue_plan_from_file_required` in en/ja/zh-cn — the locale surface holds command/option
descriptions only), so there is nothing to sync; the new subcommands' option entries were
already in all three locales.

## Info-5 — vitest weight understated + show spacing — FIXED (both)

`vitest.config.ts`: `test/commands/store-issue-acceptance-cli.test.ts` entered at 200000
(reviewer's solo 194524 + headroom; both observations cited in the comment, higher entered
per the file's own convention). `renderAcceptanceSection` in `src/commands/store-issue.ts`
now prints a leading blank line so the section separates from STATUS PROBLEMS the same way
the UNREADABLE/INCOMPLETE blocks do (the dogfood receipt's rendering artifact). Also during
re-verification: the remaining four 30s-budget tests in the NEW CLI file were raised to 60s
(same infra rationale as the two 90s tests and the C2 parity test — spawn-heavy cases under
this machine's ambient load; zero assertion changes; comments in place).

## Gates (re-run this round, real exit codes, no pipes)

- `pnpm run build` after all src edits → exit 0; `npx tsc --noEmit` → clean.
- Units (the union set above, 9 files): **182/182 passed, exit 0**.
- CLI (4 files): **28/28 passed, exit 0**.
- `node bin/rasen.js validate issue-acceptance-close` → valid, exit 0.
- Fences: `git diff -- src/core/pipeline-registry/ packages/ui package.json
  packages/ui/package.json` → 0 bytes.

## Delta file list (for re-review — files changed by this round)

Spec: `rasen/changes/issue-acceptance-close/specs/issue-status-projection/spec.md`.
Src: `src/core/store/issues/acceptance.ts`, `src/core/store/issues/module.ts`,
`src/core/store/issues/types.ts`, `src/commands/store-issue.ts`.
Tests: `test/core/issue-status/issue-status-projection.test.ts`,
`test/core/store/store-issue-acceptance-content.test.ts`,
`test/core/issue-acceptance/issue-acceptance-gate.test.ts`,
`test/commands/store-issue-acceptance-cli.test.ts`.
Infra: `vitest.config.ts`.
