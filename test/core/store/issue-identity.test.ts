import { describe, expect, it } from 'vitest';

import {
  allocateIssueIdentity,
  deriveIssueKey,
  deriveIssueSlug,
  deriveLegacyIssueUid,
  projectLegacyIssueIdentity,
  projectStoredIssueIdentity,
  resolveIssueSelector,
  type IssueIdentityCandidate,
} from '../../../src/core/store/issues/identity.js';
import { parseIssueStorageKey } from '../../../src/core/store/planning-validation.js';
import {
  parseStoredIssueRecord,
  serializeIssueRecordV2,
} from '../../../src/core/store/issues/records.js';
import { StoreIssueError } from '../../../src/core/store/issues/diagnostics.js';

const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';
const UID = '75f3d57b-57e4-46ab-88e4-cbfec96bd257';

describe('Issue identity protocol', () => {
  it('pins the human-key algorithm with a fixed vector', () => {
    expect(deriveIssueKey(UID)).toBe('ISS-JMCJHQ6S28BZ0P8K');
  });

  it('projects legacy identity stably within a Store and differently across Stores', () => {
    const first = deriveLegacyIssueUid(STORE_A, 'terminal-ledger');
    expect(deriveLegacyIssueUid(STORE_A, 'terminal-ledger')).toBe(first);
    expect(deriveLegacyIssueUid(STORE_B, 'terminal-ledger')).not.toBe(first);
    expect(projectLegacyIssueIdentity({ storeUid: STORE_A, legacyIssueId: 'terminal-ledger' }))
      .toMatchObject({
        sourceVersion: 1,
        storageKey: 'terminal-ledger',
        identity: { uid: first, slug: 'terminal-ledger' },
      });
  });

  it('projects both stored record versions through one identity seam', () => {
    const legacy = projectStoredIssueIdentity({
      storeUid: STORE_A,
      storageKey: 'terminal-ledger',
      record: {
        version: 1,
        id: 'terminal-ledger' as never,
        title: 'Terminal ledger',
        state: 'open',
        reason: null,
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    });
    expect(legacy).toMatchObject({ sourceVersion: 1, storageKey: 'terminal-ledger' });

    const v2Identity = {
      uid: UID as never,
      key: deriveIssueKey(UID),
      slug: null,
      aliases: [] as const,
    };
    const current = projectStoredIssueIdentity({
      storeUid: STORE_A,
      storageKey: UID,
      record: {
        version: 2,
        identity: v2Identity,
        title: 'Terminal ledger',
        state: 'open',
        reason: null,
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    });
    expect(current).toMatchObject({ sourceVersion: 2, identity: v2Identity, storageKey: UID });
  });

  it('derives only a best-effort ASCII slug', () => {
    expect(deriveIssueSlug('Fix login timeout')).toBe('fix-login-timeout');
    expect(deriveIssueSlug('终端账本')).toBeNull();
  });

  it('strictly round-trips a V2 record at its UID storage location', () => {
    const identity = {
      uid: UID as never,
      key: deriveIssueKey(UID),
      slug: 'terminal-ledger',
      aliases: [] as const,
    };
    const serialized = serializeIssueRecordV2({
      version: 2,
      identity,
      title: 'Terminal ledger',
      state: 'open',
      reason: null,
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    expect(parseStoredIssueRecord(serialized, `/store/rasen/issues/${UID}/issue.yaml`))
      .toEqual({
        version: 2,
        identity,
        title: 'Terminal ledger',
        state: 'open',
        reason: null,
        createdAt: '2026-08-31T00:00:00.000Z',
      });
    expect(() => parseStoredIssueRecord(serialized, '/store/rasen/issues/not-the-uid/issue.yaml'))
      .toThrow(/stored below/u);
  });

  it('allocates from system entropy and retries a UID collision', () => {
    const minted = [UID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
    const existing: IssueIdentityCandidate[] = [{
      identity: { uid: UID as never, key: deriveIssueKey(UID), slug: null, aliases: [] },
      storageKey: parseIssueStorageKey(UID),
      sourceVersion: 2,
      title: 'Existing',
    }];
    const allocated = allocateIssueIdentity({
      title: '终端账本',
      existing,
      mintIssueUid: () => minted.shift() as string,
    });
    expect(allocated.uid).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(allocated.slug).toBeNull();
  });

  it('resolves UID, key, slug, and legacy aliases and refuses ambiguity', () => {
    const projected = projectLegacyIssueIdentity({ storeUid: STORE_A, legacyIssueId: 'terminal-ledger' });
    const candidate: IssueIdentityCandidate = { ...projected, title: 'Terminal ledger' };
    for (const selector of [
      projected.identity.uid,
      `uid:${projected.identity.uid}`,
      projected.identity.key,
      `key:${projected.identity.key.toLowerCase()}`,
      'terminal-ledger',
      `legacy:terminal-ledger`,
    ]) {
      expect(resolveIssueSelector({ selector, candidates: [candidate] }).identity.uid)
        .toBe(projected.identity.uid);
    }

    const another: IssueIdentityCandidate = {
      identity: {
        uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as never,
        key: deriveIssueKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        slug: 'terminal-ledger',
        aliases: [],
      },
      storageKey: parseIssueStorageKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      sourceVersion: 2,
      title: 'Another',
    };
    let ambiguous: unknown;
    try {
      resolveIssueSelector({ selector: 'terminal-ledger', candidates: [candidate, another] });
    } catch (error) {
      ambiguous = error;
    }
    expect(ambiguous).toBeInstanceOf(StoreIssueError);
    expect((ambiguous as StoreIssueError).issueCode).toBe('issue_selector_ambiguous');
    expect((ambiguous as Error).message).toContain('Terminal ledger');
    expect((ambiguous as Error).message).toContain('Another');
  });

  it('refuses one UID claimed by different physical storage locations', () => {
    const identity = {
      uid: UID as never,
      key: deriveIssueKey(UID),
      slug: 'terminal-ledger',
      aliases: [] as const,
    };
    const candidates: IssueIdentityCandidate[] = [
      {
        identity,
        storageKey: parseIssueStorageKey(UID),
        sourceVersion: 2,
        title: 'UID storage',
      },
      {
        identity,
        storageKey: parseIssueStorageKey('legacy-storage'),
        sourceVersion: 1,
        title: 'Legacy storage',
      },
    ];

    expect(() => resolveIssueSelector({ selector: UID, candidates })).toThrowError(
      expect.objectContaining({ issueCode: 'issue_identity_conflict' })
    );
  });

  it('fails closed for invalid explicit selectors and an incomplete catalog', () => {
    for (const selector of ['uid:not-a-uuid', 'key:ISS-NOT-A-KEY', 'legacy:']) {
      try {
        resolveIssueSelector({ selector, candidates: [] });
        throw new Error('expected invalid selector refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(StoreIssueError);
        expect((error as StoreIssueError).issueCode).toBe('issue_selector_invalid');
      }
    }

    const projected = projectLegacyIssueIdentity({
      storeUid: STORE_A,
      legacyIssueId: 'terminal-ledger',
    });
    try {
      resolveIssueSelector({
        selector: projected.identity.uid,
        candidates: [{ ...projected, title: 'Terminal ledger' }],
        complete: false,
      });
      throw new Error('expected incomplete catalog refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreIssueError);
      expect((error as StoreIssueError).issueCode).toBe('store_query_ref_unreadable');
    }
  });
});
