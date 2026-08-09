import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  digestExpert,
  hashSidecarTree,
  readSidecarTree,
  resolveExpertSidecarDir,
} from '../../../src/core/workflow-registry/expert-digest.js';
import { getBuiltInExpertDefinitions } from '../../../src/core/workflow-registry/index.js';

describe('expert digest preimage', () => {
  it('is deterministic and distinct from the workflow digest formats', () => {
    const template = { name: 'rasen-sample', description: 'sample', instructions: 'do it' };
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
    const template = { name: 'rasen-sample', description: 'sample', instructions: 'do it' };
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

  it('assigns the same sidecar identity to LF and CRLF checkouts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-sidecar-eol-'));
    const lfRoot = path.join(root, 'lf');
    const crlfRoot = path.join(root, 'crlf');
    try {
      fs.mkdirSync(lfRoot);
      fs.mkdirSync(crlfRoot);
      fs.writeFileSync(path.join(lfRoot, 'notes.md'), 'first\nsecond\n', 'utf8');
      fs.writeFileSync(path.join(crlfRoot, 'notes.md'), 'first\r\nsecond\r\n', 'utf8');

      const lf = readSidecarTree(lfRoot);
      const crlf = readSidecarTree(crlfRoot);
      expect(crlf).toEqual(lf);
      expect(crlf[0]?.content).toBe('first\nsecond\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps one QA identity and includes workflow-author sidecars in its digest contract', () => {
    const experts = getBuiltInExpertDefinitions();
    const qa = experts.find((expert) => expert.id === 'qa');
    const workflowAuthor = experts.find((expert) => expert.id === 'workflow-author');

    expect(qa).toBeDefined();
    expect(experts.filter((expert) => expert.id === 'qa')).toHaveLength(1);
    expect(workflowAuthor?.files.map((file) => file.path)).toContain(
      'references/workflow-review/README.md'
    );
    expect(workflowAuthor?.digest).not.toBe(qa?.digest);
  });

  it('gives every built-in expert a unique digest', () => {
    const digests = getBuiltInExpertDefinitions().map((expert) => expert.digest);
    expect(new Set(digests).size).toBe(digests.length);
  });
});
