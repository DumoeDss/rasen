/**
 * `store-planning-worktree-bindings` task 5.8 — the semantic lock protocol.
 *
 * The locks are keyed by SEMANTIC scope and instance, never by Change alias, so
 * renaming a branch or a Change directory cannot move one. Two properties
 * matter operationally and are what this suite pins:
 *
 *   - two DIFFERENT scopes never serialize against each other, which is the
 *     concurrency the two-line acceptance case measures;
 *   - a live holder is waited for and then reported, and a provably dead one is
 *     recovered — a lock is never stolen on ambiguity.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalBytes } from '../../../src/core/canonical-json.js';
import { StoreError } from '../../../src/core/store/errors.js';
import {
  createNodeWorkspaceCoordination,
  type WorkspaceCoordination,
} from '../../../src/core/store/workspace/dependencies.js';
import {
  WORKSPACE_LOCK_ORDER,
  assertAcquisitionOrder,
  changeLockKey,
  heldLockKinds,
  integrationLockKey,
  lockIsHeld,
  scopeLockKey,
  withWorkspaceLocks,
  workspaceLockFileName,
  workspaceLockKey,
  workspaceLockPath,
} from '../../../src/core/store/workspace/locks.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const STORE_UID = '11111111-2222-4333-8444-555555555555';
const OTHER_STORE_UID = '99999999-2222-4333-8444-555555555555';

function digestFor(kind: string, material: Record<string, string>): string {
  return createHash('sha256')
    .update(canonicalBytes({ domain: 'workspace-lock/v1', kind, material }))
    .digest('hex');
}

describe('workspace lock protocol', () => {
  let dataDir: string;
  let coordination: WorkspaceCoordination;

  beforeEach(() => {
    dataDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wslocks-')));
    coordination = createNodeWorkspaceCoordination(dataDir);
  });

  afterEach(() => {
    cleanupTempPath(dataDir);
  });

  // ---- key derivation ----------------------------------------------------

  it('derives each key from its stated material, and only its material', () => {
    const scope = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    expect(scope.kind).toBe('scope');
    expect(scope.material).toEqual({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    // The filename is a digest, so an identifier's length, case, or separator
    // characters never become filesystem properties.
    expect(workspaceLockFileName(scope)).toBe(
      `scope-${digestFor('scope', scope.material as Record<string, string>)}.lock`
    );
    expect(workspaceLockFileName(scope)).toMatch(/^scope-[0-9a-f]{64}\.lock$/u);
    expect(workspaceLockPath(coordination, scope)).toBe(
      path.join(dataDir, 'planning-workspaces', 'locks', workspaceLockFileName(scope))
    );
  });

  it('pins the scope lock filename to a fixed digest, not merely to its own formula', () => {
    // `digestFor` above reimplements the SAME formula `workspaceLockFileName`
    // uses, inline. That protects the two from diverging from each other, but
    // a coordinated change to both (e.g. a new field in the hashed envelope,
    // a different serializer) would carry this test along with it silently.
    // This anchor breaks that: the expected string is a literal computed
    // OFFLINE, once, and hardcoded — it cannot follow a change to the
    // production formula, so it is the only assertion in this file that
    // would actually catch one.
    const scope = scopeLockKey({
      storeUid: 'store-uid-1',
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    expect(workspaceLockFileName(scope)).toBe(
      'scope-4599385fa78720a133b3360ce056fd0133386c805b571e92c8749ad0db84c40a.lock'
    );

    // Mutation proof: changing one field of the material changes the digest,
    // to a second independently pinned literal — this is not a tautology
    // that would pass on ANY output, it is pinned on both sides.
    const mutated = scopeLockKey({
      storeUid: 'store-uid-1',
      projectId: 'app-a',
      targetLineId: 'line-0.3',
    });
    expect(workspaceLockFileName(mutated)).toBe(
      'scope-cf5d557e53764e7ce69486ebed7b38172c08ce6274c1cbbca139eae93db52fb4.lock'
    );

    // A bound workspace key on fixed material gets its own pinned digest, in
    // the same anchor so the `workspace` kind prefix is covered too.
    const bound = workspaceLockKey({ workspacePairId: 'pair-1' });
    expect(workspaceLockFileName(bound)).toBe(
      'workspace-f58bcd82b787d6cdb4f62cc1450c8f587521807713d4d924c64218576743400f.lock'
    );
  });

  it('gives different scopes, projects, and lines different lock files', () => {
    const base = { storeUid: STORE_UID, projectId: 'app-a', targetLineId: 'line-0.2' };
    const names = [
      base,
      { ...base, projectId: 'app-b' },
      { ...base, targetLineId: 'line-0.3' },
      { ...base, storeUid: OTHER_STORE_UID },
    ].map((material) => workspaceLockFileName(scopeLockKey(material)));
    expect(new Set(names).size).toBe(4);
  });

  it('keeps a prepared workspace and a bound one on distinct lock files', () => {
    const provisional = workspaceLockKey({
      planningScopeId: 'ps_abc',
      changeId: 'redesign-routing',
    });
    const bound = workspaceLockKey({ workspacePairId: 'wp_abc' });
    expect(provisional.kind).toBe('workspace');
    expect(bound.kind).toBe('workspace');
    expect(provisional.material).toEqual({
      provisionalPlanningScopeId: 'ps_abc',
      provisionalChangeId: 'redesign-routing',
    });
    expect(workspaceLockFileName(provisional)).not.toBe(workspaceLockFileName(bound));
  });

  it('publishes the change and integration keys without this change taking them', async () => {
    const change = changeLockKey({ changeInstanceId: 'ci_abc' });
    const integration = integrationLockKey({ storeUid: STORE_UID, targetLineId: 'line-0.2' });
    expect(change.kind).toBe('change');
    expect(integration.kind).toBe('integration');
    // Nothing in this change takes them, so neither file exists after a full
    // prepare/cleanup cycle. The journey covers the cycle; here the claim is
    // that merely deriving a key creates nothing.
    expect(await lockIsHeld(coordination, change)).toBe(false);
    expect(await lockIsHeld(coordination, integration)).toBe(false);
  });

  // ---- ordering ----------------------------------------------------------

  it('fixes the acquisition order and refuses to reach back for an earlier lock', () => {
    expect(WORKSPACE_LOCK_ORDER).toEqual(['scope', 'workspace', 'change', 'integration']);
    expect(() => assertAcquisitionOrder(['scope', 'workspace'], [])).not.toThrow();
    expect(() => assertAcquisitionOrder(['change', 'integration'], ['scope'])).not.toThrow();
    // Reaching back while holding a later lock is the deadlock the fixed order
    // exists to prevent.
    expect(() => assertAcquisitionOrder(['scope'], ['workspace'])).toThrow(
      /lock ordering violated/u
    );
    expect(() => assertAcquisitionOrder(['workspace', 'scope'], [])).toThrow(
      /lock ordering violated/u
    );
    // The same lock twice is also a reach-back.
    expect(() => assertAcquisitionOrder(['scope'], ['scope'])).toThrow(/lock ordering violated/u);
  });

  it('acquires out-of-order keys in the fixed order and reports what is held', async () => {
    const scope = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    const workspace = workspaceLockKey({ workspacePairId: 'wp_abc' });

    let observed: readonly string[] = [];
    // Supplied workspace-first; the helper sorts before acquiring.
    await withWorkspaceLocks(coordination, [workspace, scope], async () => {
      observed = heldLockKinds();
      expect(await lockIsHeld(coordination, scope)).toBe(true);
      expect(await lockIsHeld(coordination, workspace)).toBe(true);
    });
    expect(observed).toEqual(['scope', 'workspace']);
    // Both are released, including in reverse order, when the body returns.
    expect(await lockIsHeld(coordination, scope)).toBe(false);
    expect(await lockIsHeld(coordination, workspace)).toBe(false);
  });

  it('releases every lock when the body throws', async () => {
    const scope = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    await expect(
      withWorkspaceLocks(coordination, [scope], async () => {
        throw new Error('body failed');
      })
    ).rejects.toThrow('body failed');
    expect(await lockIsHeld(coordination, scope)).toBe(false);
  });

  // ---- contention and concurrency ----------------------------------------

  it('lets two different scopes proceed in parallel without serializing', async () => {
    const first = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    const second = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.3',
    });

    let bothInside = false;
    let firstInside = false;
    let secondInside = false;
    const release = { first: () => {}, second: () => {} };
    const firstGate = new Promise<void>((resolve) => {
      release.first = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      release.second = resolve;
    });

    const runFirst = withWorkspaceLocks(coordination, [first], async () => {
      firstInside = true;
      if (secondInside) bothInside = true;
      release.second();
      await firstGate;
    });
    const runSecond = withWorkspaceLocks(coordination, [second], async () => {
      secondInside = true;
      if (firstInside) bothInside = true;
      release.first();
      await secondGate;
    });

    await Promise.all([runFirst, runSecond]);
    // Both bodies were inside their locks at the same instant. If different
    // lines shared a lock, one of the two gates would never open and this would
    // deadlock rather than fail.
    expect(bothInside).toBe(true);
  });

  it('reports a live holder by name after the bounded deadline, and steals nothing', async () => {
    const scope = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    const lockPath = workspaceLockPath(coordination, scope);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    // A live holder: this very process, which is provably alive.
    const held = `holder: another rasen command\npid: ${process.pid}\n`;
    fs.writeFileSync(lockPath, held, 'utf8');

    const started = Date.now();
    let raised: unknown;
    try {
      await withWorkspaceLocks(coordination, [scope], async () => undefined, {
        deadlineMs: 150,
        pollMs: 25,
      });
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeInstanceOf(StoreError);
    expect((raised as StoreError).diagnostic.code).toBe('workspace_lock_unavailable');
    expect((raised as StoreError).diagnostic.message).toContain('another rasen command');
    expect((raised as StoreError).diagnostic.message).toContain(`pid ${process.pid}`);
    expect((raised as StoreError).diagnostic.fix).toContain('never steals a lock held by a live');
    // It waited rather than failing instantly, and the holder's file is intact.
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(held);
  });

  it('recovers a lock whose owner is provably dead', async () => {
    const scope = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    const lockPath = workspaceLockPath(coordination, scope);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    // PID 1 exists everywhere; a very high PID in a fresh temp dir does not.
    // `pidIsAlive` only reports death on an affirmative ESRCH.
    fs.writeFileSync(lockPath, 'holder: a crashed run\npid: 2147483646\n', 'utf8');

    let entered = false;
    await withWorkspaceLocks(
      coordination,
      [scope],
      async () => {
        entered = true;
      },
      { deadlineMs: 2000, pollMs: 25 }
    );
    expect(entered).toBe(true);
    expect(await lockIsHeld(coordination, scope)).toBe(false);
  });

  it('does not retry a semantic conflict raised inside the locked body', async () => {
    // Contention retries; a semantic conflict is answered once. The body is the
    // only place a semantic conflict can be raised, and it runs exactly once.
    const scope = scopeLockKey({
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: 'line-0.2',
    });
    let attempts = 0;
    await expect(
      withWorkspaceLocks(
        coordination,
        [scope],
        async () => {
          attempts += 1;
          throw new StoreError('the recorded ref moved', 'workspace_plan_stale', {});
        },
        { deadlineMs: 2000, pollMs: 10 }
      )
    ).rejects.toThrow('the recorded ref moved');
    expect(attempts).toBe(1);
  });
});
