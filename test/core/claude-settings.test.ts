import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ensureClaudeAgentTeams,
  AGENT_TEAMS_ENV,
} from '../../src/core/claude-settings.js';

describe('ensureClaudeAgentTeams', () => {
  let projectRoot: string;
  const settingsPath = () => path.join(projectRoot, '.claude', 'settings.json');
  const readSettings = () => JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-claude-settings-'));
  });
  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates .claude/settings.json with the agent-teams env when absent', () => {
    const result = ensureClaudeAgentTeams(projectRoot);
    expect(result).toBe('created');
    expect(readSettings().env[AGENT_TEAMS_ENV]).toBe('1');
  });

  it('merges into existing settings, preserving other keys and env vars', () => {
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ model: 'opus', env: { FOO: 'bar' }, hooks: { PreToolUse: [] } }, null, 2),
      'utf-8'
    );

    const result = ensureClaudeAgentTeams(projectRoot);
    expect(result).toBe('added');

    const s = readSettings();
    expect(s.env[AGENT_TEAMS_ENV]).toBe('1');
    expect(s.env.FOO).toBe('bar'); // existing env preserved
    expect(s.model).toBe('opus'); // other keys preserved
    expect(s.hooks).toEqual({ PreToolUse: [] });
  });

  it('is idempotent when the flag is already enabled', () => {
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    const original = JSON.stringify({ env: { [AGENT_TEAMS_ENV]: '1' }, model: 'sonnet' }, null, 2) + '\n';
    fs.writeFileSync(settingsPath(), original, 'utf-8');

    const result = ensureClaudeAgentTeams(projectRoot);
    expect(result).toBe('already');
    // file content unchanged (no rewrite)
    expect(fs.readFileSync(settingsPath(), 'utf-8')).toBe(original);
  });

  it('does not clobber a settings.json that is not valid JSON', () => {
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath(), '{ not valid json', 'utf-8');

    const result = ensureClaudeAgentTeams(projectRoot);
    expect(result).toBe('skipped-invalid');
    expect(fs.readFileSync(settingsPath(), 'utf-8')).toBe('{ not valid json');
  });

  it('honors a custom claude dir', () => {
    const result = ensureClaudeAgentTeams(projectRoot, '.claude-custom');
    expect(result).toBe('created');
    const custom = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.claude-custom', 'settings.json'), 'utf-8')
    );
    expect(custom.env[AGENT_TEAMS_ENV]).toBe('1');
  });
});
