import { describe, expect, it } from 'vitest';

import {
  PublishFault,
  publishAtomic,
  type PublishPlumbing,
} from '../../../src/core/change-run/internal/publish-atomic.js';

const encoder = new TextEncoder();

function inMemoryPlumbing(): PublishPlumbing & {
  readonly finalBytes: () => Uint8Array | undefined;
  readonly stagingBytes: () => Uint8Array | undefined;
} {
  let final: Uint8Array | undefined;
  let staging: Uint8Array | undefined;
  return Object.freeze({
    exists: (path) => path.endsWith('.final') && final !== undefined,
    readFinal: () => {
      if (final === undefined) throw new Error('no final');
      return final;
    },
    writeStaging: (_path, bytes) => {
      staging = bytes;
    },
    fsync: () => {
      if (staging === undefined) throw new Error('no staging');
    },
    publish: (stagingPath, targetPath) => {
      if (!targetPath.endsWith('.final')) throw new Error('bad target');
      if (final !== undefined) throw new Error('target exists');
      final = staging;
      staging = undefined;
    },
    removeStaging: () => {
      staging = undefined;
    },
    finalBytes: () => final,
    stagingBytes: () => staging,
  }) as PublishPlumbing & {
    readonly finalBytes: () => Uint8Array | undefined;
    readonly stagingBytes: () => Uint8Array | undefined;
  };
}

describe('atomic immutable publish (9.5/9.6)', () => {
  const bytes = encoder.encode('{"record":1}');

  it('publishes cleanly on the first attempt', () => {
    const p = inMemoryPlumbing();
    const result = publishAtomic(p, 's.tmp', 'r.final', bytes);
    expect(result.published).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(p.finalBytes()).toEqual(bytes);
    expect(p.stagingBytes()).toBeUndefined();
  });

  it('is idempotent: a second publish reports already-present', () => {
    const p = inMemoryPlumbing();
    publishAtomic(p, 's.tmp', 'r.final', bytes);
    const again = publishAtomic(p, 's.tmp', 'r.final', bytes);
    expect(again.published).toBe(false);
    expect(again.alreadyPresent).toBe(true);
  });

  it('faults after staging leave no final; a retry publishes successfully', () => {
    const p = inMemoryPlumbing();
    expect(() => publishAtomic(p, 's.tmp', 'r.final', bytes, 'after-stage-before-fsync')).toThrowError(
      PublishFault
    );
    expect(p.finalBytes()).toBeUndefined();
    expect(p.stagingBytes()).toBeDefined(); // residue
    const retry = publishAtomic(p, 's.tmp', 'r.final', bytes);
    expect(retry.published).toBe(true);
    expect(p.finalBytes()).toEqual(bytes);
  });

  it('faults after publish mean the final is durable (already-present on retry)', () => {
    const p = inMemoryPlumbing();
    expect(() =>
      publishAtomic(p, 's.tmp', 'r.final', bytes, 'after-publish-before-return')
    ).toThrowError(PublishFault);
    expect(p.finalBytes()).toEqual(bytes); // durable despite the post-publish fault
    const retry = publishAtomic(p, 's.tmp', 'r.final', bytes);
    expect(retry.alreadyPresent).toBe(true);
  });
});
