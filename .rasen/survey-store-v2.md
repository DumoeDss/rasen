# Survey: Store-v2 + Store Issues reference surface (0.1.7) vs 0.2.0

Surveyor: read-only. No source file was modified. This document is the only write.

## 0. Refs pinned for this survey

| Ref | Commit | Note |
|---|---|---|
| worktree HEAD | `eb16db63` | branch `feat/store-v2-foundation` |
| `origin/dev/0.2.0` | `657c546d` | port target |
| `origin/dev/0.1.7` | `a3f49007` | tag `v0.1.7`, read-only behavior reference |
| merge-base | `e62b101f` | `Sat Aug 1 2026` — `docs(readme): refresh examples and community links (#130)` |

### THE headline finding

```
git diff e62b101f origin/dev/0.2.0 -- src/core/store   →  EMPTY
```

**`src/core/store/` on 0.2.0 is byte-identical to the merge-base.** 0.2.0 has done zero work
inside the store directory since Aug 1. Every one of the 27,862 added lines in
`src/core/store/` is 0.1.7-only.

Consequence for planning: the collision is **not** inside `src/core/store/`. Store internals are
a greenfield drop onto an untouched base. The collision is entirely in the **consumer rim**
(CLI registration, management-api router/wire-types, UI api types, locales, archive engine)
where 0.2.0 has been building daemon/ECP/session-host.

`git diff --stat origin/dev/0.2.0 origin/dev/0.1.7 -- src/core/store` = **76 files, +27,862 / −103**.
0.1.7 has 89 files under `src/core/store/`; 0.2.0 has 19.

---

## 1. What "Store base v2" actually is on 0.1.7

### 1a. The pure contract layer — `planning-foundation.ts` barrel (Layer 0)

`src/core/store/planning-foundation.ts` (481 B, 12 lines) is a barrel whose docstring states the
rule: *"Pure Store-planning v2 contract boundary. Modules below contain no filesystem, registry,
cwd, environment, command, or Git-process access."* It re-exports exactly five files:

| File | bytes | LOC | Content |
|---|---|---|---|
| `planning-validation.ts` | 11,842 | 362 | id/text/state validators (`parseIssueId`, `parseTargetLineId`, `parseChangeId`, `parseExecutionPlanRevisionId`, portable-text rules) |
| `planning-catalogs.ts` | 12,524 | 421 | project catalog + target-line catalog record schemas, `validateProjectCatalogFilename` |
| `planning-identity.ts` | 10,470 | 327 | branded IDs + derive/verify: `PlanningScopeId`, `ChangeInstanceId`, `VerifiedChangeInstanceId`, `ChangeInstanceSeed`, `WorktreeInstanceId`, `WorkspacePairId`, `VerifiedWorkspacePairId`, `CanonicalLocalIdentity`; `derivePlanningScopeId` / `verifyPlanningScopeId` / `deriveChangeInstanceId` / `verifyChangeInstanceId` / `deriveWorktreeInstanceId` / `deriveWorkspacePairId` / `mintChangeInstanceSeed` / `changeInstanceDigestPrefix` |
| `planning-layout-v2.ts` | 11,952 | 366 | **the on-disk layout**, `StorePlanningLayoutV2Address` union + `resolveStorePlanningLayoutV2Path()` + `computeStorePlanningLayoutV2()`, branded `StorePlanningPath`, `flavor: 'native'\|'win32'\|'posix'` |
| `finalization-v2.ts` | 14,881 | 482 | finalization contract types |

**Layer-0 verification (positive):** grepped every import in these five files. They reach only
`../canonical-json.js`, `../id.js`, `../zod-issues.js`, `../config.js`, `../change-metadata/index.js`,
`./errors.js`, `./foundation.js`, `./identity-types.js` and each other. **No** `workspace/`,
`query/`, `issues/`, or `layout-migration/` import. This layer is genuinely independently
shippable.

### 1b. The v2 on-disk layout (verbatim from `resolveStorePlanningLayoutV2Path`)

```
<storeRoot>/.rasen-store/store.yaml                                   store-metadata
<storeRoot>/.rasen-store/projects/<projectId>.yaml                    project-catalog
<storeRoot>/.rasen-store/target-lines/<targetLineId>.yaml             target-line-catalog
<storeRoot>/rasen/design-docs/                                        store-design-docs
<storeRoot>/rasen/issues/<issueId>/                                   issue
<storeRoot>/rasen/issues/<issueId>/issue.yaml                         issue-record
<storeRoot>/rasen/issues/<issueId>/plans/                             execution-plans
<storeRoot>/rasen/issues/<issueId>/plans/<revisionId>.yaml            execution-plan
<storeRoot>/rasen/projects/<projectId>/                               project-home
<storeRoot>/rasen/projects/<projectId>/specs/                         project-specs
<storeRoot>/rasen/projects/<projectId>/design-docs/                   project-design-docs
<storeRoot>/rasen/projects/<projectId>/changes/<changeId>/            active-change
<storeRoot>/rasen/projects/<projectId>/changes/archive/<targetLineId>/            archive-line
<storeRoot>/rasen/projects/<projectId>/changes/archive/<targetLineId>/<archiveDate>-<changeId>--<digestPrefix>/   archive-entry
```

