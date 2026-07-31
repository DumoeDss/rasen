import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ARCHIVE_JOURNAL_FILENAME,
  applyArchive,
  createArchivePlan,
  defaultArchiveEngineAdapters,
  resolveArchiveSidecar,
  type ArchiveApplyResult,
  type ArchiveEngineAdapters,
  type ArchiveFileSystem,
  type ArchiveJournal,
  type ArchivePlan,
  type ArchiveSidecarProjection,
} from '../../src/core/archive-engine.js';

function injectedError(message: string, code: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

async function snapshotTree(root: string): Promise<Record<string, string> | null> {
  const snapshot: Record<string, string> = {};
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        snapshot[relative] = `link:${await fs.readlink(absolute)}`;
      } else if (stat.isDirectory()) {
        snapshot[`${relative}/`] = 'directory';
        await walk(absolute, relative);
      } else {
        snapshot[relative] = `file:${(await fs.readFile(absolute)).toString('base64')}`;
      }
    }
  }
  try {
    await walk(root, '');
    return snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

describe('archive apply named fault and recovery matrix', () => {
  let root: string;
  let active: string;
  let archiveParent: string;
  let ephemera: string;
  let baseAdapters: ArchiveEngineAdapters;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-archive-fault-'));
    active = path.join(root, 'rasen', 'changes', 'sample');
    archiveParent = path.join(root, 'rasen', 'changes', 'archive');
    ephemera = path.join(root, '.rasen', 'changes', 'sample', 'ephemera');
    await fs.mkdir(path.join(active, 'evidence', 'nested'), { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample bytes\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'nested', 'review-report.md'),
      '# Review\nFindings: 1\n'
    );
    await fs.writeFile(path.join(ephemera, 'trace-a.log'), 'trace a\n');
    await fs.writeFile(path.join(ephemera, 'trace-b.log'), 'trace b\n');
    await fs.writeFile(path.join(ephemera, 'keep.txt'), 'keep bytes\n');
    baseAdapters = {
      ...defaultArchiveEngineAdapters,
      git: {
        state: async () => 'non-git',
        exec: async () => {
          throw new Error('No Git command is valid in the confirmed non-Git fixture.');
        },
      },
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      transactionId: () => '11111111-1111-4111-8111-111111111111',
    };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function makePlan(
    options: {
      adapters?: ArchiveEngineAdapters;
      sidecar?: ArchiveSidecarProjection;
    } = {}
  ): Promise<ArchivePlan> {
    const adapters = options.adapters ?? baseAdapters;
    const sidecar =
      options.sidecar ??
      (await resolveArchiveSidecar(active, root, 'sample', adapters));
    return createArchivePlan(
      {
        change: 'sample',
        planningRoot: root,
        executionRoot: root,
        activePath: active,
        archiveParent,
        ephemeraPath: ephemera,
        date: '2026-07-31',
        keepEphemera: false,
        validation: 'passed',
        tasks: { total: 1, completed: 1, override: false },
        timing: { mode: 'on-merge', deliveryMode: 'local', override: false },
        specActions: [],
        sidecar,
        transactionId: '11111111-1111-4111-8111-111111111111',
        createdAt: '2026-07-31T00:00:00.000Z',
      },
      adapters
    );
  }

  async function readJournal(target: string): Promise<ArchiveJournal> {
    return JSON.parse(await fs.readFile(target, 'utf8')) as ArchiveJournal;
  }

  function expectFailureReport(
    result: ArchiveApplyResult,
    plan: ArchivePlan,
    expected: {
      operation: string;
      path: string;
      code: string;
      journalPath: string;
      resumed?: boolean;
    }
  ): void {
    expect(result).toMatchObject({
      status: 'recoverable',
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      path: plan.paths.final,
      journalPath: expected.journalPath,
      resumed: expected.resumed ?? false,
      blockers: [
        {
          operation: expected.operation,
          path: expected.path,
          code: expected.code,
        },
      ],
    });
    expect(result.blockers[0].message.length).toBeGreaterThan(0);
  }

  async function expectFailedJournal(
    plan: ArchivePlan,
    expected: {
      target: string;
      operation: string;
      path: string;
      code: string;
      resumePhase: ArchiveJournal['phase'];
      disposed?: string[];
    }
  ): Promise<void> {
    const journal = await readJournal(expected.target);
    expect(journal).toMatchObject({
      schemaVersion: 2,
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      change: plan.change,
      phase: 'failed',
      activePath: plan.paths.active,
      stagePath: plan.paths.stage,
      finalPath: plan.paths.final,
      ephemeraDisposed: expected.disposed ?? [],
      failure: {
        operation: expected.operation,
        path: expected.path,
        code: expected.code,
        resumePhase: expected.resumePhase,
      },
    });
  }

  async function expectRetryCompletes(plan: ArchivePlan): Promise<void> {
    const retry = await applyArchive(plan, baseAdapters);
    expect(retry.status, JSON.stringify(retry)).toBe('complete');
    expect(retry.resumed).toBe(true);
    expect((await readJournal(plan.paths.publishedJournal)).phase).toBe('complete');
    expect(await snapshotTree(active)).toBeNull();
  }

  it('source drift retains exact current bytes, creates no recovery state, repeats deterministically, and succeeds after remediation', async () => {
    const plan = await makePlan();
    await fs.writeFile(path.join(active, 'after-plan.txt'), 'drift bytes\n');
    const activeWithDrift = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);

    const first = await applyArchive(plan, baseAdapters);
    expectFailureReport(first, plan, {
      operation: 'source-inventory',
      path: active,
      code: 'ESTALE',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(active)).toEqual(activeWithDrift);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.stage)).toBeNull();
    expect(await snapshotTree(plan.paths.final)).toBeNull();

    const second = await applyArchive(plan, baseAdapters);
    expect(second).toEqual(first);
    expect(await snapshotTree(active)).toEqual(activeWithDrift);

    await fs.rm(path.join(active, 'after-plan.txt'));
    const recovered = await applyArchive(plan, baseAdapters);
    expect(recovered.status).toBe('complete');
  });

  it('same-byte file replacement is not deletion authority', async () => {
    const plan = await makePlan();
    const proposal = path.join(active, 'proposal.md');
    const bytes = await fs.readFile(proposal);
    await fs.rm(proposal);
    await fs.writeFile(proposal, bytes);
    const replacementTree = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);

    const result = await applyArchive(plan, baseAdapters);
    expectFailureReport(result, plan, {
      operation: 'source-inventory',
      path: active,
      code: 'ESTALE',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(active)).toEqual(replacementTree);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.stage)).toBeNull();
    expect(await snapshotTree(plan.paths.final)).toBeNull();
  });

  it('binds file reads to the opened object and rejects a pathname swap during read', async () => {
    const proposal = path.join(active, 'proposal.md');
    const displaced = path.join(active, 'proposal.displaced.md');
    let swapped = false;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        readHandle: async (handle, target) => {
          if (target === proposal && !swapped) {
            swapped = true;
            await fs.rename(proposal, displaced);
            await fs.writeFile(proposal, '# Concurrent pathname bytes\n');
          }
          return baseAdapters.fs.readHandle(handle, target);
        },
      },
    };

    const plan = await makePlan({ adapters });

    expect(swapped).toBe(true);
    expect(plan.complete).toBe(false);
    expect(plan.sourceFingerprint).toBeNull();
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'source-inventory',
          path: active,
          code: 'ESTALE',
        }),
      ])
    );
    expect(await fs.readFile(proposal, 'utf8')).toBe(
      '# Concurrent pathname bytes\n'
    );
    expect(await fs.readFile(displaced, 'utf8')).toBe('# Sample bytes\n');
  });

  it('serializes lossless bigint source identities as decimal strings', async () => {
    const plan = await makePlan();
    const identity = plan.sourceFingerprint!.authorityEntries.find(
      entry => entry.path === 'proposal.md'
    )!.identity;

    for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'] as const) {
      expect(typeof identity[field]).toBe('string');
      expect(identity[field]).toMatch(/^\d+$/);
    }
    expect(
      plan.sourceFingerprint!.entries.find(entry => entry.path === 'proposal.md')
        ?.size
    ).toBe(String(Buffer.byteLength('# Sample bytes\n')));
  });

  it('same-byte whole-root replacement is not deletion authority', async () => {
    const plan = await makePlan();
    const originalTree = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    await fs.rm(active, { recursive: true, force: false });
    await fs.mkdir(path.join(active, 'evidence', 'nested'), { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample bytes\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'nested', 'review-report.md'),
      '# Review\nFindings: 1\n'
    );
    expect(await snapshotTree(active)).toEqual(originalTree);

    const result = await applyArchive(plan, baseAdapters);
    expectFailureReport(result, plan, {
      operation: 'source-inventory',
      path: active,
      code: 'ESTALE',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(active)).toEqual(originalTree);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.stage)).toBeNull();
    expect(await snapshotTree(plan.paths.final)).toBeNull();
  });

  it('stops guarded source deletion when a same-byte child is replaced after claim', async () => {
    const plan = await makePlan();
    const quarantineProposal = path.join(
      path.dirname(active),
      `.rasen-archive-source-${plan.transactionId}`,
      plan.change,
      'proposal.md'
    );
    const replacementBytes = await fs.readFile(path.join(active, 'proposal.md'));
    let quarantineStats = 0;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        lstat: async target => {
          if (target === quarantineProposal) {
            quarantineStats += 1;
            // #3 is the handle-bound after-path check; #4 is the guarded
            // deletion revalidation after the fingerprint handle is closed.
            if (quarantineStats === 4) {
              await fs.rm(target);
              await fs.writeFile(target, replacementBytes);
            }
          }
          return baseAdapters.fs.lstat(target);
        },
      },
    };

    const result = await applyArchive(plan, adapters);
    expect(result.status).toBe('recoverable');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'source-remove',
          code: 'ESTALE',
        }),
      ])
    );
    await expect(fs.access(active)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(quarantineProposal, 'utf8')).toBe('# Sample bytes\n');
  });

  it('a target race never writes a journal into or changes the unrelated target', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    await fs.mkdir(plan.paths.final, { recursive: true });
    await fs.writeFile(path.join(plan.paths.final, 'sentinel.bin'), Buffer.from([0, 1, 2, 255]));
    const unrelatedBefore = await snapshotTree(plan.paths.final);

    const first = await applyArchive(plan, baseAdapters);
    expectFailureReport(first, plan, {
      operation: 'publish',
      path: plan.paths.final,
      code: 'EEXIST',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(plan.paths.final)).toEqual(unrelatedBefore);
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.stage)).toBeNull();

    const second = await applyArchive(plan, baseAdapters);
    expect(second).toEqual(first);
    expect(await snapshotTree(plan.paths.final)).toEqual(unrelatedBefore);

    await fs.rm(plan.paths.final, { recursive: true, force: false });
    expect((await applyArchive(plan, baseAdapters)).status).toBe('complete');
  });

  it('a final target created at the reservation boundary is never replaced', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    let injected = false;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        mkdir: async (target, options) => {
          if (target === plan.paths.final && !injected) {
            injected = true;
            await baseAdapters.fs.mkdir(target);
          }
          return baseAdapters.fs.mkdir(target, options);
        },
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'publish',
      path: plan.paths.final,
      code: 'EEXIST',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(plan.paths.final)).toEqual({});
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    await fs.rmdir(plan.paths.final);
    expect((await applyArchive(plan)).status).toBe('complete');
  });

  it('preserves an unaccounted CONCURRENT.txt inserted after final reservation', async () => {
    const plan = await makePlan();
    const concurrent = path.join(plan.paths.final, 'CONCURRENT.txt');
    let injected = false;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        readdir: async (target, options) => {
          if (target === plan.paths.final && !injected) {
            try {
              await baseAdapters.fs.access(plan.paths.publishedJournal);
              injected = true;
              await baseAdapters.fs.writeFile(
                concurrent,
                'concurrent occupant survives\n',
                { flag: 'wx' }
              );
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }
          return baseAdapters.fs.readdir(target, options);
        },
      },
    };

    const first = await applyArchive(plan, adapters);
    expect(injected).toBe(true);
    expect(first.status).toBe('recoverable');
    expect(first.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ESTALE' }),
      ])
    );
    expect(await fs.readFile(concurrent, 'utf8')).toBe(
      'concurrent occupant survives\n'
    );
    await expect(fs.access(active)).resolves.toBeUndefined();

    const retry = await applyArchive(plan, baseAdapters);
    expect(retry.status).toBe('recoverable');
    expect(retry.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EEXIST' }),
      ])
    );
    expect(await fs.readFile(concurrent, 'utf8')).toBe(
      'concurrent occupant survives\n'
    );
    await expect(fs.access(active)).resolves.toBeUndefined();
  });

  const publicationFaults = [
    ['EXDEV invariant', 'EXDEV'],
    ['EPERM permission', 'EPERM'],
    ['EACCES permission', 'EACCES'],
    ['EIO I/O', 'EIO'],
    ['named publish failure', 'ENOSPC'],
  ] as const;

  it.each(publicationFaults)(
    '%s at the no-replace marker preserves active/ephemera bytes and resumes',
    async (_label, code) => {
      const plan = await makePlan();
      const activeBefore = await snapshotTree(active);
      const ephemeraBefore = await snapshotTree(ephemera);
      let publishAttempts = 0;
      const adapters: ArchiveEngineAdapters = {
        ...baseAdapters,
        fs: {
          ...baseAdapters.fs,
          link: async (source, target) => {
            if (target.endsWith('.rasen-archive-published.json')) {
              publishAttempts += 1;
              throw injectedError(`injected ${code} publication failure`, code);
            }
            return baseAdapters.fs.link(source, target);
          },
        },
      };

      const result = await applyArchive(plan, adapters);
      expectFailureReport(result, plan, {
        operation: 'publish',
        path: path.join(plan.paths.final, '.rasen-archive-published.json'),
        code,
        journalPath: plan.paths.publishedJournal,
      });
      expect(publishAttempts).toBe(1);
      expect(await snapshotTree(active)).toEqual(activeBefore);
      expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
      expect(await snapshotTree(plan.paths.final)).not.toBeNull();
      await expectFailedJournal(plan, {
        target: plan.paths.publishedJournal,
        operation: 'publish',
        path: path.join(plan.paths.final, '.rasen-archive-published.json'),
        code,
        resumePhase: 'specs-applied',
      });
      await expectRetryCompletes(plan);
    }
  );

  it('rehashes a transformed stage on resume and rejects corruption', async () => {
    const plan = await makePlan();
    let failMarker = true;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        link: async (source, target) => {
          if (
            target.endsWith('.rasen-archive-published.json') &&
            failMarker
          ) {
            failMarker = false;
            throw injectedError('stop before publication marker', 'EIO');
          }
          return baseAdapters.fs.link(source, target);
        },
      },
    };
    expect((await applyArchive(plan, adapters)).status).toBe('recoverable');
    await fs.writeFile(path.join(plan.paths.stage, 'proposal.md'), '# corrupt\n');

    const resumed = await applyArchive(plan);
    expect(resumed.status).toBe('recoverable');
    expect(resumed.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'publish', code: 'ESTALE' }),
      ])
    );
    await expect(fs.access(active)).resolves.toBeUndefined();
  });

  it('rehashes a published payload on resume and rejects corruption', async () => {
    const plan = await makePlan();
    let failAccounting = true;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      writeArchiveJson: async (...args) => {
        if (failAccounting) {
          failAccounting = false;
          throw injectedError('stop before accounting', 'EIO');
        }
        return baseAdapters.writeArchiveJson(...args);
      },
    };
    expect((await applyArchive(plan, adapters)).status).toBe('recoverable');
    await fs.writeFile(path.join(plan.paths.final, 'proposal.md'), '# corrupt\n');

    const resumed = await applyArchive(plan);
    expect(resumed.status).toBe('recoverable');
    expect(resumed.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'publish', code: 'ESTALE' }),
      ])
    );
    await expect(fs.access(active)).resolves.toBeUndefined();
  });

  it('copy failure leaves a truthful planned journal, exact sources, and rebuilds the partial stage on retry', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        copyFile: async (source, target, flags) => {
          if (source === path.join(active, 'proposal.md')) {
            throw injectedError('injected copy failure', 'EIO');
          }
          return baseAdapters.fs.copyFile(source, target, flags);
        },
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'copy',
      path: plan.paths.stage,
      code: 'EIO',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.final)).toBeNull();
    await expectFailedJournal(plan, {
      target: plan.paths.journal,
      operation: 'copy',
      path: plan.paths.stage,
      code: 'EIO',
      resumePhase: 'planned',
    });
    await expectRetryCompletes(plan);
    expect(
      await fs.readFile(path.join(plan.paths.final, 'proposal.md'), 'utf8')
    ).toBe('# Sample bytes\n');
  });

  it('staged-tree mismatch keeps exact sources and rebuilds the owned corrupt stage on retry', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        copyFile: async (source, target, flags) => {
          await baseAdapters.fs.copyFile(source, target, flags);
          if (source === path.join(active, 'proposal.md')) {
            await baseAdapters.fs.writeFile(target, 'corrupted staged bytes\n');
          }
        },
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'copy',
      path: plan.paths.stage,
      code: 'ESTALE',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    await expectFailedJournal(plan, {
      target: plan.paths.journal,
      operation: 'copy',
      path: plan.paths.stage,
      code: 'ESTALE',
      resumePhase: 'planned',
    });
    await expectRetryCompletes(plan);
  });

  it('sidecar read failure is a stable blocker with zero mutation, then replans after remediation', async () => {
    const sidecarPath = path.join(active, '.rasen-archive-input.json');
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    const readFile = (async (
      target: string,
      encoding?: BufferEncoding
    ): Promise<Buffer | string> => {
      if (target === sidecarPath) {
        throw injectedError('injected sidecar read failure', 'EACCES');
      }
      return encoding
        ? baseAdapters.fs.readFile(target, encoding)
        : baseAdapters.fs.readFile(target);
    }) as ArchiveFileSystem['readFile'];
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: { ...baseAdapters.fs, readFile },
    };
    const sidecar = await resolveArchiveSidecar(active, root, 'sample', adapters);
    const plan = await makePlan({ adapters, sidecar });

    expect(plan.complete).toBe(false);
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'sidecar-read',
          path: sidecarPath,
          code: 'EACCES',
        }),
      ])
    );
    const first = await applyArchive(plan, adapters);
    const second = await applyArchive(plan, adapters);
    expect(second).toEqual(first);
    expect(first.status).toBe('blocked');
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.stage)).toBeNull();
    expect(await snapshotTree(plan.paths.final)).toBeNull();

    const remediated = await makePlan();
    expect((await applyArchive(remediated, baseAdapters)).status).toBe('complete');
  });

  it('sidecar schema failure is a stable blocker with byte-identical intent until explicitly fixed', async () => {
    const sidecarPath = path.join(active, '.rasen-archive-input.json');
    await fs.writeFile(sidecarPath, '{"schemaVersion":99,"change":"wrong"}\n');
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    const plan = await makePlan();

    expect(plan.complete).toBe(false);
    expect(plan.sidecar.status).toBe('invalid');
    const first = await applyArchive(plan, baseAdapters);
    const second = await applyArchive(plan, baseAdapters);
    expect(second).toEqual(first);
    expect(first.status).toBe('blocked');
    expect(first.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'sidecar-validate', path: sidecarPath }),
      ])
    );
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.final)).toBeNull();

    await fs.rm(sidecarPath);
    const remediated = await makePlan();
    expect((await applyArchive(remediated, baseAdapters)).status).toBe('complete');
  });

  it('Git failure blocks planning without guessed facts or mutation and replans deterministically', async () => {
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      git: {
        ...baseAdapters.git,
        state: async () => {
          throw injectedError('injected Git state failure', 'EIO');
        },
      },
    };
    const sidecar = await resolveArchiveSidecar(active, root, 'sample', adapters);
    const firstPlan = await makePlan({ adapters, sidecar });
    const secondPlan = await makePlan({ adapters, sidecar });
    expect(secondPlan).toEqual(firstPlan);
    expect(firstPlan.git.execution.state).toBe('error');
    expect(firstPlan.git.planning.state).toBe('error');
    expect(firstPlan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'git', code: 'EIO' }),
      ])
    );
    expect((await applyArchive(firstPlan, adapters)).status).toBe('blocked');
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(firstPlan.paths.stage)).toBeNull();
    expect(await snapshotTree(firstPlan.paths.final)).toBeNull();

    const remediated = await makePlan();
    expect((await applyArchive(remediated, baseAdapters)).status).toBe('complete');
  });

  it.each([
    ['clean-to-dirty', false, true],
    ['dirty-to-clean', true, false],
  ] as const)(
    'planning tree-state %s drift is rejected before mutation and succeeds only after restoration',
    async (_label, plannedDirty, applyDirty) => {
      let dirty = plannedDirty;
      const commit = 'a'.repeat(40);
      const adapters: ArchiveEngineAdapters = {
        ...baseAdapters,
        git: {
          state: async () => 'git',
          exec: async (_gitRoot, args) => {
            if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') return commit;
            if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'main';
            if (args.join(' ') === 'status --porcelain') {
              return dirty ? ' M planning-file' : '';
            }
            throw new Error(`Unexpected Git args: ${args.join(' ')}`);
          },
        },
      };
      const sidecar = await resolveArchiveSidecar(active, root, 'sample', adapters);
      const plan = await makePlan({ adapters, sidecar });
      expect(plan.git.planning.treeState).toBe(plannedDirty ? 'dirty' : 'clean');
      const activeBefore = await snapshotTree(active);
      const ephemeraBefore = await snapshotTree(ephemera);

      dirty = applyDirty;
      const result = await applyArchive(plan, adapters);
      expectFailureReport(result, plan, {
        operation: 'git',
        path: root,
        code: 'ESTALE',
        journalPath: plan.paths.journal,
      });
      expect(await snapshotTree(active)).toEqual(activeBefore);
      expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
      expect(await snapshotTree(plan.paths.stage)).toBeNull();
      expect(await snapshotTree(plan.paths.final)).toBeNull();

      dirty = plannedDirty;
      expect((await applyArchive(plan, adapters)).status).toBe('complete');
    }
  );

  it('evidence hash drift leaves a published journal, retains active bytes, reports actual cleaning, and resumes', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      resolveArchiveAccounting: async () => {
        const error = injectedError('injected evidence hash drift', 'ESTALE') as Error & {
          operation: string;
          path: string;
        };
        error.operation = 'evidence-hash';
        error.path = path.join(plan.paths.final, 'evidence', 'ship-log.md');
        throw error;
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'evidence',
      path: path.join(plan.paths.final, 'evidence', 'ship-log.md'),
      code: 'ESTALE',
      journalPath: plan.paths.publishedJournal,
    });
    expect(result.ephemeraDiscarded).toEqual(['trace-a.log', 'trace-b.log']);
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(plan.paths.final)).not.toBeNull();
    expect(await snapshotTree(path.join(plan.paths.final, 'archive.json'))).toBeNull();
    await expectFailedJournal(plan, {
      target: plan.paths.publishedJournal,
      operation: 'evidence-hash',
      path: path.join(plan.paths.final, 'evidence', 'ship-log.md'),
      code: 'ESTALE',
      resumePhase: 'cleaner-progress',
      disposed: ['trace-a.log', 'trace-b.log'],
    });
    await expectRetryCompletes(plan);
  });

  it('journal failure retains exact sources, leaves an owned failed journal, and deterministically rebuilds on retry', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    const ephemeraBefore = await snapshotTree(ephemera);
    let failOnce = true;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        open: async (target, flags, mode) => {
          if (
            failOnce &&
            path.dirname(target) === plan.paths.stage &&
            path.basename(target).includes('.rasen-archive-journal.json.tmp-')
          ) {
            failOnce = false;
            throw injectedError('injected journal open failure', 'EIO');
          }
          return baseAdapters.fs.open(target, flags, mode);
        },
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'journal',
      path: plan.paths.journal,
      code: 'EIO',
      journalPath: plan.paths.journal,
    });
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(await snapshotTree(ephemera)).toEqual(ephemeraBefore);
    expect(await snapshotTree(plan.paths.final)).toBeNull();
    await expectFailedJournal(plan, {
      target: plan.paths.journal,
      operation: 'journal',
      path: plan.paths.journal,
      code: 'EIO',
      resumePhase: 'planned',
    });
    await expectRetryCompletes(plan);
  });

  it('fails closed on a version 1 destructive journal and names manual recovery', async () => {
    const plan = await makePlan();
    await fs.mkdir(plan.paths.stage, { recursive: true });
    await fs.writeFile(
      plan.paths.journal,
      JSON.stringify({
        schemaVersion: 1,
        transactionId: plan.transactionId,
        planHash: plan.planHash,
        phase: 'staged',
      })
    );

    const result = await applyArchive(plan);
    expect(result.status).toBe('recoverable');
    expect(result.blockers[0]?.message).toContain('manual recovery');
    expect(result.blockers[0]?.message).toContain(plan.paths.journal);
    await expect(fs.access(active)).resolves.toBeUndefined();
    await expect(fs.access(plan.paths.stage)).resolves.toBeUndefined();
  });

  it('accounting write failure leaves truthful published recovery state and resumes without repeating cleaning', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      writeArchiveJson: async archivedDir => {
        const error = injectedError('injected accounting write failure', 'EIO') as Error & {
          operation: string;
          path: string;
        };
        error.operation = 'archive-json-write';
        error.path = path.join(archivedDir, 'archive.json');
        throw error;
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'accounting',
      path: path.join(plan.paths.final, 'archive.json'),
      code: 'EIO',
      journalPath: plan.paths.publishedJournal,
    });
    expect(result.ephemeraDiscarded).toEqual(['trace-a.log', 'trace-b.log']);
    expect(await snapshotTree(active)).toEqual(activeBefore);
    await expect(
      fs.access(path.join(plan.paths.final, 'archive.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expectFailedJournal(plan, {
      target: plan.paths.publishedJournal,
      operation: 'archive-json-write',
      path: path.join(plan.paths.final, 'archive.json'),
      code: 'EIO',
      resumePhase: 'cleaner-progress',
      disposed: ['trace-a.log', 'trace-b.log'],
    });
    await expectRetryCompletes(plan);
  });

  it('cleaner partial failure records only actual progress, retains active bytes, and resumes the untouched candidate', async () => {
    const plan = await makePlan();
    expect(plan.cleaner.effectiveDelete).toEqual(['trace-a.log', 'trace-b.log']);
    const activeBefore = await snapshotTree(active);
    let cleanerCalls = 0;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      applyEphemeraDeletion: async (directory, classification, fileSystem) => {
        cleanerCalls += 1;
        if (cleanerCalls === 2) {
          throw injectedError('injected cleaner partial failure', 'EIO');
        }
        return baseAdapters.applyEphemeraDeletion(
          directory,
          classification,
          fileSystem
        );
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'cleaner-apply',
      path: path.join(ephemera, 'trace-b.log'),
      code: 'EIO',
      journalPath: plan.paths.publishedJournal,
    });
    expect(result.ephemeraDiscarded).toEqual(['trace-a.log']);
    expect(await snapshotTree(active)).toEqual(activeBefore);
    await expect(fs.access(path.join(ephemera, 'trace-a.log'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(path.join(ephemera, 'trace-b.log'), 'utf8')).toBe(
      'trace b\n'
    );
    expect(await fs.readFile(path.join(ephemera, 'keep.txt'), 'utf8')).toBe(
      'keep bytes\n'
    );
    await expectFailedJournal(plan, {
      target: plan.paths.publishedJournal,
      operation: 'cleaner-apply',
      path: path.join(ephemera, 'trace-b.log'),
      code: 'EIO',
      resumePhase: 'cleaner-progress',
      disposed: ['trace-a.log'],
    });
    await expectRetryCompletes(plan);
  });

  it('recovers a cleaner deletion that crashed after unlink from durable intent', async () => {
    const plan = await makePlan();
    let crashAfterDelete = true;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      applyEphemeraDeletion: async (...args) => {
        const deleted = await baseAdapters.applyEphemeraDeletion(...args);
        if (crashAfterDelete) {
          crashAfterDelete = false;
          throw injectedError('crash after unlink', 'EIO');
        }
        return deleted;
      },
    };

    const first = await applyArchive(plan, adapters);
    expect(first.status).toBe('recoverable');
    expect(first.ephemeraDiscarded).toEqual([]);
    await expect(fs.access(path.join(ephemera, 'trace-a.log'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const beforeRetry = await readJournal(plan.paths.publishedJournal);
    expect(beforeRetry.cleanerProgress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'trace-a.log',
          state: 'delete-intent',
        }),
      ])
    );

    const retry = await applyArchive(plan);
    expect(retry.status).toBe('complete');
    expect(retry.ephemeraDiscarded).toEqual(['trace-a.log', 'trace-b.log']);
    const completed = await readJournal(plan.paths.publishedJournal);
    expect(completed.cleanerProgress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'trace-a.log',
          state: 'deleted-after-intent',
        }),
      ])
    );
  });

  it('active-source removal failure retains exact active bytes and finalized accounting, then resumes source-last', async () => {
    const plan = await makePlan();
    const activeBefore = await snapshotTree(active);
    let failOnce = true;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        rename: async (source, target) => {
          if (source === active && failOnce) {
            failOnce = false;
            throw injectedError('injected active source removal failure', 'EACCES');
          }
          return baseAdapters.fs.rename(source, target);
        },
      },
    };

    const result = await applyArchive(plan, adapters);
    expectFailureReport(result, plan, {
      operation: 'source-remove',
      path: active,
      code: 'EACCES',
      journalPath: plan.paths.publishedJournal,
    });
    expect(result.ephemeraDiscarded).toEqual(['trace-a.log', 'trace-b.log']);
    expect(await snapshotTree(active)).toEqual(activeBefore);
    expect(
      JSON.parse(await fs.readFile(path.join(plan.paths.final, 'archive.json'), 'utf8'))
        .ephemeraDiscarded
    ).toEqual(['trace-a.log', 'trace-b.log']);
    await expectFailedJournal(plan, {
      target: plan.paths.publishedJournal,
      operation: 'source-remove',
      path: active,
      code: 'EACCES',
      resumePhase: 'accounting-finalized',
      disposed: ['trace-a.log', 'trace-b.log'],
    });
    await expectRetryCompletes(plan);
  });

  it('rejects corruption instead of trusting a completed journal fast path', async () => {
    const plan = await makePlan();
    const first = await applyArchive(plan, baseAdapters);
    expect(first.status).toBe('complete');
    const proposal = path.join(plan.paths.final, 'proposal.md');
    await fs.writeFile(proposal, '# corrupt after completion\n');

    const retry = await applyArchive(plan, baseAdapters);

    expect(retry).toMatchObject({
      status: 'recoverable',
      resumed: true,
      journalPath: plan.paths.publishedJournal,
      blockers: [
        expect.objectContaining({
          operation: 'accounting',
          path: plan.paths.final,
          code: 'ESTALE',
        }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
        guidance: expect.stringContaining('Automatic archive resume is disabled'),
      },
    });
    expect(retry.recoveryCommand).toBeUndefined();
    await expect(fs.access(plan.paths.publishedJournal)).resolves.toBeUndefined();
    await expect(fs.access(plan.paths.journal)).rejects.toMatchObject({ code: 'ENOENT' });
    const completed = await readJournal(plan.paths.publishedJournal);
    expect(completed).toMatchObject({
      phase: 'complete',
      integrityFailure: {
        detectedAt: '2026-07-31T00:00:00.000Z',
        operation: 'accounting',
        path: plan.paths.final,
        code: 'ESTALE',
        message: expect.stringContaining(
          'Completed archive payload differs from its verified phase fingerprint'
        ),
        safeAction: {
          kind: 'manual-recovery-required',
          guidance: retry.manualRecoveryAction?.guidance,
        },
      },
    });
    const durableJournal = await fs.readFile(plan.paths.publishedJournal, 'utf8');
    const repeated = await applyArchive(plan, baseAdapters);
    expect(repeated).toEqual(retry);
    expect(await fs.readFile(plan.paths.publishedJournal, 'utf8')).toBe(durableJournal);
    expect(await fs.readFile(proposal, 'utf8')).toBe(
      '# corrupt after completion\n'
    );
  });

  it('keeps completed corruption manual-only when its first integrity journal sync fails', async () => {
    const plan = await makePlan();
    const first = await applyArchive(plan, baseAdapters);
    expect(first.status).toBe('complete');
    const proposal = path.join(plan.paths.final, 'proposal.md');
    await fs.writeFile(proposal, '# corrupt after completion\n');
    const completedJournalBytes = await fs.readFile(
      plan.paths.publishedJournal,
      'utf8'
    );

    let failTerminalAlertSync = true;
    const adapters: ArchiveEngineAdapters = {
      ...baseAdapters,
      fs: {
        ...baseAdapters.fs,
        open: async (target, flags, mode) => {
          const handle = await baseAdapters.fs.open(target, flags, mode);
          if (
            !path.basename(target).startsWith(
              `.${ARCHIVE_JOURNAL_FILENAME}.tmp-`
            )
          ) {
            return handle;
          }
          return new Proxy(handle, {
            get(object, property) {
              if (property === 'sync') {
                return async () => {
                  if (failTerminalAlertSync) {
                    failTerminalAlertSync = false;
                    throw injectedError(
                      'injected terminal integrity journal sync failure',
                      'EIO'
                    );
                  }
                  return object.sync();
                };
              }
              const value = Reflect.get(object, property, object) as unknown;
              return typeof value === 'function'
                ? value.bind(object)
                : value;
            },
          });
        },
      },
    };

    const persistenceFailure = await applyArchive(plan, adapters);

    expect(persistenceFailure).toMatchObject({
      status: 'recoverable',
      resumed: true,
      journalPath: plan.paths.publishedJournal,
      blockers: [
        expect.objectContaining({
          operation: 'journal',
          path: plan.paths.publishedJournal,
          code: 'EIO',
          message: expect.stringContaining(
            'could not persist its manual-recovery alert'
          ),
        }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
        guidance: expect.stringContaining('Automatic archive resume is disabled'),
      },
    });
    expect(persistenceFailure.recoveryCommand).toBeUndefined();
    expect(await fs.readFile(plan.paths.publishedJournal, 'utf8')).toBe(
      completedJournalBytes
    );
    expect((await readJournal(plan.paths.publishedJournal)).phase).toBe('complete');
    expect((await readJournal(plan.paths.publishedJournal)).integrityFailure).toBeUndefined();
    expect(await fs.readFile(proposal, 'utf8')).toBe(
      '# corrupt after completion\n'
    );

    const retry = await applyArchive(plan, baseAdapters);
    expect(retry).toMatchObject({
      status: 'recoverable',
      resumed: true,
      journalPath: plan.paths.publishedJournal,
      blockers: [
        expect.objectContaining({
          operation: 'accounting',
          path: plan.paths.final,
          code: 'ESTALE',
        }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(retry.recoveryCommand).toBeUndefined();
    const durableJournal = await readJournal(plan.paths.publishedJournal);
    expect(durableJournal).toMatchObject({
      phase: 'complete',
      integrityFailure: {
        operation: 'accounting',
        path: plan.paths.final,
        code: 'ESTALE',
      },
    });
    const durableJournalBytes = await fs.readFile(
      plan.paths.publishedJournal,
      'utf8'
    );

    const repeated = await applyArchive(plan, baseAdapters);
    expect(repeated).toEqual(retry);
    expect(await fs.readFile(plan.paths.publishedJournal, 'utf8')).toBe(
      durableJournalBytes
    );

    const staleFailureWrapper: ArchiveJournal = {
      ...durableJournal,
      phase: 'failed',
      failure: {
        operation: 'journal',
        path: plan.paths.publishedJournal,
        code: 'EIO',
        message: 'historical terminal alert persistence failure',
        resumePhase: 'complete',
      },
    };
    await fs.writeFile(
      plan.paths.publishedJournal,
      `${JSON.stringify(staleFailureWrapper, null, 2)}\n`
    );
    const staleFailureBytes = await fs.readFile(
      plan.paths.publishedJournal,
      'utf8'
    );
    const dominated = await applyArchive(plan, baseAdapters);
    expect(dominated).toEqual(retry);
    expect(dominated.recoveryCommand).toBeUndefined();
    expect(await fs.readFile(plan.paths.publishedJournal, 'utf8')).toBe(
      staleFailureBytes
    );
    expect(await fs.readFile(proposal, 'utf8')).toBe(
      '# corrupt after completion\n'
    );
  });
});
