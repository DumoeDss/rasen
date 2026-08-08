# store-scoped-issues-management — implementation report (session 1)

**62 of 102 tasks complete.** The Store-level Issue resource model, the
Execution Plan revision model, reference resolution, `StoreQueryModule`, the
Issue lock, the CLI surface, and the management API route family are
implemented and green. The UI (section 10.3–10.10), the scope-intent wiring
(section 7.1–7.4), and the integration matrix (section 11.1–11.8) are not, and
each is listed below with the reason.

Nothing was shipped, archived, committed, or pushed. Everything is in the
working tree.

## 1. Task census

| Section | Complete | Of | Not complete |
|---|---|---|---|
| 1 Baseline, contracts, adapters | 5 | 8 | 1.1, 1.2, 1.5 (partial) |
| 2 Layout addressing and identifiers | 7 | 7 | — |
| 3 Issue records | 6 | 8 | 3.6 untested, 3.8 file name differs |
| 4 Execution Plan revisions | 9 | 10 | 4.8 |
| 5 Reference resolution | 8 | 10 | 5.3 untested, 5.10 file name differs |
| 6 StoreQueryModule | 10 | 11 | 6.10 |
| 7 Scope intent and locking | 2 | 9 | 7.1–7.4 BLOCKED, 7.6/7.7/7.9 untested |
| 8 CLI surface | 8 | 9 | 8.9 |
| 9 Management API | 5 | 9 | 9.5, 9.6, 9.8 implemented but unverified; 9.9 |
| 10 UI and the wire-type mirror | 2 | 10 | 10.3–10.10 |
| 11 Integration and gates | 0 | 11 | 11.1–11.8, 11.11; 11.9/11.10 partial |

### Section 7 is BLOCKED, not skipped

Tasks 7.1–7.4 add a `store-issue` intent to `PlanningIntent` /
`OpenPlanningScope` in `src/core/store-planning/types.ts` and resolve it in
`src/core/store-planning/internal/resolver.ts`. The lead's brief forbids editing
`resolver.ts` while a fixer holds child 4's files.

I deliberately did **not** land the type half alone. `StorePlanningResolver.open`
dispatches on `input.intent` with an if-chain whose final branch is
`creationCapability(resolved)`. Adding `'store-issue'` to the union without the
resolver arm would make a Store-level Issue scope silently resolve as a CHANGE
CREATION scope — a wrong answer that typechecks, which is worse than the
capability being absent. The two halves must land together.

The Issue Module does not depend on that intent today: it resolves its Store
through `src/core/store/issues/scope.ts`, the same shape
`rasen store target-line` uses. The intent is what lets *other* callers address
Store-level Issue content through the scope seam, and it is what tasks 7.3 and
7.4 assert about authority.

## 2. Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint src test` | clean |
| `pnpm run build` | clean |
| `test/core/store` + `test/core/store-planning` | **71 files, 1157 passed, 2 skipped, 0 failed** |
| `test/core/management-api` | **39 files, 480 passed, 1 skipped, 0 failed** |
| `test/core/completions` | **12 files, 322 passed, 13 skipped, 0 failed** |
| `node bin/rasen.js validate store-scoped-issues-management --strict` | `Change 'store-scoped-issues-management' is valid` |
| `git diff --check` | exit 0, no trailing whitespace, no blank line at EOF |

**No failing file.** The only `git diff --check` output was the repository-wide
`LF will be replaced by CRLF` advisory, which is emitted for files this change
never touched (`src/core/store-planning/internal/resolver.ts`,
`src/core/store/membership.ts`, …) and is a `core.autocrlf` property of the
checkout rather than a finding.

The full `pnpm test` was **not** run to completion in this session. The store,
store-planning, management-api, and completions suites — every suite this change
touches — were run in full and are listed above.

**Not run at all: the UI package's suites.** `packages/ui/node_modules` does not
exist in this worktree, so `packages/ui`'s own `tsc` and vitest cannot execute
here. The two `satisfies` fixtures (task 10.2) are therefore **written but
unexecuted**; they are the tripwire task 10.1 asks for, and nothing in this
session proved they compile. A successor with the UI package installed must run
them before trusting the mirror.

## 3. Mutation verification

Two guards were mutation-verified. Both times the production change was
reverted, exactly the intended test failed, and the file was restored.

