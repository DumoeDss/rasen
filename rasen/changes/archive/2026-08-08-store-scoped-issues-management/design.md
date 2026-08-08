## Context

Layout v2 states two rules that only make sense together. Every ordinary Change has exactly one project owner, and a Change with no project owner cannot be created. Taken alone the first is a containment rule and the second is a completeness rule; taken together they mean that any work spanning two projects has no representation at all — not a Change with two owners, not an ownerless Change, and not a shared flat directory, which §16 of the accepted design forbids reinstating "for convenience".

The design's answer is one sentence in §9.3: a Store Issue points at `Change A: project=elftia, targetLine=line-0.2`, `Change B: project=rocut, targetLine=main`, `Change C: project=elftia-website, targetLine=main`, "每个 Change 独立验证、归档和合并；Issue 根据依赖图决定何时完成". Around that sentence sit three more commitments: `rasen/issues/<issueId>/` in the §4 layout tree, `{ kind: "issue" }` and `{ kind: "execution-plan" }` in the §6 `PlanningAddress` union, and `StoreQueryModule` in the §13 Module table with "typed query methods" as its whole public surface. What the design never says is what an Issue record contains, what an Execution Plan *is* as opposed to what it references, which Git ref an Issue lives on when it spans several, or how a reference is resolved to a Change that exists only on an unmerged planning branch. Those four silences are this slice's real work.

Three concrete facts in the tree set its shape. `src/core/store/planning-layout-v2.ts` has nine address kinds and none of them is an Issue, so there is currently no way to compute an Issue path that is containment-checked rather than joined by a caller. `src/core/management-api/project-space.ts` refuses a Store v2 aggregate with `project_scope_required`, which is child 2's canonical rule working exactly as intended and leaving the management board for a migrated Store rendering an error — the refusal is correct and the surface it was supposed to defer to does not exist. And `src/core/store-planning/types.ts` exposes `StoreReadAddress` with two kinds, `store-metadata` and `store-design-docs`, which is the entire Store-level vocabulary a caller can address today.

This is the sixth slice in a serial portfolio. It owns no path model, no identity derivation, no worktree, and no finalization. It is the first slice whose subject is a *relationship between* Changes rather than a Change, and it is the last slice before the compatibility sweep.

## Goals / Non-Goals

**Goals:**

- Give cross-project work a home that does not require a Change to have two owners or none.
- Make the Issue-to-Change edge a reference to a portable identity, verified against real Store evidence at the moment it is written, and resolvable afterwards without parsing a path or a branch name.
- Make grouping by project and target line a structural property of a query result rather than something a caller reconstructs.
- Report the unknown as unknown: an unresolvable reference, a divergent record, and an unreadable ref are three distinct reported states, and no aggregate ever presents a partial answer as a total one.
- Refuse a project mutation whose scope is incomplete, on every surface, without ever completing it from a filter.
- Add exactly one lock key and leave child 4's ordering argument valid unchanged.

**Non-Goals:**

- Any Git write. No worktree, no branch, no merge, no fetch, no push, no staging. Aggregation reads blobs.
- Any spec write. Canonical specs change only in a landed finalization, which is child 5's; aggregation reads Archive records as data and replays nothing.
- Producing, upgrading, or repairing an Archive record, a target-line catalog, a project catalog, a workspace plan, or a Change's `.openspec.yaml`.
- Finalizing a Change, or offering any second route to it. `store-finalization-outcomes-v2` has landed and retired `store_v2_finalization_unavailable`, so finalization is now *available* — but it stays reachable only through that Module's own plan/apply and its `finalize-change` surfaces. Nothing here declares an outcome, proves a landed commit, or writes an Archive record.
- A persisted aggregate index or cache (decision 8), a forge adapter, or any network access.
- Read-caller migration, doctor/CI literal-path and layout-consistency gates, documentation reconciliation, and the portfolio acceptance matrix — all child 7's.

## Decisions

