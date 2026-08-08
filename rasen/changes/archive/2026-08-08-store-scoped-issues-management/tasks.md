## 1. Baseline, contracts, and adapters

- [x] 1.1 Record the production inventory of every surface that today answers a Store-level question — `resolveProjectContentSpace`'s `project_scope_required` refusal for a Store v2 aggregate, `isStoreAggregateSpace` and its two router call sites, the `StoreReadAddress` union, `listStoreMembers`, and the spaces listing's inline member rollup — and classify each as this change's owner, an unchanged read consumer, or a later-slice owner.
- [x] 1.2 Capture current behavior in a baseline suite before anything moves, in `test/core/store/store-aggregate-baseline.test.ts`: a Store v2 aggregate space refuses project content by name, `StoreReadAddress` offers exactly `store-metadata` and `store-design-docs`, the layout contract has no Issue address, and no route matches `/api/v1/stores/**`.
- [x] 1.3 Define the Issue and Execution Plan record types, their input/result types, and the stable error-code union in `src/core/store/issues/types.ts`: `issue_scope_required`, `issue_write_requires_store_checkout`, `issue_not_found`, `issue_already_exists`, `issue_record_divergent`, `issue_reference_unresolved`, `issue_reference_ambiguous`, `issue_reference_scope_conflict`, `issue_reference_foreign_store`, `execution_plan_revision_exists`, `execution_plan_cycle`, `execution_plan_node_duplicate`, `store_query_scope_incomplete`, and `store_query_ref_unreadable`.
- [x] 1.4 Define the `StoreQueryModule` Interface (`listProjects`, `listTargetLines`, `listChanges`, `listIssues`, `showIssue`, `resolveExecutionPlan`) and its result types in `src/core/store/query/types.ts`, with `GroupedChanges` carrying `groups`, `unsearchedRefs`, and a required non-optional `complete` flag.
- [x] 1.5 Add local-substitutable adapters for filesystem/canonicalization, read-only Git (`show`, `for-each-ref`, `rev-parse`, `ls-tree`), the machine workspace-index reader, clock, and entropy, each with a deterministic in-memory test implementation using a fixed clock and a seeded entropy source.
- [x] 1.6 Add a bounded source guard in the shape children 2, 3, and 4 established, asserting that `src/core/store/query/**` imports no spec-apply, archive-engine, or filesystem-write function and invokes no Git verb outside the read set, in `test/core/store/store-query-read-only-guard.test.ts`.
- [x] 1.7 Assert the Git write verb set for this change is empty: no `worktree`, `merge`, `rebase`, `checkout`, `switch`, `branch`, `commit`, `add`, `fetch`, `push`, or `clone` appears anywhere under `src/core/store/issues/**` or `src/core/store/query/**`.
- [x] 1.8 State in the module docblocks that a query never asserts an unproven state and never throws on one, and that a mutation touching the same references refuses — the two correct expressions of the same fail-closed invariant.

## 2. Layout addressing and portable identifiers

- [x] 2.1 Add `{ kind: 'issue'; issueId }` and `{ kind: 'execution-plan'; issueId; revisionId }` to `StorePlanningLayoutV2Address` and resolve them to `rasen/issues/<issueId>/` and `rasen/issues/<issueId>/plans/<revisionId>.yaml` in `src/core/store/planning-layout-v2.ts`.
- [x] 2.2 Add an `issue-record` address for `rasen/issues/<issueId>/issue.yaml` and an `execution-plans` address for the revisions directory, so no caller joins a filename onto a returned directory.
- [x] 2.3 Implement `parseIssueId` in `src/core/store/planning-validation.ts` against the same portable canonical-segment contract project ids use: reject empty, `.`, `..`, path separators, control characters, trailing dot or space, Windows reserved device names, and non-canonical case, and never sanitize an invalid value into a different id.
- [x] 2.4 Implement `parseExecutionPlanRevisionId` accepting only a zero-padded decimal ordinal of fixed width, rejecting `0000`, unpadded values, and any value that is not a canonical spelling of its own number.
- [x] 2.5 Prove the new addresses stay pure and containment-checked: no filesystem read, create, move, or delete, and every result contained by the Store root.
- [x] 2.6 Prove the Issue addresses are Store-level: computing one requires no `projectId` and no `targetLineId`, and supplying either does not change the result.
- [x] 2.7 Add `test/core/store/store-issue-layout.test.ts` covering both new addresses on `path.win32` and `path.posix`, mixed-case drive letters, separator forms, UTF-8 Chinese issue titles with ASCII ids, long paths, every identifier rejection case, and containment escape.

