# Issue #3 dogfood — review, revise, confirm (g-003, 2026-08-21)

The review half of the dispatch loop, dogfooded on this portfolio's own Issue
`issue-autodecompose-uplift` (persistent store `issue-registry`). Every store
write below is LEAD-coordinated; confirm wrote nothing; NO `store issue start`
and NO close/accept act was executed — the starts are staged as documentation
only, per the portfolio plan.

## 1. Seed (store commit 8c65d14)

`rasen/changes/archive/2026-08-21-issue-autodecompose-graph/` (repo archive
tip 15b60a63, ship 6b00f24d) copied into
`rasen/projects/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/changes/archive/line-0.2/`
with a fresh v2 identity authored in `.openspec.yaml`:

- instanceSeed `eb0e56c174b68d7dce27251ed678969d` (freshly minted)
- instanceId `ci_96db06e16c62383fc2c4218874cb00e6e2a93a9b3c5415206bb8c568d267ab42`
- storeUid `f76edc31-229a-42bc-a5c7-848021eeb2da`, project
  `e2ee72ed-04a1-4395-86aa-7e77d2b83ec7`, line `line-0.2`

Committed pathspec-scoped on store `main`:
`chore(store): seed issue-autodecompose-graph archived evidence (g-003, repo
archive 15b60a63)` (28 files, LF blobs). This is the committed Store evidence
revision 0003's Change node binds to.

## 2. Revision 0003 (authored `--from-file`; store working tree, uncommitted)

Source: `evidence/issue-3-revision-0003-nodes.yaml`. Publish receipt:
`dogfood-issue3-publish-human-0003.txt` (supersedes 0002, 2 nodes).

Node decisions, each exercising the revision vocabulary this change built:

- `issue-autodecompose-graph`: intent -> **change**, bound to the seeded
  instance (alias `issue-autodecompose-graph`, dependsOn `[]`), keeping its
  `small-feature` suggestion and a rationale naming the promotion.
- `issue-autodecompose-review-flow`: stays **intent**, lifecycle authored
  **explicitly `required`**. LEAD decision recorded here: semantic honesty
  over receipt visibility — the canonical stored form omits `required`
  (absent = required, the digest discipline), so the explicit marking is a
  fact of the authored review act and does NOT surface as a lifecycle-changed
  line in the delta report; we mark it anyway because the review surface is
  where required/optional marking belongs (D1), and the confirm receipt's
  pending-Change report still materializes `lifecycle: required`.
- The dependency edge `review-flow -> graph` is dropped (the graph child's
  work shipped and archived — nothing waits on it).
- 0002's `uncertainty` (whether `start` adopts the recorded suggestion) is
  replaced by a `rationale` naming the adopted answer (D2: flag > run-state >
  suggestion, contract names the source).

## 3. Delta receipt (`dogfood-issue3-show-human-0003.txt` / `-json-0003.json`)

`revision delta: 0003 over 0002` reports exactly the authored changes:

- `~ edges issue-autodecompose-review-flow (-issue-autodecompose-graph)` —
  the one edge change; added/removed/retargeted/lifecycle/suggestion lists
  all empty, both forms agreeing.
- The kind flip shows on the NODE LINES: the graph node renders as
  `change ... 2026-08-21-issue-autodecompose-graph` (its archive entry),
  the review-flow node as `intent` — the delta vocabulary intentionally has
  no kind-change entry; the node lines are where kind is read.
- No lifecycle-changed line, by the canonical omission explained above.

## 4. Confirm, dual-root (`dogfood-issue3-confirm-store-root.{txt,json}`, `dogfood-issue3-confirm-worktree.txt`)

`rasen store issue confirm issue-autodecompose-uplift --store issue-registry`
run from BOTH the store root and the execution worktree. Both receipts:

- compose ONE launch contract for the graph node — `mode: fresh`,
  `pipeline: small-feature`, `pipelineSource: suggestion` — the D2 chain
  adopting the recorded suggestion in the wild;
- report the review-flow intent node as pending Change creation
  (project/line/summary/suggestion, `lifecycle: required`);
- close with "wrote nothing".

Honest divergence from the plan's expectation: the plan anticipated the
worktree-side read to find the node in-flight and compose a resume-oriented
contract. It did not, for two reasons the receipts make plain: (a) the seeded
archive is a legacy v1 record (no `schemaVersion: 2`), so the committed
evidence carries no outcome and the node does not read finalized; (b) no
run-state file exists for the alias in either root's search chain — the
g-002 child's execution history is carried by the committed archive and this
portfolio's own bookkeeping, not by a `store issue start` state file. Both
roots therefore composed the same fresh, suggestion-sourced contract. The
binding resolved `project-checkout` (main checkout, store-attached) from
both roots — the workspace-index entry is root-independent here.

## 5. Staged starts — documentation only, NOT executed

Per the playbook's post-confirmation continuation, the confirmed frontier
would be driven as:

1. `rasen store issue start issue-autodecompose-uplift --store issue-registry
   --node issue-autodecompose-graph` — the contract above (fresh,
   suggestion-sourced `small-feature`, project-checkout binding).

It is deliberately not executed: the graph child already shipped and archived
(its "start" is history, and the fresh read is an artifact of the legacy
seed record lacking a v2 outcome — surfaced here rather than hidden); the
review-flow node is pending Change creation, and its work is THIS change,
already in flight as the repo-side change `issue-autodecompose-review-flow`.
No close or accept act appears anywhere in this dogfood; the Issue stays
`open` at revision 0003 for the portfolio ledger to close through the
acceptance flow when Phase 4's completion evidence is judged.
