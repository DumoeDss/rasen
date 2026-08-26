/**
 * A real-Git fixture for the `store-planning-worktree-bindings` Module suites.
 *
 * One layout-v2 Store repository, one code repository per project, both
 * registries, and a `StoreWorkspace` / `StoreTargetLinesModule` bound to a
 * deterministic clock and entropy source. Real Git throughout: the whole point
 * of this change is what happens against actual worktrees, refs, and commit
 * OIDs, and an in-memory Git would prove none of it.
 *
 * Every path the fixture builds is exposed, so a suite asserts destinations
 * against the fixture's own roots rather than against the code under test.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, writeStoreRegistryState } from '../../src/core/index.js';
import { writeProjectRegistryState } from '../../src/core/project-registry.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
} from '../../src/core/store/planning-identity.js';
import { StoreTargetLinesModule } from '../../src/core/store/target-lines.js';
import {
  productionStoreWorkspaceDependencies,
  withDeterministicWorkspaceIdentity,
  type StoreWorkspaceDependencies,
} from '../../src/core/store/workspace/dependencies.js';
import { StoreWorkspace } from '../../src/core/store/workspace/module.js';
import { isolatedGitEnv } from './store-git.js';
import { cleanupTempPath } from './temp-cleanup.js';

/** The frozen clock every fixture-built plan and index entry is stamped with. */
export const FIXTURE_NOW = '2026-08-07T00:00:00.000Z';

export interface TargetLineSeed {
  readonly id: string;
  readonly storeRef: string;
  /** Per-project code locators. Omit a project to leave its locator absent. */
  readonly codeRefs?: Readonly<Record<string, string>>;
}

export interface StoreWorkspaceFixtureOptions {
  readonly prefix?: string;
  readonly projects?: readonly string[];
  readonly lines?: readonly TargetLineSeed[];
  /** Extra branches created in the Store repository beyond `main`. */
  readonly storeBranches?: readonly string[];
  /** Extra branches created in every code repository beyond `main`. */
  readonly projectBranches?: readonly string[];
  /**
   * Members recorded `planning: false, knowledge: true` instead of the default
   * planning roles — the roster shape the publication gate must refuse as a
   * target. Must be listed in `projects` too; the catalog is what differs, not
   * the membership itself.
   */
  readonly knowledgeOnlyProjects?: readonly string[];
}

export interface StoreWorkspaceFixture {
  readonly tempDir: string;
  readonly storeRoot: string;
  readonly storeId: string;
  readonly storeUid: string;
  readonly globalDataDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly dependencies: StoreWorkspaceDependencies;
  projectRoot(projectId: string): string;
  git(cwd: string, args: readonly string[]): string;
  /** A path inside the Store checkout. */
  at(...segments: readonly string[]): string;
  /** A path inside the fixture temp directory, beside every repository. */
  beside(...segments: readonly string[]): string;
  write(filePath: string, content: string): void;
  writeTargetLine(seed: TargetLineSeed): string;
  /** `PlanningScopeId` for one (project, line) of this Store. */
  planningScopeId(projectId: string, targetLineId: string): string;
  /**
   * A Change directory in a project partition of `root`, carrying a valid v2
   * identity block. `root` is a Store CHECKOUT — the integration one or a
   * planning worktree.
   */
  seedChange(input: {
    readonly root: string;
    readonly projectId: string;
    readonly targetLineId: string;
    readonly changeId: string;
    readonly instanceSeed?: string;
  }): { readonly directory: string; readonly instanceId: string };
  workspace(): StoreWorkspace;
  targetLines(): StoreTargetLinesModule;
  /** The commit OID a ref currently names, in a chosen repository. */
  refOid(repoRoot: string, ref: string): string;
  cleanup(): void;
}

const DEFAULT_STORE_ID = 'team-store';

