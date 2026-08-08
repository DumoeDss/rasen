## Context

`store-planning-scope-routing` made "this project mutation needs a verified planning worktree" a hard gate, and `store-layout-v2-migration` made the partitions that mutation writes into exist. Neither builds the worktree. The gate in `src/core/store-planning/internal/resolver.ts` currently reads:

```ts
planningWorktreeVerified =
  targetLineId !== undefined &&
  store.checkoutRole === 'linked-worktree' &&
  Boolean(association?.candidate.planningRoot || marker?.candidate.planningRoot);
```

Three things follow from that line, and they set the shape of this slice. It admits any linked worktree carrying a parseable `.rasen/planning-line.json`, so the marker is trusted without being checked against the target-line catalog, the Store repository it claims, or the physical worktree it sits in. It has no notion of a *pair*: `association?.planningRoot || marker?.planningRoot` is satisfied by either side alone, so an execution checkout with a stale association and a planning worktree with a stale marker are indistinguishable from a bound pair. And nothing creates either file, so the only way to reach the gate is to assemble the pair by hand — which is exactly what `test/commands/store-v2-planning-scope-journey.test.ts` does, and it is the sole working fixture of a verified planning worktree in the tree.

Two structural gaps sit beside it. The target line is the partition key for Archive and a derivation input for `PlanningScopeId`, but the only writer of `.rasen-store/target-lines/<id>.yaml` in the whole portfolio is the migration mapping file (child 3, decision 6: "Migration provides no other target-line management; ref resolution and binding remain child 4's"), so a migrated Store cannot gain a second release line. And `RuntimeContext` freezes a planning root and an execution root but not the pair, so a command inside a session cannot tell whether the Store worktree it is about to write to is the one this Change was started in.

Preparing the pair means creating Git worktrees in two repositories. This is the first Git *mutation* in the portfolio — children 1 through 3 are read-only against Git by construction — so the trust model has to be explicit rather than inherited. It is also where the accepted design's invariant 8 (plan then apply) and invariant 5 (the pair is explicit, never guessed from a branch name or an adjacent directory) become executable rather than aspirational.

This is the fourth slice in a serial portfolio. It does not own finalization outcomes, Archive v2 record production, the merge of a planning branch into a Store integration ref, Store Issue aggregation, or the portfolio-wide caller sweep and doctor/CI consistency gates.

## Goals / Non-Goals

**Goals:**

- Give a target line a stable identity whose Git locators can move without the identity moving, and one place that resolves it to a concrete ref and OID.
- Create and reuse the Store planning worktree and the execution worktree as one explicitly bound pair, through an immutable plan and a revalidated token.
- Make every binding fact carry a stated authority, so a disagreement between a marker, an index, a session, and committed metadata is a refusal rather than a precedence accident.
- Make preparation non-mutating with respect to refs, HEADs, and working trees: Rasen adds worktrees, it never moves the user's.
- Freeze the complete pair into the session and expose it as inert locators through `rasen context --json`.
- Remove a worktree only when the proof that removal loses nothing is complete, and say precisely what is missing when it is not.
- Keep the Git verb set closed, non-destructive, and asserted by a guard rather than by convention.

**Non-Goals:**

- Finalization outcomes, reachability proofs, spec sync, or Archive v2 records. `store_v2_finalization_unavailable` stays closed, and this change performs no merge of a planning branch into a Store integration ref.
- Store Issue / Execution Plan resources, cross-project aggregation, or management/UI surfaces for the pair.
- Doctor and CI gates that cross-check Changes, Archives, and canonical specs against target-line records; those are the compatibility-hardening slice's.
- Migrating read-only compatibility callers, or a forge adapter of any kind.
- Minting `layoutVersion: 2` at `rasen store setup`, which belongs to `store-bootstrap`.
- Any automatic merge, rebase, reset, branch deletion, fetch, push, or forced worktree removal, under any flag.

## Decisions

