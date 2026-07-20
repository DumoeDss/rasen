import { describe, expect, it } from 'vitest';

import {
  digestExpert,
  hashSidecarTree,
  resolveExpertSidecarDir,
} from '../../../src/core/workflow-registry/expert-digest.js';
import { getBuiltInExpertDefinitions } from '../../../src/core/workflow-registry/index.js';

describe('expert digest preimage', () => {
  it('is deterministic and distinct from the workflow digest formats', () => {
    const template = { name: 'rasen:sample', description: 'sample', instructions: 'do it' };
    const a = digestExpert('sample', 'rasen-sample', template, [
      { path: 'references/notes.md', sha256: 'sha256:aaaa' },
    ]);
    const b = digestExpert('sample', 'rasen-sample', template, [
      { path: 'references/notes.md', sha256: 'sha256:aaaa' },
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when the template, dirName, id, or sidecar hashes change', () => {
    const template = { name: 'rasen:sample', description: 'sample', instructions: 'do it' };
    const base = digestExpert('sample', 'rasen-sample', template, []);

    expect(digestExpert('sample-2', 'rasen-sample', template, [])).not.toBe(base);
    expect(digestExpert('sample', 'rasen-sample-2', template, [])).not.toBe(base);
    expect(digestExpert('sample', 'rasen-sample', { ...template, description: 'changed' }, [])).not.toBe(base);
    expect(
      digestExpert('sample', 'rasen-sample', template, [{ path: 'a.md', sha256: 'sha256:bbbb' }])
    ).not.toBe(base);
  });

  it('resolves the sidecar tree from disk and returns [] for experts with no sidecar dir', () => {
    // `benchmark` has no `skills/experts/benchmark` directory on disk.
    expect(hashSidecarTree(resolveExpertSidecarDir('benchmark'))).toEqual([]);
    // `review` does, and should hash at least its SKILL.md-adjacent reference files.
    const reviewSidecars = hashSidecarTree(resolveExpertSidecarDir('review'));
    for (const file of reviewSidecars) {
      expect(file.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('gives qa-only a distinct digest from qa despite sharing a sidecar directory', () => {
    const experts = getBuiltInExpertDefinitions();
    const qa = experts.find((expert) => expert.id === 'qa');
    const qaOnly = experts.find((expert) => expert.id === 'qa-only');

    expect(qa).toBeDefined();
    expect(qaOnly).toBeDefined();
    expect(qaOnly?.sidecarSourceId).toBe('qa');
    expect(qaOnly?.digest).not.toBe(qa?.digest);
  });

  it('gives every built-in expert a unique digest', () => {
    const digests = getBuiltInExpertDefinitions().map((expert) => expert.digest);
    expect(new Set(digests).size).toBe(digests.length);
  });
});