## 3. Issue records: schema, authoring, and state

- [x] 3.1 Define the strict versioned `issue.yaml` schema — `version`, `id`, `title`, `state`, `reason`, `createdAt` — rejecting unknown fields, machine paths, credentials, and a `state` outside `open` | `resolved` | `dropped`.
- [x] 3.2 Require the containing directory name to equal the record's `id`, in the same shape `validateProjectCatalogFilename` and `validateTargetLineCatalogFilename` already enforce, and refuse a mismatch rather than preferring either side.
- [x] 3.3 Assert the record carries no `storeUid`, no project list, no node list, and no `latestRevision`, and that each of those is derivable — the containing Store, the plan's nodes, and the revisions directory respectively.
- [x] 3.4 Implement `create`: validate the id, refuse an existing Issue with `issue_already_exists` without touching it, write `issue.yaml` and an optional `README.md` scaffold, and print a pathspec-scoped commit suggestion while staging, committing, fetching, and pushing nothing.
- [x] 3.5 Implement `setState`: `open` → `resolved` and `open` → `dropped` only, requiring a non-empty reason for `dropped`, refusing any transition out of a terminal state, and rewriting only `state`, `reason`, and nothing else in the record.
- [x] 3.6 Refuse an Issue write whose resolved Store checkout is a bound planning worktree, with `issue_write_requires_store_checkout` naming the checkout, the Change it is bound to, and the repair.
- [x] 3.7 Prove an Issue write touches no project partition, no canonical spec, no Change directory, no catalog, and no Archive, by snapshotting the Store tree before and after.
- [x] 3.8 Add `test/core/store/store-issue-records.test.ts` covering schema strictness, filename agreement, creation, duplicate refusal, every state transition and refusal, the planning-worktree write refusal, and the untouched-tree snapshot.

## 4. Execution Plan revisions: immutability and graph validation

- [x] 4.1 Define the strict versioned revision schema — `version`, `issueId`, `revisionId`, `supersedes`, `createdAt`, `nodes` — with `nodes[]` a discriminated union on `kind` of `change` and `intent`.
- [x] 4.2 Define a `change` node as `nodeId`, `projectId`, `targetLineId`, `changeInstanceId`, optional `changeAlias`, `dependsOn`; define an `intent` node as `nodeId`, `projectId`, `targetLineId`, `summary`, `dependsOn`. Both name their project and target line; neither carries a path, a branch name, or a worktree root.
- [x] 4.3 Record `changeAlias` as human convenience only and prove no resolution path reads it: resolution is by `changeInstanceId`, asserted by a test rather than only documented.
- [x] 4.4 Implement publication: allocate the next ordinal under the Issue lock, refuse an existing revision file with `execution_plan_revision_exists`, set `supersedes` to the previous ordinal or null, and record the SHA-256 of the revision's own canonical bytes.
- [x] 4.5 Prove a published revision is never rewritten: correcting a plan publishes a new ordinal, and a byte-snapshot asserts every earlier revision is unchanged after three successive publications.
- [x] 4.6 Validate the graph before writing: refuse a cycle in `dependsOn` with `execution_plan_cycle` naming the cycle, refuse a `dependsOn` naming an unknown `nodeId`, refuse duplicate `nodeId`s, and refuse two nodes naming one `changeInstanceId` with `execution_plan_node_duplicate`.
- [x] 4.7 Validate an `intent` node against the project catalog and the target-line catalog only, and prove it needs no Change to exist.
- [x] 4.8 Prove realization is a new revision: an `intent` node becoming a `change` node produces a new ordinal whose predecessor still reads as it was written.
- [x] 4.9 State and assert the ordinal collision semantics: two clones minting the same ordinal is an add/add Git conflict, surfaced by Git rather than resolved here, and local publication refuses an existing file.
- [x] 4.10 Add `test/core/store/store-execution-plans.test.ts` covering schema strictness, both node kinds, ordinal allocation and refusal, immutability across publications, every graph refusal, alias non-resolution, and realization.

## 5. Reference resolution and mutation validation