| Guard | Mutation | Observed |
|---|---|---|
| `store-query-read-only-guard.test.ts` → "spawns no Git verb outside its declared read set" | added `'checkout'` to `STORE_QUERY_GIT_VERBS` | 1 of 10 failed, and it was that test |
| `store-aggregate-query.test.ts` → "reports an unreadable ref as unsearched rather than as absence" | made `RefReader.openRef` record an unresolvable ref as *searched* | 1 of 23 failed, and it was that test |

**Not mutation-verified**, and I am not claiming they discriminate:

- every test in `store-issue-layout.test.ts` and `store-execution-plans.test.ts`
  (pure-function suites; a mutation that compiles is hard to construct there,
  but that is a reason to be explicit rather than a reason to assume);
- the eighteen-op whitelist count and the "finalize-change is the only bounded
  op that reaches finalization" assertion in `workflow-whitelist.test.ts`;
- the `store issue` exemption assertions added to
  `test/core/completions/command-registry.test.ts`;
- every assertion in the Issue write/publish suite other than the unreadable-ref
  one.

One mutation attempt was **discarded as uninformative**: adding a `writeText`
method to `StoreQueryFileSystem` fails the *build*, not the guard, so it proves
nothing about the guard. It is recorded here so a reviewer does not repeat it.

## 4. Defects found and fixed

### In this change, found by its own tests

1. **`ResolvedIssueScope.checkoutRoot` reported a non-canonical spelling.**
   `git worktree list --porcelain` prints POSIX-separated paths on Windows, so
   the checkout root a write reported was `C:/Users/…` where every other surface
   says `C:\Users\…`. Every path this scope reports is an identity a caller
   compares. Fixed in `src/core/store/issues/scope.ts` by canonicalizing the
   chosen root through the filesystem adapter, with a resolved-literal fallback
   so a transient canonicalization failure cannot turn a resolvable scope into a
   refusal.

2. **An archived aggregate entry reported the entry DIRECTORY NAME as its
   Change alias.** `AggregateArchiveEntry.changeId` was
   `2026-08-07-telemetry-emit--94344b6993d4` rather than `telemetry-emit`, which
   would have rendered on every archived card. Fixed in
   `src/core/store/query/module.ts` (`aliasFromArchiveEntryName`). This reads a
   NAME out of a name, which is not the identity-from-a-path move layout v2
   forbids: identity already came from the committed metadata, and an alias is a
   name by definition. `entryName` is still carried separately.

### In a sibling's test helper — NOT fixed, needs a decision

`test/helpers/store-workspace-fixture.ts` `seedChange` hand-writes
`.openspec.yaml` with an **unquoted** `instanceSeed`. An all-numeric seed —
`'11'.repeat(16)` — therefore parses as a YAML **number**, `ChangeMetadataSchema`
rejects it with `expected string, received number`, and the Change becomes
**invisible to every reader that parses committed Change metadata**: child 5's
`searchSuccessor`, this change's `collectCommittedChanges`, and anything else
built on the same blob-reading shape.

This cost me an hour: six of my tests failed with "no groups at all" and
"reference unresolved" while the Git plumbing was demonstrably fine. I worked
around it by using seeds that contain a letter.

Two things a reviewer should decide, neither of which I did unilaterally:

- **The helper should quote the seed.** It is one line, but the file is child
  4/5's and other suites depend on its exact bytes.