### 1. Two Modules, because target lines outlive any one workspace

```ts
interface StoreTargetLines {
  list(input: TargetLineQuery): Promise<readonly TargetLineRecord[]>;
  show(input: TargetLineSelector): Promise<TargetLineRecord>;
  add(input: AddTargetLineInput): Promise<TargetLineRecord>;
  setRef(input: SetTargetLineRefInput): Promise<TargetLineRecord>;
  resolve(input: TargetLineSelector): Promise<ResolvedTargetLine>;
}

interface StoreWorkspaceModule {
  plan(input: PrepareChangeWorkspaceInput): Promise<ImmutableWorkspacePlan>;
  apply(token: WorkspacePlanToken): Promise<PreparedChangeWorkspace>;
  describe(input: DescribeWorkspaceInput): Promise<WorkspaceDescription>;
  planCleanup(input: CleanupWorkspaceInput): Promise<ImmutableCleanupPlan>;
  applyCleanup(token: CleanupPlanToken): Promise<CleanupResult>;
}
```

`StorePlanning` gains `planChangeWorkspace` and `applyWorkspacePlan` as the accepted design names them; both delegate to `StoreWorkspaceModule` so the planning seam stays the single public entry point for callers.

They are separate Modules because their lifetimes differ. A target line exists before any Change and outlives every workspace on it; children 5 and 6 consume target lines (Archive partitioning, the mismatch gate, project/line filters) without knowing that worktree pairs exist. Folding the line registry into the workspace Module would make the finalization owner depend on worktree machinery to read a release line.

Alternative considered: extend `StoreLayoutMigrationModule` with target-line authoring, since it already writes catalogs. Rejected — that Module's whole contract is one-shot, gated, and about relocating existing content; routine "add a release line" would have to bypass its gates, which is how a fail-closed Module acquires a fail-open door.

### 2. Target lines: stable identity, mutable locators, resolution at use time

A `TargetLineRecord` is the existing `StoreTargetLineCatalogV1` — `id`, `storeRef`, and `projects[projectId].codeRef`. This change adds only behavior:

- **`add`** writes a new catalog. It refuses an id that already exists, validates the id through the Foundation portable contract, and requires at least the Store ref. Per-project code refs may be added later.
- **`set-ref`** rewrites a locator in place. It never renames an id, never creates one, and never removes a project locator that a bound Change still names. Moving a line from a branch to a tag is a locator edit, not a new line.
- **`resolve`** turns the record into `{ targetLineId, storeRef, storeRefOid, codeRef, codeRefOid }` by asking the Git adapter to resolve each ref in its own repository. A ref that does not exist, is ambiguous, or resolves to a non-commit fails with `target_line_ref_unresolved`, naming the record field and the repository. Resolution never falls back to `HEAD`, to the current branch, or to a similarly named ref.
- Nothing infers a target line. A branch called `change/line-0.2/elftia/redesign-b` is a human convenience; the accepted design forbids parsing it, and a test asserts the exclusion rather than only documenting it.

A Change's target line is frozen in its v2 identity block at creation. Any later command that resolves a different line for that Change fails with `target_line_mismatch` and names both lines. This is the gate the finalization owner needs and it is cheaper to establish here, where the Change instance and the line are both already in hand.

Catalog writes take the scope lock (decision 7) and are the only Store Git-tracked writes this change performs. They print a pathspec-scoped commit suggestion and stage nothing.

### 3. Worktree identity is local, and no second portable repository identity is minted

Child 1 specifies `WorktreeInstanceId` as derived from "canonical repository identity and canonical physical worktree identity supplied by the local Git adapter", and defines both as local identities. This slice supplies them:

- `canonicalRepositoryIdentity` = the canonicalized absolute `git rev-parse --path-format=absolute --git-common-dir`, so every linked worktree of one repository shares it;
- `canonicalWorktreeIdentity` = the canonicalized absolute worktree root, from `git rev-parse --path-format=absolute --show-toplevel`.

