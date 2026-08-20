# Staged close — issue-cross-project-execution (Issue #2)

The release-and-accept legs are close steps sequenced by the portfolio LEAD,
never engine task checkboxes (the Phase-2 close precedent,
`archive/2026-08-20-issue-multi-change-execution/evidence/close-summary.md`).
This document names each remaining leg exactly, in order, with its receipts
to capture at execution time. No acceptance happens unless every node is
genuinely terminal at hand — the gate fail-closes until then, so the close
cannot silently skip the promotion.

## Where the Issue stands at g-003 apply completion (2026-08-20)

- Plan `0001` (digest `efaf70ef…`): 4 nodes, 2 lanes. rasen lane `2/2`
  (`issue-target-project-binding`, `issue-cross-project-gating` —
  run-terminal via the dated-alias machine-local mirrors); site lane `0/1`
  (`document-multi-project-issues` — not-started, gated on the intent node).
- `issue-project-grouped-views` is an INTENT node in `0001` because a change
  node requires committed Store evidence and this change could not be
  committed before it shipped. Receipts:
  `dogfood-issue2-3-show-lanes.txt`, `dogfood-issue2-4-list-summary.txt`,
  `dogfood-issue2-6-gating-refusal.json` (the cross-project refusal naming
  `issue-project-grouped-views@<rasen> (not-started, no local run-state)`).

## Leg 1 — store bookkeeping for this change commits

After `issue-project-grouped-views` ships and its planning content is
committed to the repo branch, seed this change's committed Store evidence in
the rasen partition (the `seed-children.mjs` discipline, one fresh
instanceSeed) — or record it as the archived entry once the repo archive
lands. Until then the intent node truthfully reads not-started.

## Leg 2 — revision 0002 promotes the intent node to a change node

`0001`'s bytes never move. Author a nodes file identical to `0001` except the
`issue-project-grouped-views` node: `kind: change`, the seeded/committed
`changeInstanceId`, `changeAlias: issue-project-grouped-views`. Publish with:

    node bin/rasen.js store issue plan issue-cross-project-execution \
      --store issue-registry --from-file <revision-0002-nodes.yaml>

Capture the publication receipt (revision `0002`, supersedes `0001`). The
lane pairs re-derive unchanged (rasen `3/3` once this change's evidence reads
terminal, site still gated). Receipt name: `close-revision-0002.json`.

## Leg 3 — the site node's gate releases; drive it terminal from the site checkout

With the promoted node's work terminal (this change shipped), the
cross-project gate releases `document-multi-project-issues`. Drive the site
node's REAL pipeline run from the site's checkout (the launch contract
`resolveSessionLaunchContext` composes: cwd = the site repo, store planning
root attached) or the store workspace pair — the docs page
(`docs/issues.md` + the docs-area link) is authored and shipped there.
Capture the refusal-then-release pair beside
`dogfood-issue2-6-gating-refusal.json`: `close-site-release.txt`.

## Leg 4 — acceptance gate-holds, then accept

Publish conditions (`close-acceptance-conditions.json`), capture the
gate-holds receipt while any node is un-terminal
(`close-gate-holds.json` — expected blockers name the un-terminal nodes),
then, with every node genuinely terminal:

    node bin/rasen.js store issue acceptance issue-cross-project-execution \
      --store issue-registry --from-file <conditions.yaml>
    node bin/rasen.js store issue accept issue-cross-project-execution \
      --store issue-registry --note "Phase 3 cross-project execution verified"

Capture the accept receipt (`close-accept.json`) and the final `done/healthy`
show (`close-final-done.json`). Commit the store's issue content per the
suggested pathspecs at each write.
