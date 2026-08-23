# Dogfood receipts — issue-registry (READ-ONLY), 2026-08-22

Captured from the worktree cwd (`.claude/worktrees/issue-layer`, branch `feat/issue-phase6`)
against the persistent store `issue-registry`, with the delivery surface of this change live.
`git status` in the store root is empty before and after every capture: reading delivery
evidence writes nothing (the store-family byte suite pins the same discipline on temp stores).

## Receipts

| # | file | Issue | counts (record / no-record / not-archived / unreadable / unattributed) |
| --- | --- | --- | --- |
| 1 | `dogfood-1-autodecompose-uplift.txt` | issue-autodecompose-uplift | 2 / 0 / 0 / 0 / 0 |
| 2 | `dogfood-2-cross-project-execution.txt` | issue-cross-project-execution | 3 / 0 / 1 / 0 / 0 |
| 3 | `dogfood-3-cross-project-replanning.txt` | issue-cross-project-replanning | 2 / 0 / 1 / 0 / 0 |
| 4 | `dogfood-4-multi-change-execution.txt` | issue-multi-change-execution | 2 / 0 / 1 / 0 / 0 |
| 5 | `dogfood-5-multi-change-execution.json` | issue-multi-change-execution (`--json`) | same, machine form |

Totals: 9 archived `record` rows + 3 `not-archived` rows — exactly the planner's fact base
(nine v1-ledger entries, three run-terminal unarchived nodes), with zero rows in any other
named state: no surprises, no named absence where a fact was expected.

## Spot-pinned constants (receipt 4, issue-node-lifecycle row)

- code commit `31d0b6440a453a128af29b900329c5389e52cf30`
- planning branch `feat/issue-phase2`
- archived `2026-08-20T05:56:26.013Z`
- evidence 7 file(s), ship-log present (`evidence/ship-log.md`, sha256 `80b354dee0f5…`)
- missing `verification-report`
- outcome: `(none recorded on this legacy record basis)` — the v1 ledger predates v2 outcome
  records; the absence is the record's own statement, never filled

## The three not-archived rows

- `issue-persistent-baseline@rasen — run-terminal — not-archived` (receipt 4; located by
  execution-root from this worktree's ephemera)
- `issue-needs-attention@rasen — run-terminal — not-archived` (receipt 3; execution-root)
- `document-multi-project-issues@rasen-site — run-terminal — not-archived` (receipt 2; the
  cross-project sample — located through the workspace-index, reading the member project's
  recorded activity from the Store-scoped read)

## Parity

Receipt 5 (`--json`) carries the same facts as receipt 4: `delivery.revisionId` `0001`,
the same counts, per-node `delivery` on `status.nodes` (full inventory with digests beside
the human form's count + ship-log line), every fact the human section rendered.
