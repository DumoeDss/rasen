import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  createStorePlanningResolverForTesting,
  nodeStorePlanningFileSystem,
  productionStorePlanningDependencies,
  type ProjectIdentityClaimantSnapshot,
  type ProjectRegistrySnapshotEntry,
  type StorePlanningDependencies,
  type WorkspacePairSnapshot,
} from '../../../src/core/store-planning/testing.js';
import { PlanningScopeError } from '../../../src/core/store-planning/index.js';
import {
  deriveWorktreeInstanceId,
  parseChangeInstanceSeed,
} from '../../../src/core/store/planning-foundation.js';
import {
  registerProject,
  updateProjectRegistryState,
} from '../../../src/core/project-registry.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';

const STORE_UID = '123e4567-e89b-42d3-a456-426614174000';
const tempRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-planning-'));
  tempRoots.push(root);
  return fs.realpathSync.native(root);
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function snapshotTreeBytes(root: string): Readonly<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        snapshot[`${relative}${path.sep}`] = '<directory>';
        visit(absolute);
      } else {
        snapshot[relative] = fs.readFileSync(absolute).toString('base64');
      }
    }
  };
  visit(root);
  return snapshot;
}

function projectClaimant(
  root: string,
  entry: ProjectRegistrySnapshotEntry['entry'],
  live: boolean
): ProjectIdentityClaimantSnapshot {
  return {
    root,
    entry,
    live,
    aliases: [{ registryPath: root, canonicalPath: root, entry, live, direct: true }],
    fixedMetadataConflict: false,
  };
}

function storeFixture(options: { marker?: boolean; localPlanning?: boolean } = {}): {
  storeRoot: string;
  projectRoot: string;
} {
  const root = temporaryRoot();
  const storeRoot = path.join(root, 'team-store');
  const projectRoot = path.join(root, 'project-a');
  write(
    path.join(storeRoot, '.rasen-store', 'store.yaml'),
    `version: 2\nuid: ${STORE_UID}\nid: team-store\nlayoutVersion: 2\n`
  );
  write(
    path.join(storeRoot, '.rasen-store', 'projects', 'project-a.yaml'),
    'version: 2\nprojectId: project-a\nid: project-a\nroles:\n  planning: true\n  knowledge: false\nplanningBinding:\n  state: bound\n  boundAt: 2026-08-06T00:00:00.000Z\n'
  );
  write(
    path.join(storeRoot, '.rasen-store', 'target-lines', 'line-0.2.yaml'),
    'version: 1\nid: line-0.2\nstoreRef: refs/heads/release/0.2\nprojects:\n  project-a:\n    codeRef: refs/heads/release/0.2\n'
  );
  write(
    path.join(projectRoot, 'rasen', 'config.yaml'),
    `schema: spec-driven\nprojectId: project-a\nstore:\n  uid: ${STORE_UID}\n  id: team-store\n`
  );
  if (options.localPlanning) {
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes'), { recursive: true });
  }
  if (options.marker !== false) {
    write(
      path.join(storeRoot, '.rasen', 'planning-line.json'),
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: 'project-a',
        targetLineId: 'line-0.2',
      }) + '\n'
    );
  }
  return { storeRoot, projectRoot };
}

/**
 * A healthy planning worktree, as live Git would report one.
 *
 * These fixtures stub Git the same way they stub `checkoutRole`: there is no
 * real repository behind the temporary directories, so the probe that
 * `store-planning-worktree-bindings` added has to be supplied here too. The
 * DEFAULT is healthy — a linked worktree whose identity re-derives and whose
 * target-line Store ref resolves — so every case that predates the probe keeps
 * asserting what it always asserted. The cases that exercise the tightened gate
 * override it explicitly.
 */
function healthyPlanningProbe(): StorePlanningDependencies['probePlanningWorktree'] {
  return async ({ planningRoot }) => ({
    isWorktree: true,
    linked: true,
    worktreeInstanceId: deriveWorktreeInstanceId({
      repositoryIdentity: `${planningRoot}/.git`,
      worktreeIdentity: planningRoot,
    }),
    storeRefOid: 'a'.repeat(40),
  });
}

