import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CLAUDE_EDIT_BOUNDARY_MATCHER,
  CODEX_EDIT_BOUNDARY_MATCHER,
  EDIT_BOUNDARY_HOOK_STATUS,
  editBoundaryHookCommand,
  editBoundaryHookWindowsCommand,
  ensureClaudeEditBoundaryHook,
  ensureCodexEditBoundaryHook,
  inspectEditBoundaryHook,
  reconcileEditBoundaryHooks,
} from '../../src/core/edit-boundary-hooks.js';

describe('edit-boundary host hook reconciliation', () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-boundary-hooks-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('reconciles one exact Claude entry while preserving settings and unrelated hooks', () => {
    const settingsPath = path.join(project, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const unrelated = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo existing' }],
    };
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        model: 'opus',
        hooks: {
          PreToolUse: [
            unrelated,
            {
              matcher: 'Write',
              hooks: [
                {
                  type: 'command',
                  command: 'old command',
                  statusMessage: EDIT_BOUNDARY_HOOK_STATUS,
                },
              ],
            },
          ],
          Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
        },
      })
    );

    expect(ensureClaudeEditBoundaryHook(project).status).toBe('added');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.model).toBe('opus');
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toEqual([
      unrelated,
      {
        matcher: CLAUDE_EDIT_BOUNDARY_MATCHER,
        hooks: [
          {
            type: 'command',
            command: editBoundaryHookCommand('claude'),
            timeout: 10,
            statusMessage: EDIT_BOUNDARY_HOOK_STATUS,
          },
        ],
      },
    ]);
    const before = fs.readFileSync(settingsPath, 'utf-8');
    expect(ensureClaudeEditBoundaryHook(project).status).toBe('already');
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
    expect(inspectEditBoundaryHook(project, 'claude')).toMatchObject({
      configured: true,
      usable: true,
      enforcement: 'hard',
      reason: 'configured',
    });
  });

  it('preserves unrelated sibling handlers, mixed-group metadata, and other hook phases', () => {
    const settingsPath = path.join(project, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const unrelatedBefore = {
      type: 'command',
      command: 'echo before',
      timeout: 20,
    };
    const unrelatedAfter = {
      type: 'prompt',
      prompt: 'review this write',
    };
    const postToolUse = [
      {
        matcher: 'Write',
        hooks: [{ type: 'command', command: 'echo post-write' }],
      },
    ];
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        model: 'opus',
        permissions: { allow: ['Read'] },
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write',
              description: 'shared user group',
              customMetadata: { owner: 'user' },
              hooks: [
                unrelatedBefore,
                {
                  type: 'command',
                  command: 'old command',
                  statusMessage: EDIT_BOUNDARY_HOOK_STATUS,
                },
                unrelatedAfter,
              ],
            },
          ],
          PostToolUse: postToolUse,
        },
      })
    );

    expect(ensureClaudeEditBoundaryHook(project).status).toBe('added');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.model).toBe('opus');
    expect(settings.permissions).toEqual({ allow: ['Read'] });
    expect(settings.hooks.PostToolUse).toEqual(postToolUse);
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: 'Write',
        description: 'shared user group',
        customMetadata: { owner: 'user' },
        hooks: [unrelatedBefore, unrelatedAfter],
      },
      {
        matcher: CLAUDE_EDIT_BOUNDARY_MATCHER,
        hooks: [
          {
            type: 'command',
            command: editBoundaryHookCommand('claude'),
            timeout: 10,
            statusMessage: EDIT_BOUNDARY_HOOK_STATUS,
          },
        ],
      },
    ]);

    const before = fs.readFileSync(settingsPath, 'utf-8');
    expect(ensureClaudeEditBoundaryHook(project).status).toBe('already');
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
  });

  it.each([
    ['non-object hooks', { model: 'opus', hooks: [] }],
    [
      'non-array PreToolUse',
      {
        model: 'opus',
        hooks: {
          PreToolUse: { matcher: 'Write', hooks: [] },
          Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
        },
      },
    ],
    [
      'non-array group handler list',
      {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write',
              hooks: { type: 'command', command: 'echo malformed' },
            },
          ],
        },
      },
    ],
  ])('leaves syntactically valid settings unchanged for %s', (_label, settings) => {
    const settingsPath = path.join(project, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    const before = fs.readFileSync(settingsPath, 'utf-8');

    const result = ensureClaudeEditBoundaryHook(project);

    expect(result).toMatchObject({
      status: 'skipped-invalid',
      warning: expect.stringContaining('left unchanged'),
    });
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
    expect(inspectEditBoundaryHook(project, 'claude')).toMatchObject({
      configured: false,
      usable: false,
      enforcement: 'soft',
      reason: 'invalid',
    });
  });

  it('refuses to clobber invalid Claude settings and downgrades disabled hooks', () => {
    const settingsPath = path.join(project, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, '{ invalid');
    expect(ensureClaudeEditBoundaryHook(project).status).toBe('skipped-invalid');
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe('{ invalid');
    expect(inspectEditBoundaryHook(project, 'claude')).toMatchObject({
      enforcement: 'soft',
      reason: 'invalid',
    });

    fs.rmSync(settingsPath);
    ensureClaudeEditBoundaryHook(project);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    settings.disableAllHooks = true;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    expect(inspectEditBoundaryHook(project, 'claude')).toMatchObject({
      configured: true,
      usable: false,
      enforcement: 'soft',
      reason: 'disabled',
    });
  });

  it('creates a Codex project hook with exact aliases and Windows command form', () => {
    const result = ensureCodexEditBoundaryHook(project);
    expect(result.status).toBe('created');
    expect(result.warning).toContain('project trust');
    const hooks = JSON.parse(
      fs.readFileSync(path.join(project, '.codex', 'hooks.json'), 'utf-8')
    );
    expect(hooks.hooks.PreToolUse).toEqual([
      {
        matcher: CODEX_EDIT_BOUNDARY_MATCHER,
        hooks: [
          {
            type: 'command',
            command: editBoundaryHookCommand('codex'),
            timeout: 10,
            statusMessage: EDIT_BOUNDARY_HOOK_STATUS,
            command_windows: editBoundaryHookWindowsCommand('codex'),
          },
        ],
      },
    ]);
    expect(JSON.stringify(hooks)).not.toContain('skills');
    expect(inspectEditBoundaryHook(project, 'codex')).toMatchObject({
      configured: true,
      usable: false,
      enforcement: 'soft',
      reason: 'trust-required',
    });
    expect(ensureCodexEditBoundaryHook(project).status).toBe('already');
  });

  it('is independent of skill directories and leaves unsupported hosts alone', () => {
    expect(reconcileEditBoundaryHooks(project, ['claude', 'codex', 'zed'])).toHaveLength(
      2
    );
    expect(fs.existsSync(path.join(project, '.claude', 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.codex', 'skills'))).toBe(false);
    expect(inspectEditBoundaryHook(project, 'zed')).toMatchObject({
      configured: false,
      enforcement: 'unsupported',
      reason: 'unsupported',
      configPath: null,
    });
  });
});
