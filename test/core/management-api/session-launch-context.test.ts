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
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'member-a-id',
      roles: { planning: true, knowledge: true },
    });

    const result = await resolveSessionLaunchContext({
      space: 'store:team-store',
      execution: 'project:member-a-id',
      launchProject: null,
    });

    // `planningSpace.planning` is additive: task 9.4 has the session freeze the
    // shared scope description's stable Store/project facts (no capability
    // token, no derived child path). Everything else is unchanged from
    // baseline, and the facts are asserted rather than merely tolerated.
    expect(result).toMatchObject({
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
    const launched = (result as { context: { planningSpace: { planning?: unknown } } }).context;
    expect(launched.planningSpace.planning).toEqual({
      storeId: 'team-store',
      projectId: 'member-a-id',
    });
  });

  it('resolves the exact registered root when two current Store clones share a project id', async () => {
    const storeRoot = path.join(tempDir, 'clone-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'clone-store', localPath: storeRoot, globalDataDir: dataDir });
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'shared-clone-id',
      roles: { planning: true, knowledge: true },
    });

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
  // D6): membership is decided by the Store's own record alone; the project's
  // declaration is a locator and does not vouch. An ordinary in-repo project
  // that the Store has not recorded is rejected — the failure names the
  // missing membership and the command that adds it, instead of a registry
  // flag the user cannot see.
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

  // Pre-0.1.5 this was the OR-arm's ACCEPTING case: a declaration alone could
  // vouch. The Store record is now the sole authority, so the same fixture is
  // the legacy-migration rejection shape — the declaration names THIS Store
  // but no record exists, and the diagnostic carries the migration marker and
  // the copy-pasteable repair command.
  it('rejects a project whose declaration names this Store but has no membership record, with a migration repair', async () => {
    const storeRoot = path.join(tempDir, 'declared-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'declared-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'declared-member');
    createPointerProject(projectRoot, 'declared-member-id', 'declared-store');
    await registerProject(
      { projectRoot, projectId: 'declared-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    // No record is written: this is the shape of every declaration-only
    // install that has not yet migrated to the Store-record authority.
    expect(fs.existsSync(getStoreProjectRecordPath(storeRoot, 'declared-member-id'))).toBe(false);

    const result = await resolveSessionLaunchContext({
      space: 'store:declared-store',
      execution: 'project:declared-member-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'execution_not_member',
      message: expect.stringContaining('legacy declaration-only install'),
    });
    expect(result.ok === false && result.message).toContain(
      'rasen store add-project declared-member-id --store declared-store'
    );
    // Rejection must not have written a record either — this seam is read-only.
    expect(fs.existsSync(getStoreProjectRecordPath(storeRoot, 'declared-member-id'))).toBe(false);
  });

  it('rejects a uid-only durable declaration when the Store record is missing, with a migration repair', async () => {
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
    // the durable (uid-only) form. Pre-0.1.5 this was the OR-arm accepting:
    // a RESOLVED-ROOT comparison matched even with no display alias. Now the
    // declaration cannot vouch at all, and the same fixture is the legacy-
    // migration rejection shape — the durable declaration resolves to THIS
    // Store but no record exists.
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
      ok: false,
      status: 409,
      code: 'execution_not_member',
      message: expect.stringContaining('legacy declaration-only install'),
    });
    expect(result.ok === false && result.message).toContain(
      'rasen store add-project durable-member-id --store durable-store'
    );
  });

  it('the rejection distinguishes a declaration pointing here from one pointing elsewhere or absent', async () => {
    // Three Store-scoped sessions, each against a project with NO Store record.
    // Only the case where the declaration resolves to THIS Store carries the
    // legacy-migration marker; the other two get the plain missing-record
    // message with the "declaration does not name this Store" clarification.
    const hereStoreRoot = path.join(tempDir, 'here-store');
    const otherStoreRoot = path.join(tempDir, 'other-store');
    createOpenSpecRoot(hereStoreRoot);
    createOpenSpecRoot(otherStoreRoot);
    await registerStore({ id: 'here-store', localPath: hereStoreRoot, globalDataDir: dataDir });
    await registerStore({ id: 'other-store', localPath: otherStoreRoot, globalDataDir: dataDir });

    // (A) Declaration names THIS Store, no record → legacy-migration marker.
    const declaredHere = path.join(tempDir, 'declared-here');
    createPointerProject(declaredHere, 'declared-here-id', 'here-store');
    await registerProject(
      { projectRoot: declaredHere, projectId: 'declared-here-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    const resultA = await resolveSessionLaunchContext({
      space: 'store:here-store',
      execution: 'project:declared-here-id',
      launchProject: null,
    });
    expect(resultA).toMatchObject({ ok: false, code: 'execution_not_member' });
    expect(resultA.ok === false && resultA.message).toContain('legacy declaration-only install');

    // (B) Declaration names a DIFFERENT Store → plain message, no marker.
    const declaredElse = path.join(tempDir, 'declared-else');
    createPointerProject(declaredElse, 'declared-else-id', 'other-store');
    await registerProject(
      { projectRoot: declaredElse, projectId: 'declared-else-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    const resultB = await resolveSessionLaunchContext({
      space: 'store:here-store',
      execution: 'project:declared-else-id',
      launchProject: null,
    });
    expect(resultB).toMatchObject({ ok: false, code: 'execution_not_member' });
    expect(resultB.ok === false && resultB.message).not.toContain('legacy declaration-only install');
    expect(resultB.ok === false && resultB.message).toContain('does not name this Store');

    // (C) No declaration at all → plain message, no marker.
    const noDeclaration = path.join(tempDir, 'no-declaration');
    createOpenSpecRoot(noDeclaration);
    await registerProject(
      { projectRoot: noDeclaration, projectId: 'no-decl-id', mode: 'in-repo' },
      { globalDataDir: dataDir }
    );
    const resultC = await resolveSessionLaunchContext({
      space: 'store:here-store',
      execution: 'project:no-decl-id',
      launchProject: null,
    });
    expect(resultC).toMatchObject({ ok: false, code: 'execution_not_member' });
    expect(resultC.ok === false && resultC.message).not.toContain('legacy declaration-only install');
    expect(resultC.ok === false && resultC.message).toContain('does not name this Store');
  });

  it('accepts a project whose Store record and declaration both agree on this Store', async () => {
    // The post-migration shape: both the Store record and the declaration
    // point at the same Store. This is what the previous OR-arm tests collapse
    // into once the record is established.
    const storeRoot = path.join(tempDir, 'agreed-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'agreed-store', localPath: storeRoot, globalDataDir: dataDir });

    const projectRoot = path.join(tempDir, 'agreed-member');
    createPointerProject(projectRoot, 'agreed-id', 'agreed-store');
    await registerProject(
      { projectRoot, projectId: 'agreed-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'agreed-id',
      roles: { planning: true, knowledge: true },
    });

    const result = await resolveSessionLaunchContext({
      space: 'store:agreed-store',
      execution: 'project:agreed-id',
      launchProject: null,
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        planningSpace: {
          type: 'store',
          id: 'agreed-store',
          root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
        },
        execution: {
          kind: 'project',
          projectId: 'agreed-id',
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

    // DELIBERATE: space resolution now owns this failure. A registration that
    // cannot produce one healthy planning scope is 409 `space_unavailable`
    // carrying the underlying planning diagnostic — required verbatim by this
    // change's delta spec `specs/planning-space-addressing/spec.md`, scenario
    // "Unhealthy or inconsistent space". Still 409, still refused before spawn,
    // and the reason is now the specific resolver diagnostic rather than a
    // generic "not available".
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'space_unavailable',
    });
    expect((result as { message: string }).message).toContain('dead-project-id');
  });

  it('resolves a linked member worktree to its own canonical cwd while retaining the registered main identity', async () => {
    const storeRoot = path.join(tempDir, 'worktree-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'worktree-store', localPath: storeRoot, globalDataDir: dataDir });
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'member-worktree-id',
      roles: { planning: true, knowledge: true },
    });

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

  it('resolves omitted-space pointer-repo fallback to the launch project effective scope, planning in the Store, executing in the member cwd', async () => {
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

    // DELIBERATE: the omitted-space fallback now reports the launch PROJECT's
    // effective planning scope, not the Store aggregate. Task 9.2 — "resolve
    // omitted-space fallback from the launch project identity/binding instead
    // of assuming the launch checkout is the planning root" — and
    // `specs/planning-space-addressing/spec.md` scenario "Bound launch project
    // follows Store planning" require exactly this. The planning ROOT is still
    // the Store (that is where this member's planning lives) and the cwd is
    // still the member checkout, so attribution and attachment are unchanged;
    // only the space's own identity became the project rather than the Store.
    // `planningSpace.planning` is additive (task 9.4).
    expect(result).toMatchObject({
      ok: true,
      context: {
        planningSpace: {
          type: 'project',
          id: 'fallback-member-id',
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
    const fallback = (result as { context: { planningSpace: { planning?: unknown } } }).context;
    expect(fallback.planningSpace.planning).toEqual({
      storeId: 'fallback-store',
      projectId: 'fallback-member-id',
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
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: 'windows-member-id',
        roles: { planning: true, knowledge: true },
      });

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
