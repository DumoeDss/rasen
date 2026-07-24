import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  freezeKnowledgeContext,
  KnowledgeContextError,
  resolveLearnedSkillExecutionContext,
} from '../../../src/core/learned-skills/index.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { getStoreMetadataPath } from '../../../src/core/store/foundation.js';
import {
  commitStoreRegistration,
  registerStore,
} from '../../../src/core/store/registry.js';

describe('learned-skill execution context', () => {
  let tempDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-knowledge-context-'))
    );
    globalDataDir = path.join(tempDir, 'data');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createHealthyRoot(root: string, config = 'schema: spec-driven\n'): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), config);
    return fs.realpathSync.native(root);
  }

  async function createProject(name: string): Promise<{ root: string; id: string }> {
    const root = createHealthyRoot(path.join(tempDir, name));
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, id: home!.projectId };
  }

  async function registerTyped(
    type: 'project' | 'store',
    id: string,
    root: string
  ): Promise<void> {
    await commitStoreRegistration({
      id,
      type,
      backend: { type: 'git', local_path: root },
      writeMetadataIfMissing: true,
      globalDataDir,
    });
  }

  it('resolves an in-repo project from verified project registry identity', async () => {
    const project = await createProject('app');
    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: path.join(project.root, 'rasen'),
      requestedScope: 'project',
      globalDataDir,
    });

    expect(context.owner).toEqual({
      type: 'project',
      id: project.id,
      root: project.root,
    });
    expect(context.planningRoot).toEqual({
      type: 'project',
      id: project.id,
      root: project.root,
    });
  });

  it('keeps a pointer project owner distinct from its store planning root', async () => {
    const storeRoot = createHealthyRoot(path.join(tempDir, 'team-store'));
    await registerStore({ id: 'team', localPath: storeRoot, globalDataDir });

    const projectRoot = path.join(tempDir, 'pointer-project');
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nstore: team\n'
    );
    const home = await resolveProjectHome(projectRoot, { globalDataDir });

    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: projectRoot,
      requestedScope: 'project',
      globalDataDir,
    });

    expect(context.owner).toMatchObject({ type: 'project', id: home!.projectId });
    expect(context.planningRoot).toMatchObject({ type: 'store', id: 'team' });
    expect(freezeKnowledgeContext(context)).toEqual({
      version: 1,
      planningRoot: { type: 'store', id: 'team' },
      owner: { type: 'project', id: home!.projectId },
    });
  });

  it('refuses to fabricate a project owner for a direct store launch', async () => {
    const storeRoot = createHealthyRoot(path.join(tempDir, 'direct-store'));
    await registerStore({ id: 'team', localPath: storeRoot, globalDataDir });

    await expect(
      resolveLearnedSkillExecutionContext({
        launchDirectory: storeRoot,
        requestedScope: 'project',
        globalDataDir,
      })
    ).rejects.toMatchObject({
      diagnostic: { code: 'knowledge_owner_ambiguous' },
    });
  });

  it('keeps identical bare ids distinct across typed namespaces', async () => {
    const projectRoot = createHealthyRoot(path.join(tempDir, 'typed-project'));
    const storeRoot = createHealthyRoot(path.join(tempDir, 'typed-store'));
    await registerTyped('project', 'platform', projectRoot);
    await registerTyped('store', 'platform', storeRoot);

    const selectedProject = await resolveLearnedSkillExecutionContext({
      launchDirectory: projectRoot,
      selector: { project: 'platform' },
      requestedScope: 'project',
      globalDataDir,
    });
    expect(selectedProject.owner).toMatchObject({
      type: 'project',
      id: 'platform',
      root: projectRoot,
    });

    await expect(
      resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        selector: { store: 'platform' },
        requestedScope: 'project',
        globalDataDir,
      })
    ).rejects.toMatchObject({
      diagnostic: { code: 'knowledge_store_scope_unavailable' },
    });
  });

  it('treats a project-namespace entry as a locator for the stable projectId', async () => {
    const project = await createProject('registered-project');
    const before = await resolveLearnedSkillExecutionContext({
      launchDirectory: project.root,
      requestedScope: 'project',
      globalDataDir,
    });

    await registerTyped('project', 'platform', project.root);
    const storeRoot = createHealthyRoot(path.join(tempDir, 'platform-store'));
    await registerTyped('store', 'platform', storeRoot);

    const afterLaunch = await resolveLearnedSkillExecutionContext({
      launchDirectory: project.root,
      requestedScope: 'project',
      globalDataDir,
    });
    const afterSelector = await resolveLearnedSkillExecutionContext({
      launchDirectory: storeRoot,
      selector: { project: 'platform' },
      requestedScope: 'project',
      globalDataDir,
    });

    expect(before.owner).toMatchObject({ type: 'project', id: project.id });
    expect(afterLaunch.owner).toMatchObject({ type: 'project', id: project.id });
    expect(afterLaunch.planningRoot).toMatchObject({ type: 'project', id: project.id });
    expect(afterSelector.owner).toMatchObject({
      type: 'project',
      id: project.id,
      root: project.root,
    });

    await expect(
      resolveLearnedSkillExecutionContext({
        launchDirectory: project.root,
        selector: { store: 'platform' },
        requestedScope: 'project',
        globalDataDir,
      })
    ).rejects.toMatchObject({
      diagnostic: {
        code: 'knowledge_store_scope_unavailable',
        owner: { type: 'store', id: 'platform' },
      },
    });
  });

  it('reports stale typed registrations before any learned-skill access', async () => {
    const root = createHealthyRoot(path.join(tempDir, 'stale-project'));
    await registerTyped('project', 'stale', root);
    fs.rmSync(getStoreMetadataPath(root));

    await expect(
      resolveLearnedSkillExecutionContext({
        launchDirectory: root,
        selector: { project: 'stale' },
        requestedScope: 'project',
        globalDataDir,
      })
    ).rejects.toMatchObject({
      diagnostic: { code: 'knowledge_owner_stale' },
    });
  });

  it('revalidates frozen identity and rejects conflicting resume selectors', async () => {
    const project = await createProject('frozen-project');
    const initial = await resolveLearnedSkillExecutionContext({
      launchDirectory: project.root,
      requestedScope: 'project',
      globalDataDir,
    });
    const frozen = freezeKnowledgeContext(initial);

    const other = await createProject('other-project');
    await expect(
      resolveLearnedSkillExecutionContext({
        launchDirectory: other.root,
        selector: { project: other.id },
        requestedScope: 'project',
        frozen,
        globalDataDir,
      })
    ).rejects.toBeInstanceOf(KnowledgeContextError);

    const resumed = await resolveLearnedSkillExecutionContext({
      launchDirectory: other.root,
      requestedScope: 'project',
      frozen,
      globalDataDir,
    });
    expect(resumed.owner).toMatchObject({ type: 'project', id: project.id });
    expect(resumed.source).toBe('run-state');
  });

  it('canonicalizes a filesystem alias to the same verified project owner', async () => {
    const project = await createProject('canonical-project');
    const alias = path.join(tempDir, 'project-alias');
    fs.symlinkSync(project.root, alias, process.platform === 'win32' ? 'junction' : 'dir');

    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: alias,
      requestedScope: 'project',
      globalDataDir,
    });
    expect(context.owner).toMatchObject({ type: 'project', id: project.id });
    expect(
      fs.realpathSync.native(
        context.owner.type === 'project' ? context.owner.root : ''
      )
    ).toBe(project.root);
  });
});
