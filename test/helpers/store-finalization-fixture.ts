/**
 * The `store-finalization-outcomes-v2` Module fixture.
 *
 * It layers exactly one thing on child 4's real-Git `store-workspace-fixture`:
 * a PREPARED and BOUND workspace pair with a seeded Change, which is the
 * minimum a finalization can run against. Nothing here is hand-assembled — a
 * fixture whose execution root is not a real Git work tree derives no execution
 * worktree identity, so it derives no `WorkspacePairId`, so every finalization
 * against it refuses with `workspace_pair_unavailable`. Real Git on BOTH sides
 * is a requirement, not a preference.
 *
 * The archive preparation this builds is the same shape `ArchiveCommand`
 * assembles before it hands off: the Module owns the finalization decision and
 * does not re-implement archive preparation, so a suite supplies the
 * preparation and asserts the decision.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PreparedArchiveSpecAction } from '../../src/core/archive-engine.js';
import { buildUpdatedSpec, findSpecUpdates } from '../../src/core/specs-apply.js';
import { resolveStorePlanningLayoutV2Path } from '../../src/core/store/planning-layout-v2.js';
import type { VerifiedChangeInstanceId } from '../../src/core/store/planning-identity.js';
import {
  ChangeFinalization,
  type ChangeFinalizationOptions,
  type FinalizationArchivePreparation,
  type FinalizeChangeInput,
} from '../../src/core/store/finalization/index.js';
import {
  productionFinalizationDependencies,
  withDeterministicFinalizationClock,
  type FinalizationDependencies,
} from '../../src/core/store/finalization/dependencies.js';
import { completeChangeBinding } from '../../src/core/store/workspace/module.js';
import {
  createStoreWorkspaceFixture,
  FIXTURE_NOW,
  type StoreWorkspaceFixture,
  type StoreWorkspaceFixtureOptions,
} from './store-workspace-fixture.js';

/** The archive date every fixture-built plan is stamped with. */
export const FIXTURE_ARCHIVE_DATE = '2026-08-07';

export interface BoundChangeSeed {
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeId: string;
  /** 32 lowercase hex characters. Distinct seeds give distinct Change instances. */
  readonly instanceSeed?: string;
}

export interface BoundChange {
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeId: string;
  readonly changeInstanceId: string;
  readonly workspacePairId: string;
  readonly planningWorktree: string;
  readonly executionWorktree: string;
  readonly changeDir: string;
  readonly archiveLine: string;
  readonly planningScopeId: string;
}

export interface StoreFinalizationFixture extends StoreWorkspaceFixture {
  /** Prepares a real worktree pair, seeds a Change into it, and binds the pair. */
  bind(seed: BoundChangeSeed): Promise<BoundChange>;
  /** A Module bound to this fixture's deterministic clock. */
  finalization(options?: ChangeFinalizationOptions): ChangeFinalization;
  dependenciesFor(overrides?: Partial<FinalizationDependencies>): FinalizationDependencies;
  /** The archive preparation `ArchiveCommand` would have assembled. */
  preparation(
    bound: BoundChange,
    overrides?: Partial<FinalizationArchivePreparation>
  ): FinalizationArchivePreparation;
  /** A complete `plan()` input for one bound Change. */
  planInput(
    bound: BoundChange,
    outcome: FinalizeChangeInput['outcome'],
    overrides?: Partial<FinalizeChangeInput>
  ): FinalizeChangeInput;
}

