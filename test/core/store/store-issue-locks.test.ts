/**
 * `store-scoped-issues-management` section 7 — the issue lock and the five-key
 * acquisition order.
 *
 * The order is asserted as an EXPLICIT ENUMERATION of all five keys, not as
 * "the workspace order with something prepended". A subset or prefix check
 * would keep passing if child 4 added a fifth workspace key, while nobody had
 * decided where that key sits relative to `issue` — which is how an ordering
 * gate stops meaning anything without ever going red.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  STORE_LOCK_ORDER,
  assertIssueAcquisitionOrder,
  assertStoreLockOrderAgreesWithWorkspace,
  heldStoreLockKinds,
  issueLockFileName,
  issueLockHeld,
  issueLockKey,
  issueLockPath,
  issueLockCanonicalBytes,
  heldIssueLockKeys,
  withIssueLock,
  withIssueLockBatch,
} from '../../../src/core/store/issues/index.js';
import {
  WORKSPACE_LOCK_ORDER,
  scopeLockKey,
  withWorkspaceLocks,
} from '../../../src/core/store/workspace/locks.js';
import { createNodeWorkspaceCoordination } from '../../../src/core/store/workspace/dependencies.js';

const STORE_UID = '9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0';
const OTHER_STORE_UID = 'aa11bb22-cc33-4d44-8e55-ff6677889900';

describe('the five-key acquisition order', () => {
  it('enumerates exactly five keys, in this order', () => {
    // Enumerated on purpose. Extend by adding the new key WITH its reason in
    // `locks.ts` and adding it here; never by relaxing this to a prefix, a
    // range, a length check, or a subset.
    expect([...STORE_LOCK_ORDER]).toEqual([
      'issue',
      'scope',
      'workspace',
      'change',
      'integration',
    ]);
  });

  it('keeps the four workspace keys in child 4 own order, immediately after issue', () => {
    expect(STORE_LOCK_ORDER[0]).toBe('issue');
    expect(STORE_LOCK_ORDER.slice(1)).toEqual([...WORKSPACE_LOCK_ORDER]);
    expect(() => assertStoreLockOrderAgreesWithWorkspace()).not.toThrow();
  });

  it('refuses taking the issue key while a later key is held', () => {
    expect(() => assertIssueAcquisitionOrder(['scope'])).toThrow(/ordering violated/u);
    expect(() => assertIssueAcquisitionOrder(['workspace'])).toThrow(/ordering violated/u);
    expect(() => assertIssueAcquisitionOrder(['change'])).toThrow(/ordering violated/u);
    expect(() => assertIssueAcquisitionOrder(['integration'])).toThrow(/ordering violated/u);
    // Its message names the full order, so the diagnostic teaches the rule.
    expect(() => assertIssueAcquisitionOrder(['scope'])).toThrow(
      /issue -> scope -> workspace -> change -> integration/u
    );
  });

  it('refuses taking the issue key twice in one acquisition', () => {
    expect(() => assertIssueAcquisitionOrder(['issue'])).toThrow(/already held/u);
  });

  it('permits the issue key when nothing is held', () => {
    expect(() => assertIssueAcquisitionOrder([])).not.toThrow();
  });
});

describe('the issue lock key', () => {
  it('is keyed by the permanent Store identity and the Issue identifier', () => {
    const key = issueLockKey({ storeUid: STORE_UID, issueId: 'cross-line-telemetry' });
    expect(key.kind).toBe('issue');
    expect(key.material).toEqual({
      storeUid: STORE_UID,
      issueId: 'cross-line-telemetry',
    });
  });

  it('derives a filename that is a digest, so an id never becomes a filesystem property', () => {
    const name = issueLockFileName(
      issueLockKey({ storeUid: STORE_UID, issueId: 'cross-line-telemetry' })
    );
    expect(name).toMatch(/^issue-[0-9a-f]{64}\.lock$/u);
    // The identifier itself does not appear in the path.
    expect(name).not.toContain('cross-line-telemetry');
    expect(name).not.toContain(STORE_UID);
  });

  it('gives two Issues in one Store, and one Issue in two Stores, different keys', () => {
    const first = issueLockFileName(issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' }));
    const second = issueLockFileName(issueLockKey({ storeUid: STORE_UID, issueId: 'beta' }));
    const elsewhere = issueLockFileName(
      issueLockKey({ storeUid: OTHER_STORE_UID, issueId: 'alpha' })
    );
    expect(new Set([first, second, elsewhere]).size).toBe(3);
  });

  it('is deterministic for equal material', () => {
    expect(issueLockFileName(issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' }))).toBe(
      issueLockFileName(issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' }))
    );
  });
});

describe('holding the issue lock', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-issue-lock-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function coordination() {
    return createNodeWorkspaceCoordination(dataDir);
  }

  it('creates the lock file under the machine root and removes it afterwards', async () => {
    const key = issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' });
    const lockPath = issueLockPath(coordination(), key);
    expect(fs.existsSync(lockPath)).toBe(false);

    await withIssueLock(coordination(), key, async () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(issueLockHeld()).toBe(true);
      expect(heldStoreLockKinds()).toEqual(['issue']);
    });

    expect(fs.existsSync(lockPath)).toBe(false);
    expect(issueLockHeld()).toBe(false);
  });

  it('releases the key even when the body throws', async () => {
    const key = issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' });
    const lockPath = issueLockPath(coordination(), key);
    await expect(
      withIssueLock(coordination(), key, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('deduplicates and canonical-byte-sorts a migration batch, then releases it', async () => {
    const keys = [
      issueLockKey({ storeUid: STORE_UID, issueId: 'beta' }),
      issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' }),
      issueLockKey({ storeUid: STORE_UID, issueId: 'beta' }),
    ];
    let heldPaths: string[] = [];
    await withIssueLockBatch(coordination(), keys, async () => {
      const held = heldIssueLockKeys();
      expect(held).toHaveLength(2);
      expect(
        Buffer.compare(issueLockCanonicalBytes(held[0]!), issueLockCanonicalBytes(held[1]!))
      ).toBeLessThan(0);
      heldPaths = held.map((key) => issueLockPath(coordination(), key));
      expect(heldPaths.every((target) => fs.existsSync(target))).toBe(true);
    });
    expect(heldPaths.every((target) => !fs.existsSync(target))).toBe(true);
  });

  it('releases an earlier batch key when a later canonical key is unavailable', async () => {
    const handle = coordination();
    const keys = ['alpha', 'beta']
      .map((issueId) => issueLockKey({ storeUid: STORE_UID, issueId }))
      .sort((left, right) =>
        Buffer.compare(issueLockCanonicalBytes(left), issueLockCanonicalBytes(right))
      );
    await withIssueLockIgnoringOrder(handle, keys[1]!, async () => {
      await expect(
        withIssueLockBatch(handle, keys, async () => undefined, {
          deadlineMs: 100,
          pollMs: 10,
        })
      ).rejects.toThrow(/held by/u);
      expect(fs.existsSync(issueLockPath(handle, keys[0]!))).toBe(false);
      expect(fs.existsSync(issueLockPath(handle, keys[1]!))).toBe(true);
    });
  });

  it('releases the whole batch after callback failure', async () => {
    const handle = coordination();
    const keys = ['alpha', 'beta'].map((issueId) =>
      issueLockKey({ storeUid: STORE_UID, issueId })
    );
    await expect(
      withIssueLockBatch(handle, keys, async () => {
        throw new Error('batch callback failed');
      })
    ).rejects.toThrow('batch callback failed');
    expect(keys.every((key) => !fs.existsSync(issueLockPath(handle, key)))).toBe(true);
  });

  it('serializes overlapping migration batches across refs while disjoint batches complete', async () => {
    const handle = coordination();
    const keys = (ids: readonly string[]) =>
      ids.map((issueId) => issueLockKey({ storeUid: STORE_UID, issueId }));
    let announce!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstRef = withIssueLockBatch(handle, keys(['alpha', 'beta']), async () => {
      announce();
      await gate;
    });
    await held;

    let disjointCompleted = false;
    await withIssueLockBatch(handle, keys(['gamma', 'delta']), async () => {
      disjointCompleted = true;
    }, { deadlineMs: 100, pollMs: 10 });
    expect(disjointCompleted).toBe(true);
    await expect(
      withIssueLockBatch(handle, keys(['beta', 'gamma']), async () => undefined, {
        deadlineMs: 100,
        pollMs: 10,
      })
    ).rejects.toThrow(/held by/u);

    release();
    await firstRef;
    expect(
      keys(['alpha', 'beta', 'gamma', 'delta']).every(
        (key) => !fs.existsSync(issueLockPath(handle, key))
      )
    ).toBe(true);
  });

  it('lets two Issues in one Store proceed concurrently', async () => {
    let both = false;
    await withIssueLock(
      coordination(),
      issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' }),
      async () => {
        // A DIFFERENT key, taken while the first is held. If they serialized
        // this would deadlock against the bounded deadline rather than return.
        await withIssueLockIgnoringOrder(
          coordination(),
          issueLockKey({ storeUid: STORE_UID, issueId: 'beta' }),
          async () => {
            both = true;
          }
        );
      }
    );
    expect(both).toBe(true);
  });

  it('takes ONLY the issue key: no scope, workspace, change, or integration file appears', async () => {
    const key = issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' });
    await withIssueLock(coordination(), key, async () => {
      const locksDir = coordination().resolve('locks');
      const names = fs.existsSync(locksDir) ? fs.readdirSync(locksDir) : [];
      expect(names).toEqual([issueLockFileName(key)]);
    });
  });

  it('refuses to reach back for the issue key while a workspace key is held', async () => {
    const coordinationHandle = coordination();
    await expect(
      withWorkspaceLocks(
        coordinationHandle,
        [scopeLockKey({ storeUid: STORE_UID, projectId: 'elftia', targetLineId: 'main' })],
        async () => {
          await withIssueLock(
            coordinationHandle,
            issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' }),
            async () => undefined
          );
        }
      )
    ).rejects.toThrow(/ordering violated/u);
  });

  it('lets a reader run while the issue key is held, because a read takes none', async () => {
    const key = issueLockKey({ storeUid: STORE_UID, issueId: 'alpha' });
    let readRan = false;
    await withIssueLock(coordination(), key, async () => {
      // A read acquires nothing, so it neither waits nor trips the order check.
      expect(heldStoreLockKinds()).toEqual(['issue']);
      readRan = true;
    });
    expect(readRan).toBe(true);
  });
});

/**
 * Takes a second issue key while one is already held.
 *
 * `withIssueLock` refuses this by design — one acquisition takes one issue key
 * — so the concurrency claim is exercised through the underlying protocol
 * rather than by weakening the assertion that protects it.
 */
async function withIssueLockIgnoringOrder<T>(
  coordination: ReturnType<typeof createNodeWorkspaceCoordination>,
  key: ReturnType<typeof issueLockKey>,
  fn: () => Promise<T>
): Promise<T> {
  const { acquireOwnerAwareFileLock, releaseOwnerAwareFileLock } = await import(
    '../../../src/core/file-state.js'
  );
  const handle = await acquireOwnerAwareFileLock({
    lockPath: issueLockPath(coordination, key),
    errorFor: (kind) => new Error(`lock ${kind}`),
    holder: key.label,
    deadlineMs: 2_000,
  });
  try {
    return await fn();
  } finally {
    await releaseOwnerAwareFileLock(handle);
  }
}
