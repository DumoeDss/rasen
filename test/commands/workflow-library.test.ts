import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWorkflowLibraryCommand } from '../../src/commands/workflow-library.js';

async function runWorkflowCommand(args: string[]): Promise<void> {
  const program = new Command();
  registerWorkflowLibraryCommand(program);
  await program.parseAsync(['node', 'rasen', 'workflow', ...args]);
}

describe('workflow command', () => {
  let home: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalExitCode: number | undefined;
  const originalCwd = process.cwd();
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-command-'));
    originalEnv = { ...process.env };
    originalExitCode = process.exitCode;
    process.env.RASEN_HOME = home;
    process.env.RASEN_LANG = 'en';
    process.env.OPEN_SPEC_INTERACTIVE = '0';
    process.exitCode = undefined;
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    process.exitCode = originalExitCode;
    log.mockRestore();
    error.mockRestore();
    warn.mockRestore();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function lastJson(): Record<string, unknown> {
    const value = log.mock.calls.at(-1)?.[0];
    expect(typeof value).toBe('string');
    return JSON.parse(value as string) as Record<string, unknown>;
  }

  it('lists built-ins with a locale-neutral JSON contract', async () => {
    await runWorkflowCommand(['list', '--json']);

    const output = lastJson();
    expect(output.status).toEqual([]);
    expect(output.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'apply', source: 'built-in', commandId: 'apply' }),
      ])
    );
  });

  it('runs the draft, validate, import, show, which, export, and delete journey', async () => {
    const draft = path.join(home, 'drafts', 'team-release');
    const packagePath = path.join(home, 'exports', 'team-release.rasenpkg');

    await runWorkflowCommand(['init', 'team-release', '--output', draft, '--json']);
    expect(lastJson()).toMatchObject({ workflow: { id: 'team-release', output: draft }, status: [] });

    log.mockClear();
    await runWorkflowCommand(['validate', draft, '--json']);
    expect(lastJson()).toMatchObject({ validation: { valid: true, kind: 'directory' }, status: [] });

    log.mockClear();
    await runWorkflowCommand(['import', draft, '--json']);
    expect(lastJson()).toMatchObject({ imported: ['team-release'], reused: [], status: [] });

    log.mockClear();
    await runWorkflowCommand(['show', 'team-release', '--json']);
    expect(lastJson()).toMatchObject({
      workflow: { id: 'team-release', source: 'user' },
      usage: [],
      status: [],
    });

    log.mockClear();
    await runWorkflowCommand(['which', 'team-release', '--json']);
    expect(lastJson()).toMatchObject({
      workflow: { id: 'team-release', source: 'user' },
      status: [],
    });

    log.mockClear();
    await runWorkflowCommand(['export', 'team-release', packagePath, '--json']);
    expect(lastJson()).toMatchObject({
      workflow: { id: 'team-release', path: packagePath },
      status: [],
    });
    expect(fs.existsSync(packagePath)).toBe(true);

    log.mockClear();
    await runWorkflowCommand(['delete', 'team-release', '--yes', '--json']);
    expect(lastJson()).toEqual({ deleted: 'team-release', status: [] });
    expect(warn).toHaveBeenCalledWith(
      'Warning: project-local consumers outside the current project may still exist.'
    );
  });

  it('keeps JSON failures to one document with a stable code', async () => {
    await runWorkflowCommand(['show', 'missing', '--json']);

    expect(log).toHaveBeenCalledTimes(1);
    expect(lastJson()).toEqual({
      workflow: null,
      usage: [],
      status: [
        {
          severity: 'error',
          code: 'workflow_not_found',
          message: 'Workflow "missing" was not found',
        },
      ],
    });
    expect(process.exitCode).toBe(1);
  });

  it('requires explicit confirmation for delete in non-interactive mode', async () => {
    await runWorkflowCommand(['delete', 'apply', '--json']);

    expect(lastJson()).toMatchObject({
      deleted: null,
      status: [expect.objectContaining({ code: 'confirmation_required' })],
    });
    expect(process.exitCode).toBe(1);
  });

  it.each(['pipeline', 'ledger'] as const)(
    'blocks deletion from a nested project directory with a %s reference',
    async (referenceKind) => {
      const id = `nested-${referenceKind}`;
      const draft = path.join(home, 'drafts', id);
      await runWorkflowCommand(['init', id, '--output', draft, '--json']);
      await runWorkflowCommand(['import', draft, '--json']);

      const project = path.join(home, `project-${referenceKind}`);
      fs.mkdirSync(path.join(project, 'rasen'), { recursive: true });
      if (referenceKind === 'pipeline') {
        const pipelineDirectory = path.join(project, 'rasen', 'pipelines', 'uses-workflow');
        fs.mkdirSync(pipelineDirectory, { recursive: true });
        fs.writeFileSync(
          path.join(pipelineDirectory, 'pipeline.yaml'),
          `stages:\n  - id: check\n    skill: rasen-${id}\n`
        );
      } else {
        fs.writeFileSync(
          path.join(project, 'rasen', '.workflow-artifacts.json'),
          JSON.stringify({ workflows: [id] })
        );
      }
      const nested = path.join(project, 'src', 'nested');
      fs.mkdirSync(nested, { recursive: true });
      process.chdir(nested);
      log.mockClear();

      await runWorkflowCommand(['delete', id, '--yes', '--json']);

      expect(lastJson()).toMatchObject({
        deleted: null,
        status: [expect.objectContaining({ code: 'workflow_in_use' })],
      });
      expect(fs.existsSync(path.join(home, 'workflows', id))).toBe(true);
      expect(process.exitCode).toBe(1);
    }
  );

  it('localizes human output while preserving machine IDs and diagnostic codes', async () => {
    process.env.RASEN_LANG = 'ja';
    await runWorkflowCommand(['list']);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^apply\t組み込み\trasen-apply-change/));

    log.mockClear();
    const draft = path.join(home, 'drafts', 'localized');
    await runWorkflowCommand(['init', 'localized', '--output', draft]);
    expect(log).toHaveBeenCalledWith(`ワークフロードラフトを${draft}に作成しました`);

    error.mockClear();
    await runWorkflowCommand(['show', 'missing']);
    expect(error).toHaveBeenCalledWith('エラー: ワークフローが見つかりません。');
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    log.mockClear();
    await runWorkflowCommand(['show', 'missing', '--json']);
    expect(lastJson()).toMatchObject({
      status: [expect.objectContaining({ code: 'workflow_not_found' })],
    });
  });
});
