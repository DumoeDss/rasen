# Pre-Landing Review: 9 issues (7 Blocker, 1 Major, 1 Minor)

- **Change:** `store-planning-scope-routing`
- **Baseline:** `b86fbb6bfa7a3915392f53869232e8de659beea3`
- **Mode:** dispatched, report-only
**Verdict:** **FAIL — 7 Blocker, 1 Major, and 1 Minor findings remain open.**

## Scope check

- The reviewed worktree is still based at the requested baseline; the implementation is present as working-tree changes and untracked files rather than later commits.
- The StorePlanning Module, CLI/read adapters, management adapters, templates, locales, and focused tests are in scope. Sibling portfolio Change artifacts were used only as dependency/boundary evidence.
- The implementation crosses the child boundary by activating Store v2 Archive/spec-sync behavior that the design assigns to `store-finalization-outcomes-v2`.
- This review changed no implementation, tests, run-state, commits, or external state. Its only durable write is this report.

## Standards axis

### S1 — Blocker — Change publication can replace or delete another writer's target

**Evidence:** `src/core/store-planning/internal/dependencies.ts:107-111` implements publication with ordinary `fs.promises.rename()` and cleanup with recursive forced removal. `src/core/store-planning/internal/resolver.ts:1768-1776` checks absence before staging, then `src/core/store-planning/internal/resolver.ts:1829-1838` renames the staged directory to the target. On POSIX, rename may replace an existing empty target directory, so an external/non-cooperating writer that creates the target after the check can be clobbered despite the cooperative `.create.lock`. After publication, read-back failures at `src/core/store-planning/internal/resolver.ts:1845-1877` recursively remove `target` without proving that the path still denotes this operation's published instance; a concurrent replacement can therefore be deleted. The concurrency test at `test/core/store-planning/store-planning.test.ts:293-344` exercises only two cooperating creators, and the collision test at `test/core/store-planning/store-planning.test.ts:403-427` injects Windows `EPERM`, so neither covers the POSIX replace case or identity-safe cleanup.

**Correction:** introduce a filesystem publication primitive with guaranteed atomic no-replace semantics on every supported platform, give the staged/published object an ownership token that survives publication, and remove a target only after re-verifying that token/identity. Add real POSIX and Windows race tests with a non-cooperating target creator/replacer.

### S2 — Major — Management reads reject valid Store project-local schemas

**Evidence:** creation validates against the typed `project-schemas` location at `src/core/store-planning/internal/resolver.ts:1740-1745`, but `ProjectReadScope.openChange()` calls `readChangeMetadata()` with only the compatibility root at `src/core/store-planning/internal/resolver.ts:1575-1581`. The metadata reader requires its third `projectSchemasDir` argument to include a project-local schema (`src/utils/change-metadata.ts:97-100,141-147`). Management project-content handlers enter this path through `src/core/management-api/project-space.ts:82-88`, so a valid v2 Change created with a schema under `rasen/projects/<project>/schemas` becomes unreadable to changes/runs/task/session management endpoints.

**Correction:** pass `resolved.description.paths['project-schemas']` (or the equivalent typed location) into `readChangeMetadata()` inside `openChange()`, and add a management API test that creates and opens a Change using a Store project-only schema.

### S3 — Minor — Spawned CLI tests accept any pre-existing `dist`, including stale output

**Evidence:** `test/helpers/run-cli.ts:136-152` returns as soon as `dist/cli/index.js` exists; it does not compare inputs, rebuild once per run, or verify a build fingerprint. The main Store v2 journey uses this helper, so source regressions can be hidden by old compiled output. The current checkout's `dist/cli/index.js` is newer than `src/cli/index.ts`, and the focused run passed, so this is a test-harness gap rather than evidence that today's run used stale output.

**Correction:** build once before spawned-CLI tests (or validate a content/build fingerprint), and add a guard that fails rather than silently executing stale `dist`.

**Standards result:** 3 findings; worst severity **Blocker**.

## Spec axis

### P1 — Blocker — Project selection and bound-project discovery fail open to the legacy root

