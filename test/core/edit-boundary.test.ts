import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  clearEditBoundary,
  editHookOutput,
  evaluateEditHook,
  getEditBoundaryStatePath,
  getEditBoundaryStatus,
  isPathWithinBoundary,
  parseEditHookEnvelope,
  readEditBoundaryState,
  setEditBoundary,
} from '../../src/core/edit-boundary.js';

describe('checkout-scoped edit boundary', () => {
  let fixture: string;
  let project: string;
  let dataHome: string;
  const runtime = {
    runtime: 'claude' as const,
    runtimeSource: 'cli-option' as const,
    enforcement: 'hard' as const,
  };

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-edit-boundary-'));
    project = path.join(fixture, 'project with spaces');
    dataHome = path.join(fixture, 'machine-data');
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    fs.mkdirSync(path.join(project, 'src', 'nested'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  function options() {
    return {
      ...runtime,
      cwd: project,
      env: { RASEN_HOME: dataHome },
    };
  }

  it('supports inactive, active, atomic replacement, and idempotent clear transitions', () => {
    expect(getEditBoundaryStatus(options())).toMatchObject({
      active: false,
      boundary: null,
    });

    const first = setEditBoundary('src', options());
    expect(first).toMatchObject({ active: true, changed: true });
    expect(first.boundary).toBe(fs.realpathSync(path.join(project, 'src')));

    const second = setEditBoundary(path.join('src', 'nested'), options());
    expect(second).toMatchObject({ active: true, changed: true });
    expect(readEditBoundaryState(project, options()).record?.boundary).toBe(
      fs.realpathSync(path.join(project, 'src', 'nested'))
    );
    expect(
      fs
        .readdirSync(path.dirname(getEditBoundaryStatePath(project, options())))
        .filter((name) => name.endsWith('.tmp'))
    ).toEqual([]);

    expect(clearEditBoundary(options())).toMatchObject({
      active: false,
      changed: true,
    });
    expect(clearEditBoundary(options())).toMatchObject({
      active: false,
      changed: false,
    });
  });

  it('ignores corrupt, mismatched, and concurrent temporary records safely', () => {
    const statePath = getEditBoundaryStatePath(project, options());
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{ bad json');
    expect(getEditBoundaryStatus(options())).toMatchObject({
      active: false,
      warning: expect.stringContaining('unreadable'),
    });

    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        root: path.join(fixture, 'somewhere-else'),
        boundary: path.join(fixture, 'somewhere-else'),
        setByRuntime: 'claude',
        setByEnforcement: 'hard',
        updatedAt: new Date(0).toISOString(),
      })
    );
    expect(getEditBoundaryStatus(options())).toMatchObject({
      active: false,
      warning: expect.stringContaining('different execution root'),
    });

    fs.rmSync(statePath);
    fs.writeFileSync(`${statePath}.writer.tmp`, '{"partial":');
    const concurrentStatus = getEditBoundaryStatus(options());
    expect(concurrentStatus.active).toBe(false);
    expect(concurrentStatus.warning).toBeUndefined();
  });

  it('rejects invalid/outside directories and unsupported set creates no state', () => {
    expect(() => setEditBoundary('missing', options())).toThrow(
      /existing directory/
    );
    expect(() => setEditBoundary(fixture, options())).toThrow(
      /inside the execution root/
    );

    const result = setEditBoundary('src', {
      ...options(),
      runtime: 'zed',
      enforcement: 'unsupported',
    });
    expect(result).toMatchObject({
      active: false,
      changed: false,
      enforcement: 'unsupported',
      error: expect.stringContaining('no active state'),
    });
    expect(fs.existsSync(result.statePath)).toBe(false);
  });

  it('preserves and truthfully reports an active record across an unsupported set', () => {
    const supported = setEditBoundary('src', options());
    const before = fs.readFileSync(supported.statePath, 'utf-8');
    const unsupportedOptions = {
      ...options(),
      runtime: 'zed' as const,
      enforcement: 'unsupported' as const,
    };

    const unsupported = setEditBoundary(path.join('src', 'nested'), unsupportedOptions);

    expect(unsupported).toMatchObject({
      active: true,
      changed: false,
      boundary: supported.boundary,
      enforcement: 'unsupported',
      error: expect.stringMatching(/does not enforce it.*edits remain unrestricted/),
    });
    expect(unsupported.limitations).toContain(
      'This runtime has no edit-boundary adapter; edits remain unrestricted.'
    );
    expect(fs.readFileSync(supported.statePath, 'utf-8')).toBe(before);
    expect(getEditBoundaryStatus(unsupportedOptions)).toMatchObject({
      active: true,
      changed: false,
      boundary: supported.boundary,
      enforcement: 'unsupported',
    });
  });

  it('follows symlink identity and nearest-existing ancestors for new targets', () => {
    const outside = path.join(fixture, 'outside');
    fs.mkdirSync(outside);
    const link = path.join(project, 'src', 'escape');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    setEditBoundary('src', options());

    const outsideEvaluation = evaluateEditHook(
      {
        cwd: project,
        tool_name: 'Write',
        tool_input: { file_path: path.join('src', 'escape', 'new', 'file.ts') },
      },
      options()
    );
    expect(outsideEvaluation).toMatchObject({
      decision: 'deny',
      outsideTargets: [path.join(outside, 'new', 'file.ts')],
    });

    const insideEvaluation = evaluateEditHook(
      {
        cwd: project,
        tool_name: 'Edit',
        tool_input: { file_path: path.join('src', 'new', 'file.ts') },
      },
      options()
    );
    expect(insideEvaluation.decision).toBe('allow');
  });

  it('parses Claude and Codex envelopes and emits only the native deny shape', () => {
    setEditBoundary('src', options());
    const codex = parseEditHookEnvelope({
      cwd: project,
      tool_name: 'apply_patch',
      tool_input: {
        command:
          '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: docs/a.ts\n*** End Patch',
      },
    });
    expect(codex?.targets).toEqual(['src/a.ts', 'docs/a.ts']);

    const evaluation = evaluateEditHook(
      {
        cwd: project,
        tool_name: 'apply_patch',
        tool_input: {
          command: '*** Begin Patch\n*** Add File: docs/a.ts\n*** End Patch',
        },
      },
      options()
    );
    expect(editHookOutput(evaluation)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          fs.realpathSync(path.join(project, 'src'))
        ),
      },
    });
    expect(editHookOutput(evaluateEditHook('{bad', options()))).toBeUndefined();
  });
});

