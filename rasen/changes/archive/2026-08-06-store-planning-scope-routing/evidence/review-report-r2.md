# Independent Re-Review (round 2): store-planning-scope-routing

- **Change:** `store-planning-scope-routing`
- **Fix baseline:** `b86fbb6bfa7a3915392f53869232e8de659beea3` (implementation is live uncommitted working-tree content plus untracked files)
- **Reviewer role:** independent confirmation of the round-1 fixer's claims. I authored none of this code and edited no source, test, spec, or evidence file other than this report.
- **Verdict:** **NOT CLEAN** — 6 of 9 findings confirmed resolved, 2 partially resolved, 1 partially resolved with a new regression; 4 new Major findings.

## Method

Every finding was checked against the code that is supposed to close it, not against the fixer's prose. Where a claim could be falsified by running the product, I built throwaway fixtures and drove the already-built CLI (`dist/cli/index.js`, verified newer than every `src` file) against them. These probes spawn the CLI directly and never invoke vitest or a build.

Six focused suites were re-run independently before an execution freeze was imposed: `store-planning`, `planning-path-source-guard`, `planning-scope-routing`, `root-selection`, `store-v2-planning-scope-journey`, `planning-scope-guidance` — **6 files / 77 tests PASS**. That run's globalSetup rebuilt the shared `dist/` and collided with an authoritative full-suite run in flight elsewhere in this checkout, producing a phantom `create-space.integration.test.ts` failure there. That collision is itself a defect in the S3 fix and is recorded as **NEW-12**. No build or vitest invocation has been made since; the remainder of this review is code reading plus CLI probes against the existing `dist/`.

The full suite was not run here. Claims below that rest on execution are marked; everything else is derived from the source.

## Per-finding verdicts

