import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  freezeKnowledgeContext,
  KnowledgeContextError,
  resolveLearnedSkillExecutionContext,
  type FrozenKnowledgeContext,
} from '../../../src/core/learned-skills/index.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import {
  getStoreMetadataPath,
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
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

    // The same bare id in the store namespace resolves to the STORE, and to
    // its own root — the two namespaces never collapse into one another.
    const selectedStore = await resolveLearnedSkillExecutionContext({
      launchDirectory: projectRoot,
      selector: { store: 'platform' },
      requestedScope: 'store',
      globalDataDir,
    });
    expect(selectedStore.owner).toMatchObject({
      type: 'store',
      id: 'platform',
      root: storeRoot,
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
      // A store selector never satisfies a PROJECT-scoped operation: the store
      // now resolves perfectly well, and refusing on the scope is exactly what
      // keeps its knowledge out of a project's catalog.
      diagnostic: {
        code: 'knowledge_owner_scope_mismatch',
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

  // Frozen Store ownership is keyed on PERMANENT identity, so a rename cannot
  // retarget a run in flight and a namesake cannot claim one. Records written
  // before that keep working, but resolving the name they carry is fail-closed.
  describe('frozen Store ownership by permanent identity', () => {
    /** A Store carrying a permanent identity — minted into metadata before registration. */
    async function createIdentifiedStore(
      name: string,
      dirName = name
    ): Promise<{ root: string; uid: string; id: string }> {
      const root = createHealthyRoot(path.join(tempDir, dirName));
      const uid = mintStoreUid();
      await writeStoreMetadataState(root, { version: 2, uid, id: name });
      await registerStore({ id: name, localPath: root, globalDataDir });
      return { root, uid, id: name };
    }

    /** A registered project whose planning root is the given Store (declared by uid). */
    async function createStoreMemberProject(name: string, storeUid: string): Promise<string> {
      const root = path.join(tempDir, name);
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'rasen', 'config.yaml'),
        `schema: spec-driven\nstore:\n  uid: ${storeUid}\n`
      );
      await resolveProjectHome(root, { globalDataDir });
      return root;
    }

    /** Freeze a run whose planning root is the Store the project points at. */
    async function freezeAgainst(projectRoot: string) {
      const context = await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'project',
        sessionContext: null,
        globalDataDir,
      });
      return freezeKnowledgeContext(context);
    }

    it('records permanent identity, with the display name carried only for readability', async () => {
      const store = await createIdentifiedStore('platform');
      const projectRoot = await createStoreMemberProject('identified-member', store.uid);
      const home = await resolveProjectHome(projectRoot, { globalDataDir });

      const frozen = await freezeAgainst(projectRoot);
      expect(frozen).toEqual({
        version: 3,
        planningRoot: { type: 'store', uid: store.uid, id: 'platform' },
        owner: { type: 'project', projectId: home!.projectId, id: home!.projectId },
      });
    });

    it('still owns its frozen runs after the Store is renamed', async () => {
      const store = await createIdentifiedStore('platform');
      const projectRoot = await createStoreMemberProject('renamed-member', store.uid);
      const frozen = await freezeAgainst(projectRoot);

      // Rename: the display name changes, the permanent identity does not.
      await writeStoreMetadataState(store.root, {
        version: 2,
        uid: store.uid,
        id: 'platform-renamed',
      });
      await registerStore({ id: 'platform-renamed', localPath: store.root, globalDataDir });

      const resumed = await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'project',
        sessionContext: null,
        frozen,
        globalDataDir,
      });
      expect(resumed.planningRoot).toMatchObject({ type: 'store', uid: store.uid });
      // Reported under its CURRENT name, resolved through its unchanged identity.
      expect(resumed.planningRoot).toMatchObject({ id: 'platform-renamed' });
      expect(resumed.source).toBe('run-state');
    });

    it('resolves to the Store it was frozen against, not its namesake', async () => {
      const left = await createIdentifiedStore('shared', 'shared-left');
      const right = await createIdentifiedStore('shared', 'shared-right');
      expect(left.uid).not.toBe(right.uid);

      const projectRoot = await createStoreMemberProject('namesake-member', right.uid);
      const frozen = await freezeAgainst(projectRoot);
      expect(frozen).toMatchObject({ planningRoot: { uid: right.uid } });

      const resumed = await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'project',
        sessionContext: null,
        frozen,
        globalDataDir,
      });
      expect(resumed.planningRoot).toMatchObject({ type: 'store', uid: right.uid });
      expect(resumed.planningRoot).not.toMatchObject({ uid: left.uid });
      expect(
        resumed.planningRoot?.type === 'store' ? resumed.planningRoot.root : ''
      ).toBe(right.root);
    });

    it('resolves an unambiguous legacy name-only record and continues', async () => {
      const storeRoot = createHealthyRoot(path.join(tempDir, 'legacy-solo'));
      await registerStore({ id: 'solo', localPath: storeRoot, globalDataDir });
      const projectRoot = path.join(tempDir, 'legacy-solo-member');
      fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nstore: solo\n'
      );
      const home = await resolveProjectHome(projectRoot, { globalDataDir });

      // A Store with no permanent identity has nothing durable to record, so the
      // record keeps its previous, name-keyed shape.
      const frozen = await freezeAgainst(projectRoot);
      expect(frozen).toEqual({
        version: 1,
        planningRoot: { type: 'store', id: 'solo' },
        owner: { type: 'project', id: home!.projectId },
      });

      const resumed = await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'project',
        sessionContext: null,
        frozen,
        globalDataDir,
      });
      expect(resumed.planningRoot).toMatchObject({ type: 'store', id: 'solo' });
    });

    it('stops the run and lists the candidates when a legacy name matches several Stores', async () => {
      const projectRoot = path.join(tempDir, 'legacy-ambiguous-member');
      fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      const home = await resolveProjectHome(projectRoot, { globalDataDir });
      const left = await createIdentifiedStore('ambiguous', 'ambiguous-left');
      const right = await createIdentifiedStore('ambiguous', 'ambiguous-right');

      const frozen = {
        version: 1 as const,
        planningRoot: { type: 'store' as const, id: 'ambiguous' },
        owner: { type: 'project' as const, id: home!.projectId },
      };

      await expect(
        resolveLearnedSkillExecutionContext({
          launchDirectory: projectRoot,
          requestedScope: 'project',
          sessionContext: null,
          frozen,
          globalDataDir,
        })
      ).rejects.toMatchObject({ diagnostic: { code: 'learned_owner_legacy_alias' } });

      const error = await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'project',
        sessionContext: null,
        frozen,
        globalDataDir,
      }).catch((err: unknown) => err as KnowledgeContextError);
      // Every candidate is named; none is chosen.
      expect(error.message).toContain(left.uid);
      expect(error.message).toContain(right.uid);
      expect(error.message).toContain('display name only');
    });

    it('stops the run and names the Store when a legacy name matches none', async () => {
      const projectRoot = path.join(tempDir, 'legacy-missing-member');
      fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      const home = await resolveProjectHome(projectRoot, { globalDataDir });

      await expect(
        resolveLearnedSkillExecutionContext({
          launchDirectory: projectRoot,
          requestedScope: 'project',
          sessionContext: null,
          frozen: {
            version: 1,
            planningRoot: { type: 'store', id: 'never-registered' },
            owner: { type: 'project', id: home!.projectId },
          },
          globalDataDir,
        })
      ).rejects.toMatchObject({
        diagnostic: { code: 'learned_owner_legacy_alias' },
        message: expect.stringContaining('never-registered'),
      });
    });

    it('leaves a legacy record byte-identical after reading it', async () => {
      const storeRoot = createHealthyRoot(path.join(tempDir, 'legacy-untouched'));
      await registerStore({ id: 'untouched', localPath: storeRoot, globalDataDir });
      const projectRoot = path.join(tempDir, 'legacy-untouched-member');
      fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nstore: untouched\n'
      );
      const home = await resolveProjectHome(projectRoot, { globalDataDir });

      const recordPath = path.join(tempDir, 'auto-run.json');
      const original = `${JSON.stringify(
        {
          pipeline: 'full-feature',
          knowledgeContext: {
            version: 1,
            planningRoot: { type: 'store', id: 'untouched' },
            owner: { type: 'project', id: home!.projectId },
          },
        },
        null,
        2
      )}\n`;
      fs.writeFileSync(recordPath, original, 'utf-8');
      const before = fs.readFileSync(recordPath);

      const parsed = JSON.parse(fs.readFileSync(recordPath, 'utf-8')) as {
        knowledgeContext: FrozenKnowledgeContext;
      };
      await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'project',
        sessionContext: null,
        frozen: parsed.knowledgeContext,
        globalDataDir,
      });

      expect(fs.readFileSync(recordPath).equals(before)).toBe(true);
    });
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
