import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';
import {
  RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER,
  RETIRED_CODEX_EDIT_BOUNDARY_HANDLER,
  retiredEditBoundaryStateFileName,
} from '../../src/core/retired-edit-boundary.js';

describe('init/update edit-boundary lifecycle', () => {
  let fixture: string;
  let project: string;
  let originalEnv: NodeJS.ProcessEnv;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-boundary-lifecycle-'));
    project = path.join(fixture, 'project');
    fs.mkdirSync(project, { recursive: true });
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = path.join(fixture, 'machine');
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    process.env = originalEnv;
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('fresh init leaves Claude/Codex without a Rasen edit-boundary hook', async () => {
    const init = new InitCommand({
      tools: 'claude,codex',
      profile: 'core',
      interactive: false,
    });
    await init.execute(project);

    const claudeSettingsPath = path.join(project, '.claude', 'settings.json');
    const codexHooksPath = path.join(project, '.codex', 'hooks.json');
    if (fs.existsSync(claudeSettingsPath)) {
      expect(fs.readFileSync(claudeSettingsPath, 'utf-8')).not.toContain(
        RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER.command
      );
    }
    expect(fs.existsSync(codexHooksPath)).toBe(false);
    for (const dirName of ['rasen-freeze', 'rasen-guard', 'rasen-unfreeze']) {
      expect(fs.existsSync(path.join(project, '.claude', 'skills', dirName))).toBe(
        false
      );
      expect(fs.existsSync(path.join(project, '.codex', 'skills', dirName))).toBe(
        false
      );
    }

    const claudeBefore = fs.existsSync(claudeSettingsPath)
      ? fs.readFileSync(claudeSettingsPath, 'utf-8')
      : null;
    await init.execute(project);
    expect(
      fs.existsSync(claudeSettingsPath)
        ? fs.readFileSync(claudeSettingsPath, 'utf-8')
        : null
    ).toBe(claudeBefore);
    expect(fs.existsSync(codexHooksPath)).toBe(false);
  });

  it('one update heals both retired generations without recreating hooks', async () => {
    await new InitCommand({
      tools: 'claude,codex',
      profile: 'core',
      interactive: false,
    }).execute(project);

    for (const toolDir of ['.claude', '.codex']) {
      const root = path.join(project, toolDir, 'skills');
      for (const dirName of ['rasen-freeze', 'rasen-guard', 'rasen-unfreeze']) {
        fs.mkdirSync(path.join(root, dirName), { recursive: true });
      }
      fs.mkdirSync(path.join(root, 'rasen-guard-user'), { recursive: true });
    }
    const statePath = path.join(process.env.RASEN_HOME!, 'freeze-dir.txt');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, 'src');
    fs.writeFileSync(path.join(process.env.RASEN_HOME!, 'keep.txt'), 'keep');

    const userHandler = { type: 'command', command: 'echo user' };
    const claudeSettingsPath = path.join(project, '.claude', 'settings.json');
    const claudeSettings = fs.existsSync(claudeSettingsPath)
      ? JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
      : {};
    claudeSettings.hooks = {
      ...(claudeSettings.hooks ?? {}),
      PreToolUse: [
        { matcher: 'Bash', hooks: [userHandler] },
        {
          matcher: 'Edit|Write',
          hooks: [RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER],
        },
      ],
    };
    fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
    fs.writeFileSync(claudeSettingsPath, JSON.stringify(claudeSettings));

    const codexHooksPath = path.join(project, '.codex', 'hooks.json');
    fs.mkdirSync(path.dirname(codexHooksPath), { recursive: true });
    fs.writeFileSync(
      codexHooksPath,
      JSON.stringify({
        keep: true,
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [userHandler] },
            {
              matcher: 'apply_patch|Edit|Write',
              hooks: [RETIRED_CODEX_EDIT_BOUNDARY_HANDLER],
            },
          ],
        },
      })
    );

    const runtimeStateDir = path.join(
      process.env.RASEN_HOME!,
      'runtime',
      'edit-boundaries'
    );
    const runtimeStateName = retiredEditBoundaryStateFileName(path.resolve(project));
    fs.mkdirSync(runtimeStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeStateDir, runtimeStateName),
      JSON.stringify({
        version: 1,
        root: path.resolve(project),
        boundary: path.resolve(project),
        setByRuntime: 'codex',
        setByEnforcement: 'soft',
        updatedAt: new Date(0).toISOString(),
      })
    );

    await new UpdateCommand({ onlyThis: true }).execute(project);

    for (const toolDir of ['.claude', '.codex']) {
      const root = path.join(project, toolDir, 'skills');
      for (const dirName of ['rasen-freeze', 'rasen-guard', 'rasen-unfreeze']) {
        expect(fs.existsSync(path.join(root, dirName))).toBe(false);
      }
      expect(fs.existsSync(path.join(root, 'rasen-guard-user'))).toBe(true);
    }
    expect(fs.existsSync(statePath)).toBe(false);
    expect(fs.readFileSync(path.join(process.env.RASEN_HOME!, 'keep.txt'), 'utf-8')).toBe(
      'keep'
    );
    expect(fs.existsSync(path.join(runtimeStateDir, runtimeStateName))).toBe(false);
    expect(JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8')).hooks.PreToolUse)
      .toEqual([{ matcher: 'Bash', hooks: [userHandler] }]);
    expect(JSON.parse(fs.readFileSync(codexHooksPath, 'utf-8'))).toEqual({
      keep: true,
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [userHandler] }],
      },
    });

    const claudeAfter = fs.readFileSync(claudeSettingsPath, 'utf-8');
    const codexAfter = fs.readFileSync(codexHooksPath, 'utf-8');
    await new UpdateCommand({ onlyThis: true }).execute(project);
    expect(fs.readFileSync(claudeSettingsPath, 'utf-8')).toBe(claudeAfter);
    expect(fs.readFileSync(codexHooksPath, 'utf-8')).toBe(codexAfter);
  });

  it.each([
    [
      'claude',
      '.claude',
      'settings.json',
      'Edit|Write',
      RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER,
    ],
    [
      'codex',
      '.codex',
      'hooks.json',
      'apply_patch|Edit|Write',
      RETIRED_CODEX_EDIT_BOUNDARY_HANDLER,
    ],
  ] as const)(
    'update smoke-cleans an exact %s hook while preserving an unrelated handler',
    async (tool, toolDir, configFile, matcher, retiredHandler) => {
      await new InitCommand({
        tools: tool,
        profile: 'core',
        interactive: false,
      }).execute(project);
      const configPath = path.join(project, toolDir, configFile);
      const existing = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        : {};
      const userGroup = {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo user' }],
      };
      existing.hooks = {
        ...(existing.hooks ?? {}),
        PreToolUse: [
          userGroup,
          { matcher, hooks: [retiredHandler] },
        ],
      };
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(existing));

      await new UpdateCommand({ onlyThis: true }).execute(project);

      const cleaned = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(cleaned.hooks.PreToolUse).toEqual([userGroup]);
      const after = fs.readFileSync(configPath, 'utf-8');
      await new UpdateCommand({ onlyThis: true }).execute(project);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(after);
    }
  );

  it('does not install a false hook for an unsupported configured tool', async () => {
    process.env.HERMES_HOME = path.join(fixture, 'hermes-home');
    await new InitCommand({
      tools: 'hermes',
      profile: 'core',
      interactive: false,
    }).execute(project);
    expect(fs.existsSync(path.join(process.env.HERMES_HOME, 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.hermes', 'hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.claude', 'settings.json'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(project, '.codex', 'hooks.json'))).toBe(false);
  });
});
