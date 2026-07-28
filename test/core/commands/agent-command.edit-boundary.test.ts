import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AgentCommand } from '../../../src/commands/agent.js';
import { ensureClaudeEditBoundaryHook } from '../../../src/core/edit-boundary-hooks.js';

describe('AgentCommand edit-boundary', () => {
  let fixture: string;
  let project: string;
  let previousRasenHome: string | undefined;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Canonicalize the temp fixture with the native realpath resolver (matches
    // the edit-boundary code's canonicalizeExistingPath) so paths align on CI
    // runners where the temp dir has an OS alias (Windows RUNNER~1, macOS /tmp).
    fixture = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agent-boundary-'))
    );
    project = path.join(fixture, 'project');
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    previousRasenHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = path.join(fixture, 'data');
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    if (previousRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = previousRasenHome;
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('sets, reports, and clears stable JSON without any retired skill installed', async () => {
    ensureClaudeEditBoundaryHook(project);
    const command = new AgentCommand();
    const set = await command.editBoundarySet('src', {
      cwd: project,
      runtime: 'claude',
      json: true,
    });
    expect(set).toMatchObject({
      version: 1,
      action: 'set',
      active: true,
      runtime: 'claude',
      runtimeSource: 'cli-option',
      enforcement: 'hard',
      boundary: fs.realpathSync(path.join(project, 'src')),
    });
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual(set);
    expect(fs.existsSync(path.join(project, '.claude', 'skills'))).toBe(false);

    const status = await command.editBoundaryStatus({
      cwd: project,
      runtime: 'claude',
      json: true,
    });
    expect(status.boundary).toBe(set.boundary);
    expect(status.active).toBe(true);

    expect(
      await command.editBoundaryClear({
        cwd: project,
        runtime: 'claude',
        json: true,
      })
    ).toMatchObject({ action: 'clear', active: false, changed: true });
  });

  it('validates runtime names and creates no state for an unsupported adapter', async () => {
    const command = new AgentCommand();
    await expect(
      command.editBoundaryStatus({
        cwd: project,
        runtime: 'not-a-runtime',
        json: true,
      })
    ).rejects.toThrow(/Unknown runtime/);

    const result = await command.editBoundarySet('src', {
      cwd: project,
      runtime: 'zed',
      json: true,
    });
    expect(result).toMatchObject({
      active: false,
      enforcement: 'unsupported',
      error: expect.stringContaining('no active state'),
    });
    expect(fs.existsSync(result.statePath)).toBe(false);
  });

  it('keeps checker parse failures silent and emits the exact deny envelope', async () => {
    ensureClaudeEditBoundaryHook(project);
    const command = new AgentCommand();
    await command.editBoundarySet('src', {
      cwd: project,
      runtime: 'claude',
      json: true,
    });
    log.mockClear();

    await command.editBoundaryCheck({
      cwd: project,
      runtime: 'claude',
      input: { malformed: true },
    });
    expect(log).not.toHaveBeenCalled();

    await command.editBoundaryCheck({
      cwd: project,
      runtime: 'claude',
      input: {
        cwd: project,
        tool_name: 'Write',
        tool_input: { file_path: 'docs/outside.md' },
      },
    });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('Rasen edit boundary'),
      },
    });
  });
});
