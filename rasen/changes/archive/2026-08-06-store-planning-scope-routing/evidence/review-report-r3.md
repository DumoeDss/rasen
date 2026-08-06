# Independent Re-Review (round 3): store-planning-scope-routing

- **Change:** `store-planning-scope-routing`
- **Baseline:** `b86fbb6bfa7a3915392f53869232e8de659beea3` (implementation is live uncommitted working-tree content plus untracked files)
- **Reviewer role:** independent confirmation of rounds 1 and 2. I authored none of this code and none of the prior reviews. My only durable write is this report.
- **Execution:** honored the freeze. No `pnpm test`, no `pnpm run build`, no vitest invocation, no mutating git command. Everything below is derived from source, from the change's own test assertions, and from two read-only Node scripts run outside the repo (encoding audit and baseline-blob comparison).
- **Verdict:** **NOT CLEAN** — all 9 round-1 findings and 11 of 12 round-2 findings are resolved (NEW-9 accepted, note verified). **3 new findings block: 1 Blocker, 2 Major.** All three are consequences of work done *after* the round-2 report — the option (ii) re-scope and the session-launch rewrite — and none is covered by any prior review.

---

## 1. Round-1 findings (S1-S3, P1-P6)

| id | severity | verdict | file:line | justification |
| --- | --- | --- | --- | --- |
| S1 | Blocker | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:2006-2069`, `:1922-1991` | Publication is now `mkdir(target)` (non-recursive, atomic-fail-if-exists) as an exclusive reservation, then `link()` of each staged entry, with `targetOwnershipMatches()` re-checking BOTH the target's `dev/ino` identity and the persisted `.rasen-publish-owner` content after **every** link (`:2037-2044`). Every removal path (`removeOwnedPublication` `:1936-1973`, `removePublicationOwnerToken` `:1980-1991`, `removeOwnedStage` `:1993-2004`) verifies identity before unlinking, and `removeDirectoryIfEmpty` is used instead of a recursive force-remove. No `rename()` remains on the publication path. Re-checked as a class, not at the named site: I traced all four removal helpers and the `finally` block at `:2281-2290`; each is identity-gated. |
| S2 | Major | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:1797-1801` | `openChange()` passes `resolved.description.paths['project-schemas']` as the third argument to `readChangeMetadata()`. Checked the sibling class too: `createChange()` passes the same typed path to `validateSchemaName()` (`:2110-2114`), and `describePaths()` emits `project-schemas` for all three project shapes (`:1634` v2, `:1668` standalone/legacy), so the address is never undefined for a project scope. |
| S3 | Minor | **RESOLVED** (mechanism replaced — assessed in §4) | `build.js:196-225`, `test/helpers/run-cli.ts:137-176`, `vitest.setup.ts:43-48` | The named gap ("an unmarked or stale `dist/` must never be trusted") is closed by a fingerprint over the real compiler inputs, written **after** a successful compile. `ensureCliBuildFresh()` deliberately deletes any ambient `RASEN_TEST_CLI_BUILD_READY` before checking (`run-cli.ts:159`), so a poisoned environment cannot buy trust. |
| P1 | Blocker | **RESOLVED** | `src/core/root-selection.ts:1044-1080`, `:1016-1035`, `:975-982` | Explicit `--project` goes straight to StorePlanning with no legacy catch (`:1037-1041`). Explicit `--store` and the ambient branch both use the same rule: a planning diagnostic is only downgraded to a legacy projection when the compatibility adapter positively resolves a **non-v2** Store (`declaresLayoutV2()` gate at `:1032` and `:1073`). The `store-project`/`store-aggregate` kinds are returned directly; only the POSITIVE `standalone`/`legacy-store` answers fall through. Machine-registry-only projects reach the resolver (`resolver.ts:1074-1134`, with the deliberate `legacyNamespace.length === 0` rethrow at `:1088`). |
| P2 | Blocker | **RESOLVED** | `src/commands/context.ts:33-46,120-131,246-262`; `src/commands/doctor.ts:543-556,573-609` | Both commands declare `intent: 'store-read'` when `--store` is supplied without `--project`, and both have a dedicated `store-aggregate` branch that returns before any project-content gathering. `describePaths()` for `store-aggregate` (`resolver.ts:1609-1623`) emits only `planning-checkout`/`store-metadata`/`store-design-docs` — no project home, specs, changes, or archive path can be fabricated. |
| P3 | Blocker | **RESOLVED** (for what P3 named) | `src/core/archive.ts:83-98`, `:124-145`, `:292-303`, `:399-410` | Store v2 direct Archive and stored-plan apply both fail closed with `store_v2_finalization_unavailable`; the stored-plan gate now reads `plan.scope` (NEW-5). Management `handleArchive` remains read-only. Note: the *legacy* half of this gate was deliberately withdrawn by the option (ii) re-scope, which P3 did not require — but the generated workflows were not re-scoped with it. See **R3-1**. |
| P4 | Blocker | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:1154-1172` | Marker precedence is `association.planningRoot → nearest Store checkout (identity-matched) → registered explicit Store root`. `planningWorktreeVerified` (`:1454-1459`) additionally requires `checkoutRole === 'linked-worktree'` plus an association or marker planning root, so the registered integration checkout can never satisfy it on its own. |
| P5 | Blocker | **RESOLVED** | `src/core/pipeline-registry/run-state.ts:548-566`; `src/commands/pipeline.ts:649`; `src/commands/retain.ts:305-307`; `src/core/management-api/project-space.ts:120-122`; `src/core/management-api/sessions.ts:285` | I enumerated every `StateFileLocationOptions` construction site in `src/` — those four are all of them, and `changeStateLocations()` is the single source for changes/runs/archive/task-detail. Checked the **write** side too, which no prior round did: the only run-state writer is `initializeRunState()`, called once from `src/commands/workflow/new-change.ts:168-173` with `ephemeraDir(executionRoot, name)`, guarded by an `execution_authority_unavailable` refusal at `:139-145`. `writePortfolioState()` has no production caller. Planning directories are therefore neither read as a fallback nor written. |
| P6 | Blocker | **RESOLVED** | `src/core/root-selection.ts:1255-1274`; `src/commands/work.ts:105-129`; `src/commands/retain.ts:287-294`; `src/core/archive.ts:728-735`; `src/core/file-placement.ts:122` | `resolveExecutionRoot()` and `findCodeProjectRoot()` are deleted; a repo-wide grep finds the identifier only in a comment and in the test that asserts its absence. `sideEffectProjectRoot()` returns `undefined` for any scope-carrying non-standalone root, and the three mutators refuse before writing. `withCompatibilityExecutionRoot()` (`:847-870`) is bounded correctly: it returns early for any root carrying a `planningScope`, and refuses any candidate at or inside the Store checkout (`:868`). |

---

## 2. Round-2 findings (NEW-1 … NEW-12)

| id | severity | verdict | file:line | justification |
| --- | --- | --- | --- | --- |
| NEW-1 | Blocker | **RESOLVED** | `src/core/root-selection.ts:1055-1078`; `src/core/store-planning/internal/resolver.ts:1226-1250`, `:1471-1484` | I re-derived the reviewer's four failure shapes. (a) *Corrupt catalog*: `storeClaimsProjectPlanning()` throws `invalid_project_catalog` rather than downgrading (`:880-890`); the ambient branch then finds `declaresLayoutV2(legacyProjection) === true` and rethrows. (b) *Unbound / absent catalog entry with no local planning*: `resolver.ts:1471-1478` throws `project_not_in_store`, same rethrow path. (c) *Genuine configuration inheritance*: now a POSITIVE `standalone` answer (`:1236-1250`) with the `configuration_store_inheritance` notice (`:1479-1484`); the compatibility adapter's `hasPlanningShape` branch returns the LOCAL root (`root-selection.ts:615-656`), not the Store root, so the fall-through is safe. (d) *No Store fact at all*: `declaresAmbientStoreFact()` (`:1089-1098`) is false and the ordinary taxonomy applies. Three regression cases exist under `root-selection.test.ts` "ambient bound-project routing never fails open to the flat Store root". |
| NEW-2 | Major | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:1147-1172`, `:1196-1211`, `:190-216` | Both the marker read and `preliminaryStoreRoot` require `storeEntryMatchesIdentity()` against a **leniently** parsed nearest-checkout identity — unreadable metadata yields `null`, which can only fail to match, never redirect (`:196-205`). The P4 case survives because there the nearest checkout *is* the selected Store. The `preselectedStoreEntry === undefined` admission at `:1163` is correct: with no Store selected the nearest checkout is the only Store evidence, and `loadStore()` (`:571-585`) verifies identity afterwards. |
| NEW-3 | Major | **PARTIAL** | `src/commands/work.ts:80-121`; `src/core/root-selection.ts:833-870`; `proposal.md:15`; `specs/store-planning-scope-routing/spec.md:97-101`; `test/commands/retain-prepare.test.ts` | The mechanics are resolved: `work migrate` now reports `legacy_flat_store_requires_migration` before the execution-authority check, `retain prepare` is restored via a discovered launch project that is never the Store or anything inside it, the three inverted `retain-prepare` cases are restored, and both the BREAKING bullet and a spec scenario exist. **What is not resolved is the written justification.** `proposal.md:15` and `work.ts:107-110` both give the reason as "a legacy flat Store's planning tree is read-only until migration" — a statement that option (ii) made false in the same tree: `new` and `archive` now write into exactly that planning tree (`resolver.ts:1529-1535`, `archive.ts:92-97`). The behavior is contract-backed (`design.md:182`, spec `:97-101`); the rationale a reader is given for accepting the breaking change is not. See **R3-5**. |
| NEW-4 | Major | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:771-815`, `:817-857`, `:869-894`, `:1365-1374` | `loadProjectCatalogs()` returns `{entries, broken}` with per-file fault isolation and canonical sorting; broken siblings become `invalid_project_catalog` **notices** on the scope (`:1366-1371`) so a healthy project and the Store aggregate still resolve. The selected project stays fail-closed and the diagnostic carries the offending file path as `target` plus a repair (`:837-841`). Verified the doctor half specifically: `doctor --store s` reduces to `store-aggregate` (no `projectSelector`), never calls `selectProjectCatalog`, and reaches the aggregate branch at `doctor.ts:573`. |
| NEW-5 | Minor | **RESOLVED** | `src/core/archive.ts:100-145`; `src/core/archive-engine.ts:205-217`, `:1710`, `:1704-1755` | `ArchivePlan.scope` is recorded from the resolved scope and is inside `withoutHash`, so it participates in `hashArchivePlan(stableArchiveJson(...))`. The pre-field fallback `planActivePathIsStorePartition()` is relative to `plan.roots.planning`, so a standalone checkout at `E:\rasen\projects\myapp` no longer aliases. |
| NEW-6 | Minor | **RESOLVED** | `src/commands/context.ts:33-46`, `:59-60`, `:123-131` | JSON carries `status: [{code: 'store_aggregate_scope', ...}]` with the required sentence; the human form prints a dedicated "Store aggregate" block and returns before the "No references declared" line. Same code as `doctor`. |
| NEW-7 | Minor | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:1975-1991`, `:2269-2273` | The token is unlinked after read-back verification, identity-checked so a foreign replacement cannot lose a file. |
| NEW-8 | Minor | **RESOLVED** | `src/core/store-planning/internal/resolver.ts:2144-2169`, `:2131-2139` | The discriminator is "provably holds nothing" (empty after ignoring the ownership token), not "lacks `.openspec.yaml`", so the named recovery can never tell a user to delete a hand-authored Change. The stale `.create.lock` also names its recovery. |
| NEW-9 | Minor | **ACCEPTED — note verified, residual independently bounded** | note at `evidence/review-cycle-report.md:199-201`; code at `resolver.ts:2029-2045`, `:1936-1958` | The note exists and is honest. I bounded the residual myself rather than taking it on trust: `publishOrder` (`:2022-2028`) puts `PUBLICATION_OWNER_FILENAME` **first**, and `targetOwnershipMatches()` runs after every single `link()`, so in the replace race at most **one** stray file (`.rasen-publish-owner`) can land in a foreign directory before the throw. On the failure path `removeOwnedPublication()` finds the target identity mismatched and returns at `:1951-1958` without unlinking anything. Genuinely bounded, genuinely non-destructive. |
| NEW-10 | Minor | **RESOLVED** | `src/core/file-placement.ts:122`; `test/core/file-placement.test.ts:98-109` | Export and helper deleted; the replacement test asserts the export is absent and says why. |
| NEW-11 | Minor (process) | **RESOLVED** | `evidence/review-cycle-report.md:104` | The row now states the round-1 full-suite result was never captured and is superseded. |
| NEW-12 | Major | **RESOLVED** | `build.js:16-225`; `package.json:43,49`; `test/helpers/run-cli.ts:137-176`; `vitest.setup.ts:43-48` | Assessed in detail in §4. No unconditional clean remains; two concurrent vitest processes with unchanged sources now touch nothing. |

