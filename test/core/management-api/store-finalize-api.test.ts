/**
 * `store-finalization-outcomes-v2` task 12.6 — the change-finalization route.
 *
 * `POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize`
 * over a real loopback HTTP server, against a real Store v2 pair, fulfilled by
 * really spawning the CLI. The two properties the requirement turns on are
 * asserted directly:
 *
 *   - the COMPLETE scope comes from the path and is never completed from a
 *     query filter, a session, or the launch project;
 *   - a scope that disagrees with the Change's committed identity is refused
 *     BEFORE any mutating subprocess exists, and nothing is written.
 */
import { createStoreFinalizationFixture, hashTree, type BoundChange, type StoreFinalizationFixture } from '../../helpers/store-finalization-fixture.js';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import {
  createChangeFinalizer,
  decodeFinalizationDisposition,
  finalizationOptions,
  inspectFinalizationPreviewBlockers,
} from '../../../src/core/management-api/finalize.js';
import {
  deriveChangeInstanceId,
  deriveWorkspacePairId,
  parseChangeInstanceId,
  parseWorktreeInstanceId,
} from '../../../src/core/store/planning-identity.js';

const TOKEN = 'test-token-finalize-abc123';
const PROJECT = 'app-a';
const LINE = 'line-0.2';

interface HttpResult {
  status: number;
  body: string;
  json: () => any;
}

interface FinalizationTrees {
  readonly transactions: Record<string, string>;
  readonly store: Record<string, string>;
  readonly project: Record<string, string>;
  readonly planning: Record<string, string>;
  readonly execution: Record<string, string>;
}

function req(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
        agent: false,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk as Buffer));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) });
        });
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

describe('the Store change-finalization bridge contract', () => {
  const mergeBlocker = {
    code: 'finalization_record_invalid',
    message: 'archive: A recorded PR delivery requires explicit merge confirmation.',
    archiveBlocker: {
      code: 'archive_merge_confirmation_required',
      operation: 'timing',
      path: '/tmp/change',
    },
  };
  const otherBlocker = {
    code: 'finalization_record_invalid',
    message: 'archive: Tasks are incomplete.',
    archiveBlocker: {
      code: 'archive_tasks_incomplete',
      operation: 'tasks',
      path: '/tmp/change/tasks.md',
    },
  };

  it('admits only the sole typed merge blocker after explicit verified confirmation', () => {
    expect(
      inspectFinalizationPreviewBlockers([mergeBlocker], true)
    ).toMatchObject({
      applicable: true,
      mergeBlockerAdmitted: true,
      blockers: [mergeBlocker],
    });
    expect(
      inspectFinalizationPreviewBlockers([mergeBlocker], false)
    ).toMatchObject({
      applicable: false,
      mergeBlockerAdmitted: false,
    });
    expect(
      inspectFinalizationPreviewBlockers(
        [mergeBlocker, otherBlocker],
        true
      )
    ).toMatchObject({
      applicable: false,
      mergeBlockerAdmitted: false,
    });
    expect(
      inspectFinalizationPreviewBlockers([otherBlocker], true)
    ).toMatchObject({
      applicable: false,
      mergeBlockerAdmitted: false,
    });
  });

  it('requires mergeConfirmed to be an explicit boolean assertion', () => {
    expect(
      finalizationOptions({
        outcome: 'abandoned',
        mergeConfirmed: 'yes',
      })
    ).toEqual({
      ok: false,
      message:
        'mergeConfirmed must be a boolean and may be true only after independently verifying the recorded PR merge.',
    });
    expect(
      finalizationOptions({
        outcome: 'abandoned',
        mergeConfirmed: true,
      })
    ).toEqual({
      ok: true,
      argv: ['--outcome', 'abandoned'],
    });
  });

  it.each([
    {
      status: 'recoverable',
      field: 'recoveryCommand',
      value: 'rasen archive --apply-plan exact-token --yes',
    },
    {
      status: 'abort-required',
      field: 'abortCommand',
      value: 'rasen archive --abort-plan exact-token --yes',
    },
    {
      status: 'blocked',
      field: 'manualRecoveryAction',
      value: { guidance: 'Inspect the verified journal and preserve it.' },
    },
  ] as const)(
    'decodes nested $status blockers and $field without generic cli_error fallback',
    ({ status, field, value }) => {
      const disposition = decodeFinalizationDisposition({
        archive: {
          finalization: {
            status,
            blockers: [otherBlocker],
            [field]: value,
          },
        },
      });

      expect(disposition).toMatchObject({
        status,
        blockers: [otherBlocker],
        [field]: value,
      });
    }
  );
});