function resolver(
  roots: { storeRoot: string; projectRoot: string },
  role: StorePlanningDependencies['checkoutRole'] = () => 'linked-worktree',
  overrides: Partial<StorePlanningDependencies> = {}
) {
  const dependencies: StorePlanningDependencies = {
    fs: overrides.fs ?? nodeStorePlanningFileSystem,
    probePlanningWorktree: overrides.probePlanningWorktree ?? healthyPlanningProbe(),
    assertPlanningWorktreeUnbound: overrides.assertPlanningWorktreeUnbound ?? (async () => {}),
    completeChangeBinding:
      overrides.completeChangeBinding ??
      (async () => ({ bindingState: 'prepared' as const, entry: null, findings: [] })),
    snapshotStores: async () => [
      { id: 'team-store', uid: STORE_UID, type: 'store', root: roots.storeRoot },
      { id: 'project-a', type: 'project', root: roots.projectRoot },
    ],
    snapshotProjects: async () => [
      {
        root: roots.projectRoot,
        entry: {
          projectId: 'project-a',
          name: 'project-a',
          mode: 'store',
          home: 'project-a-home',
          lastSeen: '2026-08-06T00:00:00.000Z',
        },
      },
    ],
    findProjectIdentityClaimants: async () => [
      projectClaimant(
        roots.projectRoot,
        {
          projectId: 'project-a',
          name: 'project-a',
          mode: 'store',
          home: 'project-a-home',
          lastSeen: '2026-08-06T00:00:00.000Z',
        },
        true
      ),
    ],
    findRegisteredProject: async () => null,
    sessionContextPath: () => undefined,
    checkoutRole: overrides.checkoutRole ?? role,
    // No pair is recorded by default: these fixtures assert the CATALOG
    // satisfier of the planning-bound gate, so the recorded-pair satisfier
    // must contribute nothing unless a case supplies it explicitly.
    listWorkspacePairs: overrides.listWorkspacePairs ?? (async () => []),
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    mintInstanceSeed: () => parseChangeInstanceSeed('0123456789abcdef0123456789abcdef'),
    randomSuffix: () => 'deterministic',
    ...overrides,
  };
  return new createStorePlanningResolverForTesting(dependencies);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('StorePlanning.open', () => {
  it('keeps Store aggregate addresses separate from project content', async () => {
    const roots = storeFixture();
    const planning = resolver(roots);
    const scope = await planning.open({
      intent: 'store-read',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID },
    });

    expect(scope.describe().kind).toBe('store-aggregate');
    expect(scope.locate({ kind: 'store-design-docs' }).absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'design-docs')
    );
    expect(scope.describe().paths['active-changes']).toBeUndefined();
  });

  it('maps a v2 project through the Foundation partition and returns deterministic locations', async () => {
    const roots = storeFixture();
    const planning = resolver(roots);
    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.storeRoot,
      selection: { store: 'team-store', project: 'project-a', targetLine: 'line-0.2' },
    });
    const first = scope.locate({ kind: 'active-change', changeId: 'same-name' });
    const second = scope.locate({ kind: 'active-change', changeId: 'same-name' });

    expect(first.absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'changes', 'same-name')
    );
    expect(second.absolutePath).toBe(first.absolutePath);
    expect(scope.locate({ kind: 'project-work' }).absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'work')
    );
    expect(scope.locate({ kind: 'project-schemas' }).absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'schemas')
    );
    expect(scope.locate({ kind: 'archive-line' }).absolutePath).toBe(
      path.join(
        roots.storeRoot,
        'rasen',
        'projects',
        'project-a',
        'changes',
        'archive',
        'line-0.2'
      )
    );
  });

  it('creates one complete Store v2 Change with verified portable identity', async () => {
    const roots = storeFixture();
    const planning = resolver(roots);
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });
    const authored = await scope.createChange({
      changeId: 'portable-change',
      schema: 'spec-driven',
      description: 'Portable planning.',
      proposal: 'Route planning through one scope.',
      implementation: 'code',
    });

    expect(authored.location.absolutePath).toBe(
      path.join(
        roots.storeRoot,
        'rasen',
        'projects',
        'project-a',
        'changes',
        'portable-change'
      )
    );
    const metadata = parseYaml(fs.readFileSync(authored.metadataPath, 'utf8')) as {
      identity: Record<string, string | number>;
    };
    expect(metadata.identity).toMatchObject({
      version: 2,
      storeUid: STORE_UID,
      projectId: 'project-a',
      targetLineId: 'line-0.2',
      instanceId: authored.instanceId,
    });
    // The publication ownership token is retired once publication and identity
    // verification are done: it must not be committed into the Store's history
    // or counted by later Archive digest accounting.
    expect(
      fs.existsSync(path.join(authored.location.absolutePath, '.rasen-publish-owner'))
    ).toBe(false);
    expect(fs.readdirSync(authored.location.absolutePath).sort()).toEqual([
      '.openspec.yaml',
      'README.md',
      'proposal.md',
    ]);
    expect(fs.readdirSync(path.dirname(authored.location.absolutePath))).toEqual([
      'portable-change',
    ]);
  });

  it('validates Store v2 creation schemas from the selected project partition', async () => {
    const roots = storeFixture();
    const customSchema = fs
      .readFileSync(path.join(process.cwd(), 'schemas', 'spec-driven', 'schema.yaml'), 'utf8')
      .replace('name: spec-driven', 'name: project-flow');
    write(
      path.join(
        roots.storeRoot,
        'rasen',
        'projects',
        'project-a',
        'schemas',
        'project-flow',
        'schema.yaml'
      ),
      customSchema
    );
    const planning = resolver(roots);
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });

    const authored = await scope.createChange({
      changeId: 'custom-schema-change',
      schema: 'project-flow',
    });

    expect(authored.schema).toBe('project-flow');
    expect(parseYaml(fs.readFileSync(authored.metadataPath, 'utf8'))).toMatchObject({
      schema: 'project-flow',
    });
  });

  it('rejects a stale creation capability before writing a Change', async () => {
    const roots = storeFixture();
    const planning = resolver(roots);
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });
    write(
      path.join(roots.storeRoot, '.rasen-store', 'projects', 'project-a.yaml'),
      'version: 2\nprojectId: project-a\nid: project-a\nroles:\n  planning: true\n  knowledge: false\nplanningBinding:\n  state: bound\n  boundAt: 2026-08-06T01:00:00.000Z\n'
    );

    await expect(
      scope.createChange({ changeId: 'stale-change', schema: 'spec-driven' })
    ).rejects.toMatchObject({ diagnostic: { code: 'planning_scope_stale' } });
    expect(
      fs.existsSync(
        path.join(
          roots.storeRoot,
          'rasen',
          'projects',
          'project-a',
          'changes',
          'stale-change'
        )
      )
    ).toBe(false);
  });

  it('preserves an existing Change when duplicate creation is attempted', async () => {
    const roots = storeFixture();
    const target = path.join(
      roots.storeRoot,
      'rasen',
      'projects',
      'project-a',
      'changes',
      'existing-change'
    );
    write(path.join(target, 'sentinel.txt'), 'keep me\n');
    const planning = resolver(roots);
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });

    await expect(
      scope.createChange({ changeId: 'existing-change', schema: 'spec-driven' })
    ).rejects.toMatchObject({ diagnostic: { code: 'change_already_exists' } });
    expect(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8')).toBe('keep me\n');
    expect(fs.existsSync(`${target}.create.lock`)).toBe(false);
  });

  it('serializes concurrent publication without clobbering or leaving residue', async () => {
    const roots = storeFixture();
    const planning = resolver(roots);
    const selection = {
      store: STORE_UID,
      project: 'project-a',
      targetLine: 'line-0.2',
    } as const;
    const [firstScope, secondScope] = await Promise.all([
      planning.open({ intent: 'create-change', startPath: roots.storeRoot, selection }),
      planning.open({ intent: 'create-change', startPath: roots.storeRoot, selection }),
    ]);

    const results = await Promise.allSettled([
      firstScope.createChange({ changeId: 'concurrent-change', schema: 'spec-driven' }),
      secondScope.createChange({ changeId: 'concurrent-change', schema: 'spec-driven' }),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof firstScope.createChange>>> =>
        result.status === 'fulfilled'
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    const target = path.join(
      roots.storeRoot,
      'rasen',
      'projects',
      'project-a',
      'changes',
      'concurrent-change'
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      diagnostic: { code: 'change_already_exists' },
    });
    expect(parseYaml(fs.readFileSync(path.join(target, '.openspec.yaml'), 'utf8'))).toMatchObject({
      schema: 'spec-driven',
      identity: {
        version: 2,
        storeUid: STORE_UID,
        projectId: 'project-a',
        targetLineId: 'line-0.2',
      },
    });
    expect(
      fs.readdirSync(path.dirname(target)).filter((name) =>
        name.startsWith('concurrent-change.')
      )
    ).toEqual([]);
  });

  it('rejects invalid schemas and caller-controlled identity without writing', async () => {
    const roots = storeFixture();
    const planning = resolver(roots);
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });
    const changesDir = path.join(
      roots.storeRoot,
      'rasen',
      'projects',
      'project-a',
      'changes'
    );

    await expect(
      scope.createChange({ changeId: 'invalid-schema', schema: 'missing-schema' })
    ).rejects.toThrow("Unknown schema 'missing-schema'");
    await expect(
      scope.createChange({
        changeId: 'identity-injection',
        schema: 'spec-driven',
        instanceSeed: 'caller-controlled',
      } as never)
    ).rejects.toMatchObject({ diagnostic: { code: 'invalid_change_creation' } });
    expect(fs.existsSync(changesDir)).toBe(false);
  });

  it('cleans staging and lock paths when publication is interrupted', async () => {
    const roots = storeFixture();
    const interrupted = Object.assign(new Error('interrupted publish'), { code: 'EIO' });
    const failingFs = {
      ...nodeStorePlanningFileSystem,
      link: async () => Promise.reject(interrupted),
    };
    const planning = resolver(roots, () => 'linked-worktree', { fs: failingFs });
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });
    const changesDir = path.join(
      roots.storeRoot,
      'rasen',
      'projects',
      'project-a',
      'changes'
    );

    await expect(
      scope.createChange({ changeId: 'interrupted-change', schema: 'spec-driven' })
    ).rejects.toMatchObject({ diagnostic: { code: 'change_publish_failed' } });
    expect(fs.readdirSync(changesDir)).toEqual([]);
  });

  it('maps a Windows EPERM publication collision to duplicate without residue', async () => {
    const roots = storeFixture();
    const collision = Object.assign(new Error('target exists'), { code: 'EPERM' });
    const failingFs = {
      ...nodeStorePlanningFileSystem,
      link: async () => Promise.reject(collision),
    };
    const planning = resolver(roots, () => 'linked-worktree', { fs: failingFs });
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });
    const changesDir = path.join(
      roots.storeRoot,
      'rasen',
      'projects',
      'project-a',
      'changes'
    );

    await expect(
      scope.createChange({ changeId: 'windows-collision', schema: 'spec-driven' })
    ).rejects.toMatchObject({ diagnostic: { code: 'change_already_exists' } });
    expect(fs.readdirSync(changesDir)).toEqual([]);
  });

  it('does not replace a non-cooperating POSIX-style target creator', async () => {
    const roots = storeFixture();
    const target = path.join(
      roots.storeRoot,
      'rasen',
      'projects',
      'project-a',
      'changes',
      'external-winner'
    );
    let raced = false;
    const racingFs = {
      ...nodeStorePlanningFileSystem,
      async mkdir(candidate: string, options?: { recursive?: boolean }) {
        if (candidate === target && !raced) {
          raced = true;
          fs.mkdirSync(target);
          write(path.join(target, 'external.txt'), 'external owner\n');
        }
        await nodeStorePlanningFileSystem.mkdir(candidate, options);
      },
    };
    const planning = resolver(roots, () => 'linked-worktree', { fs: racingFs });
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });

    await expect(
      scope.createChange({ changeId: 'external-winner', schema: 'spec-driven' })
    ).rejects.toMatchObject({ diagnostic: { code: 'change_already_exists' } });
    expect(fs.readFileSync(path.join(target, 'external.txt'), 'utf8')).toBe(
      'external owner\n'
    );
    expect(fs.existsSync(path.join(target, '.openspec.yaml'))).toBe(false);
  });

  it('never deletes a non-cooperating Windows-style replacement after reservation', async () => {
    const roots = storeFixture();
    const target = path.join(
      roots.storeRoot,
      'rasen',
      'projects',
      'project-a',
      'changes',
      'replacement-winner'
    );
    let links = 0;
    const racingFs = {
      ...nodeStorePlanningFileSystem,
      async link(source: string, destination: string) {
        links += 1;
        if (links === 2) {
          fs.rmSync(target, { recursive: true, force: true });
          fs.mkdirSync(target);
          write(path.join(target, 'external.txt'), 'replacement owner\n');
          write(path.join(target, '.openspec.yaml'), 'schema: spec-driven\n');
        }
        await nodeStorePlanningFileSystem.link(source, destination);
      },
    };
    const planning = resolver(roots, () => 'linked-worktree', { fs: racingFs });
    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });

    await expect(
      scope.createChange({
        changeId: 'replacement-winner',
        schema: 'spec-driven',
        description: 'forces a second linked entry',
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'change_publish_failed' } });
    expect(fs.readFileSync(path.join(target, 'external.txt'), 'utf8')).toBe(
      'replacement owner\n'
    );
    expect(fs.readFileSync(path.join(target, '.openspec.yaml'), 'utf8')).toBe(
      'schema: spec-driven\n'
    );
  });

  it('fails closed for Store integration checkout creation', async () => {
    const roots = storeFixture();
    const planning = resolver(roots, () => 'integration');

    await expect(
      planning.open({
        intent: 'create-change',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({
      diagnostic: { code: 'planning_worktree_required' },
    });
  });

  it('uses the nearest planning-worktree marker ahead of the registered integration root', async () => {
    const roots = storeFixture();
    const integrationRoot = path.join(path.dirname(roots.storeRoot), 'integration-store');
    fs.cpSync(path.join(roots.storeRoot, '.rasen-store'), path.join(integrationRoot, '.rasen-store'), {
      recursive: true,
    });
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotStores: async () => [
        { id: 'team-store', uid: STORE_UID, type: 'store', root: integrationRoot },
        { id: 'project-a', type: 'project', root: roots.projectRoot },
      ],
    });

    const scope = await planning.open({
      intent: 'create-change',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });
    const authored = await scope.createChange({
      changeId: 'direct-planning-worktree',
      schema: 'spec-driven',
    });

    expect(authored.location.absolutePath).toBe(
      path.join(
        roots.storeRoot,
        'rasen',
        'projects',
        'project-a',
        'changes',
        'direct-planning-worktree'
      )
    );
    expect(fs.existsSync(path.join(integrationRoot, 'rasen', 'projects'))).toBe(false);
  });

  it('does not let an unrelated Store checkout in the start path redirect an explicit selection', async () => {
    const roots = storeFixture();
    const unrelatedUid = '223e4567-e89b-42d3-a456-426614174000';
    const unrelatedRoot = path.join(path.dirname(roots.storeRoot), 'unrelated-store');
    write(
      path.join(unrelatedRoot, '.rasen-store', 'store.yaml'),
      `version: 2\nuid: ${unrelatedUid}\nid: unrelated-store\nlayoutVersion: 2\n`
    );
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotStores: async () => [
        { id: 'team-store', uid: STORE_UID, type: 'store', root: roots.storeRoot },
        { id: 'unrelated-store', uid: unrelatedUid, type: 'store', root: unrelatedRoot },
        { id: 'project-a', type: 'project', root: roots.projectRoot },
      ],
    });

    // Standing inside store `unrelated-store` must not decide a fully explicit
    // three-part selection of `team-store`: commands addressing the same scope
    // agree regardless of the directory they run from.
    const scope = await planning.open({
      intent: 'project-read',
      startPath: unrelatedRoot,
      selection: { store: 'team-store', project: 'project-a', targetLine: 'line-0.2' },
    });

    expect(scope.describe().paths['planning-checkout']).toBe(roots.storeRoot);
    expect(scope.locate({ kind: 'active-changes' }).absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'changes')
    );
  });

  it('keeps other projects and the aggregate usable when one sibling catalog is unreadable', async () => {
    const roots = storeFixture();
    const brokenPath = path.join(
      roots.storeRoot,
      '.rasen-store',
      'projects',
      'project-b.yaml'
    );
    write(brokenPath, 'version: 2\nprojectId: [unclosed\n');
    const planning = resolver(roots);

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.storeRoot,
      selection: { store: 'team-store', project: 'project-a', targetLine: 'line-0.2' },
    });
    expect(scope.locate({ kind: 'active-changes' }).absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'changes')
    );
    expect(
      scope.describe().notices.find((notice) => notice.code === 'invalid_project_catalog')?.message
    ).toContain('project-b.yaml');

    // Doctor reads the Store aggregate; the surface that REPORTS a broken Store
    // must not be stopped by one.
    const aggregate = await planning.open({
      intent: 'store-read',
      startPath: roots.storeRoot,
      selection: { store: 'team-store' },
    });
    expect(aggregate.describe().kind).toBe('store-aggregate');
    expect(aggregate.describe().notices.map((notice) => notice.code)).toContain(
      'invalid_project_catalog'
    );
  });

  it('names the offending catalog file when the selected project cannot be read', async () => {
    const roots = storeFixture();
    const brokenPath = path.join(
      roots.storeRoot,
      '.rasen-store',
      'projects',
      'project-a.yaml'
    );
    write(brokenPath, 'version: 2\nprojectId: [unclosed\n');
    const planning = resolver(roots);

    await expect(
      planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: 'team-store', project: 'project-a', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({
      diagnostic: { code: 'invalid_project_catalog', target: brokenPath },
    });
  });

  it('returns configuration inheritance as a standalone scope, not as a thrown diagnostic', async () => {
    const roots = storeFixture({ localPlanning: true });
    // The Store knows the project but does not claim its planning.
    write(
      path.join(roots.storeRoot, '.rasen-store', 'projects', 'project-a.yaml'),
      'version: 2\nprojectId: project-a\nid: project-a\nroles:\n  planning: false\n  knowledge: true\nplanningBinding:\n  state: unbound\n'
    );
    const planning = resolver(roots);

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.projectRoot,
    });

    const description = scope.describe();
    expect(description.kind).toBe('standalone');
    expect(description.notices.map((notice) => notice.code)).toContain(
      'configuration_store_inheritance'
    );
    expect(scope.locate({ kind: 'active-changes' }).absolutePath).toBe(
      path.join(roots.projectRoot, 'rasen', 'changes')
    );
  });

  it('reports the unbound planning relationship for a pointer checkout with no local planning', async () => {
    const roots = storeFixture();
    write(
      path.join(roots.storeRoot, '.rasen-store', 'projects', 'project-a.yaml'),
      'version: 2\nprojectId: project-a\nid: project-a\nroles:\n  planning: false\n  knowledge: true\nplanningBinding:\n  state: unbound\n'
    );
    const planning = resolver(roots);

    // No local planning shape, so there is nothing to inherit INTO: membership
    // without a bound planning state must be reported, never answered with the
    // Store's flat root.
    await expect(
      planning.open({ intent: 'project-read', startPath: roots.projectRoot })
    ).rejects.toMatchObject({ diagnostic: { code: 'project_not_in_store' } });
  });

  it('detects split planning truth and allows only Store-backed reads', async () => {
    const roots = storeFixture({ localPlanning: true });
    write(
      path.join(roots.projectRoot, '.rasen', 'planning-binding.json'),
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: 'project-a',
        targetLineId: 'line-0.2',
        planningWorktree: roots.storeRoot,
      }) + '\n'
    );
    const planning = resolver(roots);
    const read = await planning.open({
      intent: 'project-read',
      startPath: roots.projectRoot,
      selection: { project: 'project-a', targetLine: 'line-0.2' },
    });

    expect(read.describe().notices.map((notice) => notice.code)).toContain(
      'split_planning_truth'
    );
    expect(read.locate({ kind: 'specs' }).absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'specs')
    );
    await expect(
      planning.open({
        intent: 'create-change',
        startPath: roots.projectRoot,
        selection: { project: 'project-a', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'split_planning_truth' } });
  });

  it('reports every project claimant and actionable pruning for duplicate identities', async () => {
    const roots = storeFixture();
    const missingRoot = path.join(
      path.dirname(roots.projectRoot),
      'missing-project-copy'
    );
    const entry = {
      projectId: 'project-a',
      name: 'project-a',
      mode: 'store' as const,
      home: 'project-a-home',
      lastSeen: '2026-08-06T00:00:00.000Z',
    };
    const aliasEntry = {
      ...entry,
      projectId: entry.projectId.toUpperCase(),
    };
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotProjects: async () => [
        { root: roots.projectRoot, entry },
        { root: missingRoot, entry: aliasEntry },
      ],
      findProjectIdentityClaimants: async () => [
        projectClaimant(roots.projectRoot, entry, true),
        projectClaimant(missingRoot, aliasEntry, false),
      ],
    });

    let thrown: unknown;
    try {
      await planning.open({
        intent: 'project-read',
        startPath: roots.projectRoot,
        selection: { project: 'project-a' },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlanningScopeError);
    const diagnostic = (thrown as PlanningScopeError).diagnostic;
    const message = (thrown as PlanningScopeError).message;
    expect(message).toContain(`${roots.projectRoot} (live)`);
    expect(message).toContain(`${missingRoot} (missing)`);
    expect(message).toContain('Run `rasen home prune` to preview');
    expect(message).toContain('then `rasen home prune --apply`');
    expect(diagnostic.fix).toBe(
      'Run rasen home prune to preview, then rasen home prune --apply and retry.'
    );
  });

  it('refuses a canonical claimant whose live aliases conflict on fixed metadata', async () => {
    const roots = storeFixture({ marker: false });
    const fixtureRoot = path.dirname(roots.projectRoot);
    const aliasRoot = path.join(temporaryRoot(), 'project-a-fixed-metadata-alias');
    fs.symlinkSync(
      roots.projectRoot,
      aliasRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const directEntry = {
      projectId: 'project-a',
      name: 'project-a',
      mode: 'store' as const,
      home: 'project-a-home',
      lastSeen: '2026-08-06T00:00:00.000Z',
    };
    const aliasEntry = {
      ...directEntry,
      projectId: 'PROJECT-A',
      name: 'project-a-alias',
      home: 'other-project-home',
    };
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotProjects: async () => [
        { root: roots.projectRoot, entry: directEntry },
        { root: aliasRoot, entry: aliasEntry },
      ],
      findProjectIdentityClaimants: async () => [{
        root: roots.projectRoot,
        entry: directEntry,
        live: true,
        aliases: [
          {
            registryPath: roots.projectRoot,
            canonicalPath: roots.projectRoot,
            entry: directEntry,
            live: true,
            direct: true,
          },
          {
            registryPath: aliasRoot,
            canonicalPath: roots.projectRoot,
            entry: aliasEntry,
            live: true,
            direct: false,
          },
        ],
        fixedMetadataConflict: true,
      }],
    });
    const before = snapshotTreeBytes(fixtureRoot);

    await expect(
      planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { project: directEntry.projectId },
      })
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'planning_selection_conflict',
        target: 'selection.project',
        fix: expect.stringContaining('projectId or home metadata'),
      },
    });
    expect(snapshotTreeBytes(fixtureRoot)).toEqual(before);
  });

  it.each([
    ['normalized id', 'project-a'],
    ['display name', 'friendly-project'],
    ['absolute root', 'absolute-root'],
  ])('rejects registry/config identity drift selected by %s without mutation', async (_kind, rawSelector) => {
    const roots = storeFixture({ marker: false });
    const fixtureRoot = path.dirname(roots.projectRoot);
    const configPath = path.join(roots.projectRoot, 'rasen', 'config.yaml');
    write(
      configPath,
      `schema: spec-driven\nprojectId: drifted-project\nstore:\n  uid: ${STORE_UID}\n  id: team-store\n`
    );
    const entry = {
      projectId: 'PROJECT-A',
      name: 'friendly-project',
      mode: 'store' as const,
      home: 'project-a-home',
      lastSeen: '2026-08-06T00:00:00.000Z',
    };
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotProjects: async () => [{ root: roots.projectRoot, entry }],
      findProjectIdentityClaimants: async () => [
        projectClaimant(roots.projectRoot, entry, true),
      ],
    });
    const selector = rawSelector === 'absolute-root' ? roots.projectRoot : rawSelector;
    const before = snapshotTreeBytes(fixtureRoot);

    let thrown: unknown;
    try {
      await planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { project: selector },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlanningScopeError);
    const conflict = thrown as PlanningScopeError;
    expect(conflict.diagnostic.code).toBe('planning_selection_conflict');
    expect(conflict.diagnostic.target).toBe(configPath);
    expect(conflict.message).toContain("registry identity 'PROJECT-A'");
    expect(conflict.message).toContain("config identity 'drifted-project'");
    expect(snapshotTreeBytes(fixtureRoot)).toEqual(before);
  });

  it.each([
    ['normalized id', 'project-a'],
    ['display name', 'friendly-project'],
    ['absolute root', 'absolute-root'],
  ])('expands a %s selector to conflicting aliases at its canonical root without mutation', async (_kind, rawSelector) => {
    const roots = storeFixture({ marker: false });
    const fixtureRoot = path.dirname(roots.projectRoot);
    const aliasRoot = path.join(temporaryRoot(), 'project-a-alias');
    fs.symlinkSync(
      roots.projectRoot,
      aliasRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const selectedEntry = {
      projectId: 'project-a',
      name: 'friendly-project',
      mode: 'store' as const,
      home: 'project-a-home',
      lastSeen: '2026-08-06T00:00:00.000Z',
    };
    const siblingEntry = {
      ...selectedEntry,
      projectId: 'other-project',
      name: 'other-project',
      home: 'other-project-home',
    };
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotProjects: async () => [
        { root: roots.projectRoot, entry: selectedEntry },
        { root: aliasRoot, entry: siblingEntry },
      ],
    });
    const selector = rawSelector === 'absolute-root' ? roots.projectRoot : rawSelector;
    const before = snapshotTreeBytes(fixtureRoot);

    let thrown: unknown;
    try {
      await planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { project: selector },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlanningScopeError);
    const conflict = thrown as PlanningScopeError;
    expect(conflict.diagnostic).toMatchObject({
      code: 'planning_selection_conflict',
      target: 'selection.project',
    });
    expect(conflict.message).toContain('project-a');
    expect(conflict.message).toContain('other-project');
    expect(snapshotTreeBytes(fixtureRoot)).toEqual(before);
  });

  it('accepts equivalent normalized registry and config identities', async () => {
    const roots = storeFixture({ marker: false });
    const configPath = path.join(roots.projectRoot, 'rasen', 'config.yaml');
    write(
      configPath,
      `schema: spec-driven\nprojectId: PROJECT-A\nstore:\n  uid: ${STORE_UID}\n  id: team-store\n`
    );
    const entry = {
      projectId: 'project-a',
      name: 'friendly-project',
      mode: 'store' as const,
      home: 'project-a-home',
      lastSeen: '2026-08-06T00:00:00.000Z',
    };
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotProjects: async () => [{ root: roots.projectRoot, entry }],
      findProjectIdentityClaimants: async () => [
        projectClaimant(roots.projectRoot, entry, true),
      ],
    });

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.storeRoot,
      selection: { project: 'friendly-project' },
    });

    expect(scope.describe().kind).toBe('store-project');
    expect(scope.describe().ref).toMatchObject({ projectId: 'project-a' });
  });

  it('unifies a legacy worktree root with its machine-registered main checkout', async () => {
    const roots = storeFixture();
    const mainRoot = path.join(path.dirname(roots.projectRoot), 'project-a-main');
    fs.mkdirSync(mainRoot, { recursive: true });
    const entry = {
      projectId: 'project-a',
      name: 'project-a',
      mode: 'store' as const,
      home: 'project-a-home',
      lastSeen: '2026-08-06T00:00:00.000Z',
    };
    const planning = resolver(roots, () => 'linked-worktree', {
      snapshotProjects: async () => [{ root: mainRoot, entry }],
      findRegisteredProject: async () => ({ root: mainRoot, entry }),
    });

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.projectRoot,
      selection: { project: 'project-a', targetLine: 'line-0.2' },
    });

    expect(scope.describe().kind).toBe('store-project');
    expect(scope.describe().paths['execution-root']).toBe(roots.projectRoot);
  });

  it('pierces a legacy worktree registry duplicate to its registered main checkout', async () => {
    const root = temporaryRoot();
    const mainRoot = path.join(root, 'registry-main');
    const worktreeRoot = path.join(root, 'registry-linked');
    const globalDataDir = path.join(root, 'machine-home');
    fs.mkdirSync(mainRoot, { recursive: true });
    const gitEnv = { ...process.env, ...isolatedGitEnv(root) };
    execFileSync('git', ['init'], {
      cwd: mainRoot,
      env: gitEnv,
      stdio: 'ignore',
    });
    write(path.join(mainRoot, 'README.md'), 'main\n');
    execFileSync('git', ['add', 'README.md'], {
      cwd: mainRoot,
      env: gitEnv,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'initial'], {
      cwd: mainRoot,
      env: gitEnv,
      stdio: 'ignore',
    });
    execFileSync('git', ['worktree', 'add', worktreeRoot], {
      cwd: mainRoot,
      env: gitEnv,
      stdio: 'ignore',
    });

    const main = await registerProject(
      {
        projectRoot: mainRoot,
        projectId: STORE_UID,
        mode: 'in-repo',
      },
      { globalDataDir }
    );
    const canonicalWorktree = fs.realpathSync.native(worktreeRoot);
    await updateProjectRegistryState(
      current => ({
        version: 1,
        projects: {
          ...(current?.projects ?? {}),
          [canonicalWorktree]: {
            ...main.entry,
            name: 'registry-linked',
          },
        },
      }),
      { globalDataDir }
    );

    const found =
      await productionStorePlanningDependencies.findRegisteredProject(
        worktreeRoot,
        globalDataDir
      );

    expect(found?.root).toBe(main.canonicalPath);
    expect(found?.entry.projectId).toBe(main.entry.projectId);
  });

  it('rejects conflicts instead of letting explicit evidence rewrite a marker', async () => {
    const roots = storeFixture();
    const markerPath = path.join(roots.storeRoot, '.rasen', 'planning-line.json');
    write(
      markerPath,
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: 'project-a',
        targetLineId: 'main',
      }) + '\n'
    );
    const planning = resolver(roots);

    await expect(
      planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
    ).rejects.toBeInstanceOf(PlanningScopeError);
    await expect(
      planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'planning_selection_conflict' } });
  });
});