**Totals:** 9/9 round-1 resolved. 11/12 round-2 resolved, 1 accepted with a verified note, 1 (NEW-3) partial on its written justification only.

---

## 3. The reconstructed `src/core/management-api/sessions.ts`

I read this file against the design, the call sites, and the delta specs, and treated "615 tests pass" as insufficient throughout.

### 3.1 The parts the witness pinned

The lead's 7-of-8 invariant result holds against my own read (`:18`, `:282-286`, `:284`, `:283`, `:287`, `:266-276`, `:293-296`; comment divergence at `:278-281`). I found **one more divergence the invariant check did not cover**, and it is a real one:

**R3-6 (Minor).** `sessions.ts:9` still has `import * as path from 'node:path';`, and the file no longer contains a single `path.` reference. The baseline used it in `canonicalizeOrResolve()` (`path.resolve`) and in the `changeDir` join (`path.join(record.space.root, WORKSPACE_DIR_NAME, 'changes', ...)`) — both deleted by this change. This escaped every gate: `tsconfig.json` sets no `noUnusedLocals`, and `eslint.config.js:16` sets `'@typescript-eslint/no-unused-vars': 'off'`. It is harmless at runtime, but it is a second demonstration that the reconstruction is not byte-faithful, and it means "tsc + lint pass" gives no evidence at all about unused surface in this file.

### 3.2 The space-identity filter — independent assessment

Code under review: `sessions.ts:177-192` plus the contract paragraph at `:165-176`, called from `router.ts:1091-1104`.

**Reasoning from the call site and the spec, not from the tests.** `router.ts:1102` constructs `filterSpace` as `{ type: resolved.space.type, id: resolved.space.id }` from `resolveSpaceSelector()`. The critical question the type signature does not answer is whether `space.id` is *canonical* or *selector-shaped* — if it were selector-shaped, identity filtering would silently return an empty list whenever the filter selector spelled the space differently from the launch selector. It is canonical: `project-addressing.ts:181` sets `id: resolved.ref.projectId` (the registry's permanent id, not the selector) and `:261-262` sets `id: planningScope.ref.storeId` (with an explicit comment that the Store's own id is reported, never the selector). `session-launch-context.ts:226,253,270,310` records `toSessionSpace(selected, …)`, which copies the same `selected.id`. So launch and filter derive the identity from the same canonical source. **The filter's core mechanic is sound, and it is strictly better than the baseline root comparison** for one real case the baseline got wrong: a `project:<absolute-worktree-path>` selector resolves `root` to the worktree while a `project:<projectId>` selector resolves it to the main checkout, so root-based filtering could miss a session that identity-based filtering finds.

Three-condition guard (`!record.space || type mismatch || id mismatch → skip`) matches design D3 as quoted at `router.ts:1092-1094` and the delta-spec principle "Same id in both namespaces is unambiguous" (`specs/planning-space-addressing/spec.md`, scenario of that name): comparing `type` as well as `id` is required, and it is present.

**Behavior no test covers (R3-7, Minor).** Two consequences of dropping the root comparison, neither exercised by `sessions-space.test.ts` (which only ever filters with the *same* namespace the session was launched under: `:441` store→store, `:469` project→project) nor by `space-scoping.test.ts`:

1. *A Store's session list no longer includes sessions on its bound projects.* Launch a session with `space=project:<P>` where P is Store-bound; its recorded space is `{type:'project', id:P, root: <Store planning checkout>}` (`project-addressing.ts:183` sets `root` from `planning-checkout`, which for a bound project is the Store). Under the baseline root filter, `GET /api/v1/sessions?space=store:<S>` matched it, because both resolved to the Store root. Now `type` differs and it is excluded, so a UI Store view shows zero sessions while work is running on that Store's projects. This is arguably *correct* under the aggregate-vs-project distinction the change establishes — but it is a user-visible listing change with no test either way, and nothing in the delta spec states which answer is intended.
2. *A session attributed to an identity-less project can never be filtered to.* `resolveLaunchProjectRef()` (`project-addressing.ts:328-339`) returns `projectId: ''` for an unregistered root with no `projectId` in its config, and `projectPlanningSpace()` copies it verbatim into `id` (`:181`; the guard at `:162` proves the empty case is anticipated). The launch-project fallback at `session-launch-context.ts:300-323` therefore records `space.id === ''`. No selector can produce `id === ''` (`resolveProjectSelector('')` finds nothing → 404), so those sessions are only ever visible in the unfiltered listing. The baseline root comparison could reach them.

Neither is a defect I can prove wrong against a written requirement; both are exactly the "behavior no test covers and the router signature does not constrain" class the lead asked me to hunt for, so they are recorded rather than dismissed. **I found nothing in the reconstructed filter that contradicts D3, the delta spec, or the call site.**

### 3.3 The rest of the file

The run-state block (`:240-287`) is consistent with its four sibling `StateFileLocationOptions` sites, and the selection construction at `:243-253` correctly prefers frozen `record.space.planning` facts over the `record.space.type === 'store'` fallback. `handleGetSession`/`handleKillSession` are unchanged from baseline. Aside from R3-6 I found no divergence.

---

## 4. Item 6 — the build fingerprint (NEW-12 fix)

**Does it create a conflicting second source of truth?** No. `scripts/local-version/local-runtime.mjs` fingerprints a *source tree* to key a cache of **packaged runtimes** under `%LOCALAPPDATA%\rasen\local-harness`, and explicitly excludes `dist` from its hash (`:274`). `build.js` fingerprints the *compiler inputs* to decide whether the repo's own `dist/` is current. Different inputs, different artifacts, different lock namespaces (`os.tmpdir()/rasen-build-<hash>.lock` vs `<cacheRoot>/locks/<fingerprint>.lock`). They are duplicated *mechanisms* (two hand-rolled fingerprint+stale-takeover-lock implementations, `LOCK_STALE_MS` 10min vs 5min), which is a mild DRY cost worth noting, but they cannot disagree about anything because neither reads the other's marker.

**Does it close the S3 gap?** Yes, and more tightly than the marker-only round-1 version:
- The fingerprint covers `src/**` (recursive, name-sorted, content-hashed), `tsconfig.json`, `build.js` itself, and the TypeScript version (`build.js:118-130`). That is the complete input set `tsc` reads for JS emit under this `tsconfig.json` (`include: ["src/**/*"]`).
- It is written **after** a successful compile (`:186-192`), and it lives inside `dist/`, so every interruption window leaves a state that reads as stale: killed during `rmSync` → marker gone; killed during `tsc` → marker gone; `tsc` failed → `compile()` rethrows before writing.
- `distIsFresh()` also requires `dist/cli/index.js` to exist (`:145-150`), so a hand-deleted entry point is caught.
- `ensureCliBuildFresh()` deletes the inherited env marker before checking (`run-cli.ts:159`), so the "never trust an unmarked or stale dist" property is earned each time rather than assumed.

**Does it remove the destructive-clean hazard?** For the dominant case, yes: with unchanged sources a second vitest process runs `distIsFresh()` and returns without touching `dist/` at all. When sources genuinely changed, `acquireBuildLock()` (`:161-190`) serializes the one rebuild across processes, with a 10-minute stale takeover and a 5-minute wait deadline. `compile()` is invoked from inside the lock and rethrows instead of `process.exit()` so the `finally` always releases (`:172-176`, `:216-224`).

**Residual, and I agree with the fixer's own statement of it:** a rebuild is still a `rmSync(dist)` + recompile, so if a source file changes *while* another vitest process is mid-run, that process's spawned CLIs can still hit a missing or half-written `dist/`. The honest mitigation is that the first process's results were already invalid at that point. Eliminating it needs compile-to-temp-then-atomic-swap, which would change what CI and `npm publish` produce. Two smaller residuals worth knowing about, neither blocking: the fingerprint does not cover `node_modules` (a dependency upgrade that changes emitted `.d.ts` would not invalidate — irrelevant for running `dist/cli/index.js`), and a hand-edited file inside `dist/` still reads as fresh.

**Net:** this is a better fix than the original S3 correction asked for, and it also removes CI's second full compile (`.github/workflows/ci.yml:122` builds, then globalSetup's `--if-stale` finds a match and skips). No conflicting authority, no destructive-clean hazard in the ordinary path.

