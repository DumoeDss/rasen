# Design: issue-status-projection

## Context

The Issue layer's foundations already exist and are verified: `store-issue-resources` (Issue
records, immutable ordinally-addressed Execution Plan revisions, reference verification against
committed Store evidence), `store-aggregate-query` (the read surface: `listIssues`, `showIssue`,
`resolveExecutionPlan` with per-node reference resolution and a committed-evidence readiness
derivation), and `store-planning-layout-v2` (Store-level Issue addresses). What does not exist
is any answer to "where is this Issue right now": the Issue record's state is operator-declared
(`open|resolved|dropped`), and the per-Change run-state (`auto-run.json`, `portfolio-run.json`
— the same records `rasen pipeline resume` consumes) is never connected to the Issue.

This change is child 1 of the `issue-layer-phase1` portfolio. Children 2 (`issue-execution-binding`)
and 3 (`issue-acceptance-close`) build on the projection delivered here, so its contract must be
honest about what is derivable today and what is reserved for them.

Real inputs observed in this worktree (the dogfood material): the portfolio's own
`.rasen/changes/issue-layer-phase1/ephemera/portfolio-run.json` (three `small-feature` children,
serial `dependsOn`, g-001 `in_progress`) and each child's
`.rasen/changes/<child>/ephemera/auto-run.json` (e.g. `propose: in_progress` with a recorded
planner worker).

## Goals / Non-Goals

**Goals:**

- Derive the tri-axis status (phase × health × progress) for one Store Issue from its latest
  plan revision + committed Store evidence + real Change run-state, on demand, read-only.
- Surface it on the existing `rasen store issue list` / `show` CLI in both human and JSON forms.
- Locate run-state exactly the way `pipeline resume` does (same sticky-legacy chain), so the
  projection and resume can never disagree about where a Change's state lives.
- Dogfood the projection on the portfolio itself with real receipts.

**Non-Goals:**

- No web UI, no management-api routes, no board (CLI-first golden path).
- No execution binding or run launching (g-002), no acceptance gate or Done-by-acceptance (g-003).
- No cross-project or multi-worktree run-state location beyond the current execution root.
- No persistence of derived status anywhere; no changes to Issue mutation semantics.
- No modification of `src/core/pipeline-registry/` content (frozen for this session; imported only).

## Decisions

### D1 — A new core module `src/core/issue-status/`, not an extension of the store query

The projection composes two worlds: the Store's committed evidence (portable, authoritative) and
machine-local run-state (ephemeral, keyed by change name, on whatever root executed the work).
`store-aggregate-query`'s contract is store-pure — "every answer SHALL come from the Store's own
durable content" — so folding run-state into it would violate that spec. `src/core/store/` also
never imports `src/core/pipeline-registry/` today, and the run-state readers
(`readRunStateDetailed`, `parsePortfolioState`, `resolveRunStateLocation`,
`resolvePortfolioStateLocation`) live there. A new top-level module
(`src/core/issue-status/{types,projection,index}.ts`) keeps both boundaries intact and gives
children 2–3 a stable seam to import. Alternative rejected: computing status inside
`src/commands/store-issue.ts` — commands are thin adapters here, and the derivation table
deserves core-level tests.

### D2 — The projection takes explicit inputs; the CLI resolves the machine-local ones

```ts
projectIssueStatus(input: {
  detail: IssueDetail;            // from StoreAggregateQuery.showIssue
  executionRoot?: string;         // absent => run-state visibility: none
  changesDir?: string;            // planning-home changes dir (legacy chain tail)
  workDirFor?(alias): Promise<string | null>;  // default resolveChangeWorkDir(…, {ensure:false})
}): IssueStatus
```

Given the same inputs the result is identical — no ambient reads inside the module, which keeps
the derivation table unit-testable and satisfies the planning-addresses discipline. The command
layer resolves `executionRoot` best-effort (`resolvedExecutionProjectRoot` over the resolved
root; failure degrades to visibility-none rather than failing the store-scoped command).

### D3 — Run-state location mirrors `pipeline resume` exactly, keyed by committed alias

