import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  EvidenceError,
  buildEvidenceRef,
  createBoundedEvidenceStore,
  createInMemoryEvidenceStore,
  createRetentionLedger,
  verifyEvidenceBinding,
  verifyEvidenceContent,
  verifyEvidenceRefIdentity,
} from '../../../src/core/change-run/internal/evidence.js';
import type { Digest } from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const digest = (c: string) => branded<Digest>(`sha256:${c.repeat(64)}`);

const encoder = new TextEncoder();
const content = encoder.encode('{"ok":true}');
const producer = { id: 'adapter:apply', version: '1', identityDigest: digest('a') };
const binding = {
  planningSpaceId: branded('planning-space:' + '1'.repeat(64)),
  changeInstanceId: branded('change-instance:' + '2'.repeat(64)),
  projectId: 'project-fixture',
  changeId: 'fixture-change',
  runId: branded(`run:${'a'.repeat(64)}`),
  actionId: branded(`action:${'a'.repeat(58)}aa`),
  schema: 'apply-change-result/1',
};

function ref() {
  return buildEvidenceRef({
    content,
    mediaType: 'application/json',
    observationKind: 'domain-result',
    producer,
    binding,
  });
}

describe('EvidenceRef envelope + verification (7.1-7.3)', () => {
  it('builds a path-free content-addressed ref with canonical identity digests', () => {
    const r = ref();
    expect(r.format).toBe('change-run-evidence-ref/1');
    expect(r.store).toBe('change-run');
    expect(r.contentDigest).toBe(
      `sha256:${createHash('sha256').update(content).digest('hex')}`
    );
    expect(r.size).toBe(content.byteLength);
    // Path-free: the ref carries digests only, never a filesystem path.
    expect('path' in r).toBe(false);
    expect('path' in r.binding).toBe(false);
  });

  it('binds the full golden identity set', () => {
    const b = ref().binding;
    expect(b.planningSpaceId).toBe(binding.planningSpaceId);
    expect(b.changeInstanceId).toBe(binding.changeInstanceId);
    expect(b.projectId).toBe('project-fixture');
    expect(b.changeId).toBe('fixture-change');
    expect(b.runId).toBe(binding.runId);
    expect(b.actionId).toBe(binding.actionId);
    expect(b.schema).toBe('apply-change-result/1');
  });

  it('verifies matching content and rejects tampered or relabelled bytes', () => {
    const r = ref();
    expect(() => verifyEvidenceContent(r, content)).not.toThrow();
    expect(() => verifyEvidenceContent(r, encoder.encode('{"ok":false}'))).toThrowError(
      EvidenceError
    );
    // A truncated buffer of the right prefix still fails the size + digest check.
    expect(() => verifyEvidenceContent(r, content.slice(0, 3))).toThrowError(
      EvidenceError
    );
  });

  it('rejects a tampered identity digest (anti-tamper)', () => {
    const r = ref();
    expect(() => verifyEvidenceRefIdentity(r)).not.toThrow();
    const tampered = { ...r, evidenceDigest: digest('z') };
    expect(() => verifyEvidenceRefIdentity(tampered)).toThrowError(EvidenceError);
  });

  it('rejects a cross-binding ref (wrong Run/Action)', () => {
    const r = ref();
    expect(() => verifyEvidenceBinding(r, binding)).not.toThrow();
    const wrongRun = { ...binding, runId: branded(`run:${'b'.repeat(64)}`) };
    expect(() => verifyEvidenceBinding(r, wrongRun)).toThrowError(EvidenceError);
    const wrongAction = { ...binding, actionId: branded(`action:${'b'.repeat(58)}bb`) };
    expect(() => verifyEvidenceBinding(r, wrongAction)).toThrowError(EvidenceError);
  });

  it('computes a deterministic identity digest for identical refs', () => {
    expect(ref().evidenceDigest).toBe(ref().evidenceDigest);
  });

  it('stages and reads back exact bytes through the content-addressed store', () => {
    const store = createInMemoryEvidenceStore();
    const stagedDigest = store.stage(content);
    const r = buildEvidenceRef({
      content,
      mediaType: 'application/json',
      observationKind: 'domain-result',
      producer,
      binding,
    });
    expect(stagedDigest).toBe(r.contentDigest);
    expect(store.has(r)).toBe(true);
    expect(() => verifyEvidenceContent(r, store.read(r))).not.toThrow();
    // A ref whose content was never staged is absent and fails to read.
    const absent = { ...r, contentDigest: digest('9') };
    expect(store.has(absent)).toBe(false);
    expect(() => store.read(absent)).toThrowError(EvidenceError);
  });
});

