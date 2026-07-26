import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  exportKnowledgeBundle,
  KnowledgeBundleExportError,
  resolveKnowledgeBundleStoreDestination,
  resolveKnowledgeBundleStoreRoot,
  resolveKnowledgeBundleStoreStagingDirectoryPrefix,
  type ExportKnowledgeBundleOptions,
} from '../../../src/core/knowledge-bundle/export.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';
import {
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import {
  resolveStoreBinding,
  type StoreBindingResolution,
} from '../../../src/core/store/identity.js';
import { isValidStoreUid } from '../../../src/core/store/identity-types.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { ensureOpenSpecRoot } from '../../../src/core/workspace-root.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const STORE_UID = '22222222-2222-4222-8222-222222222222';
const FIRST_BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_BUNDLE_ID = '44444444-4444-4444-8444-444444444444';

function snapshotFiles(root: string): Record<string, string> {
  if (!fs.existsSync(root)) return {};
  const snapshot: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(target);
      } else {
        snapshot[path.relative(root, target)] = fs.readFileSync(target).toString('base64');
      }
    }
  };
  walk(root);
  return snapshot;
}

function pathExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

describe('knowledge bundle Store transport', () => {
  let tempRoot: string;
  let globalDataDir: string;
  let projectRoot: string;
  let storeRoot: string;
  let outputRoot: string;
  let gitEnv: NodeJS.ProcessEnv;
  let bundleIds: string[];

  function git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: storeRoot,
      encoding: 'utf8',
      env: { ...process.env, ...gitEnv },
    }).trim();
  }

  async function makeStore(
    root: string,
    uid: string,
    id = 'team-store'
  ): Promise<void> {
    fs.mkdirSync(root, { recursive: true });
    await ensureOpenSpecRoot(root);
    await writeStoreMetadataState(root, { version: 2, uid, id });
    await registerStore({
      id,
      localPath: root,
      globalDataDir,
    });
  }

  async function resolveStore(selector: string): Promise<StoreBindingResolution> {
    return resolveStoreBinding({
      declaration: isValidStoreUid(selector)
        ? { form: 'durable', uid: selector }
        : { form: 'alias', id: selector },
      globalDataDir,
    });
  }

  function exportOptions(
    destination: string,
    overrides: ExportKnowledgeBundleOptions['dependencies'] = {}
  ): ExportKnowledgeBundleOptions {
    return {
      project: PROJECT_ID,
      to: destination,
      toStore: 'team-store',
      dependencies: {
        resolveProject: async () => ({
          root: projectRoot,
          ref: {
            projectId: PROJECT_ID,
            name: 'transport-project',
            root: projectRoot,
          },
        }),
        resolveStore,
        resolveKnowledgeHome: (projectId) =>
          resolveProjectKnowledgeHome(projectId, { globalDataDir }),
        readBaseProjectCommit: async () => null,
        bundleId: () => bundleIds.shift()!,
        now: () => new Date('2026-07-26T10:00:00.000Z'),
        ...overrides,
      },
    };
  }

  beforeEach(async () => {
    tempRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-store-transport-'))
    );
    globalDataDir = path.join(tempRoot, 'machine-data');
    projectRoot = path.join(tempRoot, 'project');
    storeRoot = path.join(tempRoot, 'store');
    outputRoot = path.join(tempRoot, 'exports');
    gitEnv = isolatedGitEnv(tempRoot);
    bundleIds = [FIRST_BUNDLE_ID, SECOND_BUNDLE_ID];

    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${PROJECT_ID}\n`
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    await makeStore(storeRoot, STORE_UID);

    const catalogRecord = path.join(storeRoot, 'rasen', 'learned-skills', 'store-owned');
    fs.mkdirSync(catalogRecord, { recursive: true });
    fs.writeFileSync(path.join(catalogRecord, 'SKILL.md'), 'store-owned bytes\n');
    const projectRecords = path.join(storeRoot, '.rasen-store', 'projects');
    fs.mkdirSync(projectRecords, { recursive: true });
    fs.writeFileSync(
      path.join(projectRecords, 'existing-project.yaml'),
      'version: 1\nprojectId: existing-project\n'
    );

    git('init');
    git('add', '.');
    git('commit', '-m', 'store baseline');
    git('remote', 'add', 'origin', 'https://example.invalid/team-store.git');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('adds exactly one untracked transported file and changes no Store-owned or Git state', async () => {
    const metadataBefore = snapshotFiles(path.join(storeRoot, '.rasen-store'));
    const catalogBefore = snapshotFiles(path.join(storeRoot, 'rasen', 'learned-skills'));
    const headBefore = git('rev-parse', 'HEAD');
    const indexBefore = git('ls-files', '--stage');
    const remoteBefore = git('config', '--get', 'remote.origin.url');
    const destination = path.join(outputRoot, 'portable.bundle.json');

    const result = await exportKnowledgeBundle(exportOptions(destination));

    const expectedTransport = path.join(
      fs.realpathSync.native(storeRoot),
      'rasen',
      'knowledge-bundles',
      PROJECT_ID,
      `${FIRST_BUNDLE_ID}.bundle.json`
    );
    expect(result.transport).toEqual({
      store: { id: 'team-store', uid: STORE_UID },
      destination: expectedTransport,
      filesToCommit: [
        path.join(
          'rasen',
          'knowledge-bundles',
          PROJECT_ID,
          `${FIRST_BUNDLE_ID}.bundle.json`
        ),
      ],
    });
    expect(fs.readFileSync(expectedTransport, 'utf8')).toBe(
      fs.readFileSync(destination, 'utf8')
    );
    expect(snapshotFiles(path.join(storeRoot, '.rasen-store'))).toEqual(metadataBefore);
    expect(snapshotFiles(path.join(storeRoot, 'rasen', 'learned-skills'))).toEqual(
      catalogBefore
    );
    expect(git('rev-parse', 'HEAD')).toBe(headBefore);
    expect(git('ls-files', '--stage')).toBe(indexBefore);
    expect(git('config', '--get', 'remote.origin.url')).toBe(remoteBefore);
    expect(git('status', '--short', '--untracked-files=all')).toBe(
      `?? ${path
        .join(
          'rasen',
          'knowledge-bundles',
          PROJECT_ID,
          `${FIRST_BUNDLE_ID}.bundle.json`
        )
        .replaceAll('\\', '/')}`
    );
  });

  it('uses bundle identity for repeated placements and leaves the earlier file byte-identical', async () => {
    const first = await exportKnowledgeBundle(
      exportOptions(path.join(outputRoot, 'first.bundle.json'))
    );
    const firstBytes = fs.readFileSync(first.transport!.destination);

    const second = await exportKnowledgeBundle(
      exportOptions(path.join(outputRoot, 'second.bundle.json'))
    );

    expect(second.transport!.destination).not.toBe(first.transport!.destination);
    expect(fs.readFileSync(first.transport!.destination)).toEqual(firstBytes);
    expect(fs.existsSync(second.transport!.destination)).toBe(true);
    expect(
      git('status', '--short', '--untracked-files=all').split(/\r?\n/u)
    ).toEqual([
      `?? ${path
        .relative(storeRoot, first.transport!.destination)
        .replaceAll('\\', '/')}`,
      `?? ${path
        .relative(storeRoot, second.transport!.destination)
        .replaceAll('\\', '/')}`,
    ]);
  });

  it('fails an ambiguous alias with every candidate and only a non-mutating inspection repair', async () => {
    const twinRoot = path.join(tempRoot, 'store-twin');
    const twinUid = '55555555-5555-4555-8555-555555555555';
    await makeStore(twinRoot, twinUid);
    const storeBefore = snapshotFiles(storeRoot);
    const twinBefore = snapshotFiles(twinRoot);
    const destination = path.join(outputRoot, 'ambiguous.bundle.json');

    const failure = await exportKnowledgeBundle(exportOptions(destination)).catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(KnowledgeBundleExportError);
    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_unavailable',
      details: {
        selector: 'team-store',
        reason: 'alias-ambiguous',
      },
    });
    const repair = (failure as KnowledgeBundleExportError).details.repair;
    const diagnostic = (failure as KnowledgeBundleExportError).details.diagnostic;
    expect(repair).toBe('rasen store list --json');
    expect(repair).not.toContain('knowledge bundle export');
    expect(diagnostic).toContain(STORE_UID);
    expect(diagnostic).toContain(twinUid);
    expect(diagnostic).toContain(storeRoot);
    expect(diagnostic).toContain(twinRoot);
    expect(fs.existsSync(destination)).toBe(false);
    expect(snapshotFiles(storeRoot)).toEqual(storeBefore);
    expect(snapshotFiles(twinRoot)).toEqual(twinBefore);
  });

  it('keeps deferred transport cleanup outside Store so exactly one Store file is untracked', async () => {
    const destination = path.join(outputRoot, 'cleanup-deferred.bundle.json');
    let deferredTemporary: string | undefined;

    const result = await exportKnowledgeBundle(
      exportOptions(destination, {
        io: {
          removeOwnedFile: (target) => {
            if (target.includes('.store.knowledge-bundle-transport.')) {
              deferredTemporary = target;
              throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
            }
            fs.unlinkSync(target);
          },
        },
      })
    );

    expect(result.warnings).toContain('staging_cleanup_deferred');
    expect(deferredTemporary).toBeDefined();
    expect(pathExists(deferredTemporary!)).toBe(true);
    expect(
      path.relative(storeRoot, deferredTemporary!).startsWith(`..${path.sep}`)
    ).toBe(true);
    expect(git('status', '--short', '--untracked-files=all')).toBe(
      `?? ${path
        .relative(storeRoot, result.transport!.destination)
        .replaceAll('\\', '/')}`
    );
  });

  it('refuses a reserved transport subtree redirected by a symlink or junction inside Store', async () => {
    const catalogRoot = path.join(storeRoot, 'rasen', 'learned-skills');
    const catalogBefore = snapshotFiles(catalogRoot);
    const metadataBefore = snapshotFiles(path.join(storeRoot, '.rasen-store'));
    const redirected = path.join(storeRoot, 'rasen', 'knowledge-bundles');
    fs.symlinkSync(
      catalogRoot,
      redirected,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const destination = path.join(outputRoot, 'redirected.bundle.json');

    const failure = await exportKnowledgeBundle(exportOptions(destination)).catch(
      (error: unknown) => error
    );

    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_write_failed',
      details: {
        selector: 'team-store',
        userDestinationPublished: 'false',
      },
    });
    expect((failure as KnowledgeBundleExportError).details.reason).toMatch(
      /symlink|junction|redirect/iu
    );
    expect(fs.existsSync(destination)).toBe(false);
    expect(snapshotFiles(catalogRoot)).toEqual(catalogBefore);
    expect(snapshotFiles(path.join(storeRoot, '.rasen-store'))).toEqual(metadataBefore);
  });

  it.each([
    ['Store root', (root: string) => path.join(root, 'user.bundle.json')],
    [
      'Store metadata',
      (root: string) => path.join(root, '.rasen-store', 'user.bundle.json'),
    ],
  ])('refuses a user --to destination inside the selected %s before creating anything', async (_label, makeDestination) => {
    const storeBefore = snapshotFiles(storeRoot);
    const destination = makeDestination(storeRoot);

    const failure = await exportKnowledgeBundle(exportOptions(destination)).catch(
      (error: unknown) => error
    );

    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_overlap',
      details: {
        selector: 'team-store',
        destination,
        storeRoot: fs.realpathSync.native(storeRoot),
      },
    });
    expect(snapshotFiles(storeRoot)).toEqual(storeBefore);
  });

  it('refuses a user --to alias that canonically resolves inside the selected Store', async () => {
    const aliasRoot = path.join(tempRoot, 'store-alias');
    fs.symlinkSync(
      storeRoot,
      aliasRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const storeBefore = snapshotFiles(storeRoot);
    const destination = path.join(aliasRoot, 'aliased.bundle.json');

    const failure = await exportKnowledgeBundle(exportOptions(destination)).catch(
      (error: unknown) => error
    );

    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_overlap',
      details: {
        selector: 'team-store',
        destination: path.join(
          fs.realpathSync.native(storeRoot),
          'aliased.bundle.json'
        ),
      },
    });
    expect(fs.existsSync(destination)).toBe(false);
    expect(snapshotFiles(storeRoot)).toEqual(storeBefore);
  });

  it('re-proves the authorized destination parent identity immediately before publication', async () => {
    const catalogRoot = path.join(storeRoot, 'rasen', 'learned-skills');
    const catalogBefore = snapshotFiles(catalogRoot);
    const destination = path.join(outputRoot, 'parent-swap.bundle.json');
    const authorizedParent = path.join(
      storeRoot,
      'rasen',
      'knowledge-bundles',
      PROJECT_ID
    );
    let swapped = false;

    const failure = await exportKnowledgeBundle(
      exportOptions(destination, {
        io: {
          beforePublish: (target) => {
            if (!target.startsWith(authorizedParent) || swapped) return;
            swapped = true;
            fs.renameSync(authorizedParent, path.join(tempRoot, 'authorized-parent'));
            fs.symlinkSync(
              catalogRoot,
              authorizedParent,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
          },
        },
      })
    ).catch((error: unknown) => error);

    expect(swapped).toBe(true);
    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_write_failed',
      details: {
        selector: 'team-store',
        userDestination: destination,
        userDestinationPublished: 'true',
      },
    });
    expect((failure as KnowledgeBundleExportError).details.reason).toMatch(
      /symlink|junction|changed/iu
    );
    expect(fs.existsSync(destination)).toBe(true);
    expect(
      fs.existsSync(path.join(catalogRoot, `${FIRST_BUNDLE_ID}.bundle.json`))
    ).toBe(false);
    expect(snapshotFiles(catalogRoot)).toEqual(catalogBefore);
  });

  it('wraps a raw transport target inspection error with Store and partial-success facts', async () => {
    const destination = path.join(outputRoot, 'target-error.bundle.json');
    const transportSegment = path.join('rasen', 'knowledge-bundles');

    const failure = await exportKnowledgeBundle(
      exportOptions(destination, {
        io: {
          targetExists: (target) => {
            if (target.includes(transportSegment)) {
              throw Object.assign(new Error('transport target denied'), {
                code: 'EACCES',
              });
            }
            return pathExists(target);
          },
        },
      })
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_write_failed',
      details: {
        selector: 'team-store',
        reason: 'transport target denied',
        userDestination: destination,
        userDestinationPublished: 'true',
      },
    });
    expect((failure as KnowledgeBundleExportError).details.destination).toBe(
      resolveKnowledgeBundleStoreDestination(
        fs.realpathSync.native(storeRoot),
        PROJECT_ID,
        FIRST_BUNDLE_ID
      )
    );
    expect(fs.existsSync(destination)).toBe(true);
    expect(git('status', '--short', '--untracked-files=all')).toBe('');
  });

  it('wraps a raw transport publication error with Store and partial-success facts', async () => {
    const destination = path.join(outputRoot, 'publish-error.bundle.json');
    const transportSegment = path.join('rasen', 'knowledge-bundles');

    const failure = await exportKnowledgeBundle(
      exportOptions(destination, {
        io: {
          publishNewFile: (temporary, target) => {
            if (target.includes(transportSegment)) {
              throw Object.assign(new Error('transport publication denied'), {
                code: 'EIO',
              });
            }
            fs.linkSync(temporary, target);
          },
        },
      })
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_write_failed',
      details: {
        selector: 'team-store',
        reason: 'transport publication denied',
        userDestination: destination,
        userDestinationPublished: 'true',
      },
    });
    expect(fs.existsSync(destination)).toBe(true);
    expect(git('status', '--short', '--untracked-files=all')).toBe('');
  });

  it('fails an unreachable Store with its exact diagnostic and repair and writes nowhere', async () => {
    const destination = path.join(outputRoot, 'unreachable.bundle.json');
    const storeBefore = snapshotFiles(storeRoot);
    const exactDiagnostic = 'The registered Store checkout is not reachable.';
    const exactRepair = `rasen store register ${STORE_UID}`;

    const failure = await exportKnowledgeBundle(
      exportOptions(destination, {
        resolveStore: async () => ({
          kind: 'unavailable',
          expected: { type: 'store', uid: STORE_UID, id: 'team-store' },
          reason: 'root-unhealthy',
          diagnostics: [
            {
              severity: 'error',
              code: 'store_root_unhealthy',
              message: exactDiagnostic,
              target: 'store.root',
            },
          ],
          repair: [exactRepair],
        }),
      })
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'knowledge_bundle_store_unavailable',
      message: exactDiagnostic,
      details: {
        diagnostic: exactDiagnostic,
        repair: exactRepair,
      },
    });
    expect(fs.existsSync(destination)).toBe(false);
    expect(snapshotFiles(storeRoot)).toEqual(storeBefore);
  });

  it('composes the reserved path with platform path resolution', () => {
    const canonicalRoot = resolveKnowledgeBundleStoreRoot(storeRoot);
    expect(
      resolveKnowledgeBundleStoreDestination(
        canonicalRoot,
        PROJECT_ID,
        FIRST_BUNDLE_ID
      )
    ).toBe(
      path.resolve(
        canonicalRoot,
        'rasen',
        'knowledge-bundles',
        PROJECT_ID,
        `${FIRST_BUNDLE_ID}.bundle.json`
      )
    );
  });

  it('places Store staging beside the canonical Store root on the same filesystem', () => {
    const prefix = resolveKnowledgeBundleStoreStagingDirectoryPrefix(
      storeRoot,
      FIRST_BUNDLE_ID,
      1234
    );
    expect(path.dirname(prefix)).toBe(path.dirname(fs.realpathSync.native(storeRoot)));
    expect(path.relative(storeRoot, prefix).startsWith(`..${path.sep}`)).toBe(true);
    expect(
      fs.statSync(path.dirname(prefix), { bigint: true }).dev
    ).toBe(fs.statSync(storeRoot, { bigint: true }).dev);
  });

  it.skipIf(process.platform !== 'win32')(
    'canonicalizes Windows drive-case and separator variants to one Store location',
    () => {
      const driveCaseVariant =
        storeRoot.slice(0, 1).toLowerCase() + storeRoot.slice(1);
      const separatorVariant = driveCaseVariant.replaceAll('\\', '/');
      const canonical = resolveKnowledgeBundleStoreRoot(storeRoot);

      expect(resolveKnowledgeBundleStoreRoot(driveCaseVariant)).toBe(canonical);
      expect(resolveKnowledgeBundleStoreRoot(separatorVariant)).toBe(canonical);
      expect(
        resolveKnowledgeBundleStoreDestination(
          resolveKnowledgeBundleStoreRoot(separatorVariant),
          PROJECT_ID,
          FIRST_BUNDLE_ID
        )
      ).toBe(
        resolveKnowledgeBundleStoreDestination(
          canonical,
          PROJECT_ID,
          FIRST_BUNDLE_ID
        )
      );
    }
  );
});
