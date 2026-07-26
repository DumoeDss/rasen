import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  exportKnowledgeBundle,
  resolveKnowledgeBundleDestination,
  resolveKnowledgeBundleStagingDirectoryPrefix,
  type ExportKnowledgeBundleOptions,
} from '../../../src/core/knowledge-bundle/export.js';
import {
  KnowledgeBundleMachinePathError,
  readKnowledgeBundle,
} from '../../../src/core/knowledge-bundle/schema.js';
import {
  digestContent,
  serializeManifest,
} from '../../../src/core/learned-skills/catalog.js';
import type {
  CanonicalLearnedSkill,
  LearnedSkillManifestV2,
} from '../../../src/core/learned-skills/types.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-07-26T02:00:00.000Z';
const BASE_COMMIT = 'a'.repeat(40);

interface TreeEntry {
  path: string;
  type: 'directory' | 'file';
  bytes?: string;
}

function snapshotTree(root: string): TreeEntry[] {
  if (!fs.existsSync(root)) return [];
  const found: TreeEntry[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        found.push({ path: relative, type: 'directory' });
        walk(fullPath);
      } else {
        found.push({
          path: relative,
          type: 'file',
          bytes: fs.readFileSync(fullPath).toString('base64'),
        });
      }
    }
  };
  walk(root);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

