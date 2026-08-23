# Dogfood receipts — issue-deferral-record, 2026-08-23

Two sets, both captured on the build that carries this change (`pnpm run build` first; the
CLI runs `dist/`):

- **`dogfood-1..6`** — the whole deferral ring on a **hermetic temp v2 Store** (task 5.1/5.2):
  redirected `XDG_*` + `GIT_CONFIG_GLOBAL` with its own identity, node identities derived
  through `deriveChangeInstanceId`, temp tree deleted after the capture. Every block is raw
  `node bin/rasen.js` output, prefixed with the command that produced it.
- **`readonly-1..5`** — a READ-ONLY regression pass over the persistent store `issue-registry`
  (task 6.1), from this worktree's cwd.

## The ring on a temp store (tasks 5.1, 5.2)

| # | file | surface |
| --- | --- | --- |
| 1 | `dogfood-1-publish-deferral.txt` | revision 0001 (required + optional) shown, then revision 0002 published deferring `g-opt` with its reason — plus the stored `0002.yaml` bytes |
| 2 | `dogfood-2-show.txt` | `show` human: the node line, the revision delta, the gate exclusion |
| 3 | `dogfood-3-show.json` | `show --json`: the same facts machine-side |
| 4 | `dogfood-4-ready-and-start.txt` | `ready` (human + `--json`), `start --node g-opt` (human + `--json`), and the empty `git status --porcelain` after every read |
| 5 | `dogfood-5-accept.txt` | `accept`, the `accepted.yaml` bytes, and `show` after the acceptance |
| 6 | `dogfood-6-refusals.txt` | deferred-without-reason and deferred-on-an-intent-node refused, nothing written, still two revisions on disk |

What the receipts show, surface by surface:

- **Node line** (`renderStatusNode`, zero edits):
  `g-opt change app-a child-opt — not-started (deferred: postponed beyond this Issue to the next milestone)`
- **Revision delta** (generic over the widened union, zero edits):
  `~ lifecycle g-opt (optional -> deferred)`
- **Gate exclusion** (`renderGateLine`, zero edits), on the blocked evaluation and again on
  the accepted read: `- excluded g-opt (deferred): postponed beyond this Issue to the next milestone`
- **Ready exit** (the one CLI edit, `renderReadyExit`):
  `g-opt: deferred (postponed beyond this Issue to the next milestone)` — and `--json`
  `{"kind":"deferred","reason":"postponed beyond this Issue to the next milestone"}`.
  Without the new kind this node would have read `blocked` with an empty blocker list.
- **Start refusal** (the one real hole a fall-through would have opened — a deferred node
  would otherwise have received a real launch contract): exit 1,
  `issue_start_node_deferred`, `"binding": null`, message naming the node, the lifecycle,
  and the recorded reason, fix `The plan does not demand this node’s work now. Start a
  wanted node, or re-publish a revision whose lifecycle wants it.`
- **Acceptance**: `gate: 1/1 waiting-human, 0 problems standing` with
  `excluded g-opt (deferred): …` beside it, and `accepted.yaml` carrying

  ```yaml
  exclusions:
    - nodeId: g-opt
      lifecycle: deferred
      reason: postponed beyond this Issue to the next milestone
  ```

  inside the digest-covered body. The Issue reads `done` afterwards with the deferral still
  named by BOTH the frozen record and the live gate.
- **Refusals** (nothing written): `nodes[1].reason: node 'g-opt' is deferred; a deferred node
  requires a recorded reason` and `nodes[1].lifecycle: node 'i-001' is an intent node carrying
  lifecycle 'deferred'; deferred explains work that existed as a Change and stays
  Change-node-only — intent work is postponed by keeping it 'optional' or by omitting the node
  from the next revision`. `git status --porcelain` empty; `plans/` still `0001.yaml, 0002.yaml`.

The same ring is pinned as a durable suite in
`test/commands/store-issue-deferral-cli.test.ts` (real dist CLI, hermetic fixture, plus the
byte-identical writes-nothing receipt across the reads) — these files are the human-readable
capture of it, not its only witness.

## Read-only regression over `issue-registry` (task 6.1)

Captured with the store at `HEAD 3af7041e1a1f7106d122802a93acff4731ec5d30`, `git status
--porcelain` **empty before and after every capture** and HEAD unmoved — no write, no state
transition.

| # | file | Issue | phase | determination | threads |
| --- | --- | --- | --- | --- | --- |
| 1 | `readonly-1-cross-project-replanning.txt` | issue-cross-project-replanning | done | `accepted` (record 2026-08-22T12:08:55.201Z under revision 0001) | archive-pending + 2 × evidence-missing |
| 2 | `readonly-2-cross-project-replanning.json` | same, `--json` | done | same | same |
| 3 | `readonly-3-autodecompose-uplift.txt` | issue-autodecompose-uplift | done | `accepted` (record 2026-08-21T20:51:33.888Z under revision 0001) | 2 × evidence-missing |
| 4 | `readonly-4-multi-change-execution.txt` | issue-multi-change-execution | done | `accepted` (record 2026-08-20T09:46:11.369Z under revision 0001) | archive-pending + 2 × evidence-missing |
| 5 | `readonly-5-cross-project-execution.txt` | issue-cross-project-execution | done | `accepted` (record 2026-08-20T18:03:54.626Z under revision 0001) | archive-pending + 3 × evidence-missing |

Totals: `evidence-missing` ×9 and `archive-pending` ×3 — **identical to the g-002 receipts**,
with the same four acceptance timestamps and the same four `accepted` determinations. Every
pre-deferral byte reads back unchanged on the widened build: the records parse, no exclusion
is invented anywhere (`grep -c 'excluded\|deferred'` is **0** in all four human receipts —
none of these plans carries a non-required node), and the phase/health/progress values are
the ones the same evidence derived before.

**Deviation from tasks 6.1 as written**: the task names "Issue #5" (this portfolio's own
Issue). It does not exist in `issue-registry` — the store holds exactly four Issues, all
`done`, and creating/closing the Phase 6 Issue is the LEAD's portfolio-close action
(explicitly kept out of this change's tasks). The read-only pass therefore covers ALL FOUR
existing Issues rather than "Issue #5 + one earlier done Issue", which is a superset of the
regression the task asks for.