Both go through `FileSystemUtils.canonicalizeExistingPath` and the platform case rule already used by the resolver, so a Windows drive-letter or short-name alias resolves to the same instance id. A path that cannot be canonicalized yields no identity and the operation fails closed; it never degrades to the literal string.

The accepted design's binding sketch also lists `executionRepoUid: repo_...`, and Archive v2 has a `codeMerge.repoUid` field. **This change mints no such identity.** There is nothing in the tree that produces one, layout v2 already states that one Change belongs to exactly one project and one project owns one code repository, so `projectId` is already the portable identity of the execution repository. Minting a second portable repository identity would add an identity dimension the portfolio's locked decisions do not have, and would require a new durable field in the code repository's committed config. The binding therefore records `projectId` as the portable execution-repository fact and the local canonical repository identity for drift detection only. Populating `codeMerge.repoUid` in an Archive v2 record is the finalization owner's decision, and `projectId` satisfies its schema today.

### 4. Four binding carriers with a stated authority order

| Carrier | Location | Portable? | Authority |
| --- | --- | --- | --- |
| Change v2 identity block | `<change>/.openspec.yaml`, committed | yes | Store, project, target line, Change instance |
| Planning-worktree marker | `<planningWorktree>/.rasen/planning-line.json`, ignored | no | this worktree's declared scope |
| Execution association | `<executionWorktree>/.rasen/planning-binding.json`, ignored | no | this checkout's declared planning worktree |
| Machine workspace index | `<dataDir>/planning-workspaces/index/<planningScopeId>.json` | no | nothing on its own |

Resolution order is the one child 2 already implements — explicit selectors, frozen session, execution association, planning marker, project binding — with two additions this slice makes explicit:

- **Committed Change metadata outranks every local carrier for identity.** A marker or index entry that names a different Store, project, target line, or Change instance than the Change's own metadata is `workspace_marker_conflict` or `planning_execution_binding_mismatch`, never a silent override.
- **The index is never authority.** It is a rebuildable projection of the markers plus Git. Before use, every field is re-derived: the recorded roots must still be worktrees of the recorded repositories, the recorded instance ids must re-derive from the live canonical identities, and the recorded scope must match the markers. A **missing** entry is repaired idempotently from the markers and Git, because an index that fails when it is merely incomplete would make a hand-assembled pair unusable for no safety gain. A **disagreeing** entry fails closed. This is the accepted design's "索引、local marker 与 metadata 冲突时失败关闭" read precisely: conflict fails, absence is repaired.

Two entries claiming the same execution worktree, or two planning worktrees claiming the same Change instance, is `workspace_binding_ambiguous`; the resolver lists every claimant and chooses none.

No committed schema changes. The portable half of the binding is already exactly child 1's v2 identity block, which is why this slice adds no field to `.openspec.yaml`.

### 5. The pair completes in two phases, because the Change instance does not exist yet

`WorkspacePairId` needs a `ChangeInstanceId`; a `ChangeInstanceId` is minted by `createChange`; `createChange` requires a verified planning worktree. That is circular, and the accepted design does not resolve it. This slice does:

```text
plan/apply  ->  workspace is PREPARED (scope + both worktrees, no pair id)
createChange ->  workspace is BOUND    (change instance + pair id completed)
```

A prepared workspace records the planning scope, both worktree roots and instance ids, the frozen OIDs, and the intended `changeId` alias. It is `unbound` until exactly one Change is created in its planning worktree, at which point the index entry gains the `changeInstanceId` and the derived `WorkspacePairId`. Creating a second Change in the same planning worktree fails with `workspace_already_bound`, which is the accepted design's MVP rule ("一个 planning worktree 只承载一个活动 ChangeInstance") enforced rather than assumed. Relaxing it later requires an explicit workspace manifest, not a directory scan.

