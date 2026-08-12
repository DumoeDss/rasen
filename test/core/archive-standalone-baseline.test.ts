/**
 * `store-finalization-outcomes-v2` tasks 1.2 and 8.6 — the standalone and
 * legacy flat Store baseline.
 *
 * This change threads an optional block through a 4,500-line transaction
 * engine. The risk it carries is not that Store v2 archiving is wrong — the
 * Store v2 suites cover that — but that the paths NOBODY was changing moved
 * anyway. So this suite pins the untouched behavior explicitly, field by field:
 * the entry name, the v1 `archive.json` key set, spec-sync application, and the
 * journal's phase progression.
 *
 * Every assertion here is a LITERAL. If a regression is introduced in the
 * shared engine, the failure names which of the four properties moved rather
 * than reporting "a snapshot differs".
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyArchive,
  createArchivePlan,
  resolveArchiveSidecar,
  type PreparedArchiveSpecAction,
} from '../../src/core/archive-engine.js';

const CHANGE = 'baseline-change';
const DATE = '2026-07-31';
const CAPABILITY = 'sample-capability';

function digest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('standalone and legacy flat Store archiving, unchanged', () => {
  let root: string;
  let active: string;
  let archiveParent: string;
  let specsDir: string;
  let ephemera: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-archive-baseline-'));
    active = path.join(root, 'rasen', 'changes', CHANGE);
    archiveParent = path.join(root, 'rasen', 'changes', 'archive');
    specsDir = path.join(root, 'rasen', 'specs');
    ephemera = path.join(root, '.rasen', 'changes', CHANGE, 'ephemera');
    await fs.mkdir(path.join(active, 'evidence'), { recursive: true });
    await fs.mkdir(specsDir, { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Baseline\n');
    await fs.writeFile(path.join(active, 'tasks.md'), '- [x] Done\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'review-report.md'),
      '# Review\nFindings: 0\n'
    );
    await fs.writeFile(path.join(ephemera, 'trace.log'), 'discard\n');
    await fs.writeFile(path.join(ephemera, 'keep.txt'), 'preserve\n');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function plan(specActions: PreparedArchiveSpecAction[] = []) {
    const sidecar = await resolveArchiveSidecar(active, root, CHANGE);
    return createArchivePlan({
      change: CHANGE,
      planningRoot: root,
      executionRoot: root,
      activePath: active,
      archiveParent,
      ephemeraPath: ephemera,
      date: DATE,
      keepEphemera: false,
      validation: 'passed',
      tasks: { total: 1, completed: 1, override: false },
      timing: { mode: 'on-merge', deliveryMode: 'local', override: false },
      specActions,
      sidecar,
      transactionId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-07-31T00:00:00.000Z',
    });
  }

  it('carries no finalization block at all, so every new seam is inert', async () => {
    const archivePlan = await plan();

    expect(archivePlan.finalization).toBeUndefined();
    // The destination is the flat composition, with no target line and no
    // instance suffix.
    expect(archivePlan.paths.final).toBe(path.join(archiveParent, `${DATE}-${CHANGE}`));
    expect(path.basename(archivePlan.paths.final)).not.toContain('--');
  });

  it('writes the v1 archive.json with exactly its established key set', async () => {
    const archivePlan = await plan();
    expect((await applyArchive(archivePlan)).status).toBe('complete');

    const record = JSON.parse(
      await fs.readFile(path.join(archivePlan.paths.final, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;

    expect(Object.keys(record).sort()).toEqual(
      [
        'archivedAt',
        'change',
        'codeCommit',
        'ephemeraDiscarded',
        'evidence',
        'handoffAbsorbed',
        'missing',
        'planningBranch',
        'planningTreeState',
        'probes',
      ].sort()
    );
    expect(record.change).toBe(CHANGE);
    // None of the Store v2 facts appear, and none is defaulted to null either:
    // a standalone archive does not carry them at all.
    for (const v2Field of [
      'schemaVersion',
      'outcome',
      'reason',
      'supersededBy',
      'storeUid',
      'projectId',
      'targetLineId',
      'changeInstanceId',
      'workspacePairId',
      'codeMerge',
      'specSync',
      'implementation',
    ]) {
      expect(record, v2Field).not.toHaveProperty(v2Field);
    }
  });

  it('applies spec sync UNCONDITIONALLY, with no outcome consulted', async () => {
    const target = path.join(specsDir, CAPABILITY, 'spec.md');
    const delta = path.join(active, 'specs', CAPABILITY, 'spec.md');
    const before = '# Sample Capability\n\n## Purpose\n\nOriginal.\n';
    const rebuilt = '# Sample Capability\n\n## Purpose\n\nRebuilt by the archive.\n';
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.dirname(delta), { recursive: true });
    await fs.writeFile(target, before);
    await fs.writeFile(delta, rebuilt);

    const archivePlan = await plan([
      {
        capability: CAPABILITY,
        action: 'update',
        source: delta,
        target,
        sourceSha256: digest(rebuilt),
        targetPrecondition: { state: 'file', sha256: digest(before) },
        rebuilt,
        counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
      } as PreparedArchiveSpecAction,
    ]);

    const result = await applyArchive(archivePlan);
    expect(result.status, JSON.stringify(result.blockers)).toBe('complete');
    expect(result.specsUpdated).toBe(true);
    // The canonical spec is rewritten with no outcome anywhere in the decision:
    // this is the behavior a standalone project must KEEP.
    expect(await fs.readFile(target, 'utf8')).toBe(rebuilt);
    expect(result.totals).toEqual({ added: 0, modified: 1, removed: 0, renamed: 0 });
  });

  it('progresses the journal through its established phases, with no association phase', async () => {
    const archivePlan = await plan();
    const result = await applyArchive(archivePlan);
    expect(result.status).toBe('complete');

    const journal = JSON.parse(
      await fs.readFile(
        path.join(archivePlan.paths.final, '.rasen-archive-journal.json'),
        'utf8'
      )
    ) as {
      schemaVersion: number;
      phase: string;
      change: string;
      activePath: string;
      finalPath: string;
      phaseFingerprints: Record<string, unknown>;
    };

    expect(journal.schemaVersion).toBe(2);
    expect(journal.phase).toBe('complete');
    expect(journal.change).toBe(CHANGE);
    expect(journal.finalPath).toBe(archivePlan.paths.final);
    // The recorded phase fingerprints are the v1 set: no `association-finalized`
    // entry is produced for a plan with no finalization block.
    expect(Object.keys(journal.phaseFingerprints)).not.toContain('association-finalized');
  });

  it('discards and preserves ephemera exactly as before', async () => {
    const result = await applyArchive(await plan());
    expect(result.ephemeraDiscarded).toEqual(['trace.log']);
    expect(result.ephemeraPreserved).toEqual(['keep.txt']);
  });

  it('removes the active source last and publishes without clobbering', async () => {
    const archivePlan = await plan();
    expect((await applyArchive(archivePlan)).status).toBe('complete');

    await expect(fs.access(active)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(archivePlan.paths.final, 'proposal.md'))
    ).resolves.toBeUndefined();

    // A second, unrelated change archiving to the same name is refused rather
    // than overwriting.
    await fs.mkdir(active, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Second\n');
    const second = await plan();
    expect(second.complete).toBe(false);
    expect(
      second.blockers.some(
        blocker => blocker.operation === 'target-lstat' && blocker.code === 'EEXIST'
      )
    ).toBe(true);
  });
});
