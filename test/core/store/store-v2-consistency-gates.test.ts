import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { diagnoseConsistency } from '../../../src/core/store/consistency-gates.js';

describe('store v2 consistency gates', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-consistency-'));

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  let counter = 0;
  function freshStore(): string {
    counter++;
    const root = path.join(tmpBase, `store-${counter}`);
    return root;
  }

  function setupStoreV2(root: string): void {
    const metaDir = path.join(root, '.rasen-store');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, 'store.yaml'),
      'version: 2\nuid: a1b2c3d4-e5f6-7890-abcd-ef1234567890\nid: test-store\nlayoutVersion: 2\n',
      'utf8'
    );
  }

  /**
   * Sets up a Git loose ref so it resolves from the filesystem. The ref must be
   * a full ref name like `refs/heads/main`.
   */
  function setupGitRef(root: string, ref: string): void {
    const refPath = path.join(root, '.git', ...ref.split('/'));
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, '0123456789abcdef0123456789abcdef01234567\n', 'utf8');
  }

  /**
   * Writes a target-line catalog with a string `storeRef` matching the real
   * `StoreTargetLineCatalogV1` schema, and sets up the ref so it resolves.
   */
  function writeTargetLineCatalog(
    root: string,
    targetLineId: string,
    storeRef = 'refs/heads/main'
  ): void {
    const dir = path.join(root, '.rasen-store', 'target-lines');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${targetLineId}.yaml`),
      `version: 1\nid: ${targetLineId}\nstoreRef: ${storeRef}\nprojects: {}\n`,
      'utf8'
    );
    // Set up the loose ref so the catalog's storeRef resolves.
    setupGitRef(root, storeRef);
  }

  /**
   * Writes a target-line catalog without setting up the ref. Used to test the
   * unresolved-storeRef check.
   */
  function writeTargetLineCatalogUnresolved(
    root: string,
    targetLineId: string,
    storeRef: string
  ): void {
    const dir = path.join(root, '.rasen-store', 'target-lines');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${targetLineId}.yaml`),
      `version: 1\nid: ${targetLineId}\nstoreRef: ${storeRef}\nprojects: {}\n`,
      'utf8'
    );
    // Deliberately do NOT set up the ref.
  }

  function writeArchiveEntry(
    root: string,
    projectId: string,
    targetLineId: string,
    entryName: string,
    record: { projectId?: string; targetLineId?: string; changeId?: string }
  ): void {
    const entryDir = path.join(
      root,
      'rasen',
      'projects',
      projectId,
      'changes',
      'archive',
      targetLineId,
      entryName
    );
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, 'archive.json'),
      JSON.stringify({
        schemaVersion: 2,
        implementation: 'none',
        storeUid: 'store-uid-1',
        outcome: 'cancelled',
        reason: 'test reason',
        supersededBy: null,
        planning: { worktreeInstanceId: 'wti-1', ref: 'refs/heads/main', headOid: 'abc123' },
        codeMerge: null,
        specSync: { sourceDigest: '', actions: [] },
        evidence: { codeCommit: null, planningBranch: null },
        missing: [],
        archivedAt: '2026-01-01T00:00:00Z',
        changeInstanceId: 'cii-1',
        workspacePairId: 'wpi-1',
        ...record,
      }),
      'utf8'
    );
  }

  /**
   * Writes an active Change with a `.openspec.yaml` carrying a v2 identity.
   */
  function writeActiveChange(
    root: string,
    projectId: string,
    changeId: string,
    identity: { version: 2; instanceSeed: string; instanceId: string; storeUid: string; projectId: string; targetLineId: string }
  ): void {
    const entryDir = path.join(root, 'rasen', 'projects', projectId, 'changes', changeId);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, '.openspec.yaml'),
      `schema: rasen-change/1\nidentity:\n  version: ${identity.version}\n  instanceSeed: ${identity.instanceSeed}\n  instanceId: ${identity.instanceId}\n  storeUid: ${identity.storeUid}\n  projectId: ${identity.projectId}\n  targetLineId: ${identity.targetLineId}\n`,
      'utf8'
    );
  }

  it('reports a target-line mismatch when the recorded line disagrees with the holding partition', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');
    writeTargetLineCatalog(root, 'line-0.2');

    writeArchiveEntry(root, 'api-server', 'line-0.1', '2026-01-01-add-thing--abc123', {
      projectId: 'api-server',
      targetLineId: 'line-0.2',
      changeId: 'add-thing',
    });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    const mismatch = findings.find((f) => f.code === 'target_line_mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain('line-0.2');
    expect(mismatch!.message).toContain('line-0.1');
  });

  it('reports a project mismatch when the recorded project disagrees with the holding partition', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');

    writeArchiveEntry(root, 'api-server', 'line-0.1', '2026-01-01-add-thing--abc123', {
      projectId: 'platform-team',
      targetLineId: 'line-0.1',
      changeId: 'add-thing',
    });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    const mismatch = findings.find((f) => f.code === 'project_mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain('api-server');
    expect(mismatch!.message).toContain('platform-team');
  });

  it('reports a target-line partition with no declared catalog', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');
    // line-0.2 has no catalog but has a partition
    writeArchiveEntry(root, 'api-server', 'line-0.2', '2026-01-01-add-thing--abc123', {
      projectId: 'api-server',
      targetLineId: 'line-0.2',
      changeId: 'add-thing',
    });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    const undeclared = findings.find((f) => f.code === 'target_line_not_declared');
    expect(undeclared).toBeDefined();
    expect(undeclared!.message).toContain('line-0.2');
  });

  it('reports a target-line catalog whose declared storeRef does not resolve', async () => {
    const root = freshStore();
    setupStoreV2(root);
    // line-0.1 has a valid ref that resolves.
    writeTargetLineCatalog(root, 'line-0.1', 'refs/heads/main');
    // line-0.2 declares a ref that does NOT exist in the Store's Git repository.
    writeTargetLineCatalogUnresolved(root, 'line-0.2', 'refs/heads/release/0.3');

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    const unresolved = findings.find((f) => f.code === 'target_line_ref_unresolved');
    expect(unresolved).toBeDefined();
    expect(unresolved!.message).toContain('line-0.2');
    expect(unresolved!.message).toContain('refs/heads/release/0.3');

    // line-0.1 with a valid ref must NOT produce a finding.
    const validFinding = findings.find(
      (f) =>
        f.code === 'target_line_ref_unresolved' && f.message.includes('line-0.1')
    );
    expect(validFinding).toBeUndefined();
  });

  it('reports no findings when all entries are consistent', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');

    writeArchiveEntry(root, 'api-server', 'line-0.1', '2026-01-01-add-thing--abc123', {
      projectId: 'api-server',
      targetLineId: 'line-0.1',
      changeId: 'add-thing',
    });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    expect(findings).toEqual([]);
  });

  it('returns no findings for a layout v1 Store', async () => {
    const root = freshStore();
    // No layout v2 declaration — defaults to layout v1
    fs.mkdirSync(path.join(root, 'rasen', 'projects', 'api-server'), { recursive: true });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    expect(findings).toEqual([]);
  });

  it('never writes or modifies any file', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');
    writeArchiveEntry(root, 'api-server', 'line-0.1', '2026-01-01-add-thing--abc123', {
      projectId: 'wrong-project',
      targetLineId: 'line-0.1',
      changeId: 'add-thing',
    });

    function snapshot(dir: string): string {
      const entries: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          entries.push(`D ${entry.name}/`);
          entries.push(...snapshot(fullPath).map((s) => `  ${s}`));
        } else {
          const content = fs.readFileSync(fullPath, 'utf8');
          entries.push(`F ${entry.name} (${content.length} bytes)`);
        }
      }
      return entries;
    }

    const before = snapshot(root).join('\n');

    await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    const after = snapshot(root).join('\n');
    expect(after).toBe(before);
  });

  it('completes on a Store with three projects and two target lines', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');
    writeTargetLineCatalog(root, 'line-0.2');

    // Three projects, each with entries on both lines — all consistent.
    for (const proj of ['alpha', 'beta', 'gamma']) {
      writeArchiveEntry(root, proj, 'line-0.1', `2026-01-01-add-thing--${proj}1`, {
        projectId: proj,
        targetLineId: 'line-0.1',
        changeId: 'add-thing',
      });
      writeArchiveEntry(root, proj, 'line-0.2', `2026-01-01-add-thing--${proj}2`, {
        projectId: proj,
        targetLineId: 'line-0.2',
        changeId: 'add-thing',
      });
    }

    // The walk completes and reports no findings — all entries are consistent.
    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });
    expect(findings).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Active Change checks (LOW-2 — spec includes active Changes alongside
  // Archive entries)
  // -------------------------------------------------------------------------

  it('reports a project mismatch for an active Change whose recorded project disagrees with its holding partition', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');

    // Active Change in project 'api-server' but records project 'platform-team'.
    writeActiveChange(root, 'api-server', 'add-thing', {
      version: 2,
      instanceSeed: 'seed-1',
      instanceId: 'cii-active-1',
      storeUid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectId: 'platform-team',
      targetLineId: 'line-0.1',
    });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    const mismatch = findings.find(
      (f) => f.code === 'project_mismatch' && f.message.includes('Active Change')
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain('api-server');
    expect(mismatch!.message).toContain('platform-team');
  });

  it('reports an active Change naming a target line with no declared catalog', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');

    // Active Change records target line 'line-0.2' which has no catalog.
    writeActiveChange(root, 'api-server', 'add-thing', {
      version: 2,
      instanceSeed: 'seed-1',
      instanceId: 'cii-active-2',
      storeUid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectId: 'api-server',
      targetLineId: 'line-0.2',
    });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    const undeclared = findings.find(
      (f) =>
        f.code === 'target_line_not_declared' && f.message.includes('Active Change')
    );
    expect(undeclared).toBeDefined();
    expect(undeclared!.message).toContain('line-0.2');
  });

  it('reports no findings for an active Change with a consistent identity', async () => {
    const root = freshStore();
    setupStoreV2(root);
    writeTargetLineCatalog(root, 'line-0.1');

    writeActiveChange(root, 'api-server', 'add-thing', {
      version: 2,
      instanceSeed: 'seed-1',
      instanceId: 'cii-active-3',
      storeUid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectId: 'api-server',
      targetLineId: 'line-0.1',
    });

    const findings = await diagnoseConsistency({
      storeId: 'test-store',
      storeRoot: root,
    });

    expect(findings).toEqual([]);
  });
});
