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
  decodeFinalizationDisposition,
  finalizationOptions,
  inspectFinalizationPreviewBlockers,
} from '../../../src/core/management-api/finalize.js';

const TOKEN = 'test-token-finalize-abc123';
const PROJECT = 'app-a';
const LINE = 'line-0.2';

interface HttpResult {
  status: number;
  body: string;
  json: () => any;
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

  async function startServer(): Promise<ManagementServerHandle> {
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
    handle = await startManagementServer({ context });
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

  it.each(['GET', 'PUT', 'DELETE'])('405s %s on the finalize path', async method => {
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

  it('409s a path scope that disagrees with the committed identity, mutating nothing', async () => {
    const server = await startServer();
    const before = hashTree(bound.changeDir);

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
    // The disagreement was caught BEFORE any mutating subprocess: the Change
    // is byte-identical and no entry exists.
    expect(hashTree(bound.changeDir)).toEqual(before);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 180_000);

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