---

## 5. Item 4 — is the option (ii) re-scoping coherent?

**Mostly yes, with one contradiction that ships in the product.**

What agrees:
- `design.md:23` (goal line) defers legacy read-only to `store-layout-v2-migration`; `design.md:182` (D5 row) says "existing flat behavior"; `design.md:201` (D6) says a legacy flat Store gets a `ChangeCreationScope` on the frozen adapter and mints no v2 identity.
- Delta scenarios `specs/store-planning-scope-routing/spec.md:85-89` ("Legacy flat Store keeps writing its own flat layout") and `:91-95` ("A Store v2 destination is never written through the legacy adapter") match the code: `resolver.ts:1339` guarantees a v2 Store never classifies as `legacy-store`, and `:1529-1535` guards create-change for `store-project` only.
- Store **v2** flat-path writes still refuse: `--store S` alone on a v2 Store reduces to `store-aggregate` and throws `project_scope_required` (`resolver.ts:1517-1523`); the compatibility fall-through is blocked by `declaresLayoutV2()` (`root-selection.ts:1032`).
- `work migrate` legacy still refuses with `legacy_flat_store_requires_migration` (`work.ts:105-113`), and every v2 finalization entry still refuses with `store_v2_finalization_unavailable` (`archive.ts:83-98`, `:124-137`).
- **§10b of `rasen/changes/store-layout-v2-migration/tasks.md:103-111` is genuinely executable**, not a vague gesture. It names the two exact functions to restore (`resolver.ts` create-change guard, `archive.ts` `storeFinalizationDiagnostic()` legacy branch), the four contract passages to re-scope, the five journeys by file, the six unit cases by file and count, and the missing BREAKING bullet. Child 3's implementer cannot miss it. One nit: 10b.1 says both removals are "marked with a comment pointing at this task" — the comments name the child (`store-layout-v2-migration`) but not §10b.

What does not agree: **R3-1** and **R3-5** below. The re-scope was applied to the resolver, to Archive, and to the delta specs, but not to the four generated workflow templates, and the written rationale in `proposal.md` was left describing the pre-re-scope world.

---

## 6. Item 5 — test integrity sweep

I re-derived the lead's three accepted edits independently and swept the whole test diff for the (a)/(b)/(c) patterns.

**Accepted, and I agree:**
- `test/cli-e2e/store-lifecycle.test.ts:275-291`, `test/commands/declared-store-fallback.test.ts:61-78`, `test/commands/store-root-selection.test.ts:153-162` — `toEqual` → `toMatchObject` + an explicit `Object.keys(...).sort()` assertion, to admit the additive `scope` field required by `specs/store-planning-scope-routing/spec.md:139`. These are **stronger** than the originals, not weaker: the key-set assertion pins exactly what `toEqual` used to pin, and the scope value is asserted on top. Justified.
- `test/cli-e2e/store-lifecycle.test.ts:497-502` — machine-home count `1 → 0`. Task 6.5 (`tasks.md:51`) requires that scope selection never register a Store checkout as a project, and the *old* comment named the removed directory as "the machine-home directory for the resolved store root". The inversion is the approved behavior, and the rewritten assertion is a live regression guard rather than a blessing. Justified.

**Not previously classified, and not justified:**
- **R3-3** — `test/core/management-api/session-launch-context.test.ts` (4 inversions) and `test/core/session-runtime-context-e2e.test.ts:200-232` (1 inversion). Details below; this is the Blocker.
- **R3-2** — `test/core/management-api/space-scoping.test.ts:120,174` (2 inversions). Details below.
- **R3-4** — `test/commands/store-root-selection.test.ts:530-733`: the entire `archive --json is non-interactive` block was re-pointed from `--store team-context` (a legacy flat Store, run from a pointer repo) to a fresh standalone root, and renamed "standalone archive --json compatibility". Six cases lost their Store dimension, and the `reports no active changes for a selected empty store` case lost its registered-empty-Store fixture entirely. Under option (ii) these should still pass unchanged with `--store`. Two of the assertions even encode the loss: the expected `fix:` strings dropped their `--store team-context` suffix (`:600`, `:656`), so nothing now proves an archive diagnostic carries the Store selector in its repair hint. `archive --store` survives only at `:304` and `store-lifecycle.test.ts:339,448`. This narrowing is not recorded in `review-cycle-report.md`.

**Checked and clean:**
- The two renames the round-2 fixer flagged as "NOT fixed" (`review-cycle-report.md:332-339`) are only *one* rename now. `fails with a store hint instead of scaffolding when no root exists` is present and unmodified at `store-root-selection.test.ts:460`, because the behavior was restored by the ambient guard at `root-selection.ts:1461-1472`. The report is stale on that point (**R3-8**, Trivial).
- `test/core/file-placement.test.ts:98-109` (NEW-10) — a capability was deleted, so deleting its tests is correct; the replacement asserts the deletion.
- `test/commands/work.test.ts:571,624` — refusals retained deliberately, contract-backed by `spec.md:97-101` and `proposal.md:15`.
- `test/core/management-api/sessions-space.test.ts:184,225` — `toEqual` → `toMatchObject` for the additive `space.planning` field. Legitimate, but note it leaves the exact key set of `session.space` unpinned anywhere.
- `test/core/templates/skill-templates-parity.test.ts` — mechanical hash bumps.
- No vacuous test found: every rewritten assertion I checked asserts a concrete code, path, or payload, not a truism.

---

## 7. Item 7 — encoding

Scanned all **156** changed and untracked text files (`git diff --name-only b86fbb6b` ∪ `git ls-files --others --exclude-standard`), byte level, with a strict-fatal UTF-8 decode.

| Check | Result |
| --- | --- |
| NUL bytes | **0** — the `resolver.ts` NUL is gone |
| Invalid UTF-8 | 0 |
| BOM | 1 file (`test/core/templates/skill-templates-parity.test.ts`) — **byte-identical to its baseline blob** (20406 bytes, BOM present at baseline) |
| `U+FFFD` | 3 files — `src/locales/ja.json` (3), `src/locales/zh-cn.json` (4), `test/core/pipeline-registry/run-state.test.ts` (3). Every count is **identical to the baseline blob's**; I compared against `git show b86fbb6b:<path>` rather than trusting the prior audit. All three are pre-existing damaged CJK characters in untouched lines (`ja.json:209`, `zh-cn.json:985-986`, `run-state.test.ts:1066`) |
| Mixed line endings | 3 files (`src/core/pipeline-registry/run-state.ts`, `test/core/pipeline-registry/run-state.test.ts`, `test/core/space-selector.test.ts`) — the newly added lines are LF-only in a CRLF working tree. Harmless: `core.autocrlf=true` normalizes CRLF→LF on `git add`, so the committed blobs will be uniformly LF like the rest of the repo. Recorded for completeness, not a defect |

No encoding anomaly is introduced by this change.

---

## 8. NEW findings

### R3-1 — Major — Generated Archive / bulk-archive / ship / sync-specs skills still order the agent to REFUSE a legacy flat Store, which option (ii) restored

**Where:** `src/core/templates/workflows/archive-change.ts:19`, `src/core/templates/workflows/bulk-archive-change.ts:21`, `src/core/templates/workflows/ship.ts:25`, `src/core/templates/workflows/sync-specs.ts:20`. Each contains: *"If root.scope.kind is 'store-project', REFUSE with 'store_v2_finalization_unavailable'; if it is **'legacy-store', REFUSE with 'legacy_flat_store_requires_migration'**."*

**Why it is wrong:** option (ii) deliberately removed exactly that refusal from the CLI — `archive.ts:92-97` now returns `null` for the legacy branch with a comment saying "refusing here would leave every existing Store unable to finalize anything for the rest of the portfolio", and `resolver.ts:1529-1535` says the same for creation. The delta spec agrees (`specs/store-planning-scope-routing/spec.md:85-89`), as does `design.md:182`. The templates were not re-scoped with the rest of the contract.

**Concrete failure scenario:** a user with the ordinary setup — a registered legacy flat Store `team-context` and a pointer repo, i.e. **every** Store on disk today, since no Store has `layoutVersion: 2` until child 3 ships — runs `/rasen-archive-change` (or `/rasen-ship`, or `/rasen-sync-specs`) on a Store-planned change. `rasen list --json` reports `root.scope.kind: "legacy-store"`, the agent hits the hard gate at step 0 and refuses before touching anything. `rasen archive <change> --store team-context --json --yes` on the same change succeeds. Skills are this product's primary delivery surface, so the "write-dead between child 2 and child 3" condition option (ii) was chosen to prevent is not prevented — it is relocated from the CLI to the generated skills, where no test looks. `test/core/templates/planning-scope-guidance.test.ts` checks path construction only and never reads these gate paragraphs.