`plan` also accepts `intent: 'existing-change'`, which binds an already-created Change to a newly prepared pair — the case where a worktree was removed and is being recreated. It verifies the Change's metadata identity instead of minting one, and the pair id changes because a worktree instance changed, exactly as child 1 specifies.

### 6. Immutable plan, content-addressed token, revalidation under the lock

The plan is a pure value: the resolved scope, the resolved target line with both refs and both OIDs, an ordered action list, and the preconditions each action asserts. Actions are drawn from a closed set — `reuse-planning-worktree`, `create-planning-worktree`, `reuse-execution-worktree`, `create-execution-worktree`, `write-planning-marker`, `write-execution-association`, `record-index-entry` — each carrying its absolute destination, the OID it will be created from, and the digest of any file it will write.

`planId = sha256(canonicalBytes(plan))` reuses the existing canonical serialization. `WorkspacePlanToken` carries `{ planId, storeUid, projectId, targetLineId, changeId, storeRefOid, codeRefOid, planningHeadOid?, executionHeadOid?, indexFingerprint }`. Plans live in `<dataDir>/planning-workspaces/plans/<planId>.json` — machine-local coordination state, never inside either Git repository, for the same reason child 3 keeps migration plans there.

`apply` takes the locks, then revalidates before its first write and aborts with `workspace_plan_stale` on any mismatch: the target-line catalog text, both resolved ref OIDs, the HEAD OID and checked-out ref of every reused worktree, the non-existence of every created destination, the Store's declared layout version, and the index fingerprint. **New worktrees are created from the recorded OID, not from the ref name**, so a ref that moved between plan and apply cannot silently retarget the worktree — the OID comparison catches it first, and the plan is invalidated rather than repaired.

### 7. Four semantic lock keys, one acquisition order, and no retry on semantic conflict

The accepted design's lock keys are implemented as owner-aware machine-root locks under `<dataDir>/planning-workspaces/locks/`, reusing `acquireOwnerAwareFileLock` so a dead holder is stolen only on an affirmative `ESRCH` and never on ambiguity:

| Key | Material | Taken by |
| --- | --- | --- |
| scope | `(storeUid, projectId, targetLineId)` | target-line writes, workspace plan/apply, cleanup |
| workspace | `(workspacePairId)`, or the prepared pair's provisional key before binding | workspace apply, cleanup |
| change | `(changeInstanceId)` | published for the finalization owner |
| integration | `(storeUid, targetLineId)` | published for the finalization owner |

Filenames are digests of the canonically serialized key, so an identifier's length or case never becomes a filesystem property. Acquisition order is always scope → workspace → change → integration; a caller that already holds a later lock never reaches back for an earlier one, which is what makes the ordering sufficient against deadlock.

Failure modes are distinguished on purpose. **Contention** — the holder is alive — retries within a bounded deadline and then fails with `workspace_lock_unavailable`, naming the holder recorded in the lock file. **A semantic conflict** — a mismatched binding, a dirty tree, a moved ref — is never retried, because retrying cannot change the answer and a bounded retry loop around a permanent refusal only delays the diagnostic. **A Git-level lock failure** (`index.lock`, a concurrent `worktree add`) surfaces as itself and is never resolved by removing a lock file or by adding `--force`. Different projects and different target lines take different scope locks and therefore run concurrently, which is the property the two-line acceptance case measures.

### 8. Conflict taxonomy: what each code refuses, and what it never does

