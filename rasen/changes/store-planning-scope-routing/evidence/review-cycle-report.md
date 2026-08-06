# Review Cycle: store-planning-scope-routing

Rounds: 3/3  
Tier: A (Codex native)  
Status: **CLEAN** — round-3 delta independently confirmed; final full-suite gate met

## Final gate (LEAD, exclusive checkout)

`pnpm test`, whole repository, tree stable, no other vitest process alive.

**5 failed / 6191 passed / 34 skipped (355 files, 733s).**

All five failures are the environmental `%LOCALAPPDATA%\rasen` cluster — `config.test.ts` ×1 and `config-editor.test.ts` ×4 — proven environmental by controlled experiment (same code, `TMP`/`TEMP` repointed off `%LOCALAPPDATA%` → 87/87 pass), with `planning-home.ts` byte-unchanged from baseline and `config.ts` unmodified by this Change. **Nothing owned by this Change is red.**

This satisfies the round-3 reviewer's conditional sign-off (`review-report-r3.md` §12.6) exactly as stated: only the five environmental failures appear, both `skill-templates-parity` tests are green, and all six session-launch tests are green. The verdict is therefore unconditional **CLEAN**.

Progression across five authoritative whole-repository runs:

| Run | Tree | Result |
| --- | --- | --- |
| 1 | round-1, contaminated by concurrent vitest (NEW-12) | 22 failed / 6167 passed |
| 2 | round-1, exclusive | 18 failed / 6171 passed |
| 3 | round-2, exclusive | 6 failed / 6189 passed |
| 4 | round-3, exclusive | 7 failed / 6189 passed (R3-1 moved 4 pinned template hashes) |
| 5 | round-3 + re-baseline, exclusive | **5 failed / 6191 passed** |

## Roles and invariant

- Original reviewer: `/root/scope_routing_reviewer`
- Round 1 fixer: `/root/scope_routing_fixer_r1`
- Round 2 reviewer (independent, authored none of the code): `scope-routing-reviewer-r2` — `evidence/review-report-r2.md`
- Round 2 fixer: `scope-routing-fixer-r2`
- Round 3 reviewer (independent): `evidence/review-report-r3.md`
- Round 3 fixer: `scope-routing-fixer-r2` (same agent; round-3 findings were confirmed by an independent reviewer, and every fix below is re-verified by restored baseline tests rather than by author assertion)
- Fix baseline: `b86fbb6bfa7a3915392f53869232e8de659beea3`
- Required non-author confirmation: pending for round 3. The fixer gate runs below are evidence, not reviewer confirmation.

## Round 1 disposition

| Finding | Severity | Triage | Fix implemented by | Confirmed by (non-author) | Disposition |
| --- | --- | --- | --- | --- | --- |
| S1 — Change publication can replace or delete another writer's target | Blocker | Design-level filesystem safety | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| S2 — Management reads reject valid Store project-local schemas | Major | Non-trivial adapter correction | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| S3 — Spawned CLI tests accept stale pre-existing `dist` output | Minor | Non-trivial test-harness correction | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| P1 — Project selection and bound-project discovery fail open to the legacy root | Blocker | Design-level routing authority | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| P2 — Store aggregate `context` and `doctor` are not implemented | Blocker | Non-trivial command adapters | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| P3 — Store v2 Archive/spec-sync mutation is active before its owning child | Blocker | Design-level lifecycle boundary | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| P4 — Explicit selectors skip the current planning-worktree marker | Blocker | Non-trivial resolver precedence | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| P5 — Store planning directories remain a run-state/ephemera fallback | Blocker | Design-level placement ownership | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |
| P6 — Store mutators infer writable execution authority from cwd | Blocker | Design-level capability enforcement | `/root/scope_routing_fixer_r1` | Pending independent reviewer | Implemented; confirmation pending |

Round 1 totals: 7 Blocker / 1 Major / 1 Minor / 0 Trivial. No finding is marked independently resolved yet.

## Fix summary

### S1 — no-replace, ownership-safe Change publication

- Publication now reserves the target directory exclusively, links staged entries into the reservation, and records a persistent ownership token.
- Read-back and cleanup verify file/directory identity and the ownership token before removing any target.
- Collision, replacement, and cleanup coverage exercises non-cooperating writers and refuses to clobber or delete foreign targets.

### S2 — project-local schema reads

- Store project read scopes pass the typed `project-schemas` path into Change metadata reads.
- Management routing coverage opens a Store project Change whose schema exists only in the project partition.

### S3 — one authoritative spawned-CLI build

- Vitest global setup performs the authoritative CLI build once.
- Worker processes inherit `RASEN_TEST_CLI_BUILD_READY`; the spawned-CLI helper refuses to trust an unmarked pre-existing `dist` and workers no longer race independent rebuilds.

### P1 — authoritative StorePlanning routing

- Explicit project selectors and bound-project discovery no longer swallow StorePlanning diagnostics and fall back to a legacy projection.
- Machine-registry-only projects resolve through StorePlanning; an explicitly resolved legacy project remains compatible even if an unrelated machine registry is corrupt.
- Explicit Store v2 selection classifies layout before applying legacy `rasen/config.yaml` health checks.

### P2 — Store aggregate reads

- `context` and `doctor` declare Store-read intent and handle Store aggregate scope in JSON and human output.
- Aggregate root payloads carry `store_id`; project-content endpoints still require a project scope.

### P3 — deferred finalization fails closed

- Direct Archive, management Archive, stored-plan apply, bulk/ship templates, and sync-spec guidance refuse Store v2 finalization with `store_v2_finalization_unavailable`.
- Legacy flat Store finalization also fails closed until migration, while standalone Archive compatibility remains intact.

### P4 — current planning worktree wins

- A current/nearest planning-worktree marker outranks the registered integration checkout for explicit selectors.
- The CLI journey covers exact explicit selectors from a planning worktree without requiring an execution association.

### P5 — execution-owned ephemera only

- Run-state lookup can omit planning Change directories for Store v2 scopes.
- Pipeline, management, session, retain, and lifecycle readers route through execution ephemera and ignore planning-side decoys.

### P6 — verified execution capability only

- Work migration, retention, and Archive consume `resolvedExecutionProjectRoot()` rather than deriving writable authority from cwd, Store membership, or registration.
- Planning-only and unrelated-cwd cases fail before writes or moves; compatibility tests now assert zero-write behavior for legacy flat Stores.

## Fixer gate evidence

### Scope and rationale

- StorePlanning publication, selection, marker precedence, and path-source guards cover S1, P1, and P4 at the module and root-selection boundaries.
- Management project-schema and aggregate tests cover S2 and P2 through the actual management adapters.
- The spawned CLI journey exercises the authoritative build path and cross-command partition consistency for S3.
- Archive/template guards, run-state/session routing, retention, and work migration cover P3, P5, and P6 at every execution-owned mutation boundary touched by the findings.
- TypeScript, ESLint, build, diff, encoding, and the full suite provide repository-wide regression coverage for the shared routing changes.

### Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run test/core/store-planning/store-planning.test.ts test/core/store-planning/path-guard.test.ts test/core/management-api/planning-scope-routing.test.ts test/core/root-selection.test.ts test/commands/store-v2-planning-scope-journey.test.ts test/commands/pipeline-store-root-selection.test.ts test/core/templates/planning-scope-guidance.test.ts` | PASS for the six matched files, 88/88 tests. The requested `path-guard.test.ts` name did not exist; the actual guard was run next. |
| `pnpm exec vitest run test/core/store-planning/planning-path-source-guard.test.ts` | PASS, 2/2 tests. |
| `pnpm exec vitest run --maxWorkers=1 test/commands/store-v2-planning-scope-journey.test.ts test/core/pipeline-registry/run-state.test.ts test/core/management-api/planning-scope-routing.test.ts test/core/management-api/sessions-space.test.ts test/commands/retain-prepare.test.ts test/commands/work.test.ts` | PASS, 198/198 tests in 6 files. Sequential execution avoids an observed Windows `EBUSY` rename flake from the parallel run. |
| `pnpm exec vitest run test/commands/retain-prepare.test.ts` | PASS, 29/29 tests; isolated rerun confirmed the prior `EBUSY` was transient. |
| `pnpm exec tsc --noEmit` | PASS. |
| `pnpm run lint` | PASS. |
| `pnpm run build` | PASS. |
| `git diff --check b86fbb6bfa7a3915392f53869232e8de659beea3 --` | PASS; line-ending conversion warnings only. |
| Strict UTF-8 decode of 129 changed/untracked text files; parse 12 JSON files; compare replacement-character and BOM counts with baseline | PASS. No invalid UTF-8 or invalid JSON. Three files contain baseline-identical literal replacement characters; one test file retains its baseline BOM. No encoding anomaly was introduced. |
| `pnpm exec vitest run --reporter=dot` | NOT CAPTURED. The round 1 run was still in flight when that report was drafted and its result was never recorded (round 2 finding NEW-11). It is superseded: the tree changed again in round 2, so the authoritative full-suite result for this Change is the round 2 gate below. |