**What to fix:** narrow all four gate paragraphs to `store-project` only. Keep the `legacy-store` clause out until child 3 §10b restores it (and add it to §10b.2's re-scope list, which currently omits the templates). Secondary: these paragraphs say "in this child", leaking portfolio vocabulary into user-facing generated skills.

### R3-2 — Major — Every management `space=store:<id>` request is refused, including a legacy flat Store, so the CLI and the API disagree about the same scope

**Where:** `src/core/management-api/project-space.ts:58-65` — `resolveProjectContentSpace()` returns 400 `project_scope_required` for **any** `input.type === 'store'`, with no layout discrimination. Tests inverted to bless it: `test/core/management-api/space-scoping.test.ts:120-130` (`answers for the store` → `refuses to guess a project from Store aggregate input`, 200 → 400) and `:174-189` (`creates the change under the store root` → `rejects aggregate mutation without writing`, 201 → 400).

**Concrete failure scenario:** Store `team` is a legacy flat Store (`createOpenSpecRoot` + `registerStore` — the fixture in both inverted tests, and the shape of every Store in the wild). A user opens the web UI and selects the Store space.
- `GET /api/v1/changes?space=store:team` → **400 `project_scope_required`**.
- `rasen list --json --store team-context` → **exit 0**, lists the Store's flat changes (proven green at `test/commands/store-root-selection.test.ts:176`).
- `POST /api/v1/changes {space: 'store:team'}` → **400**; `rasen new change x --store team-context` → **exit 0**, writes the flat Change (proven green at `test/commands/store-root-selection.test.ts:147-165`).

There is no recovery: a legacy flat Store has no v2 project catalog, so no `project:` space can address its flat content either. The Store space in the UI is dead for every Store that exists today.

**Why it is a defect and not just the aggregate rule:** the resolver itself models `legacy-store` as a **project-capable** ref — `readCapability()` accepts it (`resolver.ts:1782-1788` rejects only `store-aggregate`), `location()` serves every project address for it (`:1701-1746`), and `describePaths()` gives it a full flat project shape (`:1662-1674`). The management adapter is stricter than the resolver, than the CLI, and than `design.md:182`. It also violates this change's own requirement `specs/store-planning-scope-routing/spec.md:159-167`: *"Commands that address the same scope SHALL agree… equivalent selector and binding facts reach CLI, pipeline, and management read entry points for the same project scope → they SHALL select the same planning owner and locations."* Both halves of the disagreement are asserted green by this change's own tests.

The one contract passage that appears to sanction the refusal — `specs/planning-space-addressing/spec.md`, scenario "Store space is aggregate" — was written before option (ii) and speaks of a Store **aggregate**; it was not re-scoped when `store-planning-scope-routing` and `store-config-inheritance` were.

**What to fix:** discriminate on layout in `resolveProjectContentSpace()`. A `store:` space whose resolved scope is `legacy-store` should yield its flat project content (the resolver already produces it); only a Store **v2** aggregate should return `project_scope_required`. Restore the two inverted tests, or re-scope the `planning-space-addressing` scenario and record the loss in `proposal.md` — but not silently, and not while the CLI still permits it.

### R3-3 — Blocker — Session launch replaced the Store membership-record authority with effective-scope comparison, violating three scenarios of an unmodified main spec; five tests were inverted to bless it

**Where:** `src/core/management-api/session-launch-context.ts` — `storePermitsProject()` (the membership seam, baseline `:72-88`) is **deleted**, along with the imports of `resolveProjectMembership`, `storeBindingDeclarationFrom`, `hasStoreDeclaration`, and `readStorePointer`. It is replaced by `projectBelongsToStore()` (`:139-143`), which compares the *project's own effective planning scope* with the selected Store, used at `:245-252`.

**The spec it violates:** `rasen/specs/session-runtime-context/spec.md:212` — an **existing main-spec requirement that this change does not modify.** `session-runtime-context` is not among this change's delta specs (`cli-artifact-workflow`, `file-placement`, `planning-space-addressing`, `store-config-inheritance`, `store-planning-scope-routing`, `store-project-namespace`). Three of its scenarios are now false:

1. `:219-224` **"A project the Store records only by its own declaration is rejected."** Requirement text: *"The project's own durable Store declaration is a LOCATOR and SHALL NOT vouch for the project on its own — a declaration that resolves to this Store but for which no Store record exists SHALL be rejected, never silently granted."* The code now **accepts** it. The test that proved the rejection was renamed to `accepts a legacy pointer project through its effective scope without writing membership` (`session-launch-context.test.ts:369-380`), and the uid-only variant likewise (`:415-437`).
2. `:231-237` **"A project the Store does not have as a member is rejected"** — the required legacy-migration marker and the copy-pasteable `rasen store add-project <projectId> --store <storeId>` repair are gone from the diagnostic; the message is now `Store "X" does not own project "Y" planning.` Assertions for the marker and the repair command were deleted at `:460-463`, `:479-482`, `:494-497`.
3. `:238-243` **"A project that plans elsewhere is still a valid choice."** Requirement text: *"A project whose own default planning Store is a different Store SHALL remain a valid choice once the session's Store records it, because the session records its planning Store explicitly."* The code now **rejects** it. Two tests inverted: `session-launch-context.test.ts:543-575` (`accepts a project whose own planning Store is a DIFFERENT Store when the Store records it` → `rejects …despite a knowledge membership record`) and `test/core/session-runtime-context-e2e.test.ts:200-232` (`works for a secondary Store membership…` → `does not let secondary Store membership replace the project planning owner`).

**Concrete failure scenario (authority reversal, the dangerous direction):** project `P` has never been added to Store `S` — `rasen store add-project` was never run, and no record exists under `S`'s metadata directory. `P`'s own `rasen/config.yaml` declares `store: S`. A management client posts `POST /api/v1/sessions {space: 'store:S', execution: 'project:P', kind: 'auto', task: …}`. Before: 409 `execution_not_member` with the migration marker and the repair command, no process spawned. Now: **201, the session launches, and `S`'s planning content becomes the working scope of an agent process** — granted purely by a declaration that lives inside `P`'s own checkout, which is exactly the input the spec calls a locator and forbids from vouching. Whoever can write `P`'s `rasen/config.yaml` can now attach a session to any Store they can name.

**Concrete failure scenario (capability loss, the other direction):** project `P` is a recorded member of Store `S` (`rasen store add-project P --store S` was run, the record exists) but `P`'s own pointer names Store `T`. Before: the session launched, planning in `S` — the case the spec says the planning/membership split exists for. Now: 409 `execution_not_member`, `Store "S" does not own project "P" planning.` There is no flag or selector that restores it.

**Why this is a Blocker and not a Major:** it reverses a security-relevant authority rule (record-vouches, declaration-locates) that a prior change established deliberately; it does so against a main spec this change never opened; it is recorded nowhere — not in `proposal.md`'s two BREAKING bullets, not in `design.md`, not in `tasks.md`, not in any delta spec (`store-config-inheritance/spec.md:32`'s "Mere Store membership … SHALL NOT transfer planning ownership" is the opposite direction and does not authorize this); and the five tests that would have caught it were rewritten to describe the new behavior. `resolveProjectMembership()` still exists and is still used by `store/bootstrap.ts`, so the membership provider was not retired — only the session seam stopped consulting it.

**What to fix:** either restore `storePermitsProject()` as the vouching authority at `session-launch-context.ts:245` (keeping the new effective-scope comparison, if wanted, as an *additional* check rather than a replacement) and restore the five tests; or, if the reversal is intended, it needs a `session-runtime-context` delta spec rewriting `:212` and the three scenarios, a BREAKING bullet in `proposal.md`, and an explicit LEAD decision — this is not the routing child's call to make silently.

### R3-4 — Minor — `store-root-selection.test.ts` archive-JSON coverage silently re-pointed from a Store to a standalone root

Detailed in §6. Six archive-diagnostic cases lost their `--store` dimension, one registered-empty-Store fixture was deleted outright, and two expected `fix:` strings dropped the `--store team-context` suffix so nothing proves the Store selector reaches archive repair hints. Under option (ii) all six should pass unchanged with `--store`. Not disclosed in `review-cycle-report.md`.

### R3-5 — Minor — The BREAKING bullet's stated rationale is falsified by option (ii)

`proposal.md:15` justifies the `work migrate` refusal with *"a legacy flat Store's planning tree is read-only until migration"*, echoed verbatim in the code comment at `work.ts:107-110`. Option (ii) made that false in the same tree: `new change --store <legacy>` and `rasen archive --store <legacy>` both write into that planning tree (`resolver.ts:1529-1535`, `archive.ts:92-97`). `proposal.md` is the PR body — a reader accepting this breaking change is given a reason that the change itself contradicts. The refusal is still contract-backed by `design.md:182` and `spec.md:97-101`; only the rationale needs correcting (the honest one is that migration writes *planning-owned* files and that ability is being withheld until the migration exists). Same staleness in the new doc `docs/zh/store-project-partitions-and-planning-worktrees.md:419`, which glosses `legacy_flat_store_requires_migration` as "Store 仍是旧扁平布局，禁止新写入" ("new writes forbidden").

### R3-6 — Minor — Unused `path` import in the reconstructed `sessions.ts`

`src/core/management-api/sessions.ts:9`. Detailed in §3.1. Harmless at runtime; significant as evidence that neither `tsc --noEmit` nor `pnpm run lint` can detect unused surface in this repo (`tsconfig.json` has no `noUnusedLocals`; `eslint.config.js:16` disables `no-unused-vars`), so those gates say nothing about reconstruction fidelity.

### R3-7 — Minor — Uncovered behavior in the reconstructed space-identity filter

Detailed in §3.2: (1) sessions launched under `space=project:<bound-project>` no longer appear under `space=store:<its Store>`, where the baseline root comparison matched them; (2) sessions attributed to an identity-less launch project (`space.id === ''`, reachable via `project-addressing.ts:337`) can never be filtered to. Both are plausible-correct under the aggregate/project distinction, both are untested in either direction, and neither is settled by a written requirement.

### R3-8 — Trivial — `review-cycle-report.md:332-339` is stale

It lists two `store-root-selection.test.ts` renames as "NOT fixed — flagged for a decision". The first (`fails with a store hint instead of scaffolding when no root exists`) **was** fixed: the ambient creation guard at `root-selection.ts:1461-1472` restores `no_root_with_registered_stores` for `new change`, and the original test is present and unmodified at `:460-468`. Only the second rename remains (folded into R3-4).

### R3-9 — Minor — A session can no longer launch from a directory with no planning scope

`session-launch-context.ts:300-309` now returns 409 `space_unavailable` when the trusted launch-project cwd has no resolvable planning scope; the baseline returned `ok: true` with `execution: { kind: 'project', projectId: '' }`. Test inverted at `session-launch-context.test.ts:737-775` (`keeps a trusted launch-project cwd usable…` → `fails closed when…`). Concrete effect: `rasen ui` started in a directory that is not a Rasen root can no longer launch any session at all. Arguably covered by `specs/planning-space-addressing` "Unresolvable or conflicting facts do not guess", but it is a user-visible removal with no BREAKING bullet, and it is a product judgment rather than a routing one.

### R3-10 — Minor — The flaky pipeline test is undiagnosable by construction, so its recurrence in CI will again say nothing

**Where:** `test/commands/pipeline.test.ts:1536` — `const json = JSON.parse(result.stdout.trim());` with no preceding `expect(result.exitCode).toBe(0)` and no use of `result.stderr`.

`runCLI` resolves with `{exitCode, stdout, stderr}` for **any** exit code and only *rejects* on timeout, with a distinct `CLI command timed out after 30000ms` message plus stderr and stdout tails (`test/helpers/run-cli.ts:244-257`). So the observed `SyntaxError: Unexpected end of JSON input` proves the child exited — almost certainly non-zero — having written nothing to stdout, and the reason was on stderr, which this test discards. A timeout is ruled out by the helper's own error text.

Every sibling `runCLI` call in the same test asserts `exitCode` first (`:1522`, and `:1501` in the preceding test); this one does not. Adding `expect(result.exitCode, result.stderr).toBe(0)` before the parse costs one line and converts every future occurrence from "Unexpected end of JSON input" into the CLI's actual error. Not attributable to this Change (see §9), but it is why the flake could only be dispositioned negatively.