/**
 * `store-planning-worktree-bindings` tasks 8.4, 8.5, and 12.4.
 *
 * A command inside a session USES the frozen pair. It does not re-derive it
 * from the working directory, and when the live worktree disagrees with what
 * the session froze — removed, replaced, or on another ref — it fails closed
 * naming both values rather than continuing in whatever the directory happens
 * to be.
 */
describe('a session freezes the worktree pair', () => {
  const PLANNING_INSTANCE = deriveWorktreeInstanceId({
    repositoryIdentity: '/store/.git',
    worktreeIdentity: '/store--fix-a',
  });

  function sessionContextFile(
    roots: { storeRoot: string; projectRoot: string },
    worktree?: { root: string; worktreeInstanceId: string; ref?: string }
  ): string {
    const contextPath = path.join(path.dirname(roots.storeRoot), 'session-context.json');
    write(
      contextPath,
      JSON.stringify({
        version: 2,
        sessionId: 'session-frozen',
        planning: {
          type: 'store',
          uid: STORE_UID,
          id: 'team-store',
          projectId: 'project-a',
          targetLineId: 'line-0.2',
          root: roots.storeRoot,
          ...(worktree === undefined ? {} : { worktree }),
        },
        execution: { kind: 'project', projectId: 'project-a', root: roots.projectRoot },
      })
    );
    return contextPath;
  }

  function filesUnder(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        out.push(`${path.relative(root, absolute)}:${fs.readFileSync(absolute, 'utf8')}`);
      }
    };
    walk(root);
    return out.sort();
  }

  it('resolves the frozen planning root from a completely unrelated directory', async () => {
    const roots = storeFixture();
    const elsewhere = path.join(path.dirname(roots.storeRoot), 'somewhere-else');
    fs.mkdirSync(elsewhere, { recursive: true });
    const contextPath = sessionContextFile(roots, {
      root: roots.storeRoot,
      worktreeInstanceId: PLANNING_INSTANCE,
    });
    const planning = resolver(roots, () => 'linked-worktree', {
      sessionContextPath: () => contextPath,
      probePlanningWorktree: async () => ({
        isWorktree: true,
        linked: true,
        worktreeInstanceId: PLANNING_INSTANCE,
        storeRefOid: 'a'.repeat(40),
      }),
    });

    const scope = await planning.open({ intent: 'project-read', startPath: elsewhere });

    expect(scope.describe().paths['planning-checkout']).toBe(roots.storeRoot);
    expect(scope.locate({ kind: 'active-changes' }).absolutePath).toBe(
      path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'changes')
    );
  });

  it('fails closed when the frozen planning worktree is no longer a worktree', async () => {
    const roots = storeFixture();
    const contextPath = sessionContextFile(roots, {
      root: roots.storeRoot,
      worktreeInstanceId: PLANNING_INSTANCE,
    });
    const planning = resolver(roots, () => 'linked-worktree', {
      sessionContextPath: () => contextPath,
      probePlanningWorktree: async () => ({ isWorktree: false, linked: false }),
    });

    await expect(
      planning.open({ intent: 'project-read', startPath: roots.storeRoot })
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'planning_execution_binding_mismatch',
        details: { frozenWorktreeInstanceId: PLANNING_INSTANCE, liveWorktreeInstanceId: null },
      },
    });
  });

  it('fails closed when the frozen worktree no longer re-derives its identity', async () => {
    const roots = storeFixture();
    const contextPath = sessionContextFile(roots, {
      root: roots.storeRoot,
      worktreeInstanceId: PLANNING_INSTANCE,
    });
    const live = deriveWorktreeInstanceId({
      repositoryIdentity: '/other/.git',
      worktreeIdentity: '/other--fix-a',
    });
    const planning = resolver(roots, () => 'linked-worktree', {
      sessionContextPath: () => contextPath,
      probePlanningWorktree: async () => ({
        isWorktree: true,
        linked: true,
        worktreeInstanceId: live,
        storeRefOid: 'a'.repeat(40),
      }),
    });

    await expect(
      planning.open({ intent: 'project-read', startPath: roots.storeRoot })
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'planning_execution_binding_mismatch',
        details: { frozenWorktreeInstanceId: PLANNING_INSTANCE, liveWorktreeInstanceId: live },
      },
    });
  });

  it('fails closed when the frozen worktree has been switched to another ref, naming both', async () => {
    const roots = storeFixture();
    const contextPath = sessionContextFile(roots, {
      root: roots.storeRoot,
      worktreeInstanceId: PLANNING_INSTANCE,
      ref: 'refs/heads/change/line-0.2/project-a/fix-a',
    });
    const planning = resolver(roots, () => 'linked-worktree', {
      sessionContextPath: () => contextPath,
      probePlanningWorktree: async () => ({
        isWorktree: true,
        linked: true,
        worktreeInstanceId: PLANNING_INSTANCE,
        ref: 'refs/heads/user-moved-me',
        storeRefOid: 'a'.repeat(40),
      }),
    });

    await expect(
      planning.open({ intent: 'project-read', startPath: roots.storeRoot })
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'planning_execution_binding_mismatch',
        details: {
          frozenRef: 'refs/heads/change/line-0.2/project-a/fix-a',
          liveRef: 'refs/heads/user-moved-me',
        },
      },
    });
  });

  it('refuses a mutation the frozen root cannot authorize instead of falling back to the directory', async () => {
    // The session records NO pair, and the frozen planning root is the Store
    // integration checkout. A session never re-derives its scope from the
    // working directory, so the refusal stands whatever the directory is.
    const roots = storeFixture();
    const contextPath = sessionContextFile(roots);
    const planning = resolver(roots, () => 'integration', {
      sessionContextPath: () => contextPath,
    });

    await expect(
      planning.open({
        intent: 'create-change',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'planning_worktree_required' } });
  });

  it('leaves the Store integration checkout byte-identical when a mutation is refused', async () => {
    const roots = storeFixture();
    const planning = resolver(roots, () => 'integration');
    const before = filesUnder(roots.storeRoot);

    await expect(
      planning.open({
        intent: 'create-change',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'planning_worktree_required' } });

    expect(filesUnder(roots.storeRoot)).toEqual(before);
    expect(
      fs.existsSync(path.join(roots.storeRoot, 'rasen', 'projects', 'project-a', 'changes'))
    ).toBe(false);
  });
});

