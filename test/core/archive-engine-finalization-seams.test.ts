/**
 * `store-finalization-outcomes-v2` task 8.8 — the four engine seams.
 *
 * The engine stays the transaction. Four named extensions were threaded through
 * it, and each one is asserted here to be (a) inert when the finalization block
 * is absent and (b) exactly what it claims when the block is present:
 *
 *   1. the explicit `finalPath` override, constrained to a direct child of the
 *      archive parent so publication stays a same-volume rename;
 *   2. the accounting trio, dispatched on the PRESENCE of the block and never
 *      on the content of any file;
 *   3. the `association-finalized` journal phase between accounting and source
 *      removal, and the resume table that continues from it;
 *   4. suffix-aware archive name matching, which must not break the
 *      un-suffixed form.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyArchive,
  archiveDatePrefixedNameMatches,
  createArchivePlan,
  defaultArchiveEngineAdapters,
  resolveArchiveSidecar,
  resolveArchiveTransactionPaths,
  type ArchiveEngineAdapters,
  type ArchivePlanFinalization,
} from '../../src/core/archive-engine.js';
import { parseArchivedRef } from '../../src/utils/item-discovery.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
  changeInstanceDigestPrefix,
} from '../../src/core/store/planning-identity.js';

const STORE_UID = '6f7d4d70-3d2c-4a37-9f8a-0f4c1b2e3d55';
const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'sample';
const DATE = '2026-07-31';
const TRANSACTION = '11111111-1111-4111-8111-111111111111';

const scopeId = derivePlanningScopeId({
  storeUid: STORE_UID,
  projectId: PROJECT,
  targetLineId: LINE,
});
const INSTANCE = deriveChangeInstanceId({
  planningScopeId: scopeId,
  instanceSeed: 'a'.repeat(32),
});
const PLANNING_WT = deriveWorktreeInstanceId({
  repositoryIdentity: 'store-repo',
  worktreeIdentity: 'planning',
});
const EXECUTION_WT = deriveWorktreeInstanceId({
  repositoryIdentity: 'code-repo',
  worktreeIdentity: 'execution',
});
const PAIR = deriveWorkspacePairId({
  changeInstanceId: INSTANCE,
  planningWorktreeInstanceId: PLANNING_WT,
  executionWorktreeInstanceId: EXECUTION_WT,
});

describe('seam 1 — the explicit destination override', () => {
  const parent =
    process.platform === 'win32' ? 'C:\\store\\archive' : '/store/archive';

  it('keeps the ${date}-${change} composition as the default', () => {
    const paths = resolveArchiveTransactionPaths(parent, DATE, CHANGE, TRANSACTION);
    expect(path.basename(paths.final)).toBe(`${DATE}-${CHANGE}`);
    expect(path.dirname(paths.stage)).toBe(path.dirname(paths.final));
  });

  it('uses the override and keeps the stage a SIBLING of the final path', () => {
    const override = path.join(parent, `${DATE}-${CHANGE}--abcdef123456`);
    const paths = resolveArchiveTransactionPaths(
      parent,
      DATE,
      CHANGE,
      TRANSACTION,
      path,
      { finalPath: override }
    );

    expect(paths.final).toBe(override);
    // Same directory: publication stays a rename, never a cross-volume copy.
    expect(path.dirname(paths.stage)).toBe(path.dirname(paths.final));
    expect(paths.journal).toBe(path.join(paths.stage, '.rasen-archive-journal.json'));
    expect(paths.publishedJournal).toBe(
      path.join(override, '.rasen-archive-journal.json')
    );
  });

  it('refuses an override that is not a direct child of the archive parent', () => {
    for (const escape of [
      path.join(parent, 'nested', `${DATE}-${CHANGE}`),
      path.join(path.dirname(parent), `${DATE}-${CHANGE}`),
    ]) {
      expect(() =>
        resolveArchiveTransactionPaths(parent, DATE, CHANGE, TRANSACTION, path, {
          finalPath: escape,
        })
      ).toThrow(/same-volume rename/u);
    }
  });
});

describe('seam 4 — suffix-aware archive name matching', () => {
  it('matches both the flat and the instance-suffixed entry name', () => {
    expect(archiveDatePrefixedNameMatches(`${DATE}-${CHANGE}`, CHANGE)).toBe(true);
    expect(
      archiveDatePrefixedNameMatches(`${DATE}-${CHANGE}--abcdef123456`, CHANGE)
    ).toBe(true);
  });

  it('does not match a different change, suffixed or not', () => {
    expect(archiveDatePrefixedNameMatches(`${DATE}-other`, CHANGE)).toBe(false);
    expect(archiveDatePrefixedNameMatches(`${DATE}-other--abcdef123456`, CHANGE)).toBe(
      false
    );
    expect(archiveDatePrefixedNameMatches(CHANGE, CHANGE)).toBe(false);
  });

  it('splits a Change alias that itself contains a double hyphen', () => {
    // The suffix is a lowercase hex digest prefix, so the split is unambiguous
    // even here.
    const alias = 'fix--double';
    expect(archiveDatePrefixedNameMatches(`${DATE}-${alias}`, alias)).toBe(true);
    expect(
      archiveDatePrefixedNameMatches(`${DATE}-${alias}--abcdef123456`, alias)
    ).toBe(true);
    expect(parseArchivedRef(`${DATE}-${alias}--abcdef123456`)).toEqual({
      dated: `${DATE}-${alias}--abcdef123456`,
      date: DATE,
      name: alias,
      instanceShort: 'abcdef123456',
    });
  });

  it('parses the un-suffixed form with no instanceShort at all', () => {
    expect(parseArchivedRef(`${DATE}-${CHANGE}`)).toEqual({
      dated: `${DATE}-${CHANGE}`,
      date: DATE,
      name: CHANGE,
    });
    expect(parseArchivedRef('not-an-archive')).toBeNull();
  });

  it('does not read a trailing non-hex segment as an instance suffix', () => {
    expect(parseArchivedRef(`${DATE}-${CHANGE}--notthehexdigest`)).toEqual({
      dated: `${DATE}-${CHANGE}--notthehexdigest`,
      date: DATE,
      name: `${CHANGE}--notthehexdigest`,
    });
  });
});

describe('seams 2 and 3 — accounting dispatch and the association phase', () => {
  let root: string;
  let active: string;
  let archiveParent: string;
  let ephemera: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-archive-seams-'));
    active = path.join(root, 'rasen', 'changes', CHANGE);
    archiveParent = path.join(root, 'rasen', 'changes', 'archive');
    ephemera = path.join(root, '.rasen', 'changes', CHANGE, 'ephemera');
    await fs.mkdir(path.join(active, 'evidence'), { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'review-report.md'),
      '# Review\nFindings: 0\n'
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function finalizationBlock(destination: string): ArchivePlanFinalization {
    return {
      outcome: 'abandoned',
      record: {
        schemaVersion: 2,
        implementation: 'code',
        storeUid: STORE_UID,
        projectId: PROJECT,
        targetLineId: LINE,
        changeId: CHANGE,
        changeInstanceId: INSTANCE,
        workspacePairId: PAIR,
        outcome: 'abandoned',
        reason: 'Not pursued.',
        supersededBy: null,
        planning: {
          worktreeInstanceId: PLANNING_WT,
          sourceRef: 'refs/heads/change/line-0.2/app-a/sample',
          sourceHead: 'a'.repeat(40),
          targetRef: 'refs/heads/release/0.2',
        },
        codeMerge: null,
        specSync: { applied: false, actions: [] },
        archivedAt: '2026-07-31T00:00:00.000Z',
      } as ArchivePlanFinalization['record'],
      identity: {
        planningScopeId: scopeId,
        instanceSeed: 'a'.repeat(32),
        planningWorktreeInstanceId: PLANNING_WT,
        executionWorktreeInstanceId: EXECUTION_WT,
      },
      destination,
      association: { noop: false, planningScopeId: scopeId, changeId: CHANGE },
      revalidation: {
        targetLine: {
          catalogPath: path.join(
            root,
            '.rasen-store',
            'target-lines',
            `${LINE}.yaml`
          ),
          catalogDigest: 'b'.repeat(64),
          codeRef: null,
          codeRefOid: null,
        },
        archive: {
          root: archiveParent,
          archiveDate: DATE,
          destination,
        },
      },
      lockKeys: [],
    };
  }

  async function plan(withFinalization: boolean) {
    const sidecar = await resolveArchiveSidecar(active, root, CHANGE);
    const destination = path.join(
      archiveParent,
      `${DATE}-${CHANGE}--${changeInstanceDigestPrefix(INSTANCE)}`
    );
    return createArchivePlan({
      change: CHANGE,
      planningRoot: root,
      executionRoot: root,
      ...(withFinalization
        ? {
            scope: {
              kind: 'store-project' as const,
              storeUid: STORE_UID,
              projectId: PROJECT,
            },
          }
        : {}),
      activePath: active,
      archiveParent,
      ephemeraPath: ephemera,
      date: DATE,
      keepEphemera: false,
      validation: 'passed',
      tasks: { total: 1, completed: 1, override: false },
      timing: { mode: 'on-merge', deliveryMode: 'local', override: false },
      specActions: [],
      sidecar,
      transactionId: TRANSACTION,
      createdAt: '2026-07-31T00:00:00.000Z',
      ...(withFinalization ? { finalization: finalizationBlock(destination) } : {}),
    });
  }

  /** Adapters that record which accounting writer ran. */
  function recordingAdapters(
    overrides: Partial<ArchiveEngineAdapters> = {}
  ): { adapters: ArchiveEngineAdapters; calls: string[] } {
    const calls: string[] = [];
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      resolveArchiveAccounting: async input => {
        calls.push('v1-resolve');
        return defaultArchiveEngineAdapters.resolveArchiveAccounting(input);
      },
      writeArchiveJson: async (dir, accounting) => {
        calls.push('v1-write');
        return defaultArchiveEngineAdapters.writeArchiveJson(dir, accounting);
      },
      verifyArchiveAccounting: async (dir, accounting) => {
        calls.push('v1-verify');
        return defaultArchiveEngineAdapters.verifyArchiveAccounting(dir, accounting);
      },
      resolveArchiveV2Accounting: async input => {
        calls.push('v2-resolve');
        return defaultArchiveEngineAdapters.resolveArchiveV2Accounting(input);
      },
      writeArchiveV2Json: async (dir, prepared) => {
        calls.push('v2-write');
        return defaultArchiveEngineAdapters.writeArchiveV2Json(dir, prepared);
      },
      verifyArchiveV2Accounting: async (dir, prepared) => {
        calls.push('v2-verify');
        return defaultArchiveEngineAdapters.verifyArchiveV2Accounting(dir, prepared);
      },
      finalizeArchiveAssociation: async () => {
        calls.push('association');
      },
      ...overrides,
    };
    return { adapters, calls };
  }

  it('runs ONLY the v1 writer when no finalization block is present', async () => {
    const { adapters, calls } = recordingAdapters();
    const archivePlan = await plan(false);

    expect((await applyArchive(archivePlan, { adapters: adapters })).status).toBe('complete');
    expect(calls.filter(call => call.startsWith('v2-'))).toEqual([]);
    expect(calls).toContain('v1-write');
    // The association phase is not reached at all for a plan with no block.
    expect(calls).not.toContain('association');

    const record = JSON.parse(
      await fs.readFile(path.join(archivePlan.paths.final, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(record.schemaVersion).toBeUndefined();
    expect(record).toHaveProperty('change', CHANGE);
    expect(record).not.toHaveProperty('outcome');
  });

  it('runs ONLY the v2 writer when the block is present, and publishes at the override', async () => {
    const { adapters, calls } = recordingAdapters();
    const archivePlan = await plan(true);

    expect(archivePlan.paths.final).toBe(
      path.join(archiveParent, `${DATE}-${CHANGE}--${changeInstanceDigestPrefix(INSTANCE)}`)
    );
    expect((await applyArchive(archivePlan, { adapters: adapters })).status).toBe('complete');
    expect(calls.filter(call => call.startsWith('v1-'))).toEqual([]);
    expect(calls).toContain('v2-write');
    expect(calls).toContain('association');

    const record = JSON.parse(
      await fs.readFile(path.join(archivePlan.paths.final, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      schemaVersion: 2,
      outcome: 'abandoned',
      changeInstanceId: INSTANCE,
      workspacePairId: PAIR,
    });
  });

  it('dispatches on the PLAN, never on an existing archive.json it might find', async () => {
    // A v2-looking record already sitting in the archive line, beside where
    // this entry will be published. If dispatch sniffed file content anywhere,
    // this would flip the writer; it must not.
    await fs.mkdir(path.join(archiveParent, '2026-07-30-relocated-legacy'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(archiveParent, '2026-07-30-relocated-legacy', 'archive.json'),
      JSON.stringify({ schemaVersion: 2, outcome: 'landed' })
    );
    const { adapters, calls } = recordingAdapters();

    expect((await applyArchive(await plan(false), { adapters: adapters })).status).toBe('complete');
    expect(calls.filter(call => call.startsWith('v2-'))).toEqual([]);
    expect(calls).toContain('v1-write');
  });

  it('orders the association phase AFTER accounting and BEFORE source removal', async () => {
    const order: string[] = [];
    const { adapters } = recordingAdapters({
      writeArchiveV2Json: async (dir, prepared) => {
        order.push('accounting');
        return defaultArchiveEngineAdapters.writeArchiveV2Json(dir, prepared);
      },
      finalizeArchiveAssociation: async () => {
        // The active source still exists at this point, which is the whole
        // reason the phase sits inside the transaction rather than after it.
        order.push(`association(sourcePresent=${await exists(active)})`);
      },
    });

    expect((await applyArchive(await plan(true), { adapters: adapters })).status).toBe('complete');
    expect(order).toEqual(['accounting', 'association(sourcePresent=true)']);
    expect(await exists(active)).toBe(false);
  });

  it('stops recoverable when the association fails, keeping the archive published', async () => {
    const archivePlan = await plan(true);
    const { adapters } = recordingAdapters({
      finalizeArchiveAssociation: async () => {
        throw new Error('planning_execution_binding_mismatch: recorded pair disagrees');
      },
    });

    const failed = await applyArchive(archivePlan, { adapters: adapters });
    expect(failed.status).not.toBe('complete');
    // Published and staying published; the active source is NOT removed.
    expect(await exists(archivePlan.paths.final)).toBe(true);
    expect(await exists(active)).toBe(true);

    const journal = JSON.parse(await fs.readFile(failed.journalPath, 'utf8')) as {
      phase: string;
      failure?: { operation: string; resumePhase?: string; message: string };
    };
    // The journal records the failure and names the last phase that DID
    // complete, so a reader can see exactly which one is unfinished — and a
    // resume continues from there rather than from the beginning.
    expect(journal.phase).toBe('failed');
    expect(journal.failure?.operation).toBe('association');
    expect(journal.failure?.resumePhase).toBe('accounting-finalized');
    expect(journal.failure?.message).toContain('planning_execution_binding_mismatch');
  });

  it('resumes from the association phase when the same plan is re-applied', async () => {
    const archivePlan = await plan(true);
    const failing = recordingAdapters({
      finalizeArchiveAssociation: async () => {
        throw new Error('binding disagrees');
      },
    });
    expect((await applyArchive(archivePlan, { adapters: failing.adapters })).status).not.toBe('complete');

    const retry = recordingAdapters();
    const second = await applyArchive(archivePlan, { adapters: retry.adapters });

    expect(second.status).toBe('complete');
    // The resumed run re-runs the association (it is idempotent by
    // construction) and does NOT re-publish or re-write accounting.
    expect(retry.calls).toContain('association');
    expect(retry.calls).not.toContain('v2-write');
    expect(await exists(active)).toBe(false);
  });

  it('refuses a non-no-op association through the DEFAULT adapter rather than skipping it', async () => {
    const archivePlan = await plan(true);
    // The bare engine cannot reach the machine workspace index, so a v2 plan
    // applied through it fails closed instead of silently skipping the phase.
    const result = await applyArchive(archivePlan, { adapters: defaultArchiveEngineAdapters });
    expect(result.status).not.toBe('complete');
    expect(
      result.blockers.some(blocker =>
        blocker.message.includes('finalization Module adapter')
      )
    ).toBe(true);
  });
});

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