---

## 9. Full-suite audit (freeze lifted)

I re-ran `pnpm test` over the whole repository with exclusive rights rather than inheriting the LEAD's result.

**My run: 5 failed / 6190 passed / 34 skipped — 6229 tests, 355 files, 777s.**

| | LEAD run 3 | My run |
| --- | --- | --- |
| Failed | 6 | **5** |
| Passed | 6189 | 6190 |
| Skipped | 34 | 34 |
| Total | 6229 | 6229 |
| Files | 355 | 355 |

The single difference is `pipeline.test.ts`. Totals are otherwise identical.

### The 5 environmental failures — disposition CONFIRMED, verified per assertion

I reproduced all five, then checked *which string each one asserts* instead of accepting a single cause extended across the set.

**Mechanism, proven directly rather than inferred.** A standalone probe creating a `mkdtemp` under the default temp root and running the same ancestor predicate as `findRepoPlanningRootSync` (`src/core/planning-home.ts:62-66`) returns:

```
mkdtemp fixture      = C:\Users\Sayo\AppData\Local\Temp\rasen-probe-vQCwQy
ancestor with rasen/ = C:\Users\Sayo\AppData\Local
```

`C:\Users\Sayo\AppData\Local\rasen` exists as a directory containing only `local-harness` (the local-version packaging cache), and `C:\Users\Sayo\AppData\Local` is an ancestor of `os.tmpdir()`. So the helper returns a non-null "project root" for **every** temp fixture on this host.

**Per-assertion accounting — the part I would not take on trust:**

| # | Test | The string/state it asserts | Why the one cause produces exactly this |
| --- | --- | --- | --- |
| 1 | `config.test.ts:635` "fails --scope project operations outside a Rasen project" | `consoleErrorSpy` called with `'no Rasen project found'`; observed **0 calls** | That string has exactly **one** producer in the whole tree: `messages.projectNotFound` at `src/commands/config.ts:91`, inside `if (!root)`. With `root` truthy that branch is unreachable, so 0 calls is the *predicted* result, not a coincidence. The preceding `expect(process.exitCode).toBe(1)` at `:638` passes for an unrelated reason — `config get` sets `exitCode = 1` at `config.ts:564` when the key is absent, and the found root has no `rasen/config.yaml`. (`beforeEach` at `:470` does reset `process.exitCode`, so that assertion is not stale-state — I checked, because a sticky exit code would have been the alternative explanation.) |
| 2 | `config-editor.test.ts:142` ja | `'Rasenプロジェクト外のため'`; received `"\nRasen設定"` | `config.ts:396-398` prints `ui.heading` unconditionally and `ui.outsideProject` only when `!projectRoot`. Received value **is** `ui.heading` in Japanese. Not a locale defect — the localized string is simply never emitted. |
| 3 | `config-editor.test.ts:163` zh | `'不在 Rasen 项目中'`; received `"\nRasen 配置"` | Identical; received value is `ui.heading` in Simplified Chinese. |
| 4 | `config-editor.test.ts:205` | `archiveRow.disabled` truthy; received `undefined` | `buildEditorChoice(entry, projectRoot, …)` at `config.ts:392` decides row-disabling from the same `projectRoot`. |
| 5 | `config-editor.test.ts:329` | `select` called 2×; got 3× | The extra call is the scope prompt, taken because a project scope appears to exist — same `projectRoot`. |

All four editor assertions read the *same* variable, assigned once at `config.ts:364-365`; `findRepoPlanningRootSync` has exactly three call sites in `config.ts` (`:89`, `:155`, `:365`). So this is one input with five observable consequences, not one explanation stretched over five symptoms.

**Controlled experiment, reproduced independently:** same code, same fixtures, only `TMP`/`TEMP` repointed to `E:\rasen-tmp-audit-r3` (a root with no `rasen/` ancestor) → **87/87 PASS**, versus 82/87 under the default temp. Scratch directory removed afterwards.

**Not attributable to this Change:** `git diff b86fbb6b -- src/core/planning-home.ts` is empty, and `src/commands/config.ts` and `src/core/global-config.ts` are absent from the change's file list entirely.

**Agreed disposition: environmental.** This is the harness weakness already queued as its own Change — the fixtures assume no `rasen/` directory exists above `os.tmpdir()`, which is false on any Windows machine that has ever run the local-version harness.

### The 1 flake — disposition CONFIRMED non-deterministic, with a correction to the stated mechanism

`pipeline.test.ts` "unsetting the runtime instance reverts the role to its declaration/default" **did not fail in my run.** A second full-suite run at full parallelism, different scheduling, same tree, green. That is the datum the isolation re-run could not supply, and it answers the LEAD's question directly: **not an ordering or state dependency.**

Supporting eliminations, so this is not just "it passed once":

- **Within-file ordering is exonerated by construction.** Test order inside a file is deterministic in vitest, and the file passes 93/93 alone.
- **Timeout is ruled out.** `run-cli.ts:244-257` rejects a timeout with a distinct message; it can never surface as `Unexpected end of JSON input`.
- **Cross-file shared state is ruled out.** Every spawned CLI is pinned to `isolatedConfigHome` / `RASEN_HOME=''` (`run-cli.ts:190-195`), and `isolatedConfigHome` is a module-scope `mkdtempSync` (`:21`) — one per worker process, and a worker runs one file at a time, so two concurrently-running files can never share a config/data home. Both registries also write through `writeFileAtomically` (`src/core/project-registry.ts:169`, `src/core/store/foundation.ts:636,891`), so a concurrent reader cannot observe a truncated file.
- **Not change-attributable.** The test exercises `config unset` (`src/commands/config.ts` — unmodified by this Change) and `pipeline agents`. The entire `src/commands/pipeline.ts` diff is confined to `resume()` plus option plumbing (`--target-line`, an optional `changeSelector` that `agents` never passes); no hunk touches the `agents` path.

**One correction to the LEAD's wording:** "the spawned CLI returned empty stdout" is the *observation*, not the mechanism. Because a timeout is excluded, what happened is that the child exited having printed nothing to stdout, with its reason on stderr — and the test throws away both the exit code and stderr (R3-10). So the flake is confirmed non-deterministic and confirmed not this Change's, but its positive cause remains unknown and will remain unknown on every recurrence until the test asserts `exitCode` first.

### Progression — the 12-failure improvement is real, not masking

| Run | Failed | Passed | Skipped | Non-skipped total |
| --- | --- | --- | --- | --- |
| 2 (round-1 tree, exclusive) | 18 | 6171 | 34 | 6189 |
| 3 (round-2 tree, LEAD) | 6 | 6189 | 34 | 6195 |
| 4 (round-2 tree, mine) | **5** | 6190 | 34 | 6195 |

Three independent checks that the drop is not achieved by hiding tests:

1. **The suite grew.** Non-skipped tests went 6189 → 6195 while failures fell 18 → 6. Masking by deletion would shrink the total.
2. **Nothing was skipped.** The skipped count is 34 in all three runs, and `git diff b86fbb6b -- test/ vitest.config.ts vitest.setup.ts` adds **zero** `it.skip` / `it.todo` / `it.only` / `skipIf` / `exclude` lines.
3. **Every net-deleted test is accounted for.** 17 test titles were removed without a same-title replacement. All 17 map to a decision or a finding: 3 to the deleted `resolveExecutionRoot` (NEW-10), 2 to the retired `store_project_mutually_exclusive` (`design.md:173`, `proposal.md:14`), 2 to the LEAD-approved `work migrate` refusal (NEW-3), 2 to **R3-2**, 7 to **R3-3**, 1 to **R3-4**. None is an unexplained disappearance.

The 12 that turned green are exactly the 11 legacy-flat-Store write cases plus the one `store-add-project` selector case named in the round-2 triage. Arithmetic and attribution both close.

### What the green suite does and does not establish

It establishes that the round-2 fixes introduced no new *detected* regression, and that NEW-1 … NEW-12 and the round-1 findings hold under execution. It does **not** bear on my three blocking findings, and this is the point worth stating plainly: **R3-2 and R3-3 are asserted green by the very tests that were inverted to describe the new behavior, and R3-1 lives in generated template text that no test reads.** A passing suite is exactly what a contract/coherence defect of this class looks like from the inside.

---

## 10. Second pass — the tree moved during this review

Everything in §1–§9 describes the tree as it stood when I was dispatched. The round-2 fixer landed further edits **while I was auditing**, including after I was told it was "finished and idle" and that "nothing further will change under you". I am recording this as a process fact with evidence, because it changes what a verdict can honestly mean.

### 10.1 Evidence that the tree was in motion

Three runs of the *same* command produced three different failure sets:

| Run | When | Result |
| --- | --- | --- |
| Session suites, targeted | 04:03 | 6 failed / 39 passed |
| Sweep 1 (51 files) | 04:10 → 04:17 | 14 failed / 757 passed |
| Sweep 2 (52 files, identical command) | 04:11 → 04:18 | 5 failed / 773 passed |
| Sweep 3 (42 files) | after a 90 s stability check | 2 failed / 494 passed |
| Sweep 4 (42 files) | after a 120 s stability check | **0 failed / 88 passed in 7 files** |

Mtimes of modified files confirm it directly — the four workflow templates at 20:03–20:04 UTC, `work.ts` 20:04, `session-launch-context.ts` 20:12, `session-launch-context.test.ts` 20:17, `project-space.ts` 20:20, `router.ts` 20:21, `submit.ts` 20:22, `session-runtime-context-e2e.test.ts` 20:24 — the last of those roughly two minutes before I sampled. A content snapshot I took over the 96 modified/untracked files then changed again under a stability check: `1916a1c0009a3ad0` → `efb97a6da540891a`.

Concretely, my sweep-3 run observed `sessions-space.test.ts:373` asserting `space_unavailable`; minutes later the same assertion was at `:378` asserting `execution_not_member`. Both readings were correct at the moment they were taken.

**Consequence:** any number in §9, and the LEAD's own 6-failure gate, describe trees that no longer exist. Everything in §10.2 onward is pinned to snapshot **`efb97a6da540891a`**, which I confirmed stable for 120 s before measuring and re-confirmed after.

### 10.2 Final status of every R3 finding at snapshot `efb97a6da540891a`

