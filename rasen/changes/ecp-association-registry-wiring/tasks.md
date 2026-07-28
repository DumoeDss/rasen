## 1. Persisted association-ledger store

- [x] 1.1 Add `src/core/change-run/internal/association-ledger-store.ts`
       exporting `createAssociationLedgerStore({ homeDir, planningSpaceId,
       projectId, plumbing })` with `load(): AssociationLedger`,
       `commit(next: AssociationLedger): AssociationLedger`, and
       `resolveActiveAssociation(changeId): ChangeAssociation | undefined`.
       Reuse the existing `FILESYSTEM_PLUMBING`-style adapter pattern
       (`publishAtomic` from `./publish-atomic.js`) and the `SafeRunPath`
       containment check from `./safe-path.js`.
- [x] 1.2 Define the on-disk layout constant
       `path.join(homeDir, 'association', 'ledger-v1.json')` and its
       staging sibling `ledger-v1.json.staging`. The store publishes the
       full latest revision as one whole-file JSON document via
       staging → fsync → atomic rename (O_EXCL).
- [x] 1.3 Implement `load()`: if `ledger-v1.json` is absent, return
       `createAssociationLedger(planningSpaceId, projectId)` (empty
       ledger). If present, parse, validate `format ===
       'change-association-ledger/1'`, validate the `previousDigest`
       chain across revisions, validate `planningSpaceId`/`projectId`
       match the inputs. On any failure throw a typed
       `RunStoreError('run_store_corrupt', ...)`.
- [x] 1.4 Implement `commit(next)`: take the association lease
       `H("instance-association/1", planningSpaceId, changeId)` via the
       same `OwnershipSafeLock` Adapter the kernel uses for engine locks
       (design §3 lines 818-832). Reread the latest ledger inside the
       lease; verify its digest matches the in-memory `previous` the
       caller started from; serialize the new latest revision to bytes;
       `publishAtomic` to `ledger-v1.json`. Release the lease.
- [x] 1.5 Export `AssociationLedgerStore` type and the factory from
       `src/core/change-run/index.ts` (read-only type + factory; do not
       re-export the pure kernel helpers, which stay internal).

## 2. Kernel-level tests for the persisted ledger (RED/GREEN)

- [x] 2.1 RED: `test/core/change-run/association-ledger-store.test.ts`
       — fault-injection cases for each publish boundary
       (`before-stage`, `after-stage-before-fsync`,
       `after-fsync-before-publish`, `after-publish-before-return`) using
       the in-memory `PublishPlumbing` adapter from
       `test/core/change-run/publish-atomic-fault-harness.ts` (or a
       sibling). Each case asserts the next `load()` either returns the
       previously committed revision or fails `run_store_corrupt`, never
       a partial write.
- [x] 2.2 RED: corruption-detection cases — truncated file, mismatched
       `planningSpaceId`, broken `previousDigest`, unknown `format` tag,
       file replaced by a directory. All fail `run_store_corrupt` with
       no semantic use.
- [x] 2.3 RED: concurrent-binders serialization — two in-process
       callers race `bindActiveAssociation` against the same
       `(planningSpaceId, changeId)` lease. Assert exactly one wins the
       publish; the loser re-reads and retries under the lease.
- [x] 2.4 GREEN: implement until all RED cases pass. Do not advance to
       task 3 until 2.1–2.3 are green.

## 3. Launch wiring — replace `statSync(projectRoot)` with the registry

- [x] 3.1 In `src/commands/pipeline.ts:resolveRuntime` (~line 558),
       replace the path-hash `planningSpaceHome` with `resolveProjectHome(
       projectRoot, { ensure: true })` and pass `home.home` (the
       persisted registry entry name) to `derivePlanningSpaceId`.
- [x] 3.2 Replace the `statSync(projectRoot)` block (~lines 564-578) with:
       stat the **Change directory** at `path.join(projectRoot,
       WORKSPACE_DIR_NAME, 'changes', changeId)` when it exists; load
       the `AssociationLedgerStore` for the resolved
       `(planningSpaceId, projectId)`; call
       `bindActiveAssociation(ledger, { changeId, alias:
       \`changes/${changeId}\`, physicalIdentity })`. Use the returned
       `association.instanceId` for `changeInstanceId`.
