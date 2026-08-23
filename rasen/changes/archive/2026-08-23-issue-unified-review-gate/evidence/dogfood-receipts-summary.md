# Dogfood receipts — issue-registry (READ-ONLY), 2026-08-23

Captured from the worktree cwd (`.claude/worktrees/issue-layer`, branch `feat/issue-phase6`)
against the persistent store `issue-registry`, with the review surface of this change live.
`git status --porcelain` in the store root is empty before and after every capture: reading
the review view writes nothing (the CLI byte suite pins the same discipline on temp stores).

## Receipts

| # | file | Issue | determination | threads |
| --- | --- | --- | --- | --- |
| 1 | `dogfood-1-autodecompose-uplift.txt` | issue-autodecompose-uplift | `accepted` (record 2026-08-21T20:51:33.888Z under revision 0001) | 2 × evidence-missing |
| 2 | `dogfood-2-cross-project-execution.txt` | issue-cross-project-execution | `accepted` (record 2026-08-20T18:03:54.626Z under revision 0001) | archive-pending + 3 × evidence-missing |
| 3 | `dogfood-3-cross-project-replanning.txt` | issue-cross-project-replanning | `accepted` (record 2026-08-22T12:08:55.201Z under revision 0001) | archive-pending + 2 × evidence-missing |
| 4 | `dogfood-4-multi-change-execution.txt` | issue-multi-change-execution | `accepted` (record 2026-08-20T09:46:11.369Z under revision 0001) | archive-pending + 2 × evidence-missing |
| 5 | `dogfood-5-multi-change-execution.json` | issue-multi-change-execution (`--json`) | same, machine form | same, machine form |

Totals: `evidence-missing` ×9 (every archived v1 record froze `missing:
["verification-report"]` — one thread per node, the recorded name carried verbatim) and
`archive-pending` ×3 — exactly the planner's fact base, with zero determinations or threads
that surprised: the retrospective review view every closed Issue reads is `accepted` with
its threads standing, not hidden by the conclusion.

## The three archive-pending rows (expected progress, never damage)

- `archive-pending document-multi-project-issues (run-terminal — …)` (receipt 2; the
  cross-project sample — the rasen-site node located through the workspace-index)
- `archive-pending issue-needs-attention (run-terminal — …)` (receipt 3; execution-root)
- `archive-pending issue-persistent-baseline (run-terminal — …)` (receipt 4; execution-root)

## Parity (receipt 5)

The `--json` payload carries `review` beside `status` and `delivery`, holding the identical
determination, threads, and verification summary the human section printed — the closing
statement being the one line that is narration, not fact, and therefore human-form only.