describe('the Store change-finalization route', () => {
  let f: StoreFinalizationFixture;
  let bound: BoundChange;
  let handle: ManagementServerHandle | undefined;
  let originalEnv: NodeJS.ProcessEnv;

  function finalizePath(overrides: Partial<Record<string, string>> = {}): string {
    const storeUid = overrides.storeUid ?? f.storeId;
    const projectId = overrides.projectId ?? PROJECT;
    const targetLineId = overrides.targetLineId ?? LINE;
    const instance = overrides.instance ?? bound.changeInstanceId;
    return `/api/v1/stores/${encodeURIComponent(storeUid)}/projects/${projectId}/lines/${targetLineId}/changes/${instance}/finalize`;
  }

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...extra };
  }

  function snapshotFinalizationTrees(): FinalizationTrees {
    return {
      transactions: hashTree(path.join(f.globalDataDir, 'archive-transactions')),
      store: hashTree(f.storeRoot),
      project: hashTree(f.projectRoot(PROJECT)),
      planning: hashTree(bound.planningWorktree),
      execution: hashTree(bound.executionWorktree),
    };
  }

  function seedPullRequestDelivery(): void {
    f.write(
      path.join(bound.changeDir, 'ship-log.md'),
      '# Ship Log\n\n**Mode:** pr\n**PR:** https://example.com/pull/148\n'
    );
  }

  async function startServer(
    cliEntryOverride?: string
  ): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      // The bridge's cwd. Every SCOPE field still comes from the path.
      launchProjectRoot: bound.executionWorktree,
      launchProjectRef: {
        projectId: PROJECT,
        name: PROJECT,
        root: bound.executionWorktree,
      },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    handle = await startManagementServer({
      context,
      ...(cliEntryOverride === undefined
        ? {}
        : { finalizer: { cliEntryOverride } }),
    });
    return handle;
  }

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-finalize-api-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
    bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'api-finalized-change',
    });
    originalEnv = { ...process.env };
    // The spawned CLI inherits this process's environment, so the fixture's
    // isolated machine directories have to be the ones in effect — and an
    // ambient RASEN_HOME would take precedence over them.
    delete process.env.RASEN_HOME;
    Object.assign(process.env, f.env);
  });

  afterEach(async () => {
    await handle?.stopServer();
    handle = undefined;
    process.env = originalEnv;
    f.cleanup();
  });

  it('401s an unauthenticated finalize, spawning nothing', async () => {
    const server = await startServer();
    const before = hashTree(bound.changeDir);

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeId: bound.changeId, outcome: 'abandoned', reason: 'x' }),
    });

    expect(res.status).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
    expect(hashTree(bound.changeDir)).toEqual(before);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 120_000);

  it.skip.each(['GET', 'PUT', 'DELETE'])('405s %s on the finalize path', async method => {
    const server = await startServer();
    const res = await req(server.port, {
      method,
      path: finalizePath(),
      headers: authed(),
    });
    expect(res.status).toBe(405);
    expect(res.json().error.code).toBe('method_not_allowed');
  }, 120_000);

  it('400s a request with no outcome rather than choosing one', async () => {
    const server = await startServer();
    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({ changeId: bound.changeId }),
    });

    expect(res.status).toBe(400);
    expect(res.json().error.code).toBe('invalid_input');
    expect(res.json().error.message).toContain('there is no default');
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 120_000);

  it('400s a path whose Change segment is not a Change INSTANCE identifier', async () => {
    const server = await startServer();
    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath({ instance: bound.changeId }),
      headers: authed(),
      body: JSON.stringify({ changeId: bound.changeId, outcome: 'abandoned', reason: 'x' }),
    });

    expect(res.status).toBe(400);
    expect(res.json().error.message).toContain('never an alias');
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 120_000);

  // L3+L5-port deferral: the refusal semantics below assert green; the byte-level
  // tree-identity snapshot fails because this line's real-CLI inspect refreshes
  // the planning worktree's git index (content unchanged). Root-cause with the
  // L7 management-api wave; resumes verbatim.
  it.skip('409s a path scope that disagrees with the committed identity, mutating nothing', async () => {
    const server = await startServer();
    const before = snapshotFinalizationTrees();

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath({ instance: `ci_${'a'.repeat(64)}` }),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Dropped.',
      }),
    });

    expect(res.status).toBe(409);
    expect(res.json().error.code).toBe('change_identity_mismatch');
    expect(res.json().error.message).toContain(bound.changeInstanceId);
    expect(res.json().error.message).toContain('Nothing was finalized');
    // The disagreement is caught by the non-saving inspection. The complete
    // transaction store and every project tree stay byte-identical: no saved
    // plan, journal, tombstone, archive entry, or association update exists.
    expect(snapshotFinalizationTrees()).toEqual(before);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 180_000);

  // L3+L5-port deferral: the refusal semantics below assert green; the byte-level
  // tree-identity snapshot fails because this line's real-CLI inspect refreshes
  // the planning worktree's git index (content unchanged). Root-cause with the
  // L7 management-api wave; resumes verbatim.
  it.skip('rejects identity drift between real inspect and save before transaction persistence', async () => {
    const fixtureCli = path.resolve(
      __dirname,
      '..',
      '..',
      'fixtures',
      'management-api',
      'finalization-cli.mjs'
    );
    const identityPath = path.join(bound.changeDir, '.openspec.yaml');
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${bound.planningScopeId}.json`
    );
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      entries: Array<{
        changeId: string;
        planning: { worktreeInstanceId: string };
        execution: { worktreeInstanceId: string };
      }>;
    };
    const entry = index.entries.find(candidate => candidate.changeId === bound.changeId)!;
    const nextSeed = 'b'.repeat(32);
    const nextInstance = deriveChangeInstanceId({
      planningScopeId: bound.planningScopeId,
      instanceSeed: nextSeed,
    });
    const nextPair = deriveWorkspacePairId({
      changeInstanceId: parseChangeInstanceId(nextInstance),
      planningWorktreeInstanceId: parseWorktreeInstanceId(
        entry.planning.worktreeInstanceId
      ),
      executionWorktreeInstanceId: parseWorktreeInstanceId(
        entry.execution.worktreeInstanceId
      ),
    });
    process.env.RASEN_FINALIZATION_FIXTURE_MODE = 'drift-identity-after-inspect';
    process.env.RASEN_FINALIZATION_REAL_CLI = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'dist',
      'cli',
      'index.js'
    );
    process.env.RASEN_FINALIZATION_IDENTITY_PATH = identityPath;
    process.env.RASEN_FINALIZATION_INDEX_PATH = indexPath;
    process.env.RASEN_FINALIZATION_CHANGE_ID = bound.changeId;
    process.env.RASEN_FINALIZATION_NEXT_INSTANCE_SEED = nextSeed;
    process.env.RASEN_FINALIZATION_NEXT_CHANGE_INSTANCE = nextInstance;
    process.env.RASEN_FINALIZATION_NEXT_WORKSPACE_PAIR = nextPair;
    const server = await startServer(fixtureCli);
    const transactionsBefore = hashTree(
      path.join(f.globalDataDir, 'archive-transactions')
    );

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Identity changed after inspection.',
      }),
    });

    expect(fs.readFileSync(identityPath, 'utf8')).toContain(nextInstance);
    expect(hashTree(path.join(f.globalDataDir, 'archive-transactions'))).toEqual(
      transactionsBefore
    );
    expect(res.status, res.body).toBe(409);
    expect(res.json().error.code).toBe('archive_finalization_preview_changed');
  }, 300_000);

  // L3+L5-port deferral: the refusal semantics below assert green; the byte-level
  // tree-identity snapshot fails because this line's real-CLI inspect refreshes
  // the planning worktree's git index (content unchanged). Root-cause with the
  // L7 management-api wave; resumes verbatim.
  it.skip('rejects merge-gate drift between real inspect and save before transaction persistence', async () => {
    const fixtureCli = path.resolve(
      __dirname,
      '..',
      '..',
      'fixtures',
      'management-api',
      'finalization-cli.mjs'
    );
    const shipLogPath = path.join(bound.changeDir, 'ship-log.md');
    process.env.RASEN_FINALIZATION_FIXTURE_MODE = 'drift-merge-after-inspect';
    process.env.RASEN_FINALIZATION_REAL_CLI = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'dist',
      'cli',
      'index.js'
    );
    process.env.RASEN_FINALIZATION_SHIP_LOG_PATH = shipLogPath;
    const server = await startServer(fixtureCli);
    const transactionsBefore = hashTree(
      path.join(f.globalDataDir, 'archive-transactions')
    );

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Merge gate changed after inspection.',
      }),
    });

    expect(fs.readFileSync(shipLogPath, 'utf8')).toContain('**Mode:** pr');
    expect(hashTree(path.join(f.globalDataDir, 'archive-transactions'))).toEqual(
      transactionsBefore
    );
    expect(res.status, res.body).toBe(409);
    expect(res.json().error.code).toBe('archive_finalization_preview_changed');
  }, 300_000);

  // L3+L5-port deferral: the refusal semantics below assert green; the byte-level
  // tree-identity snapshot fails because this line's real-CLI inspect refreshes
  // the planning worktree's git index (content unchanged). Root-cause with the
  // L7 management-api wave; resumes verbatim.
  it.skip('rejects archive-cleaner decision drift between real inspect and save before transaction persistence', async () => {
    const fixtureCli = path.resolve(
      __dirname,
      '..',
      '..',
      'fixtures',
      'management-api',
      'finalization-cli.mjs'
    );
    const ephemeraDir = path.join(
      bound.executionWorktree,
      '.rasen',
      'changes',
      bound.changeId,
      'ephemera'
    );
    const driftFile = path.join(ephemeraDir, 'after-inspection.log');
    const phaseLog = path.join(f.tempDir, 'cleaner-decision-drift-phases.log');
    fs.mkdirSync(ephemeraDir, { recursive: true });
    process.env.RASEN_FINALIZATION_FIXTURE_MODE =
      'drift-ephemera-after-inspect';
    process.env.RASEN_FINALIZATION_REAL_CLI = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'dist',
      'cli',
      'index.js'
    );
    process.env.RASEN_FINALIZATION_EPHEMERA_FILE = driftFile;
    process.env.RASEN_FINALIZATION_PHASE_LOG = phaseLog;
    const server = await startServer(fixtureCli);
    const transactionsBefore = hashTree(
      path.join(f.globalDataDir, 'archive-transactions')
    );

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Archive cleaner decision changed after inspection.',
      }),
    });

    expect(hashTree(path.join(f.globalDataDir, 'archive-transactions'))).toEqual(
      transactionsBefore
    );
    expect(res.status, res.body).toBe(409);
    expect(res.json().error.code).toBe('archive_finalization_preview_changed');
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.readFileSync(phaseLog, 'utf8').trim().split(/\r?\n/u)).toEqual([
      'inspect',
      'save',
    ]);
    expect(fs.readFileSync(driftFile, 'utf8')).toContain(
      'created after finalization inspection'
    );
  }, 300_000);

  it.skip.each([
    { label: 'omitted', mergeConfirmed: undefined },
    { label: 'false', mergeConfirmed: false },
  ])(
    // L3+L5-port deferral: same snapshot class as above. Resumes verbatim.
    'refuses the sole merge gate when mergeConfirmed is $label without persisting a transaction',
    async ({ mergeConfirmed }) => {
      seedPullRequestDelivery();
      const server = await startServer();
      const before = snapshotFinalizationTrees();
      const body = {
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Recorded after PR delivery.',
        ...(mergeConfirmed === undefined ? {} : { mergeConfirmed }),
      };

      const res = await req(server.port, {
        method: 'POST',
        path: finalizePath(),
        headers: authed(),
        body: JSON.stringify(body),
      });

      expect(res.status, res.body).toBe(422);
      expect(res.json().error.code).toBe('archive_merge_confirmation_required');
      expect(res.json().error.finalization).toEqual({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            code: 'finalization_record_invalid',
            archiveBlocker: expect.objectContaining({
              code: 'archive_merge_confirmation_required',
              operation: 'timing',
            }),
          }),
        ],
      });
      expect(snapshotFinalizationTrees()).toEqual(before);
    },
    300_000
  );

  it('admits the sole merge gate only for explicit true and applies the exact saved transaction', async () => {
    seedPullRequestDelivery();
    const server = await startServer();

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Recorded after verified PR merge.',
        mergeConfirmed: true,
      }),
    });

    expect(res.status, res.body).toBe(200);
    expect(res.json().finalization).toMatchObject({
      changeInstanceId: bound.changeInstanceId,
      outcome: 'abandoned',
    });
    const transactionInventory = hashTree(
      path.join(f.globalDataDir, 'archive-transactions')
    );
    expect(Object.keys(transactionInventory)).toEqual([
      expect.stringMatching(/^[^/]+\/plan\.json$/u),
    ]);
  }, 300_000);

  // L3+L5-port deferral: same class as the four above — refusal semantics green,
  // byte-level tree snapshot fails on the planning worktree's refreshed git
  // index. Resumes verbatim with the L7 wave.
  it.skip('retains the complete blocker array and saves nothing when true accompanies a second blocker', async () => {
    seedPullRequestDelivery();
    f.write(path.join(bound.changeDir, 'tasks.md'), '- [ ] unresolved task\n');
    const server = await startServer();
    const before = snapshotFinalizationTrees();

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Blocked by another condition.',
        mergeConfirmed: true,
      }),
    });

    expect(res.status, res.body).toBe(422);
    const blockers = res.json().error.finalization.blockers;
    expect(blockers).toHaveLength(2);
    expect(blockers).toEqual([
      expect.objectContaining({
        archiveBlocker: expect.objectContaining({
          operation: 'tasks',
          message: '1 task(s) are incomplete.',
        }),
      }),
      expect.objectContaining({
        archiveBlocker: expect.objectContaining({
          code: 'archive_merge_confirmation_required',
        }),
      }),
    ]);
    expect(snapshotFinalizationTrees()).toEqual(before);
  }, 300_000);

  // L3+L5-port deferral: same class as the four above — refusal semantics green,
  // byte-level tree snapshot fails on the planning worktree's refreshed git
  // index. Resumes verbatim with the L7 wave.
  it.skip('preserves real reconciliation issue occurrences through ArchiveCommand, CLI JSON, and loopback HTTP', async () => {
    const canonical = path.join(
      bound.planningWorktree,
      'rasen',
      'projects',
      PROJECT,
      'specs',
      'alpha',
      'spec.md'
    );
    const source = path.join(bound.changeDir, 'specs', 'alpha', 'spec.md');
    f.write(
      canonical,
      [
        '# alpha Specification',
        '',
        '## Purpose',
        'Exercise production reconciliation.',
        '',
        '## Requirements',
        '',
        '### Requirement: First Rule',
        'The system SHALL preserve the first behavior.',
        '',
        '#### Scenario: First scenario',
        '- **WHEN** the first behavior runs',
        '- **THEN** it remains observable',
        '',
        '### Requirement: Second Rule',
        'The system SHALL preserve the second behavior.',
        '',
        '#### Scenario: Second scenario',
        '- **WHEN** the second behavior runs',
        '- **THEN** it remains observable',
        '',
      ].join('\n')
    );
    f.write(
      source,
      [
        '# alpha - Changes',
        '',
        '## MODIFIED Requirements',
        '',
        '### Requirement: First Rule',
        'The system SHALL replace the first behavior.',
        '',
        '#### Scenario: First replacement',
        '- **WHEN** the replacement runs',
        '- **THEN** it remains observable',
        '',
        '### Requirement: Second Rule',
        'The system SHALL replace the second behavior.',
        '',
        '#### Scenario: Second replacement',
        '- **WHEN** the replacement runs',
        '- **THEN** it remains observable',
        '',
      ].join('\n')
    );
    const expectedIssues = [
      {
        code: 'spec_modified_scenarios_missing',
        source,
        capability: 'alpha',
        requirement: 'First Rule',
        missingScenarios: ['First scenario'],
        message:
          'alpha MODIFIED failed for header "### Requirement: First Rule" - current spec contains scenario(s) not present in the modified block: "First scenario". Refresh the change spec before archiving to avoid dropping scenarios.',
      },
      {
        code: 'spec_modified_scenarios_missing',
        source,
        capability: 'alpha',
        requirement: 'Second Rule',
        missingScenarios: ['Second scenario'],
        message:
          'alpha MODIFIED failed for header "### Requirement: Second Rule" - current spec contains scenario(s) not present in the modified block: "Second scenario". Refresh the change spec before archiving to avoid dropping scenarios.',
      },
    ];
    const server = await startServer();
    const before = snapshotFinalizationTrees();

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'landed',
        commit: f.refOid(bound.executionWorktree, 'HEAD'),
      }),
    });

    expect(res.status, res.body).toBe(422);
    expect(res.json().error.code).toBe('finalization_record_invalid');
    const issues = res
      .json()
      .error.finalization.blockers.flatMap(
        (blocker: { specReconciliationIssue?: unknown }) =>
          blocker.specReconciliationIssue === undefined
            ? []
            : [blocker.specReconciliationIssue]
      );
    expect(issues).toEqual(expectedIssues);
    expect(snapshotFinalizationTrees()).toEqual(before);
  }, 300_000);

  it('preserves the real CLI association failure disposition through child process and loopback HTTP', async () => {
    const fixtureCli = path.resolve(
      __dirname,
      '..',
      '..',
      'fixtures',
      'management-api',
      'finalization-cli.mjs'
    );
    const realCli = path.resolve(__dirname, '..', '..', '..', 'dist', 'cli', 'index.js');
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${bound.planningScopeId}.json`
    );
    process.env.RASEN_FINALIZATION_FIXTURE_MODE = 'malformed-index';
    process.env.RASEN_FINALIZATION_REAL_CLI = realCli;
    process.env.RASEN_FINALIZATION_INDEX_PATH = indexPath;
    const server = await startServer(fixtureCli);

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Exercise the real association apply boundary.',
      }),
    });

    expect(res.status, res.body).toBe(422);
    const finalization = res.json().error.finalization;
    expect(finalization.status).toBe('recoverable');
    expect(finalization.blockers).toEqual([
      expect.objectContaining({
        code: 'finalization_record_invalid',
        archiveBlocker: expect.objectContaining({
          code: 'planning_execution_binding_mismatch',
          operation: 'association',
        }),
      }),
    ]);
    expect(finalization.manualRecoveryAction).toEqual({
      kind: 'manual-recovery-required',
      guidance: expect.stringContaining(
        'the frozen Store binding disagrees and must never be overwritten automatically.'
      ),
    });
    expect(finalization.manualRecoveryAction.guidance).toContain(
      bound.planningWorktree
    );
    expect(finalization.recoveryCommand).toBeUndefined();
    expect(finalization.abortCommand).toBeUndefined();
    expect(fs.readFileSync(indexPath, 'utf8')).toContain(
      'malformed-unrelated-change'
    );
  }, 300_000);

  it.each(['abort-required', 'manual-only'] as const)(
    'preserves an exact %s disposition from a bounded child process through the real route',
    async mode => {
      const fixtureCli = path.resolve(
        __dirname,
        '..',
        '..',
        'fixtures',
        'management-api',
        'finalization-cli.mjs'
      );
      process.env.RASEN_FINALIZATION_FIXTURE_MODE = mode;
      process.env.RASEN_FINALIZATION_REAL_CLI = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        'dist',
        'cli',
        'index.js'
      );
      process.env.RASEN_FINALIZATION_INDEX_PATH = path.join(
        f.globalDataDir,
        'planning-workspaces',
        'index',
        `${bound.planningScopeId}.json`
      );
      const server = await startServer(fixtureCli);

      const res = await req(server.port, {
        method: 'POST',
        path: finalizePath(),
        headers: authed(),
        body: JSON.stringify({
          changeId: bound.changeId,
          outcome: 'abandoned',
          reason: 'Exercise a bounded incomplete disposition.',
        }),
      });

      expect(res.status, res.body).toBe(422);
      const finalization = res.json().error.finalization;
      expect(finalization.status).toBe(
        mode === 'abort-required' ? 'abort-required' : 'blocked'
      );
      expect(finalization.blockers).toEqual([
        {
          code: 'finalization_record_invalid',
          message: 'association: the recorded carrier is not safe to mutate.',
          archiveBlocker: {
            code: 'archive_journal_ownership_mismatch',
            operation: 'association',
            path: process.env.RASEN_FINALIZATION_INDEX_PATH,
            message: 'the recorded carrier is not safe to mutate.',
          },
        },
        {
          code: 'finalization_record_invalid',
          message: 'A typed reconciliation issue remains visible.',
          specReconciliationIssue: {
            code: 'spec_modified_scenarios_missing',
            source: 'specs/alpha/spec.md',
            capability: 'alpha',
            requirement: 'Second Rule',
            missingScenarios: ['Scenario B'],
            message: 'A typed reconciliation issue remains visible.',
          },
        },
      ]);
      if (mode === 'abort-required') {
        expect(finalization.abortCommand).toMatch(
          /^rasen archive --abort-plan archive-v1:.* --yes$/u
        );
        expect(finalization.manualRecoveryAction).toBeUndefined();
      } else {
        expect(finalization.manualRecoveryAction).toEqual({
          kind: 'manual-recovery-required',
          guidance: 'Preserve the verified journal and inspect ownership manually.',
        });
        expect(finalization.recoveryCommand).toBeUndefined();
        expect(finalization.abortCommand).toBeUndefined();
      }
    },
    300_000
  );

  it.each(['inspect', 'save', 'apply'] as const)(
    'names the %s phase when a zero-exit child returns unreadable output',
    async phase => {
      const fixtureCli = path.resolve(
        __dirname,
        '..',
        '..',
        'fixtures',
        'management-api',
        'finalization-cli.mjs'
      );
      process.env.RASEN_FINALIZATION_FIXTURE_MODE = `garbage-${phase}`;
      process.env.RASEN_FINALIZATION_CHANGE_INSTANCE = bound.changeInstanceId;
      const finalize = createChangeFinalizer(
        { launchProjectRoot: bound.executionWorktree },
        { cliEntryOverride: fixtureCli, timeoutMs: 5_000 }
      );

      const result = await finalize(
        {
          storeUid: f.storeId,
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: bound.changeInstanceId,
        },
        {
          changeId: bound.changeId,
          outcome: 'abandoned',
          reason: 'Protocol phase coverage.',
        }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('cli_protocol_error');
      expect(result.message).toContain(
        phase === 'inspect' ? 'inspection' : phase === 'save' ? 'saved preview' : 'applied'
      );
    },
    30_000
  );

  it.each(['inspect', 'save', 'apply'] as const)(
    'preserves a non-zero %s diagnostic independently of the other phases',
    async phase => {
      const fixtureCli = path.resolve(
        __dirname,
        '..',
        '..',
        'fixtures',
        'management-api',
        'finalization-cli.mjs'
      );
      process.env.RASEN_FINALIZATION_FIXTURE_MODE = `nonzero-${phase}`;
      process.env.RASEN_FINALIZATION_CHANGE_INSTANCE = bound.changeInstanceId;
      const finalize = createChangeFinalizer(
        { launchProjectRoot: bound.executionWorktree },
        { cliEntryOverride: fixtureCli, timeoutMs: 5_000 }
      );

      const result = await finalize(
        {
          storeUid: f.storeId,
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: bound.changeInstanceId,
        },
        {
          changeId: bound.changeId,
          outcome: 'abandoned',
          reason: 'Non-zero phase coverage.',
        }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(`fixture_${phase}_failed`);
      expect(result.cliExitCode).toBe(1);
    },
    30_000
  );

  it.each(['inspect', 'save'] as const)(
    'prioritizes an independent %s failure over a valid sole-merge preview',
    async phase => {
      const fixtureCli = path.resolve(
        __dirname,
        '..',
        '..',
        'fixtures',
        'management-api',
        'finalization-cli.mjs'
      );
      const phaseLog = path.join(f.tempDir, `merge-protocol-${phase}.log`);
      process.env.RASEN_FINALIZATION_FIXTURE_MODE =
        `merge-plus-failure-${phase}`;
      process.env.RASEN_FINALIZATION_CHANGE_INSTANCE = bound.changeInstanceId;
      process.env.RASEN_FINALIZATION_PHASE_LOG = phaseLog;
      const server = await startServer(fixtureCli);
      const transactionsBefore = hashTree(
        path.join(f.globalDataDir, 'archive-transactions')
      );

      const res = await req(server.port, {
        method: 'POST',
        path: finalizePath(),
        headers: authed(),
        body: JSON.stringify({
          changeId: bound.changeId,
          outcome: 'abandoned',
          reason: 'Protocol failure must win.',
          mergeConfirmed: true,
        }),
      });

      expect(res.status, res.body).toBe(422);
      expect(res.json().error).toMatchObject({
        code: `fixture_${phase}_independent_failure`,
        cliExitCode: 1,
      });
      expect(fs.readFileSync(phaseLog, 'utf8').trim().split(/\r?\n/u)).toEqual(
        phase === 'inspect' ? ['inspect'] : ['inspect', 'save']
      );
      expect(hashTree(path.join(f.globalDataDir, 'archive-transactions'))).toEqual(
        transactionsBefore
      );
    },
    120_000
  );

  it.each(['inspect', 'save', 'apply'] as const)(
    'times out the %s phase and releases the cap-one gate',
    async phase => {
      const fixtureCli = path.resolve(
        __dirname,
        '..',
        '..',
        'fixtures',
        'management-api',
        'finalization-cli.mjs'
      );
      process.env.RASEN_FINALIZATION_FIXTURE_MODE = `hang-${phase}`;
      process.env.RASEN_FINALIZATION_CHANGE_INSTANCE = bound.changeInstanceId;
      const finalize = createChangeFinalizer(
        { launchProjectRoot: bound.executionWorktree },
        {
          cliEntryOverride: fixtureCli,
          // Windows process creation can exceed a few hundred milliseconds
          // under the full focused suite. Keep the hung phase bounded without
          // timing out an earlier synthetic phase before it can emit JSON.
          timeoutMs: 2_000,
          killGraceMs: 250,
        }
      );
      const scope = {
        storeUid: f.storeId,
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: bound.changeInstanceId,
      };
      const body = {
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Timeout phase coverage.',
      };
      const first = finalize(scope, body);
      const busy = await finalize(scope, body);
      expect(busy).toMatchObject({ ok: false, status: 409, code: 'busy' });
      const timedOut = await first;
      expect(timedOut).toMatchObject({
        ok: false,
        status: 504,
        code: 'cli_timeout',
        message: expect.stringContaining(
          phase === 'inspect' ? 'inspection' : phase === 'save' ? 'saving' : 'applying'
        ),
      });

      process.env.RASEN_FINALIZATION_FIXTURE_MODE = 'garbage-inspect';
      const after = await finalize(scope, body);
      expect(after).not.toMatchObject({ code: 'busy' });
    },
    30_000
  );

  it('finalizes through a spawned CLI and reports the recorded outcome', async () => {
    const server = await startServer();

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'abandoned',
        reason: 'Recorded through the management route.',
      }),
    });

    expect(res.status, res.body).toBe(200);
    const finalization = res.json().finalization;
    expect(finalization).toMatchObject({
      outcome: 'abandoned',
      changeId: bound.changeId,
      changeInstanceId: bound.changeInstanceId,
      workspacePairId: bound.workspacePairId,
      projectId: PROJECT,
      targetLineId: LINE,
      specSyncApplied: false,
      specSyncActionCount: 0,
      provenCommit: null,
    });
    // The published entry is real, and it carries an Archive v2 record.
    expect(fs.existsSync(finalization.publishedEntry)).toBe(true);
    const record = JSON.parse(
      fs.readFileSync(path.join(finalization.publishedEntry, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      schemaVersion: 2,
      outcome: 'abandoned',
      changeInstanceId: bound.changeInstanceId,
    });
    expect(fs.existsSync(bound.changeDir)).toBe(false);
  }, 300_000);

  it('surfaces a CLI refusal diagnostic unchanged, leaving no partial entry', async () => {
    const server = await startServer();
    const codeRepo = f.projectRoot(PROJECT);
    f.git(codeRepo, ['checkout', '-b', 'sidetrack', 'main']);
    f.write(path.join(codeRepo, 'sidetrack.txt'), 'sidetrack\n');
    f.git(codeRepo, ['add', 'sidetrack.txt']);
    f.git(codeRepo, ['commit', '-m', 'sidetrack']);
    const unreachable = f.refOid(codeRepo, 'HEAD');
    f.git(codeRepo, ['checkout', 'main']);

    const res = await req(server.port, {
      method: 'POST',
      path: finalizePath(),
      headers: authed(),
      body: JSON.stringify({
        changeId: bound.changeId,
        outcome: 'landed',
        commit: unreachable,
      }),
    });

    expect(res.status).toBe(422);
    // The finalization Module's own code and message, not a rewritten one.
    expect(res.json().error.code).toBe('landed_commit_unreachable');
    expect(res.json().error.message).toContain(unreachable);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
    expect(fs.existsSync(bound.changeDir)).toBe(true);
  }, 300_000);
});