### 1. An Issue is intent; an Execution Plan revision is the graph; the pairing is what makes revisions cheap

```text
rasen/issues/<issueId>/
  issue.yaml                 stable identity, title, operator-declared state
  README.md                  optional narrative, never parsed for facts
  plans/
    0001.yaml                immutable revision
    0002.yaml                immutable revision, supersedes 0001
```

The Issue record is deliberately small:

```yaml
version: 1
id: cross-line-telemetry
title: Unify telemetry across the three shipped surfaces
state: open              # open | resolved | dropped
reason: null             # required for dropped
createdAt: 2026-08-07T00:00:00.000Z
```

It carries no `storeUid`, no project list, no node list, and no `latestRevision`. Each of those is either derivable or already owned elsewhere, and the portfolio has paid twice for a second source of truth. It follows child 1's catalog conventions exactly — versioned, strict, filename agrees with the id, no machine paths, no credentials, unknown fields rejected — so an Issue record validates through the same discipline `projects/<id>.yaml` and `target-lines/<id>.yaml` already do, including the rule that the containing directory name must equal the id.

An Execution Plan revision holds everything that moves:

```yaml
version: 1
issueId: cross-line-telemetry
revisionId: "0002"
supersedes: "0001"
createdAt: 2026-08-07T00:00:00.000Z
nodes:
  - nodeId: elftia-emit
    kind: change
    projectId: elftia
    targetLineId: line-0.2
    changeInstanceId: ci_...
    changeAlias: telemetry-emit     # human convenience, never resolved by
    dependsOn: []
  - nodeId: rocut-consume
    kind: intent
    projectId: rocut
    targetLineId: main
    summary: Consume the unified event shape
    dependsOn: [elftia-emit]
```

Splitting the two is what makes immutability affordable. If the graph lived in `issue.yaml`, every edit would rewrite the identity record, and "what did we think the plan was in week two" would be a Git archaeology exercise. With revisions, correcting a plan is publishing `0003`, the record that named the old shape is still addressable, and the Issue's identity file changes only when its title or state changes.

The revision id is a zero-padded ordinal rather than a content digest. An ordinal answers "which is latest" without opening every file, and the design's address is `{ kind: "execution-plan"; issueId; revisionId }`, which wants a short stable segment. The trade-off is honest: two operators on two clones can both mint `0003`, and Git will surface that as a merge conflict on an add/add path. That is the correct outcome — a visible conflict between two plans — and it is strictly better than a digest scheme where both revisions silently coexist and neither is "next". Publication refuses an existing revision file locally, and each revision records the SHA-256 of its own canonical bytes so a hand-edited revision is detectable.

### 2. Two node kinds, because planning precedes creating

A plan whose every node must already be a created Change cannot be drafted, and drafting is the entire point of planning cross-project work before doing it. So a node is one of two kinds, and both name their project and target line:

| Kind | Carries | Verified at publication against |
| --- | --- | --- |
| `change` | `projectId`, `targetLineId`, `changeInstanceId`, optional `changeAlias` | the referenced instance's committed identity, in this Store |
| `intent` | `projectId`, `targetLineId`, `summary` | the project catalog and the target-line catalog only |

An `intent` node is not a weaker `change` node with a missing field; it is a declaration that work is expected in one project on one line and has not been created yet. Ownership is therefore explicit from the first draft, which is what keeps the "exactly one owner" invariant true across the whole lifecycle rather than only at the end. Realizing an intent — creating the Change and pointing the node at it — is a new revision, because a published revision is immutable. That is not friction; it is the audit trail the accepted design wants when it says branch names and directories are not identity.

`changeAlias` is recorded and is explicitly never resolved by. Resolution is by `changeInstanceId` only. A test asserts the exclusion rather than a comment claiming it, in the shape child 4 used for branch-name inference.

### 3. Reference, not containment — and no back-reference either

Containment is refused for five independent reasons, and it is worth listing them because "why not just put the changes under the issue" is the first question a reviewer will ask:

1. A contained Change would have the Issue as its owner, or two owners. The locked decision says exactly one project owner.
2. Only a landed Change may synchronize canonical specs, and canonical specs live in `rasen/projects/<projectId>/specs/`. A Change contained by a Store-level Issue has no partition to sync into.
3. §9.3 requires each Change to be validated, archived, and merged independently. Containment forces one lifecycle on work whose whole nature is that its parts land at different times.
4. Unmerged planning state is isolated by the Store Git worktree for one target line. An Issue that contained Changes across two lines would have to exist simultaneously and identically on two Store refs, which Git does not offer and merging would not fix.
5. §12 states it outright: nodes reference ChangeInstances, not mutable directory paths.

The less obvious decision is that the edge is **one-directional**. Referencing a Change does not write anything into that Change. A back-reference would be a Store-level write landing inside a project partition on a *different* Store ref, which is impossible without a merge and which would make an Issue edit a project mutation — precisely the authority boundary child 2 exists to hold. So "which Issues reference this Change" is derived by `StoreQueryModule` at read time from the Issue set, and is never persisted. It costs one pass over a small directory and it removes an entire class of consistency bug.

### 4. Resolution reads blobs across refs, with a stated authority order and three distinct failure states

A node names `(projectId, targetLineId, changeInstanceId)`. The Change it names can be in four places: active on that line's Store ref, active only in a local unmerged planning worktree, archived under `rasen/projects/<p>/changes/archive/<line>/` on that line's Store ref, or nowhere. Two evidence sources, in this order:

| Source | Portable? | Authority |
| --- | --- | --- |
| Committed Store content read as Git blobs across every target line's `storeRef` | yes | existence, committed identity, archived outcome |
| Local planning worktrees, located through child 4's machine workspace index | no | locates an instance whose planning branch has not merged yet |

The blob technique is the one child 3 uses for per-ref inventory and child 5 uses for successor resolution: `git show <ref>:rasen/projects/<p>/changes/<c>/.openspec.yaml`, parse the v2 identity block, re-derive the instance id, compare. Nothing is checked out, merged, or fetched, and the search space is bounded by the number of target lines, which is small by construction.

Three failure states are kept distinct, because collapsing them is how an aggregate lies:

- **`unresolved`** — no evidence in either source. The node is reported as unresolved with the refs that were searched.
- **`ambiguous`** — evidence in both sources that disagrees on scope, or two claimants for one instance id. Every claimant is listed and none is chosen.
- **unsearched ref** — a Store ref could not be read. This is *not* absence. It is recorded in the result's `unsearchedRefs` list and it sets `complete: false`, so an unreadable ref can never turn a real reference into `unresolved`. This is the same rule child 5 applies to successor search, for the same reason.

An Issue record that exists on two Store refs with differing bytes is `divergent`: both copies are listed with their refs and neither is presented as the record. Choosing by recency would require trusting a timestamp inside a file the divergence already proves untrustworthy.

### 5. A query fails closed by reporting, not by throwing

"Uncertain I/O, identity, ownership, or containment fails closed" is a portfolio invariant, and for a mutation it means refuse. For a read it cannot mean refuse, or one broken node would make an entire Store's board unreadable, which is the failure mode that makes people bypass the tool. The precise reading this slice takes:

> A query never *asserts* a state it cannot prove. It reports the unproven as unproven, names the evidence it did and did not reach, and marks the whole result incomplete.

So `listChanges` and `showIssue` return successfully with per-node states and an explicit `complete: boolean`, while a *mutation* touching the same references — publishing a revision — refuses outright. Same invariant, two correct expressions, and the difference is stated rather than left to whoever writes the next handler.

The one thing a query is never permitted to do is act on what it reads. §8.2 is explicit that no checkout, merge, index rebuild, or Issue aggregation may replay delta specs from an Archive. Aggregation reads an Archive record as data; the query module has no write surface at all, and a source guard asserts it imports no spec-apply, archive-engine, or filesystem-write function. Child 5 states the passive-history rule for the Archive; this states the aggregation-side obligation, which is where the temptation actually lives.