| Code | Refuses | Never |
| --- | --- | --- |
| `target_line_ref_unresolved` | a locator that names no commit in its repository | guesses a similar ref or falls back to HEAD |
| `target_line_mismatch` | a command resolving a line other than the Change's frozen one | re-points the Change |
| `planning_worktree_required` | a project mutation from an integration checkout or an unverified worktree | writes into the integration checkout |
| `planning_execution_binding_missing` | an execution worktree with no planning side | infers a planning worktree from an adjacent directory |
| `planning_execution_binding_mismatch` | selectors, metadata, markers, or index disagreeing | picks the strongest and continues |
| `workspace_marker_conflict` | a marker naming a scope its Change metadata contradicts | rewrites the marker to agree |
| `workspace_binding_ambiguous` | two claimants for one worktree or one Change instance | chooses one |
| `workspace_already_bound` | a second Change in one planning worktree | scans the directory to decide which is current |
| `workspace_ref_mismatch` | reusing a worktree that is on another ref | switches, checks out, or resets it |
| `workspace_dirty_tree` | cleanup of a tree with tracked modifications or staged changes | discards the changes |
| `workspace_destination_exists` | a create action whose destination path exists | overwrites or merges into it |
| `workspace_plan_stale` | an apply whose preconditions moved | re-resolves and continues |
| `workspace_lock_unavailable` | a live holder after the bounded deadline | steals a lock held by a live process |
| `workspace_cleanup_unsafe` | removal that cannot be proven lossless | forces the removal |

Every code carries the two disagreeing values and a repair hint. None of them has an override flag: the escape hatch is to correct the disagreement, which is inspectable, or to prepare a new pair, which is explicit.

### 9. Preparation never moves a ref, a HEAD, or a working tree

The only Git state this slice creates is a new worktree, and — when the plan says so — the new branch that worktree checks out, created from the recorded OID. Everything else about the user's Git is read.

That has one visible consequence, and it is deliberate. When an existing worktree is being reused and is on a different ref than the pair recorded, preparation refuses with `workspace_ref_mismatch` and names both refs. It does not `checkout`, `switch`, or `reset`, because the worktree may hold the user's uncommitted work and because a tool that silently moves a HEAD is exactly what invariant 5 exists to prevent. A dirty tree does *not* block reuse — Rasen is not going to touch it — but it does block cleanup (decision 11), where the tree is about to disappear.

The counterpart is containment: `apply` writes only inside the two planned worktree roots and the machine root. Every destination is containment-checked against its recorded root before the write, on the plan's declared path flavor, so a `win32` fixture behaves identically on a POSIX host.

### 10. Freezing: session context v2 and the context projection

`RuntimeContext` becomes version 2. The Store planning arm gains `worktree: { root, worktreeInstanceId, headOid, ref }`, the project execution arm gains the same shape, and the context gains `changeInstanceId` and `workspacePairId` when the pair is bound. The version is raised rather than the fields added optionally because the schemas are `.strict()`, so an older reader would reject the new keys anyway; raising the version turns that into the plain "unsupported version" report the capability already requires, instead of a parse error at an arbitrary call site.

Freezing means what child 2 established for scope: a command inside a session uses the recorded pair and does not re-derive it. If the live worktree disagrees with the frozen pair — the worktree was removed, moved, or switched to another ref — the command fails closed naming both, rather than continuing in whatever the working directory happens to be. A session that plans only, or that predates a prepared pair, records no pair; absence is an explicit state, not a guess, and a mutation that needs the pair refuses on its absence.

`rasen context --json` gains a `workspace` object with both worktree roots, instance ids, checked-out refs and HEAD OIDs, the Store/project/target-line/Change-instance facts, the pair id, a `bindingState` of `unbound` | `prepared` | `bound` | `drifted`, and the list of verification findings. The human form prints the same facts. These are inert locators: serializing them confers no authority, exactly as child 2's context requirement already states for the scope description. This is also the audit surface the accepted design asks for in §7.

### 11. Cleanup is plan/apply, and its refusals are the point

`planCleanup` produces an ordered removal plan; `applyCleanup` consumes only its token. A worktree is removable only when every one of these holds, and the plan lists each as a satisfied or unsatisfied precondition:

