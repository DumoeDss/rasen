# ecp-association-registry-wiring — Planning Context (LEAD seed)

> Read this FIRST. It is the durable seed for every planner/implementer/reviewer worker.
> The LEAD verified every claim below against the source in THIS worktree
> (branch `feat/ecp-association-registry-wiring`, base `feat/0.1.6-executable-composite-pipelines`
> @ `bcab92ad`). Append durable new findings only.

## What this change is

This change **closes Gap E** of `ecp-run-spine` (0.2.0, PR #92): the association
registry that implements *distinct-ChangeInstance-on-recreate* exists at the kernel
layer but is **not wired into production**. `ecp-run-spine` shipped with this gap
documented; this change deploys the registry to the real launch/archive/inspect path
and proves it with **real CLI processes**, not kernel fixtures.

This is the integrity hotspot: `ecp-run-spine` originally slipped through precisely
because "the kernel was tested but production wasn't wired." Every requirement below
MUST be verified through the REAL product surface.

## The precise diagnosis (LEAF-verified, then re-verified by LEAD in this worktree)

1. `src/core/change-run/internal/association-registry.ts` implements the full
   distinct-instance semantics: `bindActiveAssociation` / `archiveAssociation`,
   `(PlanningSpaceId, changeId)` lease, active/archive aliases, append-only immutable
   revision ledger (`AssociationLedger`). **It is a pure in-memory data structure —
   nothing persists it to disk.**
2. **Production never calls it.** `grep -rn "bindActiveAssociation\|archiveAssociation" src/`
   hits ONLY the module itself (definitions). Zero production call sites. (Confirmed.)
3. The CLI `resolveRuntime` (`src/commands/pipeline.ts:489-608`) derives
   `ChangeInstanceId` from `statSync(projectRoot)` — the **project root's** physical
   identity:
   ```ts
   // pipeline.ts:564-574  — THE BUG
   const st = statSync(projectRoot, { bigint: true });
   const physical = readPhysicalIdentity({ device: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs });
   const changeInstanceId = deriveChangeInstanceId(planningSpaceId, changeId, physical);
   ```
   Archiving a Change and recreating the same name does NOT change the project root's
   inode → same `ChangeInstanceId` → same `RunId` → "recreate" silently reuses the old
   (archived) Run. The proposal's "Same-name recreation receives a distinct instance"
   promise is **not honored in production**.
4. `launch_instance_ambiguous` (`src/core/change-run/facade.ts:56`) is defined in the
   error union but **never thrown** — multiple historical same-key instances are not
   detected.
5. Kernel proof exists but is not a production proof: `test/core/change-run/
   archive-recreate-journeys.test.ts` (task 15.7) proves distinct-instance semantics
   by calling `association-registry.ts` **directly**. It passes — but production does
   not go through the registry, so the property does not hold in production.
6. **physicalIdentity semantics**: the registry's `physicalIdentity` parameter is the
   **Change directory's** inode/identity (see `test/core/change-run/
   association-registry.test.ts` — `oldPhysical`/`newPhysical` differ in
   `fileIndex`/`birthIdentity`, modeling two distinct Change dirs). The CLI's
   `statSync(projectRoot)` is a pre-registry simplification and uses the WRONG subject.
7. **PlanningSpaceId home**: the registered machine home for this project is
   `autonomy-ladder-1e42477e` (see workDir under `~/.rasen/projects/
   autonomy-ladder-1e42477e/...`). Design §1 wants `PlanningSpaceId =
   H("planning-space/1", registryEntry.home)` — the **persisted** home. The current
   code computes `planningSpaceHome = project-${sha256(projectRoot).slice(0,12)}` (a
   path hash) instead. Same identity-model gap; "身份链贯穿" makes it in-scope.

## Related gap to converge in the same change (Gap D)

`assertChangeNotArchived` (`src/commands/pipeline.ts:791-822`, called at `:990` and
`:1047` before `complete`/`control`) currently uses a **filesystem heuristic**: it
checks whether `rasen/changes/<id>/` exists (=active) or
`<home>/archive/*-<id>/` exists (=archived). Once the registry is the source of truth,
this check should consult the registry's `state: 'archived'` (fs heuristic may remain
as a fallback, but the registry is authoritative). This is the same root cause: there
is no durable instance-state record, so production guesses from the filesystem.

**Minor sibling**: `src/core/change-run/internal/projector.ts` (~line 159) hardcodes
`sourceState: 'active'` in the detail projection; only the list endpoint computes the
real `sourceState`. After archive, `pipeline status <runId>` detail still reports
`active`. Fix it to project the registry's real state.

## Fix scope (identity-model deployment — 7 points)

1. **Persist the registry.** Persist the `AssociationLedger` to disk at the machine
   home, alongside the RunStore root. Reuse the proven safe-path + immutable-ledger
   plumbing already in `run-store-fs.ts` / `safe-path.ts` / `publish-atomic.ts`
   (`SafeRunPath`, staging→fsync→rename). One ledger per planning space is the natural
   grain (`AssociationLedger` already carries `planningSpaceId` + `projectId`).
2. **Launch wiring.** `resolveRuntime` derives `ChangeInstanceId` **from the registry**:
   stat the **Change directory** (`<projectRoot>/<WORKSPACE_DIR_NAME>/changes/<changeId>`)
   for `physicalIdentity`, then `bindActiveAssociation(ledger, { changeId, alias,
   physicalIdentity })`. Active matching instance → reuse; archive-then-recreate (new
   dir → new inode) → mint a NEW instance → NEW RunId. No more `statSync(projectRoot)`.
3. **Archive wiring.** The archive path calls `archiveAssociation` to move the old
   instance to the archive alias (state `active`→`archived`). Identify the exact archive
   call site (the Run's archive action completion, and/or `rasen archive` / the archive
   skill's relocate step) — consult `design.md` §3 lines 700-706 and the archive skill.
4. **engine-ownership guard** (`src/core/change-run/internal/engine-ownership.ts`)
   consults the registry (bilateral ownership + archive state) instead of/in addition
   to its current probes.
5. **Ambiguity detection.** Multiple historical same-key instances (no active source,
   >1 archived same-`changeId`) → throw `launch_instance_ambiguous` with candidate
   PlanningSpaceIds. Do NOT silently pick the first.
6. **Gap D convergence.** `assertChangeNotArchived` reads the registry's `state`; keep
   fs as fallback if useful, registry authoritative.
7. **Identity chain.** PlanningSpaceId (registered home) → ChangeInstanceId (registry)
   → RunId, fully deterministic; after archive the old Run stays exactly inspectable,
   a same-name recreate starts a new Run, and mutations on the old Run are refused
   (`change_instance_inactive`).

## Stacked-PR / spec subtlety (READ before writing the delta spec)

`ecp-change-run-runtime` is **NOT in main specs** — it is introduced by `ecp-run-spine`
's delta (`rasen/changes/ecp-run-spine/specs/ecp-change-run-runtime/spec.md`). The
behavior scenarios Gap E is about **already exist** in that delta:
- `spec.md:122` "Same-name recreation has a new launch scope"
- `spec.md:134` "start fails `launch_instance_ambiguous`"
- `spec.md:1175` "Old Run cannot target same-name recreation"
- `spec.md:1114` "archive completion race same-name recreation"

So the **user-facing behavior is already specified**; Gap E is an
**implementation/deployment gap**, not a spec gap. Our delta spec is a **MODIFIED**
`ecp-change-run-runtime` that strengthens the *production contract* behind those
scenarios (the registry is persisted and is the source of truth; ChangeInstanceId is
derived from the Change directory's proven physical identity via the registry, not the
project root). Do NOT duplicate the existing scenarios. Do NOT touch
`rasen/changes/ecp-run-spine/**` (shipped). Because the base capability is not yet in
main specs, `rasen validate --changes` may flag the MODIFIED base as missing during
development — that is expected in a stacked-PR context and resolves once
`ecp-run-spine` merges first; note it but proceed.

## Validation — the integrity bar (EVERY item via the real production surface)

- `pnpm exec vitest run test/core/change-run/` all green (existing 305 + new tests).
- **Real-process E2E** via `test/helpers/run-cli.ts` `runCLI` (spawns
  `node dist/cli/index.js`): `pipeline start` → archive → same-name recreate → assert
  **new RunId ≠ old RunId**; old Run still readable via `status`; `complete --run
  <oldRunId>` rejected (through the registry, NOT the fs heuristic).
- **Two archived generations, same key** → `launch_instance_ambiguous`.
- **Dogfood no-regression**: `test/commands/pipeline-bugfix-e2e.test.ts` (15.3)
  end-to-end through the gate.
- `pnpm exec tsc --noEmit` clean; `pnpm exec eslint src/core/change-run/` clean.

## Conventions / gotchas

- **Build before spawn tests**: `runCLI` spawns `node dist/cli/index.js`. After ANY CLI
  source change, run `pnpm run build` before the spawn-based E2E tests, or they test a
  stale dist (documented Wave-4a gotcha).
- **Env isolation in spawn tests**: set `XDG_DATA_HOME` to a temp dir + `RASEN_HOME:''`
  so the store root resolves under the temp XDG (`<XDG_DATA_HOME>/rasen/runs/`). The
  association ledger must live under the SAME resolved home so the real production path
  is exercised.
- **Two kernel-internal operations have no CLI command** (documented gap, NOT a bypass):
  gate-wait commitment and effect observation need in-process helpers against the fs
  store. Reuse `commitGateWaits` / `observeAdmittedEffects` from the Wave-4a helpers if
  the recreate E2E needs to drive a Run to completion.
- **1M-window probe false positive**: `rasen agent context --latest` reports
  `limit:200000`; real occupancy ≈ `contextTokens/1_000_000`.
- **Cross-platform**: use `path.join`/`path.resolve`, never hardcoded slashes; the
  physical-identity codec is already cross-platform (POSIX device/inode/birth vs
  Windows volume/fileIndex/creation). Windows file-index may be partial without
  elevation → surfaces as drift, not a silent wrong match (documented).
- **LEAD owns `tasks.md` checkboxes and `auto-run.json`** — workers report completed
  task IDs; LEAD checks them off after verification.

## Architecture pointers (consume, don't rewrite)

- Kernel: `src/core/change-run/internal/{association-registry,identity,runtime-context,
  facade-runtime,engine-ownership,run-store-fs,safe-path,publish-atomic,projector}.ts`.
- Public barrel: `src/core/change-run/index.ts`.
- CLI: `src/commands/pipeline.ts` (`resolveRuntime` :489, `assertChangeNotArchived`
  :791, callers :990/:1047).
- Facade: `src/core/change-run/facade.ts` (start/resume/complete/inspect/control;
  `launch_instance_ambiguous` :56).
- Identity: `src/core/change-run/internal/identity.ts` (`derivePlanningSpaceId`,
  `deriveChangeInstanceId`, `readPhysicalIdentity`, `deriveRunId`).
- Project home: `resolveProjectHome(projectRoot, { ensure })` — the registered
  machine home (e.g. `autonomy-ladder-1e42477e`).
- Design authority: `rasen/changes/ecp-run-spine/design.md` §1 (identities, :480-563),
  §3 (association ledger + store, :680-940), §10 (engine ownership, :1596-1689).
- Kernel proof to extend (not replace): `test/core/change-run/archive-recreate-journeys.test.ts`.