**Evidence:** `resolveOpenSpecRoot()` resolves the legacy projection before StorePlanning for `--project`, then catches every StorePlanning failure and returns the legacy result (`src/core/root-selection.ts:917-924`). The ambient/bound-project path similarly swallows StorePlanning failures (`src/core/root-selection.ts:927-944`). This hides `planning_selection_conflict`, invalid catalog/binding, split-truth, and unavailable Store diagnostics and can read a local/flat planning tree instead. It also prevents a project that exists only in the machine project registry from reaching the new resolver because the legacy registry lookup fails first. This contradicts `specs/store-project-namespace/spec.md:11-18`, `specs/store-planning-scope-routing/spec.md:3-23`, and tasks 3.3/6.2.

**Correction:** make StorePlanning authoritative for project selectors and bound-project facts. Preserve legacy behavior only when the resolver positively returns a standalone or legacy-flat scope; never convert a StorePlanning diagnostic into a successful legacy projection. Add regressions for a machine-registry-only project and for every conflict/error currently swallowed.

### P2 — Blocker — Store aggregate `context` and `doctor` are not implemented

**Evidence:** the only CLI compatibility path opens StorePlanning with hard-coded `intent: 'project-read'` (`src/core/root-selection.ts:705-732`). Both `context` (`src/commands/context.ts:190-226`) and `doctor` (`src/commands/doctor.ts:527-559`) call that adapter, so `--store S` on layout v2 fails `project_scope_required` instead of returning/diagnosing a Store aggregate. This directly violates the required Store-only context scenario at `specs/store-planning-scope-routing/spec.md:53-61`, the aggregate context payload at lines 125-139, and task 6.6.

**Correction:** require callers to declare `store-read` versus `project-read`, add an aggregate-compatible output/working-set path, and route Store-only context and doctor through `StoreAggregateReadScope` without projecting project Changes/specs/archive paths. Test both JSON and human output with `--store` and no project.

### P3 — Blocker — Store v2 Archive/spec-sync mutation is active before its owning child

**Evidence:** direct Archive resolves a project-read root with no Store v2 mutation guard (`src/core/archive.ts:193-225`), consumes the typed Archive/spec locations (`src/core/archive.ts:462-463,605-619`), guesses execution authority, and builds an applyable legacy archive plan (`src/core/archive.ts:638-704`). The generated Archive and sync-specs workflows direct writes to `root.scope.paths['archive-line']` and `root.scope.paths.specs`, including `git add`/commit guidance (`src/core/templates/workflows/archive-change.ts:34-41,112-152`; `src/core/templates/workflows/sync-specs.ts:52-80`). The child design explicitly makes Archive v2 plan/apply and spec sync non-goals (`design.md:28-35`), states that Archive must refuse Store v2 finalization until the owner activates it (`design.md:190-203`), and task 8.2 requires that refusal. The parent assigns outcome validation, landed-only sync, Archive v2 records, and direct/bulk/ship adoption to child 5 (`../store-project-partitions-planning-worktrees/planning-context.md:97-102`). Running the legacy transaction against v2 can produce history/spec mutations without the required outcome, identity, reachability, workspace-pair, or digest accounting.

**Correction:** fail closed at every direct/bulk/ship/API Store v2 finalization entry before planning or mutation, including stored-plan apply, and make generated workflows stop on that diagnostic. Leave typed Archive/spec locators read-only until `ChangeFinalizationModule` owns the v2 transaction.

### P4 — Blocker — Explicit selectors skip the current planning-worktree marker

**Evidence:** marker lookup chooses `association.planningRoot`, then the registered explicit Store root, and only then the nearest Store checkout (`src/core/store-planning/internal/resolver.ts:985-993`). Therefore the documented command `rasen new change ... --store S --project P --target-line L`, run directly inside a linked planning worktree with no execution association, reads the marker from S's registered integration checkout instead of the current planning worktree. The integration checkout remains unverified and creation fails `planning_worktree_required`. The CLI journey avoids the path by installing an execution association at `test/commands/store-v2-planning-scope-journey.test.ts:194-213`.

**Correction:** collect the planning marker from the actual nearest/current Store checkout (or an association-selected planning root); treat the registered integration root only as Store identity/catalog location, not as stronger worktree evidence. Add an E2E that runs the exact explicit-selector creation command from a planning worktree without an execution association.

### P5 — Blocker — Store planning directories remain a run-state/ephemera fallback

