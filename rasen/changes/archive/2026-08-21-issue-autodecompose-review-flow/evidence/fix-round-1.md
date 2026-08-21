# Fix round 1 — issue-autodecompose-review-flow (2026-08-22)

Review verdict PASS with 1 Minor + 1 Info; both fixed, no design movement.

## Minor-1 — confirm `--revision <unreadable>` reuses the requires-plan refusal

Split into two truths, distinct codes:

- `src/core/issue-execution/types.ts`: `IssueConfirmRefusalCode` gains
  `issue_confirm_revision_unreadable`; `ComposeIssueConfirmInput` gains
  `requestedRevisionId?` (what lets a null plan read as "that ordinal does
  not exist" rather than "no plan" on an Issue that has revisions).
- `src/core/issue-execution/confirm.ts`: in the no-readable-revision branch,
  a NAMED revision over an Issue WITH published revisions now refuses with
  the new code, naming the requested id and the readable range (one revision:
  "its one published revision is NNNN"; several: "run FIRST–LAST (latest
  NNNN)"). An Issue with NO revisions keeps `issue_confirm_requires_plan`
  verbatim, named-revision or not.
- `src/commands/store-issue.ts`: the confirm action passes
  `requestedRevisionId` through and maps the new code's fix to
  "Read the Issue's revision ordinals first: `rasen store issue show <id>
  --store <store>`, or omit --revision to confirm the latest." — the
  publish-advice fix stays exclusive to the requires-plan code.

Pins:

- Core (`test/core/issue-execution/issue-execution-confirm.test.ts`, +2): the
  named-revision miss over a three-revision Issue refuses with the new code
  naming '9999' / 0001–0003 / latest 0003 and never the planning-phase
  wording; a named miss over a ZERO-revision Issue still refuses
  requires-plan.
- CLI (`test/commands/store-issue-confirm-cli.test.ts`, +1): the reviewer's
  live case through the real CLI — exit 1, refusal receipt carries
  `issue_confirm_revision_unreadable`, the message names '9999' and the
  readable revision, and `fix` is the show-command advice.
- Live reproduction over the persistent store (Issue #3, three revisions):
  `evidence/fix-round-1-confirm-revision-9999.txt` — exit 1, "Revision '9999'
  … run 0001–0003 (latest 0003)", fix = show command. Writes nothing (the
  confirm verb's pinned fence).
- Spec delta (`specs/issue-execution-binding/spec.md`): the ADDED confirm
  requirement gains one scenario — "Confirm refuses a named revision that
  does not read back with the readable range" (naming the requested id +
  range, advice pointing at the ordinals, never at publishing). Within the
  requirement's existing letter ("SHALL refuse, naming the defect"); no
  requirement text changed.

## Info-1 — stale `isRequired`/progress comment

`src/core/issue-status/projection.ts` (`progressOver`'s doc, the sentence the
reviewer located at the `isRequired` site): "intent nodes carry no lifecycle
at all and never do" replaced with the D1 truth — intent nodes DO carry
`required|optional` (absent reads `required`); `isRequired`'s change-kind
conjunct is what excludes them from progress; `cancelled`/`superseded` stay
Change-node-only. Comment only, zero behavior.

## Gates (real exit codes, solo runs)

- `pnpm run build` exit 0.
- `test/core/issue-execution/issue-execution-confirm.test.ts` 9/9 (7 + 2 new)
  exit 0; `test/core/issue-execution/issue-execution-binding.test.ts` 40/40
  exit 0; `test/commands/store-issue-confirm-cli.test.ts` 5/5 (4 + 1 new)
  exit 0; courtesy `test/core/issue-status/issue-status-projection.test.ts`
  25/25 exit 0 (the Info-1 file).
- `rasen validate issue-autodecompose-review-flow` exit 0.
- Fences byte-empty: `git diff -- src/core/pipeline-registry/ pipelines/
  packages/ui package.json` = 0.