| id | severity | status | evidence |
| --- | --- | --- | --- |
| **R3-1** | Major | **RESOLVED** | All four templates now gate on `store-project` only: `archive-change.ts:19`, `bulk-archive-change.ts`, `ship.ts`, `sync-specs.ts` read "REFUSE with 'store_v2_finalization_unavailable' … **Any other scope, including 'legacy-store', proceeds normally.**" The CLI/skill contradiction is gone. |
| **R3-2** | Major | **RESOLVED** | `project-space.ts:73-95` discriminates on **layout**, not on the `store:` prefix: a `legacy-store` scope yields its flat project content from the scope's typed addresses; only a Store v2 aggregate returns `project_scope_required`. `space-scoping.test.ts:120,175` are back to the baseline titles (`answers for the store`, `creates the change under the store root`) and pass. |
| **R3-3** | **Blocker** | **RESOLVED** | `storePermitsProject()` is restored at `session-launch-context.ts:139-146`, called at `:302`, with a docstring citing `specs/session-runtime-context/spec.md:212` and both directions (`:219-224`, `:238-243`). `membershipRejection()` (`:153-175`) restores the legacy-migration marker and the `rasen store add-project <projectId> --store <storeId>` repair. All five inverted test titles are back verbatim, including `accepts a project whose own planning Store is a DIFFERENT Store when the Store records it` and `the rejection distinguishes a declaration pointing here from one pointing elsewhere or absent`. The three violated spec scenarios hold again. |
| **R3-4** | Minor | **RESOLVED** | `store-root-selection.test.ts` is now baseline **+6/−1 lines** — the additive `scope` assertion only. The `archive --json is non-interactive` block is back on `--store team-context` / `archive-blank-context`, zero `archiveRoot` residue. Verified by execution: **34/34 pass**. |
| **R3-5** | Minor | **RESOLVED** | `proposal.md:15` now states the true reason and explicitly corrects the old one: "The reason is not that the Store's planning tree is read-only — `new change` and `archive` still write it — but that work migration is itself a *bulk relocation of planning-owned files* … into a layout that the layout-migration slice is about to restructure." |
| **R3-6** | Minor | **RESOLVED** | The unused `import * as path` is gone from `sessions.ts`; zero `path.` references remain. |
| **R3-7** | Minor | **OPEN (observation)** | The filter is unchanged; both uncovered behaviors stand. Now firmer, not weaker — see §10.4. |
| **R3-8** | Trivial | **RESOLVED** | The stale "Two further inverted tests, NOT fixed" paragraph is gone from `review-cycle-report.md`. |
| **R3-9** | Minor | **RESOLVED** | `keeps a trusted launch-project cwd usable when no planning space can be derived` is restored at `session-launch-context.test.ts:780`. |
| **R3-10** | Minor | **OPEN** | `pipeline.test.ts:1536` still parses `result.stdout` with no `expect(result.exitCode)` guard. Baseline file, not this Change's defect; deferring is reasonable. |
| **R3-11** | Minor | **RESOLVED (found and closed inside this pass)** | See §10.3. |

### 10.3 R3-11 — a regression I caught mid-pass, and how it was closed

The first R3-2 fix reintroduced the exact algorithm this Change exists to delete: `paths['project-home'] ?? path.join(input.root, WORKSPACE_DIR_NAME)` and `paths['active-changes'] ?? path.join(projectHome, 'changes')`. The fallbacks were dead code — `describePaths()` always populates both for a `legacy-store` ref — but they were a flat `rasen/changes` reconstruction inside a file the source guard classifies `scope-seam`, and a latent fail-open if a future ref shape ever omitted those addresses.

**The repo's own gate caught it**, which is worth recording as a positive: `planning-path-source-guard.test.ts` (task 1.3) failed with `project-space.ts` observed at **3** direct joins against an expected **2**. That test failed in all three of my sweeps and was the only failure common to every one of them.

It is now fixed **by correcting the code, not by raising the bar** — I checked that specifically, because bumping the expectation from 2 to 3 would have been the cheap way out. The guard still reads `count: 2` at `planning-path-source-guard.test.ts:27`, and `project-space.ts:81-95` now reads the typed addresses directly with a fail-closed assertion (`isStoreAggregateSpace(input) || projectHome === undefined || changesDir === undefined` → `project_scope_required`) and joins no Store path of its own.

### 10.4 Audit of the LEAD's residue-(a) reasoning on `sessions.ts`

Asked to find a hole rather than accept the conclusion. I verified all three links and found one.

**Link 1 — the baseline shape.** Verified against `git show b86fbb6b:src/core/management-api/sessions.ts`: the parameter was `filterRoot: string | undefined` and the body was `if (!record.space || canonicalizeOrResolve(record.space.root) !== filterRoot) continue;`. Sound — and it establishes **more than claimed**: the `!record.space → continue` arm is verbatim baseline structure, not reconstruction guesswork. That closes the one sub-gap I had listed as unpinned in §3.2. (It explains the dead `canonicalizeOrResolve` helper; it does *not* explain the retained unused `path` import, which was R3-6 and is now fixed.)

**Link 2 — the router type.** Sound and strong. `router.ts` was never destroyed, so it is authored rather than inferred, and `Pick<ResolvedSpace,'type'|'id'>` (`:1095`, constructed at `:1102`, passed at `:1104`) exposes no `root` to the callee. A body that compared a filter-side root could not have compiled.

**Link 3 — the spec.** Sound. `rasen/specs/planning-space-addressing/spec.md:21-23` requires `space=store:elftia` to select the Store when a store and a project share the id, so an `id`-only predicate is excluded and `type` must participate.

**The hole.** The three links bound the predicate from below (must consult `type` and `id`) and exclude a filter-side `root`. They do **not** exclude a *superset* — the record also carries `record.space.planning`, a field this same Change adds, so an original of the form `type && id && <planning-fact comparison>` satisfies all three constraints identically. "Over-determined" is therefore a shade too strong; the honest claim is "the **minimal** predicate consistent with three independent constraints."

**How much the hole matters: little.** Any *restrictive* superset is excluded empirically by `sessions-space.test.ts:379-450`, which launches with `space: 'store:joined-store'` plus `execution: 'project:joined-member-id'` — so the record carries `planning: {storeId, projectId}` — then filters by `store:joined-store` and requires exactly one hit. A predicate additionally demanding planning facts be absent, or matching a store filter's non-existent project dimension, fails that test. A permissive-equivalent superset is unobservable by construction.

**Verdict: residue (a) can be closed**, with the wording corrected from "over-determined" to "minimal predicate consistent with three constraints, restrictive alternatives excluded by `sessions-space.test.ts:379-450`".

**Residue (c)'s bound, verified myself rather than accepted.** I extracted each exported handler from the baseline blob and from the current file, normalized EOL, and compared:

```
handleLaunchSession  IDENTICAL (4035 chars)
handleGetSession     IDENTICAL (422 chars)
handleKillSession    IDENTICAL (374 chars)
```

The bound holds exactly: reconstruction risk is confined to `handleListSessions` plus the module header and imports. (My first comparison reported `handleLaunchSession` as differing — that was my own bug, a multi-line search marker against a CRLF working tree, not a real divergence. Corrected above.)

**R3-7 is firmer after reading the baseline, not weaker.** Because baseline compared canonical roots, a session recorded under `space=project:<bound-project>` — whose `space.root` is the Store planning checkout — *did* match a `store:<S>` filter before this Change, and no longer does; and an id-less project space (`projectId: ''`, reachable via `project-addressing.ts:337`) *was* reachable by root and is now unaddressable. Both are real behavior changes from baseline, both untested in either direction, and neither settled by a written requirement.

### 10.5 The two items I was asked to verify by execution

**Item 1 — `new change` vs `list`.** Verified against the built CLI on throwaway fixtures, not from source:

- *(a) The commands agree.* With a registered Store and no local root, `list --json` and `new change foo --json` from the same directory both exit 1 and return **byte-identical status objects** — `JSON.stringify(list.status[0]) === JSON.stringify(newchange.status[0])` is `true`, covering code, message, target and fix (`no_root_with_registered_stores`, "…Registered stores: team-store. Pass --store <id>…"). `new change` scaffolded nothing: no `rasen/` was created.
- *(b) The implicit-root path still works with no Stores registered.* In a fresh directory with an empty data home, `new change foo --json` exits **0**, creates `…/fresh-repo/rasen/changes/foo`, and reports `root.source: nearest`; `list` in the same directory also exits 0. The guard fires on registered Stores, not on emptiness — confirmed empirically, and structurally: `resolveCompatibilityRoot` only throws when `registeredIds.length > 0`, otherwise falling through to `makeRoot(…, 'implicit')`.
- *(c) The restored test names assert the restored behavior.* Stronger than a rename: `store-root-selection.test.ts` is baseline apart from the additive `scope` assertion, so `fails with a store hint instead of scaffolding when no root exists` (`:460`) is the original test with its original body.

**Item 2 — the six archive tests.** Verified independently: the block is back under `describe('archive --json is non-interactive')` at `:530`, every case runs against `--store team-context` (or the registered `archive-blank-context` Store, whose fixture is also restored at `:553`), there is **zero** `archiveRoot` residue, and the whole file is baseline +6/−1 lines. Executed: **34/34 pass**, including the three cases that would have failed had option (ii) only half-restored legacy Store archive — `archive_validation_failed`, `archive_spec_validation_failed`, and the spec-update-failure case — all green against the Store. This also independently corroborates that legacy flat Store archive works end to end through the CLI, which is what made R3-1's template refusal a genuine contradiction rather than a cosmetic one.

### 10.6 NEW-12, as evidence rather than argument

The LEAD reports two vitest processes plausibly overlapping in this checkout with **no** `dist` corruption, and a later isolated run printing `dist/ matches the current sources; skipping build`. That matches my own experience across this pass: I ran vitest seven times and `node build.js --if-stale` once, and every invocation after the first printed the skip line; `dist/cli/index.js` was never missing or partial, and my direct-spawn CLI probes never hit a broken bundle. That is the exact failure class the round-2 reviewer hit for real, now demonstrably absent under the conditions that produced it. It agrees with my mechanism reading in §4 — fingerprint written after a successful compile, inside `dist`, so no interrupted state reads as fresh — so I now have both the argument and the demonstration. NEW-12 stays RESOLVED.

### 10.7 Flake attribution, corrected for the disclosed overlap

The LEAD notes a 51-file sweep by the fixer may have contended with my window. That does not affect my conclusion, and in one respect strengthens it: the `pipeline.test.ts` flake I was asked to audit **did not recur** in my full-suite run, so contention would only have made recurrence *more* likely, not less. Nothing else in my window presented as a timing flake — the failures I recorded were the five deterministic environmental config cases (reproduced, mechanism proven, reversed by changing only the temp root) and the R3-3/R3-11 failures, all of which I re-ran and all of which tracked real source state rather than load. I dismissed nothing as contention without a re-run, and I recorded nothing as a finding that a re-run cleared.

