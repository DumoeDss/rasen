import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { resolveSessionLaunchContext } from '../../../src/core/management-api/session-launch-context.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { registerStore } from '../../../src/core/store/registry.js';
import {
  getStoreProjectRecordPath,
  writeStoreProjectRecord,
} from '../../../src/core/store/project-records.js';
import { upgradeStoreIdentity } from '../../../src/core/store/upgrade-identity.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

function createPointerProject(root: string, projectId: string, storeId: string): void {
  fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'rasen', 'config.yaml'),
    `schema: spec-driven\nprojectId: ${projectId}\nstore: ${storeId}\n`
  );
}

describe('resolveSessionLaunchContext', () => {
  let tempDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-context-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  it('keeps an explicit project launch compatible when execution is omitted', async () => {
    const projectRoot = path.join(tempDir, 'project-a');
    createOpenSpecRoot(projectRoot);
    await registerProject(
      { projectRoot, projectId: 'project-a-id', mode: 'in-repo' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      space: 'project:project-a-id',
      launchProject: null,
    });

    expect(result).toEqual({
      ok: true,
      context: {
        planningSpace: {
          type: 'project',
          id: 'project-a-id',
          root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        },
        cwd: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        attachedRoots: [],
        execution: {
          kind: 'project',
          projectId: 'project-a-id',
          root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        },
      },
    });
  });

  it('runs an explicit Store launch in a current registered member and attaches only the Store root', async () => {
    const storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team-store', localPath: storeRoot, globalDataDir: dataDir });

    const memberRoot = path.join(tempDir, 'member-a');
    createPointerProject(memberRoot, 'member-a-id', 'team-store');
    await registerProject(
      { projectRoot: memberRoot, projectId: 'member-a-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      space: 'store:team-store',
      execution: 'project:member-a-id',
      launchProject: null,
    });

    expect(result).toEqual({
      ok: true,
      context: {
        planningSpace: {
          type: 'store',
          id: 'team-store',
          root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
        },
        cwd: FileSystemUtils.canonicalizeExistingPath(memberRoot),
        attachedRoots: [FileSystemUtils.canonicalizeExistingPath(storeRoot)],
        execution: {
          kind: 'project',
          projectId: 'member-a-id',
          root: FileSystemUtils.canonicalizeExistingPath(memberRoot),
        },
      },
    });
  });

  it('resolves the exact registered root when two current Store clones share a project id', async () => {
    const storeRoot = path.join(tempDir, 'clone-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'clone-store', localPath: storeRoot, globalDataDir: dataDir });

    const cloneA = path.join(tempDir, 'clone-a');
    const cloneB = path.join(tempDir, 'clone-b');
    createPointerProject(cloneA, 'shared-clone-id', 'clone-store');
    createPointerProject(cloneB, 'shared-clone-id', 'clone-store');
    await registerProject(
      { projectRoot: cloneA, projectId: 'shared-clone-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await registerProject(
      { projectRoot: cloneB, projectId: 'shared-clone-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      space: 'store:clone-store',
      execution: `project:${cloneB}`,
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        cwd: FileSystemUtils.canonicalizeExistingPath(cloneB),
        execution: {
          kind: 'project',
          projectId: 'shared-clone-id',
          root: FileSystemUtils.canonicalizeExistingPath(cloneB),
        },
      },
    });
    if (result.ok) {
      expect(result.context.cwd).not.toBe(FileSystemUtils.canonicalizeExistingPath(cloneA));
    }
  });

  it('requires an explicit execution choice for an explicit Store launch', async () => {
    const storeRoot = path.join(tempDir, 'required-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'required-store', localPath: storeRoot, globalDataDir: dataDir });

    const result = await resolveSessionLaunchContext({
      space: 'store:required-store',
      launchProject: null,
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'execution_required',
      message: 'Store "required-store" requires an explicit execution project or planning-only selection.',
    });
  });

  it('uses the Store root without a duplicate attachment for explicit planning-only execution', async () => {
    const storeRoot = path.join(tempDir, 'planning-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'planning-store', localPath: storeRoot, globalDataDir: dataDir });

    const result = await resolveSessionLaunchContext({
      space: 'store:planning-store',
      execution: 'planning',
      launchProject: null,
    });

    const canonicalStoreRoot = FileSystemUtils.canonicalizeExistingPath(storeRoot);
    expect(result).toEqual({
      ok: true,
      context: {
        planningSpace: { type: 'store', id: 'planning-store', root: canonicalStoreRoot },
        cwd: canonicalStoreRoot,
        attachedRoots: [],
        // Recorded as an explicit fact, not by omission: this session works on
        // no project and therefore has no code write root at all.
        execution: { kind: 'planning-only' },
      },
    });
  });

  it.each(['', 'project:', 'member-a', 'planning:extra'])(
    'rejects malformed execution selector %j before resolving a project',
    async (execution) => {
      const projectRoot = path.join(tempDir, `malformed-${execution.length}`);
      createOpenSpecRoot(projectRoot);
      await registerProject(
        { projectRoot, projectId: `malformed-${execution.length}`, mode: 'in-repo' },
        { globalDataDir: dataDir }
      );

      const result = await resolveSessionLaunchContext({
        space: `project:malformed-${execution.length}`,
        execution,
        launchProject: null,
      });

      expect(result).toEqual({
        ok: false,
        status: 400,
        code: 'invalid_execution',
        message: 'execution must be "planning" or a non-empty "project:<selector>" value.',
      });
    }
  );

  it('rejects execution in a different project than the selected project planning space', async () => {
    const projectA = path.join(tempDir, 'project-a');
    const projectB = path.join(tempDir, 'project-b');
    createOpenSpecRoot(projectA);
    createOpenSpecRoot(projectB);
    await registerProject(
      { projectRoot: projectA, projectId: 'project-a-id', mode: 'in-repo' },
      { globalDataDir: dataDir }
    );
    await registerProject(
      { projectRoot: projectB, projectId: 'project-b-id', mode: 'in-repo' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      space: 'project:project-a-id',
      execution: 'project:project-b-id',
      launchProject: null,
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'execution_unavailable',
      message: 'Project "project-b-id" does not belong to project planning space "project-a-id".',
    });
  });

  it('returns execution_not_found when a project selector matches no registered project or worktree', async () => {
    const storeRoot = path.join(tempDir, 'missing-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'missing-store', localPath: storeRoot, globalDataDir: dataDir });

    const result = await resolveSessionLaunchContext({
      space: 'store:missing-store',
      execution: 'project:ghost-project',
      launchProject: null,
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      code: 'execution_not_found',
      message: 'No registered project or linked worktree matches "ghost-project".',
    });
  });

  // Registry `mode` is no longer consulted (unified-session-runtime-context
  // D6): membership is decided by the Store's own record, with the project's
  // durable Store declaration as the second authority. An ordinary in-repo
  // project that neither vouches for is still rejected — but now the failure
  // names the missing membership and the command that adds it, instead of a
  // registry flag the user cannot see.
  it('rejects a project neither the Store record nor its own declaration vouches for', async () => {
    const storeRoot = path.join(tempDir, 'non-member-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'non-member-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'ordinary-project');
    createOpenSpecRoot(projectRoot);
    await registerProject(
      { projectRoot, projectId: 'ordinary-project-id', mode: 'in-repo' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      space: 'store:non-member-store',
      execution: 'project:ordinary-project-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'execution_not_member',
      message: expect.stringContaining('rasen store add-project'),
    });
  });

  it('rejects a project whose declaration names an unusable Store and which has no membership record', async () => {
    const storeRoot = path.join(tempDir, 'selected-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'selected-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'stale-member');
    createPointerProject(projectRoot, 'stale-member-id', 'other-store');
    await registerProject(
      { projectRoot, projectId: 'stale-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      space: 'store:selected-store',
      execution: 'project:stale-member-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'execution_not_member',
      message: expect.stringContaining('stale-member-id'),
    });
  });

  // The union's ACCEPTING arm, on the `space:` + `execution:` path that
  // `storePermitsProject` actually gates. The omitted-space fallback below
  // exercises a pointer project too, but it never reaches this seam — so
  // without these two, the arm the spec used to leave unstated was also the
  // arm no test on this path would have caught being "simplified away".
  it('accepts a project with no membership record whose own declaration names this Store', async () => {
    const storeRoot = path.join(tempDir, 'declared-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'declared-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'declared-member');
    createPointerProject(projectRoot, 'declared-member-id', 'declared-store');
    await registerProject(
      { projectRoot, projectId: 'declared-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    // No record is written: this is the linkage that predates membership
    // records, and it is the shape of every install that has not migrated.
    expect(fs.existsSync(getStoreProjectRecordPath(storeRoot, 'declared-member-id'))).toBe(false);

    const result = await resolveSessionLaunchContext({
      space: 'store:declared-store',
      execution: 'project:declared-member-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        planningSpace: {
          type: 'store',
          id: 'declared-store',
          root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
        },
        execution: {
          kind: 'project',
          projectId: 'declared-member-id',
          root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        },
      },
    });
    // Accepting must not have written one either — this seam is read-only.
    expect(fs.existsSync(getStoreProjectRecordPath(storeRoot, 'declared-member-id'))).toBe(false);
  });

  it('accepts a uid-only durable declaration, which a display-name comparison would have missed', async () => {
    const storeRoot = path.join(tempDir, 'durable-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'durable-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'durable-member');
    createPointerProject(projectRoot, 'durable-member-id', 'durable-store');
    await registerProject(
      { projectRoot, projectId: 'durable-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    // Mints the Store's permanent identity and rewrites the declaration into
    // the durable form, whose display alias is dropped — so `pointer.value` is
    // undefined and only a RESOLVED-ROOT comparison can still match. This is
    // the third live instance of that trap in this portfolio.
    await upgradeStoreIdentity({
      id: 'durable-store',
      apply: true,
      projectRoot,
      globalDataDir: dataDir,
    });
    expect(fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8')).toContain(
      'uid:'
    );
    expect(fs.existsSync(getStoreProjectRecordPath(storeRoot, 'durable-member-id'))).toBe(false);

    const result = await resolveSessionLaunchContext({
      space: 'store:durable-store',
      execution: 'project:durable-member-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        execution: {
          kind: 'project',
          projectId: 'durable-member-id',
          root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        },
      },
    });
  });

  it('accepts a project whose own planning Store is a DIFFERENT Store when the Store records it', async () => {
    // The scenario the whole planning/membership split exists for: the session
    // pins planning explicitly, so the project's own default planning Store is
    // irrelevant to whether it may be worked on here.
    const planningStoreRoot = path.join(tempDir, 'session-store');
    createOpenSpecRoot(planningStoreRoot);
    await registerStore({ id: 'session-store', localPath: planningStoreRoot, globalDataDir: dataDir });

    const otherStoreRoot = path.join(tempDir, 'home-store');
    createOpenSpecRoot(otherStoreRoot);
    await registerStore({ id: 'home-store', localPath: otherStoreRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'plans-elsewhere');
    createPointerProject(projectRoot, 'plans-elsewhere-id', 'home-store');
    await registerProject(
      { projectRoot, projectId: 'plans-elsewhere-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await writeStoreProjectRecord(planningStoreRoot, {
      version: 1,
      projectId: 'plans-elsewhere-id',
      roles: { planning: false, knowledge: true },
    });

    const result = await resolveSessionLaunchContext({
      space: 'store:session-store',
      execution: 'project:plans-elsewhere-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        planningSpace: {
          type: 'store',
          id: 'session-store',
          root: FileSystemUtils.canonicalizeExistingPath(planningStoreRoot),
        },
        execution: {
          kind: 'project',
          projectId: 'plans-elsewhere-id',
          root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        },
      },
    });
  });

  it('rejects a checkout whose own recorded identity is a different project', async () => {
    const storeRoot = path.join(tempDir, 'identity-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'identity-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'wrong-identity');
    createPointerProject(projectRoot, 'registered-id', 'identity-store');
    await registerProject(
      { projectRoot, projectId: 'registered-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    // The checkout is re-pointed at a different project AFTER registration —
    // exactly the "this is not the clone you think it is" case.
    createPointerProject(projectRoot, 'someone-elses-id', 'identity-store');

    const result = await resolveSessionLaunchContext({
      space: 'store:identity-store',
      execution: 'project:registered-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'execution_identity_mismatch',
      message: expect.stringContaining('someone-elses-id'),
    });
  });

  it('stops the launch when the planning Store cannot be resolved on this machine', async () => {
    const result = await resolveSessionLaunchContext({
      space: 'store:never-registered-store',
      execution: 'project:whatever',
      launchProject: null,
    });

    expect(result).toMatchObject({ ok: false, status: 404, code: 'space_not_found' });
  });

  it('rejects a registered member whose root is no longer live', async () => {
    const storeRoot = path.join(tempDir, 'dead-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'dead-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'dead-member');
    createPointerProject(projectRoot, 'dead-member-id', 'dead-store');
    await registerProject(
      { projectRoot, projectId: 'dead-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });

    const result = await resolveSessionLaunchContext({
      space: 'store:dead-store',
      execution: 'project:dead-member-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'execution_unavailable',
      message: expect.stringContaining('not available at its registered root'),
    });
  });

  it('rejects a dead explicit project default before spawn', async () => {
    const projectRoot = path.join(tempDir, 'dead-project');
    createOpenSpecRoot(projectRoot);
    await registerProject(
      { projectRoot, projectId: 'dead-project-id', mode: 'in-repo' },
      { globalDataDir: dataDir }
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });

    const result = await resolveSessionLaunchContext({
      space: 'project:dead-project-id',
      launchProject: null,
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'execution_unavailable',
      message: 'Project planning space "dead-project-id" is not available at its registered root.',
    });
  });

  it('resolves a linked member worktree to its own canonical cwd while retaining the registered main identity', async () => {
    const storeRoot = path.join(tempDir, 'worktree-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'worktree-store', localPath: storeRoot, globalDataDir: dataDir });

    const mainRoot = path.join(tempDir, 'member-main');
    const worktreeRoot = path.join(tempDir, 'member-worktree');
    createPointerProject(mainRoot, 'member-worktree-id', 'worktree-store');
    execFileSync('git', ['init'], { cwd: mainRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: mainRoot });
    execFileSync('git', ['config', 'user.name', 'Rasen Test'], { cwd: mainRoot });
    execFileSync('git', ['add', '.'], { cwd: mainRoot });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: mainRoot });
    execFileSync('git', ['worktree', 'add', '-b', 'fixture-worktree', worktreeRoot], { cwd: mainRoot });
    await registerProject(
      { projectRoot: mainRoot, projectId: 'member-worktree-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      space: 'store:worktree-store',
      execution: `project:${worktreeRoot}`,
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        cwd: FileSystemUtils.canonicalizeExistingPath(worktreeRoot),
        attachedRoots: [FileSystemUtils.canonicalizeExistingPath(storeRoot)],
        execution: {
          kind: 'project',
          projectId: 'member-worktree-id',
          root: FileSystemUtils.canonicalizeExistingPath(worktreeRoot),
        },
      },
    });
    if (result.ok) {
      expect(result.context.cwd).not.toBe(FileSystemUtils.canonicalizeExistingPath(mainRoot));
    }
  });

  it('preserves omitted-space pointer-repo fallback: member cwd with Store attribution and attachment', async () => {
    const storeRoot = path.join(tempDir, 'fallback-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'fallback-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'fallback-member');
    createPointerProject(projectRoot, 'fallback-member-id', 'fallback-store');
    await registerProject(
      { projectRoot, projectId: 'fallback-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    const result = await resolveSessionLaunchContext({
      launchProject: {
        root: projectRoot,
        projectId: 'fallback-member-id',
        name: 'fallback-member',
      },
    });

    expect(result).toEqual({
      ok: true,
      context: {
        planningSpace: {
          type: 'store',
          id: 'fallback-store',
          root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
        },
        cwd: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        attachedRoots: [FileSystemUtils.canonicalizeExistingPath(storeRoot)],
        execution: {
          kind: 'project',
          projectId: 'fallback-member-id',
          root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        },
      },
    });
  });

  it('keeps a trusted launch-project cwd usable when no planning space can be derived', async () => {
    const projectRoot = path.join(tempDir, 'unattributed');
    fs.mkdirSync(projectRoot, { recursive: true });

    const result = await resolveSessionLaunchContext({
      launchProject: {
        root: projectRoot,
        projectId: '',
        name: 'unattributed',
      },
    });

    expect(result).toEqual({
      ok: true,
      context: {
        cwd: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        attachedRoots: [],
        execution: {
          kind: 'project',
          projectId: '',
          root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
        },
      },
    });
  });

  it.skipIf(process.platform !== 'win32')(
    'canonicalizes Windows case and separator variants to the registered member root',
    async () => {
      const storeRoot = path.join(tempDir, 'windows-store');
      createOpenSpecRoot(storeRoot);
      await registerStore({ id: 'windows-store', localPath: storeRoot, globalDataDir: dataDir });

      const projectRoot = path.join(tempDir, 'windows-member');
      createPointerProject(projectRoot, 'windows-member-id', 'windows-store');
      await registerProject(
        { projectRoot, projectId: 'windows-member-id', mode: 'store' },
        { globalDataDir: dataDir }
      );
      const variant = projectRoot.toUpperCase().replaceAll(path.win32.sep, path.posix.sep);

      const result = await resolveSessionLaunchContext({
        space: 'store:windows-store',
        execution: `project:${variant}`,
        launchProject: null,
      });

      expect(result).toMatchObject({
        ok: true,
        context: {
          cwd: FileSystemUtils.canonicalizeExistingPath(projectRoot),
          execution: {
            kind: 'project',
            projectId: 'windows-member-id',
            root: FileSystemUtils.canonicalizeExistingPath(projectRoot),
          },
        },
      });
    }
  );
});