describe('typed path flavor validation', () => {
  it('uses win32 path semantics and rejects Windows device aliases on every host', async () => {
    const roots = storeFixture();
    const planning = resolver(roots);
    await expect(
      planning.open({
        intent: 'project-read',
        startPath: 'C:\\Store',
        pathFlavor: 'win32',
        selection: { store: STORE_UID, project: 'con', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({
      diagnostic: { code: expect.stringMatching(/invalid|project_not_in_store/u) },
    });
  });
});

/**
 * `store-scope-resolution` D1 — a Store aggregate is not a project, so a Store
 * checkout's own committed root config contributes no projectId fact.
 */
describe('store-checkout root configuration as scope evidence', () => {
  it('excludes a Store checkout root config projectId from the fact merge', async () => {
    const roots = storeFixture();
    // The setup-time id `store setup` mints into the Store's own root config.
    // It belongs to no project catalog, so admitting it could only collide
    // with the marker's partition id — which is exactly the refusal this
    // removes.
    write(
      path.join(roots.storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprojectId: a7c28fc7-3091-41eb-84c4-af737bfcce97\n'
    );
    const planning = resolver(roots);

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.storeRoot,
    });

    expect(scope.describe().ref).toMatchObject({
      mode: 'store-project',
      projectId: 'project-a',
    });
    expect(
      scope
        .describe()
        .evidence.filter((item) => item.value === 'a7c28fc7-3091-41eb-84c4-af737bfcce97')
    ).toEqual([]);
  });

  it('suppresses the root config projectId for a Store with no project catalog at all', async () => {
    // Every registered Store on a real machine carries a setup-minted root
    // projectId that belongs to no catalog, so this branch is the COMMON path,
    // not an edge case — and it has to hold for a Store that has no catalog
    // directory to be a member of. Pre-fix this refused with "Project
    // 'a7c28fc7-…' is not in the selected Store's v2 catalog", a dead end
    // naming an id the caller never chose.
    const roots = storeFixture({ marker: false });
    fs.rmSync(path.join(roots.storeRoot, '.rasen-store', 'projects'), {
      recursive: true,
      force: true,
    });
    write(
      path.join(roots.storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprojectId: a7c28fc7-3091-41eb-84c4-af737bfcce97\n'
    );
    const planning = resolver(roots);

    const error = await planning
      .open({ intent: 'project-read', startPath: roots.storeRoot })
      .then(
        () => null,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(PlanningScopeError);
    const diagnostic = (error as PlanningScopeError).diagnostic;
    // A named selector requirement, not an orphan-id dead end.
    expect(diagnostic.code).toBe('project_scope_required');
    expect(diagnostic.fix).toContain('--project');
    expect(diagnostic.message).not.toContain('a7c28fc7-3091-41eb-84c4-af737bfcce97');

    // The Store aggregate itself still resolves from the same seat.
    const aggregate = await planning.open({
      intent: 'store-read',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID },
    });
    expect(aggregate.describe().kind).toBe('store-aggregate');
  });

  it('still admits a standalone project root config projectId', async () => {
    const roots = storeFixture({ marker: false, localPlanning: true });
    // No Store metadata at this root, so nothing about D1 applies to it.
    write(
      path.join(roots.projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprojectId: project-a\n'
    );
    const planning = resolver(roots);

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.projectRoot,
    });

    expect(scope.describe().ref).toMatchObject({
      mode: 'standalone',
      projectId: 'project-a',
    });
    expect(scope.describe().evidence.some((item) => item.value === 'project-a')).toBe(true);
  });

  it('refuses when the marker and the execution association name different projects', async () => {
    const roots = storeFixture();
    write(
      path.join(roots.storeRoot, '.rasen-store', 'projects', 'project-b.yaml'),
      'version: 2\nprojectId: project-b\nid: project-b\nroles:\n  planning: true\n  knowledge: false\nplanningBinding:\n  state: bound\n  boundAt: 2026-08-06T00:00:00.000Z\n'
    );
    // The marker (in the Store checkout) says project-a; the association (in
    // the execution checkout) says project-b. Neither wins: the merge names
    // both sources and both values, and nothing is written.
    write(
      path.join(roots.projectRoot, '.rasen', 'planning-binding.json'),
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: 'project-b',
        targetLineId: 'line-0.2',
        planningWorktree: roots.storeRoot,
      }) + '\n'
    );
    const planning = resolver(roots);

    const error = await planning
      .open({ intent: 'project-read', startPath: roots.projectRoot })
      .then(
        () => null,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(PlanningScopeError);
    const diagnostic = (error as PlanningScopeError).diagnostic;
    expect(diagnostic.code).toBe('planning_selection_conflict');
    expect(diagnostic.message).toContain('planning-worktree-marker');
    expect(diagnostic.message).toContain('execution-association');
    expect(diagnostic.message).toContain('project-a');
    expect(diagnostic.message).toContain('project-b');
  });

  it('still refuses a genuine conflict between an explicit selector and the marker', async () => {
    const roots = storeFixture();
    write(
      path.join(roots.storeRoot, '.rasen-store', 'projects', 'project-b.yaml'),
      'version: 2\nprojectId: project-b\nid: project-b\nroles:\n  planning: true\n  knowledge: false\nplanningBinding:\n  state: bound\n  boundAt: 2026-08-06T00:00:00.000Z\n'
    );
    const planning = resolver(roots);

    // The marker names project-a; the caller names project-b. Suppressing the
    // root config's fact must not suppress a real disagreement.
    await expect(
      planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-b', targetLine: 'line-0.2' },
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'planning_selection_conflict' } });
  });
});

