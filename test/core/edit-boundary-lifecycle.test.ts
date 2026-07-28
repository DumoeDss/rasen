import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';
import {
  EDIT_BOUNDARY_HOOK_STATUS,
  inspectEditBoundaryHook,
} from '../../src/core/edit-boundary-hooks.js';

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

  it('init reconciles Claude/Codex hooks without retired skills and is idempotent', async () => {
    const init = new InitCommand({
      tools: 'claude,codex',
      profile: 'core',
      interactive: false,
    });
    await init.execute(project);

    expect(inspectEditBoundaryHook(project, 'claude').enforcement).toBe('hard');
    expect(inspectEditBoundaryHook(project, 'codex').enforcement).toBe('soft');
    for (const dirName of ['rasen-freeze', 'rasen-guard', 'rasen-unfreeze']) {
      expect(fs.existsSync(path.join(project, '.claude', 'skills', dirName))).toBe(
        false
      );
      expect(fs.existsSync(path.join(project, '.codex', 'skills', dirName))).toBe(
        false
      );
    }

    const claudeBefore = fs.readFileSync(
      path.join(project, '.claude', 'settings.json'),
      'utf-8'
    );
    const codexBefore = fs.readFileSync(
      path.join(project, '.codex', 'hooks.json'),
      'utf-8'
    );
    await init.execute(project);
    expect(
      fs.readFileSync(path.join(project, '.claude', 'settings.json'), 'utf-8')
    ).toBe(claudeBefore);
    expect(
      fs.readFileSync(path.join(project, '.codex', 'hooks.json'), 'utf-8')
    ).toBe(codexBefore);
  });

  it('update heals exact retired directories and state before its up-to-date return', async () => {
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
    expect(
      fs.readFileSync(path.join(project, '.claude', 'settings.json'), 'utf-8')
    ).toContain(EDIT_BOUNDARY_HOOK_STATUS);
  });

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