1. it is one of the two roots the pair recorded, and it re-derives the recorded worktree instance id;
2. it is a linked worktree, never the repository's main checkout;
3. its checked-out ref is the ref the pair recorded;
4. it has no tracked modifications and no staged changes;
5. it has no untracked files, unless `--include-untracked` names them explicitly after the plan has listed them;
6. every commit on its branch is reachable from the recorded integration ref (planning side) or target code ref (execution side), proven with `merge-base --is-ancestor`;
7. no live session context references it;
8. no scope or workspace lock is held by another process.

Anything unsatisfied is `workspace_cleanup_unsafe`, listing which preconditions failed with their values. There is no `--force`.

Removal is `git worktree remove` without `--force`, then `git worktree prune`. Cleanup **never** deletes a branch or any ref, never merges or rebases to satisfy precondition 6, never touches the Store integration checkout or the code repository's main checkout, never removes a path outside the two recorded roots, and never removes the Change directory, the project partition, the Archive, another pair's markers, or another pair's index entry. The index entry for this pair is removed last, after both worktrees are gone, so an interrupted cleanup resumes from the index rather than from a directory scan. Removing a worktree whose Change has not been finalized is permitted only when precondition 6 holds — the planning branch is already reachable from the integration ref — which keeps "the Change is not finished" and "the worktree still holds unmerged work" as two separate facts, since the first is the finalization owner's business and only the second is a data-loss risk.

### 12. Dependencies stay behind this Module's adapters, and the Git verb set is closed

- **In-process:** Foundation identity, layout, and catalog contracts; the plan builder; the binding reducer; diagnostics. Composed directly.
- **Local-substitutable:** filesystem and canonicalization; Git; the machine-root coordination store (plans, index, locks); clock; entropy. Production uses the existing implementations; tests use deterministic in-memory adapters with a fixed clock and a seeded entropy source, so a plan is reproducible byte for byte.
- **Consumer adapters:** the `rasen store workspace` and `rasen store target-line` Commander surfaces and the context projection. They format; they hold no resolution logic.
- **Remote:** none. No clone, fetch, push, or network access.

The Git adapter's write surface is exactly `worktree add`, `worktree remove`, and `worktree prune`; its read surface is `rev-parse`, `show-ref`/`for-each-ref`, `worktree list --porcelain`, `status --porcelain`, `merge-base --is-ancestor`, and `ls-files --others`. A source guard asserts that no other verb, and no `--force` on `worktree remove`, appears in the workspace adapter, in the shape child 2 and child 3 established for path joins. No forge adapter is introduced; there is still exactly one provider.

## Risks / Trade-offs

