/**
 * Shared fixture for the `store-layout-v2-migration` Module suites.
 *
 * Every suite below `test/core/store/layout-migration-*.test.ts` needs the same
 * three things: a registered legacy flat Store in a real Git repository, a
 * Module wired with a fixed clock and seeded entropy so plans are reproducible,
 * and literal (never contract-computed) layout v2 addresses to assert against.
 *
 * The addresses here are string joins on purpose. Asking `projectPartition()`
 * where the code put something proves only that the code agrees with itself.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { writeStoreMetadataState } from '../../src/core/store/foundation.js';
import { writeStoreProjectRecord } from '../../src/core/store/project-records.js';
import {
  StoreLayoutMigration,
  productionStoreLayoutMigrationDependencies,
  withDeterministicIdentity,
  type StoreLayoutMigrationDependencies,
} from '../../src/core/store/layout-migration/index.js';
import { isolatedGitEnv } from './store-git.js';
import { createOpenSpecRoot } from './rasen-fixtures.js';

export const MIGRATION_FIXTURE_STORE_UID = '11111111-2222-4333-8444-555555555555';
export const MIGRATION_FIXTURE_STORE_ID = 'team-store';
export const MIGRATION_FIXTURE_NOW = '2026-08-07T00:00:00.000Z';

export interface LayoutMigrationFixture {
  readonly tempDir: string;
  readonly storeRoot: string;
  readonly globalDataDir: string;
  readonly gitEnv: NodeJS.ProcessEnv;
  git(...args: string[]): string;
  commitAll(message?: string): void;
  /** Writes a file below the Store root, creating parents. */
  write(relative: string, content: string): string;
  /** Absolute Store-root-relative path, with no layout contract involved. */
  at(...segments: string[]): string;
  writeSpec(capability: string, body?: string): void;
  writeChange(name: string, extra?: Record<string, string>): void;
  writeArchiveEntry(name: string, extra?: Record<string, string>): void;
  member(projectId: string, adoption?: { specs: string[]; changes: string[] }): Promise<void>;
  writeMapping(relative: string, body: string): string;
  migration(overrides?: Partial<StoreLayoutMigrationDependencies>): StoreLayoutMigration;
  /** `InventoryInput` / `MigrationPlanInput` with the fixture's Store selected. */
  input(overrides?: Record<string, unknown>): never;
  cleanup(): void;
}

/**
 * A default mapping body: one target line, declared for the named projects.
 * `storeRef`/`codeRef` are format-validated only — resolving refs is child 4's.
 */
export function targetLineMapping(
  targetLineId: string,
  projectIds: readonly string[],
  extra: readonly string[] = []
): string {
  return [
    'version: 1',
    `defaultTargetLine: ${targetLineId}`,
    'targetLines:',
    `  ${targetLineId}:`,
    '    storeRef: refs/heads/main',
    '    projects:',
    ...projectIds.flatMap((projectId) => [`      ${projectId}:`, '        codeRef: refs/heads/main']),
    ...extra,
    '',
  ].join('\n');
}

export interface LayoutMigrationFixtureOptions {
  /**
   * `permanent` (default) mints the version 2 metadata every Store created
   * since 0.1.5 carries. `legacy-v1` produces a Store that predates permanent
   * identities, which is the state `blocked:store-identity-missing` describes.
   */
  readonly storeIdentity?: 'permanent' | 'legacy-v1';
  /**
   * Optional nested segment below the short `mkdtemp` root. Tests use this to
   * cross Windows' classic MAX_PATH budget without asking `mkdtemp` itself to
   * create an over-budget path.
   */
  readonly storeRootPadding?: string;
  /**
   * Derive the nested padding segment so the Store root lands at exactly this
   * length, regardless of where the host's temp directory lives. Use this (not
   * `storeRootPadding`) when the test wants a path that is long enough for a
   * partition destination to cross MAX_PATH while keeping the Store root itself
   * under it: `git -C` and `git init <path>` chdir before git reads any config,
   * so the root must stay below 260 even with `core.longpaths` enabled.
   */
  readonly storeRootTargetLength?: number;
}