- [x] 5.1 Implement cross-ref blob reading: enumerate the Store's target-line catalogs, take each `storeRef`, and read candidate `.openspec.yaml` blobs under every project partition and every archive line with `git show <ref>:<path>`, checking nothing out and fetching nothing.
- [x] 5.2 Re-derive each candidate's `ChangeInstanceId` from its v2 identity block and match by derived identity, never by directory name, alias, or branch name.
- [x] 5.3 Add the second evidence source: locate an instance whose planning branch has not merged by reading child 4's machine workspace index, and record it as a local, non-portable locator with the stated lower authority.
- [x] 5.4 Implement the three distinct failure states — `unresolved` (no evidence), `ambiguous` (disagreeing or multiple claimants, all listed, none chosen), and unsearched ref (`store_query_ref_unreadable`, recorded in `unsearchedRefs` and setting `complete: false`) — and prove an unreadable ref never turns a real reference into `unresolved`.
- [x] 5.5 Implement `issue_record_divergent`: an Issue id whose records differ byte-wise across two Store refs lists both copies with their refs and presents neither as the record.
- [x] 5.6 Verify every `change` node at publication: exactly one match in this Store, the match's committed identity naming the node's project and target line, the project present in the project catalogs, and the target line present in the target-line catalogs.
- [x] 5.7 Refuse a reference whose committed identity names a different project or target line with `issue_reference_scope_conflict`, naming both values, and refuse an instance belonging to another Store with `issue_reference_foreign_store`.
- [x] 5.8 Prove referencing writes nothing into the referenced Change: the Change's `.openspec.yaml` and its whole directory are byte-identical before and after publication.
- [x] 5.9 Implement the derived reverse lookup — which Issues reference a given Change instance — computed at read time, memoized per invocation, and asserted to persist nothing.
- [x] 5.10 Add `test/core/store/store-issue-references.test.ts` covering cross-ref resolution, local-worktree resolution, all three failure states, divergence, every publication refusal, the untouched-Change assertion, and the derived reverse lookup.

## 6. StoreQueryModule and grouped aggregation

- [x] 6.1 Implement `listProjects` and `listTargetLines` as rollups over the Store's catalogs, reporting counts per project and per line and reporting a catalog that fails validation as an entry with its diagnostic rather than omitting it.
- [x] 6.2 Implement `listChanges` returning `groups` keyed by validated `(projectId, targetLineId)`, each group carrying its active and archived entries; assert no flat listing method exists on the Interface.
- [x] 6.3 Populate `AggregateChangeEntry` with the Change alias, the verified instance id, and an inert local locator, and `AggregateArchiveEntry` additionally with the finalization outcome and archive date read from the Archive v2 record.
- [x] 6.4 Report a relocated legacy v1 record found in a v2 partition as `outcome: null` with a `legacyRecord` note; never infer, default, or upgrade an outcome.
- [x] 6.5 Implement the `projects`, `targetLines`, `outcomes`, and `state` filters as narrowing only, with the query input type and the mutation scope type structurally unrelated so a filter cannot be passed where a mutation scope is required.
- [x] 6.6 Implement `listIssues`, `showIssue`, and `resolveExecutionPlan`, each returning per-node states and the same required `complete` flag and `unsearchedRefs` list.
- [x] 6.7 Derive Issue readiness — which nodes block which, and which are not started — and prove the derivation writes nothing to the Issue record; the Issue's own state stays operator-declared.
- [x] 6.8 Implement the per-invocation ref memo: one Store ref is read once per query, not once per node; assert no state survives the call and no cache file is written anywhere.
- [x] 6.9 Prove aggregation replays nothing: reading an Archive record performs no spec write, and every canonical spec under every project partition is byte-identical before and after a full aggregate query.
- [x] 6.10 Prove a query takes no lock, and that an aggregate query completes while another process holds the issue, scope, and change locks.
- [x] 6.11 Add `test/core/store/store-aggregate-query.test.ts` covering grouping across three projects and two lines, every filter, the archived and legacy-record paths, readiness derivation, the memo, the no-replay byte assertion, and the lock-free assertion.

## 7. Scope intent and locking

- [x] 7.1 Add a `store-issue` intent to `OpenPlanningScope` and the `issue`, `issue-record`, `execution-plans`, and `execution-plan` kinds to `StoreReadAddress` in `src/core/store-planning/types.ts`.
- [x] 7.2 Resolve the `store-issue` intent in `src/core/store-planning/internal/resolver.ts` from a Store selector, a binding, or a Store checkout, requiring no project and no target line and never inventing either.
- [x] 7.3 Prove the intent grants no project mutation authority: a project mutation attempted from a `store-issue` scope still fails with `project_scope_required`, and the Store aggregate rule child 2 shipped is unchanged.
- [x] 7.4 Prove a `store-issue` scope resolves from an execution worktree through its binding without requiring the user to change directory, and that it resolves the Store rather than the bound planning worktree.
- [x] 7.5 Implement the issue lock keyed `(storeUid, issueId)` as a digest of its canonically serialized material, under the machine root, through `acquireOwnerAwareFileLock` so a dead holder is stolen only on an affirmative `ESRCH`.
- [x] 7.6 Establish and assert the full acquisition order `issue → scope → workspace → change → integration`, and assert no path reaches back for an earlier lock while holding a later one, extending child 4's assertion rather than replacing it.
- [x] 7.7 Assert an Issue write takes only the issue lock, and that two Issues in one Store, and one Issue in two Stores, proceed concurrently.
- [x] 7.8 Retry contention within a bounded deadline naming the holder; never retry a semantic conflict.
- [x] 7.9 Add `test/core/store/store-issue-locks.test.ts` and extend `test/core/management-api/planning-scope-routing.test.ts` for the new intent, covering key derivation, the five-key order, concurrency, contention, and the no-authority assertion.