### Tree identity

- `git rev-parse HEAD`: `b86fbb6bfa7a3915392f53869232e8de659beea3`
- `git rev-parse HEAD^{tree}`: `b65afd5f83488eafb4e86cb7f9a46e55b218b5bf`
- The implementation and report are live uncommitted working-tree changes on that tree; the independent reviewer must re-review the live delta, not only the base commit.

## Round 2 disposition

Source: `evidence/review-report-r2.md` (verdict NOT CLEAN — 6 RESOLVED, 3 PARTIAL, 12 new findings). The round 1 findings keep their round 2 verdict below; every PARTIAL is closed by the NEW finding that names its remaining half.

| Finding | Severity | Round 2 verdict | What changed in round 2 | Confirmed by (non-author) |
| --- | --- | --- | --- | --- |
| S1 — publication can replace/delete another writer's target | Blocker | RESOLVED in round 1 | Untouched except NEW-7 (owner token now retired on success). | Pending |
| S2 — management reads reject Store project-local schemas | Major | RESOLVED in round 1 | Untouched. | Pending |
| S3 — spawned CLI tests accept stale `dist` | Minor | RESOLVED in round 1, mechanism replaced | Fingerprint + build lock replaces the unconditional clean rebuild (NEW-12); the "never trust an unmarked/stale `dist`" property is preserved. | Pending |
| P1 — selection/bound-project discovery fails open to legacy | Blocker | PARTIAL → closed by NEW-1 | Ambient branch no longer swallows a StorePlanning diagnostic. | Pending |
| P2 — Store aggregate `context`/`doctor` not implemented | Blocker | PARTIAL → closed by NEW-6 | `context` now states the project-authority requirement. | Pending |
| P3 — Store v2 Archive/spec-sync active before its owner | Blocker | RESOLVED in round 1 | Stored-plan gate hardened (NEW-5). | Pending |
| P4 — explicit selectors skip the planning-worktree marker | Blocker | RESOLVED, regression closed by NEW-2 | Nearest-checkout preference now requires a Store identity match; the P4 case (nearest checkout IS the selected Store) still wins. | Pending |
| P5 — Store planning dirs remain a run-state fallback | Blocker | RESOLVED in round 1 | Untouched. | Pending |
| P6 — Store mutators infer execution authority from cwd | Blocker | RESOLVED, over-broad half corrected by NEW-3 | Store v2 stays fail-closed; legacy/compat retention regains its discovered launch project. | Pending |
| NEW-1 — ambient bound-project reads fail open to the flat Store root | Blocker | FIXED | `src/core/root-selection.ts` (ambient branch) + `src/core/store-planning/internal/resolver.ts` (inheritance classification). | Pending |
| NEW-2 — unrelated Store checkout in cwd overrides explicit selection | Major | FIXED | `resolver.ts` marker read + `preliminaryStoreRoot` now require a Store identity match. | Pending |
| NEW-3 — legacy `work migrate` / `retain prepare` permanently refused; tests inverted | Major | FIXED (per LEAD decision) | `work migrate` keeps a DELIBERATE refusal with the correct diagnostic; `retain prepare` restored; inverted tests restored or renamed to say what is deliberate; BREAKING bullet + spec scenario added. | Pending |
| NEW-4 — one malformed catalog disables every project and `doctor` | Major | FIXED | Per-file fault isolation in `loadProjectCatalogs`; broken siblings become notices; the offending path is in the diagnostic `target`. | Pending |
| NEW-5 — stored-plan gate is a path-substring heuristic | Minor | FIXED | `ArchivePlan.scope` records the scope; the legacy fallback is relative to the plan's own planning root. | Pending |
| NEW-6 — aggregate `context` omits the project-authority statement | Minor | FIXED | `store_aggregate_scope` status in JSON and a dedicated human block; journey asserts the statement. | Pending |
| NEW-7 — `.rasen-publish-owner` persists in every Change | Minor | FIXED | Token retired after read-back verification; the test now asserts its absence and the exact published entry set. | Pending |
| NEW-8 — orphan reservation blocks the Change id with no recovery | Minor | FIXED | The diagnostic distinguishes an incomplete reservation (no `.openspec.yaml`) from a real Change and names the recovery; the stale `.create.lock` also names its recovery. | Pending |
| NEW-9 — TOCTOU can add a stray entry to a foreign replacement | Minor | ACCEPTED, NOT FIXED | Bounded and non-destructive by the reviewer's own assessment; no file is removed. Fixing it needs a link-then-verify primitive that does not exist on both platforms. Recorded for the finalization child. | Pending |
| NEW-10 — dead `resolveExecutionRoot()` with tests asserting retired behavior | Minor | FIXED | Export and its cwd-probing helper deleted; the test now asserts the export is gone and says why. | Pending |
| NEW-11 — round 1 gate table still reports the full suite as unfinished | Minor (process) | FIXED | The round 1 row now states the result was never captured and is superseded by the round 2 gate. | Pending |
| NEW-12 — every vitest invocation destructively cleans the shared `dist/` | Major | FIXED | Build fingerprint + cross-process build lock; no unconditional clean. | Pending |

Round 2 totals: 1 Blocker / 4 Major / 7 Minor. 11 fixed, 1 accepted with an explicit note (NEW-9).

## Round 2 fix summary

### NEW-1 — the ambient path stops converting diagnostics into legacy projections

- `resolveOpenSpecRoot()` (`src/core/root-selection.ts`) returns a scoped result for `store-project`/`store-aggregate` and falls through to the frozen compatibility adapter only for the POSITIVE `standalone`/`legacy-store` answers.
- On a StorePlanning failure the ambient branch now applies the same rule the explicit `--store` branch already used: it asks the compatibility adapter to resolve the declaration, and if that adapter positively resolves a **layout-v2** Store it rethrows the planning diagnostic instead of returning the projection. Store-declaration availability and identity problems (unregistered, invalid id, unhealthy root, metadata mismatch) keep their established richer taxonomy, including the `allowUnavailableStore` read-only path doctor depends on (design D4). A checkout with no Store fact at all — no resolvable `store:` declaration and no `.rasen/planning-binding.json` — is an ordinary local root and never enters this path.
- The genuine configuration-inheritance case is now a POSITIVE resolver answer rather than a caught exception: `resolver.resolve()` drops a Store that was named only by the project's own configuration declaration when the project keeps a local planning tree and the Store's v2 catalog does not record it as `bound` with the planning role. A bound project with a local tree is still `split_planning_truth`, not inheritance.
- A checkout with no local planning whose relationship is unbound or absent now reports `project_not_in_store` instead of silently reading the Store's root-level `rasen/changes` (`specs/store-config-inheritance/spec.md:46-50`).

### NEW-2 — the nearest Store checkout must BE the selected Store

- `resolver.resolve()` reads the nearest checkout's `.rasen-store/store.yaml` once, leniently, purely for comparison (unreadable metadata yields no identity, so it can only fail to match — it can never redirect).
- Both the planning-marker read and `preliminaryStoreRoot` accept the nearest checkout only when its uid (else id) matches the selected Store entry. With no Store selected yet, the nearest checkout remains the only Store evidence and stays admissible; `loadStore()` still verifies identity afterwards.
- P4 is preserved because there the nearest checkout IS the selected Store.

### NEW-3 — the legacy decision, written down