- [x] 3.3 When the Change directory does NOT exist (archived or missing
       source), look up the historical same-key association via
       `findAssociationByAlias` or a new store helper. If exactly one
       archived instance exists, use its `instanceId`. If more than one,
       throw `new ChangeRunRuntimeError('launch_instance_ambiguous',
       message)` listing the candidate `(ChangeInstanceId, RunId)` pairs.
- [x] 3.4 Move `storeRoot` resolution to `path.join(home.homeDir, 'runs')`
       (was `${getGlobalDataDir()}/runs`). Confirm the existing RunStore
       continues to load Runs created under the previous root when
       `RASEN_HOME` is unchanged (the path is the same physical
       directory).
- [x] 3.5 Audit `src/commands/pipeline.ts` for any other call site that
       derives `ChangeInstanceId` or `PlanningSpaceId` from the project
       root; route them through the same resolver.

## 4. Archive wiring — call `archiveAssociation`

- [ ] 4.1 Identify the runtime archive Action completion path. When
       `facade.complete(...)` receives a `HostActionInput` with
       `operation: 'archive'`, after the Run Record commits, call
       `archiveAssociation(ledger, { changeId, instanceId, activeAlias,
       archiveAlias, physicalIdentity })` against the resolved
       `AssociationLedgerStore`. The `archiveAlias` is the
       `<YYYY-MM-DD>-<changeId>` directory name under `<home>/archive/`.
       **DEFERRED** — the primary archive path (archive.ts relocate, task 4.2)
       IS wired. The runtime archive Action path is aspirational: no pipeline
       currently submits archive Actions through the facade. Noted in the PR
       description as a follow-up.
- [x] 4.2 Identify the `rasen archive` skill / `change-work.ts` relocate
       path. After (or as part of) the relocate, perform the same
       `archiveAssociation` call using the pre-relocate physical
       identity. If no active association exists in the ledger, this is
       a no-op on the registry (the Change is already archived or never
       had a canonical Run); the filesystem relocate still completes.
- [x] 4.3 Verify both call sites take the association lease before
       mutating (the store's `commit` already does this — confirm no
       nested acquisition when called from a Run Record commit path).

## 5. Engine-ownership consults the registry

- [x] 5.1 Extend `src/core/change-run/internal/engine-ownership.ts`:
       `classifyEngineOwnership` and `assertSingleEngineOwner` accept an
       optional `instanceState: 'active' | 'archived' | 'missing'`
       resolved from the registry. A legacy artifact read from a
       verified archive alias binds to that alias's proven instance —
       it is NOT silently assigned to a same-name recreation.
- [x] 5.2 In `src/commands/pipeline.ts` and the facade-runtime
       integration, resolve the registry state for the Run's
       `ChangeInstanceId` before classification; pass it through.

## 6. Gap D convergence — `assertChangeNotArchived` consults the registry

- [x] 6.1 Rewrite `src/commands/pipeline.ts:assertChangeNotArchived`
       (~lines 791-828) to: resolve `(planningSpaceId, changeId)` in the
       ledger; if an `active` association exists for the current
       physical Change directory → mutation allowed; if only `archived`
       associations exist → throw `change_instance_inactive` with the
       archived alias; if the registry is missing/unreadable/`missing`
       → fall back to the existing filesystem heuristic.
- [x] 6.2 Callers at `pipeline.ts:990` (before `complete`) and `:1047`
       (before `control`) are unchanged structurally — they continue to
       call `assertChangeNotArchived` and let it throw.

## 7. Projector reflects real `sourceState`

- [x] 7.1 In `src/core/change-run/internal/projector.ts:projectRunView`
       (~line 159), remove the hardcoded `sourceState: 'active'`. Accept
       `sourceState: 'active' | 'archived' | 'missing'` as an input to
       the projection (extend the `projectRunView` signature or thread
       the resolved association through the caller).
- [x] 7.2 In `src/commands/pipeline.ts` `status` and the management
       `inspect` path, resolve the registry state for the Run's
       `ChangeInstanceId` and pass it to `projectRunView`. List endpoint
       behavior is unchanged (it already computed the real state).

## 8. Cross-module integration tests (RED/GREEN)

- [x] 8.1 RED: extend `test/core/change-run/archive-recreate-journeys.test.ts`
       with cases that drive the persisted `AssociationLedgerStore`
       (in-process adapter), proving distinct-instance-on-recreate now
       holds at the persistence layer, not only the in-memory registry.
