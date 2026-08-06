import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  createStorePlanningResolverForTesting,
  nodeStorePlanningFileSystem,
  type StorePlanningDependencies,
} from '../../../src/core/store-planning/testing.js';
import { PlanningScopeError } from '../../../src/core/store-planning/index.js';
import { parseChangeInstanceSeed } from '../../../src/core/store/planning-foundation.js';

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

function resolver(
  roots: { storeRoot: string; projectRoot: string },
  role: StorePlanningDependencies['checkoutRole'] = () => 'linked-worktree',
  overrides: Partial<StorePlanningDependencies> = {}
) {
  const dependencies: StorePlanningDependencies = {
    fs: overrides.fs ?? nodeStorePlanningFileSystem,
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
    findRegisteredProject: async () => null,
    sessionContextPath: () => undefined,
    checkoutRole: overrides.checkoutRole ?? role,
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