Notes that matter to the port:
- `storeRoot` must be **absolute** or the resolver throws `invalid_store_layout_v2` ("so resolution
  never depends on cwd").
- Every address is its own case — *"no caller appends a filename to a returned directory."*
- The four `issue*` addresses are the only ones taking neither project nor target line.
- Paths are computed under a **path flavor** (`native`/`win32`/`posix`) so Windows path semantics
  are testable cross-platform. There are dedicated `*-windows-paths.test.ts` suites.

### 1c. The rest of Store-v2 inside `src/core/store/`

New flat files (all 0.1.7-only):

| File | bytes | LOC |
|---|---|---|
| `target-lines.ts` | 21,087 | 569 |
| `consistency-gates.ts` | 14,298 | 386 |
| `migration-ops-v2.ts` | 14,333 | 389 |
| `layout-write-guard.ts` | 10,026 | 255 |
| `membership-layout.ts` | 6,960 | 210 |

New subdirectories (all 0.1.7-only):

| Dir | files | LOC |
|---|---|---|
| `layout-migration/` | 15 | 7,575 |
| `workspace/` | 13 | 6,445 |
| `finalization/` | 12 | 4,785 |
| `issues/` | 11 | 2,325 |
| `query/` | 7 | 2,277 |

Modified pre-existing files (the entire in-directory collision surface — **779 lines of churn total**):

| File | churn | What |
|---|---|---|
| `migration-ops.ts` | 424 | v2-aware migration ops |
| `membership.ts` | 209 | v2 membership layout |
| `operations.ts` | +68 | v2 lifecycle hooks |
| `project-records.ts` | 32 | |
| `bootstrap.ts` | 27 | |
| `foundation.ts` | +18 | |
| `index.ts` | **+1** | exactly one line: `export * from './planning-foundation.js';` |

### 1d. Store-v2 pieces that live OUTSIDE `src/core/store/`

| Path | LOC | On 0.2.0? |
|---|---|---|
| `src/core/store-planning/` (6 files) | 3,787 | **absent** |
| ↳ `internal/resolver.ts` alone | 3,029 | absent |
| ↳ `types.ts` / `internal/dependencies.ts` / `diagnostics.ts` / `index.ts` / `testing.ts` | 331 / 295 / 99 / 15 / 18 | absent |
| `src/core/canonical-json.ts` | 14 | **absent** |
| `src/core/archive-accounting-v2.ts` | 10,998 B | **absent** |

`src/core/store-planning/` is the planning-scope resolver (which planning root / which store /
which target line a command runs against). It is consumed by `root-selection.ts`,
`references.ts`, `session-runtime-context.ts`, `working-set.ts`, `config-api/project-addressing.ts`,
`management-api/{project-space,sessions}.ts`, `commands/{context,pipeline}.ts`, and — inside the
store dir — **only** by `store/finalization/module.ts`.

(Verified negative: `issues/locks.ts`, `workspace/index.ts`, `workspace/types.ts`,
`layout-migration/flat-source.ts` mention `store-planning` only in **comments**, not imports.)

---

## 2. `src/core/store/issues/` — file by file

Total **11 files, 2,325 LOC, 84,975 bytes**. Module docstring in `types.ts` states two invariants
the whole module rests on: *"A mutation refuses; a query reports"* and *"Reference, never
containment, and never a back-reference."*

| File | bytes | LOC | Symbols / role |
|---|---|---|---|
| `types.ts` | 9,255 | 251 | `IssueRecordV1`, `ExecutionPlanRevisionV1`, `IssueState`, `ExecutionPlanNode` (= `ExecutionPlanChangeNode` \| `ExecutionPlanIntentNode`), `ExecutionPlanNodeInput`, `ExecutionPlanDraft`, `StoreIssueErrorCode` (closed 16-code refusal taxonomy), `CreateIssueInput` / `SetIssueStateInput` / `PublishExecutionPlanInput`, `IssueWriteReport`, `SuggestedIssueCommit`, `StoreIssues` interface |
| `module.ts` | 16,240 | 441 | `class StoreIssuesModule implements StoreIssues` + `StoreIssuesModuleInstance` singleton. Public: `create`, `setState`, `publishPlan`. Private: `withWriteLock`, `openWriteScope`, `requireRecord`, `allocateOrdinal`, `verifyReferences`, `report` |
| `plans.ts` | 14,816 | 460 | `normalizePlanNodes` (node normalizer), `checkExecutionPlanGraph` + `GraphViolation` (graph/cycle checker), `executionPlanDigest` (revision digest), `parseExecutionPlanRevision` / `serializeExecutionPlanRevision` / `validateExecutionPlanRevision` (Plan serializer, Zod + yaml) |
| `locks.ts` | 11,781 | 310 | Issue lock protocol: `STORE_LOCK_ORDER`, `withIssueLock`, `withIssueLockBatch`, `issueLockKey/Path/FileName/Held`, `issueLockCanonicalBytes`, `heldIssueLockKeys`, `heldStoreLockKinds`, `assertIssueAcquisitionOrder`, `assertStoreLockOrderAgreesWithWorkspace`. Uses `AsyncLocalStorage` + `node:crypto` |
| `scope.ts` | 7,598 | 207 | `resolveIssueScope` (write-location rule), `issueAddresses`, `issuePathspec`, `revisionAddress`, `ResolvedIssueScope` |
| `reference-verification.ts` | 6,799 | 156 | `verifyExecutionPlanReferences` — resolves `changeInstanceId` against committed Store refs; refuses on unresolved/ambiguous/scope-conflict/foreign-store |
| `records.ts` | 6,266 | 181 | Issue serializer + validators: `ISSUE_STATES`, `TERMINAL_ISSUE_STATES`, `isPermittedIssueTransition`, `validateIssueRecord`, `validateIssueRecordLocation`, `parseIssueRecord`, `serializeIssueRecord`, `assertPortableIssueText` (rejects control chars, absolute paths, embedded credentials) |
| `migration-compiler.ts` | 3,337 | 110 | `compileMigrationIssueTree` + `CompiledMigrationIssueTree/File`, `MigrationIssueFileRole`, `MigrationIssueInput` |
| `dependencies.ts` | 2,616 | 70 | `productionStoreIssueDependencies`, `withDeterministicIssueClock`, `StoreIssueDependencies` (injection seam) |
| `diagnostics.ts` | 2,364 | 71 | `StoreIssueError`, `isStoreIssueError`, `issueError`, `issueRefusal` |
| `index.ts` | 1,753 | 68 | public barrel |

### Correction to the task brief

`StoreIssues` is **`create` / `setState` / `publishPlan` only** — there is no `list` or `show` on it.
The reads live in a *separate* module, `src/core/store/query/` (`StoreQueryModuleImpl`, exported as
`StoreAggregateQuery`), whose methods are `listProjects`, `listTargetLines`, `listChanges`,
**`listIssues`**, `issuesReferencing`, **`showIssue`**, `resolveExecutionPlan`. `query/issues-read.ts`
holds `collectIssues`, `readRevision`, `divergenceOf`, `presentedRecord`.

That split is the *"a mutation refuses; a query reports"* invariant made structural — and it means
**issues and query cannot be separated into different slices** (see 2b).

### 2a. `issues/` outward dependencies (grepped, exhaustive)

- `../planning-validation.js`, `../planning-identity.js`, `../planning-foundation.js` — Layer 0
- `../query/dependencies.js`, `../query/refs.js`, `../query/references.js` — **query**
- `../workspace/dependencies.js`, `../workspace/locks.js`, `../workspace/binding.js`, `../workspace/registry.js` — **workspace**
- `../registry.js`, `../errors.js` — already on 0.2.0
- `../../canonical-json.js` (**absent on 0.2.0**), `../../file-state.js` (present), `../../zod-issues.js` (present)
- `node:async_hooks`, `node:crypto`, `node:fs`, `node:path`, `yaml`, `zod`

### 2b. `query/` → `issues/` — a genuine directory-level CYCLE

```
issues/dependencies.ts        → query/dependencies.js
issues/module.ts              → query/refs.js
issues/reference-verification → query/{refs,references,dependencies}.js
issues/scope.ts               → query/{refs,dependencies}.js

query/issues-read.ts          → issues/{records,plans,types}.js
query/module.ts               → issues/types.js
query/refs.ts                 → issues/diagnostics.js
query/types.ts                → issues/types.js
```

**`issues/` and `query/` must ship in the same slice.** This is the single hardest constraint in
the decomposition.

### 2c. Issues + query test files

| Test file | test cases |
|---|---|
| `test/core/store/store-aggregate-query.test.ts` | 24 |
| `test/core/store/store-execution-plans.test.ts` | 21 |
| `test/core/store/store-issue-layout.test.ts` | 20 |
| `test/core/store/store-issue-locks.test.ts` | 19 |
| `test/core/store/store-query-read-only-guard.test.ts` | 10 |
| `test/core/store/store-issue-scope-intent.test.ts` | 7 |
| `test/core/store/store-query-lock-free.test.ts` | 5 |
| `test/core/store/store-issue-migration-compiler.test.ts` | 4 |
| **subtotal (core)** | **110** |
| `test/commands/store-issue-cli.test.ts` | (CLI journey) |
| `test/commands/store-aggregate-cli.test.ts` | (CLI journey) |
| `packages/ui/test/board/store-issues-view.test.tsx` | UI |
| `packages/ui/test/board/store-aggregate-board.test.tsx` | UI |

---

## 3. What 0.2.0 already has, and the concrete divergence

### 3a. 0.2.0 `src/core/store/` — 19 files (= merge-base, unchanged)

`bootstrap.ts` (127,911 B) · `errors.ts` · `foundation.ts` (29,404) · `git.ts` ·
`identity-diagnostics.ts` · `identity-migration.ts` · `identity-types.ts` · `identity.ts` ·
`index.ts` · `inspection.ts` · `membership.ts` (36,428) · `migration-ops.ts` (58,989) ·
`migration.ts` · `operations.ts` (69,842) · `project-records.ts` · `registry.ts` · `remote.ts` ·
`upgrade-identity.ts` · `worktree-inventory-cache.ts`

Model: v1 flat store — `StoreMetadataState` (V1/V2) in `.rasen-store/store.yaml`,
`StoreRegistryState` in the global `registry.yaml`, `resolveStoreBinding()` as the sole identity
resolver. Serializer: yaml via `foundation.ts` / `registry.ts`.
**Lock: none in `src/core/store/`** — 0.2.0 has no `workspace/locks.ts`, no `issues/locks.ts`, no
`STORE_LOCK_ORDER`. **Nothing named "issues" exists anywhere under 0.2.0's `src/core/store/`.**

### 3b. Collision surface for the port

**Category A — free drop (0.2.0 untouched since merge-base; a port here cannot conflict with 0.2.0's work):**

- **all 89 files of `src/core/store/**`** — including the 7 "modified" files, because 0.2.0 never
  touched them. The 779 lines of in-directory churn apply cleanly against 0.2.0's current bytes.
- `src/core/store-planning/**`, `src/core/canonical-json.ts`, `src/core/archive-accounting-v2.ts` (absent on 0.2.0 → pure add)
- `src/commands/`: `store-issue.ts` (+467), `workspace.ts` (+377), `store-migrate-layout.ts` (+291),
  `store-target-line.ts` (+203), `store-aggregate.ts` (+183), `store.ts` (+39), `store-migration.ts` (+7),
  `context.ts` (+184), `doctor.ts` (+178), `work.ts`, `show.ts`, `change.ts`, `spec.ts`,
  `workflow/{instructions,shared,status}.ts`, `retain.ts`
- `src/core/management-api/`: `stores.ts` (+671 NEW), `finalize.ts` (+910 NEW), `project-space.ts` (+172 NEW),
  `archive.ts`, `changes.ts`, `sessions.ts`, `spaces.ts`, `submit.ts`, `task-detail.ts`, `whitelist.ts`,
  `session-launch-context.ts`
- `src/core/`: `references.ts`, `root-selection.ts` (+593), `session-runtime-context.ts`, `working-set.ts`
- `src/core/config-api/project-addressing.ts`, `src/core/completions/shared-flags.ts`
- `packages/ui/src/components/{StoreAggregateBoard,StoreIssuesView}.tsx`, `packages/ui/src/board/columns.ts`

**Category B — TRUE COLLISION (both lines changed since merge-base). This is what the port must MODIFY, not add:**

| File | 0.1.7 churn | 0.2.0 churn | Risk |
|---|---|---|---|
| `src/core/management-api/router.ts` | +267 | +798 | **HIGH** — 0.2.0 added run-control / reusable-session / hosted-session routes; 0.1.7 added store/finalize/planning routes |
| `src/core/management-api/wire-types.ts` | +263 | +493 | **HIGH** |
| `packages/ui/src/api/types.ts` | +290 | +991 | **HIGH** (wire-type mirror) |
| `src/core/management-api/supervisor.ts` | +35 | +822 | MED (0.1.7 side small) |
| `src/core/management-api/runs.ts` | +65 | +577 | MED |
| `src/core/completions/command-registry.ts` | +279 | changed | MED — new store subcommands |
| `src/cli/index.ts` | +65 | changed | MED — `registerStoreCommand` tree grows |
| `src/commands/pipeline.ts` | +101 | changed | MED |
| `src/core/archive-engine.ts` / `archive.ts` | changed | changed | MED — finalization + layout-migration import `archive-engine` 5×; `archive-accounting.ts` and `specs-apply.ts` also differ between branches |
| `src/locales/{en,ja,zh-cn}.json` | changed | changed | LOW but 3-locale lockstep required |
| `packages/ui/src/i18n/locales/*.json` | changed | changed | LOW, lockstep |
| `src/core/index.ts` | +2 | changed | LOW |
| `src/core/project-config.ts` | +27 | changed | LOW |
| `src/core/validation/validator.ts`, `src/commands/validate.ts` | changed | changed | LOW |
| `src/core/templates/workflows/store-selection.ts` + siblings | changed | changed | LOW-MED (skill instruction text) |
| `packages/ui/src/api/client.ts`, `config/controls.ts`, `components/TaskDetailPage.tsx` | changed | changed | LOW |

---

## 4. Callers / blast radius on 0.2.0

75 files under `src/` on 0.2.0 import `core/store`. Grouped:

- **commands** (14): `store.ts`, `store-migration.ts`, `bootstrap.ts`, `bootstrap-messages.ts`,
  `context.ts`, `doctor.ts`, `knowledge.ts`, `pipeline-messages.ts`, `shared-gather.ts`,
  `shared-output.ts`, `workflow/instructions.ts`, `workset.ts`, `workset-input.ts`, `workset-prompts.ts`
- **management-api** (3): `create-space.ts`, `session-launch-context.ts`, `spaces.ts`
- **archive**: `archive-engine.ts`, `archive-accounting.ts`
- **config/identity**: `effective-config.ts`, `project-config.ts`, `project-registry.ts`,
  `config-api/{config-context,project-addressing}.ts`, `root-selection.ts`, `references.ts`,
  `relationship-health.ts`, `workspace-root.ts`, `openers.ts`, `file-state.ts`
- **learned-skills** (10 files) + **knowledge-bundle** (2) + `project-knowledge-home.ts`,
  `project-learned-skill-ledger.ts`
- **working set**: `working-set.ts`, `worksets.ts`
- **pipeline**: `pipeline-registry/execution-binding.ts`
- **templates** (24 workflow templates) — these consume store *vocabulary*, not the API; they are
  skill instruction text and change when store nouns change

**Touched by a store base v2 model change specifically:** `effective-config.ts`,
`project-config.ts`, `project-registry.ts`, `root-selection.ts`, `references.ts`,
`working-set.ts`, `archive-engine.ts`, `archive-accounting.ts`, `config-api/project-addressing.ts`,
`management-api/{create-space,spaces,session-launch-context}.ts`, and the whole `learned-skills/`
cluster (it resolves store-scoped skill directories off the store layout).

Note: 0.1.7 also introduced `src/core/omp/` (277 LOC) and `src/core/runtimes/` (380 LOC), both
absent from 0.2.0; `runtimes/session-stores.ts` (241 LOC) is store-adjacent.

---

## 5. Test surface

### 5a. 0.1.7-new tests (99 new `.test.ts`/fixture files since merge-base; store-v2 share ≈ 78)

| Location | new files | note |
|---|---|---|
| `test/core/store/` | **50** | 0.1.7 has 75 files here, 0.2.0 has 25 |
| `test/core/store-planning/` | 3 | `store-planning.test.ts` alone is 49,666 B |
| `test/commands/` (store-v2) | 13 | `store-v2-acceptance-matrix`, `store-v2-{cross-project,finalization,migration,planning-scope,workspace}-journey`, `store-v2-workspace-concurrency`, `store-issue-cli`, `store-aggregate-cli`, `store-target-line-cli`, `store-migrate-layout-cli`, `workspace-cli`, `context-workspace` |
| `test/core/management-api/` | 3 | `stores-api`, `store-finalize-api`, `planning-scope-routing` |
| `test/core/` (top) | 3 | `archive-engine-finalization-seams`, `archive-planning-recovery`, `store-v2-action-context-grant` |
| `test/core/templates/` | 2 | `legacy-store-gate-guard`, `planning-scope-guidance` |
| `test/helpers/` | 4 | `store-workspace-fixture`, `store-finalization-fixture`, `finalization-memory-git`, `layout-migration-fixture` |
| `packages/ui/test/` | 5 | `board/store-issues-view.test.tsx`, `board/store-aggregate-board.test.tsx`, `api/wire-mirror-parity.test.ts`, `fixtures/store-{issues,aggregate}.ts` |
| `test/fixtures/` | ~8 | `layout-migration/scene-bridge/**`, `management-api/finalization-cli.mjs` |

Largest new suites by bytes: `layout-migration-apply-recovery` 70,169 · `store-planning` 49,666 ·
`finalization-plan-token` 49,412 · `layout-migration-mapping` 34,571 · `workspace-atomic-write` 33,798 ·
`finalization-association` 31,819 · `store-aggregate-query` 31,786 · `workspace-cleanup` 31,864.

Base-layer test-case counts: `target-lines` 23 · `planning-identity-v2` 11 ·
`store-v2-consistency-gates` 11 · `planning-layout-v2` 10 · `planning-validation-v2` 4 ·
`planning-foundation-consumer` 1 → **60**.

### 5b. 0.2.0 suites that must stay green

- `test/core/store/` (25 files): `bootstrap*` (4), `identity*` (5), `membership*` (2),
  `migration-ops`, `migration`, `foundation`, `git*` (3), `registry*` (2), `project-record*` (2),
  `remote`, `legacy-metadata`, `register-existing-store-data-dir`, `worktree-inventory-cache`
- `test/commands/` store suites (11): `store.test.ts`, `store-add-project`, `store-git`,
  `store-identity-cli`, `store-membership-cli`, `store-migration-cli`, `store-references`,
  `store-remote`, `store-root-selection`, `declared-store-fallback`, `pipeline-store-root-selection`
- `test/core/change-run/**` — 0.2.0's heaviest active area (45 changed files in `src/core/change-run`)
- plus `src/core/session-host` (42), `frozen-action-executor` (15), `pipeline-registry` (17),
  `management-api` (17) — all 0.2.0-only work that must not regress

### 5c. Runner conventions (`vitest.config.ts`, verified)

- `include: ['test/**/*.test.ts']` → **`packages/ui` is excluded from the root config**.
  UI tests need `pnpm -C packages/ui exec vitest run`. Running
  `pnpm exec vitest run packages/ui/test/` silently executes 0 tests and prints "passed".
- `pool: 'forks'`, `maxWorkers = min(4, cpus)`, override via `VITEST_MAX_WORKERS`
- `testTimeout`/`hookTimeout` 30 s; `globalSetup: ./vitest.setup.ts`;
  `setupFiles: ./test/setup-reset-diagnostics.ts`
- CI sharding via `VITEST_FILE_PARTITION=<i>/<n>`, weighted by `KNOWN_SLOW_TEST_WEIGHTS_MS`.
  That table is on both branches and **already names 0.1.7 store suites**
  (`store-identity-cli` 90 s, `store-remote` 70 s, `store.test.ts` 64 s, `store-root-selection` 48 s).
  Adding ~78 store suites will need new weights or macOS/Windows shards will skew.

---

## 6. Recommended seams

Verified dependency layering inside `src/core/store/` (each edge grepped):

```
Layer 0  planning-{validation,catalogs,identity,layout-v2} + finalization-v2 + planning-foundation
         + src/core/canonical-json.ts
              ↑ no store-internal deps beyond errors/foundation/identity-types
Layer 1  workspace/ (13 files)            ← Layer 0
         target-lines.ts                  ← Layer 0 + workspace/
Layer 2  issues/ (11) ⇄ query/ (7)        ← Layer 0 + workspace/     [CYCLE — inseparable]
Layer 3  finalization/ (12)               ← Layer 0/1 + archive-engine + archive-accounting-v2
                                            + specs-apply + store-planning/
Layer 4  layout-migration/ (15)           ← Layer 0/1/2 + archive-engine + archive-accounting-v2
         layout-write-guard.ts            ← layout-migration/receipt.ts
Cross    consistency-gates.ts, membership-layout.ts, migration-ops-v2.ts
Aside    src/core/store-planning/ (3,787) ← consumed by root-selection/references/working-set/
                                            session-runtime-context/config-api + finalization/module
```

### Proposed slices

**S1 — Store planning contract v2 (Layer 0)**
- Delivers: branded IDs, id/text validators, catalog schemas, the v2 on-disk layout resolver,
  finalization contract types. Pure, no FS/git.
- Touches: `src/core/store/planning-{validation,catalogs,identity,layout-v2}.ts`,
  `finalization-v2.ts`, `planning-foundation.ts`, `src/core/canonical-json.ts`,
  `src/core/store/index.ts` (+1 line), `test/core/store/planning-*.test.ts` (4 files),
  `test/core/store/store-v2-consistency-gates.test.ts` if `consistency-gates.ts` rides along.
- Depends on: nothing.
- Overlap with siblings: **only `src/core/store/index.ts`** (a single export line). Positive
  independence proof: `git grep` shows these 6 files import no other Store-v2 module.
- Specs: `store-planning-identity-v2` (6 req), `store-planning-layout-v2` (9 req) ≈ 20.6 KB.
- Size: ~1,970 LOC src + ~35 KB tests (60 test cases).

**S2 — Workspace bindings + target lines (Layer 1)**
- Delivers: planning worktree bindings, workspace locks/registry/binding/cleanup/plan/apply,
  target-line catalog operations.
- Touches: `src/core/store/workspace/**` (13), `src/core/store/target-lines.ts`,
  `src/core/store/membership-layout.ts`, `src/commands/workspace.ts`,
  `src/commands/store-target-line.ts`, `test/core/store/workspace-*.test.ts` (11) +
  `target-lines.test.ts`, `test/helpers/store-workspace-fixture.ts`,
  `test/commands/{workspace-cli,context-workspace,store-target-line-cli,store-v2-workspace-journey,store-v2-workspace-concurrency}.test.ts`
- Depends on: **S1**.
- Overlap: `src/commands/store.ts` (registration lines), `src/core/store/membership.ts`.
  Otherwise disjoint from S3/S4/S5.
- Specs: `store-planning-worktree-bindings` (14 req, 28 KB), `store-target-lines` (4 req).
- Size: ~7,200 LOC src + ~210 KB tests.

**S3 — Store Issues + aggregate query (Layer 2) — the direction's named target**
- Delivers: `IssueRecordV1`, `ExecutionPlanRevisionV1`, issue lock protocol, plan graph checker +
  revision digest, reference verification, `StoreIssues.{create,setState,publishPlan}`,
  `StoreAggregateQuery.{listIssues,showIssue,issuesReferencing,resolveExecutionPlan,listProjects,listTargetLines,listChanges}`.
- Touches: `src/core/store/issues/**` (11) **+ `src/core/store/query/**` (7) — these MUST be one
  slice (proven cycle, §2b)**, `src/commands/store-issue.ts`, `src/commands/store-aggregate.ts`,
  `src/core/management-api/stores.ts`, `packages/ui/src/components/{StoreIssuesView,StoreAggregateBoard}.tsx`,
  8 core test files (110 cases) + 2 CLI suites + 4 UI test/fixture files.
- Depends on: **S1 + S2** (issues imports `workspace/{dependencies,locks,binding,registry}`).
- Overlap: `src/core/management-api/{router,wire-types}.ts` (Category-B HIGH),
  `packages/ui/src/api/types.ts` (Category-B HIGH), `src/cli/index.ts`,
  `src/core/completions/command-registry.ts`, locales × 6. **Every one of those is also touched by
  S4/S5's CLI+API surface → serial with any sibling that registers commands or routes.**
- Specs: `store-issue-resources` (11 req, 26 KB), `store-aggregate-query` (7 req, 10 KB).
- Size: ~4,600 LOC src + ~100 KB tests.

**S4 — Finalization v2 (Layer 3)**
- Delivers: change finalization / association / successor / reachability / spec-actions on the v2 layout.
- Touches: `src/core/store/finalization/**` (12), `src/core/store-planning/**` (6),
  `src/core/archive-accounting-v2.ts`, `src/core/management-api/finalize.ts`,
  `src/core/management-api/project-space.ts`, `src/core/root-selection.ts`,
  `src/core/references.ts`, `src/core/session-runtime-context.ts`, `src/core/working-set.ts`,
  `src/core/config-api/project-addressing.ts`, 12 `finalization-*.test.ts` +
  3 `test/core/store-planning/` + `store-finalize-api` + `planning-scope-routing` +
  `archive-engine-finalization-seams` + `archive-planning-recovery`.
- Depends on: **S1 + S2**. Does **not** depend on S3 (no `finalization/ → issues/` import found).
- Overlap: `src/core/archive-engine.ts` + `src/core/archive.ts` (Category-B), `src/commands/store.ts`.
  Disjoint from S3's `issues/`+`query/` dirs → **S3 ∥ S4 is possible at the directory level, but
  they collide on `management-api/router.ts` + `wire-types.ts` + `cli/index.ts`.**
- Specs: `store-planning-scope-routing` (9 req, 21 KB).
- Size: ~8,600 LOC src + ~250 KB tests.

**S5 — Layout migration v1→v2 (Layer 4)**
- Delivers: migration plan/apply/receipt/evidence/mapping/inventory, `layout-write-guard`,
  `migration-ops-v2`, `consistency-gates`.
- Touches: `src/core/store/layout-migration/**` (15), `layout-write-guard.ts`,
  `migration-ops-v2.ts`, `consistency-gates.ts`, `src/commands/store-migrate-layout.ts`,
  `src/core/store/{migration-ops,membership,bootstrap,operations,project-records,foundation}.ts`
  (the 779-line in-dir churn lands mostly here), 11 `layout-migration-*.test.ts` +
  `layout-no-dual-write` + `migration-ops-*` (3) + `test/fixtures/layout-migration/**` +
  `test/helpers/layout-migration-fixture.ts`, `test/commands/store-v2-migration-journey.test.ts`.
- Depends on: **S1 + S2 + S3** (imports `issues/{migration-compiler,plans,records,reference-verification,locks,dependencies,types}`
  and `query/{refs,dependencies}`) **and reads `finalization` receipts** — treat as depending on all.
- Overlap: heavy — it is the only slice that rewrites the pre-existing store files.
- Specs: `store-layout-v2-migration` (12 req, 45 KB — the single largest), `store-v2-consistency-gates` (4 req).
- Size: ~8,600 LOC src + ~230 KB tests.

### Independence verdict (what the LEAD asked for)

```
S1 ──> S2 ──┬──> S3 ──┐
            └──> S4   ├──> S5
                      ┘
```

- **S1 is strictly first.** Nothing else compiles without it.
- **S2 is strictly second.** S3, S4, S5 all import `workspace/`.
- **S3 ∥ S4 have disjoint `src/core/store/` touch-sets** (`issues/`+`query/` vs `finalization/`+`store-planning/`).
  That is a real parallelization opportunity — **but both must edit
  `src/core/management-api/router.ts`, `wire-types.ts`, `src/cli/index.ts`,
  `src/core/completions/command-registry.ts`, `packages/ui/src/api/types.ts`, and 6 locale files.**
  Those six files are also the highest-risk Category-B collisions with 0.2.0's own daemon work.
  **Recommendation: parallelize S3 ∥ S4 only if the rim files are carved out into a separate
  serial "surface wiring" step; otherwise run them serially.**
- **S5 is strictly last** — it consumes S3's compiler and rewrites the shared pre-existing files.

### Scoping recommendation

The direction's declared target is *"Store-v2 + Store Issues"*. **S1 + S2 + S3 is the minimum
coherent unit that delivers Issues** (Issues do not compile without workspace locks and the
planning contract). S4 and S5 are separable follow-on work: S4 (finalization) is needed for the
v2 archive lifecycle, S5 (layout migration) is needed only for existing v1 stores to move.

If the LEAD wants a smaller first landing: **S1 alone is genuinely shippable and independently
testable** (pure module, 4 test files, 60 cases, +1 line to the store barrel, zero Category-B
collisions). It de-risks everything downstream.

### Prior-art pointer (highest-value asset)

0.1.7 built this in 9 archived changes, each with proposal/design/specs/tasks under
`rasen/changes/archive/` on `origin/dev/0.1.7`:

```
2026-08-05-store-planning-foundation-v2                       → S1
2026-08-06-store-planning-scope-routing                       → S4
2026-08-08-store-planning-worktree-bindings                   → S2
2026-08-08-store-scoped-issues-management                     → S3
2026-08-08-store-layout-v2-migration                          → S5
2026-08-08-store-v2-compat-hardening                          → S5 (consistency gates)
2026-08-09-fix-existing-change-workspace-binding              → S2 fixup
2026-08-10-fix-workspace-claim-portability                    → S2 fixup
2026-08-12-migrate-cross-project-coordinators-to-store-issues → S3 follow-on
```

**The proposed slicing above deliberately mirrors that original delivery order** — it is the one
decomposition already proven to work end-to-end on this codebase.

Missing spec capabilities on 0.2.0 (9 dirs, 76 requirements, 165 KB of spec text):
`store-planning-identity-v2` (6) · `store-planning-layout-v2` (9) · `store-planning-worktree-bindings` (14) ·
`store-planning-scope-routing` (9) · `store-issue-resources` (11) · `store-aggregate-query` (7) ·
`store-target-lines` (4) · `store-layout-v2-migration` (12) · `store-v2-consistency-gates` (4).

---

## UNVERIFIED

- I did not run any test on either branch. All "must stay green" claims are inferred from file
  existence, not from an executed run. No dependency install has happened in this worktree.
- I did not read the full bodies of `workspace/`, `finalization/`, or `layout-migration/`; their
  sizes, file lists, and import edges are grepped facts, but their *behavior* is characterized
  only from module docstrings and filenames.
- LOC figures are `git diff --numstat` line counts (which for the 7 modified files are churn, not
  file length). Byte sizes are `git ls-tree --long` blob sizes.
- Whether `archive-engine.ts` / `archive-accounting.ts` / `specs-apply.ts` diverged for
  store-v2 reasons or for unrelated 0.1.7 reasons was not determined — I only established that
  their blobs differ between branches and that finalization/layout-migration import them.
- Test-case counts are `it(`-prefix greps at fixed indent levels; parametrized `it.each` blocks
  count as one.