## 8. CLI surface

- [x] 8.1 Register `rasen store issue new|list|show|plan|state` with `--store`, `--title`, `--state`, `--reason`, `--project`, `--target-line`, `--add-change`, `--add-intent`, `--depends-on`, `--from-file`, and `--json`.
- [x] 8.2 Make the Issue group refuse to require `--project` or `--target-line` and assert it: an Issue command with only `--store` succeeds, and one that names a project uses it as a filter on read and never as a scope segment on write.
- [x] 8.3 Register `rasen store changes` with `--store`, `--project`, `--target-line`, `--outcome`, `--state`, and `--json`, printing the grouped result as groups rather than as a flat table.
- [x] 8.4 Register `rasen store projects` with `--store` and `--json`, printing the per-project and per-line rollup.
- [x] 8.5 State in each new group's first description sentence that an Issue is Store-level cross-project intent that references project Changes and owns none of them.
- [x] 8.6 Print pathspec-scoped commit suggestions for every Issue and revision write, and stage, commit, fetch, and push nothing from any command in this change.
- [x] 8.7 Report `unresolved`, `ambiguous`, `divergent`, unsearched refs, and `complete: false` in both the human and JSON forms, and assert human/JSON content parity.
- [x] 8.8 Update `src/core/completions/command-registry.ts`, the completion and help snapshots, and all three locale trees (`src/locales/{en,ja,zh-cn}.json`).
- [x] 8.9 Add `test/commands/store-issue-cli.test.ts` and `test/commands/store-aggregate-cli.test.ts` covering flag parsing, the no-project-required assertion, grouped output, refusal output, incomplete-result reporting, JSON/human parity, and the commit suggestions.

## 9. Management API surface

- [x] 9.1 Add `src/core/management-api/stores.ts` with handlers for `GET /api/v1/stores/:storeUid/issues`, `.../issues/:issueId`, `.../issues/:issueId/plans/:revisionId`, `.../projects`, and `.../projects/:projectId/lines/:targetLineId/changes`, each computed from a fresh read at request time.
- [x] 9.2 Add `POST /api/v1/stores/:storeUid/issues`, `POST /api/v1/stores/:storeUid/issues/:issueId/plans`, and `POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes`, each mutating exclusively by spawning the CLI under the admission whitelist, and register all three in `src/core/management-api/whitelist.ts`. The `bounded-cli` tier's exact-count assertion in `test/core/management-api/workflow-whitelist.test.ts` is **fifteen** after `store-finalization-outcomes-v2` added `finalize-change`, so this change extends it to eighteen — by enumerating each new op with its reason, never by relaxing the list to a prefix or a tier-wide exemption.
- [x] 9.3 Register the route family in `src/core/management-api/router.ts` with the same loopback bind, bearer requirement, and single-trailing-slash tolerance every other management path has, and reject unadmitted methods with 405 `method_not_allowed` without touching a file.
- [x] 9.4 Refuse a scoped mutation whose path omits a scope segment, and refuse one naming a project or target line the Store's catalogs do not declare, before any subprocess is spawned and before any file is touched.
- [x] 9.5 Prove no scope segment is ever completed from a query filter, a session, the launch project, or a previously viewed selection, with a case for each of the four sources.
- [x] 9.6 Prove the Issue endpoints require the Store and do **not** require a project or target line, so the rule is "the scope the operation needs, complete" rather than "always name a project".
- [x] 9.7 Resolve `:storeUid` as the Store's stable identity, never as the `store:<id>` space selector's local id, and refuse a UID that resolves to no registered Store.
- [x] 9.8 Return the same `complete` flag, `unsearchedRefs`, and per-node states the module produces, and assert the API response and the CLI `--json` output carry identical content for the same inputs.
- [x] 9.9 Add `test/core/management-api/stores-api.test.ts` covering every route, auth, method rejection, trailing slash, fresh read, the four inference refusals, the Issue no-project case, the unknown-UID refusal, and CLI/API content parity.

