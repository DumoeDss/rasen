## Context

`ecp-run-spine` (0.1.6, PR #92) introduced a complete ChangePipelineRuntime
kernel including an `association-registry.ts` that implements distinct-
ChangeInstance-on-recreate. The kernel tests (`archive-recreate-journeys.test.ts`,
`association-registry.test.ts`) pass — but production never calls the registry.
This change is the deployment of that registry to the real launch/archive/
inspect path. The design authority is `rasen/changes/ecp-run-spine/design.md`
§1 (lines 480-563), §3 (lines 680-940), §10 (lines 1596-1689).

Verified source-state in this worktree (base `feat/0.1.6-executable-composite-
pipelines` @ `bcab92ad`):

- `src/core/change-run/internal/association-registry.ts` (274 lines) implements
  `bindActiveAssociation`, `archiveAssociation`, `findAssociationByAlias` over
  an immutable append-only `AssociationLedger` (format
  `change-association-ledger/1`). Pure in-memory data structure: nothing
  persists it.
- `grep bindActiveAssociation|archiveAssociation src/` hits ONLY that file —
  zero production call sites.
- `src/commands/pipeline.ts:564-574` `resolveRuntime` derives
  `ChangeInstanceId` from `statSync(projectRoot)` — **the project root**, not
  the Change directory. Archiving a Change and recreating the same name leaves
  the project root inode unchanged → same `ChangeInstanceId` → same `RunId` →
  the archived Run is silently reused.
- `src/commands/pipeline.ts:558-562` computes `planningSpaceHome =
  "project-${sha256(projectRoot).slice(0,12)}"` — a path hash, not the
  registered home. Spec line 250 of the base delta already requires
  "PlanningSpaceId SHALL derive from the persisted registry home name rather
  than projectId or an absolute path" — production violates this.
- `src/commands/pipeline.ts:791-828` `assertChangeNotArchived` (callers at
  `:990` before `complete`, `:1047` before `control`) uses a filesystem
  heuristic: checks `rasen/changes/<id>/` (active) vs `<home>/archive/*-<id>/`
  (archived). Gap D.
- `src/core/change-run/facade.ts:56` `launch_instance_ambiguous` is in the
  error union but never thrown.
- `src/core/change-run/internal/projector.ts:159` hardcodes
  `sourceState: 'active'` in the detail projection; only the list endpoint
  computes the real state.
- `src/core/change-run/internal/engine-ownership.ts` consumes only
  `{ canonicalPresent, legacyPresent }` booleans — no instance-scoped
  comparison.
- The archive operation exists as `HostActionInput.operation: 'archive'`
  (`src/core/change-run/internal/actions.ts:78`); the rasen-archive-change
  skill performs the relocate via `src/core/change-work.ts` →
  `resolveProjectHome(...).archiveDir`. No path calls `archiveAssociation`.

Kernel primitives available for reuse (do NOT rewrite):

- `src/core/change-run/internal/identity.ts`:
  `derivePlanningSpaceId(home)`, `deriveChangeInstanceId(planningSpaceId,
  changeId, physicalIdentity)`, `readPhysicalIdentity(stat)`,
  `digestPhysicalIdentity`, `encodePhysicalIdentity` (POSIX/Windows codec).
- `src/core/change-run/internal/publish-atomic.ts`: `publishAtomic(plumbing,
  stagingPath, targetPath, bytes, fault?)` — staging→fsync→rename with
  O_EXCL semantics, idempotent on present target.
- `src/core/change-run/internal/safe-path.ts`: `assertSafeRunPath(root,
  target, plumbing)`, `assertSafeSameParentCreate(parent, name, plumbing)`.
- `src/core/change-run/internal/run-store-fs.ts`:
  `createFilesystemRunStore(rootDir)` shares the immutable-revision + staging
  pattern; `FILESYSTEM_PLUMBING` is the production `PublishPlumbing` adapter.
- `src/core/project-home.ts`: `resolveProjectHome(projectRoot, { ensure })`
  → `ProjectHome { projectId, name, mode, homeDir, archiveDir, ... }` where
  `homeDir = <globalDataDir>/projects/<home>` and `<home>` is the persisted
  registry entry name (e.g. `autonomy-ladder-1e42477e`).

## Goals / Non-Goals

**Goals**

1. Persist the `AssociationLedger` at the machine home with the same
   staging→fsync→rename atomicity contract as the RunStore.
2. Wire `resolveRuntime` to derive `ChangeInstanceId` from the Change
   directory's physical identity via the registry.
3. Wire the archive path to call `archiveAssociation`.
4. Throw `launch_instance_ambiguous` on multiple historical same-key
   instances.
5. Make `assertChangeNotArchived` consult the registry authoritatively
   (Gap D convergence).
6. Make `projector.ts` reflect the registry's real `sourceState`.
7. Make `engine-ownership.ts` consult the registry's instance state.
8. Prove every goal through the **real production surface** (real CLI
   processes via `runCLI`), not kernel fixtures alone.

**Non-Goals**

- Redesigning kernel semantics. `bindActiveAssociation`,
  `archiveAssociation`, `AssociationLedger`, and the identity codecs are
  already done and tested — this change consumes them as-is.
- ReviewCycle, Composite/BoundedLoop execution, GoalLoop, FanOut/Join —
  out of scope (same as the parent `ecp-run-spine` Non-Goals).
- Forcing the prompt-owned `auto-run.json` writer through the registry.
  The boundary documented in design §10 holds: if a legacy file appears
  after reconciler launch, both engines refuse to advance.
- Cross-workspace administrative mutation (out of scope for the parent
  slice; still out of scope here).
- Stronger adversarial same-user protection against a nanosecond junction
  swap (documented exclusion in design §3 lines 743-749).

## Decisions

### 1. Persist the association ledger one level above the RunStore root,
   reusing the kernel's atomic-publish plumbing

**Decision.** The persisted ledger lives at:

```text
<homeDir>/association/
  ledger-v1.json                       # latest committed ledger (whole-file)
  ledger-v1.json.staging               # crash residue; head filter ignores
```

where `<homeDir> = resolveProjectHome(projectRoot, { ensure }).homeDir`
(e.g. `~/.rasen/projects/autonomy-ladder-1e42477e/`). The grain is **one
ledger per planning space** (the `AssociationLedger` already carries
`planningSpaceId` and `projectId`, so a single file per home is correct).
The ledger is a JSON serialization of the latest `AssociationLedgerRevision`'s
associations plus the header (`format`, `planningSpaceId`, `projectId`,
`revision`, `previousDigest`, `digest`). The store:

1. Acquires the association lease
   `H("instance-association/1", PlanningSpaceId, changeId)` (specified at
   design §3 lines 847-865 — reuse the same `OwnershipSafeLock` Adapter
   used by the engine/create/commit locks).
2. Rereads the latest file (or seeds an empty `createAssociationLedger` on
   first use).
3. Calls the existing pure `bindActiveAssociation` /
   `archiveAssociation`. The pure function returns the next ledger value.
4. Publishes the new revision via `publishAtomic` with the same
   `FILESYSTEM_PLUMBING` the RunStore uses: stage to `ledger-v1.json.staging`,
   `fsync`, rename onto `ledger-v1.json` with O_EXCL semantics. A crash at
   any boundary leaves only staging residue; the next reader ignores the
   `.staging` suffix and retries cleanly.
5. Releases the lease.

The complete revision history is recoverable from the ledger's own
`previousDigest` chain; on-disk we keep only the latest whole-file snapshot
(the RunStore pattern). A published ledger file with a broken `previousDigest`
chain, mismatched `planningSpaceId`/`projectId`, or unrecognized `format` is
`run_store_corrupt` (typed failure, no semantic use).

**Alternative considered.** One file per revision (`ledger-v<revision>.json`,
matching the RunStore's per-revision grain). Rejected because the
association ledger is orders of magnitude smaller than a Run Record and is
rewritten far less frequently; a single latest-file keeps read cost at O(1)
without sacrificing the immutability proof (the digest chain still makes any
silent rewrite detectable).

**Alternative considered.** SQLite. Rejected for the same reasons design §3
rejected it for the Run Record: a new dependency, harder crash-injection
testing, and no benefit at this scale.

### 2. Launch wiring: stat the Change DIRECTORY, consult the registry

**Decision.** `resolveRuntime` (`src/commands/pipeline.ts:489-608`)
changes its identity-derivation block to:

1. Resolve the registered home: `const home = await resolveProjectHome(
   projectRoot, { ensure: true })`. Use `home.home` (the persisted registry
   entry name) — NOT `home.projectId` and NOT a hash of `projectRoot` — as
   the input to `derivePlanningSpaceId`. This satisfies base spec line 250.
   `storeRoot` continues to resolve under `<home.homeDir>/runs/` (was
   `<getGlobalDataDir()>/runs/`; now correctly per-home).
2. Stat the **Change directory** (`path.join(projectRoot,
   WORKSPACE_DIR_NAME, 'changes', changeId)`) — not the project root. For
   an active Change this directory exists; for a historical/archived
   instance the path does not exist and `bindActiveAssociation` /
   `findAssociationByAlias` use the stored `physicalIdentityDigest` from
   the ledger instead.
3. Build the alias from the workspace-relative path: `changes/<changeId>`
   (POSIX form, the registry's `assertAlias` grammar).
4. Call `bindActiveAssociation(ledger, { changeId, alias,
   physicalIdentity })`:
   - **active match** (same `changeId`, same physical identity, same
     alias) → `disposition: 'reused'`, use that `instanceId`.
   - **no active match + fresh directory** → `disposition: 'bound'`, new
     `ChangeInstanceId` is minted and persisted in the same call.
   - **active match with conflicting physical identity/alias** → typed
     `active_instance_conflict` (existing kernel code path).
   - **physical identity already bound to a different `changeId`** →
     typed `physical_identity_conflict` (existing kernel code path).
5. If `bindActiveAssociation` did not find an active source, before
   minting, look up historical same-key accepted Runs. If more than one
   historical instance matches, throw `launch_instance_ambiguous` with
   the candidate instance/Run list (design §3 lines 796-801).

The `launchRequestId`, `launchRequestDigest`, and `runId` derivations are
unchanged — they already take `changeInstanceId` as input. After (4) the
`changeInstanceId` is now the registry's answer, so `runId` is correct.

**Why this is safe.** The existing `assertMutationAllowed` hook on the
facade-runtime (`src/core/change-run/internal/facade-runtime.ts:40-48`) is
unchanged — the CLI still calls `assertChangeNotArchived` before `complete`
and `control`. What changes is that the guard now consults the authoritative
registry state instead of guessing from the filesystem.

### 3. Archive wiring: call archiveAssociation on the runtime archive Action
   completion

**Decision.** Two call sites, both required:

1. **Runtime archive Action completion** — when a `HostActionInput` with
   `operation: 'archive'` is completed through `facade.complete(...)`,
   before the receipt returns, the runtime (or the CLI layer that drives
   it) calls `archiveAssociation` with the Change directory's pre-archive
   physical identity, the active alias, and the verified archive alias
   (the `*-<changeId>` directory name under `<home>/archive/`). This
   moves the instance to `state: 'archived'` and appends the archive
   alias to its `archiveAliases`. The lease taken in Decision 1 covers
   this mutation.
2. **`rasen archive` / the archive skill's relocate step** — when the
   archive skill relocates the Change directory via `change-work.ts`, it
   invokes the same `archiveAssociation` call with the pre-relocate
   physical identity. This covers the case where the archive skill runs
   outside a reconciler Run.

The two call sites converge on the same lease
(`H("instance-association/1", PlanningSpaceId, changeId)`), so concurrent
archive-versus-recreate serializes exactly as design §3 lines 928-931
specifies.

**Identifying the exact call site.** The runtime archive Action is the
`HostActionInput { operation: 'archive' }` carried inside the
`change-run-action-host/1` payload (see `src/core/change-run/internal/
actions.ts:77-80`). The completion flows through
`facade-runtime.ts` → `assertMutationAllowed` (currently a no-op when
the CLI omits it) → the reducer. The clean wiring is to add an
`assertMutationAllowed` implementation in the CLI's `complete` path that,
when the completed action is the archive host action, performs the
`archiveAssociation` ledger mutation **after** the Run Record commits
and **before** the receipt is returned. For the archive skill path, the
call sits next to the existing relocate in `change-work.ts`.

**Alternative considered.** Single call site at the skill layer only.
Rejected because the runtime archive Action is a first-class operation
in the Run Record (the whole point of the `operation: 'archive'` enum)
and a Run that completes an archive action in a fresh process must not
depend on the skill having run.

### 4. Engine-ownership consults the registry's instance state

**Decision.** `classifyEngineOwnership` and `assertSingleEngineOwner`
(`src/core/change-run/internal/engine-ownership.ts`) currently take
`{ canonicalPresent, legacyPresent }` booleans. They will additionally
take an optional `instanceState` (`'active' | 'archived' | 'missing'`)
resolved from the registry. A legacy artifact read from a verified
archive alias is bound to that alias's proven instance — it is NOT
silently assigned to a same-name recreation. An older machine-home
legacy artifact with no provable instance binding remains
`legacy_owner_unknown` (existing behavior). This is the precise wording
of design §10 lines 1652-1660.

### 5. `launch_instance_ambiguous` finally thrown

**Decision.** The `ChangeRunRuntimeErrorCode` `'launch_instance_ambiguous'`
is already in the union (`src/core/change-run/facade.ts:56`). The launcher
(Decision 2 step 5) throws `new ChangeRunRuntimeError('launch_instance_
ambiguous', message, currentView?)` when no active source exists AND
more than one historical same-key instance has an accepted Run. The
`currentView` is omitted (no Run is selected). The error message lists
the candidate `(ChangeInstanceId, RunId)` pairs so the user can supply
an exact `--run` to disambiguate.

### 6. Gap D convergence: `assertChangeNotArchived` consults the registry

**Decision.** `src/commands/pipeline.ts:791-828` currently uses the
filesystem heuristic (active = `rasen/changes/<id>/` exists; archived =
`<home>/archive/*-<id>/` exists). The new path:

1. Resolve the registry for the `(planningSpaceId, changeId)` pair.
2. If an `active` association exists for the current physical Change
   directory → mutation allowed (existing path).
3. If only `archived` associations exist → throw `change_instance_inactive`
   (typed, no filesystem walk).
4. If the registry is unreadable or the association is `missing` →
   fall back to the existing filesystem heuristic. This keeps the
   behavior unchanged for unrecognized/unregistered cases and means a
   corrupt registry never widens the mutation surface.

This closes Gap D because the **same root cause** (no durable instance
record) produced both the launch bug and the archive-state guess.

### 7. Identity chain: PlanningSpaceId (registered home) →
   ChangeInstanceId (registry) → RunId

**Decision.** After Decisions 1–6, the identity chain is fully
deterministic and matches the design:

- `PlanningSpaceId = H("planning-space/1", registryEntry.home)` — the
  persisted home name from `resolveProjectHome`. Stable across linked
  worktrees, project moves, and `RASEN_HOME` relocation; two clones
  remain distinct.
- `ChangeInstanceId = H("change-instance/1", PlanningSpaceId, changeId,
  canonicalPhysicalChangeDirIdentity)` — derived by the registry's
  `bindActiveAssociation` from the **Change directory's** inode/volume
  identity. Same-name recreate → new directory → new identity.
- `RunId = H("run", PlanningSpaceId, ChangeInstanceId, changeId,
  launchRequestId)` — already takes the registry's `changeInstanceId`.

After archive, the old Run stays inspectable (the RunStore file is
immutable); a same-name recreate mints a new instance → new RunId; and
mutations on the old Run are refused (`change_instance_inactive`) because
the registry reports the old instance as `archived`.

### 8. Projector reflects real sourceState

**Decision.** `src/core/change-run/internal/projector.ts:159` removes
the hardcoded `sourceState: 'active'` and accepts the registry-resolved
state as an input to `projectRunView`. The list endpoint already computes
the real state; the detail path now does the same lookup. `inspect` on
an archived Run reports `sourceState: 'archived'`; on a manually-moved
source, `sourceState: 'missing'` (registry has no binding for the new
physical directory).

## Platform behavior (POSIX vs Windows)

The identity codec (`encodePhysicalIdentity` in `identity.ts:331-359`) is
already cross-platform:

- **POSIX**: `{ platform: 'posix', device, fileIndex, birthIdentity }`
  encoded as 25 bytes (tag + 3 × u64 big-endian). `device` + `fileIndex`
  together identify the inode on a single volume; `birthIdentity` is the
  birthtime in nanoseconds. Same-volume rename (the archive relocate)
  preserves all three fields → same identity.
- **Windows**: `{ platform: 'windows', volume, fileIndex, creationIdentity }`
  where `volume` is the volume serial, `fileIndex` is the file index, and
  `creationIdentity` is the creation time in nanoseconds. Same-volume
  rename on NTFS preserves all three.

**Documented limitation.** On Windows, `stat.ino` (mapped to `fileIndex`)
may be partial without elevation. The codec still encodes it; an
unreadable or partial value surfaces as identity drift across processes
(the registry's `physicalIdentityDigest` comparison fails), not as a
silent wrong match. The launcher re-reads physical identity around every
bind, so drift fails closed.

Cross-volume copy (a manual `mv` across volumes, or an OS-level backup
restore) produces a new identity by design — design §1 lines 497-507
classify this as `missing`/new, never guessed. The registry does not
attempt to match the new directory to the old instance.

## Risks / Trade-offs

- **Risk**: Single-file ledger loses per-revision history on disk.
  **Mitigation**: the `previousDigest` chain inside the ledger makes any
  silent rewrite or truncation detectable on the next load; the same
  immutability proof the RunStore uses. A broken chain fails
  `run_store_corrupt`.
- **Risk**: Two processes race the same bind; the second sees a stale
  ledger and overwrites.
  **Mitigation**: the `H("instance-association/1", PlanningSpaceId,
  changeId)` lease (design §3 lines 847-865) serializes every
  association mutation. The publish is O_EXCL; a contender that loses
  the rename race re-reads and retries the whole bind under the lease.
- **Risk**: A corrupted registry widens the mutation surface
  (mutations allowed through the fallback).
  **Mitigation**: the filesystem fallback in Decision 6 step 4 is
  strictly the *current* behavior. A corrupt registry never makes
  mutations *more* permissive than today; it only removes the new
  typed refusal for confirmed-archive cases.
- **Risk**: Stacked-PR validation noise.
  **Mitigation**: the base capability `ecp-change-run-runtime` is not
  yet in main specs; `rasen validate --changes` may flag the MODIFIED
  base as missing during development. This is expected and resolves
  once `ecp-run-spine` merges first. Note in the PR description.
- **Risk**: The `rasen archive` skill runs outside a Run and does not
  know the `ChangeInstanceId` to archive.
  **Mitigation**: the archive skill path resolves the active association
  for `(planningSpaceId, changeId)` from the registry, which carries
  the `instanceId`. If no active association exists, the skill is a
  no-op on the registry (the Change is already archived or never had a
  Run); the relocate still happens on the filesystem.
- **Risk**: Real-process E2E (`runCLI`) hides a stale dist.
  **Mitigation**: tasks.md includes an explicit "build dist before spawn
  tests" task. Documented Wave-4a gotcha.
- **Trade-off**: We do NOT add a native `openat`/Windows `CreateFile`
  handle-relative check in this change. The pure-Node same-user race
  boundary stays as documented in design §3 lines 743-749. Stronger
  adversarial same-user protection requires a reviewed native SafeFs
  Adapter and dedicated Windows CI — a separate change.

## Migration Plan

No data migration. Existing Runs on disk were created under the old
`statSync(projectRoot)` identity; their `ChangeInstanceId` values are
encoded in the RunStore but the **registry** has no entry for them.
Behavior on first launch after this change:

1. The launcher resolves `planningSpaceId` from the registered home (may
   differ from the old path-hash `PlanningSpaceId`).
2. The launcher stats the active Change directory and calls
   `bindActiveAssociation`. For an active Change with no prior ledger
   entry, this mints a **new** `ChangeInstanceId` (correct: it is the
   first canonical launch under the registry).
3. A subsequent `start` with the same textual launch key mints a new
   `RunId` (because the inputs include the new `ChangeInstanceId`). The
   pre-existing RunStore directory for the same `changeId` remains
   readable via `pipeline status --run <oldRunId>` because the RunStore
   is keyed by `runId` alone; inspect does not require an active source
   (design §3 lines 690-697, spec line 1148).

This is a known one-time discontinuity. It surfaces only for Runs
created before this change against an active Change; afterward, the
identity chain is stable. Documented in the PR description.

**Rollback.** Revert the change. Existing Runs remain readable; new
launches return to the path-hash + project-root identity. No data is
lost.

## Open Questions

- Should the runtime archive Action completion path perform the
  `archiveAssociation` call inside the reducer (so the ledger mutation
  is part of the canonical Record commit) or in the CLI `complete`
  command (after the Record commits)? The design above chooses the CLI
  path for separation of concerns; the reducer stays pure. Confirm at
  implementation time.
- For an active Change with no prior ledger entry, should the first
  `start` attempt to retroactively bind the pre-existing Run's
  `ChangeInstanceId` (computed from the old project-root identity)?
  Default: no — a new identity is correct and simpler. Confirm.