export async function createStoreFinalizationFixture(
  options: StoreWorkspaceFixtureOptions = {}
): Promise<StoreFinalizationFixture> {
  const base = await createStoreWorkspaceFixture({
    prefix: 'rasen-finalization-',
    ...options,
  });

  const dependenciesFor = (
    overrides: Partial<FinalizationDependencies> = {}
  ): FinalizationDependencies => ({
    ...withDeterministicFinalizationClock(productionFinalizationDependencies, FIXTURE_NOW),
    ...overrides,
  });

  const fixture: StoreFinalizationFixture = {
    ...base,

    async bind(seed) {
      const planningWorktree = base.beside(
        `planning-${seed.projectId}-${seed.changeId}`
      );
      const executionWorktree = base.beside(
        `execution-${seed.projectId}-${seed.changeId}`
      );
      const workspace = base.workspace();
      const plan = await workspace.plan({
        store: base.storeId,
        project: seed.projectId,
        targetLine: seed.targetLineId,
        startPath: base.storeRoot,
        globalDataDir: base.globalDataDir,
        changeId: seed.changeId,
        planningWorktree,
        executionWorktree,
      } as Parameters<ReturnType<StoreWorkspaceFixture['workspace']>['plan']>[0]);
      if (!plan.applicable) {
        throw new Error(
          `fixture could not prepare a pair for ${seed.changeId}: ${JSON.stringify(plan.blockers)}`
        );
      }
      await workspace.apply(plan.token!);

      const seeded = base.seedChange({
        root: planningWorktree,
        projectId: seed.projectId,
        targetLineId: seed.targetLineId,
        changeId: seed.changeId,
        ...(seed.instanceSeed === undefined ? {} : { instanceSeed: seed.instanceSeed }),
      });
      const completed = await completeChangeBinding(
        {
          storeUid: base.storeUid,
          storeId: base.storeId,
          projectId: seed.projectId,
          targetLineId: seed.targetLineId,
          planningScopeId: base.planningScopeId(seed.projectId, seed.targetLineId),
          changeId: seed.changeId,
          planningRoot: planningWorktree,
          globalDataDir: base.globalDataDir,
          changeInstanceId: seeded.instanceId,
        } as Parameters<typeof completeChangeBinding>[0],
        base.dependencies
      );
      const archiveLine = resolveStorePlanningLayoutV2Path(
        planningWorktree,
        {
          kind: 'archive-line',
          projectId: seed.projectId,
          targetLineId: seed.targetLineId,
        },
        'native'
      );
      return {
        projectId: seed.projectId,
        targetLineId: seed.targetLineId,
        changeId: seed.changeId,
        changeInstanceId: seeded.instanceId,
        workspacePairId: completed.workspacePairId as string,
        planningWorktree,
        executionWorktree,
        changeDir: seeded.directory,
        archiveLine,
        planningScopeId: base.planningScopeId(seed.projectId, seed.targetLineId),
      };
    },

    dependenciesFor,

    finalization(options: ChangeFinalizationOptions = {}) {
      return new ChangeFinalization({
        dependencies: dependenciesFor(),
        ...options,
      });
    },

    preparation(bound, overrides = {}) {
      return {
        planningRoot: bound.planningWorktree,
        executionRoot: bound.executionWorktree,
        activePath: bound.changeDir,
        archiveParent: bound.archiveLine,
        ephemeraPath: path.join(
          bound.executionWorktree,
          '.rasen',
          'changes',
          bound.changeId,
          'ephemera'
        ),
        date: FIXTURE_ARCHIVE_DATE,
        keepEphemera: false,
        validation: 'skipped',
        tasks: { total: 0, completed: 0, override: true },
        timing: { mode: 'on-merge', deliveryMode: null, override: true },
        specActionCandidates: [],
        hasDeltaSpecs: false,
        sidecar: {
          status: 'absent',
          schemaVersion: null,
          change: null,
          disposition: 'unjudged-preserve-all',
          handoff: { complete: null, decisions: [], inventory: [] },
          probes: [],
          blockers: [],
        },
        shipLog: {
          source: null,
          sha256: null,
          recordedCommit: null,
          reservedSection: false,
        },
        scope: { kind: 'store-project', storeUid: base.storeUid, projectId: bound.projectId },
        ...overrides,
      } as FinalizationArchivePreparation;
    },

    planInput(bound, outcome, overrides = {}) {
      return {
        changeId: bound.changeId,
        outcome,
        startPath: bound.executionWorktree,
        selection: {
          store: base.storeId,
          project: bound.projectId,
          targetLine: bound.targetLineId,
        },
        globalDataDir: base.globalDataDir,
        archive: fixture.preparation(bound),
        ...overrides,
      } as FinalizeChangeInput;
    },
  };

  return fixture;
}

/**
 * The prepared spec actions `ArchiveCommand` would have built for a Change,
 * through the SAME `findSpecUpdates` -> `buildUpdatedSpec` pipeline. A suite
 * that hand-wrote these could assert a mapping the production path never
 * produces, so it does not.
 */
export async function prepareSpecActions(
  changeDir: string,
  mainSpecsDir: string,
  changeId: string
): Promise<PreparedArchiveSpecAction[]> {
  const discovery = await findSpecUpdates(changeDir, mainSpecsDir);
  const actions: PreparedArchiveSpecAction[] = [];
  for (const update of discovery.updates) {
    const built = await buildUpdatedSpec(update, changeId, { silent: true });
    const source = fs.readFileSync(update.source);
    let targetPrecondition: PreparedArchiveSpecAction['targetPrecondition'] = {
      state: 'absent',
    };
    if (fs.existsSync(update.target)) {
      targetPrecondition = {
        state: 'file',
        sha256: createHash('sha256').update(fs.readFileSync(update.target)).digest('hex'),
      };
    }
    actions.push({
      capability: path.basename(path.dirname(update.target)),
      action: built.emptied ? 'delete' : update.exists ? 'update' : 'create',
      source: update.source,
      target: update.target,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      targetPrecondition,
      rebuilt: built.rebuilt,
      counts: built.counts,
    });
  }
  return actions.sort((left, right) => left.target.localeCompare(right.target));
}

/** Every file under a directory, as `relative path -> sha256`, sorted. */
export function hashTree(root: string): Record<string, string> {
  const digests: Record<string, string> = {};
  if (!fs.existsSync(root)) return digests;
  const walk = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      // Content, not mtime: "no diff reported" is not the same claim as
      // "byte-identical", and only the second one is worth asserting.
      digests[relative] = createHash('sha256')
        .update(fs.readFileSync(absolute))
        .digest('hex');
    }
  };
  walk(root, '');
  return digests;
}

export type { VerifiedChangeInstanceId };
