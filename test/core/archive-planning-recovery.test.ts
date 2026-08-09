import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ARCHIVE_ACCOUNTING_PROJECTION_COLLISION_CODE,
  ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
  ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE,
  ARCHIVE_HANDOFF_PROJECTION_COLLISION_CODE,
  ARCHIVE_OPEN_SPEC_METADATA_INVALID_CODE,
  ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE,
  abortArchivePlan,
  applyArchive,
  createArchivePlan,
  defaultArchiveEngineAdapters,
  hashArchivePlan,
  inspectArchiveJournalState,
  persistArchivePlan,
  resolveArchiveSidecar,
  type ArchiveEngineAdapters,
  type ArchivePlan,
} from '../../src/core/archive-engine.js';

type DeterministicInputKind = 'handoff' | 'accounting' | 'openspec';

const CODE_BY_INPUT: Record<DeterministicInputKind, string> = {
  handoff: ARCHIVE_HANDOFF_PROJECTION_COLLISION_CODE,
  accounting: ARCHIVE_ACCOUNTING_PROJECTION_COLLISION_CODE,
  openspec: ARCHIVE_OPEN_SPEC_METADATA_INVALID_CODE,
};

describe('archive deterministic planning and reservation recovery', () => {
  let root: string;
  let active: string;
  let archiveParent: string;
  let ephemera: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-archive-planning-recovery-'));
    active = path.join(root, 'rasen', 'changes', 'sample');
    archiveParent = path.join(root, 'rasen', 'changes', 'archive');
    ephemera = path.join(root, '.rasen', 'changes', 'sample', 'ephemera');
    await fs.mkdir(path.join(active, 'evidence'), { recursive: true });
    await fs.mkdir(ephemera, { recursive: true });
    await fs.writeFile(path.join(active, 'proposal.md'), '# Sample\n');
    await fs.writeFile(
      path.join(active, 'evidence', 'review-report.md'),
      '# Review\nFindings: 0\n'
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function prepareDeterministicInput(kind: DeterministicInputKind): Promise<void> {
    if (kind === 'handoff') {
      await fs.mkdir(path.join(active, 'handoff'), { recursive: true });
      await fs.mkdir(path.join(active, 'evidence', 'handoff'), { recursive: true });
      await fs.writeFile(path.join(active, 'handoff', 'notes.md'), 'preserve me\n');
      await fs.writeFile(
        path.join(active, 'evidence', 'handoff', 'notes.md'),
        'existing evidence\n'
      );
      await fs.writeFile(
        path.join(active, '.rasen-archive-input.json'),
        JSON.stringify({
          schemaVersion: 1,
          change: 'sample',
          handoff: {
            complete: true,
            decisions: [{ path: 'handoff/notes.md', outcome: 'preserved' }],
          },
          probes: [],
        })
      );
      return;
    }
    if (kind === 'accounting') {
      await fs.writeFile(path.join(active, 'archive.json'), '{"change":"intruder"}\n');
      return;
    }
    await fs.writeFile(path.join(active, '.openspec.yaml'), '- not\n- a\n- mapping\n');
  }

  async function plan(): Promise<ArchivePlan> {
    const sidecar = await resolveArchiveSidecar(active, root, 'sample');
    return createArchivePlan({
      change: 'sample',
      planningRoot: root,
      executionRoot: root,
      activePath: active,
      archiveParent,
      ephemeraPath: ephemera,
      date: '2026-08-09',
      keepEphemera: true,
      validation: 'passed',
      tasks: { total: 1, completed: 1, override: false },
      timing: {
        mode: 'on-merge',
        deliveryMode: 'local',
        override: false,
      },
      specActions: [],
      sidecar,
      transactionId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
  }

  function legacyPlanWithoutBlocker(
    archivePlan: ArchivePlan,
    code: string
  ): ArchivePlan {
    const legacy = structuredClone(archivePlan);
    legacy.blockers = legacy.blockers.filter(blocker => blocker.code !== code);
    legacy.complete = true;
    const { planHash: _ignored, ...withoutHash } = legacy;
    legacy.planHash = hashArchivePlan(withoutHash);
    return legacy;
  }

  it.each([
    ['handoff', 'handoff'],
    ['accounting', 'accounting'],
    ['openspec', 'quality'],
  ] as const)(
    'blocks the %s deterministic input during planning without mutation',
    async (kind, operation) => {
      await prepareDeterministicInput(kind);
      const archivePlan = await plan();

      expect(archivePlan.complete).toBe(false);
      expect(archivePlan.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation,
            code: CODE_BY_INPUT[kind],
          }),
        ])
      );
      await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.access(archivePlan.paths.final)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );

  it('blocks a preserved handoff projection with a non-directory ancestor', async () => {
    await fs.mkdir(path.join(active, 'handoff', 'nested'), { recursive: true });
    await fs.writeFile(
      path.join(active, 'handoff', 'nested', 'notes.md'),
      'preserve me\n'
    );
    await fs.writeFile(path.join(active, 'evidence', 'handoff'), 'not a directory\n');
    await fs.writeFile(
      path.join(active, '.rasen-archive-input.json'),
      JSON.stringify({
        schemaVersion: 1,
        change: 'sample',
        handoff: {
          complete: true,
          decisions: [
            { path: 'handoff/nested/notes.md', outcome: 'preserved' },
          ],
        },
        probes: [],
      })
    );

    const archivePlan = await plan();

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'handoff',
          path: path.join(active, 'evidence', 'handoff'),
          code: ARCHIVE_HANDOFF_PROJECTION_COLLISION_CODE,
        }),
      ])
    );
    await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['handoff', 'accounting', 'openspec'] as const)(
    'classifies a saved pre-blocker %s plan as abort-required before durable mutation',
    async kind => {
      await prepareDeterministicInput(kind);
      const archivePlan = legacyPlanWithoutBlocker(await plan(), CODE_BY_INPUT[kind]);
      const globalDataDir = path.join(root, 'global-data');
      const token = await persistArchivePlan(archivePlan, globalDataDir);

      const result = await applyArchive(archivePlan);

      expect(result).toMatchObject({
        status: 'abort-required',
        abortCommand: `rasen archive --abort-plan ${token} --yes`,
        blockers: [expect.objectContaining({ code: CODE_BY_INPUT[kind] })],
      });
      expect(result).not.toHaveProperty('recoveryCommand');
      await expect(fs.access(archivePlan.paths.stage)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.access(archivePlan.paths.final)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );

  it('blocks a symlinked archive-line ancestor during planning', async () => {
    const outside = path.join(root, 'outside-archive');
    await fs.mkdir(outside);
    await fs.symlink(outside, archiveParent, 'dir');

    const archivePlan = await plan();

    expect(archivePlan.complete).toBe(false);
    expect(archivePlan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'publish',
          path: archiveParent,
          code: ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
        }),
      ])
    );
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('aborts before mutation when a reviewed archive-line ancestor is swapped', async () => {
    await fs.mkdir(archiveParent, { recursive: true });
    const archivePlan = await plan();
    expect(archivePlan.complete).toBe(true);
    const displaced = path.join(root, 'reviewed-archive-line');
    const outside = path.join(root, 'outside-archive');
    await fs.rename(archiveParent, displaced);
    await fs.mkdir(outside);
    await fs.symlink(outside, archiveParent, 'dir');

    const result = await applyArchive(archivePlan);

    expect(result).toMatchObject({
      status: 'abort-required',
      blockers: [
        expect.objectContaining({
          operation: 'publish',
          code: ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
        }),
      ],
    });
    expect(result).not.toHaveProperty('recoveryCommand');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('fails closed on a symlinked archive ancestor for a saved v1 plan', async () => {
    await fs.mkdir(archiveParent, { recursive: true });
    const legacy = structuredClone(await plan()) as ArchivePlan & {
      archivePathAuthority?: ArchivePlan['archivePathAuthority'];
    };
    legacy.schemaVersion = 1;
    Reflect.deleteProperty(legacy, 'archivePathAuthority');
    const { planHash: _ignored, ...withoutHash } = legacy;
    legacy.planHash = hashArchivePlan(withoutHash);
    const displaced = path.join(root, 'legacy-archive-line');
    const outside = path.join(root, 'outside-legacy-archive');
    await fs.rename(archiveParent, displaced);
    await fs.mkdir(outside);
    await fs.symlink(outside, archiveParent, 'dir');

    const result = await applyArchive(legacy);

    expect(result).toMatchObject({
      status: 'abort-required',
      blockers: [
        expect.objectContaining({
          operation: 'publish',
          code: ARCHIVE_DESTINATION_ANCESTRY_INVALID_CODE,
        }),
      ],
    });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('retains owned recovery state when its archive-line ancestry is swapped', async () => {
    await fs.mkdir(archiveParent, { recursive: true });
    const archivePlan = await plan();
    let injected = false;
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        copyFile: async (source, target, flags) => {
          if (!injected) {
            injected = true;
            const error = new Error('injected payload copy failure');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
          return defaultArchiveEngineAdapters.fs.copyFile(source, target, flags);
        },
      },
    };
    expect((await applyArchive(archivePlan, { adapters })).status).toBe(
      'recoverable'
    );
    const displaced = path.join(root, 'owned-archive-line');
    await fs.rename(archiveParent, displaced);
    await fs.symlink(displaced, archiveParent, 'dir');

    const retry = await applyArchive(archivePlan);

    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          operation: 'publish',
          code: ARCHIVE_DESTINATION_ANCESTRY_OWNERSHIP_CODE,
        }),
      ],
      manualRecoveryAction: expect.objectContaining({
        kind: 'manual-recovery-required',
      }),
      retainedPaths: expect.arrayContaining([
        archivePlan.paths.stage,
        archivePlan.paths.final,
        archivePlan.paths.journal,
      ]),
    });
    expect(retry).not.toHaveProperty('recoveryCommand');
    await expect(fs.access(path.join(displaced, path.basename(archivePlan.paths.stage)))).resolves.toBeUndefined();
  });

  it('resumes an empty final directory created after durable reservation intent', async () => {
    const archivePlan = await plan();
    let injected = false;
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        mkdir: async (target, options) => {
          const result = await defaultArchiveEngineAdapters.fs.mkdir(target, options);
          if (target === archivePlan.paths.final && !injected) {
            injected = true;
            const error = new Error('injected failure after final mkdir');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
          return result;
        },
      },
    };

    const interrupted = await applyArchive(archivePlan, { adapters });
    expect(interrupted).toMatchObject({
      status: 'recoverable',
      recoveryCommand: `rasen archive --apply-plan archive-v1:${archivePlan.transactionId}:${archivePlan.planHash} --yes`,
      blockers: [expect.objectContaining({ code: 'EIO' })],
    });
    expect(await fs.readdir(archivePlan.paths.final)).toEqual([]);
    const retained = JSON.parse(await fs.readFile(archivePlan.paths.journal, 'utf8'));
    expect(retained.finalReservation).toMatchObject({
      state: 'intent-durable',
      identity: null,
      entries: [],
    });

    const wrapperState = await inspectArchiveJournalState(archivePlan);
    expect(wrapperState).toMatchObject({
      journalPath: archivePlan.paths.journal,
      journal: {
        finalReservation: {
          state: 'intent-durable',
          identity: null,
          entries: [],
        },
      },
    });
    const resumed = await applyArchive(archivePlan);
    expect(resumed).toMatchObject({
      status: 'complete',
      resumed: true,
    });
    await expect(fs.access(path.join(archivePlan.paths.final, 'archive.json'))).resolves.toBeUndefined();
  });

  it.each(['file', 'directory', 'symlink'] as const)(
    'adopts an exactly matching %s created after durable entry intent',
    async kind => {
      const relative = `resume-${kind}`;
      const source = path.join(active, relative);
      if (kind === 'file') {
        await fs.writeFile(source, 'payload\n');
      } else if (kind === 'directory') {
        await fs.mkdir(source);
      } else {
        await fs.symlink('proposal.md', source);
      }
      const archivePlan = await plan();
      let injected = false;
      const target = path.join(archivePlan.paths.final, relative);
      const failAfterCreation = (candidate: string): void => {
        if (candidate !== target || injected) return;
        injected = true;
        throw Object.assign(
          new Error('injected crash after reserved entry creation'),
          { code: 'EIO' }
        );
      };
      const adapters: ArchiveEngineAdapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          copyFile: async (from, to, flags) => {
            await defaultArchiveEngineAdapters.fs.copyFile(from, to, flags);
            if (kind === 'file') failAfterCreation(to);
          },
          mkdir: async (candidate, options) => {
            await defaultArchiveEngineAdapters.fs.mkdir(candidate, options);
            if (kind === 'directory') failAfterCreation(candidate);
          },
          symlink: async (linkTarget, candidate, type) => {
            await defaultArchiveEngineAdapters.fs.symlink(
              linkTarget,
              candidate,
              type
            );
            if (kind === 'symlink') failAfterCreation(candidate);
          },
        },
      };

      expect((await applyArchive(archivePlan, { adapters })).status).toBe(
        'recoverable'
      );
      const retained = JSON.parse(
        await fs.readFile(archivePlan.paths.publishedJournal, 'utf8')
      );
      expect(
        retained.finalReservation.entries.find(
          (entry: { path: string }) => entry.path === relative
        )
      ).toMatchObject({ state: 'intent' });

      expect(await applyArchive(archivePlan)).toMatchObject({
        status: 'complete',
        resumed: true,
      });
    }
  );

  it('requires manual recovery when an intent-created file payload mismatches', async () => {
    const relative = 'resume-mismatch.txt';
    await fs.writeFile(path.join(active, relative), 'planned\n');
    const archivePlan = await plan();
    let injected = false;
    const target = path.join(archivePlan.paths.final, relative);
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        copyFile: async (from, to, flags) => {
          await defaultArchiveEngineAdapters.fs.copyFile(from, to, flags);
          if (to === target && !injected) {
            injected = true;
            throw Object.assign(
              new Error('injected crash after reserved file creation'),
              { code: 'EIO' }
            );
          }
        },
      },
    };
    expect((await applyArchive(archivePlan, { adapters })).status).toBe(
      'recoverable'
    );
    await fs.writeFile(path.join(archivePlan.paths.final, relative), 'changed\n');

    const retry = await applyArchive(archivePlan);
    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: 'archive_reservation_ownership_unverified',
        }),
      ],
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([
        archivePlan.paths.stage,
        archivePlan.paths.final,
        archivePlan.paths.publishedJournal,
      ]),
    });
    expect(retry).not.toHaveProperty('recoveryCommand');
  });

  it('stops manually on an empty stage left before its initial journal', async () => {
    const archivePlan = await plan();
    const journalTemporary = `.${path.basename(archivePlan.paths.journal)}.tmp-${archivePlan.transactionId}`;
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        open: async (target, flags, mode) => {
          if (target.endsWith(journalTemporary)) {
            throw Object.assign(new Error('injected pre-journal crash'), {
              code: 'EIO',
            });
          }
          return defaultArchiveEngineAdapters.fs.open(target, flags, mode);
        },
      },
    };
    expect((await applyArchive(archivePlan, { adapters })).status).toBe(
      'recoverable'
    );

    const retry = await applyArchive(archivePlan);
    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({ code: 'archive_stage_ownership_unverified' }),
      ],
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([archivePlan.paths.stage]),
    });
    expect(retry).not.toHaveProperty('recoveryCommand');
    expect(retry).not.toHaveProperty('abortCommand');
  });

  it.each([
    ['initial', 1],
    ['update', 2],
  ] as const)(
    'cleans a failed %s journal publication and resumes from durable state',
    async (_boundary, failingPublication) => {
      const archivePlan = await plan();
      const journalTemporary = path.join(
        path.dirname(archivePlan.paths.journal),
        `.${path.basename(archivePlan.paths.journal)}.tmp-${archivePlan.transactionId}`
      );
      let journalPublications = 0;
      const adapters: ArchiveEngineAdapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          link: async (from, to) => {
            if (
              to === archivePlan.paths.journal &&
              ++journalPublications === failingPublication
            ) {
              throw Object.assign(new Error('injected journal link crash'), {
                code: 'EIO',
              });
            }
            await defaultArchiveEngineAdapters.fs.link(from, to);
          },
        },
      };

      const failed = await applyArchive(archivePlan, { adapters });
      expect(failed).toMatchObject({
        status: 'recoverable',
        blockers: [
          expect.objectContaining({
            operation: 'journal',
            code: 'EIO',
          }),
        ],
      });
      expect(failed).not.toHaveProperty('manualRecoveryAction');
      await expect(fs.access(journalTemporary)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(applyArchive(archivePlan)).resolves.toMatchObject({
        status: 'complete',
      });
    }
  );

  it.each(['pre-link', 'post-link'] as const)(
    'classifies a marker %s publication crash by retained ownership state',
    async boundary => {
      const archivePlan = await plan();
      const marker = path.join(
        archivePlan.paths.final,
        '.rasen-archive-published.json'
      );
      const markerTemporary = path.join(
        archivePlan.paths.final,
        `..rasen-archive-published.json.tmp-${archivePlan.transactionId}`
      );
      const adapters: ArchiveEngineAdapters = {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          link: async (from, to) => {
            if (boundary === 'pre-link' && to === marker) {
              throw Object.assign(new Error('injected marker link crash'), {
                code: 'EIO',
              });
            }
            await defaultArchiveEngineAdapters.fs.link(from, to);
          },
          rename: async (from, to) => {
            if (boundary === 'post-link' && from === markerTemporary) {
              throw Object.assign(new Error('injected marker claim crash'), {
                code: 'EIO',
              });
            }
            await defaultArchiveEngineAdapters.fs.rename(from, to);
          },
        },
      };

      const failed = await applyArchive(archivePlan, { adapters });
      expect(failed).toMatchObject({
        status: 'recoverable',
        blockers: [
          expect.objectContaining(
            boundary === 'pre-link'
              ? { operation: 'publish', code: 'EIO' }
              : {
                  operation: 'publish',
                  code: 'archive_claim_ownership_unverified',
                }
          ),
        ],
        ...(boundary === 'post-link'
          ? {
              manualRecoveryAction: { kind: 'manual-recovery-required' },
            }
          : {}),
      });
      if (boundary === 'pre-link') {
        expect(failed).not.toHaveProperty('manualRecoveryAction');
        await expect(fs.access(markerTemporary)).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(applyArchive(archivePlan)).resolves.toMatchObject({
          status: 'complete',
        });
      } else {
        await expect(fs.access(markerTemporary)).resolves.toBeUndefined();
        expect(failed).not.toHaveProperty('recoveryCommand');
        await expect(applyArchive(archivePlan)).resolves.toMatchObject({
          blockers: [
            expect.objectContaining({
              code: ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE,
            }),
          ],
          manualRecoveryAction: { kind: 'manual-recovery-required' },
        });
      }
    }
  );

  it('returns manual recovery for an unjournaled abort tombstone temporary', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-abort-temp');
    await persistArchivePlan(archivePlan, globalDataDir);
    const temporary = path.join(
      globalDataDir,
      'archive-transactions',
      archivePlan.transactionId,
      `.abort.json.tmp-${archivePlan.transactionId}`
    );
    await fs.writeFile(temporary, 'partial tombstone\n');

    const result = await abortArchivePlan(archivePlan, globalDataDir);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE,
        }),
      ],
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([temporary]),
    });
    await expect(fs.access(temporary)).resolves.toBeUndefined();
    expect(result).not.toHaveProperty('recoveryCommand');
  });

  it('blocks deterministic and legacy transaction scratch debris', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'global-data');
    await persistArchivePlan(archivePlan, globalDataDir);
    await fs.mkdir(archivePlan.paths.archiveParent, { recursive: true });
    const scratch = path.join(
      archivePlan.paths.archiveParent,
      `.rasen-archive-projection-${archivePlan.transactionId}-legacy`
    );
    await fs.mkdir(scratch);
    const abortResult = await abortArchivePlan(
      archivePlan,
      globalDataDir
    );
    expect(abortResult).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE,
        }),
      ],
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([scratch]),
    });
    expect(abortResult).not.toHaveProperty('recoveryCommand');
    await expect(fs.access(scratch)).resolves.toBeUndefined();


    const result = await applyArchive(archivePlan);
    expect(result).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: ARCHIVE_TRANSACTION_TEMP_OWNERSHIP_CODE,
        }),
      ],
      manualRecoveryAction: { kind: 'manual-recovery-required' },
      retainedPaths: expect.arrayContaining([scratch]),
    });
    await expect(fs.access(scratch)).resolves.toBeUndefined();
    expect(result).not.toHaveProperty('recoveryCommand');
  });

  it('never adopts or deletes non-empty final contents left beside matching intent', async () => {
    const archivePlan = await plan();
    const globalDataDir = path.join(root, 'occupied-reservation-global');
    await persistArchivePlan(archivePlan, globalDataDir);
    const intruder = path.join(archivePlan.paths.final, 'unrelated.txt');
    let injected = false;
    const adapters: ArchiveEngineAdapters = {
      ...defaultArchiveEngineAdapters,
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        mkdir: async (target, options) => {
          const result = await defaultArchiveEngineAdapters.fs.mkdir(target, options);
          if (target === archivePlan.paths.final && !injected) {
            injected = true;
            await fs.writeFile(intruder, 'must survive\n');
            const error = new Error('injected occupied final reservation');
            (error as NodeJS.ErrnoException).code = 'EIO';
            throw error;
          }
          return result;
        },
      },
    };

    const interrupted = await applyArchive(archivePlan, { adapters });
    expect(interrupted).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: 'archive_reservation_ownership_unverified',
        }),
      ],
      manualRecoveryAction: expect.objectContaining({
        kind: 'manual-recovery-required',
      }),
    });
    expect(interrupted).not.toHaveProperty('recoveryCommand');
    expect(await fs.readFile(intruder, 'utf8')).toBe('must survive\n');

    const retry = await applyArchive(archivePlan);
    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: 'archive_reservation_ownership_unverified',
        }),
      ],
      manualRecoveryAction: expect.objectContaining({
        kind: 'manual-recovery-required',
      }),
    });
    expect(retry).not.toHaveProperty('recoveryCommand');
    expect(retry).not.toHaveProperty('abortCommand');
    expect(await fs.readFile(intruder, 'utf8')).toBe('must survive\n');
    await expect(
      abortArchivePlan(archivePlan, globalDataDir)
    ).resolves.toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({ code: 'archive_abort_phase_unsafe' }),
      ],
    });
    expect(await fs.readFile(intruder, 'utf8')).toBe('must survive\n');
  });
});