- **Should a malformed blob be reported rather than skipped?** Today
  `changeEvidence` (mine) and `candidateFrom` (child 5's) both treat a blob that
  fails `ChangeMetadataSchema` as *not a candidate*. That is fail-open in the
  one direction this portfolio cares about: a Change with a corrupt identity
  block silently disappears from an aggregate rather than being reported. The
  production writer uses the schema plus a real YAML serializer, so the
  all-numeric case is a ~1-in-2-million minting accident rather than a routine
  one — but "rare and silent" is exactly the failure profile the completeness
  flag exists to prevent. I did not change the shared behaviour because it is
  child 5's contract as much as mine.

### Pre-existing, unrelated, reported for the record

`src/locales/ja.json` (3) and `src/locales/zh-cn.json` (4) contain U+FFFD
replacement characters **in `HEAD`**, in `learnedMaterialization.degradedRepair`
and two `tools`-validation strings. I verified my additions introduced none
(counts are identical before and after). This is the mangled-multibyte failure
mode the portfolio has hit before, already committed.

## 5. Design decisions a reviewer should look at

1. **The working tree is a third Issue source, and is excluded from
   divergence.** `rasen store issue new` writes and stages nothing, so an Issue
   is invisible to a committed-only read until someone commits it. `collectIssues`
   therefore reads the local checkout as a copy with `storeRef: null`, and
   `IssueSummary.uncommitted` reports it. Divergence is still decided over
   COMMITTED copies only, exactly as the requirement states ("two Store refs
   carry byte-differing records"). The proposal's "plus the local checkout"
   bullet is what this implements.

2. **`execution_plan_revision_exists` is a guard, not the ordinal collision
   path.** Allocation scans `plans/` and takes the next ordinal, so a revision a
   merge planted causes the next publication to allocate *past* it, leaving its
   bytes untouched — which is what "a published revision is never overwritten"
   actually means locally. The refusal covers the case allocation cannot see. My
   first version of that test asserted the wrong premise (planting `0002` and
   expecting a refusal); I rewrote it to assert both behaviours, and proved the
   refusal is reachable by blinding the plans listing rather than deleting the
   assertion.

3. **`create-scoped-change` is a separate whitelist op from `create-change`.**
   The older op takes its scope from the server's launch project; the new one
   requires Store, project, and line in the path and must never complete a
   missing segment. One entry could not express both authority requirements.
   Reasons for all three new ops are recorded in `whitelist.ts` and mirrored in
   the test's docblock. The count moved fifteen → eighteen.

4. **`StoreQueryModuleImpl` takes `addressBy: 'selector' | 'uid'` as an
   INSTANCE property.** The CLI accepts a display name or a stable identity; the
   management API accepts the stable identity only. Making it an instance
   property rather than a per-call flag means the API's client cannot forget it
   on one route.

5. **The Store aggregate query has its own Git adapter** rather than reusing
   child 5's read-only one, for the same reason child 5 declined to reuse child
   4's: the guard that keeps this surface read-only should have nothing to
   reason about outside its own directory.

## 6. Task 11.6 — the scope-boundary proof

The constraint was treated as a design input, not a late test. What exists today:

- `finalize-change` is still the only whitelist op whose name reaches
  finalization, asserted in `workflow-whitelist.test.ts`.
- The Issue Module's source guard forbids `archive-engine`, `specs-apply`,
  `archive-accounting`, `buildUpdatedSpec`, and `serializeArchiveV2` anywhere
  under `src/core/store/issues/**`, and forbids every writing Git verb.
- The query Module's guard forbids the same set plus every filesystem write, and
  its filesystem Interface has no write method at all.
- No Store route, Issue path, revision path, or aggregate read declares an
  outcome, produces an Archive record, or applies a spec delta; the archived
  half of a result is READ from a record child 5 produces.

What is **not** yet proven, and belongs to a successor: the positive half —
driving `archive` on a Change an Issue references and showing it still demands
one explicit `--outcome` and still enforces landed reachability. That is task
11.3/11.6's live half and needs the cross-project journey (11.1).

## 7. What the reviewer and shipper must know

- **Archive order is unchanged and load-bearing.** The `management-http-api`
  delta was authored against child 5's post-amendment scenario set and I did not
  touch it; `validate --strict` passes and the delta still byte-matches.
- **Two shared files were edited and need a merge check:**
  `src/core/management-api/whitelist.ts` (count 15 → 18, beneath child 5's
  `finalize-change`) and `src/core/management-api/router.ts` (a new route family
  registered beside the finalization one).
- **`src/core/store-planning/types.ts` was NOT edited.** The merge point the
  lead flagged is still untouched, because its resolver half is blocked.
- **Three existing test files were edited, all by enumeration:**
  `test/core/management-api/workflow-whitelist.test.ts` (count and reasons),
  `test/core/completions/command-registry.test.ts` (the store subcommand list
  and the `--store`/`--project` pairing exemption). The pairing exemption is
  enumerated per command with a recorded reason and carries a POSITIVE
  assertion — the four Issue commands that must not offer `--project` are
  asserted to not offer it — so the exemption cannot silently absorb a future
  project-scoped Store command.
- **The UI wire-type mirror is written but unexecuted.** See §2.
