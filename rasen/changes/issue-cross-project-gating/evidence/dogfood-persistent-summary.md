# Persistent-store dogfood summary (read-only) — `issue-registry`

Store: `issue-registry` (`Reference\rasen-issue-store`), Issue
`issue-multi-change-execution`, revision `0001`. No writes of any kind were
issued; the only commands run are `store issue show` (human + `--json`),
captured as `dogfood-persistent-human.txt` / `dogfood-persistent-json.json`.

## The revision bytes are untouched by the read

sha256 of `rasen/issues/issue-multi-change-execution/plans/0001.yaml`:

- g-001's baseline (both sides of ITS change): `477f89625a36a561ed7a5b5c42ca5aba2ae5603d3455321bc599702cdc079d66`
- this change's read:                     `477f89625a36a561ed7a5b5c42ca5aba2ae5603d3455321bc599702cdc079d66`

## The axes are the values the same evidence derived before

Diff of this change's receipts against g-001's archived after-receipts
(`dogfood-persistent-after-human.txt` / `-json.json`): ZERO axis lines —
phase (`done`), health (`healthy`), progress (`3/3`), the acceptance
gate/record lines, every node's observation/lifecycle/alias all compare
equal. The only differing lines are the `blockedBy` facts below.

## Dependencies whose work is complete stop reading as blockers

This Issue is the ground-truth cell for the basis switch: its three nodes are
all `run-terminal` (work complete), and their dependencies' Changes are not
archived-with-outcome from this read — so the OLD archive-based list kept
naming them:

Before (g-001 after-receipt):
`issue-node-lifecycle change … 2026-08-20-issue-node-lifecycle — run-terminal (blockedBy issue-plan-publication)`
`issue-persistent-baseline change … — run-terminal (blockedBy issue-node-lifecycle, issue-plan-publication)`

After (this change):
the same lines with NO `(blockedBy …)` segment — `--json` carries
`"blockedBy": []` where it carried the bare-id arrays.

That is the entire display delta on this store: work that a `start` would no
longer wait for no longer reads as a blocker, and nothing else moved. The
same-project shape of the new naming (`id@project: state`) appears on no line
here only because no blocker stands — the temp-store receipts
(`dogfood-temp/`) carry the named-blocker shapes, cross-project and same-project.