| Finding | Severity | Verdict | Evidence | Justification |
| --- | --- | --- | --- | --- |
| S1 — publication can replace/delete another writer's target | Blocker | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:1802-1865`, `:1736-1800`; `test/core/store-planning/store-planning.test.ts:436-518` | `rename()` replaced by atomic non-recursive `mkdir(target)` reservation + hard-linked entries; every removal re-verifies dir identity *and* the persisted `.rasen-publish-owner` token. Non-cooperating creator and non-cooperating replacer are both covered and neither is clobbered. |
| S2 — management reads reject Store project-local schemas | Major | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:1611-1615`; `test/core/management-api/planning-scope-routing.test.ts:233-262` | `openChange()` now passes `paths['project-schemas']` into `readChangeMetadata()`. Both production callers of `readChangeMetadata` pass the third argument. The test is discriminating: the schema exists **only** in the Store partition and the endpoint asserts `schemaName: 'project-flow'` with `errors: []`. |
| S3 — spawned CLI tests accept stale `dist` | Minor | **RESOLVED (mechanism is destructive — NEW-12)** | `test/helpers/run-cli.ts:136-163`; `vitest.setup.ts:44-45` | globalSetup clears the marker, builds unconditionally, then sets it; a worker without the marker rebuilds rather than trusting `dist`. Fail-safe in the staleness direction. Env propagation from globalSetup to forked workers is already load-bearing in this repo (`XDG_DATA_HOME` isolation), and my run showed the authoritative build executing once. The named gap is closed, but the chosen mechanism replaces it with a concurrency hazard — see NEW-12. |
| P1 — selection/bound-project discovery fails open to legacy | Blocker | **PARTIAL** | `src/core/root-selection.ts:961-983` (ambient branch); probe results below | Explicit `--project`, `--store --project`, and `--target-line` are now authoritative (verified: `--project <unknown>` → `unknown_project`; machine-registry-only project resolves). **The ambient/bound-project path still converts a StorePlanning diagnostic into a successful legacy projection** — proven by product probe, see NEW-1. |
| P2 — Store aggregate `context`/`doctor` not implemented | Blocker | **PARTIAL** | `src/commands/context.ts:36-45,232-238`; `src/commands/doctor.ts:555-608`; `test/commands/store-v2-planning-scope-journey.test.ts:379-394,465-480` | Both commands declare `store-read`, reach `store-aggregate`, and fabricate no project paths (verified: `scope.paths` = `planning-checkout`/`store-metadata`/`store-design-docs` only). `doctor` states the project-authority requirement. **`context` does not** — see NEW-6. |
| P3 — Store v2 Archive/spec-sync active before its owner | Blocker | **RESOLVED** | `src/core/archive.ts:82-114,263-273,370-382`; `src/core/templates/workflows/{archive-change,bulk-archive-change,ship,sync-specs}.ts` gate paragraphs; journey `:361-364,481-485` | Direct Archive, stored-plan apply, and all four generated workflows fail closed. Verified live: `rasen archive <c> --json --yes` from a Store-bound checkout returns `legacy_flat_store_requires_migration` / `store_v2_finalization_unavailable` and writes nothing. Management `handleArchive` is read-only, so there is no API mutation entry to gate. One heuristic weakness recorded as NEW-4. |
| P4 — explicit selectors skip the current planning-worktree marker | Blocker | **RESOLVED (regressed elsewhere)** | `src/core/store-planning/internal/resolver.ts:1023-1026,1054-1060`; `test/core/store-planning/store-planning.test.ts:535-569`; journey `:349-360,462-464,537-540` | Marker precedence is now `association → nearest Store checkout → registered root`, and the journey creates a Change with the exact explicit selectors from a planning worktree with **no** execution association (asserts `execution-root` absent + `execution_authority_unavailable` notice). The named defect is closed; the mechanism used to close it introduced NEW-2. |
| P5 — Store planning dirs remain a run-state fallback | Blocker | **RESOLVED** | `src/core/pipeline-registry/run-state.ts:548,565`; `src/commands/pipeline.ts:648-650`; `src/commands/retain.ts:302-307`; `src/core/management-api/project-space.ts:110-124`; `src/core/management-api/sessions.ts:281-285`; journey `:187-192,448-461,572-574` | Every `StateFileLocationOptions` construction site is covered (`pipeline`, `retain`, management `changeStateLocations` — used by changes/runs/archive/task-detail — and sessions). The journey now plants a planning-side `auto-run.json` decoy (`full-feature`) and asserts resume reads the execution ephemera (`bug-fix`) and reports `runStateDir` under `<executionRoot>/.rasen/...`. The prior inverted assertion is gone. |
| P6 — Store mutators infer execution authority from cwd | Blocker | **RESOLVED (over-broad)** | `src/core/root-selection.ts:1136-1155`; `src/commands/work.ts:95-112`; `src/commands/retain.ts:288-296`; `src/core/archive.ts:699-707`; journey `:365-378,486-503` | `resolveExecutionRoot` has **zero** production callers left (only its definition and its own tests). Planning-only and unrelated-cwd runs refuse before any write (verified: `execution_authority_required`, and `unrelatedCwd/.rasen` is never created). The guard is broader than the finding required — see NEW-3. |

Totals: 6 RESOLVED, 3 PARTIAL/regressed. No finding is unaddressed.

## NEW findings

### NEW-1 — Blocker — Ambient bound-project reads still fail open to the flat Store root

**Where:** `src/core/root-selection.ts:961-983` (the `catch { /* Bound Store v2 facts are the only successful result consumed here */ }` around the ambient planning attempt), falling through to `resolveStandaloneOrLegacyRoot()` → `resolveNearestOrDeclaredRoot()` → `makeRoot(binding.store.root, 'declared', …)`.

**Failure scenario (reproduced against the built CLI):**

1. Store `s` is layout v2, `.rasen-store/projects/project-a.yaml` records `project-a` as `planning: true`, `state: bound`. Its partition holds `rasen/projects/project-a/changes/partition-change`. Its root also holds legacy `rasen/changes/store-root-decoy`.
2. Checkout `C` declares `projectId: project-a` and `store: {uid, id: s}`, with no local planning shape.
3. `rasen list --json` from `C` correctly returns `partition-change` with `root.scope.kind = "store-project"`.
4. Corrupt `.rasen-store/projects/project-a.yaml` (invalid YAML). Re-run the same command.
5. **Observed:** exit `0`, `changes: [ { "name": "store-root-decoy" } ]`, `root.path` = the Store root, `source: "declared"`, and **no `scope` field at all**. The `invalid_project_catalog` diagnostic is swallowed and the caller silently reads the Store's root-level `rasen/changes`.

The same silent switch happens when the catalog is valid but `planningBinding.state` is not `bound`, and when the checkout's `projectId` is simply absent from the catalog.

This is the exact class P1 named ("never convert a StorePlanning diagnostic into a successful legacy projection") and it violates two delta-spec scenarios directly: `specs/store-planning-scope-routing/spec.md:157-161` ("no root-level Store `rasen/changes` or `rasen/specs` path SHALL be treated as that project's planning location") and `specs/store-config-inheritance/spec.md:46-50` ("a command requiring planning SHALL report the missing or unbound planning relationship").

**Mitigating fact (why this is read-only damage):** `rasen new change` and `rasen archive` do not use this path — creation opens `StorePlanning` directly and correctly fails with `invalid_project_catalog` writing nothing; archive is blocked by the P3 gate. The damage is a silently wrong *read* set (`list`/`show`/`validate`/`status`/`instructions`/`context`), which is still enough to make an agent act on the wrong planning content.

**What to fix:** in the ambient branch, only fall through to the legacy adapter when StorePlanning positively returns `standalone` (or when no Store fact exists at all). A checkout that declares a Store which classifies as layout v2 must surface the planning diagnostic. The genuine "configuration inheritance only" case (`specs/store-config-inheritance/spec.md:3-22`) should be returned by the resolver as a `standalone` scope with the `configuration_store_inheritance` notice rather than by catching an exception.

### NEW-2 — Major — An unrelated Store checkout in cwd overrides a fully explicit Store selection

**Where:** `src/core/store-planning/internal/resolver.ts:1054-1060` — `preliminaryStoreRoot` prefers `nearestStoreRoot` over `selectedStoreEntry.root` whenever the two paths differ, with **no check that the nearest checkout is the selected Store**. (Also `:1023-1026`, which reads the planning marker from that same unverified root.)

**Failure scenario (reproduced):** Stores `s` and `t` are both registered, both layout v2, unrelated. From a neutral cwd, `rasen list --json --store s --project project-a --target-line line-0.2` succeeds and returns `s`'s partition. Running **the identical command** with cwd inside store `t`'s checkout (or any subdirectory of it) fails:

```
exit 1  planning_selection_conflict
"Store metadata id 't' does not match registry alias 's'."
```

A fully explicit three-part selection is therefore decided by the current directory. This contradicts `specs/store-planning-scope-routing/spec.md:151-155` ("Commands that address the same scope SHALL agree even when invoked from different directories … changing the current directory after scope resolution SHALL not redirect any downstream access") and the design's rule that explicit selectors are the strongest source.

**What to fix:** accept `nearestStoreRoot` as the planning root only when its `.rasen-store/store.yaml` identity (uid, else id) matches the selected Store entry; otherwise ignore it entirely (both for `preliminaryStoreRoot` and for the marker read). The P4 case is preserved because there the nearest checkout *is* the selected Store.

### NEW-3 — Major — Legacy flat Store `work migrate` and `retain prepare` are now permanently refused, and the tests that proved the old behavior were rewritten to bless the refusal

**Where:** `src/core/root-selection.ts:1136-1143` (`sideEffectProjectRoot` returns `undefined` for `kind === 'legacy-store'` and for the compat `storeType === 'store'` case) consumed by `src/commands/work.ts:99-106` and `src/commands/retain.ts:288-296`. For a legacy flat Store there is no `.rasen/planning-binding.json` mechanism, so `execution-root` is *never* populated — the refusal is unconditional, not situational.

**Failure scenario:** a member checkout `M` of legacy flat Store `S`. `rasen work migrate --store S --json --yes` and `rasen retain prepare <change> --store S --json` both now exit 1 with `execution_authority_required` / `retention_planning_root_mismatch` and move/write nothing. There is no supported way to supply the missing authority.

**Why this matters beyond the behavior itself:** three previously-green tests were inverted rather than preserved —
`test/commands/retain-prepare.test.ts:635` (`resolves the right store through durable identity…` → `fails closed without execution authority…`), `:757` (`resolves a store-planned change with the store as planning root…` → `refuses a legacy Store-planned change…`), `:848` (`freezes the owner an explicit selector names…` → `does not let an owner selector replace missing Store execution authority`), and `test/commands/work.test.ts:571,624` (two Store migration cases now assert exit 1 and zero moves). These are tests asserting *current* behavior, so the suite cannot detect the capability loss.

**Assessment:** for `work migrate` the *direction* is defensible (design.md:23 "make legacy flat Stores read-only", task 8.2 routes `work` through intent guards) but the diagnostic is wrong — it should be `legacy_flat_store_requires_migration`, not `execution_authority_required`. For `retain prepare` there is no such justification: retention writes only execution-owned ephemera into the member checkout, which `specs/file-placement/spec.md:34-38` explicitly endorses, and `retain` appears in no task or spec scenario for this child. Either way this is a user-visible breaking change that the proposal's BREAKING bullet (`proposal.md:14`) does not cover.

**What to fix:** decide explicitly. Minimum: give `work migrate` the `legacy_flat_store_requires_migration` diagnostic, and either restore `retain prepare` for legacy Store selection (populate `execution-root` from the resolved nearest *project* checkout for legacy-store/standalone-compat scopes — that is a frozen launch project, not a guessed cwd) or add the removal to `proposal.md` plus a spec scenario, and keep at least one test proving the previously supported flow is refused *deliberately*.

### NEW-4 — Major — One malformed project catalog file makes the whole Store unusable, including `doctor`

**Where:** `src/core/store-planning/internal/resolver.ts:1187` calls `loadProjectCatalogs()` (`:722-744`) for **every** layout-v2 Store scope, including `store-read` intent, and that helper throws on the first unparseable or filename-mismatched file in `.rasen-store/projects/`.

**Failure scenario (reproduced):** Store `s` with projects `alpha` and `beta`. Corrupt `beta.yaml` only (invalid YAML, or rename so the stem no longer equals `projectId`). Then:

- `rasen list --json --store s --project alpha --target-line line-0.2` → exit 1, `invalid_project_catalog`. Project `alpha` is collateral.
- `rasen doctor --store s --json` → exit 1, `root: null`, `store: null`. The surface whose job is to report a broken Store cannot resolve one, contradicting the D4 rule preserved verbatim at `src/commands/doctor.ts:551-553` ("Doctor is the surface that REPORTS a broken store declaration, so it must not be stopped by one") and task 6.6.

The diagnostic also does not name the offending file: `message: "catalog: contains invalid YAML"`, `target: "catalog"` — even though `loadProjectCatalogs` has the path in hand.

**What to fix:** make catalog loading lazy or per-project fault-isolated — only the *selected* project's catalog must parse for a project scope, and an aggregate/doctor read should degrade a broken sibling to a reported diagnostic rather than a hard failure. Propagate the catalog file path into the diagnostic `target`.

### NEW-5 — Minor — Stored-Archive-plan gate is a path-substring heuristic

**Where:** `src/core/archive.ts:105-116` — `storedPlanFinalizationDiagnostic()` classifies a stored plan as Store v2 by testing whether `plan.paths.active` contains the literal segment `<sep>rasen<sep>projects<sep>`.

**Failure scenario:** a standalone project checked out at e.g. `E:\rasen\projects\myapp` produces `plan.paths.active = E:\rasen\projects\myapp\rasen\changes\<name>`, which matches the marker, so a legitimate standalone stored plan is refused with `store_v2_finalization_unavailable`. Conversely a v2 plan whose partition path was rewritten would slip through. The plan should carry the scope kind (or the Store uid/project id) it was created under rather than being re-derived from a path substring.

### NEW-6 — Minor — Aggregate `context` payload omits the required project-authority statement

**Where:** `src/commands/context.ts:36-45` returns `members: []`, `status: []` for a `store-aggregate` scope.

**Observed:** `rasen context --store s --json` yields `members: []`, `status: []`, and the human form prints `No references declared; the working set is this root alone.` — indistinguishable from a healthy project context. `specs/store-planning-scope-routing/spec.md:135-139` requires that an aggregate payload "SHALL state that project authority is required for project content". `doctor` satisfies this (`store_aggregate_scope` status); `context` does not, and the journey test only asserts the path-absence half plus the human banner string.

### NEW-7 — Minor — Successful publication leaves `.rasen-publish-owner` in every Store v2 Change forever

**Where:** `src/core/store-planning/internal/resolver.ts:1818-1824` links the owner file into the target first and never removes it on the success path; asserted as intended at `test/core/store-planning/store-planning.test.ts:198-203`.

Every created Store v2 Change directory permanently carries a hidden file containing `<pid>.<32 hex>`. It will be committed to the Store repo, appear in `git status`, and enter Archive digest accounting in the later finalization child. If persistence is genuinely required, that should be stated in the spec; otherwise unlink it after the read-back verification succeeds.

### NEW-8 — Minor — A crash during publication leaves an orphan reservation that blocks the Change id permanently

**Where:** `src/core/store-planning/internal/resolver.ts:1811` creates the target directory before any entry is linked; `:1937-1943` refuses creation whenever `statKind(target) !== 'absent'`.

A hard kill between `mkdir(target)` and completion leaves a directory that every future `createChange` reports as `change_already_exists`, with no TTL/PID recovery (the same is true of the pre-existing `.create.lock`, `:1924-1935`). The rename-based predecessor had no such window. Manual `rm -rf` is the only recovery; worth a recovery path or at least a diagnostic that distinguishes "empty reservation" from "real Change".

### NEW-9 — Minor — TOCTOU window can contaminate a foreign replacement directory

**Where:** `src/core/store-planning/internal/resolver.ts:1825-1841` links each entry and *then* re-checks ownership. In the exact race the new test exercises (`test/core/store-planning/store-planning.test.ts:474-518`), the second `link()` lands inside the foreign replacement directory before the ownership check fails. The test asserts the foreign files survive, but not that no stray entry was added. Nothing is deleted, so this is bounded; noting it so the residue is not mistaken for full atomicity.

### NEW-10 — Minor — Dead code with tests asserting the retired behavior

`src/core/file-placement.ts:148` `resolveExecutionRoot()` now has zero production callers, yet `test/core/file-placement.test.ts:99-130` still asserts its cwd/nearest-git-root derivation — the very behavior P6 removed. Either delete the export with its tests or mark it explicitly as unused compatibility surface.

### NEW-11 — Minor (process) — The round-1 gate table still reports the full suite as unfinished

`rasen/changes/store-planning-scope-routing/evidence/review-cycle-report.md:102` still reads `RUNNING as an additional full-suite gate when this report was drafted; replace this row with the final result before fixer handoff.` The round-1 evidence therefore has no full-suite result.

### NEW-12 — Major — The S3 fix makes every vitest invocation destructively clean the shared `dist/`, so two concurrent runs corrupt each other

**Where:** `vitest.setup.ts:44-45` (`resetCliBuildReadyMarker()` then `ensureCliBuilt()`) combined with `test/helpers/run-cli.ts:145-152` (`pnpm run build`) and `build.js:17-20`, which starts with `rmSync('dist', { recursive: true, force: true })`.

Clearing the marker means the early-return in `ensureCliBuilt()` can never fire in globalSetup, so **every** vitest process — full suite, single focused file, watch session, a suite that never spawns a CLI — unconditionally deletes `dist/` and recompiles it.

**Failure scenario (observed, not hypothetical):** process A is running the full suite; its worker forks spawn `dist/cli/index.js`. Process B starts any vitest invocation in the same checkout. B's globalSetup deletes `dist/`, and for the whole TypeScript compile window `dist/cli/index.js` is absent or partially written. A's spawned CLI then fails with a missing-entry error. During this review exactly that happened: my focused run wiped `dist/` under an authoritative full-suite run, which failed `create-space.integration.test.ts` with "missing dist/cli/index.js". The failure is attributed to the change under test, not to the contention — a false-failure class that is expensive to diagnose because it is timing-dependent and unreproducible in isolation.

The inverse is worse and is not detected at all: a worker in A can spawn the CLI while B's `tsc` is mid-write, so a test can run against a **partially compiled** `dist/` and pass or fail on a bundle that never existed as a coherent build. The gate S3 exists to protect (never execute an untrustworthy `dist/`) is therefore weakened in a new direction while the stale-`dist` direction is closed.

Secondary cost: the build now runs on every invocation. In CI each job already runs `pnpm run build` explicitly (`.github/workflows/ci.yml:121-122`) before `pnpm test` (`:128`, `:135`), so every job pays a second full compile, and `windows-pwsh-shard-1` pays a third at `:141`. CI itself is *not* exposed to the corruption because its steps are sequential within a job and jobs use separate checkouts — the exposure is local development and any agent or script running two vitest processes in one worktree.

**Verdict: this is a defect worth fixing, not an acceptable trade.** The original S3 correction offered a non-destructive option that avoids it verbatim: "build once before spawned-CLI tests (**or validate a content/build fingerprint**)". A fingerprint — write e.g. `dist/.build-fingerprint.json` from the compiler inputs, and have `ensureCliBuilt()` rebuild only when the recorded fingerprint does not match the current `src` — closes the staleness gap with no clean, no contention, and no per-invocation compile. If the current build-always shape is kept, it needs at minimum a cross-process exclusive lock plus a non-destructive publish (compile to a temporary directory, then atomically swap), so no reader ever observes a missing or half-written `dist/`.

**What to fix:** replace the unconditional `resetCliBuildReadyMarker()` + clean-rebuild with a fingerprint check, or serialize and de-destructify the build. Either way, a second concurrent vitest process must not be able to remove or partially overwrite a `dist/` another process is executing.

## Checks run for this review

| Check | Result |
| --- | --- |
| `pnpm exec vitest run --maxWorkers=1` over `store-planning`, `planning-path-source-guard`, `planning-scope-routing`, `root-selection`, `store-v2-planning-scope-journey`, `planning-scope-guidance` | PASS — 6 files, 77 tests. Run before the execution freeze; it rebuilt the shared `dist/` and disrupted a concurrent authoritative run (NEW-12). |
| `dist/cli/index.js` freshness vs newest `src` file | Fresh before probing; vitest globalSetup rebuilt it once during that run |
| Live CLI probes: ambient bound-project fallback, explicit-selector cwd sensitivity, catalog blast radius, aggregate `context`/`doctor` payloads, Store v2 mutation refusal | 5 fixtures, results inline above. These spawn `dist/cli/index.js` directly — no vitest, no build. |
| Full `pnpm test` | Not run here (running elsewhere) |
| Everything after the freeze (NEW-3 test-inversion analysis, NEW-5, NEW-10, NEW-11, NEW-12) | Source-derived; **unverified by execution — pending suite run** |

### Suites I would like run, and when

No additional run is needed to support any finding in this report — every NEW-1 through NEW-4 and NEW-6 claim is backed by a CLI probe or by source that is unambiguous. The runs worth spending time on are **after** the fixes land, serially:

- `test/core/root-selection.test.ts`, `test/core/store-planning/store-planning.test.ts` — NEW-1, NEW-2
- `test/commands/store-v2-planning-scope-journey.test.ts`, `test/core/management-api/planning-scope-routing.test.ts` — end-to-end routing after NEW-1/NEW-4
- `test/commands/work.test.ts`, `test/commands/retain-prepare.test.ts` — NEW-3, whichever way it is decided
- `test/commands/doctor.test.ts`, `test/commands/context.test.ts` — NEW-4, NEW-6

## Final verdict

**NOT CLEAN.** Must be fixed before this change lands:

1. **NEW-1 (Blocker)** — `src/core/root-selection.ts:961-983`: stop converting a StorePlanning diagnostic into a legacy flat-Store projection on the ambient/bound-project path (closes the remaining half of P1).
2. **NEW-2 (Major)** — `src/core/store-planning/internal/resolver.ts:1054-1060` (and `:1023-1026`): only prefer the nearest Store checkout when its Store identity matches the selected Store.
3. **NEW-3 (Major)** — `src/commands/work.ts:99-106`, `src/commands/retain.ts:288-296`, `src/core/root-selection.ts:1136-1143`: correct the legacy-Store diagnostic and decide, in writing, whether legacy-Store retention is intentionally removed; do not leave inverted tests as the only record.
4. **NEW-4 (Major)** — `src/core/store-planning/internal/resolver.ts:1187,722-744`: fault-isolate project catalog loading so one bad file cannot disable every project and `doctor`, and name the file in the diagnostic.
5. **NEW-12 (Major)** — `vitest.setup.ts:44-45` + `test/helpers/run-cli.ts:145-152` + `build.js:17-20`: every vitest invocation destructively cleans the shared `dist/`, so concurrent runs produce false failures and can execute a half-written bundle. Replace with a build fingerprint, or lock plus atomic swap.
6. **NEW-6 (Minor)** — `src/commands/context.ts:36-45`: emit the required project-authority statement in the aggregate payload (closes the remaining half of P2).

NEW-5 and NEW-7 through NEW-11 are Minor and may be deferred with an explicit note.