### 6. `StoreQueryModule` groups structurally, and does not offer a flat list

```ts
interface StoreQueryModule {
  listProjects(input: StoreQuery): Promise<ProjectRollup>;
  listTargetLines(input: StoreQuery): Promise<TargetLineRollup>;
  listChanges(input: ChangeQuery): Promise<GroupedChanges>;
  listIssues(input: IssueQuery): Promise<IssueSummaryPage>;
  showIssue(input: IssueSelector): Promise<IssueDetail>;
  resolveExecutionPlan(input: ExecutionPlanSelector): Promise<ResolvedExecutionPlan>;
}

interface GroupedChanges {
  readonly groups: readonly ChangeGroup[];
  readonly unsearchedRefs: readonly UnsearchedRef[];
  readonly complete: boolean;
}

interface ChangeGroup {
  readonly projectId: ProjectId;
  readonly targetLineId: TargetLineId;
  readonly active: readonly AggregateChangeEntry[];
  readonly archived: readonly AggregateArchiveEntry[];
}
```

There is no `listChangesFlat`. A flat list makes the group key implicit, and the only way a caller can recover an implicit group key is from a path or an id substring — which is the algorithm §6 was written to delete. Making the group a typed value with validated `ProjectId` and `TargetLineId` means the UI's card cannot render without its project and line in hand, which is exactly what §12 requires of every card.

`AggregateArchiveEntry` carries the finalization outcome, the archive date, and the verified instance; that is read from the Archive v2 record child 5 produces. Where a relocated legacy v1 record is found in a v2 partition, the entry reports `outcome: null` with a `legacyRecord` note rather than inventing `landed` — child 5 states that relocated entries stay byte-identical and are never upgraded, and inventing an outcome to fill a column would be the exact lie the four-outcome model exists to prevent.

Filters (`projects`, `targetLines`, `outcomes`, `state`) narrow a result. A filter never completes a scope for a mutation, and the query input type and the mutation input type are separate types so that cannot be done by passing the wrong object.

### 7. Where an Issue may be written, and the ref question the design leaves open

An Issue is cross-line by construction, and `rasen/issues/` exists on every Store ref, so "which ref does an Issue live on" has no answer the design supplies. Three options were weighed:

| Option | Result | Verdict |
| --- | --- | --- |
| Anchor every Issue to the Store's main checkout | One canonical location, but the main checkout's ref is "whatever branch it is on", which is branch-derived semantics the design forbids | Rejected |
| Introduce an explicit issue-anchor line in Store metadata | Unambiguous, but adds a fourth identity dimension to a model whose locked decisions have three | Rejected |
| Issues are ordinary committed Store content on whatever ref the write lands on; reads span refs and report divergence | No new concept, reuses the cross-ref read the module already needs, and makes the ambiguity visible instead of arbitrated | **Adopted** |

With the adopted option the one rule that has to be enforced is *where a write may not land*: a bound planning worktree. That worktree's branch is one Change's unmerged line, so a cross-line resource authored there is guaranteed to be invisible to every other line until an unrelated merge. The refusal is `issue_write_requires_store_checkout`, it names the checkout and the repair, and it is the only location rule this slice adds. Everything else is ordinary Git: the command names the checkout and ref it wrote to, prints the pathspec-scoped commit suggestion, and stages nothing, and carrying an Issue forward across release lines is the same explicit release-line merge §9.2 already describes.

The practice guidance — author Issues on the integration ref the participating lines share — belongs in documentation, not in a gate. A gate here would have to decide which ref is "shared", which is the anchor concept option two was rejected for.

### 8. No persisted index, stated as a decision rather than a gap

§13 lists "索引缓存" among `StoreQueryModule`'s hidden implementation details, which permits a cache without requiring one. This slice ships none, and the reasoning is worth recording so a later reader does not read the absence as an oversight:

- A persisted cross-ref index is a second source of truth about state whose first source is Git. The accepted design is explicit that the machine registry is a locator, never authority, and child 4 already established "conflict fails, absence is repaired" for exactly this shape.
- The management API's existing security requirement mandates a fresh filesystem read per request, so a cache on the read path would have to be invalidated per request anyway.
- The cost is bounded by the target-line count, not by Change count, because the expensive operation is per-ref and the per-ref work is a bounded set of blob reads.

The only caching is a per-invocation memo: one Store ref is read once within one query, not once per node. It has no lifetime beyond the call and therefore no invalidation problem. A durable index belongs to a slice that can also own its staleness diagnostics.

### 9. One new lock key, placed so child 4's ordering argument survives untouched

Issue writes serialize on an owner-aware machine-root lock keyed `(storeUid, issueId)`, in child 4's shape: a digest of the canonically serialized key material, under the machine root, acquired through `acquireOwnerAwareFileLock` so a dead holder is stolen only on an affirmative `ESRCH`.

It is acquired **before** the scope lock, making the full order `issue → scope → workspace → change → integration`. Child 4 asserts that no code path reaches back for an earlier lock while holding a later one, with its order starting at scope; prepending a key that no child-4 path ever takes leaves that assertion true as written, and this change asserts the extended order in its own suite. An Issue write takes only the issue lock — it touches no project partition, no worktree, and no canonical spec — and a query takes no lock at all, because a read that blocks on a writer would make an aggregate board hostage to one stuck command.

Contention retries within a bounded deadline and then fails naming the holder; a semantic conflict never retries. Both rules are child 4's and are reused rather than restated in code.

### 10. Scope completeness is enforced by the type of the input, and again at the boundary

The accepted design's §12 rule — the backend must not infer a missing scope field from the frontend's current filter — is enforced three ways, deliberately redundantly, because it is the rule an aggregate surface breaks by accident:

1. **Structurally.** The mutation input type requires `storeUid`, `projectId`, and `targetLineId` as validated ids, and the query filter type has them all optional. There is no assignment from one to the other, so a handler cannot pass its filter where a mutation scope is wanted.
2. **At the route.** The scoped mutation's path carries all three segments. A request missing one does not match the route; a request whose segments name a project or target line the Store's catalogs do not declare is refused before any spawn, with no CLI subprocess started and no file touched.
3. **In the UI.** The aggregate view's create action stays disabled until the user has chosen a project and a line explicitly, and the chosen values come from the form, never from the board's current filter state.

The Issue endpoints are the counter-case that keeps the rule honest: they require the Store and must **not** require a project or a target line. The rule is "the scope the operation needs, complete", not "always name a project". Both directions are asserted.

### 11. What this change takes from child 5, which has now landed

`store-finalization-outcomes-v2` is implemented (101/101, gates green, unarchived). This section was written while it was proposal-only and its fallbacks were the load-bearing part; they are kept below because they are still the honest answer if a contract shifts, but the "no producer exists yet" branch of each one is now historical rather than the expected state. Four things are consumed:

| Consumed | Why | Fallback if it shifts |
| --- | --- | --- |
| The four-outcome vocabulary (`landed`, `superseded`, `cancelled`, `abandoned`) | An archived node's terminal state, and the `outcomes` query filter | The vocabulary is already canonical in child 1's shipped `change-finalization-record-v2` / `src/core/store/finalization-v2.ts`, which this change reads directly. Child 5 is its producer, not its definition. |
| The Archive v2 record shape and its `parseArchiveV2` reader | Reading a node's outcome, target line, and verified instance | Same: the schema and reader are child 1's and are already in the tree. If no producer exists yet, a v2 partition simply contains no v2 records and every archived entry reports `outcome: null` with a legacy note. |
| The target-line-scoped Archive address `archive/<targetLineId>/<date>-<changeId>--<instanceShort>` | Enumerating archived entries per line | The address is computed through child 1's `resolveStorePlanningLayoutV2Path`, which already has the `archive-entry` and `archive-line` kinds. |
| A finalized Change actually existing | The archived half of every grouped result | Child 5 now produces one, so the archived half is populated in a real Store. The query is nonetheless written so an EMPTY archived list is a real answer rather than a degraded one — a Store whose Changes are all still active is an ordinary Store, not an error. |