## 10. UI aggregation and the wire-type mirror

- [x] 10.1 Add every new wire type to `src/core/management-api/wire-types.ts` and mirror each one by hand into `packages/ui/src/api/types.ts` in the same task, since the mirror has no build-time import path and drifts silently.
- [x] 10.2 Pin each mirrored type with a `satisfies <ResponseType>` fixture under `packages/ui/test/fixtures/` — `store-aggregate.ts` and `store-issues.ts` — with no `as` cast anywhere, so `tsc` is the drift tripwire.
- [x] 10.3 Render a Store v2 aggregate board grouped by project and target line, where every card states its project, target line, Change instance, and — for an archived entry — its finalization outcome.
- [x] 10.4 Replace the member chip row on a Store space whose Store declares layout v2, and leave it exactly as specified on a legacy flat Store space; assert both branches.
- [x] 10.5 Render the Store-space Issues view: the Issue list with state, and an Issue detail showing the latest Execution Plan revision's nodes, their kinds, their dependency edges, and a link from each `change` node to the owning project's Change.
- [x] 10.6 Show `unresolved`, `ambiguous`, and `divergent` as themselves on the node and the Issue, never as an empty cell or a zero.
- [x] 10.7 Show an explicit incomplete-result banner whenever `complete` is false, listing the unsearched refs; assert the banner appears rather than only that the field is set.
- [x] 10.8 Guard aggregate mutation: the create action stays disabled until the user has chosen a project and a target line explicitly, the chosen values come from the form and never from the board's current filter, and the request carries all three scope segments.
- [x] 10.9 Address the Store by UID through the single API client seam, and assert the UID is never derived from the `store:<id>` space selector.
- [x] 10.10 Add `packages/ui/test/board/store-aggregate-board.test.tsx` and `packages/ui/test/board/store-issues-view.test.tsx` covering grouping, card contents, the chip-row branch, node states, the incomplete banner, the disabled-until-complete guard, and the UID addressing assertion.

## 11. Integration, cross-platform, and gates

- [x] 11.1 Add `test/commands/store-v2-cross-project-journey.test.ts`: one migrated Store with three projects on two target lines, driven through Issue creation, an Execution Plan revision mixing `change` and `intent` nodes, Change creation in two projects, realization as a new revision, aggregate query, and Issue resolution.
- [x] 11.2 Prove the core proposition end to end: cross-project work exists as one Issue referencing three Changes, each Change has exactly one project owner, and no Change is owned by the Issue.
- [x] 11.3 Prove a Change referenced by an Issue is finalized independently, and that finalizing it changes the node's reported state without any write to the Issue or the revision.
- [x] 11.4 Prove a failure in one project's Change does not pollute another project's canonical specs, by byte-comparing every project's `specs/` across the journey.
- [x] 11.5 Prove a branch rename leaves every node reference resolvable, and that no code path parses a branch name for project, line, or Change identity.
- [x] 11.6 Prove this change adds no second route to finalization now that `store-finalization-outcomes-v2` has landed and `store_v2_finalization_unavailable` no longer exists: archiving a Change referenced by an Issue still requires one explicitly declared `--outcome` (`finalization_outcome_required` with no outcome) and still enforces the landed reachability proof unchanged; no Store Issue path, Execution Plan revision path, aggregate read, or Store-scoped change-creation path finalizes a Change, records an outcome, writes an Archive record, or applies a spec delta; and `finalize-change` remains the only `bounded-cli` op that reaches the finalization Module.
- [x] 11.7 Prove a Store aggregate still refuses project mutation: `project_scope_required` fires unchanged from every surface, including the new ones.
- [x] 11.8 Add `test/core/store/store-issue-windows-paths.test.ts` covering `path.win32` and `path.posix` address construction, mixed-case drive letters, separator forms, UTF-8 Chinese content with ASCII ids, and long paths.
- [x] 11.9 Run the affected store, store-planning, management-api, CLI, and UI suites and attribute any baseline failure without weakening a fail-closed gate.
- [x] 11.10 Run focused tests, TypeScript typecheck, lint, build, `rasen validate store-scoped-issues-management --strict`, and `git diff --check`; strictly decode every changed text file as UTF-8 and audit BOM, replacement characters, mojibake, and unrelated worktree changes.
- [x] 11.11 Before the archive step, run the pairwise requirement-title and scenario-set comparison against `rasen/specs/` plus children 3, 4, and 5's deltas, and confirm the `management-http-api` and `board-ui` MODIFIED blocks still byte-match their post-sibling canonical titles and repeat every current scenario.
