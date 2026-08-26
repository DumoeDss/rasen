# 4.x — Issue #1: the real loop, from the worktree, into the persistent store

## 4.1 — Issue + revision 0001 from the real portfolio

- `rasen store issue new issue-multi-change-execution --store issue-registry
  --title "Issue layer Phase 2: single Issue, single project, multi-Change
  execution"` → exit 0, state `open` (`4-1-issue-new.json`).
- `rasen store issue plan issue-multi-change-execution --store issue-registry
  --from-portfolio issue-multi-change-execution` with **cwd = this worktree**
  → exit 0, revision `0001` (`4-1-plan-0001.json`). The publication resolved
  the REAL run-state through the resume seam (`source.statePath` = the
  worktree's `.rasen/changes/issue-multi-change-execution/ephemera/
  portfolio-run.json`, childCount 3) and every node's `changeInstanceId` is
  the SEEDED committed instance — name→instance resolution ran against the
  store's committed evidence, serial DAG intact
  (g-003 dependsOn g-002+g-001; g-002 dependsOn g-001).
- Store commit `b38b3f5` (issue.yaml + plans/0001.yaml, pathspec-scoped).

## 4.2 — Acceptance conditions + the live tri-axis (the staged receipt)

- Conditions revision `0001` published via `--from-file` from the portfolio's
  real completion criteria (`4-2-acceptance-conditions-source.yaml`, payload
  in `4-2-acceptance-conditions.json`); store commit
  `chore(store): publish acceptance conditions issue-multi-change-execution/0001`.
- `rasen store issue show issue-multi-change-execution --store issue-registry
  --json` from the worktree (`4-2-tri-axis-gate-holds.json`) — the live
  tri-axis over real evidence:

  | axis | value |
  | --- | --- |
  | phase | `active` |
  | health | `healthy` |
  | progress | **2/3** |
  | g-001 `issue-plan-publication` | `run-terminal` (run-state located, execution-root) |
  | g-002 `issue-node-lifecycle` | `run-terminal` (run-state located, execution-root) |
  | g-003 `issue-persistent-baseline` | `in-flight` (its own per-child ephemera auto-run.json) |
  | gate | **HOLDING** — `issue_accept_blocked`, exactly one blocker: `un-terminal-node:issue-persistent-baseline:in-flight` |

### The one bootstrap step the capture needed (documented, reproducible)

The projection's run-state locator keys by the CLAIMANT's committed changeId
(`aliasFor` prefers the claimant over the node's recorded alias), and the
seeded archived claimants live under DATED entry names, while the loop's
per-child ephemera is keyed by the undated child name — the g-002
implementer finding (b) keying gap. The v1 `archive.json` honestly carries
no outcome (`legacyRecord`), so the terminal observation must come from the
children's real run-states. Script
`mirror-run-states-to-claimant-keys.mjs` (change ephemera `research/`)
mirrors each archived child's REAL run-state to its dated claimant key —
machine-local, regenerable, never committed, not store evidence. One
lossless normalization is applied and recorded: the historical sessions
wrote `openFindings` as bare strings, today's strict RunState schema reads
objects — each string becomes `{ summary: <string> }` verbatim, no severity
invented, stages verbatim, the undated sources untouched. Without it the
strict read refuses the whole file (`invalid-run-state`, observation
`unknown`) — a durable Phase 3 finding, see the findings note.

## 4.3 / 4.4 — staged for portfolio close (per design D5, LEAD-driven)

The gate needs every required node's work complete, including g-003 itself —
acceptance is a portfolio-close act AFTER this change's own pipeline reaches
terminal. **Run both steps from the worktree BEFORE any worktree cleanup or
reset** — the terminal observations depend on worktree-local, never-committed
files (the dated mirrors AND the undated sources they normalize), unrecoverable
after cleanup; capture the 3/3 receipt at that moment. Staged steps, ready to
run as-is (cwd = the worktree):

1. As the LEAD's loop drives g-003 to ship/archive, its run-state stages go
   `done`; re-run the show command and capture the projection at 3/3,
   phase `review`:
   `node bin/rasen.js store issue show issue-multi-change-execution --store issue-registry --json`
2. At portfolio close (all children run-terminal or finalized):
   `node bin/rasen.js store issue accept issue-multi-change-execution --store issue-registry --json`
   — the gate evaluates over the real evidence, records the acceptance, and
   resolves the Issue; confirm with `store issue show` reading `state: done`
   (or `resolved` per the acceptance record), then commit the acceptance
   record on the store pathspec-scoped
   (`rasen/issues/issue-multi-change-execution/`).

Per the LEAD's disposition this apply stages UP TO the gate-holds state and
does NOT accept. The close acts below (3/3 capture; gate evaluation; accept;
store-side acceptance-record commit) are the PARENT portfolio's close
checklist, owned by the LEAD — relocated here from the change's task list on
2026-08-20 (engine tasks-gate reconciliation). Sequencing guard (review M2):
run from the worktree BEFORE any worktree cleanup/reset.