The dependency is therefore real but shallow: every contract this change reads is child 1's, already shipped and already validating; child 5 is what *populates* them, and it now does. This slice can still be built and tested against fixtures — its tests construct Archive v2 records through `serializeArchiveV2` — and it should keep doing so rather than depending on a live finalization for unit coverage. The one thing it must not do is write one: producing a record is child 5's, and a test fixture is not a production writer.

The tension flagged here has now been closed by child 5's implementation rather than merely promised. If a v2 partition could hold either schema without a declared discriminator, this change's "v1 record in a v2 partition reports `outcome: null` and a legacy note" would degrade from a precise statement to a guess. Child 5 dispatches the accounting writer on the PRESENCE of the plan's finalization block and never on file content, and pins that with a test that plants a v2-looking `archive.json` beside the destination and asserts the v1 writer still runs (`test/core/archive-engine-finalization-seams.test.ts`). Its reader half is equally strict: a v1 record found while looking for this Change's published entry is skipped as a relocated legacy entry, never parsed as a variant and never upgraded, and `test/commands/store-v2-finalization-journey.test.ts` byte-compares such an entry across a full four-outcome run. So the statement stays precise; if it ever moves, the correct response remains a diagnostic owned by child 7, not content sniffing here.

### 12. Dependencies stay behind this Module's adapters

- **In-process:** the Foundation layout, identity, catalog, and finalization-record contracts; the scope seam; the Issue and revision validators; the graph checker. Composed directly.
- **Local-substitutable:** filesystem and canonicalization; read-only Git (`show`, `for-each-ref`, `rev-parse`, `ls-tree`); the machine workspace index reader; clock; entropy. Tests use deterministic in-memory adapters with a fixed clock, so a published revision is reproducible byte for byte.
- **Consumer adapters:** the `rasen store issue` / `store changes` / `store projects` Commander surfaces, the management route family, and the UI. They format and forward; they hold no resolution logic and no grouping logic.
- **Remote:** none. The Git write verb set is empty. A source guard asserts `src/core/store/query/**` imports nothing that writes and calls no Git verb outside the read set.

## Risks / Trade-offs