export async function createStoreWorkspaceFixture(
  options: StoreWorkspaceFixtureOptions = {}
): Promise<StoreWorkspaceFixture> {
  const projects = options.projects ?? ['app-a'];
  const tempDir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? 'rasen-workspace-'))
  );
  const env: NodeJS.ProcessEnv = {
    ...isolatedGitEnv(tempDir),
    XDG_DATA_HOME: path.join(tempDir, 'data'),
    XDG_CONFIG_HOME: path.join(tempDir, 'config'),
    OPEN_SPEC_INTERACTIVE: '0',
    RASEN_TELEMETRY: '0',
  };
  const globalDataDir = getGlobalDataDir({ env });
  const storeUid = randomUUID();
  const storeRoot = path.join(tempDir, 'store-integration');

  function git(cwd: string, args: readonly string[]): string {
    return execFileSync('git', ['-C', cwd, ...args], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    });
  }

  function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  function seedRepository(root: string, branches: readonly string[]): void {
    fs.mkdirSync(root, { recursive: true });
    git(root, ['init', '--initial-branch=main']);
    write(path.join(root, 'README.md'), `# ${path.basename(root)}\n`);
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'seed']);
    for (const branch of branches) git(root, ['branch', branch]);
  }

  function at(...segments: readonly string[]): string {
    return path.join(storeRoot, ...segments);
  }

  function beside(...segments: readonly string[]): string {
    return path.join(tempDir, ...segments);
  }

  function writeTargetLine(seed: TargetLineSeed): string {
    const filePath = at('.rasen-store', 'target-lines', `${seed.id}.yaml`);
    const codeRefs = Object.entries(seed.codeRefs ?? {});
    const lines = [
      'version: 1',
      `id: ${seed.id}`,
      `storeRef: ${seed.storeRef}`,
      codeRefs.length === 0 ? 'projects: {}' : 'projects:',
    ];
    for (const [projectId, codeRef] of codeRefs) {
      lines.push(`  ${projectId}:`, `    codeRef: ${codeRef}`);
    }
    write(filePath, `${lines.join('\n')}\n`);
    return filePath;
  }

  // ---- Store repository ------------------------------------------------
  seedRepository(storeRoot, []);
  write(
    at('.rasen-store', 'store.yaml'),
    `version: 2\nuid: ${storeUid}\nid: ${DEFAULT_STORE_ID}\nlayoutVersion: 2\n`
  );
  for (const projectId of projects) {
    const knowledgeOnly = options.knowledgeOnlyProjects?.includes(projectId) ?? false;
    write(
      at('.rasen-store', 'projects', `${projectId}.yaml`),
      [
        'version: 2',
        `projectId: ${projectId}`,
        `id: ${projectId}`,
        'roles:',
        `  planning: ${!knowledgeOnly}`,
        `  knowledge: ${knowledgeOnly}`,
        'planningBinding:',
        knowledgeOnly ? '  state: unbound' : '  state: bound',
        ...(knowledgeOnly ? [] : [`  boundAt: ${FIXTURE_NOW}`]),
        '',
      ].join('\n')
    );
    write(
      at('rasen', 'projects', projectId, 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\n`
    );
  }
  for (const seed of options.lines ?? []) writeTargetLine(seed);
  git(storeRoot, ['add', '.']);
  git(storeRoot, ['commit', '-m', 'seed Store v2 layout']);
  for (const branch of options.storeBranches ?? []) git(storeRoot, ['branch', branch]);

  // ---- code repositories ------------------------------------------------
  const projectRoots = new Map<string, string>();
  for (const projectId of projects) {
    const root = path.join(tempDir, projectId);
    projectRoots.set(projectId, root);
    fs.mkdirSync(root, { recursive: true });
    write(
      path.join(root, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\nstore:\n  uid: ${storeUid}\n  id: ${DEFAULT_STORE_ID}\n`
    );
    // Committed as part of the seed so the main checkout starts CLEAN; every
    // "the main checkout is untouched" assertion depends on that.
    seedRepository(root, options.projectBranches ?? []);
  }

  await writeStoreRegistryState(
    {
      version: 2,
      stores: {
        [storeUid]: {
          id: DEFAULT_STORE_ID,
          backend: { type: 'git', local_path: storeRoot },
        },
      },
    },
    { globalDataDir }
  );
  await writeProjectRegistryState(
    {
      version: 1,
      projects: Object.fromEntries(
        [...projectRoots].map(([projectId, root]) => [
          root,
          {
            projectId,
            name: projectId,
            mode: 'store' as const,
            home: `${projectId}-home`,
            lastSeen: FIXTURE_NOW,
          },
        ])
      ),
    },
    { globalDataDir }
  );

  const dependencies = withDeterministicWorkspaceIdentity(
    productionStoreWorkspaceDependencies,
    { now: FIXTURE_NOW }
  );

  return {
    tempDir,
    storeRoot,
    storeId: DEFAULT_STORE_ID,
    storeUid,
    globalDataDir,
    env,
    dependencies,
    projectRoot(projectId) {
      const root = projectRoots.get(projectId);
      if (root === undefined) throw new Error(`no fixture project '${projectId}'`);
      return root;
    },
    git,
    at,
    beside,
    write,
    writeTargetLine,
    planningScopeId: (projectId, targetLineId) =>
      derivePlanningScopeId({ storeUid, projectId, targetLineId }),
    seedChange(input) {
      const scopeId = derivePlanningScopeId({
        storeUid,
        projectId: input.projectId,
        targetLineId: input.targetLineId,
      });
      const instanceSeed = input.instanceSeed ?? 'a'.repeat(32);
      const instanceId = deriveChangeInstanceId({ planningScopeId: scopeId, instanceSeed });
      const directory = path.join(
        input.root,
        'rasen',
        'projects',
        input.projectId,
        'changes',
        input.changeId
      );
      write(
        path.join(directory, '.openspec.yaml'),
        [
          'schema: spec-driven',
          'identity:',
          '  version: 2',
          // Every scalar is QUOTED. An unquoted YAML scalar takes its type
          // from its content, so an all-numeric instanceSeed parses as a
          // number and a targetLineId like `0.2` parses as a float — both
          // are then rejected by ChangeMetadataSchema, and a Change whose
          // metadata does not parse is INVISIBLE to every blob-reading
          // consumer (successor search, aggregate grouping) with no
          // diagnostic anywhere. Found by store-scoped-issues-management.
          `  instanceSeed: ${JSON.stringify(instanceSeed)}`,
          `  instanceId: ${JSON.stringify(instanceId)}`,
          `  storeUid: ${JSON.stringify(storeUid)}`,
          `  projectId: ${JSON.stringify(input.projectId)}`,
          `  targetLineId: ${JSON.stringify(input.targetLineId)}`,
          '',
        ].join('\n')
      );
      write(path.join(directory, 'proposal.md'), `## Why\n\n${input.changeId}\n`);
      return { directory, instanceId };
    },
    workspace: () => new StoreWorkspace(dependencies, { globalDataDir }),
    targetLines: () => new StoreTargetLinesModule(dependencies),
    refOid: (repoRoot, ref) => git(repoRoot, ['rev-parse', ref]).trim(),
    cleanup: () => cleanupTempPath(tempDir),
  };
}
