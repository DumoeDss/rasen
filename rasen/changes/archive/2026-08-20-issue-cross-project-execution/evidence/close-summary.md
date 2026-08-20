# Portfolio close — issue-cross-project-execution (LEAD, 2026-08-21)

Delivery: PR #172 MERGED (merge `4bac13d7`, CI first-run all-green). Legs 1–3 executed with receipts (archived entry seeded store-side `7038943`; revision 0002 published `2583bf8` promoting the intent node; site node driven GENUINELY terminal in rasen-site main `2dc9e31` — real docs work, real build verification, honest run-state with two recorded openFindings).

## Leg 4 (accept) — DEFERRED to the Phase-4 seam fix, by LEAD disposition

The gate cannot fire honestly from any single root: the workspace-pair machinery REFUSES
the main-checkout execution root (`execution-root-outside-repository`) while the SAME
plan's sibling precondition blesses it ("the project repository's main checkout, which a
pair may legitimately use for execution") — an internal contradiction rooted in
`isContainedIn` counting equality as inside (receipts: close-workspace-pair-refusal.json,
close-workspace-pair-note.txt). Both children ARE terminal, each observable from its own
execution root (close-final-worktree-show.txt + close-site-terminal-show.txt); the
aggregate gap is a locator-scope fact, not a work-state fact.

Disposition: NO forcing (no hand-assembled index markers — the resolver-blessed surface
was identified and deliberately left untouched), NO unreviewed product hotfix. The
one-case containment fix (equality ≠ inside when main-checkout reuse is blessed) is
queued as the FIRST Phase-4 child; Issue #2's accept executes after it lands and is that
fix's real acceptance test. Issue #2 stands at its honest 3/4 with the full two-root
evidence chain.