**Evidence:** the global sticky chain always appends `changeDir` (`src/core/pipeline-registry/run-state.ts:550-564`). Store v2 pipeline and management callers pass the Store planning Change directory, so a shared planning-side `auto-run.json`, portfolio, or goal record is visible across execution worktrees. The new CLI journey deliberately writes `auto-run.json` into the Store Change (`test/commands/store-v2-planning-scope-journey.test.ts:187-192`) and asserts `runStateDir === existingChangeDir` (`test/commands/store-v2-planning-scope-journey.test.ts:390-397`). That is the opposite of task 5.5, which requires Store planning never be an ephemera fallback, and of the execution-owned placement contract (`specs/file-placement/spec.md:5-15,28-32,95-103`).

**Correction:** make the state search chain ownership-aware and omit the planning Change directory for Store v2 scopes; use only the frozen execution ephemera and legitimate execution-owned legacy home. Move the journey fixture's state into `<executionRoot>/.rasen/changes/<change>/ephemera`, add a planning-side decoy, and assert the decoy is ignored across CLI, management, and session reads.

### P6 — Blocker — Store mutators infer writable execution authority from cwd

**Evidence:** the new scope already carries optional verified `executionRoot`, but `workMigrationRootContext()` ignores it and calls the legacy probing helper for every Store selection (`src/commands/work.ts:89-108`). Retention does the same before locating/updating run-state (`src/commands/retain.ts:283-301`), and Archive does so while choosing sidecars/ephemera and building its plan (`src/core/archive.ts:638-686`). That helper returns the nearest Git root or cwd itself for Store selections (`src/core/file-placement.ts:133-156`). From a planning-only checkout or arbitrary directory, these commands can therefore move legacy work files or write run-state/sidecars under an unrelated checkout. This violates task 8.3 and the explicit rule that unavailable execution authority remains unavailable rather than inferred from cwd (`specs/file-placement/spec.md:95-103`).

**Correction:** consume `root.executionRoot`/`resolvedExecutionProjectRoot(root)` as the sole execution capability and refuse execution-owned reads or writes when it is absent. Remove Store callers of `resolveExecutionRoot`; Archive should additionally be blocked by P3. Add planning-only and unrelated-cwd tests proving zero writes/moves.

**Spec result:** 6 findings; worst severity **Blocker**.

## Coverage map

| Boundary | Existing evidence | Review result |
| --- | --- | --- |
| StorePlanning mapping, identity, stale-scope creation | 14 focused Module tests | Happy paths covered; external publication races and direct planning-worktree selection are missing. |
| CLI selector parity and cross-command routing | Root tests plus one Store v2 journey | Partial; the journey always supplies an execution association and does not exercise aggregate or machine-project-only selection. |
| Lifecycle mutation boundary | Template source guards and Archive path threading | Inverted; typed paths are tested, but Store v2 refusal is absent and later-child writes are taught. |
| Execution-owned run-state | Pipeline/management tests and journey | Inverted; planning-side fallback is asserted as success. |
| Management project reads | 8 focused routing tests | Partial; built-in schemas pass, Store project-local schema lookup is not covered. |
| Generated CLI execution | `runCLI()` E2E | Current output appears fresh, but the helper has no freshness guarantee. |

## Checks

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | PASS |
| Focused Vitest: StorePlanning, path guard, management routing, root selection, Store v2 CLI journey, pipeline Store selection, planning guidance | PASS — 7 files, 85 tests |
| `git diff --check b86fbb6bfa7a3915392f53869232e8de659beea3 --` | PASS (line-ending conversion warnings only) |
| Strict UTF-8 decode of changed/untracked files; changed JSON parse; new-BOM comparison | PASS — 122 files, no invalid UTF-8, invalid JSON, or newly introduced BOM |
| Source/dist freshness spot-check | Current `dist/cli/index.js` is newer than `src/cli/index.ts`; harness guarantee still missing (S3) |

Passing tests do not override the verdict because P4/P5 are bypassed or asserted in the wrong direction, while P1/P2/P3/P6 have no required negative coverage.

## Durable findings for the LEAD

- Treat planning scope, execution context, and lifecycle/finalization authority as three separate capabilities; the remaining failures all come from projecting one into another.
- Replace the global Store-era compatibility assumptions in `resolveExecutionRoot()` and `stateFileSearchChain()` with explicit ownership modes rather than adding more caller-specific exceptions.
- Keep the later `ChangeFinalizationModule` boundary hard: typed locators are not write authority, and generated skills must not activate deferred mutations.
