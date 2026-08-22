# Design — issue-needs-attention

## Context

Phase 5 ends where the roadmap aimed: the operator sees, in one answer, everything across the
Store's Issues that needs a human. Every ingredient is landed truth: the tri-axis health with
its fail-fast separation (P1 — an Issue with one failed Change among running siblings reads
`active` phase + `failed` health at once), per-node observations and work-complete blocker
facts (P1/P3), the closed lifecycles (P2), the exit-reason vocabulary and the shared ready-set
derivation (g-001), and the continuity/retarget invariants (g-002). The dogfood ledger: the
persistent store `issue-registry` (Issues #1–#3 resolved, two planning members on
`line-0.2`), the Issue #3 close pattern (seed archived evidence store-side with a properly
derived v2 identity), and the P4 decompose→plan→confirm authoring path.

What does not exist: any cross-Issue aggregation, and any rule for what "needs attention"
means when health's `blocked`/`stale` are deliberately reserved and serial waits are
deliberately `healthy` — the aggregation must consume those honest vocabularies without
inventing a second health axis.

## Goals / Non-Goals

**Goals:**

- One attention derivation per Issue (projection post-pass, beside the ready set) with a
  closed item vocabulary, and the cross-Issue read verb that aggregates it.
- The unmasked failure guarantee at aggregation level — ordering, grouping, and per-item
  phase/health context, pinned by the failed-among-running receipt.
- The honesty of absence — healthy in-flight work and serial waits are not items; the scan
  summary keeps scanned-and-healthy visible; the empty state is a stated fact.
- The Issue #4 dogfood walking the full layer on the persistent store, with staged receipts
  and a staged (not assumed) close.

**Non-Goals:**

- No new health values, no new problem kinds, no change to the projection or the gate —
  attention is a consumer.
- No ready/blocked scheduling view (that is `rasen store issue ready`, g-001) and no
  critical-path rendering — attention answers "what needs a human", not "what may run".
- No UI, no watch/daemon mode, no notification delivery — a read verb.
- No Issue #4 close execution unless genuinely terminal at the implementer's hands; close
  acts live in evidence.

## Decisions

### D1 — Attention is a projection post-pass with one closed vocabulary