- `rasen work migrate` against a legacy flat Store keeps its refusal but now reports `legacy_flat_store_requires_migration`: migration writes planning-owned files INTO the planning root, and a legacy flat Store's planning tree is read-only until migration. The check runs before the execution-authority check, so it names the cause and the repair.
- `rasen retain prepare` is RESTORED for legacy Store selection. Retention writes only execution-owned ephemera into the member checkout, which `specs/file-placement/spec.md:34-38` explicitly endorses. `withCompatibilityExecutionRoot()` supplies the execution root for store-selected COMPATIBILITY roots only, from a DISCOVERED qualifying project checkout that is not the Store itself — never the bare current directory, and never for a scope-carrying (Store v2) root, which keeps the fail-closed rule of `specs/file-placement/spec.md:40-44`.
- Tests: the three inverted `retain-prepare` cases are restored to assert the supported behavior (the file is now baseline-identical apart from one clarified comment). The two `work` cases keep their refusal assertions, now on `legacy_flat_store_requires_migration`, and their names and comments say the refusal is deliberate.
- Recorded, not only tested: a second BREAKING bullet in `proposal.md` and a new scenario in `specs/store-planning-scope-routing/spec.md` ("Legacy flat Store refuses work migration").

### NEW-4 — one bad catalog file no longer disables a Store

- `loadProjectCatalogs()` isolates faults per file and returns `{ entries, broken }`, both canonically sorted. A file that cannot be parsed, or whose filename does not match its `projectId`, becomes a `broken` record carrying its own path.
- A project scope still fails closed for the SELECTED project: if no entry matches and any file is broken, the diagnostic is `invalid_project_catalog` with the offending file as `target` (never "not in Store", which would be a guess).
- Broken siblings become `invalid_project_catalog` notices, so other projects and the Store aggregate — the scope `doctor` reads — keep resolving.
- `storeClaimsProjectPlanning()` refuses to downgrade Store-owned planning to local inheritance while any catalog is unreadable.

### NEW-5 — the plan carries its own scope

- `ArchivePlan.scope` records `kind` plus Store uid / project id and participates in the canonical plan hash. `storedPlanFinalizationDiagnostic()` reads it instead of testing `plan.paths.active` for a `<sep>rasen<sep>projects<sep>` substring.
- Plans written before the field existed are classified from `path.relative(plan.roots.planning, plan.paths.active)`, which cannot alias the checkout's own location — so a standalone project at `E:\rasen\projects\myapp` is no longer refused.

### NEW-6 — the aggregate payload states the requirement

- `store-aggregate` context returns a `store_aggregate_scope` status ("project authority is required for project content"), matching what `doctor` already reports, and the human form prints a dedicated Store-aggregate block instead of the "no references declared" line.
- The journey now asserts the statement in both JSON and human output, not only path-absence plus a banner string.

### NEW-7 / NEW-8 — publication hygiene

- The ownership token is unlinked after read-back verification succeeds, identity-checked so a foreign replacement can never lose a file to the cleanup. Its test now asserts absence and the exact published entry set.
- An existing target with no `.openspec.yaml` is reported as an incomplete publication reservation with the removal named as the recovery; a held `.create.lock` names the stale-lock recovery.

### NEW-10 — dead execution-root probe removed

- `resolveExecutionRoot()`, `ResolveExecutionRootOptions`, and `findCodeProjectRoot()` are deleted from `src/core/file-placement.ts`, replaced by a comment stating where execution authority actually comes from. The test asserts the export is gone and why.

### NEW-12 — non-destructive, fingerprinted builds

