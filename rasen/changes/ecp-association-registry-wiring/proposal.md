## Why

`ecp-run-spine` shipped (PR #92, 0.1.6) with the distinct-ChangeInstance promise
**specified but not deployed**: the kernel's association registry implements
archive-then-recreate as a NEW instance, but production never calls it. The CLI
derives `ChangeInstanceId` from `statSync(projectRoot)` — the project root — so
archiving a Change and recreating the same name produces the **same** identity,
silently reusing the archived Run. This is the integrity hotspot that slipped
through last time ("kernel tested, production unwired"). Users cannot trust
Run history while that gap exists, and the `launch_instance_ambiguous` contract
has never fired in production. This change deploys the registry to the real
launch/archive/inspect path and proves it through real CLI processes.

## What Changes

- The **association registry is persisted** at the registered machine home
  (alongside the RunStore root) as one immutable, append-only revision ledger
  per planning space. It is the source of truth for ChangeInstance identity and
  active/archived state.
- The CLI launcher derives `ChangeInstanceId` from the **Change directory's**
  proven physical identity (device/inode on POSIX; volume/file index plus
  creation on Windows) via the registry — not the project root. Archiving a
  Change and recreating the same name creates a new directory → new identity →
  a NEW Run, exactly as the spec already requires.
- `PlanningSpaceId` is derived from the **registered home name** (e.g.
  `autonomy-ladder-1e42477e`), replacing the path-hash placeholder used today.
  Two independently registered clones remain distinct even when they share a
  display `projectId`.
- The archive path calls `archiveAssociation` to move the old instance into the
  archive alias (`state: active → archived`). The old Run stays exactly
  inspectable; the next same-name `start` mints a fresh instance.
- When no active source exists and multiple historical same-key instances have
  accepted Runs, `start` throws `launch_instance_ambiguous` with the candidate
  Run/instance list — it never silently picks one.
- Run-state mutations (`complete`/`control`) consult the registry's authoritative
  `state` before allowing the mutation; the filesystem heuristic remains only
  as a fallback. This closes Gap D in the same change (same root cause: no
  durable instance-state record).
- `pipeline status <runId>` detail projection reflects the registry's real
  `sourceState` (active/archived/missing) instead of a hardcoded `active`.
- Engine ownership classification consumes the registry's instance state so a
  legacy artifact read from a verified archive alias is bound to its proven
  instance, not to a same-name recreation.

## Capabilities

### New Capabilities

<!-- None. This change deploys an already-specified capability; it adds no new spec. -->

### Modified Capabilities

- `ecp-change-run-runtime`: The base capability is introduced by the stacked
  `ecp-run-spine` delta (not yet in main specs). The user-facing behavior
  scenarios for distinct-instance-on-recreate, `launch_instance_ambiguous`,
  archived Runs remaining inspectable, and old Runs refusing same-name
  recreation **already exist** there and are not duplicated. This change
  strengthens the **production contract** behind them: the association registry
  is PERSISTED at the machine home and is the source of truth for
  ChangeInstance identity and active/archived state; `ChangeInstanceId` is
  derived from the Change directory's proven physical identity via the
  registry (not the project root); `PlanningSpaceId` derives from the
  registered home name. Because the base is not yet in main specs, validation
  may flag the MODIFIED base as missing during development — that is expected
  in a stacked-PR context and resolves once `ecp-run-spine` merges first.

## Impact

- **Kernel**: a new persistence wrapper over the existing
  `association-registry.ts` ledger (reuses `SafeRunPath` containment,
  `publishAtomic` staging→fsync→rename, and the same `OwnershipSafeLock` /
  association lease `H("instance-association/1", PlanningSpaceId, changeId)`
  already specified in `ecp-run-spine` design §3). The pure kernel functions
  (`bindActiveAssociation`, `archiveAssociation`, `findAssociationByAlias`) are
  unchanged — this change adds the disk layer and the production call sites.
- **CLI wiring** (`src/commands/pipeline.ts`): `resolveRuntime` switches from
  `statSync(projectRoot)` to stat the Change directory and consult the
  registry; `assertChangeNotArchived` consults the registry authoritatively
  (callers at the `complete` and `control` entry points); `PlanningSpaceId`
  derives from `resolveProjectHome(...).home` rather than the path hash.
- **Facade/projector/engine-ownership**: `projector.ts` removes the hardcoded
  `sourceState: 'active'` and projects the registry's real state;
  `engine-ownership.ts` consumes the registry's binding for instance-scoped
  ownership comparison; `launch_instance_ambiguous` is finally thrown from the
  launcher.
- **Archive call site**: the runtime archive Action's completion (and/or the
  archive skill's relocate step) calls `archiveAssociation` before downstream
  source-targeting work is admitted.
- **Platform behavior**: POSIX device/inode and Windows volume/file-index
  codecs are already cross-platform in `identity.ts`. Same-volume rename (the
  archive relocate) preserves physical identity; cross-volume copies surface
  as `missing`/new. Windows file-index may be partial without elevation —
  documented as drift, not a silent wrong match.
- **Tests**: extend the kernel proof at `test/core/change-run/
  archive-recreate-journeys.test.ts`; add a **real-process E2E** through
  `runCLI` (`node dist/cli/index.js`) that starts a Run, archives, recreates
  the same name, and asserts a NEW RunId with the old Run still inspectable;
  add an ambiguous-history case; keep `pipeline-bugfix-e2e.test.ts` green.