`deriveIssueAttention(status: IssueStatus)` in `src/core/issue-status/attention.ts`, beside
`ready-set.ts`, consuming the projection output alone — the same one-seam discipline. The
five kinds and nothing else: `failure` (wanted node observing `failed`), `blocked-behind`
(wanted not-started node with a direct dependency observing `failed`/`waiting-human`/
`unknown` — one hop; deeper chains surface because each hop is itself listed, its own
blockers named), `waiting-human` (wanted node observing `waiting-human`), `acceptance-awaiting`
(phase `review` — the acceptance is by definition the human's act, gate evaluation carried),
`problem` (every standing `IssueStatusProblem`, including g-001's `invalid-archive-record`).
Rejected: a `blocked` kind over ordinary dependency waits — that would flood the answer with
serial sequencing the health axis deliberately calls `healthy`, and it would smuggle the
reserved `blocked` health value in through a side door; the blast-radius reading
(blocked-behind trouble only) gives the replanning value — which downstream nodes are stuck
because of a failure — without the noise.

### D2 — The unmasking is structural, not decorative

Kind order `failure > blocked-behind > waiting-human > acceptance-awaiting > problem`, stable
within group by (issueId, nodeId). Every item carries its Issue's phase AND health — the
tri-axis separation consumed verbatim, so the receipt case (two siblings running, one failed)
reads `active`+`failed` on the failure item with no way to misread it as busy-but-fine.
Counts summarize but never replace items (a tally that hides items would be a new mask).
This requirement is the aggregation-level restatement of P1's health separation; the pin is
an integration receipt, not a unit tautology.

### D3 — The surface is store-level: `rasen store attention`

Registered on the `store` command tree (not under `store issue`, whose subcommands are
per-Issue or collection reads of Issue records): the aggregation is the Store-scoped fleet
read. `--issue <id>` narrows (unknown id refuses, never an empty scan); `--json` parity; the
scan composition reuses exactly the CLI status composition `show` performs per Issue
(detail → status inputs → projection), so attention and `show` cannot disagree about an
Issue's facts. The scan summary lists every Issue scanned with phase/health/item-count —
this is what makes "honestly unlisted" visible (the in-flight receipt) and what makes the
empty state say something true ("N Issues scanned, none need attention"). Locale sync
(en/ja/zh-cn) and completions follow the command-surface discipline.

### D4 — Absence discipline, stated as spec truth

"Ordinary progress is not attention" is a REQUIREMENT, not an implementation accident: the
excluded observations are enumerated (`in-flight`, `advanced`, `run-terminal`, `finalized`,
ready nodes, serial waits behind ordinary progress), the scan summary keeps scanned Issues
visible, and the empty state is explicit. This is the fence against the aggregation's natural
scope creep — every future "wouldn't it be useful to also list X" proposal must beat the
question "does X need a human NOW", and the spec now says so.

### D5 — The Issue #4 dogfood, staged at implementation

Author THIS portfolio as Issue #4 on `issue-registry` through the P4 path: a decomposition
document (three children, target lines `line-0.2`, suggested pipeline, rationale) →
`store issue plan --from-decomposition` → reviewable intent revision → `confirm`. The shipped
children (g-001 `3f065496`, g-002 `c0ace35e`) are seeded store-side from their archived
evidence with derived v2 identities (the Issue #3 close pattern; their v2 outcome records
exist — the nodes read `finalized` under the g-001 basis threading), and the revision binds
them so the plan carries two terminal nodes and one active node — this change itself, honestly
in flight where it is. Receipts captured into evidence at each stage: (1) authoring+plan
(planning→ready scan), (2) seeded-terminal children + in-flight finale (the active/healthy
honest-absence receipt — scanned, zero items unless a real signal stands), (3) a staged
failure shape on a temp-store fixture twin (failed-among-running surfacing unmasked). The
close is STAGED, not executed: acceptance conditions authored to the real criteria
(aggregation receipts captured, exit criteria evidenced, suites green), the accept step
documented, execution only if genuinely terminal at the implementer's hands (the LEAD close
precedent — the self-reference trap P2's planning context recorded: close acts live in
evidence, never in the task list). Dogfood acts touch only the persistent store (store-side
commits); the repo's planning roots are untouched by them.

### D6 — The P5 exit-criteria evidence set

Roadmap §8's three receipts land in this change's evidence directory: replanning-preserves-
history (referencing g-002's shipped pins — already landed truth, cited not recreated),
failure-not-masked (the D2 receipt + integration test), and the aggregation entry (the D5
receipts). The portfolio's close summary then reads §8 satisfied from one place.

## Risks / Trade-offs

- [Scan cost over many Issues] → Each Issue is one projection (reads its revision + evidence
  + run-state probes) — the same cost as `show` per Issue, paid once per scan. No caching
  layer: a cached attention answer would be a second mutable truth, the exact thing the
  layer refuses. If fleet scale ever demands it, that is a new capability with its own
  invalidation truth.
- [blocked-behind is one hop, not transitive] → Deliberate: each hop in a stuck chain is
  itself listed with its own named blockers, so the chain reads through the listing without a
  graph-walk in the derivation; a transitive closure would blur which node directly waits on
  the trouble.
- [The dogfood touches the persistent store] → Staged and receipted per D5; every act is a
  store-side commit of Issue content (the store's own discipline), the repo untouched; the
  close is executed only from a genuinely terminal state, else staged with documentation.
- [`acceptance-awaiting` overlaps the gate's blockers] → A review-phase Issue whose gate does
  not hold carries its blockers in the item — those blockers are usually also node items
  (failure/problem). The duplication is honest (two views of one fact), and the item's
  carried gate summary names the acceptance as blocked rather than silently omitting it.

## Migration Plan

None: an additive read surface and derivation; no stored-format change; rollback is revert.
The persistent store gains Issue #4 content through the dogfood's store-side commits only.

## Open Questions

None blocking. Phase 6 inherits: the claimant-alias keying ledger item (still open, per the
g-001 findings), the deferred pinned-confirmation anchor, and the foreign-repo workspace
follow-ups — all recorded in the portfolio planning context, none blocking the finale.