---

## 11. Checks run for this review

| Check | Result |
| --- | --- |
| `git status --porcelain` + `git diff b86fbb6b --stat` | 90 tracked files changed, 10 untracked paths; reviewed both |
| Full read of `src/core/store-planning/internal/resolver.ts` publication, catalog, marker, and resolve paths | See §1–§2 |
| Full read of the reconstructed `src/core/management-api/sessions.ts` against `router.ts:1091-1104`, `project-addressing.ts:150-270`, and design D3 | See §3 |
| Enumeration of **every** `StateFileLocationOptions` construction site and **every** run-state/portfolio-state writer in `src/` | 4 read sites, all covered; 1 writer, execution-rooted |
| Repo-wide grep for `resolveExecutionRoot`, `findCodeProjectRoot`, `store_v2_finalization_unavailable`, `legacy_flat_store_requires_migration`, `includeChangeDir`, `resolveProjectMembership` | Basis for P6, P3, P5, R3-1, R3-3 |
| Byte-level encoding audit of all 156 changed/untracked text files, with per-file comparison against `git show b86fbb6b:<path>` | §7 — 0 NUL, 0 invalid UTF-8, all BOM/`U+FFFD` baseline-identical |
| `rasen/changes/store-layout-v2-migration/{proposal.md,tasks.md}` §10b deferral audit | §5 — executable, one nit |
| Full sweep of the test diff for renames, inversions, and vacuous assertions | §6 |
| **`pnpm test`, whole repository, exclusive** | **5 failed / 6190 passed / 34 skipped (6229 tests, 355 files, 777s)** — §9 |
| `pnpm exec vitest run --maxWorkers=1 config.test.ts config-editor.test.ts` (default temp) | 5 failed / 82 passed — all five reproduced |
| Same two files, `TMP`/`TEMP` = `E:\rasen-tmp-audit-r3` (controlled experiment) | **87/87 PASS.** Only the temp root changed; scratch directory removed afterwards |
| Standalone ancestor-walk probe from a `mkdtemp` fixture | Returns `C:\Users\Sayo\AppData\Local` — mechanism proven directly, not inferred |
| Producer search for the `no Rasen project found` string | Exactly one (`src/commands/config.ts:91`), unreachable when the walk succeeds |
| Baseline diff of `planning-home.ts`; membership of `config.ts` / `global-config.ts` in the change | Empty diff; both files absent from the change |
| Anti-masking: added `.skip` / `.todo` / `.only` / `skipIf` / `exclude` in the test diff | **Zero** |
| Anti-masking: net-deleted test titles, each attributed | 17, all accounted for (§9) |
| Mutating git commands | None |

**Second pass (§10), all at or after snapshot `efb97a6da540891a`:**

| Check | Result |
| --- | --- |
| Tree-stability sampling (content hash over all modified/untracked files) | Moved 3 times during the review: `1916a1c0009a3ad0` → `efb97a6da540891a` → `a27179b796f6312c` |
| `session-launch-context` + `sessions-space` + `session-runtime-context-e2e` (first sample) | 6 failed / 39 passed — source restored, tests not yet |
| Sweeps 1–3 over the in-flux area | 14 → 5 → 2 failures as edits landed |
| Sweep 4, after 120 s of stability (7 files) | **88/88 PASS** |
| `store-root-selection.test.ts` (item 2) | **34/34 PASS**, `--store` restored throughout |
| Live CLI probe: `list` vs `new change` with a registered Store (item 1a) | Byte-identical status objects; no scaffolding |
| Live CLI probe: `new change` with no Stores registered (item 1b) | exit 0, scaffolds, `root.source: nearest` |
| Byte comparison of the three non-list `sessions.ts` handlers vs baseline (item 3c) | All three **IDENTICAL** |
| Source guard `planning-path-source-guard.test.ts` | Failed in all three sweeps (R3-11); now passes, expectation still `count: 2` — fixed in code, not in the gate |
| **`pnpm test`, whole repository, exclusive** | **10 failed / 6185 passed / 34 skipped (6229, 355 files, 784 s)** |
| Isolation re-run of the 5 new failures | `skill-templates-parity` **2 real** (reproducible); `validate.enriched-output`, `local-version-runtime`, `token-audit/management` all **PASS** in isolation → contention |
| Encoding re-scan after the new rounds (156 files) | Unchanged: 0 NUL, 0 invalid UTF-8, BOM/`U+FFFD` all baseline-identical |

§1–§8 were derived under the freeze. §9 audits the LEAD's gate. §10 is the second pass against a moving tree.

---

## 11. Final verdict

**NOT CLEAN — but the substance is nearly there.** Every finding from §1–§8 has been addressed except two Minors, and the three blocking items are genuinely resolved (§10.2). What is left is one owned red gate and one process problem.

### Must fix

1. **R3-12 (Major, new) — the R3-1 template fix left the skill parity hashes stale.** `test/core/templates/skill-templates-parity.test.ts` fails 2 tests — `preserves all template function payloads exactly` and `preserves generated skill file content exactly` — because the four gate paragraphs changed after `EXPECTED_FUNCTION_HASHES` / `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` were last regenerated (`rasen-ship`, `rasen-sync-specs`, and the archive pair). **Reproducible in isolation**, so it is not contention: 2 failed / 23 passed over the four files. The content of the fix is right; only the recorded hashes are behind. Regenerate them and re-run that file.

### Process — this needs a decision, not a code change

2. **The tree changed under this review three times, twice after I was told it would not.** Evidence in §10.1: file mtimes spanning 20:03–20:24 UTC, three different failure sets from the same command, and a content snapshot that moved `1916a1c0009a3ad0` → `efb97a6da540891a` → `a27179b796f6312c`. My sweep-3 run read `sessions-space.test.ts:373` asserting `space_unavailable`; minutes later that assertion was at `:378` asserting `execution_not_member`. Both readings were true when taken. **A reviewer cannot certify a tree that is being written during the review** — not because the edits were wrong (they were, in substance, the right fixes) but because no measurement survives to the sign-off. The final full-suite gate itself ran at `efb97a6d…` and the tree is now at `a27179b7…`, so even that number is one snapshot stale. Freeze the tree, then take one gate.

### Should fix, or defer with a note

3. **R3-10 (Minor)** — `pipeline.test.ts:1536`: add `expect(result.exitCode, result.stderr).toBe(0)` before the parse. Not this Change's defect; it is why the flake could only be dispositioned negatively.
4. **R3-7 (Minor)** — the two uncovered behaviors of the reconstructed space filter (§10.4). Worth one test in each direction, whichever answer is intended.

May be deferred as already accepted: **NEW-9**.

### Resolved since my first pass

R3-1, R3-2, R3-3 (all three blockers), R3-4, R3-5, R3-6, R3-8, R3-9, and R3-11 — per-item evidence in §10.2. Two are worth calling out because of *how* they were closed: R3-3 restored the membership seam with a docstring citing the exact spec lines and both failure directions, and R3-11 was closed by correcting `project-space.ts` rather than by raising the source guard's expected count, which is the cheap fix I specifically checked for.

### The full-suite gate, honestly stated

At snapshot `efb97a6da540891a`: **10 failed / 6185 passed / 34 skipped (6229 tests, 355 files, 784 s)**, dispositioned by isolation re-run rather than by assertion:

- **5 environmental** — the `config` / `config-editor` cases. Mechanism proven directly, accounted for per assertion, reversed by changing only the temp root (§9). Not this Change's.
- **3 contention** — `validate.enriched-output`, `local-version-runtime`, `token-audit/management`. **All three pass in isolation**; each appeared for the first time in the run that overlapped the fixer's activity. Not this Change's.
- **2 real and owned** — the parity hashes above (R3-12).

My earlier gate (§9, 5 failed / 6190 passed) and the LEAD's (6 failed / 6189 passed) are both superseded; all three describe different trees.

**On my first-pass verdict:** the three blockers were real and are now fixed, which is the outcome the round was for. The reason a green suite did not surface them then — R3-2 and R3-3 were asserted green by the tests that had been inverted, and R3-1 lived in template text no test reads — remains the durable lesson here. R3-12 is its mirror image: a gate that *did* fire, on text no reviewer would have diffed by hand.

---

## 12. Round-3 delta confirmation

- **Snapshot:** `6b1988cea5decebb` (98 modified/untracked files), verified unchanged at the start and end of this pass — the first stable tree this review has had.
- **Execution:** vitest held at the LEAD's request. Everything below is source reading, byte-level recomputation from `dist/` (fingerprint-verified current), and direct `dist/cli/index.js` probes. No vitest, no build, no mutating git.
- **Numbering note:** the LEAD's message calls the parity-hash item "R3-11"; in this report R3-11 is the `project-space.ts` flat join and **R3-12** is the parity re-baseline. Both are covered below under my numbering.

### 12.1 Per-finding confirmation

| id | verdict | file:line and evidence |
| --- | --- | --- |
| R3-1 | **RESOLVED** | All four gate paragraphs read "If root.scope.kind is 'store-project', REFUSE with 'store_v2_finalization_unavailable' … **Any other scope, including 'legacy-store', proceeds normally.**" — `archive-change.ts:19`, `bulk-archive-change.ts:21`, `ship.ts:25`, `sync-specs.ts:20`. Zero remaining `legacy_flat_store_requires_migration` refusals in `src/core/templates/`; zero "in this child" phrasing. |
| R3-2 | **RESOLVED** | One shared predicate, correct semantics: `isStoreAggregateSpace()` (`project-space.ts:23-27`) is true only for `type === 'store'` **and** `describe().kind !== 'legacy-store'`. Applied at all four sites — `project-space.ts:88`, change submission `router.ts:676`, worktrees `router.ts:877`, and `ChangeSubmissionTarget` (`submit.ts:48-56`, which now documents a legacy flat Store as a valid submission target). `handleSpaceWorktrees` widened to `ResolvedSpace` (`spaces.ts:241-247`) with the screening located in the caller and said so in the comment. `SpaceWorktreesResponse` untouched, as claimed. |
| R3-3 | **RESOLVED — checked hardest, both directions hold** | See §12.2. |
| R3-4 | **RESOLVED** | Confirmed last pass by execution: `store-root-selection.test.ts` is baseline +6/−1, `--store` restored throughout, **34/34 pass**. |
| R3-5 | **RESOLVED** | `proposal.md:15` states the true reason and explicitly retracts the false one. |
| R3-6 | **RESOLVED** | No `path` import and no `path.` reference in `sessions.ts`. |
| R3-8 | **RESOLVED** | Stale paragraph gone from `review-cycle-report.md`. |
| R3-9 | **RESOLVED** | `keeps a trusted launch-project cwd usable when no planning space can be derived` restored at `session-launch-context.test.ts:780`. Agreed with the reasoning: no spec or task mandated the fail-closed behavior, so baseline is the right resting place. |
| R3-10 | **RESOLVED** | Applied at `pipeline.test.ts:1540`: `expect(result.exitCode, result.stderr).toBe(0)` before the parse, with a comment recording that the cause is still unknown. Honest — it does not claim to have diagnosed the flake. |
| R3-11 (flat join) | **RESOLVED** | `project-space.ts:81-95` reads typed addresses only and fails closed; the source guard's expectation is still `count: 2` at `planning-path-source-guard.test.ts:27` — fixed in code, not in the gate. |
| R3-12 (parity hashes) | **RESOLVED — independently recomputed** | See §12.3. |
| R3-7 | **OPEN (observation), now with a concrete instance** | See §12.4. |
| NEW-9 | Carried forward as accepted. | Unchanged. |

