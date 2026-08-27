# Handoff: implementer-1 (groups 1-5 COMPLETE)

Reason: beat-cap stand-down after DONE. Groups 1-5 are finished and ticked (13/17);
group 6 is operator-gated and untouched. This is a completion distillate, not a
mid-task rescue.

## Decisions

- **D1 suppresses TWO fields, not one.** The `project-binding` candidate drops both
  `projectId` AND `executionRoot` when the selected project root carries Store
  metadata. `mergeFacts` compares fields in a fixed order and throws on the first
  conflict, so the documented `projectId` collision was masking an identical
  `executionRoot` collision from the same root config. Fixing only the documented
  one leaves the planning-worktree seat still refusing.
- **D1 keys on "am I a Store root", not "is there a Store above me"** (`isStoreCheckoutRoot`,
  a direct `.rasen-store/store.yaml` stat). A project nested inside a Store checkout's
  directory tree is still a project and must keep its config fact.
- **D3 splits `selectProjectCatalog`**: it now only FINDS the catalog; the planning-bound
  gate moved to `assertProjectPlanningBound`. Two satisfiers - catalog `bound` (adoption,
  unchanged) or a recorded pair whose index entry, marker and association all AGREE on the
  store/project/target-line triple. Silence is not agreement; absence is not disagreement
  (a torn-down worktree leaves a stale index entry and must not become a hard conflict).
  The index is read only when the catalog does not already say `bound`.
- **D2's probe is opt-in and its default import is DEFERRED.** `StoreRootMatchOptions`
  carries the substitutable probe; the default resolves `gitCommonDir` via
  `await import('./git.js')` rather than a module-scope edge. The deferral is HYGIENE,
  not a fix - see eliminated hypotheses.
- **The probe cache is caller-owned, never module-level.** Worktree topology mutates under
  a running process (`workspace apply` adds one, cleanup removes one), so a process-lifetime
  cache could match a root against a layout that no longer exists.

## Dead ends / eliminated hypotheses

Six mechanistic arguments were refuted by experiment during this run. Do not re-litigate:

1. *D2's git spawns add latency that pushes `store-issue-status-cli` over its 60s budget.*
   REFUTED: without the diff the same file still blows the budget (64170ms vs 62868/65673ms).
   Only WHICH test times out moves.
2. *The new value-import of `productionStoreWorkspaceDependencies` into store-planning's
   dependencies creates a bad module edge.* REFUTED: reverting that whole file changed nothing.
3. *`listWorkspacePairs` does machine-state I/O on a Store-less path.* REFUTED structurally:
   `assertProjectPlanningBound` sits under `if (store)` -> layoutVersion 2 -> `if (projectSelector)`,
   so it never executes for a bare root.
4. *The `isRegisteredStoreRootPath` sync->async change reorders something.* REFUTED: the
   fixture writes no `rasen/config.yaml`, so `resolveStoreBinding` returns on an absent
   declaration before reaching it.
5. *A static `./git.js` edge in `identity.ts` breaks the archive engine.* This DID reproduce
   against the 14:49-era tree and remains a real, separate finding (LEAD's G2 engine-fragility
   item) - but it is NOT what broke `archive-consumer-integration` here.
6. *The `archive-consumer-integration` failures belong to this change at all.* REFUTED by the
   LEAD: the without-diff baseline on the CURRENT tree fails identically. The baseline had
   moved since 14:49.

Two instrument failures worth remembering: an env-switch neuter (`RASEN_DIAG_NEUTER_D2`) gave
inconsistent results across identical runs and could not be trusted; and the first neuter was
CONFOUNDED because it left the static git import in place while disabling only the logic.

## Working set

- `src/core/store-planning/internal/resolver.ts` - D1 fact suppression; `isStoreCheckoutRoot`;
  `assertProjectPlanningBound` + `notPlanningBound` + `pairNamesStore` + `readPairSideFact`;
  module-level `describePairDisagreement` / `pairSideAgrees`.
- `src/core/store-planning/internal/dependencies.ts` - `WorkspacePairSnapshot`, `listWorkspacePairs`.
- `src/core/store/identity.ts` - `findRegisteredStoreEntryAtRoot`, `readStoreMetadataAtRoot`,
  `storeMetadataMatchesEntry`, `probeThroughCache`, `defaultRepositoryIdentityProbe`.
- `src/core/store-planning/testing.ts` - one type re-export.
- Tests: `test/core/store-planning/store-scope-resolution-e2e.test.ts` (new, real-git, explicit
  per-test timeouts), plus additions to `store-planning.test.ts` and `store/identity.test.ts`.

## Open obligations (NOT done)

- **The true 693-file full run is DEFERRED to ship time on a quiet tree.** Not waived. It is
  not achievable with three agents sharing this tree: `build.js` `rm -rf`s the shared `dist/`
  before compiling, ~1272 leftover `rasen-*` temp fixtures drive EPERM/EBUSY, and 12+ real-CLI
  suites run on the 30s global default.
- **Known gap, logged not folded in:** `listWorkspacePairs(globalDataDir)` resolves machine
  coordination state by PARAMETER while tests redirect by ENV. A caller omitting `globalDataDir`
  would read the real machine index. The resolver threads it at its one call site, so exposure
  is limited.
- **Cache threading follow-up:** the probe cache only pays off if a caller resolving many roots
  threads a shared instance. The three sites are `doctor.ts`, `spaces.ts`,
  `learned-skills/context.ts`. Out of scope here by LEAD decision.
- Group 6 (6.1-6.3) is operator-gated. Note 6.2 is BLOCKED on a data decision: the `dmpi` pilot
  hits `split_planning_truth` because the `rasen-site` execution checkout carries its own
  committed `rasen/changes/` tree beside the Store copy.

## Next action

None required from this role. If a reviewer routes a fix back, start from the behaviour-change
callout in `design.md` (Risks / Trade-offs) - it is the one place a reviewer running the
execution-worktree seat will see a NEW refusal and need the explanation waiting.
