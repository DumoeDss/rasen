import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Intercepts `fs.renameSync` so a specific swap-in rename (stagedDir ->
// targetDir, identified by its NEW path) can be made to throw exactly once,
// reproducing the BLOCKER: a mid-batch overwrite failure AFTER the
// pre-existing content's backup rename already succeeded.
const renameMock = vi.hoisted(() => ({
  failOnceForNewPath: null as string | null,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync: typeof actual.renameSync = (oldPath, newPath) => {
    if (renameMock.failOnceForNewPath && path.resolve(String(newPath)) === renameMock.failOnceForNewPath) {
      renameMock.failOnceForNewPath = null;
      throw new Error('injected EBUSY-class rename failure');
    }
    return actual.renameSync(oldPath, newPath);
  };
  return { ...actual, default: actual, renameSync };
});

import {
  deletePipeline,
  importPipelinePackage,
} from '../../src/core/pipeline-library.js';
import {
  createPipelinePackage,
  encodePackage,
  type PipelinePackageInput,
} from '../../src/core/workflow-package/index.js';
import { getUserPipelinesDir, listPipelines } from '../../src/core/pipeline-registry/index.js';

function pipelineInput(name: string, marker: string): PipelinePackageInput {
  return {
    name,
    files: [
      {
        path: 'pipeline.yaml',
        content: [
          `name: ${name}`,
          `description: ${marker}`,
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '    role: implementer',
          '    requires: []',
          '',
        ].join('\n'),
      },
    ],
  };
}

function writePackage(home: string, filename: string, inputs: PipelinePackageInput[]): string {
  const packageValue = createPipelinePackage(
    inputs.map((i) => i.name),
    inputs
  );
  const dest = path.join(home, filename);
  fs.writeFileSync(dest, encodePackage(packageValue));
  return dest;
}

describe('pipeline import rollback (BLOCKER regression)', () => {
  let home: string;
  let originalHome: string | undefined;
  const cleanup: string[] = [];

  beforeEach(() => {
    renameMock.failOnceForNewPath = null;
    originalHome = process.env.RASEN_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-rollback-'));
    cleanup.push(home);
    process.env.RASEN_HOME = home;
  });

  afterEach(() => {
    renameMock.failOnceForNewPath = null;
    if (originalHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = originalHome;
    for (const directory of cleanup.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restores the pre-existing pipeline when the swap-in rename fails mid-overwrite, in a two-pipeline batch', async () => {
    // Pre-install "existing-pipe" with content A.
    await importPipelinePackage(writePackage(home, 'setup.rasenpkg', [pipelineInput('existing-pipe', 'ORIGINAL-A')]));
    const targetDir = path.join(getUserPipelinesDir(), 'existing-pipe');
    const originalContent = fs.readFileSync(path.join(targetDir, 'pipeline.yaml'), 'utf8');
    expect(originalContent).toContain('ORIGINAL-A');

    // Batch-import a package overwriting "existing-pipe" (content B) plus a
    // brand-new "fresh-pipe" (content C); "existing-pipe" sorts first
    // (alphabetically) so its swap-in rename is attempted before fresh-pipe's.
    const batchSource = writePackage(home, 'batch.rasenpkg', [
      pipelineInput('existing-pipe', 'REPLACEMENT-B'),
      pipelineInput('fresh-pipe', 'NEW-C'),
    ]);
    renameMock.failOnceForNewPath = path.resolve(targetDir);

    await expect(importPipelinePackage(batchSource, { overwrite: true })).rejects.toThrow(
      'injected EBUSY-class rename failure'
    );

    // The pre-existing pipeline must be restored to its ORIGINAL content —
    // not corrupted, not left as the (partially-applied) replacement, and not
    // orphaned in an untracked `.replaced-*` sibling directory.
    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'pipeline.yaml'), 'utf8')).toBe(originalContent);
    const siblings = fs.readdirSync(getUserPipelinesDir());
    expect(siblings.filter((entry) => entry.startsWith('existing-pipe.replaced-'))).toEqual([]);

    // The whole batch is one transaction: fresh-pipe must NOT have been
    // installed either, even though it was never itself the failing item.
    expect(listPipelines()).not.toContain('fresh-pipe');

    // The pipeline must still be independently usable afterward (no lock
    // left held, no leftover stage directory blocking future operations).
    await expect(deletePipeline('existing-pipe')).resolves.toMatchObject({ forcedReferrers: [] });
  });
});
