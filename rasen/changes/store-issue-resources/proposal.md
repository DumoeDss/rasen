## Why

A Store is now a planning space with project partitions, target lines, and prepared planning
worktrees — but it has no way to express work that spans several of its projects. The only durable
planning unit is a Change, and a Change belongs to exactly one project and one target line. Anything
cross-cutting lives outside the Store entirely, as prose in someone's notes, so nothing can verify
that the Changes it names actually exist, nothing can report what still references it, and nothing
can tell whether the plan being executed is the plan that was agreed.

This change adds the Store Issue: a small, repo-blind statement of intent that lives at the Store
level, plus immutable Execution Plan revisions that reference already-committed Changes and are
verified against the Store's own evidence rather than trusted. It also adds the read side those
resources need — one aggregate query surface, because an Issue is only useful if you can ask what
references what.

It is the last of the three changes in this portfolio and the outcome the whole workstream was named
for.

## What Changes

- Add the **Store Issue** as a first-class planning resource: a minimal, repo-blind record carrying
  the intent, its state, and nothing about any repository. Creating one, setting its state, and
  publishing a plan for it are the only three ways it changes.
- Add **immutable Execution Plan revisions**. A revision is never edited: publishing produces the
  next revision, addressed by a canonical zero-padded ordinal so "which is latest" is answerable
  without opening every file. Each revision carries a content digest over its own canonical form, and
  reading a revision verifies that digest rather than trusting it.
- **Verify plan references against committed Store evidence.** A plan node that names a Change is
  accepted only when that Change is actually present and committed in the Store; a node naming
  something absent, uncommitted, or belonging elsewhere is refused with the reason named. A plan is
  never published against evidence that does not exist.
- Normalize and check the plan **graph**: nodes are normalized to one canonical form so two spellings
  of one plan are one plan, duplicates are rejected rather than merged, and a dependency cycle or a
  dangling reference is refused rather than stored.
- Add the **Issue lock**, one serializer for all Issue mutation, so two concurrent publications cannot
  interleave into a revision sequence with a gap or a duplicate.
- Add **one aggregate read surface** over the Store: list and show Issues, ask which Issues reference a
  given Change, resolve an Issue's current Execution Plan, and list the Store's projects, target
  lines, and Changes grouped by both. **A mutation refuses; a query reports** — the read surface never
  mutates, never takes a lock, and never fails closed on a partially inconsistent Store: it reports
  what it found and what it could not read.
- Add **Store Issue addresses to layout v2**: an Issue directory, its record, its revisions directory,
  and one revision file are each their own address, so no caller composes a filename onto a returned
  directory. Issue addresses are Store-level — computing one takes no project and no target line —
  and Issue content is never a valid project-planning address. Issue identifiers satisfy the same
  portable canonical path-segment rules a project identifier satisfies, and a revision identifier is a
  canonical zero-padded ordinal that rejects an unpadded, differently padded, or zero value.
- Add the `rasen store issue` command group plus the two top-level `rasen store changes` / `rasen store projects` reads — deliberately siblings under `store`, NOT a `store aggregate` group (see the doc comment in `src/commands/store-aggregate.ts` and tasks 4.1/4.2) — each with a machine-readable
  form whose content matches the human form.
- Serve the same reads over the management HTTP API and surface them in the operations UI as a
  Store-scoped Issue view and an aggregate board grouped by project and target line. A Store-scoped
  mutation submitted from any of these surfaces **requires its complete scope and never infers one**.

**Deliberately not ported, with evidence** (see design.md):

- The **coordinator migration compiler** and its batch Issue-lock acquisition. On the reference line
  these arrived in a separate, later change — the coordinator bridge — together with their own test
  suite. They belong to that roadmap slice, not to this one, and excluding them leaves no code
  untested and no test orphaned.
- The **scope-routing** requirement the reference change also carried. That capability does not exist
  on this line.
- `test/core/store/store-issue-scope-intent.test.ts` (7 cases). It drives `issues/scope.ts` only
  indirectly, through `StorePlanning.open({ intent: 'store-issue' })`, and its fixture imports
  `finalization/**` on top of `store-planning/**` — both a later roadmap slice. The file is deferred,
  not dropped: `issues/scope.ts`'s own behaviour ships with finalization-free substitute coverage
  authored in this change (`test/core/store/store-issue-scope.test.ts`), and the deferred file itself
  is handed forward as an **inbound acceptance item for the finalization slice** — alongside
  `membership-layout.ts`, the item this portfolio's second change (`store-worktree-bindings-v2`) handed
  forward to the layout-migration slice for the same reason: a real production consumer graph that
  belongs to a later roadmap slice, not this one.

## Capabilities

### New Capabilities

- `store-issue-resources`: the repo-blind Issue record and its states, immutable Execution Plan
  revisions and their canonical ordinals and digests, plan-node normalization and graph checking,
  reference verification against committed Store evidence, the single Issue lock, and the three-method
  mutation surface.
- `store-aggregate-query`: one Store-wide read surface — Issues, Issue references, resolved Execution
  Plans, projects, target lines, and Changes grouped by project and target line — that reports rather
  than refuses, takes no lock, and mutates nothing.

### Modified Capabilities

- `store-planning-layout-v2`: adds the Store-level Issue and Execution Plan revision addresses and
  their portable identifier rules. This is the portion the portfolio's first change deliberately left
  to this one, and it is purely additive: no existing layout address changes.
- `management-http-api`: adds the Store aggregate read paths and the rule that a Store-scoped project
  mutation carries its complete scope. Purely additive; no existing endpoint changes.
- `board-ui`: adds the layout v2 grouped board, the cross-project Issue view, and the rule that an
  aggregate view never submits an incomplete scope. Purely additive.
- `management-ui-shell`: adds the rule that Store-scoped calls address their Store by stable identity
  through the existing client seam. Purely additive.

## Impact

- **Adds** `src/core/store/issues/**` (11 files) and `src/core/store/query/**` (7 files) as one unit —
  they have a genuine bidirectional import cycle and cannot be separated — built on the planning
  contract and the workspace bindings this portfolio's first two changes landed.
- **Adds** `rasen store issue`, `rasen store changes` and `rasen store projects` to the command tree, the completion
  registry, and all three locale trees in lockstep.
- **Adds, additively,** Store aggregate read paths to the management API router and its wire types,
  with the UI's mirror of those types moved in the same step, and two operations-UI components.
- **Extends** the layout resolver with the four Store-level Issue addresses and the two identifier
  validators the portfolio's first change deferred to here.
- **Adds** Issue record, plan revision, digest, lock, graph, reference-verification, layout, and
  read-only-guard suites, two command suites, and the UI suites — which need the UI package's own
  test runner, since the root runner excludes that package.
- **No** new runtime dependency, no change to Store registration, membership, root selection, archive
  behavior, or any existing management-API endpoint.
- **Completes** the `store-v2-foundation` slice; the portfolio delivers as one pull request after this
  change is terminal.
