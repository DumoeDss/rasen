import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  cleanupRetiredEditBoundaryArtifacts,
  RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER,
  RETIRED_CODEX_EDIT_BOUNDARY_HANDLER,
  retiredEditBoundaryStateFileName,
} from '../../src/core/retired-edit-boundary.js';

describe('retired runtime edit-boundary cleanup', () => {
  let fixture: string;
  let project: string;
  let dataHome: string;

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-retired-boundary-'));
    project = path.join(fixture, 'project');
    dataHome = path.join(fixture, 'machine');
    fs.mkdirSync(project, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  function cleanup() {
    return cleanupRetiredEditBoundaryArtifacts(project, {
      env: { RASEN_HOME: dataHome },
    });
  }

  it('subtracts only complete frozen handlers and preserves config structure', () => {
    const claudePath = path.join(project, '.claude', 'settings.json');
    const codexPath = path.join(project, '.codex', 'hooks.json');
    fs.mkdirSync(path.dirname(claudePath), { recursive: true });
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    const userHandler = { type: 'command', command: 'echo user' };
    const nearMatch = {
      ...RETIRED_CODEX_EDIT_BOUNDARY_HANDLER,
      timeout: 20,
    };
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        model: 'opus',
        permissions: { allow: ['Read'] },
        hooks: {
          PreToolUse: [
            {
              matcher: 'Edit|Write',
              hooks: [RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER],
            },
            {
              matcher: 'Write',
              description: 'shared user group',
              hooks: [userHandler, RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER],
            },
          ],
          Stop: [{ hooks: [userHandler] }],
        },
      })
    );
    fs.writeFileSync(
      codexPath,
      JSON.stringify({
        customRoot: true,
        hooks: {
          PreToolUse: [
            {
              matcher: 'apply_patch|Edit|Write',
              hooks: [RETIRED_CODEX_EDIT_BOUNDARY_HANDLER],
            },
            {
              matcher: 'apply_patch',
              metadata: { owner: 'user' },
              hooks: [nearMatch],
            },
          ],
        },
      })
    );

    const result = cleanup();

    expect(result.removedHooks).toEqual([claudePath, codexPath]);
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(fs.readFileSync(claudePath, 'utf-8'))).toEqual({
      model: 'opus',
      permissions: { allow: ['Read'] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Write',
            description: 'shared user group',
            hooks: [userHandler],
          },
        ],
        Stop: [{ hooks: [userHandler] }],
      },
    });
    expect(JSON.parse(fs.readFileSync(codexPath, 'utf-8'))).toEqual({
      customRoot: true,
      hooks: {
        PreToolUse: [
          {
            matcher: 'apply_patch',
            metadata: { owner: 'user' },
            hooks: [nearMatch],
          },
        ],
      },
    });

    const claudeAfter = fs.readFileSync(claudePath, 'utf-8');
    const codexAfter = fs.readFileSync(codexPath, 'utf-8');
    expect(cleanup().removedHooks).toEqual([]);
    expect(fs.readFileSync(claudePath, 'utf-8')).toBe(claudeAfter);
    expect(fs.readFileSync(codexPath, 'utf-8')).toBe(codexAfter);
  });

  it.each([
    ['invalid JSON', '{ invalid'],
    ['unexpected hook tree', JSON.stringify({ hooks: { PreToolUse: {} } })],
  ])('leaves %s byte-for-byte unchanged with an actionable path', (_label, raw) => {
    const configPath = path.join(project, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, raw);

    const result = cleanup();

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(raw);
    expect(result.removedHooks).toEqual([]);
    expect(result.warnings.join('\n')).toContain(configPath);
    expect(result.warnings.join('\n')).toContain('left unchanged');
  });

  it('removes recognized direct-child state and temp files but preserves unknowns', () => {
    const stateDir = path.join(dataHome, 'runtime', 'edit-boundaries');
    const root = path.resolve(project);
    const recordName = retiredEditBoundaryStateFileName(root);
    const validRecord = {
      version: 1,
      root,
      boundary: path.join(root, 'src'),
      setByRuntime: 'codex',
      setByEnforcement: 'soft',
      updatedAt: new Date(0).toISOString(),
    };
    const futureName = retiredEditBoundaryStateFileName(path.join(root, 'future'));
    fs.mkdirSync(path.join(stateDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(stateDir, recordName), JSON.stringify(validRecord));
    fs.writeFileSync(
      path.join(stateDir, futureName),
      JSON.stringify({
        ...validRecord,
        version: 2,
        root: path.join(root, 'future'),
        boundary: path.join(root, 'future'),
      })
    );
    fs.writeFileSync(path.join(stateDir, 'malformed.json'), '{ bad');
    fs.writeFileSync(path.join(stateDir, 'keep.txt'), 'keep');
    const tempName = `.${recordName}.123.${'a'.repeat(16)}.tmp`;
    fs.writeFileSync(path.join(stateDir, tempName), 'partial');

    const first = cleanup();

    expect(fs.existsSync(path.join(stateDir, recordName))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, tempName))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, futureName))).toBe(true);
    expect(fs.readFileSync(path.join(stateDir, 'keep.txt'), 'utf-8')).toBe('keep');
    expect(fs.existsSync(path.join(stateDir, 'nested'))).toBe(true);
    expect(first.removedStateEntries).toHaveLength(2);
    expect(first.warnings.join('\n')).toContain(futureName);
    expect(first.warnings.join('\n')).toContain('nested');

    const second = cleanup();
    expect(second.removedStateEntries).toEqual([]);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it('uses the frozen platform identity rules for Windows and POSIX roots', () => {
    const windowsUpper = path.win32.join('C:\\', 'Repo', 'Project');
    const windowsLower = path.win32.join('c:\\', 'repo', 'project');
    const posixUpper = path.posix.join('/', 'Repo', 'Project');
    const posixLower = path.posix.join('/', 'repo', 'project');

    expect(
      retiredEditBoundaryStateFileName(windowsUpper, 'win32')
    ).toBe(
      retiredEditBoundaryStateFileName(windowsLower, 'win32')
    );
    expect(
      retiredEditBoundaryStateFileName(posixUpper, 'linux')
    ).not.toBe(
      retiredEditBoundaryStateFileName(posixLower, 'linux')
    );
  });

  it('removes canonical released state through a checkout alias and preserves link entries', (context) => {
    const projectAlias = path.join(fixture, 'project-alias');
    const linkTarget = path.join(fixture, 'preserved-link-target');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.mkdirSync(linkTarget);

    try {
      fs.symlinkSync(project, projectAlias, linkType);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(code ?? '')) {
        context.skip();
        return;
      }
      throw error;
    }

    const canonicalProject = fs.realpathSync.native(project);
    const canonicalFromAlias = fs.realpathSync.native(projectAlias);
    const canonicalBoundary = fs.realpathSync.native(
      path.join(projectAlias, 'src')
    );
    expect(canonicalFromAlias).toBe(canonicalProject);

    const stateDir = path.join(dataHome, 'runtime', 'edit-boundaries');
    const recordName = retiredEditBoundaryStateFileName(canonicalFromAlias);
    const recordPath = path.join(stateDir, recordName);
    const preservedLink = path.join(
      stateDir,
      retiredEditBoundaryStateFileName(path.join(canonicalProject, 'unknown'))
    );
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      recordPath,
      JSON.stringify({
        version: 1,
        root: canonicalFromAlias,
        boundary: canonicalBoundary,
        setByRuntime: 'codex',
        setByEnforcement: 'soft',
        updatedAt: new Date(0).toISOString(),
      })
    );
    try {
      fs.symlinkSync(linkTarget, preservedLink, linkType);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(code ?? '')) {
        context.skip();
        return;
      }
      throw error;
    }

    const result = cleanupRetiredEditBoundaryArtifacts(projectAlias, {
      env: { RASEN_HOME: dataHome },
    });

    expect(result.removedStateEntries).toContain(recordPath);
    expect(fs.existsSync(recordPath)).toBe(false);
    expect(fs.lstatSync(preservedLink).isSymbolicLink()).toBe(true);
    expect(result.warnings.join('\n')).toContain(preservedLink);
  });

  it('removes only the exact feature directory when it becomes empty', () => {
    const stateDir = path.join(dataHome, 'runtime', 'edit-boundaries');
    const root = path.resolve(project);
    const recordName = retiredEditBoundaryStateFileName(root);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, recordName),
      JSON.stringify({
        version: 1,
        root,
        boundary: root,
        setByRuntime: 'claude',
        setByEnforcement: 'hard',
        updatedAt: new Date(0).toISOString(),
      })
    );

    cleanup();

    expect(fs.existsSync(stateDir)).toBe(false);
    expect(fs.existsSync(path.join(dataHome, 'runtime'))).toBe(true);
    expect(fs.existsSync(dataHome)).toBe(true);
  });
});
