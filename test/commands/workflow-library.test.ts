import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  beforeReaddir: null as ((directoryPath: fs.PathLike) => void) | null,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readdirSync = ((directoryPath: fs.PathLike, options?: unknown) => {
    fsMock.beforeReaddir?.(directoryPath);
    return Reflect.apply(
      actual.readdirSync,
      actual,
      options === undefined ? [directoryPath] : [directoryPath, options]
    );
  }) as typeof actual.readdirSync;
  return { ...actual, default: actual, readdirSync };
});

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
    fsMock.beforeReaddir = null;
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
        expect.objectContaining({ id: 'apply', source: 'built-in', kind: 'task' }),
      ])
    );
  });

  it('JSON always includes internal and driver workflows annotated with kind, regardless of --all', async () => {
    await runWorkflowCommand(['list', '--json']);
    const withoutAll = (lastJson().workflows as Array<{ id: string; kind: string }>);

    log.mockClear();
    await runWorkflowCommand(['list', '--all', '--json']);
    const withAll = (lastJson().workflows as Array<{ id: string; kind: string }>);

    for (const ids of [withoutAll, withAll]) {
      expect(ids).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'goal-plan', kind: 'internal' }),
          expect.objectContaining({ id: 'auto-command', kind: 'driver' }),
        ])
      );
    }
    expect(withoutAll).toEqual(withAll);
  });

  it('human list groups by kind, hides internal by default, and reveals it with --all', async () => {
    await runWorkflowCommand(['list']);
    const linesWithoutAll = log.mock.calls.map((call) => call[0]);
    expect(linesWithoutAll).toContain('Tasks:');
    expect(linesWithoutAll).toContain('Drivers:');
    expect(linesWithoutAll).not.toContain('Internal:');
    expect(linesWithoutAll.some((line) => /^goal-plan\s/.test(String(line)))).toBe(false);

    log.mockClear();
    await runWorkflowCommand(['list', '--all']);
    const linesWithAll = log.mock.calls.map((call) => call[0]);
    expect(linesWithAll).toContain('Internal:');
    expect(linesWithAll.some((line) => /^goal-plan\s/.test(String(line)))).toBe(true);
  });

  it('aligns human list columns across mixed id lengths without tab characters', async () => {
    const draft = path.join(home, 'drafts', 'al');
    await runWorkflowCommand(['init', 'al', '--output', draft, '--json']);
    await runWorkflowCommand(['import', draft, '--json']);
    fs.writeFileSync(path.join(home, 'workflows', 'stray.txt'), 'stray');

    log.mockClear();
    await runWorkflowCommand(['list', '--all']);
    const lines = log.mock.calls.map(([value]) => String(value));

    expect(lines.every((line) => !line.includes('\t'))).toBe(true);
    const dataRows = lines.filter((line) => !line.endsWith(':'));
    expect(dataRows.length).toBeGreaterThan(2);
    expect(dataRows.some((line) => /^al {2,}/.test(line))).toBe(true);
    expect(dataRows.some((line) => /^stray\.txt {2,}/.test(line))).toBe(true);
    const secondColumnOffsets = new Set(
      dataRows.map((line) => /^(\S+ +)/.exec(line)![1].length)
    );
    expect(secondColumnOffsets.size).toBe(1);
  });

  it('shows the expert group by default (unlike internal), and JSON tags experts with kind:expert', async () => {
    await runWorkflowCommand(['list']);
    const lines = log.mock.calls.map((call) => call[0]);
    expect(lines).toContain('Experts:');
    expect(lines.some((line) => /^review\s/.test(String(line)))).toBe(true);

    log.mockClear();
    await runWorkflowCommand(['list', '--json']);
    expect(lastJson().workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'review', source: 'built-in', kind: 'expert' }),
        expect.objectContaining({ id: 'qa-only', source: 'built-in', kind: 'expert' }),
      ])
    );
  });

  it('scans the catalog and usage sources once per list invocation', async () => {
    const ids = [
      'batch-config',
      'batch-profile',
      'batch-global-pipeline',
      'batch-project-pipeline',
      'batch-unused',
    ];
    for (const id of ids) {
      const draft = path.join(home, 'drafts', id);
      await runWorkflowCommand(['init', id, '--output', draft, '--json']);
      await runWorkflowCommand(['import', draft, '--json']);
    }

    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ workflows: ['batch-config'] }));
    const profilesDir = path.join(home, 'profiles');
    fs.mkdirSync(profilesDir);
    fs.writeFileSync(
      path.join(profilesDir, 'batch.yaml'),
      'workflows:\n  - batch-profile\n'
    );
    const globalPipelinesDir = path.join(home, 'pipelines');
    fs.mkdirSync(path.join(globalPipelinesDir, 'batch'), { recursive: true });
    fs.writeFileSync(
      path.join(globalPipelinesDir, 'batch', 'pipeline.yaml'),
      'stages:\n  - id: batch\n    skill: rasen-batch-global-pipeline\n'
    );
    const project = path.join(home, 'project');
    const projectPipelinesDir = path.join(project, 'rasen', 'pipelines');
    fs.mkdirSync(path.join(projectPipelinesDir, 'batch'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPipelinesDir, 'batch', 'pipeline.yaml'),
      'stages:\n  - id: batch\n    skill: rasen-batch-project-pipeline\n'
    );
    process.chdir(project);

    const reads = new Map<string, number>();
    const trackedDirectories = [
      path.join(home, 'workflows'),
      profilesDir,
      globalPipelinesDir,
      projectPipelinesDir,
    ].map((directory) => path.resolve(directory));
    fsMock.beforeReaddir = (directoryPath) => {
      const resolved = path.resolve(String(directoryPath));
      if (trackedDirectories.includes(resolved)) {
        reads.set(resolved, (reads.get(resolved) ?? 0) + 1);
      }
    };
    const expectReadCount = (expected: number): void => {
      for (const directory of trackedDirectories) {
        expect(reads.get(directory)).toBe(expected);
      }
    };

    log.mockClear();
    await runWorkflowCommand(['list', '--json']);

    expect(lastJson().workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'batch-config', unused: false }),
        expect.objectContaining({ id: 'batch-profile', unused: false }),
        expect.objectContaining({ id: 'batch-global-pipeline', unused: false }),
        expect.objectContaining({ id: 'batch-project-pipeline', unused: false }),
        expect.objectContaining({ id: 'batch-unused', unused: true }),
      ])
    );
    expectReadCount(1);

    log.mockClear();
    await runWorkflowCommand(['list', '--unused', '--json']);

    expect(lastJson().workflows).toEqual([
      expect.objectContaining({ id: 'batch-unused', source: 'user', unused: true }),
    ]);
    expectReadCount(2);

    log.mockClear();
    await runWorkflowCommand(['list', '--unused']);

    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, 'Tasks:');
    expect(log).toHaveBeenNthCalledWith(2, 'batch-unused  user  rasen-batch-unused  unused');
    expectReadCount(3);
  });

  it('hides OS metadata files from the list and exported packages without hiding stray files', async () => {
    const id = 'junk-neighbor';
    const draft = path.join(home, 'drafts', id);
    await runWorkflowCommand(['init', id, '--output', draft, '--json']);
    await runWorkflowCommand(['import', draft, '--json']);
    const workflowsDir = path.join(home, 'workflows');
    fs.writeFileSync(path.join(workflowsDir, '.DS_Store'), Buffer.from([0x00, 0x01]));
    fs.writeFileSync(path.join(workflowsDir, 'notes.txt'), 'stray');
    fs.writeFileSync(path.join(workflowsDir, id, '.DS_Store'), Buffer.from([0x00, 0x01]));

    log.mockClear();
    await runWorkflowCommand(['list', '--json']);
    const payload = lastJson() as {
      workflows: Array<{ id: string }>;
      invalid: Array<{ id: string }>;
    };
    expect(payload.workflows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id })])
    );
    expect(payload.invalid).toEqual([expect.objectContaining({ id: 'notes.txt' })]);

    log.mockClear();
    await runWorkflowCommand(['list']);
    const humanLines = log.mock.calls.map(([value]) => String(value));
    expect(humanLines.some((line) => line.includes('.DS_Store'))).toBe(false);
    expect(humanLines.some((line) => line.startsWith('notes.txt'))).toBe(true);

    const packagePath = path.join(home, 'exports', `${id}.rasenpkg`);
    log.mockClear();
    await runWorkflowCommand(['export', id, packagePath, '--json']);
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
      workflows: Array<{ files: Array<{ path: string }> }>;
    };
    expect(
      packageJson.workflows.flatMap((workflow) => workflow.files.map((file) => file.path))
    ).toEqual(['SKILL.md', 'workflow.yaml']);
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
      workflow: { id: 'team-release', source: 'user', kind: 'task' },
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
    expect(lastJson()).toEqual({ deleted: 'team-release', forcedReferrers: [], status: [] });
    expect(warn).toHaveBeenCalledWith(
      'Warning: project-local consumers outside the current project may still exist.'
    );
  });

  it('exposes a declared skill title verbatim in list and show output', async () => {
    const id = 'titled-workflow';
    const draft = path.join(home, 'drafts', id);
    await runWorkflowCommand(['init', id, '--output', draft, '--json']);
    fs.appendFileSync(
      path.join(draft, 'workflow.yaml'),
      'skill:\n  name: Example Local Verify\n'
    );
    await runWorkflowCommand(['import', draft, '--json']);

    log.mockClear();
    await runWorkflowCommand(['list', '--json']);
    const listPayload = lastJson() as { workflows: Array<{ id: string; title: string | null }> };
    expect(listPayload.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, title: 'Example Local Verify' }),
        expect.objectContaining({ id: 'apply', title: null }),
      ])
    );

    log.mockClear();
    await runWorkflowCommand(['list']);
    const humanLines = log.mock.calls.map(([value]) => String(value));
    expect(humanLines.some((line) => line.includes('Example Local Verify'))).toBe(false);

    log.mockClear();
    await runWorkflowCommand(['show', id, '--json']);
    expect(lastJson()).toMatchObject({
      workflow: { id, title: 'Example Local Verify', category: null, tags: null },
    });

    log.mockClear();
    await runWorkflowCommand(['show', id]);
    expect(log).toHaveBeenCalledWith('Title: Example Local Verify');

    log.mockClear();
    await runWorkflowCommand(['show', 'apply', '--json']);
    expect(lastJson()).toMatchObject({ workflow: { id: 'apply', title: null } });
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

  it('deletes a referenced workflow with --force and reports the dangling referrers', async () => {
    const id = 'force-delete-target';
    const draft = path.join(home, 'drafts', id);
    await runWorkflowCommand(['init', id, '--output', draft, '--json']);
    await runWorkflowCommand(['import', draft, '--json']);
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ profile: 'custom', delivery: 'both', workflows: [id] })
    );

    log.mockClear();
    await runWorkflowCommand(['delete', id, '--yes', '--json']);
    expect(lastJson()).toMatchObject({
      deleted: null,
      status: [expect.objectContaining({ code: 'workflow_in_use' })],
    });

    log.mockClear();
    warn.mockClear();
    await runWorkflowCommand(['delete', id, '--yes', '--force', '--json']);
    expect(lastJson()).toMatchObject({
      deleted: id,
      forcedReferrers: [expect.stringContaining('global-selection')],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(id));
    expect(fs.existsSync(path.join(home, 'workflows', id))).toBe(false);
  });

  it('localizes human output while preserving machine IDs and diagnostic codes', async () => {
    process.env.RASEN_LANG = 'ja';
    await runWorkflowCommand(['list']);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^apply +組み込み +rasen-apply-change/));

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

  it('localizes Simplified Chinese human output while preserving JSON and user-authored content', async () => {
    process.env.RASEN_LANG = 'zh-cn';
    const id = 'authored-language';
    const authoredDescription = '作者が書いた説明は翻訳しない';
    const draft = path.join(home, 'drafts', id);
    await runWorkflowCommand(['init', id, '--output', draft, '--json']);
    const skillPath = path.join(draft, 'SKILL.md');
    fs.writeFileSync(
      skillPath,
      fs.readFileSync(skillPath, 'utf8').replace(
        `description: Describe when to use the ${id} workflow.`,
        `description: ${authoredDescription}`
      ),
      'utf-8'
    );
    await runWorkflowCommand(['import', draft, '--json']);

    log.mockClear();
    await runWorkflowCommand(['list']);
    const humanLines = log.mock.calls.map(([value]) => String(value));
    expect(humanLines).toContain('任务:');
    expect(humanLines).toContain('驱动:');
    expect(humanLines).toContain('专家:');
    expect(humanLines).toContainEqual(
      expect.stringMatching(new RegExp(`^${id} +用户 +rasen-${id} {2}未使用$`))
    );
    expect(humanLines).toContainEqual(expect.stringMatching(/^apply +内置 +rasen-apply-change/));
    expect(humanLines).not.toContain('Tasks:');

    error.mockClear();
    await runWorkflowCommand(['show', 'missing']);
    expect(error).toHaveBeenCalledWith('错误： 未找到该工作流。');
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining('Workflow was not found'));
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    log.mockClear();
    await runWorkflowCommand(['show', id, '--json']);
    const payload = lastJson() as {
      workflow: {
        id: string;
        source: string;
        kind: string;
        skill: { description: string };
      };
    };
    expect(payload.workflow).toMatchObject({
      id,
      source: 'user',
      kind: 'task',
      skill: { description: authoredDescription },
    });
  });
});
