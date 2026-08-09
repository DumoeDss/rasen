import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  abortArchivePlan,
  applyArchive,
  createArchiveIntentTemplate,
  createArchivePlan,
  inspectArchiveApplyPlan,
  hasReservedArchiveShipLogSection,
  hashArchivePlan,
  defaultArchiveEngineAdapters,
  loadStoredArchivePlan,
  loadCompletedArchiveAbort,
  persistArchivePlan,
  resolveArchiveSidecar,
  stableArchiveJson,
  withStoredArchivePlanOperation,
  type ArchiveBlocker,
  type ArchiveEngineAdapters,
  type ArchivePlan,
  type ArchivePlanFinalization,
  type PreparedArchiveSpecAction,
  type ArchiveSpecSyncPreparation,
} from '../../src/core/archive-engine.js';
import { hashArchiveEvidence } from '../../src/core/archive-accounting.js';
import { hashDirectoryTree } from '../../src/core/ephemera-cleaner.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
} from '../../src/core/store/planning-identity.js';
import { resolveStorePlanningLayoutV2Path } from '../../src/core/store/planning-layout-v2.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

describe('archive plan/apply engine', () => {
  let root: string;
  let active: string;
  let archiveParent: string;
  let ephemera: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-archive-engine-'));
    active = path.join(root, 'rasen', 'changes', 'sample');
    archiveParent = path.join(root, 'rasen', 'changes', 'archive');
    ephemera = path.join(root, '.rasen', 'changes', 'sample', 'ephemera');
    await fs.mkdir(path.join(active, 'evidence', 'nested'), { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'nested', 'review-report.md'),
      '# Review\nFindings: 1\n'
    );
    await fs.writeFile(path.join(ephemera, 'trace.log'), 'temporary\n');
    await fs.writeFile(path.join(ephemera, 'keep.txt'), 'preserve\n');
  });

  afterEach(async () => {
    // The published archive destination holds freshly closed file handles; on
    // Windows its removal can race a delete-pending child and surface ENOTEMPTY
    // from a bare `fs.rm`. `cleanupTempPathAsync` backs off and retries that
    // transient class instead of failing the whole shard.
    await cleanupTempPathAsync(root);
  });

  async function plan(
    options: {
      keepEphemera?: boolean;
      specActions?: PreparedArchiveSpecAction[];
      specSync?: ArchiveSpecSyncPreparation;
      timing?: ArchivePlan['decisions']['timing'];
      preparationBlockers?: ArchiveBlocker[];
      shipLog?: ArchivePlan['shipLog'];
      adapters?: ArchiveEngineAdapters;
    } = {}
  ) {
    const adapters = options.adapters ?? defaultArchiveEngineAdapters;
    const sidecar = await resolveArchiveSidecar(
      active,
      root,
      'sample',
      adapters
    );
    return createArchivePlan({
      change: 'sample',
      planningRoot: root,
      executionRoot: root,
      activePath: active,
      archiveParent,
      ephemeraPath: ephemera,
      date: '2026-07-31',
      keepEphemera: options.keepEphemera ?? false,
      validation: 'passed',
      tasks: { total: 1, completed: 1, override: false },
      timing: options.timing ?? {
        mode: 'on-merge',
        deliveryMode: 'local',
        override: false,
      },
      specActions: options.specActions ?? [],
      ...(options.specSync === undefined ? {} : { specSync: options.specSync }),
      sidecar,
      ...(options.shipLog === undefined ? {} : { shipLog: options.shipLog }),
      ...(options.preparationBlockers === undefined
        ? {}
        : { preparationBlockers: options.preparationBlockers }),
      transactionId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-07-31T00:00:00.000Z',
    }, adapters);
  }

  it('serializes a stable complete plan without mutating the tree', async () => {
    const activeBefore = await hashDirectoryTree(active);
    const ephemeraBefore = await hashDirectoryTree(ephemera);

    const archivePlan = await plan();

    expect(archivePlan.complete).toBe(true);
    expect(archivePlan.roots).toEqual({
      planning: path.resolve(root),
      execution: path.resolve(root),
    });
    expect(archivePlan.preconditions).toEqual({
      source: 'directory',
      target: 'absent',
    });
    expect(archivePlan.git.execution.state).toBe('non-git');
    expect(archivePlan.qualityInputs).toEqual([
      expect.objectContaining({ path: 'evidence/nested/review-report.md' }),
    ]);
    expect(archivePlan.evidenceInputs).toEqual([
      'evidence/nested/review-report.md',
      'evidence/ship-log.md',
    ]);
    expect(archivePlan.actions.map(action => action.order)).toEqual(
      archivePlan.actions.map((_action, index) => index + 1)
    );
    expect(JSON.parse(JSON.stringify(archivePlan))).toEqual(archivePlan);
    expect(stableArchiveJson(archivePlan)).toBe(stableArchiveJson(archivePlan));
    expect(await hashDirectoryTree(active)).toBe(activeBefore);
    expect(await hashDirectoryTree(ephemera)).toBe(ephemeraBefore);
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(archivePlan.paths.final)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists mixed-case cleaner authority in the planner order', async () => {
    await fs.unlink(path.join(ephemera, 'trace.log'));
    await fs.writeFile(path.join(ephemera, 'Z.log'), 'upper\n');
    await fs.writeFile(path.join(ephemera, 'a.log'), 'lower\n');
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'mixed-case-cleaner-global');

    expect(archivePlan.cleaner.effectiveDelete).toEqual(['Z.log', 'a.log']);
    expect(archivePlan.cleaner.deletionAuthority?.map(entry => entry.path)).toEqual(
      archivePlan.cleaner.effectiveDelete
    );
    await expect(
      persistArchivePlan(archivePlan, globalDataDir)
    ).resolves.toMatch(/^archive-v1:/u);
  });

  it('blocks planning when prepared delta bytes no longer match reconciliation', async () => {
    const capability = 'source-drift';
    const source = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(
      root,
      'rasen',
      'specs',
      capability,
      'spec.md'
    );
    const analyzed = '# Original delta\n';
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, '# Replaced delta\n');

    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'create',
          source,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256(analyzed),
          targetPrecondition: { state: 'absent' },
          rebuilt: '# Planned canonical\n',
          counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
        },
      ],
    });

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.specActions).toEqual([]);
    expect(archivePlan.blockers).toContainEqual({
      operation: 'spec',
      path: source,
      code: 'ESTALE',
      message: `Delta spec changed after reconciliation: ${source}`,
    });
    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('blocks when a new recursive delta appears after action preparation', async () => {
    const preparedSource = path.join(active, 'specs', 'alpha', 'spec.md');
    const addedSource = path.join(
      active,
      'specs',
      'platform',
      'beta',
      'spec.md'
    );
    const target = path.join(root, 'rasen', 'specs', 'alpha', 'spec.md');
    const delta = '# Prepared delta\n';
    await fs.mkdir(path.dirname(preparedSource), { recursive: true });
    await fs.mkdir(path.dirname(addedSource), { recursive: true });
    await fs.writeFile(preparedSource, delta);
    await fs.writeFile(addedSource, '# Added after preparation\n');

    const archivePlan = await plan({
      specSync: { mode: 'apply', deltaSources: [preparedSource] },
      specActions: [
        {
          capability: 'alpha',
          action: 'create',
          source: preparedSource,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256(delta),
          targetPrecondition: { state: 'absent' },
          rebuilt: '# Alpha\n',
          counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
        },
      ],
    });

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.blockers).toContainEqual(
      expect.objectContaining({
        operation: 'spec',
        code: 'archive_spec_manifest_stale',
        message: 'Delta spec set changed after spec action preparation.',
      })
    );
    await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('blocks delete-last-requirement planning when the canonical target drifted', async () => {
    const capability = 'delete-last-target-drift';
    const source = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(
      root,
      'rasen',
      'specs',
      capability,
      'spec.md'
    );
    const delta = [
      '## REMOVED Requirements',
      '',
      `- ${capability}`,
      '',
    ].join('\n');
    const analyzedTarget = '# Canonical before reconciliation\n';
    const driftedTarget = '# Canonical changed after reconciliation\n';
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(source, delta);
    await fs.writeFile(target, driftedTarget);

    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'delete',
          source,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256(delta),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256(analyzedTarget),
          },
          rebuilt: '',
          counts: { added: 0, modified: 0, removed: 1, renamed: 0 },
        },
      ],
    });

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.specActions).toEqual([]);
    expect(archivePlan.blockers).toContainEqual(
      expect.objectContaining({
        operation: 'spec',
        path: target,
        code: 'ESTALE',
        message: `Canonical spec changed after reconciliation: ${target}`,
      })
    );
    await expect(fs.readFile(target, 'utf8')).resolves.toBe(driftedTarget);
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects spec actions outside their exact delta and canonical capability paths', async () => {
    const capability = 'authorized-paths';
    const source = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    const outsideSource = path.join(root, 'outside-delta.md');
    const outsideTarget = path.join(root, 'outside-canonical.md');
    const delta = '# Delta\n';
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, delta);
    await fs.writeFile(outsideSource, delta);
    await fs.writeFile(outsideTarget, 'must survive\n');
    const action = {
      capability,
      action: 'create' as const,
      source,
      target,
      sourceSha256: defaultArchiveEngineAdapters.sha256(delta),
      targetPrecondition: { state: 'absent' as const },
      rebuilt: '# Rebuilt\n',
      counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
    };

    for (const unauthorized of [
      { ...action, source: outsideSource },
      { ...action, target: outsideTarget },
      {
        ...action,
        capability: '..',
        source: path.join(active, 'specs', '..', 'spec.md'),
        target: path.join(root, 'rasen', 'specs', '..', 'spec.md'),
      },
    ]) {
      const rejected = await plan({ specActions: [unauthorized] });
      expect(rejected.complete).toBe(false);
      expect(rejected.specActions).toEqual([]);
      expect(rejected.blockers).toContainEqual(
        expect.objectContaining({
          operation: 'spec',
          code: 'archive_spec_path_unauthorized',
        })
      );
    }

    const authorized = await plan({ specActions: [action] });
    expect(authorized.complete, JSON.stringify(authorized.blockers)).toBe(true);
    for (const [field, maliciousPath] of [
      ['source', outsideSource],
      ['target', outsideTarget],
    ] as const) {
      const forged = structuredClone(authorized);
      forged.specActions[0]![field] = maliciousPath;
      const { planHash: _ignored, ...withoutHash } = forged;
      forged.planHash = hashArchivePlan(withoutHash);

      await expect(
        persistArchivePlan(forged, path.join(root, `global-${field}`))
      ).rejects.toThrow(/spec action outside its authorized/u);
      const result = await applyArchive(forged);
      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            operation: 'validation',
            code: 'archive_plan_path_unauthorized',
          }),
        ],
      });
      await expect(fs.readFile(outsideTarget, 'utf8')).resolves.toBe(
        'must survive\n'
      );
      await expect(fs.access(authorized.paths.stage)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }

    const traversal = structuredClone(authorized);
    traversal.specActions[0]!.capability = '..';
    traversal.specActions[0]!.source = path.join(
      active,
      'specs',
      '..',
      'spec.md'
    );
    traversal.specActions[0]!.target = path.join(
      root,
      'rasen',
      'specs',
      '..',
      'spec.md'
    );
    const { planHash: _ignored, ...traversalWithoutHash } = traversal;
    traversal.planHash = hashArchivePlan(traversalWithoutHash);
    await expect(
      persistArchivePlan(traversal, path.join(root, 'global-traversal'))
    ).rejects.toThrow(/spec action outside its authorized/u);
    await expect(applyArchive(traversal)).resolves.toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          operation: 'validation',
          code: 'archive_plan_path_unauthorized',
        }),
      ],
    });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects source and canonical capability parent symlink escapes at plan and stored apply',
    async () => {
      async function actionPlan(capability: string): Promise<ArchivePlan> {
        const source = path.join(active, 'specs', capability, 'spec.md');
        const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
        const delta = '# Delta\n';
        const canonical = '# Canonical\n';
        await fs.mkdir(path.dirname(source), { recursive: true });
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(source, delta);
        await fs.writeFile(target, canonical);
        return plan({
          specActions: [
            {
              capability,
              action: 'update',
              source,
              target,
              sourceSha256: defaultArchiveEngineAdapters.sha256(delta),
              targetPrecondition: {
                state: 'file',
                sha256: defaultArchiveEngineAdapters.sha256(canonical),
              },
              rebuilt: '# Updated\n',
              counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
            },
          ],
        });
      }

      for (const side of ['source', 'target'] as const) {
        const capability = `symlink-${side}`;
        const authorized = await actionPlan(capability);
        expect(authorized.complete, JSON.stringify(authorized.blockers)).toBe(
          true
        );
        const capabilityDirectory =
          side === 'source'
            ? path.dirname(authorized.specActions[0]!.source)
            : path.dirname(authorized.specActions[0]!.target);
        const outsideDirectory = path.join(root, `outside-${side}-capability`);
        await fs.rename(capabilityDirectory, outsideDirectory);
        await fs.symlink(outsideDirectory, capabilityDirectory, 'dir');

        const result = await applyArchive(authorized);
        expect(result).toMatchObject({
          status: 'blocked',
          blockers: [
            expect.objectContaining({
              operation: 'validation',
              code: 'archive_plan_path_unauthorized',
            }),
          ],
        });
        await expect(
          fs.readFile(path.join(outsideDirectory, 'spec.md'), 'utf8')
        ).resolves.toMatch(/^(# Delta|# Canonical)\n$/u);
        await expect(fs.access(authorized.paths.stage)).rejects.toMatchObject({
          code: 'ENOENT',
        });

        const replannedAction = { ...authorized.specActions[0]! };
        delete replannedAction.actionId;
        const rejectedAtPlan = await plan({
          specActions: [replannedAction],
        });
        expect(rejectedAtPlan.complete).toBe(false);
        expect(rejectedAtPlan.blockers).toContainEqual(
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_spec_path_unauthorized',
          })
        );
      }
    }
  );

  it.skipIf(process.platform === 'win32')(
    'does not follow a capability parent symlink inserted during create',
    async () => {
      const capability = 'platform/routing';
      const source = path.join(active, 'specs', 'platform', 'routing', 'spec.md');
      const canonicalRoot = path.join(root, 'rasen', 'specs');
      const target = path.join(canonicalRoot, 'platform', 'routing', 'spec.md');
      const targetParent = path.join(canonicalRoot, 'platform');
      const outside = path.join(root, 'outside-create-race');
      const delta = '# Delta\n';
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.mkdir(canonicalRoot, { recursive: true });
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(source, delta);
      await fs.writeFile(path.join(outside, 'marker.txt'), 'must survive\n');
      const archivePlan = await plan({
        specSync: { mode: 'apply', deltaSources: [source] },
        specActions: [
          {
            capability,
            action: 'create',
            source,
            target,
            sourceSha256: defaultArchiveEngineAdapters.sha256(delta),
            targetPrecondition: { state: 'absent' },
            rebuilt: '# Created\n',
            counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
          },
        ],
      });
      expect(archivePlan.complete, JSON.stringify(archivePlan.blockers)).toBe(
        true
      );

      const mkdir = defaultArchiveEngineAdapters.fs.mkdir;
      let injected = false;
      const result = await applyArchive(archivePlan, {
        adapters: {
          ...defaultArchiveEngineAdapters,
          fs: {
            ...defaultArchiveEngineAdapters.fs,
            mkdir: async (targetPath, options) => {
              if (targetPath === targetParent && !injected) {
                injected = true;
                await fs.symlink(outside, targetParent, 'dir');
              }
              return mkdir(targetPath, options);
            },
          },
        },
      });

      expect(injected).toBe(true);
      expect(result).toMatchObject({
        status: 'recoverable',
        blockers: [
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_spec_path_unauthorized',
          }),
        ],
      });
      await expect(fs.readdir(outside)).resolves.toEqual(['marker.txt']);
      await expect(fs.access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('creates a missing canonical specs root through its bound parent', async () => {
    const capability = 'first-capability';
    const source = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(
      root,
      'rasen',
      'specs',
      capability,
      'spec.md'
    );
    const delta = '# Delta\n';
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, delta);
    const archivePlan = await plan({
      specSync: { mode: 'apply', deltaSources: [source] },
      specActions: [
        {
          capability,
          action: 'create',
          source,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256(delta),
          targetPrecondition: { state: 'absent' },
          rebuilt: '# First canonical spec\n',
          counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
        },
      ],
    });
    expect(archivePlan.complete, JSON.stringify(archivePlan.blockers)).toBe(
      true
    );

    await expect(applyArchive(archivePlan)).resolves.toMatchObject({
      status: 'complete',
      specsUpdated: true,
    });
    await expect(fs.readFile(target, 'utf8')).resolves.toBe(
      '# First canonical spec\n'
    );
  });

  it('round-trips a saved canonical plan token and rejects one-byte plan tampering', async () => {
    const archivePlan = await plan();
    const globalData = path.join(root, 'global-data');
    const token = await persistArchivePlan(archivePlan, globalData);

    expect(token).toBe(
      `archive-v1:${archivePlan.transactionId}:${archivePlan.planHash}`
    );
    expect(await loadStoredArchivePlan(token, globalData)).toEqual(archivePlan);

    const planPath = path.join(
      globalData,
      'archive-transactions',
      archivePlan.transactionId,
      'plan.json'
    );
    const envelope = JSON.parse(await fs.readFile(planPath, 'utf8'));
    envelope.plan.change = 'tampered';
    await fs.writeFile(planPath, JSON.stringify(envelope));
    await expect(loadStoredArchivePlan(token, globalData)).rejects.toThrow(
      'identity mismatch'
    );
    await expect(fs.access(active)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('re-verifies the exact stored envelope under the operation lock before invoking apply or abort', async () => {
    const archivePlan = await plan();
    const globalData = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalData);
    const planPath = path.join(
      globalData,
      'archive-transactions',
      archivePlan.transactionId,
      'plan.json'
    );
    const envelope = JSON.parse(await fs.readFile(planPath, 'utf8'));
    envelope.createdAt = '2026-08-01T00:00:00.000Z';
    await fs.writeFile(planPath, `${JSON.stringify(envelope, null, 2)}\n`);
    const invoked: string[] = [];

    for (const holder of ['apply', 'abort'] as const) {
      await expect(
        withStoredArchivePlanOperation(
          archivePlan,
          globalData,
          holder,
          async () => {
            invoked.push(holder);
          }
        )
      ).rejects.toMatchObject({ code: 'archive_plan_envelope_invalid' });
    }
    expect(invoked).toEqual([]);
    await expect(fs.access(active)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.skipIf(process.platform === 'win32')(
    'treats non-default POSIX directory mode as portable payload metadata',
    async () => {
      const nested = path.join(active, 'portable-mode');
      await fs.mkdir(nested);
      const payloadFile = path.join(nested, 'payload.txt');
      await fs.writeFile(payloadFile, 'portable\n');
      await fs.chmod(payloadFile, 0o755);
      await fs.chmod(nested, 0o711);

      const archivePlan = await plan();
      const directoryEntry = archivePlan.sourceFingerprint?.entries.find(
        entry => entry.path === 'portable-mode'
      );
      expect(directoryEntry).toEqual({
        path: 'portable-mode',
        kind: 'directory',
      });
      expect((await applyArchive(archivePlan)).status).toBe('complete');
      expect(
        archivePlan.sourceFingerprint?.entries.find(
          entry => entry.path === 'portable-mode/payload.txt'
        )?.executable
      ).toBe(true);
      expect(
        await fs.readFile(
          path.join(archivePlan.paths.final, 'portable-mode', 'payload.txt'),
          'utf8'
        )
      ).toBe('portable\n');
    }
  );

  it('stages, finalizes evidence, cleans, accounts, and removes active source last', async () => {
    const archivePlan = await plan();
    const result = await applyArchive(JSON.parse(JSON.stringify(archivePlan)));

    expect(result.status, JSON.stringify(result)).toBe('complete');
    expect(result.ephemeraDiscarded).toEqual(['trace.log']);
    expect(result.ephemeraPreserved).toEqual(['keep.txt']);
    await expect(fs.access(active)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(path.join(ephemera, 'trace.log'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(path.join(ephemera, 'keep.txt'), 'utf8')).toBe('preserve\n');

    const archiveJson = JSON.parse(
      await fs.readFile(path.join(archivePlan.paths.final, 'archive.json'), 'utf8')
    );
    expect(archiveJson.ephemeraDiscarded).toEqual(['trace.log']);
    expect(archiveJson.handoffAbsorbed).toBeNull();
    expect(archiveJson.evidence.map((entry: { path: string }) => entry.path)).toEqual([
      'evidence/nested/review-report.md',
      'evidence/ship-log.md',
    ]);
    const shipLog = await fs.readFile(
      path.join(archivePlan.paths.final, 'evidence', 'ship-log.md'),
      'utf8'
    );
    expect(shipLog).toContain('## Archive');
    expect(shipLog).toContain(`**Transaction:** ${archivePlan.transactionId}`);
    expect(shipLog).not.toContain('Archive commit:');
    const metadata = await fs.readFile(
      path.join(archivePlan.paths.final, '.openspec.yaml'),
      'utf8'
    );
    expect(metadata).toContain('evidence/nested/review-report.md');
    const journal = JSON.parse(
      await fs.readFile(archivePlan.paths.publishedJournal, 'utf8')
    );
    expect(journal.phase).toBe('complete');
  });

  it('consumes merge confirmation at apply without changing the saved plan', async () => {
    const archivePlan = await plan({
      timing: {
        mode: 'on-merge',
        deliveryMode: 'pr',
        override: false,
      },
    });

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.blockers).toEqual([
      expect.objectContaining({
        code: 'archive_merge_confirmation_required',
        operation: 'timing',
      }),
    ]);
    expect(inspectArchiveApplyPlan(archivePlan).applicable).toBe(false);
    expect(
      inspectArchiveApplyPlan(archivePlan, { mergeConfirmed: true })
    ).toEqual({
      applicable: true,
      blockers: [],
    });

    const result = await applyArchive(archivePlan, {
      assertions: { mergeConfirmed: true },
    });

    expect(result.status).toBe('complete');
    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.decisions.timing.override).toBe(false);
  });

  it('applies an unchanged schema-v1 saved merge plan with its original token identity', async () => {
    const currentPlan = await plan({
      timing: {
        mode: 'on-merge',
        deliveryMode: 'pr',
        override: false,
      },
    });
    type HistoricalPlanV1 = Omit<
      ArchivePlan,
      'archivePathAuthority' | 'decisions'
    > & {
      archivePathAuthority?: ArchivePlan['archivePathAuthority'];
      decisions: Omit<ArchivePlan['decisions'], 'specSync'> & {
        specSync?: ArchiveSpecSyncPreparation;
      };
    };
    const legacyPlan = structuredClone(
      currentPlan
    ) as unknown as HistoricalPlanV1;
    legacyPlan.schemaVersion = 1;
    delete legacyPlan.archivePathAuthority;
    delete legacyPlan.decisions.specSync;
    delete legacyPlan.blockers[0]?.code;
    const { planHash: _planHash, ...withoutHash } = legacyPlan;
    legacyPlan.planHash = defaultArchiveEngineAdapters.sha256(
      stableArchiveJson(withoutHash)
    );
    const originalBytes = stableArchiveJson(legacyPlan);
    const originalHash = legacyPlan.planHash;
    const globalDataDir = path.join(root, 'global-data');
    const token = await persistArchivePlan(
      legacyPlan as ArchivePlan,
      globalDataDir
    );
    expect(token).toBe(
      `archive-v1:${legacyPlan.transactionId}:${originalHash}`
    );
    const stored = await loadStoredArchivePlan(token, globalDataDir);
    expect(stableArchiveJson(stored)).toBe(originalBytes);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.blockers).toEqual([
      expect.objectContaining({
        operation: 'timing',
      }),
    ]);
    expect(stored.blockers[0]).not.toHaveProperty('code');
    expect(
      (
        await applyArchive(stored, {
          assertions: { mergeConfirmed: true },
        })
      ).status
    ).toBe('complete');
    expect(stored.planHash).toBe(originalHash);
  });

  it('rejects a schema-v2 plan that omits its spec sync manifest', async () => {
    const currentPlan = await plan();
    const invalidPlan = structuredClone(currentPlan) as ArchivePlan & {
      decisions: Omit<ArchivePlan['decisions'], 'specSync'> & {
        specSync?: ArchiveSpecSyncPreparation;
      };
    };
    delete invalidPlan.decisions.specSync;
    const { planHash: _planHash, ...withoutHash } = invalidPlan;
    invalidPlan.planHash = defaultArchiveEngineAdapters.sha256(
      stableArchiveJson(withoutHash)
    );
    const globalDataDir = path.join(root, 'global-data');
    const transactionDir = path.join(
      globalDataDir,
      'archive-transactions',
      invalidPlan.transactionId
    );
    await fs.mkdir(transactionDir, { recursive: true });
    await fs.writeFile(
      path.join(transactionDir, 'plan.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'rasen.archive-plan',
        transactionId: invalidPlan.transactionId,
        planHash: invalidPlan.planHash,
        createdAt: invalidPlan.createdAt,
        plan: invalidPlan,
      })
    );
    const token = `archive-v1:${invalidPlan.transactionId}:${invalidPlan.planHash}`;
    await expect(
      loadStoredArchivePlan(token, globalDataDir)
    ).rejects.toThrow('identity mismatch');
  });

  it('rejects a schema-v2 plan that omits archive path authority', async () => {
    const currentPlan = await plan();
    const invalidPlan = structuredClone(currentPlan) as Omit<
      ArchivePlan,
      'archivePathAuthority'
    > & {
      archivePathAuthority?: ArchivePlan['archivePathAuthority'];
    };
    delete invalidPlan.archivePathAuthority;
    const { planHash: _planHash, ...withoutHash } = invalidPlan;
    invalidPlan.planHash = defaultArchiveEngineAdapters.sha256(
      stableArchiveJson(withoutHash)
    );
    const globalDataDir = path.join(root, 'global-data');
    await expect(
      persistArchivePlan(invalidPlan as ArchivePlan, globalDataDir)
    ).rejects.toThrow('invalid canonical hash');
  });

  it('merge confirmation cannot bypass an unrelated plan blocker', async () => {
    const archivePlan = await plan({
      timing: {
        mode: 'on-merge',
        deliveryMode: 'pr',
        override: false,
      },
      preparationBlockers: [
        {
          operation: 'validation',
          path: active,
          code: 'validation_failed',
          message: 'injected validation failure',
        },
      ],
    });

    expect(
      inspectArchiveApplyPlan(archivePlan, { mergeConfirmed: true })
    ).toEqual({
      applicable: false,
      blockers: [
        expect.objectContaining({
          operation: 'validation',
          code: 'validation_failed',
        }),
      ],
    });
    const result = await applyArchive(archivePlan, {
      assertions: { mergeConfirmed: true },
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual([
      expect.objectContaining({
        operation: 'validation',
        code: 'validation_failed',
      }),
    ]);
    await expect(fs.access(active)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('appends archive facts without changing any existing ship-log prefix byte', async () => {
    const original = Buffer.from(
      '# Ship Log: sample\r\n**Mode:** local\r\n**Commit:** abcdef1\r\n  \r\n\r\n'
    );
    await fs.writeFile(path.join(active, 'evidence', 'ship-log.md'), original);
    const archivePlan = await plan();

    expect((await applyArchive(archivePlan)).status).toBe('complete');
    const finalized = await fs.readFile(
      path.join(archivePlan.paths.final, 'evidence', 'ship-log.md')
    );
    expect(finalized.subarray(0, original.length)).toEqual(original);
    expect(finalized.toString('utf8').slice(original.length)).toContain('## Archive');
  });

  it('refuses a source that drifts after planning without creating a stage', async () => {
    const archivePlan = await plan();
    await fs.writeFile(path.join(active, 'after-plan.txt'), 'drift');

    const result = await applyArchive(archivePlan);

    expect(result.status).toBe('recoverable');
    await expect(fs.access(active)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(archivePlan.paths.final)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(ephemera, 'trace.log'), 'utf8')).toBe('temporary\n');
  });

  it('projects keep-ephemera from a complete discovery and blocks target races', async () => {
    await fs.mkdir(archiveParent, { recursive: true });
    const keepPlan = await plan({ keepEphemera: true });
    expect(keepPlan.cleaner.classification.complete).toBe(true);
    expect(keepPlan.cleaner.effectiveDelete).toEqual([]);
    expect(keepPlan.cleaner.effectivePreserve).toEqual(['keep.txt', 'trace.log']);

    const sidecar = await resolveArchiveSidecar(active, root, 'sample');
    const inspectionFailure = await createArchivePlan(
      {
        change: 'sample',
        planningRoot: root,
        executionRoot: root,
        activePath: active,
        archiveParent,
        ephemeraPath: ephemera,
        date: '2026-08-01',
        keepEphemera: true,
        validation: 'passed',
        tasks: { total: 1, completed: 1, override: false },
        timing: { mode: 'on-merge', deliveryMode: 'local', override: false },
        specActions: [],
        sidecar,
      },
      {
        ...defaultArchiveEngineAdapters,
        classifyEphemera: async () => ({
          discarded: [],
          preserved: [],
          aborted: true,
          blockers: [
            {
              operation: 'readdir',
              path: ephemera,
              code: 'EACCES',
              message: 'injected inspection failure',
            },
          ],
          complete: false,
        }),
      }
    );
    expect(inspectionFailure.complete).toBe(false);
    expect(inspectionFailure.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'cleaner', code: 'EACCES' }),
      ])
    );

    const globalDataDir = path.join(root, 'reservation-race-global');
    await persistArchivePlan(keepPlan, globalDataDir);
    await fs.mkdir(keepPlan.paths.final, { recursive: true });
    await fs.writeFile(path.join(keepPlan.paths.final, 'unrelated.txt'), 'do not clobber');
    const result = await applyArchive(keepPlan);
    expect(result).toMatchObject({
      status: 'abort-required',
      blockers: [
        expect.objectContaining({
          code: 'archive_reservation_ownership_unverified',
        }),
      ],
      abortCommand: expect.stringContaining('--abort-plan'),
    });
    expect(await fs.readFile(path.join(keepPlan.paths.final, 'unrelated.txt'), 'utf8')).toBe(
      'do not clobber'
    );
    const aborted = await abortArchivePlan(keepPlan, globalDataDir);
    expect(aborted).toMatchObject({ status: 'aborted', blockers: [] });
    expect(
      await fs.readFile(
        path.join(keepPlan.paths.final, 'unrelated.txt'),
        'utf8'
      )
    ).toBe('do not clobber');
    await expect(fs.access(active)).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(ephemera, 'trace.log'), 'utf8')).toBe('temporary\n');
  });

  it('authorizes an unchanged cleaner candidate with exact stat identity beyond the safe integer range', async () => {
    const candidatePath = path.join(ephemera, 'trace.log');
    const largeDev = 9_007_199_254_740_993n;
    const largeIno = 18_446_744_073_709_551_615n;
    const transactionId = '11111111-1111-4111-8111-111111111111';
    const claimObject = path.join(
      ephemera,
      `.rasen-archive-claim-${transactionId}-${defaultArchiveEngineAdapters
        .sha256('cleaner:trace.log')
        .slice(0, 16)}`,
      'object'
    );
    const carriesSyntheticIdentity = (target: string): boolean =>
      target === candidatePath || target === claimObject;
    const exactStat = <T extends object>(stat: T): T =>
      new Proxy(stat, {
        get(target, property) {
          if (property === 'dev') return largeDev;
          if (property === 'ino') return largeIno;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        lstat: async target => {
          const stat = await defaultArchiveEngineAdapters.fs.lstat(target);
          return carriesSyntheticIdentity(target) ? exactStat(stat) : stat;
        },
        open: async (target, flags, mode) => {
          const handle = await defaultArchiveEngineAdapters.fs.open(
            target,
            flags,
            mode
          );
          if (!carriesSyntheticIdentity(target)) return handle;
          return new Proxy(handle, {
            get(opened, property) {
              if (property === 'stat') {
                return async () => exactStat(await opened.stat({ bigint: true }));
              }
              const value = Reflect.get(opened, property, opened);
              return typeof value === 'function' ? value.bind(opened) : value;
            },
          });
        },
      },
      classifyEphemera: async directory => {
        const classification = await defaultArchiveEngineAdapters.classifyEphemera(
          directory
        );
        return {
          ...classification,
          candidates: classification.candidates?.map(candidate =>
            candidate.relativePath === 'trace.log'
              ? {
                  ...candidate,
                  dev: Number(largeDev),
                  ino: Number(largeIno),
                }
              : candidate
          ),
        };
      },
      applyEphemeraDeletion: async (directory, classification) => {
        expect(classification.candidates).toEqual([
          expect.objectContaining({
            relativePath: 'object',
            dev: Number(largeDev),
            ino: Number(largeIno),
          }),
        ]);
        await fs.unlink(path.join(directory, 'object'));
        return ['object'];
      },
    };

    const archivePlan = await plan({ adapters });
    expect(archivePlan.cleaner.deletionAuthority).toEqual([
      expect.objectContaining({
        path: 'trace.log',
        identity: expect.objectContaining({
          dev: largeDev.toString(),
          ino: largeIno.toString(),
        }),
        contentDigest: defaultArchiveEngineAdapters.sha256('temporary\n'),
      }),
    ]);

    const result = await applyArchive(archivePlan, { adapters });

    expect(result.status).toBe('complete');
    expect(result.ephemeraDiscarded).toEqual(['trace.log']);
    await expect(fs.access(candidatePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts signed exact timestamps but rejects signed non-time identity fields', async () => {
    const candidatePath = path.join(ephemera, 'trace.log');
    const preEpochMtimeNs = '-1000000';
    const signedTimestampStat = <T extends object>(stat: T): T =>
      new Proxy(stat, {
        get(target, property) {
          if (property === 'mtimeNs') return BigInt(preEpochMtimeNs);
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        lstat: async target => {
          const stat = await defaultArchiveEngineAdapters.fs.lstat(target);
          return target === candidatePath ? signedTimestampStat(stat) : stat;
        },
        open: async (target, flags, mode) => {
          const handle = await defaultArchiveEngineAdapters.fs.open(
            target,
            flags,
            mode
          );
          if (target !== candidatePath) return handle;
          return new Proxy(handle, {
            get(opened, property) {
              if (property === 'stat') {
                return async () =>
                  signedTimestampStat(await opened.stat({ bigint: true }));
              }
              const value = Reflect.get(opened, property, opened);
              return typeof value === 'function' ? value.bind(opened) : value;
            },
          });
        },
      },
    };
    const archivePlan = await plan({ adapters });
    const globalDataDir = path.join(root, 'signed-time-cleaner-global');

    expect(archivePlan.cleaner.deletionAuthority?.[0]?.identity.mtimeNs).toBe(
      preEpochMtimeNs
    );
    await expect(
      persistArchivePlan(archivePlan, globalDataDir, adapters)
    ).resolves.toMatch(/^archive-v1:/u);

    const invalidDevPlan = structuredClone(archivePlan);
    invalidDevPlan.cleaner.deletionAuthority![0]!.identity.dev = '-1';
    const { planHash: _planHash, ...withoutHash } = invalidDevPlan;
    invalidDevPlan.planHash = hashArchivePlan(withoutHash, adapters);
    await expect(
      persistArchivePlan(
        invalidDevPlan,
        path.join(root, 'signed-dev-cleaner-global'),
        adapters
      )
    ).rejects.toThrow(
      'Stored archive plan path containment or transaction binding is invalid.'
    );
  });

  it('blocks planning when cleaner content changes before exact authority capture', async () => {
    const candidatePath = path.join(ephemera, 'trace.log');
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      classifyEphemera: async directory => {
        const classification = await defaultArchiveEngineAdapters.classifyEphemera(
          directory
        );
        await fs.writeFile(candidatePath, 'changed after classification\n');
        return classification;
      },
    };

    const archivePlan = await plan({ adapters });

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.cleaner.deletionAuthority).toEqual([]);
    expect(archivePlan.blockers).toContainEqual(
      expect.objectContaining({
        operation: 'cleaner',
        path: candidatePath,
        code: 'ESTALE',
      })
    );
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('retains a changed cleaner candidate that no longer matches exact authority', async () => {
    const archivePlan = await plan();
    const candidatePath = path.join(ephemera, 'trace.log');
    await fs.writeFile(candidatePath, 'replacement bytes\n');

    const result = await applyArchive(archivePlan);

    expect(result).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          operation: 'cleaner-apply',
          path: candidatePath,
          code: 'archive_cleaner_ownership_unverified',
        }),
      ],
      manualRecoveryAction: { kind: 'manual-recovery-required' },
    });
    expect(result.recoveryCommand).toBeUndefined();
    await expect(fs.readFile(candidatePath, 'utf8')).resolves.toBe(
      'replacement bytes\n'
    );
  });

  it('retains a same-byte cleaner candidate whose exact metadata changed after planning', async () => {
    const archivePlan = await plan();
    const candidatePath = path.join(ephemera, 'trace.log');
    const replacementTime = new Date('2035-01-02T03:04:05.000Z');
    await fs.utimes(candidatePath, replacementTime, replacementTime);

    const result = await applyArchive(archivePlan);

    expect(result).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          operation: 'cleaner-apply',
          path: candidatePath,
          code: 'archive_cleaner_ownership_unverified',
        }),
      ],
    });
    await expect(fs.readFile(candidatePath, 'utf8')).resolves.toBe('temporary\n');
  });

  it('retains an inode-reuse-style same-byte candidate when only exact timestamps differ', async () => {
    const archivePlan = await plan();
    const candidatePath = path.join(ephemera, 'trace.log');
    const plannedIdentity = archivePlan.cleaner.deletionAuthority![0]!.identity;
    const changedStat = <T extends object>(stat: T): T =>
      new Proxy(stat, {
        get(target, property) {
          if (property === 'mtimeNs') return BigInt(plannedIdentity.mtimeNs) + 1n;
          if (property === 'ctimeNs') return BigInt(plannedIdentity.ctimeNs) + 1n;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        lstat: async target => {
          const stat = await defaultArchiveEngineAdapters.fs.lstat(target);
          return target === candidatePath ? changedStat(stat) : stat;
        },
        open: async (target, flags, mode) => {
          const handle = await defaultArchiveEngineAdapters.fs.open(
            target,
            flags,
            mode
          );
          if (target !== candidatePath) return handle;
          return new Proxy(handle, {
            get(opened, property) {
              if (property === 'stat') {
                return async () => changedStat(await opened.stat({ bigint: true }));
              }
              const value = Reflect.get(opened, property, opened);
              return typeof value === 'function' ? value.bind(opened) : value;
            },
          });
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters });

    expect(result).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          operation: 'cleaner-apply',
          path: candidatePath,
          code: 'archive_cleaner_ownership_unverified',
        }),
      ],
    });
    await expect(fs.readFile(candidatePath, 'utf8')).resolves.toBe('temporary\n');
  });

  it('retains a same-byte private claim whose exact identity changes after the verified rename', async () => {
    const archivePlan = await plan();
    const candidatePath = path.join(ephemera, 'trace.log');
    const claimObject = path.join(
      ephemera,
      `.rasen-archive-claim-${archivePlan.transactionId}-${defaultArchiveEngineAdapters
        .sha256('cleaner:trace.log')
        .slice(0, 16)}`,
      'object'
    );
    let movedIntoClaim = false;
    const changedStat = <T extends object>(stat: T): T =>
      new Proxy(stat, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property === 'mtimeNs' && typeof value === 'bigint') {
            return value + 1n;
          }
          if (property === 'ctimeNs' && typeof value === 'bigint') {
            return value + 1n;
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rename: async (source, target) => {
          await defaultArchiveEngineAdapters.fs.rename(source, target);
          if (source === candidatePath && target === claimObject) {
            movedIntoClaim = true;
          }
        },
        open: async (target, flags, mode) => {
          const handle = await defaultArchiveEngineAdapters.fs.open(
            target,
            flags,
            mode
          );
          if (target !== claimObject || !movedIntoClaim) return handle;
          return new Proxy(handle, {
            get(opened, property) {
              if (property === 'stat') {
                return async () => changedStat(await opened.stat({ bigint: true }));
              }
              const value = Reflect.get(opened, property, opened);
              return typeof value === 'function' ? value.bind(opened) : value;
            },
          });
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters });

    expect(result).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          operation: 'cleaner-apply',
          path: claimObject,
          code: 'archive_cleaner_ownership_unverified',
        }),
      ],
      retainedPaths: expect.arrayContaining([claimObject]),
    });
    await expect(fs.readFile(claimObject, 'utf8')).resolves.toBe('temporary\n');
  });

  it('retains a legacy delete plan without exact cleaner authority', async () => {
    const archivePlan = await plan();
    const legacyPlan = structuredClone(archivePlan);
    delete legacyPlan.cleaner.deletionAuthority;
    const { planHash: _planHash, ...withoutHash } = legacyPlan;
    legacyPlan.planHash = hashArchivePlan(withoutHash);
    const globalDataDir = path.join(root, 'legacy-delete-global');
    await persistArchivePlan(legacyPlan, globalDataDir);

    const result = await withStoredArchivePlanOperation(
      legacyPlan,
      globalDataDir,
      'apply',
      () => applyArchive(legacyPlan)
    );

    expect(result).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          operation: 'cleaner-apply',
          code: 'archive_cleaner_ownership_unverified',
        }),
      ],
      retainedPaths: expect.arrayContaining([
        legacyPlan.paths.final,
        legacyPlan.paths.publishedJournal,
      ]),
    });
    await expect(fs.readFile(path.join(ephemera, 'trace.log'), 'utf8')).resolves.toBe(
      'temporary\n'
    );
  });

  it('retains a legacy delete plan before treating a missing candidate as progress', async () => {
    const archivePlan = await plan();
    const legacyPlan = structuredClone(archivePlan);
    delete legacyPlan.cleaner.deletionAuthority;
    const { planHash: _planHash, ...withoutHash } = legacyPlan;
    legacyPlan.planHash = hashArchivePlan(withoutHash);
    const globalDataDir = path.join(root, 'legacy-missing-delete-global');
    await persistArchivePlan(legacyPlan, globalDataDir);

    const first = await withStoredArchivePlanOperation(
      legacyPlan,
      globalDataDir,
      'apply',
      () => applyArchive(legacyPlan)
    );
    expect(first.status).toBe('recoverable');
    await fs.unlink(path.join(ephemera, 'trace.log'));

    const retry = await withStoredArchivePlanOperation(
      legacyPlan,
      globalDataDir,
      'apply',
      () => applyArchive(legacyPlan)
    );

    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          operation: 'cleaner-apply',
          code: 'archive_cleaner_ownership_unverified',
        }),
      ],
    });
    const retainedJournal = JSON.parse(
      await fs.readFile(retry.journalPath, 'utf8')
    ) as { cleanerProgress: Array<{ state: string }> };
    expect(retainedJournal.cleanerProgress[0]?.state).toBe('pending');
  });

  it.each(['deleted', 'deleted-after-intent'] as const)(
    'retains a legacy delete plan before trusting pre-existing %s progress',
    async recordedState => {
      const archivePlan = await plan();
      const legacyPlan = structuredClone(archivePlan);
      delete legacyPlan.cleaner.deletionAuthority;
      const { planHash: _planHash, ...withoutHash } = legacyPlan;
      legacyPlan.planHash = hashArchivePlan(withoutHash);
      const globalDataDir = path.join(
        root,
        `legacy-${recordedState}-delete-global`
      );
      await persistArchivePlan(legacyPlan, globalDataDir);

      const first = await withStoredArchivePlanOperation(
        legacyPlan,
        globalDataDir,
        'apply',
        () => applyArchive(legacyPlan)
      );
      expect(first.status).toBe('recoverable');
      const journal = JSON.parse(
        await fs.readFile(first.journalPath, 'utf8')
      ) as {
        cleanerProgress: Array<{ state: string }>;
        ephemeraDisposed: string[];
      };
      journal.cleanerProgress[0]!.state = recordedState;
      journal.ephemeraDisposed = ['trace.log'];
      await fs.writeFile(
        first.journalPath,
        `${JSON.stringify(journal, null, 2)}\n`
      );
      await fs.unlink(path.join(ephemera, 'trace.log'));

      const retry = await withStoredArchivePlanOperation(
        legacyPlan,
        globalDataDir,
        'apply',
        () => applyArchive(legacyPlan)
      );

      expect(retry).toMatchObject({
        status: 'recoverable',
        blockers: [
          expect.objectContaining({
            operation: 'cleaner-apply',
            code: 'archive_cleaner_ownership_unverified',
          }),
        ],
      });
      const retainedJournal = JSON.parse(
        await fs.readFile(retry.journalPath, 'utf8')
      ) as { cleanerProgress: Array<{ state: string }> };
      expect(retainedJournal.cleanerProgress[0]?.state).toBe(recordedState);
    }
  );

  it('replays a legacy no-delete plan without exact cleaner authority', async () => {
    const archivePlan = await plan({ keepEphemera: true });
    const legacyPlan = structuredClone(archivePlan);
    delete legacyPlan.cleaner.deletionAuthority;
    const { planHash: _planHash, ...withoutHash } = legacyPlan;
    legacyPlan.planHash = hashArchivePlan(withoutHash);
    const globalDataDir = path.join(root, 'legacy-no-delete-global');
    await persistArchivePlan(legacyPlan, globalDataDir);

    const result = await withStoredArchivePlanOperation(
      legacyPlan,
      globalDataDir,
      'apply',
      () => applyArchive(legacyPlan)
    );

    expect(result.status).toBe('complete');
    expect(result.ephemeraDiscarded).toEqual([]);
    await expect(fs.readFile(path.join(ephemera, 'trace.log'), 'utf8')).resolves.toBe(
      'temporary\n'
    );
  });

  it('validates and applies complete handoff intent only inside the stage', async () => {
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.writeFile(path.join(active, 'handoff', 'absorbed.md'), 'already durable');
    await fs.writeFile(path.join(active, 'handoff', 'preserved.md'), 'expensive dead end');
    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: {
          complete: true,
          decisions: [
            { path: 'handoff/absorbed.md', outcome: 'absorbed' },
            { path: 'handoff/preserved.md', outcome: 'preserved' },
          ],
        },
        probes: [],
      })
    );

    const archivePlan = await plan();
    expect(archivePlan.sidecar.status).toBe('valid');
    expect(archivePlan.complete).toBe(true);

    const result = await applyArchive(archivePlan);
    expect(result.status, JSON.stringify(result)).toBe('complete');
    await expect(
      fs.access(path.join(archivePlan.paths.final, 'handoff', 'absorbed.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(archivePlan.paths.final, 'handoff', 'preserved.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await fs.readFile(
        path.join(archivePlan.paths.final, 'evidence', 'handoff', 'preserved.md'),
        'utf8'
      )
    ).toBe('expensive dead end');
    const accounting = JSON.parse(
      await fs.readFile(path.join(archivePlan.paths.final, 'archive.json'), 'utf8')
    );
    expect(accounting.handoffAbsorbed).toEqual([
      { file: 'handoff/absorbed.md', outcome: 'absorbed' },
      { file: 'handoff/preserved.md', outcome: 'preserved' },
    ]);
  });

  it('preserves an injected handoff destination at the no-replace boundary', async () => {
    const relative = 'handoff/preserved.md';
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.writeFile(path.join(active, ...relative.split('/')), 'planned handoff\n');
    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: {
          complete: true,
          decisions: [{ path: relative, outcome: 'preserved' }],
        },
        probes: [],
      })
    );
    const archivePlan = await plan();
    const stagedSource = path.join(archivePlan.paths.stage, ...relative.split('/'));
    const stagedDestination = path.join(
      archivePlan.paths.stage,
      'evidence',
      'handoff',
      'preserved.md'
    );
    let inject = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, destination: string) => {
          if (destination === stagedDestination && inject) {
            inject = false;
            await fs.writeFile(destination, 'unrelated destination\n');
          }
          return defaultArchiveEngineAdapters.fs.link(source, destination);
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters });

    expect(result).toMatchObject({
      status: 'recoverable',
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([
        stagedSource,
        stagedDestination,
        archivePlan.paths.stage,
        archivePlan.paths.journal,
      ]),
      blockers: [
        expect.objectContaining({
          operation: 'handoff',
          code: 'archive_handoff_ownership_unverified',
        }),
      ],
    });
    expect(await fs.readFile(stagedSource, 'utf8')).toBe('planned handoff\n');
    expect(await fs.readFile(stagedDestination, 'utf8')).toBe(
      'unrelated destination\n'
    );
    await expect(fs.access(active)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an injected handoff destination-parent symlink before publication',
    async () => {
      const relative = 'handoff/ancestor-symlink.md';
      await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
      await fs.writeFile(
        path.join(active, ...relative.split('/')),
        'planned handoff\n'
      );
      await fs.writeFile(
        path.join(active, '.rasen-archive-input.json'),
        JSON.stringify({
          schemaVersion: 1,
          change: 'sample',
          handoff: {
            complete: true,
            decisions: [{ path: relative, outcome: 'preserved' }],
          },
          probes: [],
        })
      );
      const archivePlan = await plan();
      const stagedSource = path.join(
        archivePlan.paths.stage,
        ...relative.split('/')
      );
      const stagedParent = path.join(
        archivePlan.paths.stage,
        'evidence',
        'handoff'
      );
      const outside = path.join(root, 'outside-handoff-symlink');
      await fs.mkdir(outside);
      let inject = true;
      const adapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          mkdir: async (
            candidate: string,
            options?: Parameters<typeof fs.mkdir>[1]
          ) => {
            if (candidate === stagedParent && inject) {
              inject = false;
              await fs.symlink(outside, stagedParent, 'dir');
              return undefined;
            }
            return defaultArchiveEngineAdapters.fs.mkdir(candidate, options);
          },
        },
      };

      const result = await applyArchive(archivePlan, { adapters });

      expect(result).toMatchObject({
        status: 'recoverable',
        manualRecoveryAction: { kind: 'manual-recovery-required' },
        blockers: [
          expect.objectContaining({
            operation: 'handoff',
            code: 'archive_handoff_ownership_unverified',
          }),
        ],
      });
      expect(await fs.readFile(stagedSource, 'utf8')).toBe('planned handoff\n');
      await expect(
        fs.access(path.join(outside, 'ancestor-symlink.md'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a handoff destination-parent identity swap before publication',
    async () => {
      const relative = 'handoff/ancestor-swap.md';
      await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
      await fs.writeFile(
        path.join(active, ...relative.split('/')),
        'planned handoff\n'
      );
      await fs.writeFile(
        path.join(active, '.rasen-archive-input.json'),
        JSON.stringify({
          schemaVersion: 1,
          change: 'sample',
          handoff: {
            complete: true,
            decisions: [{ path: relative, outcome: 'preserved' }],
          },
          probes: [],
        })
      );
      const archivePlan = await plan();
      const stagedSource = path.join(
        archivePlan.paths.stage,
        ...relative.split('/')
      );
      const stagedParent = path.join(
        archivePlan.paths.stage,
        'evidence',
        'handoff'
      );
      const displaced = `${stagedParent}.displaced`;
      let parentStats = 0;
      const adapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          lstat: async (candidate: string) => {
            if (candidate === stagedParent) {
              parentStats += 1;
              if (parentStats === 3) {
                await fs.rename(stagedParent, displaced);
                await fs.mkdir(stagedParent);
              }
            }
            return defaultArchiveEngineAdapters.fs.lstat(candidate);
          },
        },
      };

      const result = await applyArchive(archivePlan, { adapters });

      expect(result).toMatchObject({
        status: 'recoverable',
        manualRecoveryAction: { kind: 'manual-recovery-required' },
        blockers: [
          expect.objectContaining({
            operation: 'handoff',
            code: 'archive_handoff_ownership_unverified',
          }),
        ],
      });
      expect(await fs.readFile(stagedSource, 'utf8')).toBe('planned handoff\n');
      await expect(
        fs.access(path.join(stagedParent, 'ancestor-swap.md'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('resumes a preserved handoff after the exclusive link succeeds before source unlink', async () => {
    const relative = 'handoff/resume.md';
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.writeFile(path.join(active, ...relative.split('/')), 'planned handoff\n');
    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: {
          complete: true,
          decisions: [{ path: relative, outcome: 'preserved' }],
        },
        probes: [],
      })
    );
    const archivePlan = await plan();
    const stagedSource = path.join(archivePlan.paths.stage, ...relative.split('/'));
    const stagedDestination = path.join(
      archivePlan.paths.stage,
      'evidence',
      'handoff',
      'resume.md'
    );
    let crash = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, destination: string) => {
          await defaultArchiveEngineAdapters.fs.link(source, destination);
          if (destination === stagedDestination && crash) {
            crash = false;
            const error = new Error('crash after exclusive handoff link');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
        },
      },
    };

    expect((await applyArchive(archivePlan, { adapters })).status).toBe(
      'recoverable'
    );
    const [sourceStat, destinationStat] = await Promise.all([
      fs.lstat(stagedSource),
      fs.lstat(stagedDestination),
    ]);
    expect(sourceStat.ino).toBe(destinationStat.ino);

    const retry = await applyArchive(archivePlan);

    expect(retry).toMatchObject({
      status: 'complete',
      resumed: true,
      blockers: [],
    });
    expect(
      await fs.readFile(
        path.join(archivePlan.paths.final, 'evidence', 'handoff', 'resume.md'),
        'utf8'
      )
    ).toBe('planned handoff\n');
  });

  it('retains an absorbed handoff source whose durable identity is swapped before unlink', async () => {
    const relative = 'handoff/absorbed.md';
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.writeFile(path.join(active, ...relative.split('/')), 'planned handoff\n');
    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: {
          complete: true,
          decisions: [{ path: relative, outcome: 'absorbed' }],
        },
        probes: [],
      })
    );
    const archivePlan = await plan();
    const stagedSource = path.join(archivePlan.paths.stage, ...relative.split('/'));
    const displaced = `${stagedSource}.displaced`;
    let sourceStats = 0;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        lstat: async (target: string) => {
          if (target === stagedSource) {
            sourceStats += 1;
            if (sourceStats === 7) {
              await fs.rename(stagedSource, displaced);
              await fs.writeFile(stagedSource, 'replacement handoff\n');
            }
          }
          return defaultArchiveEngineAdapters.fs.lstat(target);
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters });

    expect(result.status).toBe('recoverable');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'handoff', code: 'ESTALE' }),
      ])
    );
    expect(await fs.readFile(stagedSource, 'utf8')).toBe('replacement handoff\n');
    expect(await fs.readFile(displaced, 'utf8')).toBe('planned handoff\n');
  });

  it('builds complete empty and multi-handoff intent templates outside the active change', async () => {
    expect(await createArchiveIntentTemplate(active, 'sample')).toEqual({
      schemaVersion: 1,
      change: 'sample',
      handoff: { complete: true, decisions: [] },
      probes: [],
    });
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.writeFile(path.join(active, 'handoff', 'one.md'), 'one\n');
    await fs.writeFile(path.join(active, 'handoff', 'two.md'), 'two\n');
    const intent = await createArchiveIntentTemplate(active, 'sample');
    expect(intent.handoff.decisions).toEqual([
      { path: 'handoff/one.md', outcome: 'preserved' },
      { path: 'handoff/two.md', outcome: 'preserved' },
    ]);

    const intentPath = path.join(root, 'intent.json');
    await fs.writeFile(intentPath, JSON.stringify(intent));
    const projection = await resolveArchiveSidecar(
      active,
      root,
      'sample',
      undefined,
      intentPath
    );
    expect(projection.status).toBe('valid');
    expect(projection.handoff.complete).toBe(true);
  });

  it('reports incomplete handoff and missing probes with distinct stable codes', async () => {
    const sidecarPath = path.join(active, '.rasen-archive-input.json');
    await fs.writeFile(
      sidecarPath,
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: { complete: false, decisions: [] },
        probes: [],
      })
    );

    const incompleteHandoff = await resolveArchiveSidecar(
      active,
      root,
      'sample'
    );
    expect(incompleteHandoff.status).toBe('invalid');
    expect(incompleteHandoff.blockers).toEqual([
      expect.objectContaining({
        code: 'archive_intent_handoff_incomplete',
        message: expect.stringContaining('handoff.complete'),
      }),
    ]);

    await fs.writeFile(
      sidecarPath,
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: { complete: true, decisions: [] },
      })
    );
    const missingProbes = await resolveArchiveSidecar(active, root, 'sample');
    expect(missingProbes.status).toBe('invalid');
    expect(missingProbes.blockers).toEqual([
      expect.objectContaining({
        code: 'archive_intent_probes_missing',
        message: expect.stringContaining('empty array'),
      }),
    ]);
  });

  it('names an unexpected root intent key and lists the accepted root fields', async () => {
    const sidecarPath = path.join(active, '.rasen-archive-input.json');
    await fs.writeFile(
      sidecarPath,
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: { complete: true, decisions: [] },
        probes: [],
        mergeConfirmed: true,
      })
    );

    const projection = await resolveArchiveSidecar(active, root, 'sample');

    expect(projection.status).toBe('invalid');
    expect(projection.blockers).toEqual([
      expect.objectContaining({
        code: 'archive_intent_unexpected_key',
        path: `${sidecarPath}#/mergeConfirmed`,
        message: expect.stringMatching(
          /Unexpected key 'mergeConfirmed'.*schemaVersion, change, handoff, probes/
        ),
      }),
    ]);
  });

  it('reports independent intent constraints in deterministic structured order', async () => {
    const sidecarPath = path.join(active, '.rasen-archive-input.json');
    await fs.writeFile(
      sidecarPath,
      JSON.stringify({
        schemaVersion: 2,
        change: 'different-change',
        handoff: {
          complete: true,
          decisions: [],
          mergeConfirmed: true,
        },
        probes: [],
      })
    );

    const projection = await resolveArchiveSidecar(active, root, 'sample');

    expect(
      projection.blockers.map(({ code, path: issuePath, message }) => ({
        code,
        path: issuePath,
        message,
      }))
    ).toEqual([
      {
        code: 'archive_intent_change_mismatch',
        path: `${sidecarPath}#/change`,
        message: "Archive intent change must be 'sample'; received \"different-change\".",
      },
      {
        code: 'archive_intent_unexpected_key',
        path: `${sidecarPath}#/handoff/mergeConfirmed`,
        message:
          "Unexpected key 'mergeConfirmed' at /handoff; accepted keys are: complete, decisions.",
      },
      {
        code: 'archive_intent_schema_version_invalid',
        path: `${sidecarPath}#/schemaVersion`,
        message: 'schemaVersion must be 1; received 2.',
      },
    ]);
  });

  it('treats a malformed or incomplete sidecar as blocking without mutation', async () => {
    await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
    await fs.writeFile(path.join(active, 'handoff', 'missing-decision.md'), 'keep');
    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'another-change',
        handoff: { complete: true, decisions: [] },
        probes: [],
      })
    );
    const activeBefore = await hashDirectoryTree(active);
    const archivePlan = await plan();

    expect(archivePlan.sidecar.status).toBe('invalid');
    expect(archivePlan.complete).toBe(false);
    expect((await applyArchive(archivePlan)).status).toBe('blocked');
    expect(await hashDirectoryTree(active)).toBe(activeBefore);
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates contained probe directories against a full execution commit', async () => {
    await fs.mkdir(path.join(root, 'experiments', 'probe'), { recursive: true });
    await fs.writeFile(path.join(root, 'experiments', 'probe', 'result.txt'), 'green');
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'archive@test.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Archive Test'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root })
      .toString()
      .trim();
    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: { complete: true, decisions: [] },
        probes: [{ path: 'experiments/probe', codeCommit: commit }],
      })
    );

    const projection = await resolveArchiveSidecar(active, root, 'sample');
    expect(projection.status).toBe('valid');
    expect(projection.probes).toEqual([{ path: 'experiments/probe', codeCommit: commit }]);

    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: { complete: true, decisions: [] },
        probes: [{ path: '../outside', codeCommit: commit }],
      })
    );
    const escaping = await resolveArchiveSidecar(active, root, 'sample');
    expect(escaping.status).toBe('invalid');
    expect(escaping.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'sidecar-validate' })])
    );
  });

  it('archives on a complete source-signal abort while preserving all ephemera', async () => {
    await fs.mkdir(path.join(ephemera, 'src'), { recursive: true });
    await fs.writeFile(path.join(ephemera, 'src', 'main.ts'), 'export {};\n');
    const archivePlan = await plan();

    expect(archivePlan.cleaner.classification.aborted).toBe(true);
    expect(archivePlan.cleaner.classification.complete).toBe(true);
    expect(archivePlan.cleaner.effectiveDelete).toEqual([]);
    expect(archivePlan.cleaner.effectivePreserve).toEqual(
      expect.arrayContaining(['keep.txt', 'src', 'src/main.ts', 'trace.log'])
    );
    expect(archivePlan.complete).toBe(true);

    expect((await applyArchive(archivePlan)).status).toBe('complete');
    expect(await fs.readFile(path.join(ephemera, 'trace.log'), 'utf8')).toBe('temporary\n');
    expect(await fs.readFile(path.join(ephemera, 'src', 'main.ts'), 'utf8')).toBe(
      'export {};\n'
    );
  });

  it('captures nested QA, CSO, benchmark, verification, and duplicate report names by path', async () => {
    const fixtures: Record<string, string> = {
      'evidence/qa/qa-report.md': '# QA\nScenarios: 4\n',
      'evidence/cso/security-audit.md': '# CSO\nIssues: 2\n',
      'evidence/benchmark/benchmark-report.md': '# Benchmark\nFindings: 1\n',
      'evidence/verification/verification-report.md': '# Verify\nScenarios: 3\n',
      'evidence/other/review-report.md': '# Other Review\nFindings: 5\n',
    };
    for (const [relative, content] of Object.entries(fixtures)) {
      const absolute = path.join(active, ...relative.split('/'));
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content);
    }
    const archivePlan = await plan();
    expect(archivePlan.qualityInputs.map(input => input.path)).toEqual([
      'evidence/benchmark/benchmark-report.md',
      'evidence/cso/security-audit.md',
      'evidence/nested/review-report.md',
      'evidence/other/review-report.md',
      'evidence/qa/qa-report.md',
      'evidence/verification/verification-report.md',
    ]);

    expect((await applyArchive(archivePlan)).status).toBe('complete');
    const metadata = await fs.readFile(
      path.join(archivePlan.paths.final, '.openspec.yaml'),
      'utf8'
    );
    for (const relative of archivePlan.qualityInputs.map(input => input.path)) {
      expect(metadata).toContain(relative);
    }
    const accounting = JSON.parse(
      await fs.readFile(path.join(archivePlan.paths.final, 'archive.json'), 'utf8')
    );
    expect(await hashArchiveEvidence(archivePlan.paths.final)).toEqual(accounting.evidence);
  });

  it('retains a matching failed publication transaction and resumes it idempotently', async () => {
    const archivePlan = await plan();
    let publishAttempts = 0;
    const failingAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, target: string) => {
          if (target.endsWith('.rasen-archive-published.json')) {
            publishAttempts += 1;
            const error = new Error('injected publish failure');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
          return defaultArchiveEngineAdapters.fs.link(source, target);
        },
      },
    };

    const first = await applyArchive(archivePlan, { adapters: failingAdapters });
    expect(first.status).toBe('recoverable');
    expect(publishAttempts).toBe(1);
    await expect(fs.access(active)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.final)).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(ephemera, 'trace.log'), 'utf8')).toBe('temporary\n');

    const second = await applyArchive(archivePlan);
    expect(second.status).toBe('complete');
    expect(second.resumed).toBe(true);
    await expect(fs.access(active)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      JSON.parse(await fs.readFile(archivePlan.paths.publishedJournal, 'utf8')).phase
    ).toBe('complete');

    const third = await applyArchive(archivePlan);
    expect(third.status).toBe('complete');
    expect(third.resumed).toBe(true);
  });

  it('resumes after a partial prepared-spec write without repeating completed actions', async () => {
    const deltaOne = path.join(active, 'specs', 'one', 'spec.md');
    const deltaTwo = path.join(active, 'specs', 'two', 'spec.md');
    const targetOne = path.join(root, 'rasen', 'specs', 'one', 'spec.md');
    const targetTwo = path.join(root, 'rasen', 'specs', 'two', 'spec.md');
    const rebuiltOne = '# One\n';
    const rebuiltTwo = '# Two\n';
    await fs.mkdir(path.dirname(deltaOne), { recursive: true });
    await fs.mkdir(path.dirname(deltaTwo), { recursive: true });
    await fs.writeFile(deltaOne, rebuiltOne);
    await fs.writeFile(deltaTwo, rebuiltTwo);

    const specActions: PreparedArchiveSpecAction[] = [
      {
        capability: 'one',
        action: 'create',
        source: deltaOne,
        target: targetOne,
        sourceSha256: defaultArchiveEngineAdapters.sha256(rebuiltOne),
        targetPrecondition: { state: 'absent' },
        rebuilt: rebuiltOne,
        counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
      },
      {
        capability: 'two',
        action: 'create',
        source: deltaTwo,
        target: targetTwo,
        sourceSha256: defaultArchiveEngineAdapters.sha256(rebuiltTwo),
        targetPrecondition: { state: 'absent' },
        rebuilt: rebuiltTwo,
        counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
      },
    ];
    const archivePlan = await plan({ specActions });
    let failSecondTarget = true;
    const failingAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, target: string) => {
          if (target === targetTwo && failSecondTarget) {
            failSecondTarget = false;
            const error = new Error('injected second spec publish failure');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
          return defaultArchiveEngineAdapters.fs.link(source, target);
        },
      },
    };

    const first = await applyArchive(archivePlan, { adapters: failingAdapters });
    expect(first.status).toBe('recoverable');
    expect(first.specsUpdated).toBe(true);
    expect(first.totals).toEqual({
      added: 1,
      modified: 0,
      removed: 0,
      renamed: 0,
    });
    expect(await fs.readFile(targetOne, 'utf8')).toBe(rebuiltOne);
    await expect(fs.access(targetTwo)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(active)).resolves.toBeUndefined();

    const second = await applyArchive(archivePlan);
    expect(second.status).toBe('complete');
    expect(second.resumed).toBe(true);
    expect(second.totals.added).toBe(2);
    expect(await fs.readFile(targetOne, 'utf8')).toBe(rebuiltOne);
    expect(await fs.readFile(targetTwo, 'utf8')).toBe(rebuiltTwo);
  });

  it('rejects forged complete spec progress without publication identities', async () => {
    const capability = 'forged-complete';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    const rebuilt = '# Durable spec\n';
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.writeFile(delta, rebuilt);
    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'create',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256(rebuilt),
          targetPrecondition: { state: 'absent' },
          rebuilt,
          counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
        },
      ],
    });
    expect((await applyArchive(archivePlan)).status).toBe('complete');

    const journal = JSON.parse(
      await fs.readFile(archivePlan.paths.publishedJournal, 'utf8')
    ) as {
      specProgress: Array<Record<string, unknown>>;
    };
    delete journal.specProgress[0]!.claimIdentity;
    delete journal.specProgress[0]!.temporaryIdentity;
    delete journal.specProgress[0]!.publishedIdentity;
    await fs.writeFile(
      archivePlan.paths.publishedJournal,
      `${JSON.stringify(journal, null, 2)}\n`
    );

    const retry = await applyArchive(archivePlan);

    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({ code: 'archive_journal_invalid' }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(retry.recoveryCommand).toBeUndefined();
    expect(retry.retainedPaths).toEqual(
      expect.arrayContaining([
        archivePlan.paths.active,
        archivePlan.paths.stage,
        archivePlan.paths.final,
        archivePlan.paths.publishedJournal,
      ])
    );
    expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);
  });

  it.each(['create', 'update'] as const)(
    'reconciles an exact %s target after a crash between hard-link publication and progress flush',
    async actionKind => {
      const capability = `crash-link-${actionKind}`;
      const delta = path.join(active, 'specs', capability, 'spec.md');
      const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
      const rebuilt = `# Rebuilt ${actionKind}\n`;
      await fs.mkdir(path.dirname(delta), { recursive: true });
      await fs.writeFile(delta, '# Delta\n');
      if (actionKind === 'update') {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, '# Original\n');
      }
      const archivePlan = await plan({
        specActions: [
          {
            capability,
            action: actionKind,
            source: delta,
            target,
            sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
            targetPrecondition:
              actionKind === 'create'
                ? { state: 'absent' }
                : {
                    state: 'file',
                    sha256:
                      defaultArchiveEngineAdapters.sha256('# Original\n'),
                  },
            rebuilt,
            counts:
              actionKind === 'create'
                ? { added: 1, modified: 0, removed: 0, renamed: 0 }
                : { added: 0, modified: 1, removed: 0, renamed: 0 },
          },
          ],
        });
      const globalDataDir = path.join(root, `crash-link-${actionKind}-global`);
      const token = await persistArchivePlan(archivePlan, globalDataDir);
      const storedPlanPath = path.join(
        globalDataDir,
        'archive-transactions',
        archivePlan.transactionId,
        'plan.json'
      );
      let crashAfterLink = true;
      const adapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          link: async (source: string, destination: string) => {
            await defaultArchiveEngineAdapters.fs.link(source, destination);
            if (destination === target && crashAfterLink) {
              crashAfterLink = false;
              const error = new Error('crash after spec link publication');
              (error as NodeJS.ErrnoException).code = 'EIO';
              throw error;
            }
          },
        },
      };

      const first = await withStoredArchivePlanOperation(
        archivePlan,
        globalDataDir,
        'apply',
        () => applyArchive(archivePlan, { adapters })
      );
      expect(first.status).toBe('recoverable');
      expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);
      await expect(fs.access(active)).resolves.toBeUndefined();

      const protectedBytes = new Map(
        await Promise.all(
          [
            target,
            delta,
            path.join(archivePlan.paths.stage, 'proposal.md'),
            archivePlan.paths.journal,
            storedPlanPath,
          ].map(async protectedPath => [
            protectedPath,
            await fs.readFile(protectedPath),
          ] as const)
        )
      );
      const activeTreeBeforeAbort = await hashDirectoryTree(active);
      const stageTreeBeforeAbort = await hashDirectoryTree(
        archivePlan.paths.stage
      );
      const refused = await withStoredArchivePlanOperation(
        archivePlan,
        globalDataDir,
        'abort',
        () => abortArchivePlan(archivePlan, globalDataDir)
      );
      expect(refused).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({ code: 'archive_abort_phase_unsafe' }),
        ],
        recoveryCommand: `rasen archive --apply-plan ${token} --yes`,
        retainedPaths: expect.arrayContaining([
          target,
          active,
          archivePlan.paths.stage,
          archivePlan.paths.journal,
        ]),
      });
      for (const [protectedPath, before] of protectedBytes) {
        await expect(fs.readFile(protectedPath)).resolves.toEqual(before);
      }
      expect(await hashDirectoryTree(active)).toBe(activeTreeBeforeAbort);
      expect(await hashDirectoryTree(archivePlan.paths.stage)).toBe(
        stageTreeBeforeAbort
      );

      const retry = await withStoredArchivePlanOperation(
        archivePlan,
        globalDataDir,
        'apply',
        () => applyArchive(archivePlan)
      );
      expect(retry.status).toBe('complete');
      expect(retry.resumed).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);
      await expect(fs.access(active)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('reconciles update cleanup after backup unlink but before completion flush', async () => {
    const capability = 'crash-backup-unlink';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    const rebuilt = '# Rebuilt update\n';
    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'update',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt,
          counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
        },
      ],
    });
    const actionId = archivePlan.specActions[0].actionId!;
    const claimRoot = path.join(
      path.dirname(target),
      `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
    );
    const backup = path.join(claimRoot, 'original');
    let crashAfterUnlink = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        unlink: async (candidate: string) => {
          await defaultArchiveEngineAdapters.fs.unlink(candidate);
          if (candidate === backup && crashAfterUnlink) {
            crashAfterUnlink = false;
            const error = new Error('crash after spec backup unlink');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
        },
      },
    };

    const first = await applyArchive(archivePlan, { adapters: adapters });
    expect(first.status).toBe('recoverable');
    expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);
    await expect(fs.access(backup)).rejects.toMatchObject({ code: 'ENOENT' });

    const retry = await applyArchive(archivePlan);
    expect(retry).toMatchObject({
      status: 'complete',
      resumed: true,
      blockers: [],
    });
    expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);
    await expect(fs.access(claimRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('keeps verified spec claim intruders on manual recovery across exact retries', async () => {
    const capability = 'verified-claim-intruder';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'update',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '# Rebuilt\n',
          counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
        },
      ],
    });
    const actionId = archivePlan.specActions[0].actionId!;
    const claimRoot = path.join(
      path.dirname(target),
      `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
    );
    const backup = path.join(claimRoot, 'original');
    const intruder = path.join(claimRoot, 'intruder');
    let inject = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rmdir: async (candidate: string) => {
          if (candidate === claimRoot && inject) {
            inject = false;
            await fs.writeFile(intruder, 'unrelated\n');
          }
          return defaultArchiveEngineAdapters.fs.rmdir(candidate);
        },
      },
    };

    const first = await applyArchive(archivePlan, { adapters });
    const retry = await applyArchive(archivePlan);

    for (const result of [first, retry]) {
      expect(result).toMatchObject({
        status: 'recoverable',
        manualRecoveryAction: { kind: 'manual-recovery-required' },
        retainedPaths: expect.arrayContaining([
          claimRoot,
          intruder,
          delta,
          target,
          archivePlan.paths.journal,
        ]),
        blockers: [
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_claim_ownership_unverified',
          }),
        ],
      });
      expect(result.recoveryCommand).toBeUndefined();
      expect(result.abortCommand).toBeUndefined();
    }
    expect(await fs.readFile(intruder, 'utf8')).toBe('unrelated\n');
    expect(await fs.readFile(target, 'utf8')).toBe('# Rebuilt\n');
  }, 120_000);

  it('completes an exact update retry after claim-root removal wins before the journal flush', async () => {
    const capability = 'claim-rmdir-update';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'update',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '# Rebuilt\n',
          counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
        },
      ],
    });
    const actionId = archivePlan.specActions[0].actionId!;
    const claimRoot = path.join(
      path.dirname(target),
      `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
    );
    let crash = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rmdir: async (candidate: string) => {
          await defaultArchiveEngineAdapters.fs.rmdir(candidate);
          if (candidate === claimRoot && crash) {
            crash = false;
            const error = new Error('crash after update claim-root removal');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
        },
      },
    };

    const first = await applyArchive(archivePlan, { adapters });
    expect(first.status).toBe('recoverable');
    await expect(fs.access(claimRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    const retry = await applyArchive(archivePlan);
    expect(retry).toMatchObject({ status: 'complete', resumed: true });
    expect(await fs.readFile(target, 'utf8')).toBe('# Rebuilt\n');
  }, 120_000);

  it('completes an exact delete retry after claim-root removal wins before the journal flush', async () => {
    const capability = 'claim-rmdir-delete';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delete\n');
    await fs.writeFile(target, '# Original\n');
    const archivePlan = await plan({
      keepEphemera: true,
      specActions: [
        {
          capability,
          action: 'delete',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delete\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '',
          counts: { added: 0, modified: 0, removed: 1, renamed: 0 },
        },
      ],
    });
    const actionId = archivePlan.specActions[0].actionId!;
    const claimRoot = path.join(
      path.dirname(path.dirname(target)),
      `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
    );
    let crash = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rmdir: async (candidate: string) => {
          await defaultArchiveEngineAdapters.fs.rmdir(candidate);
          if (candidate === claimRoot && crash) {
            crash = false;
            const error = new Error('crash after delete claim-root removal');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
        },
      },
    };

    const first = await applyArchive(archivePlan, { adapters });
    expect(first.status).toBe('recoverable');
    await expect(fs.access(claimRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    const retry = await applyArchive(archivePlan);
    expect(retry).toMatchObject({
      status: 'complete',
      resumed: true,
      blockers: [],
    });
    await expect(fs.access(path.dirname(target))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 120_000);

  it('preserves a concurrent spec create at the no-replace publication boundary', async () => {
    const delta = path.join(active, 'specs', 'race-create', 'spec.md');
    const target = path.join(root, 'rasen', 'specs', 'race-create', 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability: 'race-create',
          action: 'create',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: { state: 'absent' },
          rebuilt: '# Planned\n',
          counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
        },
      ],
    });
    let inject = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, destination: string) => {
          if (destination === target && inject) {
            inject = false;
            await fs.writeFile(target, '# Concurrent\n');
          }
          return defaultArchiveEngineAdapters.fs.link(source, destination);
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters: adapters });
    expect(result.status).toBe('recoverable');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'spec', code: 'EEXIST' }),
      ])
    );
    expect(await fs.readFile(target, 'utf8')).toBe('# Concurrent\n');
    await expect(fs.access(active)).resolves.toBeUndefined();
  });

  it('preserves a concurrent spec update target and the claimed original', async () => {
    const delta = path.join(active, 'specs', 'race-update', 'spec.md');
    const target = path.join(root, 'rasen', 'specs', 'race-update', 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability: 'race-update',
          action: 'update',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '# Planned\n',
          counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
        },
      ],
    });
    let inject = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, destination: string) => {
          if (destination === target && inject) {
            inject = false;
            await fs.writeFile(target, '# Concurrent\n');
          }
          return defaultArchiveEngineAdapters.fs.link(source, destination);
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters: adapters });
    expect(result.status).toBe('recoverable');
    expect(await fs.readFile(target, 'utf8')).toBe('# Concurrent\n');
    const journal = JSON.parse(await fs.readFile(archivePlan.paths.journal, 'utf8'));
    const backup = journal.specProgress[0].backupOrQuarantine as string;
    expect(await fs.readFile(backup, 'utf8')).toBe('# Original\n');
  });

  it('retains a claimed spec-delete quarantine when a child identity is swapped', async () => {
    const delta = path.join(active, 'specs', 'race-delete', 'spec.md');
    const target = path.join(root, 'rasen', 'specs', 'race-delete', 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    await fs.writeFile(path.join(path.dirname(target), 'notes.md'), 'keep\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability: 'race-delete',
          action: 'delete',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '',
          counts: { added: 0, modified: 0, removed: 1, renamed: 0 },
        },
      ],
    });
    let swapped = false;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rename: async (source: string, destination: string) => {
          await defaultArchiveEngineAdapters.fs.rename(source, destination);
          if (source === path.dirname(target) && !swapped) {
            swapped = true;
            const claimedSpec = path.join(destination, 'spec.md');
            const bytes = await fs.readFile(claimedSpec);
            await fs.rm(claimedSpec);
            await fs.writeFile(claimedSpec, bytes);
          }
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters: adapters });
    expect(result.status).toBe('recoverable');
    const journal = JSON.parse(await fs.readFile(archivePlan.paths.journal, 'utf8'));
    const quarantine = journal.specProgress[0].backupOrQuarantine as string;
    await expect(fs.access(quarantine)).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(quarantine, 'spec.md'), 'utf8')).toBe(
      '# Original\n'
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a precreated symlink at the deterministic spec-delete claim root',
    async () => {
      const capability = 'delete-claim-symlink';
      const delta = path.join(active, 'specs', capability, 'spec.md');
      const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
      await fs.mkdir(path.dirname(delta), { recursive: true });
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(delta, '# Delta\n');
      await fs.writeFile(target, '# Original\n');
      const archivePlan = await plan({
        specActions: [
          {
            capability,
            action: 'delete',
            source: delta,
            target,
            sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
            targetPrecondition: {
              state: 'file',
              sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
            },
            rebuilt: '',
            counts: { added: 0, modified: 0, removed: 1, renamed: 0 },
          },
        ],
      });
      const actionId = archivePlan.specActions[0].actionId!;
      const claimRoot = path.join(
        path.dirname(path.dirname(target)),
        `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
      );
      const unrelated = path.join(root, 'unrelated-spec-claim');
      await fs.mkdir(unrelated);
      await fs.writeFile(path.join(unrelated, 'keep.txt'), 'keep\n');
      await fs.symlink(unrelated, claimRoot, 'dir');

      const result = await applyArchive(archivePlan);

      expect(result).toMatchObject({
        status: 'recoverable',
        manualRecoveryAction: { kind: 'manual-recovery-required' },
        retainedPaths: expect.arrayContaining([claimRoot]),
        blockers: [
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_claim_ownership_unverified',
          }),
        ],
      });
      expect(await fs.readFile(target, 'utf8')).toBe('# Original\n');
      expect(await fs.readFile(path.join(unrelated, 'keep.txt'), 'utf8')).toBe(
        'keep\n'
      );
    }
  );

  it('retains a spec-delete payload when its durable claim root is replaced after a crash', async () => {
    const capability = 'delete-claim-swap';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'delete',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '',
          counts: { added: 0, modified: 0, removed: 1, renamed: 0 },
        },
      ],
    });
    const actionId = archivePlan.specActions[0].actionId!;
    const claimRoot = path.join(
      path.dirname(path.dirname(target)),
      `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
    );
    const quarantine = path.join(claimRoot, capability);
    let crash = true;
    const crashingAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rename: async (source: string, destination: string) => {
          await defaultArchiveEngineAdapters.fs.rename(source, destination);
          if (source === path.dirname(target) && crash) {
            crash = false;
            const error = new Error('crash after spec delete claim');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
        },
      },
    };
    expect((await applyArchive(archivePlan, { adapters: crashingAdapters })).status).toBe(
      'recoverable'
    );
    const displaced = `${claimRoot}.displaced`;
    await fs.rename(claimRoot, displaced);
    await fs.mkdir(claimRoot);
    await fs.writeFile(path.join(claimRoot, 'unrelated.txt'), 'unrelated\n');

    const retry = await applyArchive(archivePlan);

    expect(retry).toMatchObject({
      status: 'recoverable',
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([claimRoot]),
      blockers: [
        expect.objectContaining({
          operation: 'spec',
          code: 'archive_claim_ownership_unverified',
        }),
      ],
    });
    expect(
      await fs.readFile(path.join(displaced, capability, 'spec.md'), 'utf8')
    ).toBe('# Original\n');
    expect(await fs.readFile(path.join(claimRoot, 'unrelated.txt'), 'utf8')).toBe(
      'unrelated\n'
    );
    await expect(fs.access(quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves an injected update backup at the exclusive claim boundary', async () => {
    const capability = 'update-backup-race';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'update',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '# Rebuilt\n',
          counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
        },
      ],
    });
    const actionId = archivePlan.specActions[0].actionId!;
    const claimRoot = path.join(
      path.dirname(target),
      `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
    );
    const backup = path.join(claimRoot, 'original');
    let inject = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, destination: string) => {
          if (destination === backup && inject) {
            inject = false;
            await fs.writeFile(backup, '# Injected\n');
          }
          return defaultArchiveEngineAdapters.fs.link(source, destination);
        },
      },
    };

    const result = await applyArchive(archivePlan, { adapters });

    expect(result).toMatchObject({
      status: 'recoverable',
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([target, backup]),
      blockers: [
        expect.objectContaining({
          operation: 'spec',
          code: 'archive_claim_ownership_unverified',
        }),
      ],
    });
    expect(await fs.readFile(target, 'utf8')).toBe('# Original\n');
    expect(await fs.readFile(backup, 'utf8')).toBe('# Injected\n');
  });

  it('resumes an update crash with target and backup hard-linked to the same claimed object', async () => {
    const capability = 'update-backup-resume';
    const delta = path.join(active, 'specs', capability, 'spec.md');
    const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(delta, '# Delta\n');
    await fs.writeFile(target, '# Original\n');
    const archivePlan = await plan({
      specActions: [
        {
          capability,
          action: 'update',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
          targetPrecondition: {
            state: 'file',
            sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
          },
          rebuilt: '# Rebuilt\n',
          counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
        },
      ],
    });
    const actionId = archivePlan.specActions[0].actionId!;
    const claimRoot = path.join(
      path.dirname(target),
      `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
    );
    const backup = path.join(claimRoot, 'original');
    let crash = true;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        link: async (source: string, destination: string) => {
          await defaultArchiveEngineAdapters.fs.link(source, destination);
          if (destination === backup && crash) {
            crash = false;
            const error = new Error('crash after exclusive update backup claim');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
        },
      },
    };

    expect((await applyArchive(archivePlan, { adapters })).status).toBe('recoverable');
    const [targetStat, backupStat] = await Promise.all([
      fs.lstat(target),
      fs.lstat(backup),
    ]);
    expect(targetStat.ino).toBe(backupStat.ino);

    const retry = await applyArchive(archivePlan);

    expect(retry.status).toBe('complete');
    expect(retry.resumed).toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('# Rebuilt\n');
    await expect(fs.access(claimRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an update target-parent symlink swap immediately after recursive mkdir',
    async () => {
      const capability = 'update-parent-swap';
      const delta = path.join(active, 'specs', capability, 'spec.md');
      const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
      const targetParent = path.dirname(target);
      await fs.mkdir(path.dirname(delta), { recursive: true });
      await fs.mkdir(targetParent, { recursive: true });
      await fs.writeFile(delta, '# Delta\n');
      await fs.writeFile(target, '# Original\n');
      const archivePlan = await plan({
        specActions: [
          {
            capability,
            action: 'update',
            source: delta,
            target,
            sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
            targetPrecondition: {
              state: 'file',
              sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
            },
            rebuilt: '# Rebuilt\n',
            counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
          },
        ],
      });
      const displaced = `${targetParent}.displaced`;
      const external = path.join(root, 'external-update-parent');
      await fs.mkdir(external);
      await fs.writeFile(path.join(external, 'unrelated.txt'), 'unrelated\n');
      let targetParentStats = 0;
      const adapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          lstat: async (targetPath: string) => {
            if (targetPath === targetParent) {
              targetParentStats += 1;
              if (targetParentStats === 2) {
                await fs.rename(targetParent, displaced);
                await fs.symlink(external, targetParent, 'dir');
              }
            }
            return defaultArchiveEngineAdapters.fs.lstat(targetPath);
          },
        },
      };

      const result = await applyArchive(archivePlan, { adapters });

      expect(result).toMatchObject({
        status: 'recoverable',
        blockers: [
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_spec_path_unauthorized',
          }),
        ],
      });
      expect(await fs.readFile(path.join(displaced, 'spec.md'), 'utf8')).toBe(
        '# Original\n'
      );
      expect(await fs.readFile(path.join(external, 'unrelated.txt'), 'utf8')).toBe(
        'unrelated\n'
      );
      await expect(fs.access(path.join(external, 'result.tmp'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a delete claim-parent symlink swap before the capability rename',
    async () => {
      const capability = 'delete-parent-swap';
      const delta = path.join(active, 'specs', capability, 'spec.md');
      const target = path.join(root, 'rasen', 'specs', capability, 'spec.md');
      const claimParent = path.dirname(path.dirname(target));
      await fs.mkdir(path.dirname(delta), { recursive: true });
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(delta, '# Delta\n');
      await fs.writeFile(target, '# Original\n');
      const archivePlan = await plan({
        specActions: [
          {
            capability,
            action: 'delete',
            source: delta,
            target,
            sourceSha256: defaultArchiveEngineAdapters.sha256('# Delta\n'),
            targetPrecondition: {
              state: 'file',
              sha256: defaultArchiveEngineAdapters.sha256('# Original\n'),
            },
            rebuilt: '',
            counts: { added: 0, modified: 0, removed: 1, renamed: 0 },
          },
        ],
      });
      const actionId = archivePlan.specActions[0].actionId!;
      const claimRoot = path.join(
        claimParent,
        `.rasen-archive-spec-${archivePlan.transactionId}-${actionId.slice(0, 12)}`
      );
      const displaced = `${claimParent}.displaced`;
      const external = path.join(root, 'external-delete-parent');
      await fs.mkdir(external);
      await fs.writeFile(path.join(external, 'unrelated.txt'), 'unrelated\n');
      let swap = true;
      const adapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          mkdir: async (
            targetPath: string,
            options?: { recursive?: boolean }
          ) => {
            const result = await defaultArchiveEngineAdapters.fs.mkdir(
              targetPath,
              options
            );
            if (targetPath === claimRoot && !options?.recursive && swap) {
              swap = false;
              await fs.rename(claimParent, displaced);
              await fs.symlink(external, claimParent, 'dir');
            }
            return result;
          },
        },
      };

      const result = await applyArchive(archivePlan, { adapters });

      expect(result.status).toBe('recoverable');
      expect(result.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'spec',
            code: 'archive_claim_ownership_unverified',
          }),
        ])
      );
      expect(
        await fs.readFile(path.join(displaced, capability, 'spec.md'), 'utf8')
      ).toBe('# Original\n');
      expect(await fs.readFile(path.join(external, 'unrelated.txt'), 'utf8')).toBe(
        'unrelated\n'
      );
    }
  );

  it('retires an unapplied stored plan and rejects later apply idempotently', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    const token = await persistArchivePlan(archivePlan, globalDataDir);
    const activeBefore = await hashDirectoryTree(active);
    const ephemeraBefore = await hashDirectoryTree(ephemera);

    const aborted = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );

    expect(aborted.status).toBe('aborted');
    expect(await hashDirectoryTree(active)).toBe(activeBefore);
    expect(await hashDirectoryTree(ephemera)).toBe(ephemeraBefore);
    await expect(fs.access(archivePlan.paths.final)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fs.access(
        path.join(
          globalDataDir,
          'archive-transactions',
          archivePlan.transactionId,
          'plan.json'
        )
      )
    ).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(
      withStoredArchivePlanOperation(
        archivePlan,
        globalDataDir,
        'apply',
        () => applyArchive(archivePlan)
      )
    ).rejects.toMatchObject({ code: 'archive_plan_aborted' });
    await expect(
      loadCompletedArchiveAbort(token, globalDataDir)
    ).resolves.toMatchObject({
      status: 'already-aborted',
      transactionId: archivePlan.transactionId,
      blockers: [],
    });
  });

  it('retains malformed and unknown-field abort tombstones as transaction-store ownership conflicts', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    const token = await persistArchivePlan(archivePlan, globalDataDir);
    const transactionDirectory = path.join(
      globalDataDir,
      'archive-transactions',
      archivePlan.transactionId
    );
    const tombstonePath = path.join(transactionDirectory, 'abort.json');
    const storedPlanPath = path.join(transactionDirectory, 'plan.json');
    await fs.writeFile(tombstonePath, '{not-json\n');

    const malformed = await loadCompletedArchiveAbort(token, globalDataDir);
    expect(malformed).toMatchObject({
      status: 'blocked',
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      blockers: [
        expect.objectContaining({
          operation: 'journal',
          path: tombstonePath,
          code: 'archive_transaction_store_ownership_unverified',
        }),
      ],
    });
    expect(malformed).not.toHaveProperty('recoveryCommand');
    expect(malformed?.retainedPaths).toEqual(
      expect.arrayContaining([
        tombstonePath,
        storedPlanPath,
        archivePlan.paths.stage,
        archivePlan.paths.final,
      ])
    );

    await fs.writeFile(
      tombstonePath,
      `${JSON.stringify({ schemaVersion: 1, unexpected: true })}\n`
    );
    const unknownField = await abortArchivePlan(archivePlan, globalDataDir);
    expect(unknownField).toMatchObject({
      status: 'blocked',
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      blockers: [
        expect.objectContaining({
          operation: 'journal',
          path: tombstonePath,
          code: 'archive_transaction_store_ownership_unverified',
        }),
      ],
    });
    expect(unknownField).not.toHaveProperty('recoveryCommand');
    await expect(fs.readFile(tombstonePath, 'utf8')).resolves.toContain(
      '"unexpected":true'
    );
    await expect(fs.access(storedPlanPath)).resolves.toBeUndefined();
  });

  it('records a reserved ship-log section as a typed planning blocker', async () => {
    const source = path.join(active, 'evidence', 'ship-log.md');
    const content =
      '# Ship Log\r\n\r\n## Archive\r\nchange-authored placeholder\r\n';
    expect(hasReservedArchiveShipLogSection(content)).toBe(true);
    await fs.writeFile(source, content);

    const archivePlan = await plan({
      shipLog: {
        source,
        sha256: defaultArchiveEngineAdapters.sha256(content),
        recordedCommit: null,
        reservedSection: true,
      },
    });

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.blockers).toEqual([
      expect.objectContaining({
        operation: 'evidence',
        code: 'archive_ship_log_reserved_section',
        path: source,
        message: expect.stringContaining('Remove or rename'),
      }),
    ]);
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(archivePlan.paths.journal)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('blocks abort on same-transaction archive scratch debris without cleanup', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    await fs.mkdir(archivePlan.paths.archiveParent, { recursive: true });
    const scratch = path.join(
      archivePlan.paths.archiveParent,
      `.rasen-archive-projection-${archivePlan.transactionId}-orphan`
    );
    await fs.writeFile(scratch, 'unowned scratch\n');
    const storedPlanPath = path.join(
      globalDataDir,
      'archive-transactions',
      archivePlan.transactionId,
      'plan.json'
    );

    const result = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        {
          operation: 'journal',
          path: scratch,
          code: 'archive_transaction_temp_ownership_unverified',
        },
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
      retainedPaths: expect.arrayContaining([
        scratch,
        archivePlan.paths.stage,
        archivePlan.paths.journal,
        storedPlanPath,
      ]),
    });
    expect(result.recoveryCommand).toBeUndefined();
    await expect(fs.readFile(scratch, 'utf8')).resolves.toBe(
      'unowned scratch\n'
    );
    await expect(fs.access(storedPlanPath)).resolves.toBeUndefined();
  });

  it('maps a preexisting abort temporary to structured manual recovery', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    const transactionDirectory = path.join(
      globalDataDir,
      'archive-transactions',
      archivePlan.transactionId
    );
    const tombstonePath = path.join(transactionDirectory, 'abort.json');
    const abortTemporary = path.join(
      transactionDirectory,
      `.abort.json.tmp-${archivePlan.transactionId}-orphan`
    );
    const storedPlanPath = path.join(transactionDirectory, 'plan.json');
    await fs.writeFile(abortTemporary, '{"partial":true}\n');

    const result = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        {
          operation: 'journal',
          path: abortTemporary,
          code: 'archive_transaction_temp_ownership_unverified',
        },
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
      retainedPaths: expect.arrayContaining([
        abortTemporary,
        tombstonePath,
        archivePlan.paths.stage,
        archivePlan.paths.journal,
        storedPlanPath,
      ]),
    });
    expect(result.recoveryCommand).toBeUndefined();
    await expect(fs.readFile(abortTemporary, 'utf8')).resolves.toBe(
      '{"partial":true}\n'
    );
    await expect(fs.access(storedPlanPath)).resolves.toBeUndefined();
    await expect(fs.access(tombstonePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('classifies a plan-bound ship-log collision as abort-required and removes its owned early stage', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\r\n\r\n## Archive\r\nold transaction\r\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    const token = await persistArchivePlan(archivePlan, globalDataDir);
    const activeBefore = await hashDirectoryTree(active);

    const failed = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'apply',
      () => applyArchive(archivePlan)
    );
    expect(failed).toMatchObject({
      status: 'abort-required',
      abortCommand: `rasen archive --abort-plan ${token} --yes`,
      blockers: [
        expect.objectContaining({
          code: 'archive_ship_log_reserved_section',
        }),
      ],
    });
    expect(failed.recoveryCommand).toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();

    const aborted = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );
    expect(aborted.status).toBe('aborted');
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(archivePlan.paths.journal)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await hashDirectoryTree(active)).toBe(activeBefore);
    await expect(
      loadCompletedArchiveAbort(token, globalDataDir)
    ).resolves.toMatchObject({ status: 'already-aborted' });
  });

  describe.runIf(process.platform === 'win32')(
    'native Windows stored-abort path identity',
    () => {
      async function prepareEarlyAbort(): Promise<{
        archivePlan: ArchivePlan;
        globalDataDir: string;
      }> {
        await fs.writeFile(
          path.join(active, 'evidence', 'ship-log.md'),
          '# Ship Log\r\n\r\n## Archive\r\nold transaction\r\n'
        );
        const archivePlan = await plan();
        const globalDataDir = path.join(root, 'windows-abort-global');
        await persistArchivePlan(archivePlan, globalDataDir);
        const failed = await withStoredArchivePlanOperation(
          archivePlan,
          globalDataDir,
          'apply',
          () => applyArchive(archivePlan)
        );
        expect(failed.status).toBe('abort-required');
        return { archivePlan, globalDataDir };
      }

      async function prepareStoreEarlyAbort(): Promise<{
        archivePlan: ArchivePlan;
        globalDataDir: string;
        planningScopeId: string;
        associationPath: string;
      }> {
        const storeUid = '6f7d4d70-3d2c-4a37-9f8a-0f4c1b2e3d55';
        const projectId = 'app-a';
        const targetLineId = 'line-0.2';
        const planningScopeId = derivePlanningScopeId({
          storeUid,
          projectId,
          targetLineId,
        });
        const changeInstanceId = deriveChangeInstanceId({
          planningScopeId,
          instanceSeed: 'a'.repeat(32),
        });
        const planningWorktreeInstanceId = deriveWorktreeInstanceId({
          repositoryIdentity: 'store-repo',
          worktreeIdentity: 'planning',
        });
        const executionWorktreeInstanceId = deriveWorktreeInstanceId({
          repositoryIdentity: 'code-repo',
          worktreeIdentity: 'execution',
        });
        const workspacePairId = deriveWorkspacePairId({
          changeInstanceId,
          planningWorktreeInstanceId,
          executionWorktreeInstanceId,
        });
        const storeArchiveParent = resolveStorePlanningLayoutV2Path(root, {
          kind: 'archive-line',
          projectId,
          targetLineId,
        });
        const destination = resolveStorePlanningLayoutV2Path(root, {
          kind: 'archive-entry',
          projectId,
          targetLineId,
          changeId: 'sample',
          archiveDate: '2026-07-31',
          changeInstanceId,
        });
        const associationPath = path.join(
          root,
          '.rasen',
          'planning-binding.json'
        );
        const finalization: ArchivePlanFinalization = {
          outcome: 'abandoned',
          record: {
            schemaVersion: 2,
            implementation: 'code',
            storeUid,
            projectId,
            targetLineId,
            changeId: 'sample',
            changeInstanceId,
            workspacePairId,
            outcome: 'abandoned',
            reason: 'Not pursued.',
            supersededBy: null,
            planning: {
              worktreeInstanceId: planningWorktreeInstanceId,
              sourceRef: 'refs/heads/change/line-0.2/app-a/sample',
              sourceHead: 'a'.repeat(40),
              targetRef: 'refs/heads/release/0.2',
            },
            codeMerge: null,
            specSync: { applied: false, actions: [] },
            archivedAt: '2026-07-31T00:00:00.000Z',
          },
          identity: {
            planningScopeId,
            instanceSeed: 'a'.repeat(32),
            planningWorktreeInstanceId,
            executionWorktreeInstanceId,
          },
          destination,
          association: {
            noop: false,
            planningScopeId,
            changeId: 'sample',
            executionAssociationPath: associationPath,
            globalDataDir: path.join(root, 'association-global'),
          },
          revalidation: {
            targetLine: {
              catalogPath: path.join(
                root,
                '.rasen-store',
                'target-lines',
                `${targetLineId}.yaml`
              ),
              catalogDigest: 'b'.repeat(64),
              codeRef: null,
              codeRefOid: null,
            },
            archive: {
              root: storeArchiveParent,
              archiveDate: '2026-07-31',
              destination,
            },
          },
          lockKeys: [],
        };
        await fs.writeFile(
          path.join(active, 'evidence', 'ship-log.md'),
          '# Ship Log\r\n\r\n## Archive\r\nold transaction\r\n'
        );
        const sidecar = await resolveArchiveSidecar(
          active,
          root,
          'sample'
        );
        const archivePlan = await createArchivePlan({
          change: 'sample',
          planningRoot: root,
          executionRoot: root,
          scope: { kind: 'store-project', storeUid, projectId },
          activePath: active,
          archiveParent: storeArchiveParent,
          ephemeraPath: ephemera,
          date: '2026-07-31',
          keepEphemera: false,
          validation: 'passed',
          tasks: { total: 1, completed: 1, override: false },
          timing: {
            mode: 'on-merge',
            deliveryMode: 'local',
            override: false,
          },
          specActions: [],
          sidecar,
          transactionId: '11111111-1111-4111-8111-111111111111',
          createdAt: '2026-07-31T00:00:00.000Z',
          finalization,
        });
        const globalDataDir = path.join(root, 'store-windows-abort-global');
        await persistArchivePlan(archivePlan, globalDataDir);
        const failed = await withStoredArchivePlanOperation(
          archivePlan,
          globalDataDir,
          'apply',
          () => applyArchive(archivePlan)
        );
        expect(failed.status).toBe('abort-required');
        return {
          archivePlan,
          globalDataDir,
          planningScopeId,
          associationPath,
        };
      }

      it.each([
        [
          'drive-letter case',
          'activePath',
          (value: string) => {
            const drive = value[0]!;
            const alias =
              drive === drive.toUpperCase()
                ? drive.toLowerCase()
                : drive.toUpperCase();
            return `${alias}${value.slice(1)}`;
          },
        ],
        [
          'mixed separators',
          'stagePath',
          (value: string) => value.replace('\\', '/'),
        ],
        [
          'dot segments',
          'finalPath',
          (value: string) =>
            `${path.dirname(value)}${path.sep}.${path.sep}${path.basename(value)}`,
        ],
        [
          'case-only stage basename',
          'stagePath',
          (value: string) =>
            value.replace(
              '.rasen-archive-stage-',
              '.RASEN-ARCHIVE-STAGE-'
            ),
        ],
      ] as const)(
        'accepts equivalent %s evidence but cleans only plan-derived targets',
        async (_label, field, alias) => {
          const { archivePlan, globalDataDir } = await prepareEarlyAbort();
          const journal = JSON.parse(
            await fs.readFile(archivePlan.paths.journal, 'utf8')
          ) as Record<string, unknown>;
          journal[field] = alias(journal[field] as string);
          await fs.writeFile(
            archivePlan.paths.journal,
            `${JSON.stringify(journal, null, 2)}\n`
          );
          const sibling = `${archivePlan.paths.stage}-sibling`;
          const sentinel = path.join(sibling, 'sentinel.txt');
          await fs.mkdir(sibling);
          await fs.writeFile(sentinel, 'outside survives\n');

          const result = await withStoredArchivePlanOperation(
            archivePlan,
            globalDataDir,
            'abort',
            () => abortArchivePlan(archivePlan, globalDataDir)
          );

          expect(result).toMatchObject({ status: 'aborted', blockers: [] });
          await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
            code: 'ENOENT',
          });
          await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe(
            'outside survives\n'
          );
          const tombstone = JSON.parse(
            await fs.readFile(result.tombstonePath, 'utf8')
          );
          expect(tombstone.stagePath).toBe(archivePlan.paths.stage);
          expect(tombstone.journalPath).toBe(archivePlan.paths.journal);
        }
      );

      it('accepts a case-only source-progress carrier through actual abort dispatch', async () => {
        const { archivePlan, globalDataDir } = await prepareEarlyAbort();
        const journal = JSON.parse(
          await fs.readFile(archivePlan.paths.journal, 'utf8')
        ) as {
          sourceProgress: { quarantine: string };
        };
        journal.sourceProgress.quarantine = journal.sourceProgress.quarantine.replace(
          `${path.sep}sample`,
          `${path.sep}SAMPLE`
        );
        await fs.writeFile(
          archivePlan.paths.journal,
          `${JSON.stringify(journal, null, 2)}\n`
        );

        const result = await withStoredArchivePlanOperation(
          archivePlan,
          globalDataDir,
          'abort',
          () => abortArchivePlan(archivePlan, globalDataDir)
        );

        expect(result).toMatchObject({ status: 'aborted', blockers: [] });
      });

      it.each(['sibling', 'traversal'] as const)(
        'refuses a %s source-progress carrier and preserves the outside sentinel',
        async spelling => {
          const { archivePlan, globalDataDir } = await prepareEarlyAbort();
          const outside = path.join(
            path.dirname(active),
            `source-progress-${spelling}`
          );
          const sentinel = path.join(outside, 'sentinel.txt');
          await fs.mkdir(outside);
          await fs.writeFile(sentinel, 'outside survives\n');
          const journal = JSON.parse(
            await fs.readFile(archivePlan.paths.journal, 'utf8')
          ) as {
            sourceProgress: { quarantine: string };
          };
          journal.sourceProgress.quarantine =
            spelling === 'sibling'
              ? outside
              : `${active}${path.sep}..${path.sep}${path.basename(outside)}`;
          await fs.writeFile(
            archivePlan.paths.journal,
            `${JSON.stringify(journal, null, 2)}\n`
          );

          const result = await withStoredArchivePlanOperation(
            archivePlan,
            globalDataDir,
            'abort',
            () => abortArchivePlan(archivePlan, globalDataDir)
          );

          expect(result).toMatchObject({
            status: 'blocked',
            blockers: [
              expect.objectContaining({
                code: 'archive_abort_journal_plan_mismatch',
              }),
            ],
          });
          await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe(
            'outside survives\n'
          );
        }
      );

      it('accepts case-only association carriers through actual abort dispatch', async () => {
        const {
          archivePlan,
          globalDataDir,
          planningScopeId,
          associationPath,
        } = await prepareStoreEarlyAbort();
        const journal = JSON.parse(
          await fs.readFile(archivePlan.paths.journal, 'utf8')
        ) as {
          associationProgress: {
            path: string;
            state: string;
            carriers?: unknown[];
          };
          sourceProgress: { quarantine: string };
        };
        const indexTarget = path.join(
          root,
          'association-global',
          'INDEX',
          `${planningScopeId.toUpperCase()}.JSON`
        );
        const carrierIdentity = {
          dev: '1',
          ino: '2',
          mode: 0o100600,
          size: '1',
        };
        journal.associationProgress.path = associationPath.replace(
          'planning-binding.json',
          'PLANNING-BINDING.JSON'
        );
        journal.associationProgress.state = 'intent-durable';
        journal.associationProgress.carriers = [
          {
            target: indexTarget,
            contentDigest: 'c'.repeat(64),
            directory: {
              path: path.dirname(indexTarget),
              identity: carrierIdentity,
            },
            intent: {
              path: `${indexTarget}.INTENT`,
              identity: carrierIdentity,
            },
            claim: {
              path: `${indexTarget}.CLAIM`,
              identity: carrierIdentity,
            },
          },
        ];
        journal.sourceProgress.quarantine = journal.sourceProgress.quarantine.replace(
          `${path.sep}sample`,
          `${path.sep}SAMPLE`
        );
        await fs.writeFile(
          archivePlan.paths.journal,
          `${JSON.stringify(journal, null, 2)}\n`
        );

        const result = await withStoredArchivePlanOperation(
          archivePlan,
          globalDataDir,
          'abort',
          () => abortArchivePlan(archivePlan, globalDataDir)
        );

        expect(result).toMatchObject({
          status: 'blocked',
          blockers: [
            expect.objectContaining({ code: 'archive_abort_phase_unsafe' }),
          ],
        });
      });

      it.each(['sibling', 'traversal'] as const)(
        'refuses a %s association carrier and preserves the outside sentinel',
        async spelling => {
          const {
            archivePlan,
            globalDataDir,
            planningScopeId,
          } = await prepareStoreEarlyAbort();
          const outside = path.join(
            root,
            `association-carrier-${spelling}`
          );
          const sentinel = path.join(outside, 'sentinel.txt');
          await fs.mkdir(outside);
          await fs.writeFile(sentinel, 'outside survives\n');
          const journal = JSON.parse(
            await fs.readFile(archivePlan.paths.journal, 'utf8')
          ) as {
            associationProgress: {
              state: string;
              carriers?: unknown[];
            };
          };
          const indexRoot = path.join(root, 'association-global', 'index');
          const carrierTarget =
            spelling === 'sibling'
              ? path.join(indexRoot, `${planningScopeId}-sibling.json`)
              : `${indexRoot}${path.sep}nested${path.sep}..${path.sep}..${path.sep}${path.basename(outside)}${path.sep}sentinel.txt`;
          const carrierIdentity = {
            dev: '1',
            ino: '2',
            mode: 0o100600,
            size: '1',
          };
          journal.associationProgress.state = 'intent-durable';
          journal.associationProgress.carriers = [
            {
              target: carrierTarget,
              contentDigest: 'c'.repeat(64),
              directory: {
                path: path.dirname(carrierTarget),
                identity: carrierIdentity,
              },
              intent: {
                path: `${carrierTarget}.intent`,
                identity: carrierIdentity,
              },
              claim: {
                path: `${carrierTarget}.claim`,
                identity: carrierIdentity,
              },
            },
          ];
          await fs.writeFile(
            archivePlan.paths.journal,
            `${JSON.stringify(journal, null, 2)}\n`
          );

          const result = await withStoredArchivePlanOperation(
            archivePlan,
            globalDataDir,
            'abort',
            () => abortArchivePlan(archivePlan, globalDataDir)
          );

          expect(result).toMatchObject({
            status: 'blocked',
            blockers: [
              expect.objectContaining({
                code: 'archive_abort_journal_plan_mismatch',
              }),
            ],
          });
          await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe(
            'outside survives\n'
          );
        }
      );

      it.each(['sibling', 'traversal'] as const)(
        'refuses a %s journal binding and preserves the outside sentinel bytes',
        async spelling => {
          const { archivePlan, globalDataDir } = await prepareEarlyAbort();
          const outside = path.join(
            path.dirname(active),
            `outside-${spelling}`
          );
          const sentinel = path.join(outside, 'sentinel.txt');
          await fs.mkdir(outside);
          await fs.writeFile(sentinel, 'outside survives\n');
          const journal = JSON.parse(
            await fs.readFile(archivePlan.paths.journal, 'utf8')
          ) as Record<string, unknown>;
          journal.activePath =
            spelling === 'sibling'
              ? outside
              : `${active}${path.sep}..${path.sep}${path.basename(outside)}`;
          const journalBytes = Buffer.from(`${JSON.stringify(journal, null, 2)}\n`);
          await fs.writeFile(archivePlan.paths.journal, journalBytes);

          const result = await withStoredArchivePlanOperation(
            archivePlan,
            globalDataDir,
            'abort',
            () => abortArchivePlan(archivePlan, globalDataDir)
          );

          expect(result).toMatchObject({
            status: 'blocked',
            blockers: [
              expect.objectContaining({
                code: expect.stringMatching(
                  /^archive_abort_(?:ownership_unverified|journal_plan_mismatch)$/u
                ),
              }),
            ],
          });
          await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe(
            'outside survives\n'
          );
          await expect(fs.readFile(archivePlan.paths.journal)).resolves.toEqual(
            journalBytes
          );
          await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
        }
      );
    }
  );

  it('resumes a torn guarded abort from its durable stage authority', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nold transaction\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    expect((await applyArchive(archivePlan)).status).toBe('abort-required');

    let failStageRemoval = true;
    let claimedStagePath: string | null = null;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rmdir: async (target: string) => {
          if (
            path.basename(target) === 'object' &&
            path
              .basename(path.dirname(target))
              .startsWith(
                `.rasen-archive-claim-${archivePlan.transactionId}-`
              ) &&
            failStageRemoval
          ) {
            claimedStagePath = target;
            failStageRemoval = false;
            throw Object.assign(
              new Error('simulated claimed-stage rmdir failure'),
              { code: 'EIO' }
            );
          }
          await defaultArchiveEngineAdapters.fs.rmdir(target);
        },
      },
    };
    await expect(
      withStoredArchivePlanOperation(
        archivePlan,
        globalDataDir,
        'abort',
        () => abortArchivePlan(archivePlan, globalDataDir, adapters)
      )
    ).rejects.toMatchObject({ code: 'EIO' });

    const tombstonePath = path.join(
      globalDataDir,
      'archive-transactions',
      archivePlan.transactionId,
      'abort.json'
    );
    const aborting = JSON.parse(await fs.readFile(tombstonePath, 'utf8'));
    expect(aborting).toMatchObject({
      status: 'aborting',
      stageIdentity: expect.any(Object),
      stageAuthority: expect.objectContaining({
        algorithm: 'sha256',
        authorityEntries: expect.any(Array),
      }),
      stageClaim: expect.objectContaining({
        claimed: claimedStagePath,
        root: expect.any(String),
        sentinel: expect.any(String),
        rootIdentity: expect.any(Object),
        sentinelIdentity: expect.any(Object),
      }),
    });
    expect(claimedStagePath).not.toBeNull();
    await expect(fs.readdir(claimedStagePath!)).resolves.toEqual([]);
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(archivePlan.paths.journal)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const canonicalStageClaim = {
      root: aborting.stageClaim.root as string,
      claimed: aborting.stageClaim.claimed as string,
      sentinel: aborting.stageClaim.sentinel as string,
    };
    const canonicalStageClaimIdentities = Object.fromEntries(
      await Promise.all(
        Object.entries(canonicalStageClaim).map(async ([label, target]) => [
          label,
          await fs.realpath(target),
        ])
      )
    ) as Record<keyof typeof canonicalStageClaim, string>;
    const equivalentAlias = (target: string): string =>
      `${path.dirname(target)}${path.sep}.${path.sep}${path.basename(target)}`;
    if (process.platform === 'win32') {
      aborting.stagePath = (aborting.stagePath as string).replace(
        '.rasen-archive-stage-',
        '.RASEN-ARCHIVE-STAGE-'
      );
    }
    aborting.stageClaim.root = equivalentAlias(canonicalStageClaim.root);
    aborting.stageClaim.claimed = `${aborting.stageClaim.root}${path.sep}object`;
    aborting.stageClaim.sentinel =
      `${aborting.stageClaim.root}${path.sep}.rasen-claim-owner`;
    await fs.writeFile(
      tombstonePath,
      `${JSON.stringify(aborting, null, 2)}\n`
    );

    const mutationOperands: Array<{
      operation: 'rename' | 'rmdir' | 'unlink';
      target: string;
      canonicalTarget: string;
    }> = [];
    const recordMutation = async (
      operation: 'rename' | 'rmdir' | 'unlink',
      target: string
    ): Promise<void> => {
      let canonicalTarget: string;
      try {
        canonicalTarget = await fs.realpath(target);
      } catch {
        canonicalTarget = path.resolve(target);
      }
      mutationOperands.push({ operation, target, canonicalTarget });
    };
    const resumeAdapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rename: async (source, target) => {
          await recordMutation('rename', source);
          await recordMutation('rename', target);
          await defaultArchiveEngineAdapters.fs.rename(source, target);
        },
        rmdir: async target => {
          await recordMutation('rmdir', target);
          await defaultArchiveEngineAdapters.fs.rmdir(target);
        },
        unlink: async target => {
          await recordMutation('unlink', target);
          await defaultArchiveEngineAdapters.fs.unlink(target);
        },
      },
    };

    const resumed = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir, resumeAdapters)
    );
    expect(resumed.status).toBe('aborted');
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(canonicalStageClaim.root)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const identityKey = (target: string): string => {
      const resolved = path.resolve(target);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    for (const [label, expected] of Object.entries(canonicalStageClaim)) {
      const matching = mutationOperands.filter(
        call =>
          identityKey(call.canonicalTarget) ===
          identityKey(
            canonicalStageClaimIdentities[
              label as keyof typeof canonicalStageClaim
            ]
          )
      );
      expect(matching.length).toBeGreaterThan(0);
      expect(matching.every(call => call.target === expected)).toBe(true);
    }
    await expect(
      fs.access(
        path.join(
          globalDataDir,
          'archive-transactions',
          archivePlan.transactionId,
          'plan.json'
        )
      )
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(loadCompletedArchiveAbort(
      `archive-v1:${archivePlan.transactionId}:${archivePlan.planHash}`,
      globalDataDir
    )).resolves.toMatchObject({ status: 'already-aborted' });
  });

  it('preserves a substituted abort claim occupant for manual recovery', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nold transaction\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    expect((await applyArchive(archivePlan)).status).toBe('abort-required');

    let replacementPath: string | null = null;
    let displacedPath: string | null = null;
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rename: async (source: string, destination: string) => {
          await defaultArchiveEngineAdapters.fs.rename(source, destination);
          if (source === archivePlan.paths.stage) {
            replacementPath = destination;
            displacedPath = `${destination}-displaced`;
            await fs.rename(destination, displacedPath);
            await fs.mkdir(destination);
            await fs.writeFile(
              path.join(destination, 'intruder.txt'),
              'must survive\n'
            );
          }
        },
      },
    };

    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir, adapters)
    );
    expect(refused).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_ownership_unverified',
        }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(refused.recoveryCommand).toBeUndefined();
    expect(replacementPath).not.toBeNull();
    expect(displacedPath).not.toBeNull();
    await expect(
      fs.readFile(path.join(replacementPath!, 'intruder.txt'), 'utf8')
    ).resolves.toBe('must survive\n');
    await expect(fs.access(displacedPath!)).resolves.toBeUndefined();
  });

  it('refuses to adopt a stage payload injected before abort starts', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nold transaction\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    expect((await applyArchive(archivePlan)).status).toBe('abort-required');

    const intruder = path.join(archivePlan.paths.stage, 'unclaimed.txt');
    await fs.writeFile(intruder, 'must survive\n');
    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );

    expect(refused).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_ownership_unverified',
        }),
      ],
    });
    await expect(fs.readFile(intruder, 'utf8')).resolves.toBe('must survive\n');
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
  });

  it('fails closed when nested journal recovery state is malformed', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nold transaction\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    expect((await applyArchive(archivePlan)).status).toBe('abort-required');

    const journal = JSON.parse(
      await fs.readFile(archivePlan.paths.journal, 'utf8')
    );
    journal.phaseFingerprints['payload-copied'].scope = 'final';
    await fs.writeFile(
      archivePlan.paths.journal,
      `${JSON.stringify(journal, null, 2)}\n`
    );
    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );

    expect(refused).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_journal_invalid',
        }),
      ],
    });
    expect(refused.effectivePhase).toBeUndefined();
    expect(refused.retainedPaths).toContain(archivePlan.paths.journal);
    expect(refused.recoveryCommand).toBeUndefined();
    expect(refused.manualRecoveryAction).toEqual(
      expect.objectContaining({ kind: 'manual-recovery-required' })
    );
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
  });

  it('omits exact-token retry for failed journals without a resume phase', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nold transaction\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    expect((await applyArchive(archivePlan)).status).toBe('abort-required');
    const journal = JSON.parse(
      await fs.readFile(archivePlan.paths.journal, 'utf8')
    );
    delete journal.failure.resumePhase;
    await fs.writeFile(
      archivePlan.paths.journal,
      `${JSON.stringify(journal, null, 2)}\n`
    );

    const retry = await applyArchive(archivePlan);
    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({ code: 'archive_journal_invalid' }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(retry.recoveryCommand).toBeUndefined();
    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );
    expect(refused).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({ code: 'archive_abort_journal_invalid' }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(refused.recoveryCommand).toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
  });

  it('refuses abort when a plan-owned cleaner progress record is omitted', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nold transaction\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    expect((await applyArchive(archivePlan)).status).toBe('abort-required');
    const journal = JSON.parse(
      await fs.readFile(archivePlan.paths.journal, 'utf8')
    );
    expect(journal.cleanerProgress.length).toBeGreaterThan(0);
    journal.cleanerProgress = [];
    await fs.writeFile(
      archivePlan.paths.journal,
      `${JSON.stringify(journal, null, 2)}\n`
    );

    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );
    expect(refused).toMatchObject({
      status: 'blocked',
      effectivePhase: expect.any(String),
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_journal_plan_mismatch',
        }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(refused.recoveryCommand).toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
  });

  it('never recursively deletes an entry injected after abort ownership is recorded', async () => {
    await fs.writeFile(
      path.join(active, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nold transaction\n'
    );
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    expect((await applyArchive(archivePlan)).status).toBe('abort-required');

    let injected = false;
    const tombstonePath = path.join(
      globalDataDir,
      'archive-transactions',
      archivePlan.transactionId,
      'abort.json'
    );
    const intruder = path.join(archivePlan.paths.stage, 'unclaimed.txt');
    const adapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rename: async (source: string, destination: string) => {
          await defaultArchiveEngineAdapters.fs.rename(source, destination);
          if (destination === tombstonePath && !injected) {
            injected = true;
            await fs.writeFile(intruder, 'must survive\n');
          }
        },
      },
    };

    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir, adapters)
    );
    expect(refused).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_ownership_unverified',
        }),
      ],
    });
    const repeated = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );
    expect(repeated).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_ownership_unverified',
        }),
      ],
    });
    await expect(fs.readFile(intruder, 'utf8')).resolves.toBe('must survive\n');
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
    expect(
      JSON.parse(await fs.readFile(tombstonePath, 'utf8')).status
    ).toBe('aborting');
  });

  it('refuses abort after canonical spec progress and preserves all recovery state', async () => {
    const delta = path.join(active, 'specs', 'created', 'spec.md');
    const target = path.join(root, 'rasen', 'specs', 'created', 'spec.md');
    const rebuilt = '# Created\n';
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.writeFile(delta, rebuilt);
    const archivePlan = await plan({
      specActions: [
        {
          capability: 'created',
          action: 'create',
          source: delta,
          target,
          sourceSha256: defaultArchiveEngineAdapters.sha256(rebuilt),
          targetPrecondition: { state: 'absent' },
          rebuilt,
          counts: { added: 1, modified: 0, removed: 0, renamed: 0 },
        },
      ],
    });
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    const failingAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        mkdir: async (
          targetPath: string,
          options?: { recursive?: boolean }
        ): Promise<string | undefined> => {
          if (targetPath === archivePlan.paths.final) {
            const error = new Error('injected final reservation failure');
            (error as NodeJS.ErrnoException).code = 'EACCES';
            throw error;
          }
          return defaultArchiveEngineAdapters.fs.mkdir(targetPath, options);
        },
      },
    };
    const failed = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'apply',
      () => applyArchive(archivePlan, { adapters: failingAdapters })
    );
    expect(failed.status).toBe('recoverable');
    expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);

    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );
    expect(refused).toMatchObject({
      status: 'blocked',
      effectivePhase: 'specs-applied',
      retainedPaths: expect.arrayContaining([
        archivePlan.paths.active,
        archivePlan.paths.stage,
        archivePlan.paths.journal,
        target,
      ]),
      recoveryCommand: `rasen archive --apply-plan archive-v1:${archivePlan.transactionId}:${archivePlan.planHash} --yes`,
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_phase_unsafe',
        }),
      ],
    });
    expect(refused.manualRecoveryAction).toBeUndefined();
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.journal)).resolves.toBeUndefined();
    expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);
  });

  it('refuses abort at specs-applied even when the plan has no spec actions', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    const failingAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        mkdir: async (
          targetPath: string,
          options?: { recursive?: boolean }
        ): Promise<string | undefined> => {
          if (targetPath === archivePlan.paths.final) {
            const error = new Error('injected final reservation failure');
            (error as NodeJS.ErrnoException).code = 'EACCES';
            throw error;
          }
          return defaultArchiveEngineAdapters.fs.mkdir(targetPath, options);
        },
      },
    };
    const failed = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'apply',
      () => applyArchive(archivePlan, { adapters: failingAdapters })
    );
    expect(failed.status).toBe('recoverable');

    const refused = await withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () => abortArchivePlan(archivePlan, globalDataDir)
    );
    expect(refused).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'archive_abort_phase_unsafe',
        }),
      ],
    });
    await expect(fs.access(archivePlan.paths.stage)).resolves.toBeUndefined();
    await expect(fs.access(archivePlan.paths.journal)).resolves.toBeUndefined();
  });

  it('serializes apply and abort for the same stored transaction', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    let markApplyEntered!: () => void;
    const applyEntered = new Promise<void>((resolve) => {
      markApplyEntered = resolve;
    });
    const order: string[] = [];

    const applying = withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'apply',
      async () => {
        order.push('apply-entered');
        markApplyEntered();
        await applyGate;
        order.push('apply-released');
      }
    );
    await applyEntered;
    const aborting = withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      async () => {
        order.push('abort-entered');
      }
    );
    await fs.access(
      path.join(
        globalDataDir,
        'archive-transactions',
        archivePlan.transactionId,
        'operation.lock'
      )
    );
    expect(order).toEqual(['apply-entered']);

    releaseApply();
    await Promise.all([applying, aborting]);
    expect(order).toEqual([
      'apply-entered',
      'apply-released',
      'abort-entered',
    ]);
  });
});