describe('project knowledge bundle export', () => {
  let tempRoot: string;
  let globalDataDir: string;
  let checkoutOne: string;
  let checkoutTwo: string;
  let outputDir: string;

  beforeEach(() => {
    tempRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-export-'))
    );
    globalDataDir = path.join(tempRoot, 'machine-data');
    checkoutOne = path.join(tempRoot, 'checkout-one');
    checkoutTwo = path.join(tempRoot, 'checkout-two');
    outputDir = path.join(tempRoot, 'exports');
    for (const root of [checkoutOne, checkoutTwo, outputDir]) {
      fs.mkdirSync(root, { recursive: true });
    }
    fs.mkdirSync(path.join(checkoutOne, 'rasen'), { recursive: true });
    fs.mkdirSync(path.join(checkoutTwo, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(checkoutOne, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${PROJECT_ID}\n`
    );
    fs.writeFileSync(
      path.join(checkoutTwo, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${PROJECT_ID}\n`
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function manifest(
    id: string,
    overrides: Partial<LearnedSkillManifestV2> = {},
    ownerProjectId = PROJECT_ID
  ): LearnedSkillManifestV2 {
    const content = canonicalContent(id);
    return {
      version: 2,
      scope: 'project',
      owner: { type: 'project', projectId: ownerProjectId },
      id,
      knowledgeKey: `${id}-key`,
      status: 'active',
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(content),
      description: `Portable guidance for ${id}.`,
      applicability: { mode: 'all', markers: ['package.json'] },
      evidence: [],
      sources: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...overrides,
    };
  }

  function canonicalContent(id: string): string {
    return `---\nname: ${id}\n---\n\nUse portable guidance.\n`;
  }

  function writeProjectRecord(
    id: string,
    overrides: Partial<LearnedSkillManifestV2> = {},
    ownerProjectId = PROJECT_ID
  ): string {
    const home = resolveProjectKnowledgeHome(ownerProjectId, { globalDataDir });
    const directory = path.join(home.catalogDir, id);
    const managed = manifest(id, overrides, home.projectId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'learned-skill.yaml'), serializeManifest(managed));
    fs.writeFileSync(path.join(directory, 'SKILL.md'), canonicalContent(id));
    return directory;
  }

  function options(
    project: string,
    to: string,
    overrides: ExportKnowledgeBundleOptions['dependencies'] = {}
  ): ExportKnowledgeBundleOptions {
    return {
      project,
      to,
      dependencies: {
        resolveProject: async (selector) => {
          if (selector !== PROJECT_ID && selector !== checkoutOne && selector !== checkoutTwo) {
            return null;
          }
          const root = selector === checkoutTwo ? checkoutTwo : checkoutOne;
          return {
            root,
            ref: { projectId: PROJECT_ID, name: 'portable-project', root },
          };
        },
        resolveKnowledgeHome: (projectId) =>
          resolveProjectKnowledgeHome(projectId, { globalDataDir }),
        readBaseProjectCommit: async () => BASE_COMMIT,
        bundleId: randomUUID,
        now: () => new Date(CREATED_AT),
        ...overrides,
      },
    };
  }

  it('exports two checkouts under one permanent identity and never serializes either root', async () => {
    writeProjectRecord('shared-record');
    const firstPath = path.join(outputDir, 'first.bundle.json');
    const secondPath = path.join(outputDir, 'second.bundle.json');

    const first = await exportKnowledgeBundle(options(checkoutOne, firstPath));
    const second = await exportKnowledgeBundle(options(checkoutTwo, secondPath));

    expect(first.projectId).toBe(PROJECT_ID);
    expect(second.projectId).toBe(PROJECT_ID);
    for (const destination of [firstPath, secondPath]) {
      const serialized = fs.readFileSync(destination, 'utf8');
      expect(serialized).not.toContain(checkoutOne);
      expect(serialized).not.toContain(checkoutTwo);
      expect(readKnowledgeBundle(destination).projectId).toBe(PROJECT_ID);
    }
  });

  it.each([
    ['id selector', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],
    ['root selector', 'checkout-root'],
  ])(
    'uses the canonical home identity throughout export for an uppercase registry id via %s',
    async (_label, selector) => {
      const canonicalProjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const registryProjectId = canonicalProjectId.toUpperCase();
      writeProjectRecord('normalized-project-record', {}, canonicalProjectId);
      const requestedSelector = selector === 'checkout-root' ? checkoutOne : selector;
      const destination = path.join(
        outputDir,
        `${selector === 'checkout-root' ? 'root' : 'id'}-normalized.bundle.json`
      );
      let resolvedHome: ReturnType<typeof resolveProjectKnowledgeHome> | undefined;

      const result = await exportKnowledgeBundle(
        options(requestedSelector, destination, {
          resolveProject: async (receivedSelector) => {
            expect(receivedSelector).toBe(requestedSelector);
            return {
              root: checkoutOne,
              ref: {
                projectId: registryProjectId,
                name: 'uppercase-registry-project',
                root: checkoutOne,
              },
            };
          },
          resolveKnowledgeHome: (projectId) => {
            resolvedHome = resolveProjectKnowledgeHome(projectId, { globalDataDir });
            return resolvedHome;
          },
        })
      );
      const parsed = readKnowledgeBundle(destination);

      expect(resolvedHome).toMatchObject({ projectId: canonicalProjectId });
      expect(path.basename(resolvedHome!.root)).toBe(canonicalProjectId);
      expect(result.projectId).toBe(canonicalProjectId);
      expect(result.bundle.projectId).toBe(canonicalProjectId);
      expect(parsed.projectId).toBe(canonicalProjectId);
      expect(parsed.records[0]!.manifest).toMatchObject({
        owner: { type: 'project', projectId: canonicalProjectId },
      });
    }
  );

  it('preserves retired status and records an unavailable base commit honestly', async () => {
    writeProjectRecord('retired-record', {
      status: 'retired',
      retiredAt: CREATED_AT,
      retirementReason: 'Superseded by a safer rule.',
    });
    const destination = path.join(outputDir, 'retired.bundle.json');

    const result = await exportKnowledgeBundle(
      options(PROJECT_ID, destination, {
        readBaseProjectCommit: async () => null,
      })
    );
    const parsed = readKnowledgeBundle(destination);

    expect(result.warnings).toEqual(['base_project_commit_unavailable']);
    expect(parsed.baseProjectCommit).toBeNull();
    expect(parsed.records[0]!.manifest.status).toBe('retired');
    expect(parsed.records[0]!.manifest.retirementReason).toBe(
      'Superseded by a safer rule.'
    );
  });

  it('reads only project-owned canonical records and leaves generated, ownership, Store, and transient state out', async () => {
    writeProjectRecord('project-record');
    const storeRoot = path.join(tempRoot, 'team-store');
    const globalCatalog = path.join(globalDataDir, 'learned-skills');
    const storeCatalog = path.join(storeRoot, 'rasen', 'learned-skills');
    fs.mkdirSync(path.join(globalCatalog, 'global-record'), { recursive: true });
    fs.mkdirSync(path.join(storeCatalog, 'store-record'), { recursive: true });
    fs.writeFileSync(path.join(globalCatalog, 'global-record', 'secret.txt'), 'global-only');
    fs.writeFileSync(path.join(storeCatalog, 'store-record', 'secret.txt'), 'store-only');
    fs.mkdirSync(path.join(checkoutOne, '.claude', 'skills', 'project-record'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(checkoutOne, '.claude', 'skills', 'project-record', 'SKILL.md'),
      'generated-tool-file-marker'
    );
    fs.mkdirSync(path.join(checkoutOne, '.rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(checkoutOne, '.rasen', 'learned-skills.json'),
      JSON.stringify({ ownedPath: path.join(checkoutOne, '.claude', 'skills') })
    );
    fs.writeFileSync(
      path.join(globalDataDir, 'session-state.json'),
      JSON.stringify({ token: 'token-marker', session: 'session-marker', run: 'run-marker' })
    );

    const destination = path.join(outputDir, 'whitelist.bundle.json');
    await exportKnowledgeBundle(options(PROJECT_ID, destination));
    const serialized = fs.readFileSync(destination, 'utf8');
    const parsed = readKnowledgeBundle(destination);

    expect(parsed.records.map((record) => record.id)).toEqual(['project-record']);
    for (const excluded of [
      'global-record',
      'store-record',
      'generated-tool-file-marker',
      'ownedPath',
      'token-marker',
      'session-marker',
      'run-marker',
    ]) {
      expect(serialized).not.toContain(excluded);
    }
  });

  it.each(['file', 'directory'] as const)(
    'refuses an occupied %s before reads and changes nothing',
    async (kind) => {
      writeProjectRecord('occupied-record');
      const destination = path.join(outputDir, 'occupied.bundle.json');
      if (kind === 'file') fs.writeFileSync(destination, 'existing bytes');
      else fs.mkdirSync(destination);
      const before = snapshotTree(outputDir);
      let reads = 0;

      await expect(
        exportKnowledgeBundle(
          options(PROJECT_ID, destination, {
            readBaseProjectCommit: async () => {
              reads += 1;
              return BASE_COMMIT;
            },
          })
        )
      ).rejects.toMatchObject({ code: 'knowledge_bundle_destination_occupied' });

      expect(reads).toBe(0);
      expect(snapshotTree(outputDir)).toEqual(before);
    }
  );

  it('rejects a non-portable record before opening a destination-side temporary file', async () => {
    writeProjectRecord('non-portable-record', {
      applicability: { mode: 'all', markers: [String.raw`C:\Users\alice\project`] },
    });
    const destination = path.join(outputDir, 'non-portable.bundle.json');
    let opened = 0;

    await expect(
      exportKnowledgeBundle(
        options(PROJECT_ID, destination, {
          io: {
            openExclusive: () => {
              opened += 1;
              throw new Error('must not open');
            },
          },
        })
      )
    ).rejects.toBeInstanceOf(KnowledgeBundleMachinePathError);

    expect(opened).toBe(0);
    expect(snapshotTree(outputDir)).toEqual([]);
  });

  it('rejects a schema-invalid canonical record before opening a destination-side temporary file', async () => {
    const managed = manifest('schema-invalid-record', {
      contentDigest: `sha256:${'b'.repeat(64)}`,
    });
    const invalidRecord: CanonicalLearnedSkill = {
      identity: {
        owner: managed.owner,
        id: managed.id,
      },
      manifest: managed,
      scope: 'project',
      directory: path.join(tempRoot, 'injected-schema-invalid-record'),
      content: canonicalContent(managed.id),
      evidence: [],
    };
    const destination = path.join(outputDir, 'schema-invalid.bundle.json');
    let opened = 0;

    await expect(
      exportKnowledgeBundle(
        options(PROJECT_ID, destination, {
          readCatalog: () => ({ records: [invalidRecord], unreadable: [] }),
          io: {
            openExclusive: () => {
              opened += 1;
              throw new Error('must not open');
            },
          },
        })
      )
    ).rejects.toThrow(/canonical content must match/i);

    expect(opened).toBe(0);
    expect(snapshotTree(outputDir)).toEqual([]);
  });

  it('refuses a Rasen-authored unreadable record and writes nothing', async () => {
    const directory = writeProjectRecord('unreadable-record');
    const manifestPath = path.join(directory, 'learned-skill.yaml');
    fs.appendFileSync(manifestPath, 'unknownField: true\n');
    const destination = path.join(outputDir, 'unreadable.bundle.json');

    await expect(
      exportKnowledgeBundle(options(PROJECT_ID, destination))
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_record_unreadable',
      details: { recordId: 'unreadable-record' },
    });
    expect(snapshotTree(outputDir)).toEqual([]);
  });

  it.each([
    [
      'write',
      {
        write: () => {
          throw Object.assign(new Error('injected write failure'), { code: 'EIO' });
        },
      },
    ],
    [
      'publication',
      {
        publishNewFile: () => {
          throw Object.assign(new Error('injected publication failure'), { code: 'EIO' });
        },
      },
    ],
  ] as const)('cleans its owned temporary after an injected %s failure', async (_name, io) => {
    writeProjectRecord('failure-record');
    const destination = path.join(outputDir, 'failure.bundle.json');
    const before = snapshotTree(outputDir);

    await expect(
      exportKnowledgeBundle(options(PROJECT_ID, destination, { io }))
    ).rejects.toMatchObject({ code: 'knowledge_bundle_write_failed' });

    expect(snapshotTree(outputDir)).toEqual(before);
  });

  it('preserves a foreign file that collides inside the private staging directory', async () => {
    writeProjectRecord('staging-collision-record');
    const destination = path.join(outputDir, 'collision.bundle.json');
    const bundleId = '33333333-3333-4333-8333-333333333333';
    const stagingDirectory = `${resolveKnowledgeBundleStagingDirectoryPrefix(
      destination,
      bundleId
    )}collision`;
    const staging = path.join(stagingDirectory, 'bundle.tmp');
    const sentinel = Buffer.from('foreign staging bytes\0must survive', 'utf8');
    const before = snapshotTree(outputDir);

    await expect(
      exportKnowledgeBundle(
        options(PROJECT_ID, destination, {
          bundleId: () => bundleId,
          io: {
            createPrivateDirectory: () => {
              fs.mkdirSync(stagingDirectory, { mode: 0o700 });
              fs.writeFileSync(staging, sentinel);
              return stagingDirectory;
            },
          },
        })
      )
    ).rejects.toMatchObject({ code: 'knowledge_bundle_write_failed' });

    expect(snapshotTree(outputDir)).toEqual(before);
    expect(fs.readFileSync(staging)).toEqual(sentinel);
  });

  it('commits the destination with a warning when external staging cleanup fails', async () => {
    writeProjectRecord('cleanup-failure-record');
    const destination = path.join(outputDir, 'cleanup-failure.bundle.json');
    const bundleId = '44444444-4444-4444-8444-444444444444';
    const stagingDirectory = `${resolveKnowledgeBundleStagingDirectoryPrefix(
      destination,
      bundleId
    )}cleanup`;
    const staging = path.join(stagingDirectory, 'bundle.tmp');

    const result = await exportKnowledgeBundle(
      options(PROJECT_ID, destination, {
        bundleId: () => bundleId,
        io: {
          createPrivateDirectory: () => {
            fs.mkdirSync(stagingDirectory, { mode: 0o700 });
            return stagingDirectory;
          },
          removeOwnedFile: (target) => {
            if (target === staging) {
              throw Object.assign(new Error('injected staging cleanup failure'), {
                code: 'EPERM',
              });
            }
            fs.unlinkSync(target);
          },
        },
      })
    );

    expect(result.warnings).toEqual(['staging_cleanup_deferred']);
    expect(snapshotTree(outputDir)).toEqual([
      {
        path: path.basename(destination),
        type: 'file',
        bytes: fs.readFileSync(destination).toString('base64'),
      },
    ]);
    expect(readKnowledgeBundle(destination).projectId).toBe(PROJECT_ID);
    expect(fs.existsSync(staging)).toBe(true);
  });

  it('refuses publication when the private staging pathname changes before hard-linking', async () => {
    writeProjectRecord('pre-publication-mismatch-record');
    const destination = path.join(outputDir, 'pre-publication-mismatch.bundle.json');
    const bundleId = '55555555-5555-4555-8555-555555555555';
    const stagingDirectory = `${resolveKnowledgeBundleStagingDirectoryPrefix(
      destination,
      bundleId
    )}before-publication`;
    const staging = path.join(stagingDirectory, 'bundle.tmp');
    const foreignBytes = Buffer.from('foreign pre-publication replacement', 'utf8');
    const removalAttempts: string[] = [];

    await expect(
      exportKnowledgeBundle(
        options(PROJECT_ID, destination, {
          bundleId: () => bundleId,
          io: {
            createPrivateDirectory: () => {
              fs.mkdirSync(stagingDirectory, { mode: 0o700 });
              return stagingDirectory;
            },
            pathOwnsOpenFile: () => {
              fs.unlinkSync(staging);
              fs.writeFileSync(staging, foreignBytes, { flag: 'wx' });
              return false;
            },
            removeOwnedFile: (target) => {
              removalAttempts.push(target);
              fs.unlinkSync(target);
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_write_failed',
      details: {
        reason: 'staging pathname ownership changed before publication',
      },
    });

    expect(removalAttempts).toEqual([]);
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.readFileSync(staging)).toEqual(foreignBytes);
  });

  it('preserves a foreign staging replacement detected before cleanup', async () => {
    writeProjectRecord('cleanup-mismatch-record');
    const destination = path.join(outputDir, 'cleanup-mismatch.bundle.json');
    const bundleId = '77777777-7777-4777-8777-777777777777';
    const stagingDirectory = `${resolveKnowledgeBundleStagingDirectoryPrefix(
      destination,
      bundleId
    )}before-cleanup`;
    const staging = path.join(stagingDirectory, 'bundle.tmp');
    const foreignBytes = Buffer.from('foreign cleanup replacement must survive', 'utf8');
    const removalAttempts: string[] = [];
    let ownershipChecks = 0;

    const result = await exportKnowledgeBundle(
      options(PROJECT_ID, destination, {
        bundleId: () => bundleId,
        io: {
          createPrivateDirectory: () => {
            fs.mkdirSync(stagingDirectory, { mode: 0o700 });
            return stagingDirectory;
          },
          pathOwnsOpenFile: () => {
            ownershipChecks += 1;
            if (ownershipChecks === 2) {
              fs.unlinkSync(staging);
              fs.writeFileSync(staging, foreignBytes, { flag: 'wx' });
              return false;
            }
            return true;
          },
          removeOwnedFile: (target) => {
            removalAttempts.push(target);
            fs.unlinkSync(target);
          },
        },
      })
    );

    expect(result.warnings).toEqual(['staging_cleanup_deferred']);
    expect(ownershipChecks).toBe(2);
    expect(removalAttempts).toEqual([]);
    expect(readKnowledgeBundle(destination).projectId).toBe(PROJECT_ID);
    expect(fs.readFileSync(staging)).toEqual(foreignBytes);
    expect(fs.existsSync(staging)).toBe(true);
  });

  it('does not replace a destination created concurrently with publication', async () => {
    writeProjectRecord('publication-race-record');
    const destination = path.join(outputDir, 'publication-race.bundle.json');
    const foreignBytes = Buffer.from('concurrent creator bytes', 'utf8');

    await expect(
      exportKnowledgeBundle(
        options(PROJECT_ID, destination, {
          io: {
            publishNewFile: (temporary, target) => {
              fs.writeFileSync(target, foreignBytes, { flag: 'wx' });
              fs.linkSync(temporary, target);
            },
          },
        })
      )
    ).rejects.toMatchObject({ code: 'knowledge_bundle_destination_occupied' });

    expect(fs.readFileSync(destination)).toEqual(foreignBytes);
    expect(snapshotTree(outputDir)).toEqual([
      {
        path: path.basename(destination),
        type: 'file',
        bytes: foreignBytes.toString('base64'),
      },
    ]);
  });

  it('refuses a filesystem-root destination before creating staging', () => {
    const root = path.parse(outputDir).root;
    const destination = path.join(root, 'root.bundle.json');
    let error: unknown;

    try {
      resolveKnowledgeBundleStagingDirectoryPrefix(
        destination,
        '66666666-6666-4666-8666-666666666666'
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'knowledge_bundle_write_failed',
      details: {
        reason: 'the destination directory has no external sibling staging location',
      },
    });
  });

  it('refuses a simulated mount boundary before opening cross-filesystem staging', async () => {
    writeProjectRecord('mount-boundary-record');
    const destination = path.join(outputDir, 'mount-boundary.bundle.json');
    let opened = 0;

    await expect(
      exportKnowledgeBundle(
        options(PROJECT_ID, destination, {
          io: {
            sameFileSystem: () => false,
            openExclusive: () => {
              opened += 1;
              throw new Error('must not open cross-filesystem staging');
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_write_failed',
      details: { reason: 'the external staging location is on a different filesystem' },
    });

    expect(opened).toBe(0);
    expect(snapshotTree(outputDir)).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')(
    'creates staging in an owner-private directory',
    async () => {
      writeProjectRecord('private-staging-record');
      const destination = path.join(outputDir, 'private-staging.bundle.json');
      let observedMode: number | undefined;

      await exportKnowledgeBundle(
        options(PROJECT_ID, destination, {
          io: {
            openExclusive: (target) => {
              observedMode = fs.statSync(path.dirname(target)).mode & 0o777;
              return fs.openSync(target, 'wx', 0o600);
            },
          },
        })
      );

      expect(observedMode).toBe(0o700);
      expect(snapshotTree(outputDir).map((entry) => entry.path)).toEqual([
        path.basename(destination),
      ]);
    }
  );

  it('success adds exactly one named file while every source stays byte-identical', async () => {
    writeProjectRecord('first-record');
    writeProjectRecord('second-record');
    fs.writeFileSync(path.join(checkoutOne, 'source.txt'), 'checkout bytes\n');
    fs.mkdirSync(globalDataDir, { recursive: true });
    fs.writeFileSync(path.join(globalDataDir, 'projects.json'), 'registration bytes\n');
    const beforeOutput = snapshotTree(outputDir);
    const beforeCheckout = snapshotTree(checkoutOne);
    const beforeMachineData = snapshotTree(globalDataDir);
    const destination = path.join(outputDir, 'portable.bundle.json');

    const result = await exportKnowledgeBundle(options(PROJECT_ID, destination));

    expect(snapshotTree(outputDir)).toEqual([
      ...beforeOutput,
      {
        path: path.basename(destination),
        type: 'file',
        bytes: fs.readFileSync(destination).toString('base64'),
      },
    ]);
    expect(snapshotTree(checkoutOne)).toEqual(beforeCheckout);
    expect(snapshotTree(globalDataDir)).toEqual(beforeMachineData);
    expect(result).toMatchObject({
      projectId: PROJECT_ID,
      recordCount: 2,
      destination: fs.realpathSync.native(destination),
      warnings: [],
    });
  });

  it('the reader accepts the produced bundle and remains non-writing', async () => {
    writeProjectRecord('reader-record');
    const destination = path.join(outputDir, 'reader.bundle.json');
    await exportKnowledgeBundle(options(PROJECT_ID, destination));
    const before = snapshotTree(tempRoot);

    const parsed = readKnowledgeBundle(destination);

    expect(parsed.records.map((record) => record.id)).toEqual(['reader-record']);
    expect(snapshotTree(tempRoot)).toEqual(before);
  });

  it.runIf(process.platform === 'win32')(
    'refuses an occupied destination spelled with drive-letter case and separator differences',
    async () => {
      writeProjectRecord('windows-record');
      const destination = path.join(outputDir, 'windows.bundle.json');
      fs.writeFileSync(destination, 'occupied');
      const alternate = destination
        .replace(/^([A-Z]):/u, (_match, drive: string) => `${drive.toLowerCase()}:`)
        .replaceAll(path.sep, '/');
      const before = snapshotTree(outputDir);

      expect(resolveKnowledgeBundleDestination(alternate).toLocaleLowerCase()).toBe(
        fs.realpathSync.native(destination).toLocaleLowerCase()
      );
      await expect(
        exportKnowledgeBundle(options(PROJECT_ID, alternate))
      ).rejects.toMatchObject({ code: 'knowledge_bundle_destination_occupied' });
      expect(snapshotTree(outputDir)).toEqual(before);
    }
  );
});