Per node, the locator builds the same `StateFileLocationOptions` resume builds
(`src/commands/pipeline.ts` `resume()`): `ephemeraDir(executionRoot, name)` first, then
`resolveChangeWorkDir(executionRoot, name, { ensure: false })`, then the planning change
directory — then `resolveRunStateLocation` / `resolvePortfolioStateLocation` walk that chain.
The change NAME is the committed claimant's `changeId` from the node's resolution, falling back
to `node.changeAlias`; the committed evidence's alias is preferred because `changeAlias` on the
node is recorded human convenience (the same reasoning `references.ts` applies). A reference the
query did not resolve keys by the node's recorded alias only — no claimant is chosen on its
behalf. Lookup is by explicit alias per node — no directory pattern matching.

### D4 — `portfolio-run.json` where present is authoritative for that node's progression

Mirroring resume's authority rule (portfolio record authoritative for a decomposed parent;
per-change `auto-run.json` otherwise). Mapping table from a node's recorded run-state to its
observed execution state:

| recorded signal (portfolio first, else stages) | observation |
| --- | --- |
| archived with committed outcome (committed evidence) | `finalized` |
| any child `in_progress` / any stage `in_progress` | `in-flight` |
| any child `escalated` or delivery `escalated` | `failed` |
| any stage `escalated` | `waiting-human` |
| all children done\|skipped AND delivery `done`\|`skipped`; or all stages done\|skipped | `run-terminal` |
| ≥1 done/skipped stage or child, none in flight, not all terminal | `advanced` |
| no run-state found, not finalized | `not-started` |
| reference unresolved/ambiguous, or run-state present but invalid, or unsearched refs | `unknown` |

Stage/child terminality follows the documented run-state contract (`done | skipped` complete;
`delegated` is parent-stage-only and does not appear in child stage lists). The portfolio row's
delivery clause reuses the portfolio module's own `isPortfolioComplete` contract (delivery `done`
or `skipped`) rather than re-deriving a narrower rule here — one terminality authority, not two.

### D5 — Phase and health derivation

Phase precedence `done > review > active > ready > planning`:

- `done` — Issue record state is `resolved`. Operator-declared only; g-003 replaces this with the
  acceptance gate. Archived nodes alone never produce `done` (direction: "Done ≠ 所有 Change archived").
- `review` — plan readable, ≥1 node, every node `finalized | run-terminal`, no intent node left,
  record still open.
- `active` — any node `in-flight | advanced | run-terminal (not all) | waiting-human | failed`,
  and also any node `unknown`: a located-but-unreadable run-state or a reference that broke after
  publication is activity-adjacent trouble (the graph reached execution and hit it), while
  `planning` keeps meaning "no readable plan" — the unreadable-plan case, derived independently
  of any node's observation. The phase derives from the OBSERVATION, never from the unreadable
  bytes.
- `ready` — ≥1 change-kind node and every node `not-started`.
- `planning` — no revision, latest revision unreadable (problem reported), zero nodes, or all
  nodes are intents and none has started (goal.md §7 principle 2 requires a runnable node for
  `ready`).

Health precedence `failed > waiting-human > healthy`, plus `review ⇒ waiting-human`:

- `failed` — any node `failed`: the run-state writer's documented meaning for child/delivery
  escalation is failure ("On child failure … escalate the open frontier"; "`escalated` means
  failed delivery needing attention" — LEAD playbook Step D.5/D.7).
- `waiting-human` — any node `waiting-human` (a stage parked as escalated is "a decision for
  the human" — playbook Step H.6), or phase `review` (goal.md §7: implementation complete,
  PR unmerged / acceptance pending ⇒ `Review` + `Waiting Human`).
- `healthy` — otherwise. Serial dependency ordering is sequencing, not sickness.
- `blocked` / `stale` — reserved: no durable signal exists for either today (goal-loop stall
  counters are goal-loop-internal; staleness would need a threshold policy). The closed
  vocabulary ships complete; the derivation emits a value only when a recorded signal supports
  it. g-002/g-003 extend this table when they record real signals.

### D6 — Progress and the unreadable-plan rule

`progress = { completed, total }` over the latest readable revision; `total` = node count,
`completed` = nodes observed `finalized | run-terminal`. Finished-but-unarchived counts (progress
measures work, not archiving); finalizing later does not change the count. An unreadable latest
revision yields `progress: null` with the reason — `0/0` would read "nothing required".

### D7 — Unknown observations and status problems mirror the aggregate-problem discipline

Invalid run-state, unresolved/ambiguous references, and unsearched refs surface as
`statusProblems[]` entries (kind, node, path/ref, reason) on the status object. The `complete`
flag carried from the underlying `IssueDetail` is lowered further only by projection-local
failures to read what was reached — an invalid run-state or an unreadable plan.
Reported-but-honest answers do not lower it: an unresolved or ambiguous reference is a reported
fact, not a failed read, the same split the aggregate query makes between an unreadable item and
a reported one. Unsearched refs lower the carried flag at the query layer already. Nothing is
dropped for being broken and nothing is guessed from unreadable bytes — the same fail-closed
read philosophy the query module states.

### D8 — CLI surface: enrich the existing commands, no new subcommand

`list` gains a `phase/health completed/total` segment per line; `show` gains a status block
(axes, per-node line: `nodeId kind alias — observation (blockedBy …, diagnostic …)`); JSON gains
an additive `status` object (`{ phase, health, progress, nodes[], problems[], runStateVisibility }`).
A separate `issue status` subcommand was considered and rejected: it would duplicate the show
surface without a new capability. No new options ⇒ no locale changes; renderers stay
English-literal like the rest of `store-issue.ts`. `list` resolves each issue's plan
(N `resolveExecutionPlan` calls) — acceptable at single-project scale, noted in Risks.

### D9 — Engine-ownership caveat stays visible

Where a run-state declares `engine.effective: 'reconciler'`, its stage statuses are labeled
projections beside a canonical Run (the run-state contract's own wording). g-001 reads them as
recorded — they are the observable contract this projection owns — and design notes the boundary:
canonical-Run-derived status belongs to g-002's binding work. Today's portfolio children
declare no engine, so the dogfood exercises the plain legacy contract.

### D10 — The dogfood: this portfolio as Issue #1, in a real store inside the worktree

1. `store setup issue-layer-dogfood --path <worktree>/.rasen/dogfood/store --init-git`
   (untracked area; zero impact on the branch), then declare layout v2 — via
   `store migrate-layout` if it accepts a fresh store, else by writing the documented
   `layoutVersion: 2` declaration, the same line the fixtures and `layout-migration/apply.ts`
   write.
2. `store add-project <worktree> --to issue-layer-dogfood` (membership only; no planning move —
   `adopt` is deliberately NOT used mid-portfolio) and `store target-line add|set-ref`.
3. Author the three child Changes in the store (`new change <child> --store issue-layer-dogfood`
   scaffolds into the project partition with portable v2 identity); commit them in the store.
   Fallback if store-scoped scaffolding refuses without adopted planning: copy the three child
   directories by explicit list and seed identity blocks, the shape `seedChange` builds.
4. `store issue new issue-layer-phase1 --title …`; read status → `planning` (receipt).
5. `store issue plan … --from-file` naming the three committed Change instances; read status
   from the worktree → `active/healthy 0/3` with child 1 `in-flight` from the live
   `auto-run.json` — the real transition, captured as receipts in `evidence/`.
6. During verify, re-read after stage transitions to show the projection tracking the live run.
   The store is a real git-backed Store; its registry entry is removed afterward
   (`store remove`) with the receipts preserved, keeping the global registry clean.

## Risks / Trade-offs

- [List cost grows with issues × plan resolution] → acceptable at the single-project scale this
  slice targets; if it matters later, batch plan resolution inside one query context.
- [Current-execution-root lookup is alias-keyed; two projects could share one alias in one root]
  → out of the single-issue/single-project fence for this slice; recorded as a known boundary
  for g-002's binding work (the workspace-index locator widens it without changing semantics).
- [Reconciler-engine runs record stage statuses as bookkeeping] → status reports what the
  run-state records; the caveat is documented (D9) and g-002 owns the canonical-Run binding.
- [Health vocabulary ships with reserved values] → deliberate: fabricating `blocked`/`stale`
  without a recorded signal would be the dishonest version of this feature; the spec states the
  reservation as contract.
- [Dogfood store setup hits undocumented edges (fresh-store layout declaration, store-scoped
  scaffolding)] → both steps have named fallbacks (D10); whichever path is taken is recorded in
  the evidence receipts, and a failure to complete the dogfood blocks ship per the
  anti-theater rules.

## Migration Plan

None needed: the change is additive and read-only (new module, enriched renderers, additive JSON
fields). Rollback is reverting the commit; no data shape changes anywhere.

## Open Questions

None blocking. Two are inherited by siblings by design: which signal graduates `blocked`/`stale`
(g-002+), and when the management API gains a status route (post-portfolio, when a board needs it).
