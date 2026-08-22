/**
 * `issue-ready-set-scheduling` task 2.3 — the archive-record basis, pinned
 * branch by branch over a real Store: every one of the four null-outcome
 * branches plus the valid v2 branch, on BOTH surfaces that surface the basis —
 * the grouped archive entries and the Execution Plan node resolutions the
 * projection consumes.
 *
 * The basis split is the D4 ruling's spine: pre-v2 shapes are `legacy`
 * (complete-for-scheduling evidence), v2-shaped bytes that do not parse or
 * validate are `invalid` (damaged, fail-closed). `legacyRecord`'s display
 * collapse is pinned unchanged beside it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import { serializeArchiveV2 } from '../../../src/core/store/finalization-v2.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
} from '../../../src/core/store/planning-identity.js';

const NOW = '2026-08-22T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-archive-basis';

/** The five archive-record shapes under test, keyed by change alias. */
const SHAPES = [
  'v2-valid',
  'record-absent',
  'v1-shape',
  'unparseable-json',
  'v2-invalid',
] as const;
type Shape = (typeof SHAPES)[number];

describe('the archive-record basis (readArchiveEntry + plan-resolution threading)', () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };
  const instanceIds = new Map<Shape, string>();

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-archive-basis-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    scope = { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
  });

  afterEach(() => {
    f.cleanup();
  });

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  /** Seeds one Change and moves it, committed, into the archive line. */
  function archiveWithRecord(shape: Shape, seed: string, recordText: string | null): void {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: shape,
      instanceSeed: seed,
    });
    instanceIds.set(shape, seeded.instanceId);
    const entryName = `2026-08-22-${shape}--${seeded.instanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen',
      'projects',
      PROJECT,
      'changes',
      'archive',
      LINE,
      entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(seeded.directory, archiveDir);
    if (recordText !== null) {
      fs.writeFileSync(path.join(archiveDir, 'archive.json'), recordText, 'utf8');
    }
  }

  /** A valid v2 record, exactly the shape the finalization writer emits. */
  function validV2Record(changeId: string, seed: string): string {
    const planningScopeId = derivePlanningScopeId({
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
    });
    const changeInstanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed: seed });
    return serializeArchiveV2({
      schemaVersion: 2,
      implementation: 'none',
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId,
      changeInstanceId,
      workspacePairId: deriveWorkspacePairId({
        changeInstanceId,
        planningWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        executionWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'execution',
        }),
      }),
      outcome: 'landed',
      reason: null,
      supersededBy: null,
      planning: {
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        sourceRef: 'refs/heads/main',
        sourceHead: 'a'.repeat(40),
        targetRef: 'refs/heads/main',
      },
      codeMerge: null,
      specSync: { applied: true, actions: [] },
      evidence: [],
      missing: [],
      archivedAt: NOW,
    });
  }

  it('pins the basis per branch, on the grouped entries and the plan resolutions alike', async () => {
    archiveWithRecord('v2-valid', 'a1'.repeat(16), validV2Record('v2-valid', 'a1'.repeat(16)));
    archiveWithRecord('record-absent', 'b2'.repeat(16), null);
    archiveWithRecord('v1-shape', 'c3'.repeat(16), `${JSON.stringify({ version: 1, changeId: 'v1-shape' }, null, 2)}\n`);
    archiveWithRecord('unparseable-json', 'd4'.repeat(16), '{not json at all\n');
    // schemaVersion-2 bytes that fail validation: a v2 record with the outcome
    // field deleted — v2 in shape, invalid in fact.
    const brokenV2 = JSON.parse(validV2Record('v2-invalid', 'e5'.repeat(16))) as Record<string, unknown>;
    delete brokenV2.outcome;
    archiveWithRecord('v2-invalid', 'e5'.repeat(16), `${JSON.stringify(brokenV2, null, 2)}\n`);
    commitStore('archive the five record shapes');

    const issues = new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
    await issues.create({ ...scope, issueId: ISSUE, title: 'Archive basis' });
    await issues.publishPlan({
      ...scope,
      issueId: ISSUE,
      nodes: SHAPES.map(shape => ({
        nodeId: shape,
        kind: 'change' as const,
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds.get(shape) as string,
        changeAlias: shape,
        dependsOn: [],
      })),
    });
    commitStore('issue + plan');

    // --- The grouped archive entries -------------------------------------
    const grouped = await new StoreQueryModuleImpl().listChanges({
      ...scope,
      state: 'archived',
    });
    const archived = grouped.groups.flatMap(group => group.archived);
    expect(archived.map(entry => entry.changeId).sort()).toEqual([...SHAPES].sort());

    const basisByShape = new Map(archived.map(entry => [entry.changeId, entry]));
    const v2Valid = basisByShape.get('v2-valid');
    expect(v2Valid?.outcome).toBe('landed');
    expect(v2Valid?.legacyRecord).toBe(false);
    expect(v2Valid?.outcomeBasis).toBe('v2');
    expect(v2Valid?.outcomeBasisReason).toBeNull();
    expect(v2Valid?.outcomeBasisPath).toContain('archive.json');

    for (const shape of ['record-absent', 'v1-shape'] as const) {
      const legacy = basisByShape.get(shape);
      expect(legacy?.outcome, shape).toBeNull();
      // The display collapse is unchanged: a legacy record stays `legacyRecord`.
      expect(legacy?.legacyRecord, shape).toBe(true);
      expect(legacy?.outcomeBasis, shape).toBe('legacy');
      expect(legacy?.outcomeBasisReason, shape).toBeNull();
      expect(legacy?.outcomeBasisPath, shape).toContain('archive.json');
    }

    for (const shape of ['unparseable-json', 'v2-invalid'] as const) {
      const invalid = basisByShape.get(shape);
      expect(invalid?.outcome, shape).toBeNull();
      // Display semantics untouched: the damaged bytes still collapse to the
      // legacy display boolean; the basis is the machine-facing split.
      expect(invalid?.legacyRecord, shape).toBe(true);
      expect(invalid?.outcomeBasis, shape).toBe('invalid');
      expect(invalid?.outcomeBasisReason, shape).toContain(
        shape === 'unparseable-json' ? 'not valid JSON' : 'failed validation'
      );
      expect(invalid?.outcomeBasisPath, shape).toContain(`${shape}--`);
      expect(invalid?.outcomeBasisPath, shape).toContain('archive.json');
    }

    // --- The plan resolutions the projection consumes --------------------
    const plan = await new StoreQueryModuleImpl().resolveExecutionPlan({
      ...scope,
      issueId: ISSUE,
    });
    expect(plan.revision).not.toBeNull();
    const resolutionByShape = new Map(
      (plan.readiness.nodes ?? []).map(row => [row.node.nodeId, row.resolution])
    );
    const resolvedV2 = resolutionByShape.get('v2-valid');
    expect(resolvedV2?.archived).toBe(true);
    expect(resolvedV2?.outcome).toBe('landed');
    expect(resolvedV2?.outcomeBasis).toBe('v2');
    expect(resolvedV2?.outcomeBasisPath).toBe(v2Valid?.outcomeBasisPath);

    for (const shape of ['record-absent', 'v1-shape'] as const) {
      const resolution = resolutionByShape.get(shape);
      expect(resolution?.outcomeBasis, shape).toBe('legacy');
      expect(resolution?.outcomeBasisReason, shape).toBeNull();
    }
    for (const shape of ['unparseable-json', 'v2-invalid'] as const) {
      const resolution = resolutionByShape.get(shape);
      expect(resolution?.outcomeBasis, shape).toBe('invalid');
      expect(resolution?.outcomeBasisReason, shape).toContain(
        shape === 'unparseable-json' ? 'not valid JSON' : 'failed validation'
      );
    }
    // The query's own readiness stays archive-outcome based: only the valid v2
    // record finalizes on the query's side, whatever the basis says.
    const readinessByShape = new Map(
      (plan.readiness.nodes ?? []).map(row => [row.node.nodeId, row.readiness])
    );
    expect(readinessByShape.get('v2-valid')).toBe('finalized');
    for (const shape of SHAPES.filter(shape => shape !== 'v2-valid')) {
      expect(readinessByShape.get(shape), shape).toBe('in-progress');
    }
  });
});