### 12.2 R3-3 — the two things I was asked to check hardest

**`execution_identity_mismatch` restored, and stronger than a revert.** `session-launch-context.ts:209-222` checks *both* recorded identities — the machine registry entry (`findProjectRegistryEntry(cwd)`) and the checkout's own `rasen/config.yaml` (`readProjectConfig(cwd)?.projectId`) — and rejects when either disagrees with the selected project. That satisfies the spec's third precondition ("the checkout's own recorded identity is the project that was chosen", `session-runtime-context/spec.md:212`) and names its own check rather than collapsing into a generic failure. Validation order now matches the spec's order: availability (`:196-204`) → identity (`:209-222`) → membership (`:327`).

**Effective-scope comparison genuinely demoted to enrichment.** `resolveExecutionProject` returns `project?: ResolvedProjectSpace` — optional — and obtains it via `resolveProjectPlanningSpaceFromRoot(cwd).catch(() => null)` (`:230-234`), keeping the value only when it resolves to a project scope. It therefore cannot gate and cannot raise an early error. The consumer at `:319-343` calls `storePermitsProject(selectedSpace, resolved.projectId)` using the **registry** projectId, not a scope-derived one, so an unusable Store declaration can no longer pre-empt the membership diagnostic. This is exactly the ordering hole I flagged in my first pass, and it is closed at the root rather than at the one test that caught it.

**Direction 1 — escalation (must reject).** A project with no membership record but a `store: S` line in its own config: `storePermitsProject` → `resolveProjectMembership(store, projectId)` → `null` → `membershipRejection` (`:327-329`). The declaration is read *only* inside `membershipRejection` (`:158-165`) to choose between the legacy-marker message and the plain one, never to grant. `spec.md:219-224` holds — the declaration locates, the record vouches.

**Direction 2 — capability loss (must accept).** A recorded member whose own pointer names Store T while the session plans in S: `storePermitsProject` returns true from S's record, and I traced every statement between `:327` and the success `return` at `:331-343` — there is no second gate. The project's own planning Store appears only as frozen facts in `planningSpace.planning`. `spec.md:238-243` holds.

**Sixth flipped assertion.** `sessions-space.test.ts` "rejects a stale Store pointer" is back to `execution_not_member` (`:378`), which is the assertion the ordering fix makes true. Good catch on the fixer's part — I had identified the ordering hole from source but had attributed the failing test to the restoration being incomplete; the correct reading is that the test was itself the sixth inversion.

Execution confirmation of these six is the LEAD's in-flight suite; my last measurement of this area (before the identity/ordering work landed) was 6 failures, all of which these changes target.

### 12.3 R3-12 — audit of the pinned-hash re-baseline

This is the item most able to launder a regression, so I did not check the fixer's method; I replaced it. I recomputed **every** hash from scratch, out of `dist/` (fingerprint-verified current), using the test's own recipe — `stableStringify` with sorted keys, then SHA-256 — reimplemented independently in a standalone script:

```
[A] FUNCTION payload hashes:   43 recorded keys recomputed, 0 mismatch
[B] GENERATED content hashes:  42 recomputed via generateSkillContent(…, 'PARITY-BASELINE'), 0 mismatch
```

**Zero mismatches.** The recorded table therefore describes the current source exactly; nothing was written to a value the code does not actually produce. Because any text change moves a SHA-256, the gate remains live rather than green-by-construction.

**Why 82 keys moved rather than 8.** My diff of the current table against the baseline blob shows 41 function + 41 generated hashes moved, 0 added, 0 removed — matching the LEAD's "82 changed hash lines". The cause is structural and legitimate: `STORE_SELECTION_GUIDANCE` is a single shared constant embedded in ~41 templates, and this Change rewrites it (`store-selection.ts`) to document the orthogonal `--store` / `--project` / `--target-line` selectors and the retired mutual exclusion. One constant edit moves every template that embeds it. The remaining template deltas are 12 files, all in scope for this Change (the four gate paragraphs, `direction.ts`'s `project-work` address, `_shared.ts`, `experts/review.ts`, `_orchestration.ts`, `help.ts`, `office-hours.ts`, `onboard.ts`, `propose.ts`). No template moved that this Change does not textually touch, directly or through the shared constant.

I did not attempt to separate the round-3 8 from the round-1 74 — the pre-round-3 state is uncommitted and unrecoverable — but that separation is not what makes the re-baseline safe. What makes it safe is that every recorded value is reproducible from the current source and every moved key has a source-level cause.

**One pre-existing gap, not this Change's:** `getAuditSkillTemplate` is exported but absent from both tables, in the current file and in the baseline blob. It has no parity coverage. Worth a follow-up somewhere, not here.

### 12.4 Inverted-test sweep, third pass

Ran the name-diff detector across all 22 changed test files. **Net-deleted test titles fell from 17 to 8**, and all 8 are accounted for:

| Net-deleted title | Disposition |
| --- | --- |
| `equals the planning root for an in-repo project` / `for a store-selected run resolves the cwd code project root` / `…falls back to the cwd` | The `resolveExecutionRoot` capability was deleted (NEW-10); deleting its tests is correct. |
| `rejects both --store and --project in a single invocation before resolving` / `rejects both flags in resolveRootForCommand JSON mode…` | `store_project_mutually_exclusive` is deliberately retired (`design.md:173`, `proposal.md:14` BREAKING). Replaced by orthogonal-selection tests. |
| `routes Store planning artifacts to the Store and terminal state to the invocation member` / `freezes main and linked worktrees independently across consecutive Store migrations` | The LEAD-approved `work migrate` refusal (NEW-3), spec-backed at `spec.md:97-101`. |
| `preserves omitted-space pointer-repo fallback: member cwd with Store attribution and attachment` | **Rename, not deletion** → `resolves omitted-space pointer-repo fallback to the launch project effective scope, planning in the Store, executing in the member cwd` (`session-launch-context.test.ts:726`). Checked against the contract rather than the comment: task 9.2 and `specs/planning-space-addressing` scenario "Bound launch project follows Store planning" require exactly this. The test is honest — it labels the change DELIBERATE, cites the requirement, and still asserts that the planning root is the Store, the cwd is the member, and `planning: {storeId, projectId}` preserves the Store attribution. Legitimate. |

Sixteen titles were net-added, all describing capabilities or refusals traceable to a task or delta scenario. **No remaining test asserts a loss where it previously asserted a capability without a contract behind it.** Round 3's wholesale-restore-from-baseline approach is visibly lower-risk than the hand-edits of rounds 1–2: `store-root-selection.test.ts` is now baseline +6/−1 and `retain-prepare.test.ts` is baseline-identical apart from a comment.

**One consequence to record rather than block on:** the omitted-space rename is a concrete instance of R3-7 item 1. A Store-bound member's session is now recorded with `type: 'project'` while its `root` is the Store planning checkout, so `GET /api/v1/sessions?space=store:<S>` will not list it, where baseline's root comparison would have. That is no longer hypothetical — it is the behavior of a tested, spec-mandated path. Still Minor, still unspecified in either direction, still worth one test whichever answer is intended.

### 12.5 Regression re-check of S1-S3, P1-P6, NEW-1..NEW-12

Round 3's surface is 18 files (by mtime): the four templates, `work.ts`, `session-launch-context.ts`, `project-space.ts`, `router.ts`, `spaces.ts`, `submit.ts`, one doc, and six test files. Everything the earlier findings are anchored in — `resolver.ts`, `root-selection.ts`, `archive.ts`, `context.ts`, `doctor.ts`, `run-state.ts`, `file-placement.ts`, `sessions.ts` — is **outside** that surface, so §1–§2 carry over. Spot-verified the anchors that live in or near touched files:

- **S2** — `project-schemas` still threaded into `readChangeMetadata` (`resolver.ts`, 2 sites). ✔
- **P2 / NEW-6** — `store_aggregate_scope` still emitted by `context.ts`. ✔
- **P3** — `store_v2_finalization_unavailable` still fail-closed at both `archive.ts` gates, and the four templates still refuse `store-project`. Narrowing them to v2 does not weaken P3, which was always about Store **v2** finalization. ✔
- **P5** — `includeChangeDir: false` still set for `store-project` at all four construction sites, including the rewritten `project-space.ts:158-172`. Correctly *not* set for `legacy-store`, whose planning Change directory is a legitimate legacy location. ✔
- **NEW-3** — `work.ts` still refuses with `legacy_flat_store_requires_migration`. ✔

**Encoding:** re-scanned all 158 changed/untracked text files. 0 NUL, 0 invalid UTF-8; the 1 BOM and 3 `U+FFFD` files remain byte-identical to baseline; mixed EOL in 3 files is the autocrlf artifact that normalizes on `git add`. No anomaly introduced by round 3.

### 12.6 Verdict on the round-3 delta

**CLEAN** on every axis I can verify without vitest — 11 of 12 findings resolved, R3-7 carried as a stated observation, no new blocking finding, no new inverted test, no regression among S1-S3 / P1-P6 / NEW-1..NEW-12, and the pinned-hash re-baseline independently reproduced from source.

One honest limit: I could not run the suite. My sign-off is conditional on the LEAD's in-flight full run showing **only the five environmental `config` / `config-editor` failures** — specifically, the two `skill-templates-parity` tests must be green (I recomputed all 85 of their inputs by hand and they match, so they will be) and the six previously-failing session-launch tests must be green (their source causes are fixed; I read every one). If anything else appears, it postdates snapshot `6b1988cea5decebb` and needs another look.