- [Risk] Issues living on whatever ref the write landed on will produce divergent copies in real use. → That is the visible, diagnosable form of a problem the alternatives only hid. Divergence is reported with every ref and copy, no winner is chosen, and the repair is an ordinary Git merge the user can inspect. The rejected anchor designs would have picked a copy silently or added a fourth identity dimension.
- [Risk] Reading blobs across every target-line ref on every aggregate request could be slow on a large Store. → Cost scales with target lines, which is small by construction, not with Change count; one ref is read once per query; and `--project` / `--target-line` filters narrow the ref set before any read. If it becomes a real cost, the answer is the index decision 8 defers, not a cache bolted onto this slice.
- [Risk] `intent` nodes let a plan describe work that never becomes a Change, so a plan can look complete while nothing exists. → Every node's kind is in the query result and on the card, an Issue's derived readiness counts an `intent` node as not started, and the Issue's own state is operator-declared so nothing auto-reports success. The alternative — forbidding `intent` — makes it impossible to plan before creating, which is the whole use case.
- [Risk] Deriving "which Issues reference this Change" at read time is O(issues) per lookup. → It is a bounded scan of small YAML records in one directory, memoized per invocation. The persisted alternative is a back-reference inside the Change, which decision 3 rejects on authority grounds, not on performance grounds.
- [Risk] A query that returns success with `complete: false` will be consumed as if it were complete. → The flag is not optional and not defaulted; the wire type requires it, the UI requirement makes the incomplete state visible on screen, and a test asserts the banner appears rather than only that the field is set. This is the failure mode most worth reviewing.
- [Risk] Replacing the member chip row on Store v2 boards removes a control some user relies on. → On a Store v2 aggregate space that control currently filters an error state, because the space-scoped changes listing refuses. Legacy flat Store spaces are untouched, and the replacement answers the same question from a stronger source.
- [Risk] The UI wire-type mirror in `packages/ui/src/api/types.ts` is hand-maintained and drifts silently. → Every new wire type is added to the mirror and pinned by a `satisfies` fixture in the same task, not a follow-up, because the fixtures are the only `tsc` tripwire there is.
- [Risk] The archived half of every result could go untested. → Decision 11 shows every consumed contract is child 1's and already shipped; tests build Archive v2 records through the shipped `serializeArchiveV2`, so the archived path is exercised by construction rather than by waiting for a producer. Child 5 has now landed and produces real records, so the path is populated in a live Store as well — but the fixtures stay, because a unit suite that needs a full finalization to exercise a reader is a slow suite with a large blast radius.
- [Risk] Adding a fifth lock key could invalidate child 4's deadlock argument. → The key is prepended, no child-4 path takes it, and this change asserts the full five-key order in its own suite rather than assuming the extension is harmless.
- [Risk] Windows case-insensitive filesystems could alias two Issue directories. → Issue ids go through the same portable canonical-segment contract that already rejects non-canonical case, traversal, control characters, trailing dot or space, and Windows device names, and address fixtures run against `path.win32` and `path.posix` explicitly.

## Migration Plan

1. Land children 3, 4, and 5 first. This change assumes project partitions, catalogs, target-line resolution, the machine workspace index, and — for populated archived results — finalization.
2. Add the layout addresses and the Issue/revision identifier contracts as pure functions with cross-platform fixtures, before anything reads or writes.
3. Add the Issue and Execution Plan record schemas, their validators, and the graph checker, read-only.
4. Add reference resolution and the cross-ref blob reader, read-only and fully tested against fixtures with unreadable refs, divergent copies, and ambiguous claimants.
5. Add `StoreQueryModule` and its grouping, still with no write path anywhere in the tree.
6. Add the Issue lock, publication, and the state transitions; then the CLI surface.
7. Add the management route family, the whitelist entries, and the scope-completeness refusals; then the wire-type mirror and its fixtures in the same commit.
8. Add the UI grouped board, the Issues view, and the mutation guard.
9. Verify: focused Module suites, the cross-project real-CLI journey, cross-platform address fixtures, the source guard, typecheck, lint, build, `rasen validate store-scoped-issues-management --strict`, `git diff --check`, and a strict UTF-8 audit of every changed file.

Rollback before any Issue exists is removal of the unused Modules, the route family, and the UI views. After Issues exist, rollback must keep *reading* them: the records are committed Store content that a reverted build must still list and show, and it must refuse a publication it can no longer verify rather than writing an unverified revision. No rollback path deletes an Issue, a revision, or a Change.

## Open Questions

None blocking. Four decisions resolve silences in the accepted design and are the ones worth re-reading in review: splitting the Issue record from immutable ordinal plan revisions and accepting an add/add Git conflict as the collision semantics (decision 1); the `intent` node kind, which the design does not contemplate but without which no plan can be drafted (decision 2); the ref question for a resource that is cross-line by construction, resolved as "ordinary content, cross-ref reads, divergence reported rather than arbitrated" with only the bound-planning-worktree write refused (decision 7); and reading "fails closed" for a query as "reports the unproven as unproven with an explicit completeness flag" rather than as "throws" (decision 5). The persisted aggregate index (decision 8), documentation reconciliation, and the doctor/CI consistency gates remain later slices and can consume these query methods and record schemas without changing either Module's Interface.
