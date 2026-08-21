# Implementer findings for g-002 / g-003 — issue-ready-set-scheduling

Three durable findings from the apply, for the next children's planners.

## 1. (g-002) The exit-reason vocabulary is the preservation seam, and it is
## already revision-stable

`deriveIssueReadySet` (src/core/issue-status/ready-set.ts) derives exits from
`status.nodes` of the LATEST revision alone — a node removed by a newer
revision simply has no row, so "superseded exits the ready set" is already
true TODAY through lifecycle, and "old-node observations survive a re-plan" is
NOT yet true through anything: re-publication rebuilds every row from the new
revision only. g-002's preservation work therefore has exactly one place to
land: the projection's node-row assembly (or a post-pass beside lanes/delta
that carries forward rows for nodeIds the new revision dropped), NOT the
ready-set derivation. If g-002 preserves old rows inside `status.nodes`, the
ready set and every exit reason inherit the history for free — membership
stays latest-revision-wanted (dropped nodes are not `wanted` by the new
revision), while their exits keep naming them. The closed vocabulary
(`IssueReadyExit`) is the contract to extend, not a parallel structure.

## 2. (g-002/g-003) The equivalence tests are the drift tripwire — extend
## them, don't fork them

The pin-first equivalence suite (issue-ready-set-equivalence.test.ts) pins
start-candidates == ready members == confirm's fresh scope on shared fixtures,
and the pins were verified green against the UNREFACTORED code before the
refactor ran (both ends of the discipline). g-002 will touch node-row
assembly; g-003 will consume health separation + this change's exit
vocabulary. Any behavior either of them changes that moves what may run now
MUST land as new fixtures in that file (or extend deriveIssueReadySet's unit
suite) — a parallel Needs-Attention derivation that recomputes readiness
would be the third basis this portfolio existed to delete. Concretely for
g-003: the Needs-Attention aggregate should GROUP by `IssueReadyExit.kind`
(unknown/failed/blocked with named blockers is exactly the "needs attention"
partition) rather than re-derive state.

## 3. (g-003) Claimant-alias mirror pressure is now terminal-legacy-free —
## the residual is active-node visibility only

The D3 ruling makes terminal-legacy nodes read `finalized` from committed
evidence alone, so the Issue #3-style hand mirrors (run-state copied to the
claimant key to make a delivered node visible) stop being load-bearing the
moment this ships: the zero-mirror acceptance reproduction
(evidence/zero-mirror-acceptance.txt) is the proof shape. The remaining mirror
pressure on the LEAD ledger is for nodes still RUNNING on another machine: a
running node reads not-started from an unrelated directory and is ready-set
eligible (labeled honestly by the visibility line). g-003's dogfood of Issue
#4 should plan for that case explicitly — either accept the label as the
answer (the spec's stance this change pinned) or route through workspace-index
entries, which the projection already probes (locatedBy
'workspace-index') without any mirror write.

Bonus (small): `invalid-archive-record` lowers `status.complete` and blocks
the acceptance gate structurally (every status problem is a gate blocker), so
g-003's Needs-Attention view gets corrupt-evidence surfacing for free by
listing `status.problems` — no new problem plumbing needed.