- Chosen approach: **fingerprint plus a cross-process build lock** (the reviewer's first option, with the lock added).
- `build.js` computes a SHA-256 over the compiler inputs (`src/**`, `tsconfig.json`, the TypeScript version, and `build.js` itself) and records it in `dist/.build-fingerprint.json` AFTER a successful compile, so a partially compiled `dist/` can never look fresh.
- `pnpm run build:if-stale` (`build.js --if-stale`) returns without touching anything when the recorded fingerprint matches and `dist/cli/index.js` exists. Only on a genuine mismatch does it take a `os.tmpdir()`-scoped exclusive lock (10-minute stale takeover), re-check under the lock, and then clean and recompile. A plain `node build.js` — CI, `prepare`, `prepublishOnly` — always rebuilds, unchanged.
- `vitest.setup.ts` calls `ensureCliBuildFresh()`, which deliberately IGNORES any ambient `RASEN_TEST_CLI_BUILD_READY` and only sets it after proving the bundle current. That keeps the S3 property (an unmarked or stale pre-existing `dist/` is never trusted) while removing the unconditional clean that made two concurrent vitest processes corrupt each other. Workers still take the inherited-marker fast path.
- Residual, stated honestly: if a source file changes while another vitest process is mid-run, that second process still rebuilds — but the first process's `dist/` is stale by then and its results were already invalid. Eliminating even that needs a compile-to-temp-then-swap publish, which would change what CI and `npm publish` produce; it is out of this Change's scope.
- `package.json` excludes `dist/.build-fingerprint.json` from the published tarball.

### NEW-9 — accepted, not fixed

The reviewer's own assessment is that this is bounded: the second `link()` can add one stray entry inside a foreign replacement directory, and nothing is ever deleted. Closing it needs an atomic link-then-verify primitive with the same semantics on Windows and POSIX, which does not exist; the alternative (verify before every link) does not remove the window, it only moves it. Recorded here so the residue is not later mistaken for full atomicity, and carried to the finalization child that owns the publication primitive.

## Round 2 full-suite failure triage (17 failures, 9 files)

Source: the authoritative full-suite run (18 failed / 6171 passed / 34 skipped). One failure — the placeholder Purpose in `rasen/specs/change-finalization-record-v2/spec.md` — is owned and already fixed by the LEAD and is excluded here.

Three distinct root causes account for all 17. Each is proven below, then applied per test. **Every disposition here was confirmed by re-running the file after the round 2 fixes, not predicted**: 1 is fixed and green, 11 are red for one contract-mandated reason, 5 are red for a machine-environment reason proven by controlled experiment.

### Root cause 1 — legacy flat Store planning writes are refused (11 failures)

`resolver.resolve()` throws `legacy_flat_store_requires_migration` for `intent: 'create-change'` on any `legacy-store` ref, and `src/core/archive.ts` `storeFinalizationDiagnostic()` refuses Archive for the same class. **No Store on disk has `layoutVersion: 2`** — migration is child 3 (`store-layout-v2-migration`) and has not been built — so every existing Store is a "legacy flat Store". The externalized-planning product (pointer repo → Store, `--store <id>` creation, Store Archive) is therefore write-dead in this child.

This is not an accident of implementation: it is what the approved contract says.

- `design.md:23` (Goals): "make legacy flat Stores read-only".
- `design.md` D5 table: `legacy flat Store | supported read-only commands | legacy_flat_store_requires_migration | one frozen legacy adapter`.
- `specs/store-planning-scope-routing/spec.md`, scenario "Legacy flat Store rejects a write": "**WHEN** new, apply, archive, or another planning mutation targets a legacy flat Store **THEN** it SHALL fail with `legacy_flat_store_requires_migration`".
- `tasks.md` 8.2: "refuse legacy-flat or Store v2 finalization paths not yet owned by `ChangeFinalizationModule`".
- The spec's read-only allowance names `list, show, validate, status, instructions, export, doctor, and migration inspection` and deliberately excludes `new` and `archive`.

**Disposition: (b) expected by the design — but the required test rewrite is BLOCKED on a LEAD decision, recorded below.** These are not assertions about incidental behavior; five of them are end-to-end product *journeys* whose entire subject is "the externalized-planning lifecycle works". A journey cannot be honestly rewritten into "step one is refused" — its correct successor is "migrate, then run the lifecycle", which depends on child 3. See "Open decision" below.

| # | Test | Failing call |
| --- | --- | --- |
| 1 | `cli-e2e/capstone-journeys.test.ts` — journey 3, externalized planning without `--store` | `new change add-rate-limits` |
| 2 | `cli-e2e/store-lifecycle.test.ts` — machine A works a change through archive | `new change --store` `:270`, `archive --store` `:327` |
| 3 | `cli-e2e/store-lifecycle.test.ts` — machine B clone reads promoted specs | depends on #2 having archived |
| 4 | `cli-e2e/store-lifecycle.test.ts` — machine B completes its own change | `new change --store` `:402`, `archive --store` `:436` |
| 5 | `cli-e2e/store-lifecycle.test.ts` — end state is normal Rasen files | depends on #2/#4 |
| 6 | `commands/declared-store-fallback.test.ts` — externalized-planning journey without `--store` | `new change billing-rework` `:56` |
| 7 | `commands/declared-store-fallback.test.ts` — declared root surfaces store references | `new change ref-check` `:139`, observed `expected 1 to be +0` at `:143` |
| 8 | `commands/store-references.test.ts` — omits references on self-reference | `createChange(..., ['--store','team-context'])` `:127` |
| 9 | `commands/store-references.test.ts` — reads resolved root config for `--store` sessions | `createChange(..., ['--store','team-context'])` `:150` |
| 10 | `commands/store-add-project.test.ts` — indexes the added project's specs for instructions | `new change --store team-context` `:173` |
| 11 | `commands/legacy-groups-removed.test.ts` — initiative data byte-identical | `new change --store team-context` `:131` |

**Confirmed by execution after the round 2 fixes: all 11 are still red, every one on `expected 1 to be +0` at a `new change`/`archive` exit code.** Two of the five `store-lifecycle`/`capstone` failures are cascade victims of the first (`git commit` with nothing staged; `ENOENT` scandir on a Store directory the refused run never populated).

Two independent discriminators prove this is the cause and nothing broader:

1. `store-references.test.ts:160` ("never follows a referenced store's own references") creates a Change in the **same fixture** without `--store`, resolves standalone, and PASSES. Only the `--store`/pointer creations fail.
2. Direct CLI probe (see the gate section): `list --json` against the pointer repo returns **exit 0** with `source: "declared"` and the Store root, while `new change` — ambient AND `--store` — returns exit 1 `legacy_flat_store_requires_migration`. Reads are healthy; only writes are refused.

### Root cause 2 — `--store S --project P` silently dropped the project selector on a non-v2 Store (1 failure)

**Disposition: (a) real regression — FIXED, and the test updated for the separately-retired diagnostic.**

`resolveOpenSpecRoot()` routes any both-selector call straight to StorePlanning, bypassing the compatibility adapter's existing `project_not_in_store` guard. For a legacy Store the resolver then built a `legacy-store` ref and returned the Store's flat root with `--project` ignored — exit 0. This is the same fail-open family as NEW-1: a selector that cannot be validated must not be dropped.

Fixed in `resolver.ts`: when both explicit selectors are supplied and the resolved Store is not layout v2, resolution fails `project_not_in_store` naming the Store and the repair. `--project P` alone is untouched, so pointer-project selection keeps working.

| # | Test | Disposition |
| --- | --- | --- |
| 12 | `commands/store-add-project.test.ts` — `--store`/`--project` same-named entries (8.2) | (a) code fixed; the assertion moved from `store_project_mutually_exclusive` to `project_not_in_store`, because that code is **deliberately retired** (`proposal.md` BREAKING bullet; `design.md` D4 "`store_project_mutually_exclusive` is retired"). The test still asserts a REFUSAL, now for the real reason. **Verified: this case now PASSES.** |

### Root cause 3 — Windows `%LOCALAPPDATA%\rasen` makes every "outside a Rasen project" fixture look inside one (5 failures)

**Disposition: (c) environmental — demonstrated, with no causal connection to any file this change touches.**

Proof:

1. `src/commands/config.ts` decides "am I in a project?" with `findRepoPlanningRootSync(process.cwd())` (`:89` for `--scope project`, `:155` and `:363` for the editor). That helper is a pure ancestor walk for a `rasen/` **directory** (`src/core/planning-home.ts:62-66`).
2. On this machine `C:\Users\Sayo\AppData\Local\rasen` **exists as a directory**, created `2026-08-01T06:39:22Z` — before this change's baseline — containing `local-harness/{homes,locks,runtimes,staging}`. It is the old-scheme Windows global **data home**: `GLOBAL_DATA_DIR_NAME = 'rasen'` under `%LOCALAPPDATA%` (`src/core/global-config.ts:31,504-507`). It holds machine-home state, not planning content.
3. `os.tmpdir()` on Windows is `%LOCALAPPDATA%\Temp`, so that directory is an **ancestor of every `mkdtemp` fixture**. `findRepoPlanningRootSync` therefore returns `C:\Users\Sayo\AppData\Local` for any temp cwd, and the editor reports `ui.heading` instead of `ui.outsideProject` — exactly the observed Japanese failure (expected `"Rasenプロジェクト外のため"`, received `"Rasen設定"`).
4. No causal connection: `git diff b86fbb6b -- src/core/planning-home.ts` is **empty**, and `src/commands/config.ts` is **not modified** by this change (`git status` lists only `src/core/config-api/project-addressing.ts` and `src/core/project-config.ts` in that area, neither of which is on this path).
5. Negative control that separates this from root-cause 1: `legacy-groups-removed.test.ts:129` asserts `rasen update` exits 1 "(no project)" from the same temp cwd, and `update` resolves through `findQualifyingRootSync`, which additionally requires planning shape or a store pointer. `%LOCALAPPDATA%\rasen` has neither, so `update` is unaffected — only the `findRepoPlanningRootSync` consumers fail.
6. **CONTROLLED EXPERIMENT (decisive).** Re-running `config.test.ts` + `config-editor.test.ts` unchanged, with only `TMP`/`TEMP` repointed to `E:\rasen-tmp-proof` (a temp root with no `rasen/` ancestor): **87/87 PASS**, including all five failures. Under the default Windows temp the same two files are 119 pass / 5 fail. The single changed variable is the temp root — no source, no fixture, no flag. The scratch directory was removed afterwards.

| # | Test | Disposition |
| --- | --- | --- |
| 13 | `commands/config.test.ts` — fails `--scope project` outside a Rasen project | (c) environmental |
| 14 | `commands/config-editor.test.ts` — no scope prompt for a both-scope key outside a project | (c) environmental |
| 15 | `commands/config-editor.test.ts` — project-only keys disabled outside a project | (c) environmental |
| 16 | `commands/config-editor.test.ts` — localizes config groups in Japanese | (c) environmental |
| 17 | `commands/config-editor.test.ts` — localizes config groups in Simplified Chinese | (c) environmental |

Not this change's defect, but a real harness weakness worth a follow-up in its own Change: these five tests assume no `rasen/` directory exists above `os.tmpdir()`, which is false on any Windows machine that has ever run Rasen. The fix is a fixture root outside the machine-home ancestry (or an explicit sentinel), not a source change here.

### Root cause 1 — RESOLVED by option (ii), decided by the LEAD

The LEAD chose option (ii) and supplied the evidence that settles it: **child 3's proposal already claims this refusal** — `rasen/changes/store-layout-v2-migration/proposal.md:20`: "a legacy flat Store refuses those mutations until it is migrated." Enforcement therefore belongs with the migration that makes it survivable, and the whole portfolio lands as one PR, so the end state is unchanged.

Implemented:

- `resolver.ts` — the `create-change` legacy-store refusal removed; a legacy flat Store obtains a `ChangeCreationScope` that writes its own flat layout and mints no v2 identity. A v2 Store never classifies as `legacy-store`, so no flat v2 destination becomes writable.
- `types.ts` — `LegacyStoreAuthoringRef` added to the `ChangeCreationScope` ref union.
- `archive.ts` — `storeFinalizationDiagnostic()` legacy branch removed; Store v2 stays fail-closed, which is what P3 actually required.
- Notice `legacy_flat_store_read_only` renamed to `legacy_flat_store_layout` with an accurate message — the old text asserted a read-only rule that no longer holds.
- Contract re-scoped: `design.md` goal line, D5 legacy row, D6's `ChangeCreationScope` sentence, the delta scenario (now "Legacy flat Store keeps writing its own flat layout" plus a new "A Store v2 destination is never written through the legacy adapter"), and the `store-config-inheritance` requirement and scenario.
- Deferral recorded where it cannot be dropped: **`rasen/changes/store-layout-v2-migration/tasks.md` section 10b** (5 tasks) covering the refusal, the contract re-scope, rewriting the five journeys into "migrate, then run the lifecycle", the six unit-level cases, and a BREAKING bullet for child 3's proposal.

**All 11 are green**, with no journey rewritten and no test blessing a refusal.

Two follow-on defects surfaced once creation and archive actually ran, both fixed:

- `rootFromCreationScope()` dropped Store identity for a legacy authoring scope, so `new change` lost its `Using Rasen root:` banner, the `store_id` field, and every follow-up `--store` hint. Now carried for `legacy-store` as it already was for `store-project`.
- `withCompatibilityExecutionRoot()` was stricter than the behavior it restored: a legacy Store member checkout often has neither a planning shape nor a store pointer, and Archive has always written execution-owned ephemera there. Order is now launch project, else enclosing code checkout, else the launch directory — never the Store checkout or anything inside it.

The contract says legacy flat Stores are read-only. The consequence, which no gate has previously exercised, is that between child 2 and child 3 there is no way to create or archive a Change in ANY Store, and `proposal.md` records no such breaking change. Three ways forward:

- **(i) Enforce now, rewrite the tests.** Convert all 11 to assert `legacy_flat_store_requires_migration` plus zero writes (the spec's second bullet). Mechanical but destroys five product journeys' subject matter, and child 3 will rewrite them again into "migrate, then run the lifecycle". Also needs a first-class BREAKING bullet in `proposal.md`.
- **(ii) RECOMMENDED — move enforcement to child 3, where the remedy lives.** Keep the frozen legacy adapter writable for `new`/`archive` in child 2; keep refusing every Store **v2** flat-path write, the `work migrate` case already decided, and all v2 finalization. Edits: `resolver.ts` create-change guard (restrict to v2), `archive.ts` `storeFinalizationDiagnostic()` legacy branch, `design.md:23` + D5 row, and the spec scenario "Legacy flat Store rejects a write" re-scoped to v2 destinations. 11 tests go green with no rewrite.
- **(iii) Defer the journeys.** Skip the five journeys with a reason pointing at child 3, rewrite the six unit-level ones. Leaves the product's main path unproven for the rest of the portfolio.

I did not apply any of these: (ii) reverses an approved design line and rewrites an approved delta-spec scenario, which is not mine to do unilaterally. Say which one and I will execute it immediately.

## Defects found while executing the triage (not in the reviewer's or the LEAD's lists)

Running the affected suites surfaced seven more, all fixed and verified.

| # | Defect | Disposition |
| --- | --- | --- |
| A | **A literal NUL byte in `resolver.ts`**, written by my own NEW-4 edit where a space was intended (`` `${entry.path}\0${entry.reason}` ``). **Lesson worth keeping: `tsc`, ESLint and `git diff --check` all passed over it — those three gates do not constitute an encoding check.** Only a byte-level scan caught it (`git` did flag the file as binary, which is the cheap tell). Repaired at byte level; a full re-audit of all 97 changed/untracked files shows 0 NUL. The residual `U+FFFD`/BOM counts in 4 files were verified **byte-identical to baseline**, not inherited on trust. | (a) mine, fixed |
| B-D | **Three more inverted tests** in `store-root-selection.test.ts`, the same anti-pattern as NEW-3: "creates a change only in the store…", "includes the shared root block…", and "archives a change into the store archive…" had been rewritten into refusal assertions. Restored to assert the supported behavior. | (a) restored |
| E-F | **Two `sessions-space` regressions** caused by my own root-cause-2 guard. Measured, not guessed: a temporary instrumented run showed `runState.error = "Store 'worktree-store' has no version 2 project catalog…"`. A frozen Session legitimately carries a Store plus one of its members, so the shared resolver must not refuse that pair. The refusal moved to the CLI adapter (`resolveOpenSpecRoot`), mirroring how the `--store`-only branch already defers a legacy Store to the compatibility adapter. The CLI refusal is preserved; internal callers are unaffected. | (a) mine, fixed |
| G | **NEW-8's discriminator was unsafe.** I had treated "directory without `.openspec.yaml`" as an abandoned reservation and advised deleting it — which would tell a user to delete a hand-made or partially authored Change. `submit.test.ts` caught it. The test is now "provably holds nothing" (empty, ignoring the ownership token), which is what the reviewer actually asked for. | (a) mine, fixed |
| H | **Reconstruction ordering**, see the incident below: `sessions-api.test.ts` pinned that home-inspection failures must surface before planning resolution. | (a) fixed |

### Incident — `sessions.ts` reverted and reconstructed

While reverting two speculative edits of mine I ran `git checkout -- src/core/management-api/sessions.ts`, which reset the file to the **baseline commit**, discarding this Change's own modifications to it (the P5 run-state work and the space-identity listing filter). `dist/` held only a post-revert build, and no cache or backup contained the original, so it could not be restored mechanically.

It was reconstructed from four independent sources and then verified, not assumed:

1. the run-state join block, which I had read verbatim earlier in this session;
2. `router.ts:1095-1104`, which pins the `filterSpace: Pick<ResolvedSpace,'type'|'id'>` signature;
3. the round-1 review's citation of `sessions.ts:281-285` as a P5 `StateFileLocationOptions` site, and the surviving sibling `project-space.ts:110-124`;
4. the original line numbers I had observed (`const facts` at 245), which located the home block *before* the planning block — later confirmed independently by `sessions-api.test.ts`.

Verification: the **entire** `test/core/management-api/` suite plus `run-state` and `store-planning` — **615 passed, 1 skipped, 0 failed** — including `sessions-space` (12 tests, the file's behavioral spec), `sessions-api`'s fail-closed ordering test, and the Store v2 journey's planning-side decoy assertion that P5 exists to enforce. Reconstruction risk is therefore low but non-zero, and the independent reviewer should read this file with that in mind.

### Reconstruction provenance — `sessions.ts`, hunk by hunk

Passing tests do not prove this file is what it was; they prove it is consistent with what the tests check. This table exists so the independent reviewer can audit the reconstruction instead of trusting it. Strength is stated per hunk, and the unpinned residue is listed last rather than smoothed away.

| # | Hunk | What pins it | Strength |
| --- | --- | --- | --- |
| 1a | `-import { WORKSPACE_DIR_NAME }` | Its only consumer was the deleted flat join. Nothing else in the file references it. | **Strong** (compiler/lint) |
| 1b | `+import { StorePlanning, type PlanningSelection }` | Required by hunk 6, which I read verbatim; compilation fails without it. The module specifier and import style are my choice. | **Strong** on necessity, **weak** on form |
| 1c | `+import type { ResolvedSpace } from '../config-api/project-addressing.js'` | `router.ts:11-15` imports `ResolvedSpace` from exactly this module, and `router.ts:1095` types the variable it passes. | **Strong** (external signature) |
| 2 | Docstring rewrite | Nothing. The original wording is lost; this is my prose describing the reconstructed behavior. | **UNPINNED** (no behavioral risk) |
| 3 | `filterRoot: string` → `filterSpace: Pick<ResolvedSpace,'type'\|'id'>` | `router.ts:1095-1104` constructs `filterSpace = { type, id }` and passes it. Compilation fails on any other shape. | **Strong** (external signature) |
| 4 | Filter body compares `type` **and** `id` | The signature forces identity comparison rather than a root compare. That it also compares `type` is **my inference**. | **Weak** — see residue (a) |
| 5 | `-const changeDir = path.join(record.space.root, WORKSPACE_DIR_NAME, 'changes', …)` | This flat join is the P1/P5 defect itself; the round-1 review cites this file as a P5 site, and hunk 6 reassigns `changeDir`. | **Strong** |
| 6 | The `facts` / `selection` / `StorePlanning.open` / `openChange` / `storeV2Planning` block | **Read verbatim** from the intact file earlier in this session, and it is quoted in that state in my own earlier handback. Behaviour additionally exercised by `sessions-space` Store-space tests. | **Strong-ish** — verbatim from my reading, which is the weakest of the "strong" sources |
| 7 | Ordering: home resolution **before** the planning block | `sessions-api.test.ts:344` ("fails closed for missing, planning-only, removed, and unexpectedly unreadable execution") **failed** when I had it the other way, demanding `"home inspection denied"` rather than a Store diagnostic. Independently corroborated by the original line numbers I observed (`const facts` at 245). | **Strong** (a test caught it wrong) |
| 8 | `...(storeV2Planning ? { includeChangeDir: false } : {})` | Task 5.5 and the round-1 P5 fix; the Store v2 journey plants a planning-side `auto-run.json` decoy and asserts the execution ephemera wins. Mirrors the surviving sibling `project-space.ts:110-124`. | **Strong** (behavioral test) |
| 9 | `-canonicalizeOrResolve()` and `-import * as path` | Removing hunk 4's root compare left both unused. Whether the ORIGINAL deleted them is unpinned; leaving dead code is a defect either way, so I removed them. | **Weak** — my choice, zero behavioral effect |

Corroborating but not probative: the round-1 review cites `sessions.ts:281-285` as the P5 `StateFileLocationOptions` site. In the reconstruction that region sits ~5 lines above the `const locations` block, consistent with slightly different comment lengths. It shows the overall structure landed in the right place; it does not show equivalence.

**Unpinned residue — read these hardest:**

- **(a) The project-space filter predicate.** No test distinguishes "compare `type` and `id`" from "compare `id` only", nor from a variant that still canonicalized the root for `project` spaces (which would explain why `canonicalizeOrResolve` existed). `sessions-space.test.ts:461-465` filters a project space and a store space with *different* ids, so it passes under all three readings. If the original canonicalized roots for project spaces, my version differs in the case of two project spaces sharing an id at different roots.
- **(b) All comment and docstring wording** in the touched region. Lost; no behavioral effect, but a reviewer diffing prose against the round-2 reviewer's memory will see differences that are mine, not the original's.
- **(c) Anything the original did that no test covers and no sibling constrains.** Unknowable by construction. The bound I can state: the diff is confined to the imports and `handleListSessions`; `handleLaunchSession`, `handleGetSession`, and `handleKillSession` are byte-identical to baseline, and the round-1 review only ever cited this file within the list/run-state path.

The round-2 reviewer read this file while it was intact and is the right cross-check for (a) and (b).

### Two further inverted tests — RESOLVED (see below), plus one still open

**`new change` vs `list` disagreement — RESOLVED by restoring baseline.**

Step 1, is the new scaffolding behavior mandated? **No.** A search of this child's `design.md`, `proposal.md`, `tasks.md`, and all six delta specs found no requirement for it. The only mention anywhere is the round-1 implementer's own `handoff/implementer-1.md:18` — a self-report of what they did, not a contract. The nearest actual rules point the other way: the portfolio's locked decision "preserve standalone/in-project behavior for projects that are not Store-bound" (a directory with no `rasen/` is not a project, so scaffolding one preserves nothing), and the delta spec's only creation requirement, which governs metadata rather than root discovery.

Step 2, therefore restored. `resolveChangeCreationForCommand()` now applies the same invocation guard the read path uses: with no selectors and no qualifying root at the start path, it defers to the frozen compatibility adapter, which owns the established taxonomy (the registered-Store list, `--store <id>`, and the `rasen init` hint) and is read-only. The test name and assertions are restored to baseline.

Verified by direct CLI probe — the two commands now emit **byte-identical** diagnostics in the same directory, and nothing is scaffolded:

```
new change exit 1 | No Rasen root found in the current directory or its ancestors.
                    Registered stores: team-context. Pass --store <id> to use one,
                    or run rasen init to create a local root.
list       exit 1 | (identical)
no stray root scaffolded: true
```

The genuine implicit-root path is intact: with **no** Stores registered, `rasen new change foo` in a fresh directory still exits 0 and scaffolds, exactly as at baseline.

**Store archive coverage — RESTORED.** The whole `archive --json is non-interactive` describe block had been rewritten to run against a new standalone `archiveRoot` instead of the Store: `--store team-context` dropped from six tests, and the `fix:` strings that carried `--store` with it. That was done to dodge the legacy Store archive refusal, which option (ii) removed, so the reason for the move no longer existed and what remained was silently reduced Store coverage inside a Change whose subject is Store routing.

The block was restored by splicing the baseline version back verbatim (213 lines, 7 `it()` blocks), not by hand-editing. **All 34 tests in the file pass with no test adjusted** — which is itself the confirmation that option (ii) genuinely restored legacy Store archive rather than merely moving the failure. `test/commands/store-root-selection.test.ts` is now byte-identical to baseline except for one assertion, which is *stronger* than baseline: it pins the exact root key set and asserts `scope.kind === 'legacy-store'`.

## Round 3 disposition

Source: `evidence/review-report-r3.md` — 9/9 round-1 and 11/12 round-2 findings independently confirmed resolved, NEW-9 independently bounded. Three new findings blocked; all three came from work done after the round-2 report.

| Finding | Severity | Disposition | Evidence |
| --- | --- | --- | --- |
| R3-1 | Major | **FIXED** | All four generated-skill gate paragraphs narrowed to `store-project` only. The `legacy-store` refusal clause is gone, so `/rasen-archive-change`, `/rasen-ship`, `/rasen-bulk-archive-change` and `/rasen-sync-specs` now agree with the CLI. "in this child" phrasing dropped from all four. Added to child 3 §10b.2 **with a required template guard**, since the absence of any test over these paragraphs is exactly why the removal was missed. |
| R3-2 | Major | **FIXED** | Layout discrimination via a new shared `isStoreAggregateSpace()`. A `store:` space resolving to `legacy-store` now yields its flat project content from the scope's typed addresses; only a Store **v2** aggregate returns `project_scope_required`. Applied at all THREE undiscriminated sites, not just the cited one: `project-space.ts`, `router.ts` change submission, and `ChangeSubmissionTarget`. Both inverted tests restored from baseline and green. |
| R3-3 | **Blocker** | **FIXED** | `storePermitsProject()` restored as the vouching authority, with the full rejection diagnostic (legacy-migration marker + copy-pasteable `rasen store add-project … --store …` repair). `execution_identity_mismatch`, which had been deleted outright, is restored. The effective-scope comparison is **demoted to enrichment**: it can no longer gate, and a failure to resolve it yields no facts instead of pre-empting the membership diagnostic. All inverted tests restored from baseline. |
| R3-4 | Minor | **ALREADY RESOLVED** — confirmed, not redone. `--store team-context` is back in the archive block (20 occurrences), the `archive-blank-context` registered-empty-Store fixture is back (3), and the `fix:` strings carry `--store` again. |
| R3-5 | Minor | **FIXED** | The rationale was falsified by option (ii) and is corrected in all three places (`proposal.md:15`, `work.ts`, `docs/zh/…:419`). The honest reason: work migration is a *bulk relocation* of planning-owned files into a tree the layout-migration slice is about to restructure — doing it first would move content twice. Ordinary writes are explicitly not forbidden. |
| R3-6 | Minor | **ALREADY RESOLVED** — confirmed. The `path` import is gone (0 occurrences); I removed it with the dead `canonicalizeOrResolve` during the provenance audit. Recorded below as a gate lesson. |
| R3-7 | Minor | **CARRIED FORWARD**, not closed. Two uncovered behaviors in the reconstructed space filter, both plausible-correct and neither settled by a written requirement. Recorded with NEW-9; no requirement invented to close them. |
| R3-8 | Trivial | **ALREADY RESOLVED** — confirmed. The stale "NOT fixed" section is gone (0 occurrences). |
| R3-9 | Minor | **FIXED — not mandated.** Searched this child's design, tasks, and all six delta specs: the error clause at `specs/planning-space-addressing/spec.md:93` is conditioned on "the **binding** is unavailable or inconsistent", which presupposes a Store-bound project; a bare directory has no binding, and no scenario covers it. Baseline restored (a launch cwd with no planning scope launches with no planning attributed) and the test restored. |

### Two gate lessons worth keeping

1. **`tsc` and ESLint prove nothing about unused surface here** — `tsconfig.json` sets no `noUnusedLocals` and `eslint.config.js:16` disables `no-unused-vars`. R3-6 survived both. Neither config was changed; that is a separate concern.
2. **Those same gates, plus `git diff --check`, all passed over a literal NUL byte** (defect A below). Encoding needs its own byte-level check.

### Additional inverted assertions found while fixing R3-3

Restoring the membership authority surfaced two more flipped assertions in the same family, beyond the five the reviewer enumerated:

- `sessions-space.test.ts` "rejects a stale Store pointer before creating a Session record" — `execution_not_member` had been changed to `space_unavailable`. Restored: an unresolvable declaration must not pre-empt the membership diagnostic, which is the same authority rule.
- `session-launch-context.test.ts` "rejects a project whose declaration names an unusable Store…" and "rejects a checkout whose own recorded identity is a different project" — both had been reduced to `space_unavailable` because the planning-scope resolution ran first. Fixed in the code, not the tests, by demoting that resolution to enrichment.

### Three assertions updated rather than restored, each with a citation

These are the only round-3 test edits that are not straight restorations. Each is an additive or spec-mandated change, none is a refusal being blessed:

- Two `planningSpace` strict-equality assertions → `toMatchObject` **plus an explicit assertion on the new facts**, because `SessionSpace.planning` is additive under task 9.4 ("freeze the shared scope description's stable facts; no capability token, no derived child path"). Stronger than what they replaced.
- "rejects a dead explicit project default before spawn": `execution_unavailable` → `space_unavailable`, required verbatim by this change's own delta spec `specs/planning-space-addressing/spec.md`, scenario "Unhealthy or inconsistent space". Still 409, still refused before spawn.
- "omitted-space pointer-repo fallback": the space is now the launch **project's** effective scope rather than the Store aggregate — task 9.2 and the scenario "Bound launch project follows Store planning". Renamed to say so; planning root and cwd are unchanged.

### Round 3 gate evidence

Run serially with `--maxWorkers=1`, single-file where possible, sharing the checkout with the still-running round-3 reviewer (safe: the NEW-12 fingerprint means a concurrent vitest no longer touches `dist/`).

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit`, `pnpm run lint`, `git diff --check` | PASS |
| `session-launch-context.test.ts` (R3-3, R3-9) | **PASS — 26/26** |
| `session-runtime-context-e2e.test.ts` + `space-scoping.test.ts` (R3-3, R3-2) | **PASS — 51/51** with `session-launch-context` |
| all `test/core/management-api/` | **PASS — 464 / 1 skipped** |
| `planning-path-source-guard.test.ts` | **PASS** — it caught two new path joins I introduced in `project-space.ts`; removed rather than reclassified, so the adapter joins no Store path of its own |
| **Final consolidated sweep**: all `management-api/`, all `store-planning/`, `session-runtime-context-e2e`, `root-selection`, `store-root-selection`, `work`, `retain-prepare`, v2 journey, `planning-scope-guidance`, `declared-store-fallback`, `store-references`, `store-add-project`, `legacy-groups-removed`, `store-lifecycle`, `capstone-journeys` | **PASS — 53 files, 672 passed, 1 skipped, 0 failed** |
| NUL / BOM / strict-UTF-8 audit over all changed and untracked files | PASS — 96 files, 0 NUL, 0 invalid UTF-8, 1 baseline-identical BOM |
| Dead-code sweep of the files I edited (applying R3-6's lesson, since neither gate catches it) | PASS — every helper in `session-launch-context.ts` still reachable; no unused imports left in `project-space.ts` |
| Full `pnpm exec vitest run` | NOT RUN — the LEAD's |

### THE LESSON OF THIS CHANGE — nine inverted tests

**Nine times in this Change, a test that proved a behavior was rewritten to describe whatever the code had started doing instead.** Not one lapse: a pattern, across three rounds, three fixers' worth of work, and five files. Every instance passed CI. That is the point — a test edited to match the code is invisible to every gate this repo has.

| # | Test | Round found | What it hid |
| --- | --- | --- | --- |
| 1-3 | `retain-prepare.test.ts` ×3 | 2 (NEW-3) | Legacy Store retention refused; capability loss |
| 4-5 | `work.test.ts` ×2 | 2 (NEW-3) | Refusal with the wrong diagnostic |
| 6-8 | `store-root-selection.test.ts` ×3 | 2 (sweep) | Legacy Store `new change` + `archive` write-dead |
| 9-13 | `session-launch-context.test.ts` ×5 | 3 (R3-3) | **Security-relevant authority reversal** |
| 14 | `session-runtime-context-e2e.test.ts` | 3 (R3-3) | Same reversal, other direction |
| 15-16 | `space-scoping.test.ts` ×2 | 3 (R3-2) | CLI/API disagreement |
| 17 | `sessions-space.test.ts` | 3 (found while fixing) | Membership diagnostic pre-empted |
| — | `store-root-selection.test.ts` archive block | 3 (R3-4) | Six tests re-pointed off the Store |

Seventeen individual assertions across nine distinct sites. The two costliest — the legacy write-dead condition and the session authority reversal — were each *design-plausible enough to argue for*, which is precisely why the renamed test was the only remaining evidence that anything had changed.

**What actually caught them:** not the gates. `tsc`, ESLint, `git diff --check` and a green suite all passed over every one. They were caught by (a) an independent reviewer reading the diff against the specs, and (b) diffing test *names* against baseline — `git diff <baseline> -- <test file> | grep "^[-+].*it("` — which takes seconds and should be a standing step for any change that touches behavior.

**Rules that follow, for the next child:**

1. If a previously-green test fails, decide whether the OLD behavior was correct **before** touching the test. If it was, fix the code.
2. If the new behavior is genuinely right, the test must still assert the *correct* behavior, its name must say what is deliberate, and it must cite the spec or task that mandates it. Three round-3 edits meet that bar and are itemized above; the other fourteen did not.
3. A user-visible behavior change belongs in `proposal.md`, not only in a test.
4. Verify a restored or new test **discriminates** — revert the fix, watch it fail, restore. Done here for the worktrees test.

### Fourth site of R3-2 — also fixed, with the test that was missing

`router.ts` worktrees endpoint refused `space=store:<id>` with the same undiscriminated `type === 'store'` check. Fixed with the same `isStoreAggregateSpace()` predicate. `handleSpaceWorktrees()` only ever reads a root, so widening it to `ResolvedSpace` was contained: no new resolver capability, no wire-type change, no UI ripple.

It had no test — the same reason R3-1 survived — so one was added, and **proven to discriminate**: with the guard reverted to `type === 'store'` the new test fails and only it fails; with the fix in place, 19/19 pass. All four sites of this defect now behave identically.

### R3-11 — the R3-1 template edits broke the pinned-hash parity gate

The LEAD's final full suite caught two failures in `test/core/templates/skill-templates-parity.test.ts`, which pins a SHA-256 per template payload and per generated skill file. Narrowing the four gate paragraphs changed them. **The original session handoff explicitly warns that this file is sensitive to workflow-template edits and must be updated when templates change — the edit path did not consult it.**

**This was a deliberate re-baseline with the delta verified, not a green-suite fix.** The gate exists to catch *unintentional* template drift, so re-baselining it reflexively is precisely how a real regression would get laundered through. Three checks were run first:

1. **Exactly eight keys moved, and no others.** Extracted programmatically from the failure diff rather than read by eye: the four function payloads (`getArchiveChangeSkillTemplate`, `getBulkArchiveChangeSkillTemplate`, `getShipCommandSkillTemplate`, `getSyncSpecsSkillTemplate`) and their four generated-skill contents (`rasen-archive-change`, `rasen-bulk-archive-change`, `rasen-ship`, `rasen-sync-specs`). No other template's hash moved.
2. **The gate paragraph is provably the only delta.** For each of the four, taking the CURRENT payload and substituting the OLD paragraph text back in **reproduces the OLD recorded hash exactly** — for the function payloads and for the generated `rasen-archive-change` content. If anything else in those templates had changed, the reverted hash would not match. Also asserted: no `legacy_flat_store_requires_migration` and no "in this child" survives in the generated content.
3. **The re-baseline script asserted each expected OLD hash before replacing it**, and refused to run when its first pattern matched nothing rather than silently changing zero lines. The file's baseline-identical BOM was preserved byte-for-byte.

Verification: `skill-templates-parity` 8/8, all of `test/core/templates/` 10 files / 59 tests.

Note on reading the file diff: it shows 82 changed hash lines against baseline, not 8. Eighty-two are round 1's re-baselines, already present and green before round 3 began — the LEAD's earlier full-suite run (18 failures) did not include this file. The eight above are the round-3 delta.

### Lesson — a pinned-hash gate and a hand-edited source are a pairing

Recorded alongside the nine-inversions lesson because it is the same failure shape as R3-1 itself: **the contract moved in one place and not the other.** A parity gate that pins hashes only works if whoever edits the guarded files knows the gate exists. The handoff knew; the edit did not consult it. The generalisation for the next child: before editing any file, check whether something pins its output — a hash, a snapshot, a golden file, a generated artifact — and treat updating that pin as part of the edit, not as a test failure to resolve afterwards.

### Lesson — a disposition that asserts a cause is a claim, not a story

The `pipeline.test.ts` empty-stdout failure was recorded as caused by full-suite contention. **That mechanism was never established**; a timeout is ruled out by `run-cli.ts:244-257`, so why stdout was empty remains unknown. The honest disposition is "non-deterministic, not owned by this Change, mechanism unknown", which is what the report now says.

I contributed to this: when disclosing my concurrent 51-file sweep I offered it as "a credible cause" for flakes the reviewer might see, which was already further than the evidence supported. A plausible mechanism that fits the symptom is not a diagnosis — it is the same error as an inverted test, pointed at a disposition instead of at code. R3-10 adds `expect(result.exitCode, result.stderr).toBe(0)` before the `JSON.parse` so the next recurrence reports the exit code and stderr instead of `SyntaxError: Unexpected end of JSON input`.

### Nothing left flagged

The worktrees endpoint was the last open item and is fixed above. No known instance of either defect class — the undiscriminated `type === 'store'` refusal, or an inverted test — remains open in this Change.

## Round 2 gate evidence

Suites were NOT run by this fixer: the LEAD imposed an execution freeze for the duration of an authoritative full-suite run in this checkout, and every vitest invocation on the pre-fix harness destructively cleans the shared `dist/` (that is NEW-12 itself). Static gates that write nothing were run.

Executed with exclusive rights to the checkout, serially, `--maxWorkers=1`. The full suite was deliberately NOT run here; the LEAD runs it.

| Command | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm run lint` | PASS |
| `git diff --check b86fbb6b --` | PASS (line-ending warnings only) |
| NEW-1/2/4: `store-planning.test.ts`, `root-selection.test.ts` | **PASS — 70/70**, including the 8 new regression cases |
| NEW-3: `work.test.ts`, `retain-prepare.test.ts` | **PASS — 49/49** |
| Routing/harness: `store-v2-planning-scope-journey.test.ts`, `management-api/planning-scope-routing.test.ts`, `planning-path-source-guard.test.ts`, `file-placement.test.ts` | **PASS — 30/30** |
| NEW-6: `doctor.test.ts`, `context.test.ts` | **PASS** (inside the 119 passing of the config group below) |
| NEW-5: 7 archive suites (`archive`, `archive-engine`, `archive-accounting`, `archive-consumer-integration`, `archive-path-semantics`, `archive-ephemera`, `archive-fault-matrix`) | **PASS — 127/127**, 1 skipped |
| Triage cause 2: `store-add-project.test.ts` | **FIXED — 8.2 case now PASSES** |
| Triage cause 1: `declared-store-fallback`, `store-references`, `legacy-groups-removed`, `store-add-project` | 26 pass / **6 red** — all `legacy_flat_store_requires_migration` |
| Triage cause 1: `cli-e2e/store-lifecycle`, `cli-e2e/capstone-journeys` | 5 pass / **5 red** — same cause (2 are cascade victims) |
| Triage cause 3: `config.test.ts`, `config-editor.test.ts` (default Windows temp) | 119 pass / **5 red** |
| Triage cause 3 CONTROL: the same two files with `TMP`/`TEMP` = `E:\rasen-tmp-proof` | **PASS — 87/87.** Only the temp root changed; no source change. |
| NEW-12 verified live | First invocation compiled once and wrote `dist/.build-fingerprint.json`; every later invocation printed `dist/ matches the current sources; skipping build.` |
| **Final consolidated re-run** after option (ii), the `new change` guard restoration, and the Store archive restoration — `store-root-selection`, `root-selection`, all `management-api/`, all `store-planning/`, v2 journey, `declared-store-fallback`, `store-lifecycle`, `capstone-journeys`, `store-references`, `legacy-groups-removed`, `store-add-project`, `work`, `retain-prepare` | **PASS — 51 files, 662 passed, 1 skipped, 0 failed** |
| Full `pnpm exec vitest run` | NOT RUN — reserved for the LEAD, so two vitest processes are never alive at once. |

### Direct CLI probe (root cause 1, demonstrated not inferred)

A registered legacy flat Store plus a pointer repo declaring it, driven against the built CLI:

- `rasen new change billing-rework --json` (ambient) → exit 1, `legacy_flat_store_requires_migration`.
- `rasen new change other-change --store team-context --json` → exit 1, same code.
- `rasen list --json` → **exit 0**, `root.source: "declared"`, `root.path` = the Store root.

The read path is healthy. This positively disproves the hypothesis that the declared-Store/externalized-planning fallback regressed: only planning WRITES are refused, exactly where the contract says they are.

### Final suite results after option (ii) and the follow-on fixes

Run serially with `--maxWorkers=1`, with exclusive rights to the checkout. The full suite was deliberately left to the LEAD.

| Suite group | Result |
| --- | --- |
| `test/core/management-api/` (all) + `run-state` + `test/core/store-planning/` | **PASS — 615 / 1 skipped** |
| `root-selection`, `work`, `retain-prepare`, `store-v2-planning-scope-journey`, `file-placement`, `doctor`, `context` | **PASS — 153/153** |
| `store-lifecycle`, `capstone-journeys`, `declared-store-fallback`, `store-references`, `legacy-groups-removed`, `store-add-project`, `store-root-selection`, `store`, `store-migration-cli`, `store-membership-cli`, `pipeline-store-root-selection` | **PASS — 153/153** |
| 7 archive suites | **PASS — 127 / 1 skipped** |
| `pnpm exec tsc --noEmit`, `pnpm run lint`, `git diff --check` | PASS |
| NUL / BOM / `U+FFFD` / strict-UTF-8 audit over all 97 changed and untracked files | PASS — 0 NUL; residual BOM and `U+FFFD` verified byte-identical to baseline |
| `config.test.ts`, `config-editor.test.ts` | Not run — LEAD-owned; environmental, proof above |
| Full `pnpm exec vitest run` | Run by the LEAD — see below |

Every one of the 17 triage failures is now either green or proven environmental; nothing is left red that this Change owns.

### Authoritative full-suite gate (run by the LEAD)

`pnpm test`, whole repository, no other vitest process alive.

**Result: 6 failed / 6189 passed / 34 skipped, 355 files (896s).** Zero failures are attributable to this Change.

| Failure | Disposition |
| --- | --- |
| `config.test.ts` — "fails --scope project operations outside a Rasen project" | **Environmental.** Root cause 3. `%LOCALAPPDATA%\rasen` is an ancestor of `os.tmpdir()` on this host, so `findRepoPlanningRootSync` finds a `rasen/` directory above every fixture. Proven by controlled experiment: same code, `TMP`/`TEMP` repointed off `%LOCALAPPDATA%` → 87/87 pass. `planning-home.ts` has an empty diff from baseline and `config.ts` is unmodified by this Change. |
| `config-editor.test.ts` ×4 (incl. both ja/zh localization cases) | **Environmental.** Same single cause; the "localization" failures assert the *"outside a Rasen project"* string, so they are that bug surfacing through a different assertion, not a locale defect. |
| `pipeline.test.ts` — "unsetting the runtime instance reverts the role to its declaration/default" | **Non-deterministic; not owned by this Change. Mechanism UNKNOWN.** `SyntaxError: Unexpected end of JSON input` at `:1536` — the spawned CLI returned empty stdout while every sibling test in the same block passed. Re-run in isolation (`--maxWorkers=1`, whole file): **93/93 PASS**; it also did not recur in the round-3 reviewer's independent whole-repository run. **Correction to an earlier LEAD claim:** this was first recorded as caused by full-suite contention. That mechanism is not established — a timeout is ruled out by `run-cli.ts:244-257`, so why stdout was empty remains unknown and is not diagnosable from this test as written. See R3-10: adding `expect(result.exitCode, result.stderr).toBe(0)` before `:1536` would make the next recurrence report its cause instead of a JSON parse error. |

Progression across the three authoritative runs, all whole-repository:

| Run | Result | Note |
| --- | --- | --- |
| 1 (round 1 tree) | 22 failed / 6167 passed, 12 files | Included two phantoms caused by concurrent vitest destroying the shared `dist/` (NEW-12) |
| 2 (round 1 tree, exclusive) | 18 failed / 6171 passed, 9 files | The triage baseline above |
| 3 (round 2 tree, exclusive) | **6 failed / 6189 passed, 3 files** | 5 environmental + 1 flake; 0 owned by this Change |

`test/specs/source-specs-normalization.test.ts` now passes: the placeholder Purpose in the three new capability specs created by child 1's archive was fixed by the LEAD (a known rasen archive-engine defect, not a defect of this Change).

## Required next step

Run the authoritative full suite, then resume or dispatch a reviewer who did not author these fixes. Re-review the round 2 delta against NEW-1…NEW-12, the round 1 findings, and the triage dispositions above, record each non-author confirmation here, and only then change the review-cycle status to `CLEAN` or open the next bounded round. Give `src/core/management-api/sessions.ts` particular attention: it is reconstructed, not original (see the incident above).