/**
 * `store-scope-resolution` D3 — the planning-bound gate's two satisfiers and
 * its two refusals.
 */
describe('the planning-bound gate', () => {
  function unboundCatalog(roots: { storeRoot: string }): void {
    write(
      path.join(roots.storeRoot, '.rasen-store', 'projects', 'project-a.yaml'),
      'version: 2\nprojectId: project-a\nid: project-a\nroles:\n  planning: true\n  knowledge: true\nplanningBinding:\n  state: unbound\n'
    );
  }

  function recordedPair(
    roots: { storeRoot: string; projectRoot: string },
    overrides: { markerProjectId?: string } = {}
  ): readonly WorkspacePairSnapshot[] {
    const executionRoot = roots.projectRoot;
    write(
      path.join(roots.storeRoot, '.rasen', 'planning-line.json'),
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: overrides.markerProjectId ?? 'project-a',
        targetLineId: 'line-0.2',
        executionRoot,
      }) + '\n'
    );
    write(
      path.join(executionRoot, '.rasen', 'planning-binding.json'),
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: 'project-a',
        targetLineId: 'line-0.2',
        planningWorktree: roots.storeRoot,
        executionRoot,
      }) + '\n'
    );
    return [
      {
        planningScopeId: 'ps_fixture',
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: 'project-a',
        targetLineId: 'line-0.2',
        changeId: 'some-change',
        planningRoot: roots.storeRoot,
        executionRoot,
      },
    ];
  }

  it('admits an unbound catalog when a consistent pair is recorded', async () => {
    const roots = storeFixture();
    unboundCatalog(roots);
    const pairs = recordedPair(roots);
    const planning = resolver(roots, () => 'linked-worktree', {
      listWorkspacePairs: async () => pairs,
    });

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });

    expect(scope.describe().ref).toMatchObject({
      mode: 'store-project',
      projectId: 'project-a',
    });
  });

  it('admits a bound catalog with no pair recorded on this machine', async () => {
    const roots = storeFixture();
    const planning = resolver(roots, () => 'linked-worktree', {
      listWorkspacePairs: async () => [],
    });

    const scope = await planning.open({
      intent: 'project-read',
      startPath: roots.storeRoot,
      selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
    });

    expect(scope.describe().ref).toMatchObject({
      mode: 'store-project',
      projectId: 'project-a',
    });
  });

  it('refuses with the pair repair when neither the catalog nor a pair holds', async () => {
    const roots = storeFixture();
    unboundCatalog(roots);
    const planning = resolver(roots, () => 'linked-worktree', {
      listWorkspacePairs: async () => [],
    });

    const error = await planning
      .open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
      .then(
        () => null,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(PlanningScopeError);
    const diagnostic = (error as PlanningScopeError).diagnostic;
    expect(diagnostic.code).toBe('project_not_in_store');
    expect(diagnostic.fix).toContain(
      'rasen store workspace plan --store team-store --project project-a --target-line line-0.2'
    );
  });

  it('refuses as a conflict when the recorded pair disagrees with itself', async () => {
    const roots = storeFixture();
    unboundCatalog(roots);
    // The marker now names a different project than the index entry does.
    const pairs = recordedPair(roots, { markerProjectId: 'project-zeta' });
    const planning = resolver(roots, () => 'linked-worktree', {
      listWorkspacePairs: async () => pairs,
    });

    const error = await planning
      .open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
      .then(
        () => null,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(PlanningScopeError);
    expect((error as PlanningScopeError).diagnostic.message).toContain('project-zeta');
  });

  /**
   * A SECOND recorded pair for the same project and target line, rooted
   * OUTSIDE the seat.
   *
   * Nothing written here can reach scope selection: `readMarkerFact` and
   * `readAssociationFact` only ever look at the seat's own store root and
   * project root, so these files reach the resolver through the planning-bound
   * gate and through nothing else. That is what makes the multi-pair shape
   * testable at all - and it is the NORMAL machine shape, one index entry per
   * Change.
   */
  function siblingPair(
    overrides: { markerProjectId?: string; associationTargetLineId?: string } = {}
  ): WorkspacePairSnapshot {
    const root = temporaryRoot();
    const planningRoot = path.join(root, 'sibling-planning');
    const executionRoot = path.join(root, 'sibling-execution');
    write(
      path.join(planningRoot, '.rasen', 'planning-line.json'),
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: overrides.markerProjectId ?? 'project-a',
        targetLineId: 'line-0.2',
        executionRoot,
      }) + '\n'
    );
    write(
      path.join(executionRoot, '.rasen', 'planning-binding.json'),
      JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId: 'team-store',
        projectId: 'project-a',
        targetLineId: overrides.associationTargetLineId ?? 'line-0.2',
        planningWorktree: planningRoot,
        executionRoot,
      }) + '\n'
    );
    return {
      planningScopeId: `ps_sibling_${path.basename(root)}`,
      storeUid: STORE_UID,
      storeId: 'team-store',
      projectId: 'project-a',
      targetLineId: 'line-0.2',
      changeId: 'sibling-change',
      planningRoot,
      executionRoot,
    };
  }

  it('admits an agreeing pair while a sibling pair for the same line is torn', async () => {
    // The pinned semantics: each pair is an independent witness for the same
    // subject, so one fully agreeing pair settles the gate and a sibling's torn
    // evidence is not counter-evidence against it. Both enumeration orders are
    // asserted because the index yields pairs in no guaranteed order and the
    // verdict must not depend on which one is read first.
    for (const order of ['agreeing-first', 'torn-first'] as const) {
      const roots = storeFixture();
      unboundCatalog(roots);
      const agreeing = recordedPair(roots);
      const torn = siblingPair({ markerProjectId: 'project-zeta' });
      const pairs =
        order === 'agreeing-first' ? [...agreeing, torn] : [torn, ...agreeing];
      const planning = resolver(roots, () => 'linked-worktree', {
        listWorkspacePairs: async () => pairs,
      });

      const scope = await planning.open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      });

      expect(scope.describe().ref, order).toMatchObject({
        mode: 'store-project',
        projectId: 'project-a',
      });
    }
  });

  it('refuses through the GATE when the only recorded pair is torn', async () => {
    const roots = storeFixture();
    unboundCatalog(roots);
    // The seat's own marker agrees with the selector, so the fact merge has
    // nothing to refuse: the only source that can name this root is the gate.
    const torn = siblingPair({ markerProjectId: 'project-zeta' });
    const planning = resolver(roots, () => 'linked-worktree', {
      listWorkspacePairs: async () => [torn],
    });

    const error = await planning
      .open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
      .then(
        () => null,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(PlanningScopeError);
    const diagnostic = (error as PlanningScopeError).diagnostic;
    expect(diagnostic.code).toBe('planning_selection_conflict');
    expect(diagnostic.message).toContain(torn.planningRoot);
    expect(diagnostic.message).toContain('project-zeta');
  });

  it('names every torn pair when no pair agrees', async () => {
    const roots = storeFixture();
    unboundCatalog(roots);
    const tornMarker = siblingPair({ markerProjectId: 'project-zeta' });
    const tornAssociation = siblingPair({ associationTargetLineId: 'line-0.9' });
    const planning = resolver(roots, () => 'linked-worktree', {
      listWorkspacePairs: async () => [tornMarker, tornAssociation],
    });

    const error = await planning
      .open({
        intent: 'project-read',
        startPath: roots.storeRoot,
        selection: { store: STORE_UID, project: 'project-a', targetLine: 'line-0.2' },
      })
      .then(
        () => null,
        (caught: unknown) => caught
      );

    expect(error).toBeInstanceOf(PlanningScopeError);
    const diagnostic = (error as PlanningScopeError).diagnostic;
    expect(diagnostic.code).toBe('planning_selection_conflict');
    // The refusal enumerates the whole torn set, not the first one found.
    expect(diagnostic.message).toContain('project-zeta');
    expect(diagnostic.message).toContain('line-0.9');
    expect(diagnostic.message).toContain(tornMarker.planningRoot);
    expect(diagnostic.message).toContain(tornAssociation.executionRoot);
  });
});
