import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  EvidenceError,
  buildEvidenceRef,
  createInMemoryEvidenceStore,
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
