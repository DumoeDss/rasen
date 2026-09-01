import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  handleStoreChangeIssueLinks,
  handleStoreIssueCreate,
  handleStorePublishPlan,
  resolveStoreSpace,
  type ResolvedStoreSpace,
  type StoreHandlerResult,
} from '../../../src/core/management-api/stores.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import { composeChangeIssueLinks } from '../../../src/core/issue-read/index.js';
import { createStoreQueryByUid } from '../../../src/core/store/query/module.js';
import type { StoreQueryModule } from '../../../src/core/store/query/types.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'main';
const TOKEN = 'test-token-change-issue-links';

function unwrap<T>(result: StoreHandlerResult<T>): T {
  expect(result.ok, result.ok ? '' : `${result.code}: ${result.message}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.response;
}

function treeFingerprint(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git') walk(full);
      } else {
        result.set(path.relative(root, full), createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(root);
  return result;
}

function request(
  port: number,
  requestPath: string,
  authenticated = true,
  method = 'GET',
  body?: unknown
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(encoded === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) }),
      },
      agent: false,
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk as Buffer));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, json: JSON.parse(body) });
      });
    });
    req.on('error', reject);
    if (encoded !== undefined) req.write(encoded);
    req.end();
  });
}

describe('Change-to-Issue link composition and route', { timeout: 240_000 }, () => {
  let f: StoreWorkspaceFixture;
  let space: ResolvedStoreSpace;
  let server: ManagementServerHandle | undefined;
  let originalEnv: NodeJS.ProcessEnv;
  let linkedInstance: string;
  let unlinkedInstance: string;
  let archivedInstance: string;
  let issueAUid: string;
  let issueBUid: string;

  const commit = (message: string): void => {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  };

  const publish = async (issueId: string, nodes: Array<Record<string, unknown>>): Promise<void> => {
    unwrap(await handleStorePublishPlan(space, { issueId, nodes }));
  };

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-change-links-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    f.write(path.join(f.storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    linkedInstance = f.seedChange({ root: f.storeRoot, projectId: PROJECT, targetLineId: LINE, changeId: 'linked-change', instanceSeed: 'a1'.repeat(16) }).instanceId;
    unlinkedInstance = f.seedChange({ root: f.storeRoot, projectId: PROJECT, targetLineId: LINE, changeId: 'unlinked-change', instanceSeed: 'b2'.repeat(16) }).instanceId;
    archivedInstance = f.seedChange({ root: f.storeRoot, projectId: PROJECT, targetLineId: LINE, changeId: 'historical-change', instanceSeed: 'c3'.repeat(16) }).instanceId;
    const duplicate = f.seedChange({ root: f.storeRoot, projectId: PROJECT, targetLineId: LINE, changeId: 'duplicate-a', instanceSeed: 'd4'.repeat(16) });
    fs.cpSync(duplicate.directory, f.at('rasen', 'projects', PROJECT, 'changes', 'duplicate-b'), { recursive: true });
    commit('seed change-link evidence');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    for (const [key, value] of Object.entries(f.env)) if (value !== undefined) process.env[key] = value;
    const resolved = await resolveStoreSpace(`store:${f.storeUid}`);
    if (!resolved.ok) throw new Error(`${resolved.code}: ${resolved.message}`);
    space = resolved.space;

    issueAUid = unwrap(
      await handleStoreIssueCreate(space, { issueId: 'issue-a', title: 'Issue A' })
    ).identity.uid;
    await publish('issue-a', [
      { nodeId: 'linked-a', kind: 'change', projectId: PROJECT, targetLineId: LINE, changeInstanceId: linkedInstance, dependsOn: [] },
      { nodeId: 'historical', kind: 'change', projectId: PROJECT, targetLineId: LINE, changeInstanceId: archivedInstance, dependsOn: [] },
    ]);
    issueBUid = unwrap(
      await handleStoreIssueCreate(space, { issueId: 'issue-b', title: 'Issue B' })
    ).identity.uid;
    await publish('issue-b', [
      { nodeId: 'linked-b', kind: 'change', projectId: PROJECT, targetLineId: LINE, changeInstanceId: linkedInstance, dependsOn: [] },
    ]);

    const archiveName = `2026-08-24-historical-change--${archivedInstance.slice(3, 15)}`;
    const archiveDir = f.at('rasen', 'projects', PROJECT, 'changes', 'archive', LINE, archiveName);
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(f.at('rasen', 'projects', PROJECT, 'changes', 'historical-change'), archiveDir);
    commit('publish issues and archive one Change');
  }, 240_000);

  afterEach(async () => {
    await server?.stopServer();
    server = undefined;
    process.env = originalEnv;
    f.cleanup();
  });

  it('reports active/archive, multiple proven Issues, attachable zero-link, ambiguity, and stable order', async () => {
    const query = createStoreQueryByUid();
    const payload = await composeChangeIssueLinks(query, { store: f.storeUid, startPath: '' });
    expect(payload.complete).toBe(true);
    expect(payload.entries.map(entry => entry.occurrence.change.changeId)).toEqual([
      'duplicate-a', 'duplicate-b', 'linked-change', 'unlinked-change', 'historical-change',
    ]);

    const byId = (changeId: string) => payload.entries.find(entry => entry.occurrence.change.changeId === changeId)!;
    expect(byId('linked-change')).toMatchObject({ association: 'linked', eligibility: 'already-linked' });
    expect(byId('linked-change').issues.map(issue => [issue.issueId, issue.nodeIds])).toEqual(
      [
        [issueAUid, ['linked-a']],
        [issueBUid, ['linked-b']],
      ].sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    );
    expect(byId('linked-change').issues.map(issue => issue.identity.uid)).toEqual(
      [issueAUid, issueBUid].sort()
    );
    expect(byId('unlinked-change')).toMatchObject({ association: 'unlinked', eligibility: 'attachable', issues: [] });
    expect(byId('historical-change')).toMatchObject({ occurrence: { kind: 'archived' }, association: 'linked' });
    expect(byId('duplicate-a')).toMatchObject({ association: 'unknown', eligibility: 'identity-ambiguous' });
    expect(byId('duplicate-b')).toMatchObject({ association: 'unknown', eligibility: 'identity-ambiguous' });

    expect(unwrap(await handleStoreChangeIssueLinks(space))).toEqual(payload);
  });

  it('reports a null instance as identity-missing without inferring from its alias or sole project', async () => {
    const base = createStoreQueryByUid();
    const query = new Proxy(base, {
      get(target, property, receiver) {
        if (property === 'listChanges') {
          return async (...args: Parameters<StoreQueryModule['listChanges']>) => {
            const grouped = await target.listChanges(...args);
            const first = grouped.groups[0]!;
            return {
              ...grouped,
              groups: [{
                ...first,
                active: [...first.active, {
                  changeId: 'legacy-missing-id',
                  changeInstanceId: null,
                  projectId: PROJECT,
                  targetLineId: LINE,
                  foundAtRef: 'refs/heads/main',
                  localLocator: null,
                }],
              }, ...grouped.groups.slice(1)],
            };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const payload = await composeChangeIssueLinks(query, { store: f.storeUid, startPath: '' });
    expect(payload.entries.find(entry => entry.occurrence.change.changeId === 'legacy-missing-id')).toMatchObject({
      association: 'unknown', eligibility: 'identity-missing', issues: [],
    });
  });

  it('lowers zero-link candidates to unknown for an unreadable latest plan while preserving an unrelated proven link', async () => {
    const damaged = f.at('rasen', 'issues', issueAUid, 'plans', '0001.yaml');
    fs.writeFileSync(damaged, fs.readFileSync(damaged, 'utf8').replace('contentSha256:', 'contentSha256X:'), 'utf8');
    commit('damage one latest plan');

    const payload = unwrap(await handleStoreChangeIssueLinks(space));
    expect(payload.complete).toBe(false);
    const byId = (changeId: string) => payload.entries.find(entry => entry.occurrence.change.changeId === changeId)!;
    expect(byId('linked-change')).toMatchObject({ association: 'linked', eligibility: 'already-linked' });
    expect(byId('linked-change').issues.map(issue => issue.issueId)).toEqual([issueBUid]);
    expect(byId('unlinked-change')).toMatchObject({ association: 'unknown', eligibility: 'evidence-incomplete' });
    expect(byId('historical-change')).toMatchObject({ association: 'unknown', eligibility: 'evidence-incomplete' });
  });

  it('fails closed when a plan-bearing Issue record diverges across declared refs', async () => {
    const releaseCatalog = f.at('.rasen-store', 'target-lines', 'release.yaml');
    fs.writeFileSync(
      releaseCatalog,
      [
        'version: 1',
        'id: release',
        'storeRef: refs/heads/release',
        'projects:',
        `  ${PROJECT}:`,
        '    codeRef: refs/heads/main',
        '',
      ].join('\n'),
      'utf8'
    );
    commit('declare release ref');
    f.git(f.storeRoot, ['branch', 'release']);
    f.git(f.storeRoot, ['checkout', 'release']);
    const recordPath = f.at('rasen', 'issues', issueAUid, 'issue.yaml');
    fs.writeFileSync(
      recordPath,
      fs.readFileSync(recordPath, 'utf8').replace('title: Issue A', 'title: Divergent Issue A'),
      'utf8'
    );
    commit('diverge Issue A on release');
    f.git(f.storeRoot, ['checkout', 'main']);

    const payload = await composeChangeIssueLinks(createStoreQueryByUid(), {
      store: f.storeUid,
      startPath: '',
    });
    expect(payload.complete).toBe(false);
    expect(payload.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'issue', itemId: issueAUid, reason: expect.stringMatching(/diverge/iu) }),
      ])
    );
    const historical = payload.entries.find(
      entry => entry.occurrence.change.changeId === 'historical-change'
    );
    expect(historical).toMatchObject({
      association: 'unknown',
      eligibility: 'evidence-incomplete',
      issues: [],
    });
  });

  it('is fresh between identical reads and repeated reads write no Store byte', async () => {
    const before = treeFingerprint(f.storeRoot);
    const first = unwrap(await handleStoreChangeIssueLinks(space));
    const second = unwrap(await handleStoreChangeIssueLinks(space));
    expect(second).toEqual(first);
    expect(treeFingerprint(f.storeRoot)).toEqual(before);
    expect(first.entries.find(entry => entry.occurrence.change.changeInstanceId === unlinkedInstance)?.association).toBe('unlinked');

    unwrap(await handleStoreIssueCreate(space, { issueId: 'issue-fresh', title: 'Fresh link' }));
    await publish('issue-fresh', [
      { nodeId: 'fresh', kind: 'change', projectId: PROJECT, targetLineId: LINE, changeInstanceId: unlinkedInstance, dependsOn: [] },
    ]);
    commit('link previously unlinked Change');
    const refreshed = unwrap(await handleStoreChangeIssueLinks(space));
    expect(refreshed.entries.find(entry => entry.occurrence.change.changeInstanceId === unlinkedInstance)).toMatchObject({
      association: 'linked', eligibility: 'already-linked',
    });
  });

  it('serves an authenticated unwrapped HTTP payload and refuses missing Store scope', async () => {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: f.storeRoot,
      launchProjectRef: { projectId: PROJECT, name: PROJECT, root: f.storeRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    server = await startManagementServer({ context });
    const selector = `space=store:${encodeURIComponent(f.storeUid)}`;
    const success = await request(server.port, `/api/v1/stores/change-issue-links?${selector}`);
    expect(success.status).toBe(200);
    expect(success.json).toEqual(unwrap(await handleStoreChangeIssueLinks(space)));
    expect(success.json).not.toHaveProperty('response');

    const noSpace = await request(server.port, '/api/v1/stores/change-issue-links');
    expect(noSpace.status).toBe(400);
    expect(noSpace.json.error.code).toBe('space_required');
    expect((await request(server.port, `/api/v1/stores/change-issue-links?${selector}`, false)).status).toBe(401);
  });

  it('keeps a created Issue after first-plan refusal and recovers by attaching the still-unlinked Change', async () => {
    const issueId = 'partial-create';
    const created = unwrap(await handleStoreIssueCreate(space, {
      issueId,
      title: 'Partial create receipt',
    }));
    expect(created.record).toMatchObject({
      version: 2,
      identity: created.identity,
      state: 'open',
    });
    expect(created.issueId).toBe(created.identity.uid);

    const refused = await handleStorePublishPlan(space, {
      issueId: created.identity.uid,
      expectedRevisionId: null,
      nodes: [{
        nodeId: 'unlinked-change',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: `ci_${'9'.repeat(64)}`,
        changeAlias: 'unlinked-change',
        dependsOn: [],
      }],
    });
    expect(refused).toMatchObject({ ok: false, code: 'issue_reference_unresolved' });
    expect(fs.existsSync(f.at('rasen', 'issues', created.identity.uid, 'issue.yaml'))).toBe(true);
    const plansDir = f.at('rasen', 'issues', created.identity.uid, 'plans');
    expect(fs.existsSync(plansDir) ? fs.readdirSync(plansDir) : []).toEqual([]);
    expect(unwrap(await handleStoreChangeIssueLinks(space)).entries.find(
      entry => entry.occurrence.change.changeInstanceId === unlinkedInstance
    )).toMatchObject({ association: 'unlinked', eligibility: 'attachable' });

    const recovered = unwrap(await handleStorePublishPlan(space, {
      issueId: created.identity.uid,
      expectedRevisionId: null,
      nodes: [{
        nodeId: 'unlinked-change',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: unlinkedInstance,
        changeAlias: 'unlinked-change',
        dependsOn: [],
      }],
    }));
    expect(recovered.revision).toMatchObject({ revisionId: '0001', supersedes: null });
    expect(unwrap(await handleStoreChangeIssueLinks(space)).entries.find(
      entry => entry.occurrence.change.changeInstanceId === unlinkedInstance
    )).toMatchObject({
      association: 'linked',
      eligibility: 'already-linked',
      issues: [{ issueId: created.identity.uid, revisionId: '0001', nodeIds: ['unlinked-change'] }],
    });
  });

  it('validates expected revisions over HTTP, returns stale conflict, and preserves every plan-node field', async () => {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: f.storeRoot,
      launchProjectRef: { projectId: PROJECT, name: PROJECT, root: f.storeRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    server = await startManagementServer({ context });
    const pathWithSpace = `/api/v1/stores/execution-plan?space=store:${encodeURIComponent(f.storeUid)}`;
    const created = unwrap(
      await handleStoreIssueCreate(space, { issueId: 'api-plan', title: 'API plan' })
    );
    const node = {
      nodeId: 'preserved',
      kind: 'change',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: linkedInstance,
      changeAlias: 'linked-change',
      dependsOn: [],
      lifecycle: 'deferred',
      reason: 'scheduled later',
      suggestedPipeline: 'small-feature',
      rationale: 'keep the authored rationale',
      uncertainty: 'keep the authored uncertainty',
    };

    const malformed = await request(server.port, pathWithSpace, true, 'POST', {
      issueId: 'api-plan', expectedRevisionId: '1', nodes: [node],
    });
    expect(malformed.status).toBe(400);
    expect(malformed.json.error.code).toBe('execution_plan_revision_invalid');

    const first = await request(server.port, pathWithSpace, true, 'POST', {
      issueId: 'api-plan', expectedRevisionId: null, nodes: [node],
    });
    expect(first.status).toBe(200);
    expect(first.json.revision).toMatchObject({ revisionId: '0001', supersedes: null });
    expect(first.json.revision.nodes[0]).toEqual(node);

    const second = await request(server.port, pathWithSpace, true, 'POST', {
      issueId: 'api-plan', expectedRevisionId: '0001', nodes: [node],
    });
    expect(second.status).toBe(200);
    expect(second.json.revision).toMatchObject({ revisionId: '0002', supersedes: '0001' });
    expect(second.json.revision.nodes[0]).toEqual(node);

    const plansDir = f.at('rasen', 'issues', created.identity.uid, 'plans');
    const before = fs.readdirSync(plansDir).sort();
    const stale = await request(server.port, pathWithSpace, true, 'POST', {
      issueId: 'api-plan', expectedRevisionId: '0001', nodes: [node],
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('execution_plan_revision_conflict');
    expect(fs.readdirSync(plansDir).sort()).toEqual(before);

    const omitted = await request(server.port, pathWithSpace, true, 'POST', {
      issueId: 'api-plan', nodes: [node],
    });
    expect(omitted.status).toBe(200);
    expect(omitted.json.revision.revisionId).toBe('0003');
  });
});
