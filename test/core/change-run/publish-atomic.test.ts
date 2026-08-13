import { describe, expect, it } from 'vitest';

import {
  PublishError,
  PublishFault,
  publishAtomic,
  stagingPathFor,
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

  it('is idempotent only when an already-present target has identical bytes', () => {
    const p = inMemoryPlumbing();
    publishAtomic(p, 's.tmp', 'r.final', bytes);
    const again = publishAtomic(p, 's.tmp', 'r.final', bytes);
    expect(again.published).toBe(false);
    expect(again.alreadyPresent).toBe(true);

    // Same length, different content.
    expect(() =>
      publishAtomic(p, 's.tmp', 'r.final', encoder.encode('{"record":2}'))
    ).toThrowError(
      expect.objectContaining<Partial<PublishError>>({
        code: 'publish_target_exists',
      })
    );
    // Different length, shared prefix: a comparison that stopped at the
    // shorter length, or compared only a prefix, would wrongly accept this.
    expect(() =>
      publishAtomic(p, 's.tmp', 'r.final', encoder.encode('{"record":1},{"extra":0}'))
    ).toThrowError(
      expect.objectContaining<Partial<PublishError>>({
        code: 'publish_target_exists',
      })
    );
    // Proper prefix of the published bytes, in the other direction.
    expect(() =>
      publishAtomic(p, 's.tmp', 'r.final', encoder.encode('{"record"'))
    ).toThrowError(
      expect.objectContaining<Partial<PublishError>>({
        code: 'publish_target_exists',
      })
    );
    expect(p.finalBytes()).toEqual(bytes);
  });

  it('fails closed when a present target cannot be read for comparison', () => {
    // `exists` says the target is there but `readFinal` cannot produce its
    // bytes. Idempotency is a claim about content, so the publish must be
    // refused with a typed error rather than leaking a raw filesystem error
    // or silently reporting success.
    const p: PublishPlumbing = {
      exists: () => true,
      readFinal: () => {
        throw Object.assign(new Error('ENOENT: vanished'), { code: 'ENOENT' });
      },
      writeStaging: () => undefined,
      fsync: () => undefined,
      publish: () => undefined,
      removeStaging: () => undefined,
    };

    expect(() => publishAtomic(p, 's.tmp', 'r.final', bytes)).toThrowError(
      expect.objectContaining<Partial<PublishError>>({
        code: 'publish_target_unverifiable',
      })
    );
  });

  it('rejects a publish race when the winner committed different bytes', () => {
    const winner = encoder.encode('{"record":2}');
    let final: Uint8Array | undefined;
    let staging: Uint8Array | undefined;
    const p: PublishPlumbing = {
      exists: () => final !== undefined,
      readFinal: () => {
        if (final === undefined) throw new Error('no final');
        return final;
      },
      writeStaging: (_path, value) => {
        staging = value;
      },
      fsync: () => undefined,
      publish: () => {
        final = winner;
        throw new Error('target exists');
      },
      removeStaging: () => {
        staging = undefined;
      },
    };

    expect(() => publishAtomic(p, 's.tmp', 'r.final', bytes)).toThrowError(
      expect.objectContaining<Partial<PublishError>>({
        code: 'publish_target_exists',
      })
    );
    expect(final).toEqual(winner);
    expect(staging).toBeUndefined();
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

describe('staging path derivation', () => {
  const target = '/runs/run-a/record-v1.json';

  it('never repeats a staging path for the same target', () => {
    // Every publisher of a given version must stage to its own file. A name
    // derived from the target alone is shared by all of them, and because
    // `writeStaging` truncates, one publisher would link another's bytes into
    // place while both reported success.
    const paths = Array.from({ length: 64 }, () => stagingPathFor(target));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).not.toContain(`${target}.staging`);
  });

  it('stages to a sibling of the target that is not a Record head name', () => {
    const staging = stagingPathFor(target);
    // Same directory, so the publishing link stays within one filesystem.
    expect(staging.startsWith(`${target}.`)).toBe(true);
    expect(staging.endsWith('.staging')).toBe(true);
    // The store's head filter must never mistake residue for a revision.
    const basename = staging.slice(Math.max(staging.lastIndexOf('/'), staging.lastIndexOf('\\')) + 1);
    expect(/^record-v(\d+)\.json$/.test(basename)).toBe(false);
  });
});
