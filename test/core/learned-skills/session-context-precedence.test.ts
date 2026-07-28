import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveLearnedSkillExecutionContext } from '../../../src/core/learned-skills/index.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { upgradeStoreIdentity } from '../../../src/core/store/upgrade-identity.js';
import {
  RASEN_SESSION_CONTEXT_ENV,
  writeSessionRuntimeContext,
  type RuntimeContext,
} from '../../../src/core/session-runtime-context.js';

/**
 * Design D4's precedence, exercised end to end at the resolver that every
 * knowledge-scoped command goes through: an explicit selector wins; then the
 * session's own recorded context; then, only when neither applies, the
 * working directory and its nearest pointer.
 */
describe('learned-skill context resolution precedence', () => {
  let tempDir: string;
  let globalDataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-precedence-'))
    );
    globalDataDir = path.join(tempDir, 'data');
    originalEnv = { ...process.env };
    delete process.env[RASEN_SESSION_CONTEXT_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createHealthyRoot(root: string, config = 'schema: spec-driven\n'): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), config);
    return fs.realpathSync.native(root);
  }

  /**
   * A pointer repo: config only, no planning shape of its own — the shape that
   * makes its declared Store the planning root (mirrors the fixture in
   * `context.test.ts`).
   */
  function createPointerRoot(root: string, config: string): string {
    fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), config);
    return fs.realpathSync.native(root);
  }

  /**
   * Store A is the project's OWN planning Store, declared in its config.
   * Store B is where the session plans. The whole point of recording the
   * session's context is that a command inside it resolves B, not A.
   */
  async function twoStoreFixture(): Promise<{
    storeA: string;
    storeB: string;
    projectRoot: string;
    projectId: string;
  }> {
    const storeA = createHealthyRoot(path.join(tempDir, 'store-a'));
    const storeB = createHealthyRoot(path.join(tempDir, 'store-b'));
    await registerStore({ id: 'store-a', localPath: storeA, globalDataDir });
    await registerStore({ id: 'store-b', localPath: storeB, globalDataDir });

    const projectRoot = createPointerRoot(
      path.join(tempDir, 'member'),
      'schema: spec-driven\nstore: store-a\n'
    );
    const home = await resolveProjectHome(projectRoot, { globalDataDir });
    return { storeA, storeB, projectRoot, projectId: home!.projectId };
  }

  function contextPinning(storeId: string, storeRoot: string, projectRoot: string, projectId: string): RuntimeContext {
    return {
      version: 1,
      sessionId: 'session-precedence',
      planning: { type: 'store', id: storeId, root: storeRoot },
      execution: { kind: 'project', projectId, root: projectRoot },
    };
  }

  it('resolves the SESSION s Store, not the checkout s own declared Store', async () => {
    const fixture = await twoStoreFixture();

    // Without a session context this resolves store-a, the checkout's own
    // declaration — the exact behavior this capability exists to override.
    const derived = await resolveLearnedSkillExecutionContext({
      launchDirectory: fixture.projectRoot,
      requestedScope: 'project',
      globalDataDir,
      sessionContext: null,
    });
    expect(derived.planningRoot).toMatchObject({ type: 'store', id: 'store-a' });

    const pinned = await resolveLearnedSkillExecutionContext({
      launchDirectory: fixture.projectRoot,
      requestedScope: 'project',
      globalDataDir,
      sessionContext: contextPinning(
        'store-b',
        fixture.storeB,
        fixture.projectRoot,
        fixture.projectId
      ),
    });
    expect(pinned.planningRoot).toMatchObject({ type: 'store', id: 'store-b' });
    expect(pinned.source).toBe('session-context');
  });

  it('reads the session context the environment points at', async () => {
    const fixture = await twoStoreFixture();
    const written = writeSessionRuntimeContext(
      contextPinning('store-b', fixture.storeB, fixture.projectRoot, fixture.projectId),
      { globalDataDir }
    );
    process.env[RASEN_SESSION_CONTEXT_ENV] = written;

    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: fixture.projectRoot,
      requestedScope: 'project',
      globalDataDir,
    });
    expect(context.planningRoot).toMatchObject({ type: 'store', id: 'store-b' });
  });

  it('lets an explicit selector beat the session context', async () => {
    const fixture = await twoStoreFixture();
    const other = createHealthyRoot(path.join(tempDir, 'other-project'));
    const otherHome = await resolveProjectHome(other, { globalDataDir });

    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: fixture.projectRoot,
      selector: { project: otherHome!.projectId },
      globalDataDir,
      // The session pins its own execution project; the selector still wins.
      sessionContext: contextPinning(
        'store-b',
        fixture.storeB,
        fixture.projectRoot,
        fixture.projectId
      ),
    });
    expect(context.owner).toMatchObject({ type: 'project', id: otherHome!.projectId });
    expect(context.source).toBe('explicit-project');
    // …while the planning root still comes from the session, not the cwd.
    expect(context.planningRoot).toMatchObject({ type: 'store', id: 'store-b' });
  });

  it('falls back to the working directory only when neither applies', async () => {
    const fixture = await twoStoreFixture();
    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: fixture.projectRoot,
      requestedScope: 'project',
      globalDataDir,
      sessionContext: null,
    });
    expect(context.planningRoot).toMatchObject({ type: 'store', id: 'store-a' });
    expect(context.source).toBe('launch-project');
  });

  it('reports a broken session context instead of resolving from the working directory', async () => {
    const fixture = await twoStoreFixture();
    process.env[RASEN_SESSION_CONTEXT_ENV] = path.join(tempDir, 'no-such-context.json');

    await expect(
      resolveLearnedSkillExecutionContext({
        launchDirectory: fixture.projectRoot,
        requestedScope: 'project',
        globalDataDir,
      })
    ).rejects.toThrow(/session context/i);
  });

  it('resolves a uid-only durable declaration that an alias comparison would have missed', async () => {
    // A durable declaration records only the permanent identity, so
    // `pointer.value` is undefined. The old "is planning externalized" test
    // read that as "no declaration" and silently fell through to the project.
    const storeRoot = createHealthyRoot(path.join(tempDir, 'durable-store'));
    await registerStore({ id: 'durable-store', localPath: storeRoot, globalDataDir });

    const projectRoot = createPointerRoot(
      path.join(tempDir, 'durable-member'),
      'schema: spec-driven\nstore: durable-store\n'
    );
    await resolveProjectHome(projectRoot, { globalDataDir });

    // Mints the Store's permanent identity and rewrites the project's
    // declaration into the durable form, whose display alias is dropped.
    await upgradeStoreIdentity({
      id: 'durable-store',
      apply: true,
      projectRoot,
      globalDataDir,
    });
    const declaration = fs.readFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'utf-8'
    );
    expect(declaration).toContain('uid:');

    const context = await resolveLearnedSkillExecutionContext({
      launchDirectory: projectRoot,
      requestedScope: 'project',
      globalDataDir,
      sessionContext: null,
    });
    expect(context.planningRoot).toMatchObject({ type: 'store', id: 'durable-store' });
  });
});