- [Risk] This is the portfolio's first Git-mutating code path, so a bug here can cost a user's uncommitted work. → The mutating verb set is three commands, none of them destructive; preparation only ever *adds* a worktree; every removal precondition is a proof obligation listed in a plan the user can read first; and the guard makes widening the verb set a deliberate, visible edit.
- [Risk] The concept is called `workspace`, but `workspace` is a RETIRED top-level command name — the legacy editor-view group replaced by `workset`, which `test/commands/legacy-groups-removed.test.ts` exists to keep dead — and the top level already carries `work`, `workset`, and `workflow`. → Resolved by splitting the two questions. The Module, the identities (`WorkspacePairId`), the planning-seam names (`planChangeWorkspace` / `applyWorkspacePlan`), and all internal vocabulary stay `workspace`, so the code keeps the accepted design's language. Only the Commander group moves: it is `rasen store workspace`, a subcommand of the existing `store` group. Re-issuing a retired top-level name for an unrelated concept would hand anyone with old muscle memory something semantically different, and rewriting the retirement pin to accommodate new code is the anti-pattern this portfolio has already paid for. A pair is Store content in any case — a standalone project has no planning/execution pair — so the group belongs beside `store adopt`, `store eject`, and `store migrate-layout`. Both command groups still state the `workset` distinction in their first description sentence.
- [Risk] Repairing a missing index entry instead of failing could be read as the index inventing a binding. → The repair derives every field from the markers and live Git and writes nothing that is not already true on disk; it cannot introduce a fact, only cache one. A disagreeing entry still fails closed, and the repair is asserted to be idempotent.
- [Risk] Refusing to switch a reused worktree onto the recorded ref will read as unhelpful. → It is the alternative to moving a HEAD under work the user may not have committed. The diagnostic names both refs and the exact `git switch` the user can run themselves, which keeps the destructive decision with the person who can see the working tree.
- [Risk] The two-phase pair means a prepared-but-never-bound workspace can accumulate. → It is visible in `rasen store workspace show`, it is removable by cleanup with the same preconditions (an unbound pair trivially satisfies the reachability precondition when its branch has no commits), and it holds no Git-tracked state.
- [Risk] Freezing the pair into the session raises the context version, breaking sessions in flight across an upgrade. → The file is machine-local and dies with its session, the failure is the plain "unsupported version" report the capability already specifies, and the repair is to restart the session. The alternative — optional fields on a strict schema — leaves the pair semi-frozen and every reader guessing.
- [Risk] Windows path aliasing could make one worktree derive two instance ids, or two worktrees derive one. → Both identity inputs are canonicalized through the existing helper with the platform case rule, and the suite carries drive-letter-case, short-name, junction, and separator-form fixtures against `path.win32` and `path.posix` explicitly.
- [Risk] Concurrent preparation on one Store repository can collide inside Git itself. → Same-scope work serializes on the scope lock; a Git-level lock failure from anything outside Rasen is surfaced as itself rather than retried into a force.
- [Risk] `git worktree remove` can leave administrative files behind if it is interrupted. → Cleanup follows with `worktree prune`, records its phase in the index entry before each step, and resumes from that phase; it never concludes "already gone" from the absence of a directory alone.
- [Risk] Target-line locator edits are the one Git-tracked write here, so a careless edit could re-point a live line. → `set-ref` takes the scope lock, refuses to remove a project locator a bound Change still names, prints a diff of the locator change, and stages nothing, so the edit lands in the user's own reviewed commit.

## Migration Plan

1. Land child 3's migration first; this slice assumes project partitions, project catalogs, and the layout write guard already exist.
2. Add the target-line Module, its CLI surface, and its resolution contract. At this point a migrated Store can gain a release line, which is the precondition for everything below.
3. Add the workspace Module's contracts, adapters, identity derivation, and binding reducer, read-only: `describe` and `plan` work, `apply` is not yet reachable from the CLI.
4. Add `apply`, the lock protocol, revalidation, and the marker/association/index writes; switch the resolver's `planningWorktreeVerified` onto the real verification.
5. Add session context v2 and the `rasen context --json` workspace projection.
6. Add `planCleanup` / `applyCleanup` and the Git verb guard.
7. Verify: focused Module suites, the two-line concurrency journey, cross-platform path-identity fixtures, typecheck, lint, build, `rasen validate store-planning-worktree-bindings --strict`, `git diff --check`, and a strict UTF-8 audit of every changed file.

Rollback before any pair has been prepared is removal of the unused Modules and the resolver switch. After pairs exist, rollback must keep *reading* them: the markers and index entries describe real worktrees, and a reverted build must still refuse a mutation it cannot verify rather than fall back to the integration checkout. No rollback path deletes a worktree, a branch, or a marker.

## Open Questions

None blocking. Four decisions above resolve silences or divergences in the accepted design and are the ones worth re-reading in review: the two-phase prepared/bound pair that breaks the `WorkspacePairId` circularity (decision 5), the refusal to mint a portable `executionRepoUid` (decision 3), the "conflict fails, absence is repaired" rule for the machine index (decision 4), and the decision to refuse rather than switch a reused worktree that is on another ref (decision 9). Merging a planning branch into its integration ref, upgrading legacy Archive entries, and the doctor/CI consistency gates remain owned by later slices and can consume the target-line records and the pair index without changing either Module's Interface.
