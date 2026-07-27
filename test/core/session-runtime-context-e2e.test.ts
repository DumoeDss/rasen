import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildActionContext } from '../../src/core/change-status-policy.js';
import { WORKSPACE_DIR_NAME } from '../../src/core/config.js';
import { resolveSessionLaunchContext } from '../../src/core/management-api/session-launch-context.js';
import { resolveFrozenExecutionBinding } from '../../src/core/pipeline-registry/execution-binding.js';
import { registerProject } from '../../src/core/project-registry.js';
import { registerStore } from '../../src/core/store/registry.js';
import { writeStoreProjectRecord } from '../../src/core/store/project-records.js';
import {
  RASEN_SESSION_CONTEXT_ENV,
  buildRuntimeContext,
  readSessionRuntimeContext,
  writeSessionRuntimeContext,
  type RuntimeContext,
} from '../../src/core/session-runtime-context.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

/**
 * The whole chain, end to end: what the launch resolver decided, what the
 * session records, what the child process is handed, and what every downstream
 * consumer then reads. Each test follows one fact from the launch selector to
 * the capability an agent is finally told about.
 */
describe('session runtime context end to end', () => {
  let tempDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runtime-e2e-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
    delete process.env[RASEN_SESSION_CONTEXT_ENV];
  });

  afterEach(async () => {
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  function createPointerProject(root: string, projectId: string, storeId: string): void {
    fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\nstore: ${storeId}\n`
    );
  }

  function planningDirs(root: string): string[] {
    return [
      path.join(root, WORKSPACE_DIR_NAME, 'specs'),
      path.join(root, WORKSPACE_DIR_NAME, 'changes'),
    ];
  }

  /** Store S planning, project P checked out at B. */
  async function storeSessionFixture(): Promise<{
    storeRoot: string;
    checkout: string;
    context: RuntimeContext;
  }> {
    const storeRoot = path.join(tempDir, 'store-s');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'store-s', localPath: storeRoot, globalDataDir: dataDir });

    const checkout = path.join(tempDir, 'checkout-b');
    createPointerProject(checkout, 'project-p', 'store-s');
    await registerProject(
      { projectRoot: checkout, projectId: 'project-p', mode: 'store' },
      { globalDataDir: dataDir }
    );
    // Store record is the sole authority for session eligibility (M6):
    // the declaration alone cannot vouch for the project.
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'project-p',
      roles: { planning: true, knowledge: true },
    });

    const launch = await resolveSessionLaunchContext({
      space: 'store:store-s',
      execution: 'project:project-p',
      launchProject: null,
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) throw new Error('fixture launch failed');

    const context = buildRuntimeContext({
      sessionId: 'session-e2e',
      ...(launch.context.planningSpace ? { space: launch.context.planningSpace } : {}),
      execution: launch.context.execution,
    });
    expect(context).toBeDefined();
    return {
      storeRoot: FileSystemUtils.canonicalizeExistingPath(storeRoot),
      checkout: FileSystemUtils.canonicalizeExistingPath(checkout),
      context: context as RuntimeContext,
    };
  }

  it('carries Store S, project P and checkout B from launch to the capability an agent reads', async () => {
    const fixture = await storeSessionFixture();

    expect(fixture.context.planning).toEqual({
      type: 'store',
      id: 'store-s',
      root: fixture.storeRoot,
    });
    expect(fixture.context.execution).toEqual({
      kind: 'project',
      projectId: 'project-p',
      root: fixture.checkout,
    });

    // A subcommand inside the session reads the same three facts back through
    // the environment, without re-deriving anything from a working directory.
    const written = writeSessionRuntimeContext(fixture.context, { globalDataDir: dataDir });
    const read = readSessionRuntimeContext({
      env: { [RASEN_SESSION_CONTEXT_ENV]: written },
      sessionId: 'session-e2e',
    });
    expect(read).toMatchObject({ kind: 'ok' });
    if (read.kind !== 'ok') return;

    const capability = buildActionContext({
      projectRoot: fixture.checkout,
      artifactIds: ['proposal'],
      session: { planning: read.context.planning, execution: read.context.execution },
    });
    expect(capability.planningWriteRoots).toEqual(planningDirs(fixture.storeRoot));
    expect(capability.codeWriteRoots).toEqual([fixture.checkout]);
  });

  it('keeps a linked worktree s exact root through launch, freeze and resume', async () => {
    const storeRoot = path.join(tempDir, 'wt-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'wt-store', localPath: storeRoot, globalDataDir: dataDir });

    const mainRoot = path.join(tempDir, 'wt-main');
    const worktreeRoot = path.join(tempDir, 'wt-linked');
    createPointerProject(mainRoot, 'wt-project', 'wt-store');
    execFileSync('git', ['init'], { cwd: mainRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: mainRoot });
    execFileSync('git', ['config', 'user.name', 'Rasen Test'], { cwd: mainRoot });
    execFileSync('git', ['add', '.'], { cwd: mainRoot });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: mainRoot });
    execFileSync('git', ['worktree', 'add', '-b', 'fixture-wt', worktreeRoot], { cwd: mainRoot });
    await registerProject(
      { projectRoot: mainRoot, projectId: 'wt-project', mode: 'store' },
      { globalDataDir: dataDir }
    );
    // Store record is the sole authority for session eligibility (M6):
    // the declaration alone cannot vouch for the project.
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'wt-project',
      roles: { planning: true, knowledge: true },
    });

    const launch = await resolveSessionLaunchContext({
      space: 'store:wt-store',
      execution: `project:${worktreeRoot}`,
      launchProject: null,
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;

    const canonicalWorktree = FileSystemUtils.canonicalizeExistingPath(worktreeRoot);
    const context = buildRuntimeContext({
      sessionId: 'session-wt',
      ...(launch.context.planningSpace ? { space: launch.context.planningSpace } : {}),
      execution: launch.context.execution,
    })!;
    expect(context.execution).toMatchObject({ root: canonicalWorktree });

    // Freeze records identity only (no root — the run-state file is tracked);
    // resume locates it back through the session context, landing on the
    // worktree rather than the main checkout.
    const resumed = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: 'wt-project' },
      sessionContext: context,
      cwd: mainRoot,
      globalDataDir: dataDir,
    });
    expect(resumed).toMatchObject({ ok: true, root: canonicalWorktree });
  }, 20_000);

  it('works for a secondary Store membership without the project s pointer naming that Store', async () => {
    const primary = path.join(tempDir, 'primary-store');
    const secondary = path.join(tempDir, 'secondary-store');
    createOpenSpecRoot(primary);
    createOpenSpecRoot(secondary);
    await registerStore({ id: 'primary-store', localPath: primary, globalDataDir: dataDir });
    await registerStore({ id: 'secondary-store', localPath: secondary, globalDataDir: dataDir });

    const checkout = path.join(tempDir, 'secondary-member');
    createPointerProject(checkout, 'secondary-project', 'primary-store');
    await registerProject(
      { projectRoot: checkout, projectId: 'secondary-project', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await writeStoreProjectRecord(secondary, {
      version: 1,
      projectId: 'secondary-project',
      roles: { planning: false, knowledge: true },
    });

    const launch = await resolveSessionLaunchContext({
      space: 'store:secondary-store',
      execution: 'project:secondary-project',
      launchProject: null,
    });
    expect(launch).toMatchObject({
      ok: true,
      context: {
        planningSpace: { id: 'secondary-store' },
        execution: { kind: 'project', projectId: 'secondary-project' },
      },
    });
  });

  it('gives a planning-only session no code write root anywhere in the pipeline', async () => {
    const storeRoot = path.join(tempDir, 'po-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'po-store', localPath: storeRoot, globalDataDir: dataDir });

    const launch = await resolveSessionLaunchContext({
      space: 'store:po-store',
      execution: 'planning',
      launchProject: null,
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    expect(launch.context.execution).toEqual({ kind: 'planning-only' });

    const context = buildRuntimeContext({
      sessionId: 'session-po',
      ...(launch.context.planningSpace ? { space: launch.context.planningSpace } : {}),
      execution: launch.context.execution,
    })!;
    expect(context.execution).toEqual({ kind: 'planning-only' });

    const capability = buildActionContext({
      projectRoot: launch.context.cwd,
      artifactIds: [],
      session: { planning: context.planning, execution: context.execution },
    });
    expect(capability.codeWriteRoots).toEqual([]);
    expect(capability.allowedEditRoots).toEqual(planningDirs(launch.context.cwd));
    expect(capability.constraints.join(' ')).toContain('no code write root');
  });

  it('writes nothing into either working tree while a whole session context is recorded', async () => {
    const fixture = await storeSessionFixture();
    const snapshot = (root: string): string[] =>
      fs
        .readdirSync(root, { recursive: true, encoding: 'utf-8' })
        .map((entry) => entry.split(path.sep).join('/'))
        .sort();

    const storeBefore = snapshot(fixture.storeRoot);
    const checkoutBefore = snapshot(fixture.checkout);

    const written = writeSessionRuntimeContext(fixture.context, { globalDataDir: dataDir });
    readSessionRuntimeContext({ env: { [RASEN_SESSION_CONTEXT_ENV]: written } });
    buildActionContext({
      projectRoot: fixture.checkout,
      artifactIds: [],
      session: { planning: fixture.context.planning, execution: fixture.context.execution },
    });

    expect(snapshot(fixture.storeRoot)).toEqual(storeBefore);
    expect(snapshot(fixture.checkout)).toEqual(checkoutBefore);
    // …and the one file it DID write is under the machine data directory.
    expect(written.startsWith(dataDir)).toBe(true);
  });

  it('resolves two clones unambiguously with session context and reports ambiguity without it', async () => {
    const cloneA = path.join(tempDir, 'clone-a');
    const cloneB = path.join(tempDir, 'clone-b');
    for (const clone of [cloneA, cloneB]) {
      createOpenSpecRoot(clone);
      fs.writeFileSync(
        path.join(clone, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprojectId: twin-project\n'
      );
      await registerProject(
        { projectRoot: clone, projectId: 'twin-project', mode: 'in-repo' },
        { globalDataDir: dataDir }
      );
    }

    const withContext = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: 'twin-project' },
      sessionContext: {
        version: 1,
        sessionId: 'session-twin',
        planning: { type: 'project', projectId: 'twin-project', root: cloneB },
        execution: { kind: 'project', projectId: 'twin-project', root: cloneB },
      },
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(withContext).toMatchObject({ ok: true, root: cloneB });

    const withoutContext = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: 'twin-project' },
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(withoutContext).toMatchObject({ ok: false, code: 'project_binding_ambiguous' });
    if (!withoutContext.ok) expect(withoutContext.candidates).toHaveLength(2);
  });

  it('builds every expected path with path.join, on any platform', async () => {
    const fixture = await storeSessionFixture();
    const capability = buildActionContext({
      projectRoot: fixture.checkout,
      artifactIds: [],
      session: { planning: fixture.context.planning, execution: fixture.context.execution },
    });
    for (const root of capability.planningWriteRoots) {
      expect(root).toBe(path.join(root));
      expect(root.startsWith(fixture.storeRoot)).toBe(true);
    }
  });
});