describe('HostEvidenceWriter staging budgets + claim conflict (7.5/7.6)', () => {
  it('rejects content that does not match the claimed contentDigest', () => {
    const store = createBoundedEvidenceStore({ maxRunBytes: 1024, maxEntries: 8 });
    const r = ref();
    const wrongBytes = encoder.encode('{"ok":false}');
    expect(() => store.stageClaimed(r, wrongBytes)).toThrowError(EvidenceError);
    expect(store.usage().entries).toBe(0);
  });

  it('stages claimed content and is idempotent on re-stage', () => {
    const store = createBoundedEvidenceStore({ maxRunBytes: 1024, maxEntries: 8 });
    store.stageClaimed(ref(), content);
    expect(store.usage().entries).toBe(1);
    // Re-staging identical content does not consume budget.
    store.stageClaimed(ref(), content);
    expect(store.usage().entries).toBe(1);
    expect(store.usage().bytes).toBe(content.byteLength);
  });

  it('rejects when the byte or entry budget is exceeded', () => {
    const store = createBoundedEvidenceStore({
      maxRunBytes: content.byteLength + 1,
      maxEntries: 8,
    });
    store.stage(content);
    const extra = encoder.encode('{"other":true}');
    expect(() => store.stage(extra)).toThrowError(EvidenceError);
    expect(store.usage().bytes).toBe(content.byteLength);

    const entryCapped = createBoundedEvidenceStore({
      maxRunBytes: 4096,
      maxEntries: 1,
    });
    entryCapped.stage(content);
    expect(() => entryCapped.stage(extra)).toThrowError(EvidenceError);
  });
});

describe('orphan evidence retention (7.7/7.8)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  // Distinct content so each ref gets its own content digest.
  const youngBytes = encoder.encode('{"age":"young"}');
  const oldBytes = encoder.encode('{"age":"old"}');
  const refByAge = (age: 'young' | 'old') =>
    buildEvidenceRef({
      content: age === 'young' ? youngBytes : oldBytes,
      mediaType: 'application/json',
      observationKind: 'domain-result',
      producer,
      binding,
    });

  it('lists unreferenced orphans and excludes referenced ones (read-only)', () => {
    const known = new Map<string, ReturnType<typeof refByAge>>();
    const young = refByAge('young');
    const old = refByAge('old');
    known.set(young.contentDigest, young);
    known.set(old.contentDigest, old);
    const ledger = createRetentionLedger(() => known.values());
    ledger.record(young, 0);
    ledger.record(old, 0);
    const listed = ledger.listOrphans(0, (r) => r.contentDigest === young.contentDigest, 0);
    // young is referenced -> only old appears.
    expect(listed.entries.map((e) => e.contentDigest)).toEqual([old.contentDigest]);
  });

  it('removes only old + unreferenced orphans; retains young and referenced (race retention)', () => {
    const known = new Map<string, ReturnType<typeof refByAge>>();
    const young = refByAge('young');
    const old = refByAge('old');
    known.set(young.contentDigest, young);
    known.set(old.contentDigest, old);
    const ledger = createRetentionLedger(() => known.values());
    const now = DAY + 1;
    // young staged recently (too young to reap); old staged at dawn of time.
    ledger.record(young, now - 1000);
    ledger.record(old, 0);
    const removed = ledger.cleanupEligible(now, (r) => r.contentDigest === old.contentDigest, {
      minAgeMs: DAY,
      cursorPageSize: 256,
    });
    // young is too young; old is old but referenced at delete time -> nothing removed.
    expect(removed).toEqual([]);

    const removed2 = ledger.cleanupEligible(now, () => false, {
      minAgeMs: DAY,
      cursorPageSize: 256,
    });
    expect(removed2).toEqual([old.contentDigest]);
  });

  it('paginates the orphan list at the cursor page size', () => {
    const known = new Map<string, ReturnType<typeof refByAge>>();
    for (let i = 0; i < 300; i += 1) {
      const bytes = encoder.encode(`{"i":${i}}`);
      const r = buildEvidenceRef({
        content: bytes,
        mediaType: 'application/json',
        observationKind: 'domain-result',
        producer,
        binding,
      });
      known.set(r.contentDigest, r);
    }
    const ledger = createRetentionLedger(() => known.values());
    for (const r of known.values()) ledger.record(r, 0);
    const page1 = ledger.listOrphans(0, () => false, 0);
    expect(page1.entries).toHaveLength(256);
    const page2 = ledger.listOrphans(0, () => false, page1.nextCursor);
    expect(page2.entries).toHaveLength(300 - 256);
  });
});
