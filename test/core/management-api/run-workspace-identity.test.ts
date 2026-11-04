import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProjectHome } from '../../../src/core/project-home.js';
import {
  deriveRunWorkspaceIds,
  type RunWorkspaceIdentityFs,
} from '../../../src/core/management-api/run-workspace-identity.js';

function projectHome(homeDir: string, archiveDir: string): ProjectHome {
  return {
    projectId: 'workspace-identity-test-project',
    name: 'workspace-identity-test-home',
    mode: 'in-repo',
    homeDir,
    archiveDir,
    workDir: (changeName) => path.join(homeDir, 'changes', changeName, 'work'),
    archivedWorkDir: (archivedName) =>
      path.join(homeDir, 'changes', 'archive', archivedName, 'work'),
  };
}

describe('Management Run workspace identity authority', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('distinguishes an unavailable selected root and archive authority from a resolved identity set', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-run-workspace-id-'));
    roots.push(container);

    const missingRoot = path.join(container, 'missing-root');
    expect(deriveRunWorkspaceIds(missingRoot, null, 'sample-change')).toMatchObject({
      ok: false,
      code: 'workspace_identity_unavailable',
      reason: 'selected-root-unavailable',
    });

    const selectedRoot = path.join(container, 'selected-root');
    fs.mkdirSync(path.join(selectedRoot, 'rasen', 'changes'), { recursive: true });
    const missingArchiveResolution = deriveRunWorkspaceIds(
      selectedRoot,
      projectHome(
        path.join(container, 'home-without-archive'),
        path.join(container, 'home-without-archive', 'archive')
      ),
      'sample-change'
    );
    expect(missingArchiveResolution).toMatchObject({
      ok: true,
      registeredSource: 'none',
    });
    if (missingArchiveResolution.ok) {
      expect(missingArchiveResolution.workspaceIds).toHaveLength(1);
    }

    const archiveFile = path.join(container, 'archive-is-not-a-directory');
    fs.writeFileSync(archiveFile, 'not an archive directory');

    expect(
      deriveRunWorkspaceIds(
        selectedRoot,
        projectHome(path.join(container, 'home'), archiveFile),
        'sample-change'
      )
    ).toMatchObject({
      ok: false,
      code: 'workspace_identity_unavailable',
      reason: 'archive-unavailable',
    });
  });

  it('retains legacy, registered active, and registered archived identities across registration and archive moves', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-run-workspace-transition-'));
    roots.push(container);
    const selectedRoot = path.join(container, 'selected-root');
    const changesDir = path.join(selectedRoot, 'rasen', 'changes');
    const archiveDir = path.join(container, 'home', 'archive');
    fs.mkdirSync(changesDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    const home = projectHome(path.join(container, 'home'), archiveDir);
    const changeId = 'transition-change';

    const preRegistration = deriveRunWorkspaceIds(selectedRoot, null, changeId);
    expect(preRegistration.ok).toBe(true);
    if (!preRegistration.ok) return;
    expect(preRegistration.registeredSource).toBe('none');
    expect(preRegistration.workspaceIds).toHaveLength(1);
    const legacyWorkspaceId = preRegistration.workspaceIds[0];

    const activeChangeDir = path.join(changesDir, changeId);
    fs.mkdirSync(activeChangeDir);
    const active = deriveRunWorkspaceIds(selectedRoot, home, changeId);
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(active.registeredSource).toBe('active');
    expect(active.workspaceIds).toContain(legacyWorkspaceId);
    expect(active.workspaceIds).toHaveLength(2);

    const archivedChangeDir = path.join(archiveDir, `2026-08-02-${changeId}`);
    fs.renameSync(activeChangeDir, archivedChangeDir);
    // A suffix-matching non-directory is not an identity candidate and must
    // not poison a valid archived physical identity.
    fs.writeFileSync(path.join(archiveDir, `2026-08-01-${changeId}`), 'stale entry');

    const archived = deriveRunWorkspaceIds(selectedRoot, home, changeId);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.registeredSource).toBe('archived');
    expect(new Set(archived.workspaceIds)).toEqual(new Set(active.workspaceIds));
  });

  it('deterministically handles disappearing candidates and later legal archives', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-run-workspace-race-'));
    roots.push(container);
    const selectedRoot = path.join(container, 'selected-root');
    const archiveDir = path.join(container, 'home', 'archive');
    const changeId = 'racing-change';
    fs.mkdirSync(path.join(selectedRoot, 'rasen', 'changes'), { recursive: true });
    const first = path.join(archiveDir, `2026-08-01-${changeId}`);
    const second = path.join(archiveDir, `2026-08-02-${changeId}`);
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    const home = projectHome(path.join(container, 'home'), archiveDir);
    const expected = deriveRunWorkspaceIds(selectedRoot, home, changeId, {
      stat: (target) => fs.statSync(target, { bigint: true }),
      listDirectories: () => [path.basename(second)],
    });
    const seam: RunWorkspaceIdentityFs = {
      stat(target) {
        if (target === first) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        return fs.statSync(target, { bigint: true });
      },
      listDirectories: () => [path.basename(first), path.basename(second)],
    };

    expect(deriveRunWorkspaceIds(selectedRoot, home, changeId, seam)).toEqual(expected);
  });

  it('fails closed on a non-ENOENT candidate stat error', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-run-workspace-denied-'));
    roots.push(container);
    const selectedRoot = path.join(container, 'selected-root');
    const archiveDir = path.join(container, 'home', 'archive');
    const changeId = 'denied-change';
    const candidate = path.join(archiveDir, `2026-08-02-${changeId}`);
    fs.mkdirSync(path.join(selectedRoot, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(candidate, { recursive: true });

    const seam: RunWorkspaceIdentityFs = {
      stat(target) {
        if (target === candidate) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return fs.statSync(target, { bigint: true });
      },
      listDirectories: () => [path.basename(candidate)],
    };
    expect(
      deriveRunWorkspaceIds(
        selectedRoot,
        projectHome(path.join(container, 'home'), archiveDir),
        changeId,
        seam
      )
    ).toMatchObject({
      ok: false,
      code: 'workspace_identity_unavailable',
      reason: 'archive-candidate-unavailable',
    });
  });

  it('fails closed when the archive moves during post-candidate recheck', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-run-workspace-archive-move-'));
    roots.push(container);
    const selectedRoot = path.join(container, 'selected-root');
    const archiveDir = path.join(container, 'home', 'archive');
    const changeId = 'moved-change';
    fs.mkdirSync(path.join(selectedRoot, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    const candidate = path.join(archiveDir, `2026-08-02-${changeId}`);
    let archiveChecks = 0;
    const seam: RunWorkspaceIdentityFs = {
      stat(target) {
        if (target === candidate) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        if (target === archiveDir && ++archiveChecks > 0) {
          throw Object.assign(new Error('archive moved'), { code: 'ENOENT' });
        }
        return fs.statSync(target, { bigint: true });
      },
      listDirectories: () => [path.basename(candidate)],
    };

    expect(
      deriveRunWorkspaceIds(
        selectedRoot,
        projectHome(path.join(container, 'home'), archiveDir),
        changeId,
        seam
      )
    ).toMatchObject({
      ok: false,
      code: 'workspace_identity_unavailable',
      reason: 'archive-unavailable',
    });
  });
});