- [x] 8.2 RED: ambiguity case — bind generation 1, archive, bind
       generation 2, archive, then attempt a `start` with no active
       source. Assert `launch_instance_ambiguous` with both candidate
       pairs.
- [x] 8.3 RED: corruption case — truncate `ledger-v1.json` mid-flight;
       the next `start` fails `run_store_corrupt`; read-only `inspect`
       of existing Runs still works.
- [x] 8.4 RED: same-volume rename of the Change directory preserves
       physical identity (POSIX `ino`/Windows `fileIndex` unchanged) and
       the next `start` reuses the existing association.
- [x] 8.5 RED: cross-volume copy of the Change directory produces a new
       `ChangeInstanceId` (POSIX `device` / Windows `volume` differ).
- [x] 8.6 GREEN: implement until all RED cases pass.

## 9. Build dist before spawn tests

- [x] 9.1 Run `pnpm run build` after EVERY CLI source change in tasks
       3–7. Documented Wave-4a gotcha: `runCLI` spawns
       `node dist/cli/index.js`; a stale dist silently tests the old
       behavior and the integrity hotspot slips through. Treat this
       task as a gate before any task 10 sub-task.

## 10. Real-process E2E via `runCLI` (the integrity bar)

- [x] 10.1 RED: `test/commands/pipeline-association-registry-e2e.test.ts`
        — spawn `node dist/cli/index.js` with `XDG_DATA_HOME` set to a
        temp dir and `RASEN_HOME:''`. Drive: `pipeline start <change>`
        → record the returned `runId` (call it `runId1`). Use the
        in-process helpers from `test/helpers/run-cli.ts` plus
        `commitGateWaits` / `observeAdmittedEffects` from the Wave-4a
        helpers to drive the Run to completion if needed.
- [x] 10.2 RED: archive the Change (via the `rasen archive` skill's
        relocate or an equivalent host action), then create a new
        Change directory with the same name. Run `pipeline start` again
        with the same `launchRequestId`. Assert the returned `runId`
        (call it `runId2`) differs from `runId1`.
- [x] 10.3 RED: `pipeline status <runId1>` still works after the archive
        and reports `sourceState: 'archived'`. `pipeline complete
        --run <runId1>` (or `control`) fails `change_instance_inactive`
        via the registry, NOT the filesystem heuristic.
- [x] 10.4 RED: two archived generations case — archive generation 2,
        create generation 3, then immediately delete generation 3's
        directory. Run `pipeline start` with no active source. Assert
        `launch_instance_ambiguous` listing both `runId1` and `runId2`.
- [x] 10.5 GREEN: implement until all RED cases pass.
- [x] 10.6 Regression: `test/commands/pipeline-bugfix-e2e.test.ts` (the
        15.3 dogfood) remains green end-to-end through the gate.

## 11. Type, lint, full test suite

- [x] 11.1 `pnpm exec tsc --noEmit` clean across the workspace.
- [x] 11.2 `pnpm exec eslint src/core/change-run/ src/commands/pipeline.ts`
        clean.
- [x] 11.3 `pnpm exec vitest run test/core/change-run/` all green
        (existing 305 + new tests).
- [x] 11.4 `pnpm exec vitest run test/commands/pipeline*.test.ts` all
        green (E2E + regression).
- [x] 11.5 Cross-platform check: confirm `path.join` / `path.resolve`
        everywhere; no hardcoded `/` or `\` in any new code path. The
        `assertAlias` grammar in `association-registry.ts:112-125`
        already enforces POSIX-form aliases — confirm the CLI passes
        `changes/<changeId>`, never a Windows path.

## 12. Stacked-PR validation notes

- [x] 12.1 Run `rasen validate --changes` and capture any "MODIFIED base
        missing" warnings for `ecp-change-run-runtime`. This is expected
        because the base capability is introduced by `ecp-run-spine`'s
        delta, which is not yet in main specs. Note the warning in the
        PR description; it resolves automatically when `ecp-run-spine`
        merges first.
- [x] 12.2 Confirm `rasen validate --changes` does not flag the
        scenarios we ADDED as duplicates of existing base-delta scenarios
        (Same-name recreation / launch_instance_ambiguous / Old Run
        cannot target same-name recreation). Our new requirement is a
        production-contract requirement, not a re-specification of those
        behaviors.