export async function createLayoutMigrationFixture(
  prefix = 'rasen-layout-migration-',
  options: LayoutMigrationFixtureOptions = {}
): Promise<LayoutMigrationFixture> {
  const tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const savedXdg = process.env.XDG_DATA_HOME;
  const savedRasenHome = process.env.RASEN_HOME;
  delete process.env.RASEN_HOME;
  process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
  const globalDataDir = getGlobalDataDir({ env: process.env });
  const gitEnv = isolatedGitEnv(tempDir);
  const paddingSegment =
    options.storeRootTargetLength !== undefined
      ? 'd'.repeat(
          Math.max(
            0,
            options.storeRootTargetLength -
              tempDir.length -
              path.sep.length -
              MIGRATION_FIXTURE_STORE_ID.length -
              path.sep.length
          )
        )
      : options.storeRootPadding;
  const storeRoot = path.join(
    tempDir,
    ...(paddingSegment === undefined ? [] : [paddingSegment]),
    MIGRATION_FIXTURE_STORE_ID
  );

  createOpenSpecRoot(storeRoot);
  await writeStoreMetadataState(
    storeRoot,
    options.storeIdentity === 'legacy-v1'
      ? { version: 1, id: MIGRATION_FIXTURE_STORE_ID }
      : { version: 2, uid: MIGRATION_FIXTURE_STORE_UID, id: MIGRATION_FIXTURE_STORE_ID }
  );
  await registerStore({
    id: MIGRATION_FIXTURE_STORE_ID,
    localPath: storeRoot,
    globalDataDir,
  });
  execFileSync('git', ['-c', 'core.longpaths=true', 'init', '-b', 'main', storeRoot], {
    env: { ...process.env, ...gitEnv },
    windowsHide: true,
    stdio: 'pipe',
  });

  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'core.longpaths=true', '-C', storeRoot, ...args], {
      env: { ...process.env, ...gitEnv },
      windowsHide: true,
      stdio: 'pipe',
      encoding: 'utf8',
    });

  const at = (...segments: string[]): string => path.join(storeRoot, ...segments);

  const write = (relative: string, content: string): string => {
    const target = path.join(storeRoot, relative.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    return target;
  };

  return {
    tempDir,
    storeRoot,
    globalDataDir,
    gitEnv,
    git,
    at,
    write,
    commitAll(message = 'fixture') {
      git('add', '-A');
      git('commit', '-m', message);
    },
    writeSpec(capability, body = `# ${capability}\n`) {
      write(`rasen/specs/${capability}/spec.md`, body);
    },
    writeChange(name, extra) {
      write(`rasen/changes/${name}/proposal.md`, `# ${name}\n`);
      for (const [relative, content] of Object.entries(extra ?? {})) {
        write(`rasen/changes/${name}/${relative}`, content);
      }
    },
    writeArchiveEntry(name, extra) {
      write(`rasen/changes/archive/${name}/proposal.md`, `# ${name}\n`);
      for (const [relative, content] of Object.entries(extra ?? {})) {
        write(`rasen/changes/archive/${name}/${relative}`, content);
      }
    },
    async member(projectId, adoption) {
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId,
        roles: { planning: adoption !== undefined, knowledge: true },
        ...(adoption === undefined
          ? {}
          : { adoption: { ...adoption, adoptedAt: '2026-01-02T03:04:05.000Z' } }),
      });
    },
    writeMapping(relative, body) {
      write(relative, body);
      return relative;
    },
    migration(overrides) {
      return new StoreLayoutMigration(
        {
          ...withDeterministicIdentity(productionStoreLayoutMigrationDependencies, {
            now: MIGRATION_FIXTURE_NOW,
          }),
          ...(overrides ?? {}),
        },
        { globalDataDir }
      );
    },
    input(overrides = {}) {
      return {
        storeSelector: MIGRATION_FIXTURE_STORE_ID,
        startPath: storeRoot,
        globalDataDir,
        ...overrides,
      } as never;
    },
    cleanup() {
      if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = savedXdg;
      if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
      else process.env.RASEN_HOME = savedRasenHome;
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