describe('separator-aware path containment', () => {
  it('rejects prefix siblings and dot-dot escapes with native paths', () => {
    const root = path.join(path.parse(process.cwd()).root, 'repo');
    const boundary = path.join(root, 'src');
    expect(isPathWithinBoundary(boundary, path.join(boundary, 'a.ts'))).toBe(true);
    expect(isPathWithinBoundary(boundary, path.join(root, 'src-old', 'a.ts'))).toBe(
      false
    );
    expect(
      isPathWithinBoundary(boundary, path.resolve(boundary, '..', 'docs', 'a.ts'))
    ).toBe(false);
  });

  it('handles Windows drive case, separator spelling, and UNC-shaped paths', () => {
    expect(
      isPathWithinBoundary(
        'C:\\Repo\\src',
        'c:/repo/src/nested/file.ts',
        path.win32
      )
    ).toBe(true);
    expect(
      isPathWithinBoundary(
        'C:\\Repo\\src',
        'C:\\Repo\\src-old\\file.ts',
        path.win32
      )
    ).toBe(false);
    expect(
      isPathWithinBoundary(
        '\\\\server\\share\\repo\\src',
        '\\\\SERVER\\SHARE\\repo\\src\\file.ts',
        path.win32
      )
    ).toBe(true);
    expect(
      isPathWithinBoundary(
        '\\\\server\\share\\repo\\src',
        '\\\\server\\share\\repo\\other\\file.ts',
        path.win32
      )
    ).toBe(false);
  });
});
