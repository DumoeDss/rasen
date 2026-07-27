import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import { RunStoreError } from '../../../src/core/change-run/internal/run-store.js';
import { digestCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { agentAction, bugFixPlan, startRecord } from './reconciler-fixture.js';

describe('filesystem RunStore (9.2 fs adapter)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rasen-runstore-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('persists create/load across a fresh store instance (durability)', () => {
    const plan = bugFixPlan();
    const storeA = createFilesystemRunStore(root);
    storeA.create(plan.runId, startRecord(plan));
    // A new store instance over the same dir reads the same head.
    const storeB = createFilesystemRunStore(root);
    expect(storeB.has(plan.runId)).toBe(true);
    expect(storeB.load(plan.runId).recordVersion).toBe(0);
  });

  it('appends immutable revisions and rejects predecessor mismatch', () => {
    const plan = bugFixPlan();
    const store = createFilesystemRunStore(root);
    const base = startRecord(plan);
    store.create(plan.runId, base);
    const action = agentAction(plan, 'root/propose');
    const granted = reduceCanonicalRunRecord(base, {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    if (!granted.ok) throw new Error(granted.failure.message);
    store.commit(plan.runId, granted.record);
    expect(store.load(plan.runId).recordVersion).toBe(1);
    expect(store.load(plan.runId).previousRecordDigest).toBe(
      digestCanonicalRunRecord(base)
    );
    // Re-committing the same version is rejected (immutable publication).
    expect(() => store.commit(plan.runId, granted.record)).toThrowError(RunStoreError);
  });

  it('lists run summaries', () => {
    const plan = bugFixPlan();
    const store = createFilesystemRunStore(root);
    store.create(plan.runId, startRecord(plan));
    const listed = createFilesystemRunStore(root).list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.runId).toBe(plan.runId);
  });
});
