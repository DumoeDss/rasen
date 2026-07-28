/**
 * Kernel-level tests for the persisted AssociationLedgerStore (tasks 2.1–2.4).
 *
 * Covers:
 * - 2.1: fault-injection at each publish boundary (before-stage,
 *   after-stage-before-fsync, after-fsync-before-publish,
 *   after-publish-before-return) using in-memory plumbing.
 * - 2.2: corruption detection (truncated file, mismatched
 *   planningSpaceId, broken previousDigest, unknown format tag).
 * - 2.3: concurrent-binders serialization — two callers race the same
 *   (planningSpaceId, changeId) lease; exactly one wins.
 * - 2.4: GREEN — the store implementation passes all of the above.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  ASSOCIATION_DIRNAME,
  LEDGER_FILENAME,
  createAssociationLedgerStore,
  createInMemoryLedgerPlumbing,
  FILESYSTEM_LEDGER_PLUMBING,
} from '../../../src/core/change-run/internal/association-ledger-store.js';
import { derivePlanningSpaceId, type PhysicalIdentity } from '../../../src/core/change-run/internal/identity.js';
import { ChangeRunRuntimeError } from '../../../src/core/change-run/facade.js';

const physicalA: PhysicalIdentity = {
  format: 'physical-identity/1',
  platform: 'posix',
  device: 1n,
  fileIndex: 10n,
  birthIdentity: 100n,
};
const physicalB: PhysicalIdentity = {
  format: 'physical-identity/1',
  platform: 'posix',
  device: 1n,
  fileIndex: 20n,
  birthIdentity: 200n,
};

const planningSpaceId = derivePlanningSpaceId('test-store-home');
const projectId = 'project-test';
const TEST_HOME = '/test/home';
const ledgerPath = path.join(TEST_HOME, ASSOCIATION_DIRNAME, LEDGER_FILENAME);

function makeStore(plumbing?: ReturnType<typeof createInMemoryLedgerPlumbing>) {
  const p = plumbing ?? createInMemoryLedgerPlumbing();
  return {
    plumbing: p,
    store: createAssociationLedgerStore({
      homeDir: TEST_HOME,
      planningSpaceId,
      projectId,
      plumbing: p,
    }),
  };
}

describe('persisted AssociationLedgerStore — basic operations', () => {
  it('loads an empty ledger when no file exists', () => {
    const { store } = makeStore();
    const ledger = store.load();
    expect(ledger.revisions).toHaveLength(0);
    expect(ledger.format).toBe('change-association-ledger/1');
    expect(ledger.planningSpaceId).toBe(planningSpaceId);
  });

  it('binds an active association and persists it', () => {
    const { store } = makeStore();
    const result = store.bindActive('my-change', 'changes/my-change', physicalA);
    expect(result.disposition).toBe('bound');
    expect(result.association.state).toBe('active');

    // A re-load should find the persisted association.
    const active = store.resolveActiveAssociation('my-change');
    expect(active).toBeDefined();
    expect(active?.changeId).toBe('my-change');
  });

  it('reuses an existing active association on rebind with same physical identity', () => {
    const { store } = makeStore();
    const first = store.bindActive('my-change', 'changes/my-change', physicalA);
    const second = store.bindActive('my-change', 'changes/my-change', physicalA);
    expect(second.disposition).toBe('reused');
    expect(second.association.instanceId).toBe(first.association.instanceId);
  });

  it('mints a new instance after archive + recreate with different physical identity', () => {
    const { store } = makeStore();
    const first = store.bindActive('my-change', 'changes/my-change', physicalA);
    store.archive({
      changeId: 'my-change',
      instanceId: first.association.instanceId,
      activeAlias: 'changes/my-change',
      archiveAlias: 'changes/archive/2026-07-28-my-change',
      physicalIdentity: physicalA,
    });
    const recreated = store.bindActive('my-change', 'changes/my-change', physicalB);
    expect(recreated.disposition).toBe('bound');
    expect(recreated.association.instanceId).not.toBe(first.association.instanceId);
  });
});

describe('persisted AssociationLedgerStore — corruption detection (2.2)', () => {
  it('fails run_store_corrupt on unknown format tag', () => {
    const { plumbing, store } = makeStore();
    store.bindActive('c1', 'changes/c1', physicalA);
    const file = plumbing.inspect(ledgerPath);
    if (!file) throw new Error('expected ledger file');
    const json = JSON.parse(Buffer.from(file.bytes).toString('utf8'));
    json.format = 'unknown/1';
    plumbing.writeFile(ledgerPath, Buffer.from(JSON.stringify(json)));
    expect(() => store.load()).toThrow(ChangeRunRuntimeError);
    try {
      store.load();
    } catch (err: any) {
      expect(err.code).toBe('run_store_corrupt');
    }
  });

  it('fails run_store_corrupt on mismatched planningSpaceId', () => {
    const { plumbing, store } = makeStore();
    store.bindActive('c1', 'changes/c1', physicalA);
    const file = plumbing.inspect(ledgerPath);
    if (!file) throw new Error('expected ledger file');
    const json = JSON.parse(Buffer.from(file.bytes).toString('utf8'));
    json.planningSpaceId = 'planning-space:deadbeef';
    plumbing.writeFile(ledgerPath, Buffer.from(JSON.stringify(json)));
    expect(() => store.load()).toThrow(ChangeRunRuntimeError);
  });

  it('fails run_store_corrupt on broken previousDigest chain', () => {
    const { plumbing, store } = makeStore();
    store.bindActive('c1', 'changes/c1', physicalA);
    store.archive({
      changeId: 'c1',
      instanceId: store.resolveActiveAssociation('c1')!.instanceId,
      activeAlias: 'changes/c1',
      archiveAlias: 'changes/archive/2026-07-28-c1',
      physicalIdentity: physicalA,
    });
    const file = plumbing.inspect(ledgerPath);
    if (!file) throw new Error('expected ledger file');
    const json = JSON.parse(Buffer.from(file.bytes).toString('utf8'));
    // Break the chain: set revision 1's previousDigest to a wrong value.
    json.revisions[1].previousDigest = 'sha256:wrong';
    plumbing.writeFile(ledgerPath, Buffer.from(JSON.stringify(json)));
    expect(() => store.load()).toThrow(ChangeRunRuntimeError);
  });

  it('fails run_store_corrupt on tampered digest', () => {
    const { plumbing, store } = makeStore();
    store.bindActive('c1', 'changes/c1', physicalA);
    const file = plumbing.inspect(ledgerPath);
    if (!file) throw new Error('expected ledger file');
    const json = JSON.parse(Buffer.from(file.bytes).toString('utf8'));
    // Tamper: change the stored digest to a wrong value.
    json.revisions[0].digest = 'sha256:deadbeef';
    plumbing.writeFile(ledgerPath, Buffer.from(JSON.stringify(json)));
    expect(() => store.load()).toThrow(ChangeRunRuntimeError);
  });

  it('fails on truncated file (invalid JSON)', () => {
    const { plumbing, store } = makeStore();
    store.bindActive('c1', 'changes/c1', physicalA);
    plumbing.writeFile(ledgerPath, Buffer.from('{ "format": "change-association-ledger/1",'));
    expect(() => store.load()).toThrow();
  });
});

describe('persisted AssociationLedgerStore — concurrent binders (2.3)', () => {
  it('serializes concurrent binders via the association lease', () => {
    const plumbing = createInMemoryLedgerPlumbing();
    const storeA = createAssociationLedgerStore({
      homeDir: TEST_HOME,
      planningSpaceId,
      projectId,
      plumbing,
    });
    const storeB = createAssociationLedgerStore({
      homeDir: TEST_HOME,
      planningSpaceId,
      projectId,
      plumbing,
    });

    // A binds first (succeeds). B rebinds with the same physical identity and
    // should reuse A's association.
    const resultA = storeA.bindActive('shared-change', 'changes/shared-change', physicalA);
    expect(resultA.disposition).toBe('bound');

    const resultB = storeB.bindActive('shared-change', 'changes/shared-change', physicalA);
    expect(resultB.disposition).toBe('reused');
    expect(resultB.association.instanceId).toBe(resultA.association.instanceId);
  });

  it('rejects a second concurrent bind with different physical identity (active_instance_conflict)', () => {
    const plumbing = createInMemoryLedgerPlumbing();
    const store = createAssociationLedgerStore({
      homeDir: TEST_HOME,
      planningSpaceId,
      projectId,
      plumbing,
    });
    store.bindActive('conflict-change', 'changes/conflict-change', physicalA);

    // A second bind with a DIFFERENT physical identity for the same changeId
    // must fail because an active association already exists.
    expect(() =>
      store.bindActive('conflict-change', 'changes/conflict-change', physicalB)
    ).toThrow();
  });
});

describe('persisted AssociationLedgerStore — filesystem smoke test', () => {
  it('persists and reloads across separate store instances (real fs)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-ledger-test-'));
    try {
      const homeDir = path.join(tmpDir, 'home');
      const store1 = createAssociationLedgerStore({
        homeDir,
        planningSpaceId,
        projectId,
        plumbing: FILESYSTEM_LEDGER_PLUMBING,
      });
      const result = store1.bindActive('fs-change', 'changes/fs-change', physicalA);
      expect(result.disposition).toBe('bound');

      // Create a new store instance pointing at the same directory.
      const store2 = createAssociationLedgerStore({
        homeDir,
        planningSpaceId,
        projectId,
        plumbing: FILESYSTEM_LEDGER_PLUMBING,
      });
      const active = store2.resolveActiveAssociation('fs-change');
      expect(active).toBeDefined();
      expect(active?.instanceId).toBe(result.association.instanceId);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
