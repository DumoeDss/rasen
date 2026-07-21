import { afterAll, describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { runCLI, cliProjectRoot } from '../helpers/run-cli.js';
import { AI_TOOLS } from '../../src/core/config.js';
import { COMMAND_REGISTRY } from '../../src/core/completions/command-registry.js';
import { localizeCommandRegistry } from '../../src/core/completions/description-localization.js';
import { formatLocaleMessage, getLocaleCatalog } from '../../src/locales/index.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const tempRoots: string[] = [];

async function prepareFixture(fixtureName: string): Promise<string> {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'rasen-cli-e2e-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  const fixtureDir = path.join(cliProjectRoot, 'test', 'fixtures', fixtureName);
  await fs.cp(fixtureDir, projectDir, { recursive: true });
  return projectDir;
}

async function prepareIsolatedHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'rasen-cli-e2e-home-'));
  tempRoots.push(home);
  return home;
}

function normalizeOutput(output: string): string {
  return output.replace(/\s+/gu, ' ').trim();
}

function expectJsonOnlyOutput(result: Awaited<ReturnType<typeof runCLI>>) {
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(() => JSON.parse(result.stdout)).not.toThrow();
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('openspec CLI e2e basics', () => {
  it('shows help output', async () => {
    const result = await runCLI(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: rasen');
    expect(result.stderr).toBe('');

  });

  it('shows Japanese help when requested through the language override', async () => {
    const result = await runCLI(['profile', '--help'], { env: { RASEN_LANG: 'ja' } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('使用法: rasen profile');
    expect(result.stdout).toContain('再利用可能なワークフロープロファイルを管理します');
    expect(result.stdout).toContain('オプション:');
    expect(result.stdout).toContain('コマンド:');
    expect(result.stderr).toBe('');
  });

  it('shows Simplified Chinese root help and its root option description', async () => {
    const home = await prepareIsolatedHome();
    const result = await runCLI(['--help'], {
      env: { RASEN_HOME: home, RASEN_LANG: 'zh-cn' },
    });
    const output = normalizeOutput(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output).toContain('用法： rasen [options] [command]');
    expect(output).toContain('选项：');
    expect(output).toContain('命令：');
    expect(output).toContain('--no-color 禁用彩色输出');
    expect(output).not.toContain('Usage:');
    expect(output).not.toContain('Options:');
    expect(output).not.toContain('Commands:');
    expect(output).not.toContain('Disable color output');
    expect(result.stderr).toBe('');
  });

  it('shows Simplified Chinese profile help', async () => {
    const home = await prepareIsolatedHome();
    const result = await runCLI(['profile', '--help'], {
      env: { RASEN_HOME: home, RASEN_LANG: 'zh-cn' },
    });
    const output = normalizeOutput(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output).toContain('用法： rasen profile [options] [command]');
    expect(output).toContain('管理可复用的工作流配置方案');
    expect(output).toContain('选项：');
    expect(output).toContain('命令：');
    expect(output).not.toContain('Manage reusable workflow profiles');
    expect(result.stderr).toBe('');
  });

  it('shows Simplified Chinese pipeline help for every registered subcommand and flag', async () => {
    const home = await prepareIsolatedHome();
    const sourcePipeline = COMMAND_REGISTRY.find((command) => command.name === 'pipeline');
    const localizedPipeline = localizeCommandRegistry(COMMAND_REGISTRY, 'zh-cn')
      .find((command) => command.name === 'pipeline');
    const expectedSubcommands = [
      'list',
      'show',
      'agents',
      'classify',
      'resume',
      'init',
      'validate',
      'import',
      'export',
      'delete',
    ];

    expect(sourcePipeline).toBeDefined();
    expect(localizedPipeline).toBeDefined();
    expect(localizedPipeline?.subcommands?.map((command) => command.name)).toEqual(
      expectedSubcommands
    );

    const pipelineHelp = await runCLI(['pipeline', '--help'], {
      env: { RASEN_HOME: home, RASEN_LANG: 'zh-cn' },
    });
    const pipelineOutput = normalizeOutput(pipelineHelp.stdout);

    expect(pipelineHelp.exitCode).toBe(0);
    expect(pipelineOutput).toContain('用法： rasen pipeline [options] [command]');
    expect(pipelineOutput).toContain(localizedPipeline?.description);
    expect(pipelineOutput).toContain('选项：');
    expect(pipelineOutput).toContain('命令：');
    expect(pipelineHelp.stderr).toBe('');

    for (const subcommand of localizedPipeline?.subcommands ?? []) {
      expect(pipelineOutput).toContain(`${subcommand.name} [options]`);
      expect(pipelineOutput).toContain(normalizeOutput(subcommand.description));
    }

    const helpResults = await Promise.all(
      (localizedPipeline?.subcommands ?? []).map(async (subcommand) => ({
        subcommand,
        result: await runCLI(['pipeline', subcommand.name, '--help'], {
          env: { RASEN_HOME: home, RASEN_LANG: 'zh-cn' },
        }),
      }))
    );

    for (const { subcommand, result } of helpResults) {
      const output = normalizeOutput(result.stdout);
      const sourceSubcommand = sourcePipeline?.subcommands?.find(
        (command) => command.name === subcommand.name
      );

      expect(result.exitCode, subcommand.name).toBe(0);
      expect(output, subcommand.name).toContain(`用法： rasen pipeline ${subcommand.name}`);
      expect(output, subcommand.name).toContain(normalizeOutput(subcommand.description));
      expect(output, subcommand.name).toContain('选项：');
      expect(output, subcommand.name).not.toContain(sourceSubcommand?.description);
      expect(result.stderr, subcommand.name).toBe('');

      for (const flag of subcommand.flags) {
        expect(output, `${subcommand.name} --${flag.name}`).toContain(`--${flag.name}`);
        expect(output, `${subcommand.name} --${flag.name}`).toContain(
          normalizeOutput(flag.description)
        );
        const sourceFlag = sourceSubcommand?.flags.find((entry) => entry.name === flag.name);
        expect(output, `${subcommand.name} --${flag.name}`).not.toContain(
          sourceFlag?.description
        );
      }
    }
  }, 20_000);

  it('uses persisted zh-cn in the next CLI process', async () => {
    const home = await prepareIsolatedHome();
    const setResult = await runCLI(['config', 'set', 'language', 'zh-cn'], {
      env: { RASEN_HOME: home },
    });

    expect(setResult.exitCode).toBe(0);
    expect(setResult.stderr).toBe('');

    const saved = JSON.parse(await fs.readFile(path.join(home, 'config.json'), 'utf-8')) as {
      language?: string;
    };
    expect(saved.language).toBe('zh-cn');

    const helpResult = await runCLI(['profile', '--help'], {
      env: { RASEN_HOME: home, RASEN_LANG: '' },
    });
    const output = normalizeOutput(helpResult.stdout);

    expect(helpResult.exitCode).toBe(0);
    expect(output).toContain('用法： rasen profile [options] [command]');
    expect(output).toContain('管理可复用的工作流配置方案');
    expect(output).not.toContain('Manage reusable workflow profiles');
    expect(helpResult.stderr).toBe('');
  });

  it('keeps dynamic tool ids exact in Simplified Chinese init help', async () => {
    const home = await prepareIsolatedHome();
    const result = await runCLI(['init', '--help'], {
      env: { RASEN_HOME: home, RASEN_LANG: 'zh-cn' },
    });
    const expectedTools = AI_TOOLS.filter((tool) => tool.available && tool.adapted)
      .map((tool) => tool.value)
      .join(', ');
    const expectedDescription = formatLocaleMessage(
      getLocaleCatalog('zh-cn').commandDescriptionTemplates.toolsPrefix,
      { ids: expectedTools }
    );
    const output = normalizeOutput(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output).toContain(expectedDescription);
    expect(output).not.toContain('Configure AI tools non-interactively');
    expect(result.stderr).toBe('');
  });

  it('localizes pipeline human output while preserving machine and user values', async () => {
    const home = await prepareIsolatedHome();
    const options = {
      env: { RASEN_HOME: home, RASEN_LANG: 'zh-cn' },
    };
    const [listResult, showResult, classifyResult, missingResult] = await Promise.all([
      runCLI(['pipeline', 'list'], options),
      runCLI(['pipeline', 'show', 'bug-fix'], options),
      runCLI(['pipeline', 'classify', 'fix the broken login'], options),
      runCLI(['pipeline', 'show', 'e2e-missing-pipeline'], options),
    ]);

    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain('可用流水线：');
    expect(listResult.stdout).toContain('bug-fix  [package]');
    expect(listResult.stdout).toContain('最简缺陷修复流水线');
    expect(listResult.stdout).toContain('阶段：propose -> apply -> verify -> ship -> archive');
    expect(listResult.stdout).not.toContain('Available pipelines:');
    expect(listResult.stdout).not.toContain('Stages:');
    expect(listResult.stderr).toBe('');

    expect(showResult.exitCode).toBe(0);
    expect(showResult.stdout).toContain('流水线：bug-fix');
    expect(showResult.stdout).toContain('最简缺陷修复流水线');
    expect(showResult.stdout).toContain('构建顺序：');
    expect(showResult.stdout).toContain('propose -> rasen-propose');
    expect(showResult.stdout).toContain('角色=planner');
    expect(showResult.stdout).toContain('运行时=claude');
    expect(showResult.stdout).not.toContain('Pipeline:');
    expect(showResult.stdout).not.toContain('Build order:');
    expect(showResult.stderr).toBe('');

    expect(classifyResult.exitCode).toBe(0);
    expect(classifyResult.stdout).toContain('建议流水线：bug-fix');
    expect(classifyResult.stdout).toContain('匹配的指标：fix, broken');
    expect(classifyResult.stdout).toContain('判断依据：keyword');
    expect(classifyResult.stdout).not.toContain('Suggested pipeline:');
    expect(classifyResult.stdout).not.toContain('Matched indicators:');
    expect(classifyResult.stdout).not.toContain('Classification basis:');
    expect(classifyResult.stderr).toBe('');

    expect(missingResult.exitCode).toBe(1);
    expect(missingResult.stderr).toContain("未找到流水线 'e2e-missing-pipeline'");
    expect(missingResult.stderr).toContain('可用流水线：');
    expect(missingResult.stderr).not.toContain('Error:');
    expect(missingResult.stderr).not.toContain('Pipeline ');
    expect(missingResult.stderr).not.toContain('Available pipelines:');
  });

  it('uses the language persisted in the machine-global JSON config', async () => {
    const home = await fs.mkdtemp(path.join(tmpdir(), 'rasen-language-e2e-'));
    tempRoots.push(home);

    const setResult = await runCLI(['config', 'set', 'language', 'ja'], {
      env: { RASEN_HOME: home },
    });
    expect(setResult.exitCode).toBe(0);

    const saved = JSON.parse(await fs.readFile(path.join(home, 'config.json'), 'utf-8')) as {
      language?: string;
    };
    expect(saved.language).toBe('ja');

    const helpResult = await runCLI(['profile', '--help'], {
      env: { RASEN_HOME: home, RASEN_LANG: '' },
    });
    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain('使用法: rasen profile');

    const setConfigResult = await runCLI(['config', 'set', 'proactive', 'false'], {
      env: { RASEN_HOME: home, RASEN_LANG: '' },
    });
    expect(setConfigResult.exitCode).toBe(0);
    expect(setConfigResult.stdout).toContain('proactive = false に設定しました');

    const listConfigResult = await runCLI(['config', 'list'], {
      env: { RASEN_HOME: home, RASEN_LANG: '' },
    });
    expect(listConfigResult.exitCode).toBe(0);
    expect(listConfigResult.stdout).toContain('プロファイル設定:');

    const unsetConfigResult = await runCLI(['config', 'unset', 'proactive'], {
      env: { RASEN_HOME: home, RASEN_LANG: '' },
    });
    expect(unsetConfigResult.exitCode).toBe(0);
    expect(unsetConfigResult.stdout).toContain('proactiveの設定を解除しました');
  });

  it('localizes every visible root option in Japanese help', async () => {
    const result = await runCLI(['--help'], { env: { RASEN_LANG: 'ja' } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--no-color');
    expect(result.stdout).toContain('カラー出力を無効にします');
    expect(result.stdout).not.toContain('Disable color output');
  });

  it('shows dynamic tool ids in init help', async () => {
    const result = await runCLI(['init', '--help']);
    expect(result.exitCode).toBe(0);

    const expectedTools = AI_TOOLS.filter((tool) => tool.available && tool.adapted)
      .map((tool) => tool.value)
      .join(', ');
    const normalizedOutput = result.stdout.replace(/\s+/g, ' ').trim();
    expect(normalizedOutput).toContain(
      `Use "all", "none", or a comma-separated list of: ${expectedTools}`
    );
  });

  it('reports the package version', async () => {
    const pkgRaw = await fs.readFile(path.join(cliProjectRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    const result = await runCLI(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('validates the tmp-init fixture with --all --json', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['validate', '--all', '--json'], { cwd: projectDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).not.toBe('');
    const json = JSON.parse(output);
    expect(json.summary?.totals?.failed).toBe(0);
    expect(json.items.some((item: any) => item.id === 'c1' && item.type === 'change')).toBe(true);
  });

  it('keeps list --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['list', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('keeps schemas --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['schemas', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('keeps status --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['status', '--change', 'c1', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('keeps instructions --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['instructions', 'proposal', '--change', 'c1', '--json'], {
      cwd: projectDir,
    });
    expectJsonOnlyOutput(result);
  });

  it('keeps instructions apply --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['instructions', 'apply', '--change', 'c1', '--json'], {
      cwd: projectDir,
    });
    expectJsonOnlyOutput(result);
  });

  it('keeps templates --json free of spinner output', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['templates', '--json'], { cwd: projectDir });
    expectJsonOnlyOutput(result);
  });

  it('returns an error for unknown items in the fixture', async () => {
    const projectDir = await prepareFixture('tmp-init');
    const result = await runCLI(['validate', 'does-not-exist'], { cwd: projectDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown item 'does-not-exist'");
  });

  describe('init command non-interactive options', () => {
    it('initializes with --tools all option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const codexHome = path.join(emptyProjectDir, '.codex');
      const hermesHome = path.join(emptyProjectDir, '.hermes-home');
      const result = await runCLI(['init', '--tools', 'all'], {
        cwd: emptyProjectDir,
        env: { CODEX_HOME: codexHome, HERMES_HOME: hermesHome },
        timeoutMs: 20000,
      });
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Rasen Setup Complete');

      // --tools all now means "all adapted tools" — claude, codex, and hermes.
      const claudeSkillPath = path.join(emptyProjectDir, '.claude/skills/rasen-explore/SKILL.md');
      const codexSkillPath = path.join(emptyProjectDir, '.codex/skills/rasen-explore/SKILL.md');
      const hermesSkillPath = path.join(hermesHome, 'skills/rasen-explore/SKILL.md');
      const cursorSkillPath = path.join(emptyProjectDir, '.cursor/skills/rasen-explore/SKILL.md');
      expect(await fileExists(claudeSkillPath)).toBe(true);
      expect(await fileExists(codexSkillPath)).toBe(true);
      expect(await fileExists(hermesSkillPath)).toBe(true);
      expect(await fileExists(cursorSkillPath)).toBe(false);
    }, 25000);

    it('initializes with --tools list option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'claude'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Rasen Setup Complete');
      expect(result.stdout).toContain('Claude Code');

      // New init creates skills, not CLAUDE.md
      const claudeSkillPath = path.join(emptyProjectDir, '.claude/skills/rasen-explore/SKILL.md');
      const cursorSkillPath = path.join(emptyProjectDir, '.cursor/skills/rasen-explore/SKILL.md');
      expect(await fileExists(claudeSkillPath)).toBe(true);
      expect(await fileExists(cursorSkillPath)).toBe(false); // Not selected
    });

    it('initializes with --tools none option', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'none'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Rasen Setup Complete');

      // With --tools none, no tool skills should be created
      const claudeSkillPath = path.join(emptyProjectDir, '.claude/skills/rasen-explore/SKILL.md');
      const cursorSkillPath = path.join(emptyProjectDir, '.cursor/skills/rasen-explore/SKILL.md');

      expect(await fileExists(claudeSkillPath)).toBe(false);
      expect(await fileExists(cursorSkillPath)).toBe(false);
    });

    it('returns error for invalid tool names', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'invalid-tool'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid tool(s): invalid-tool');
      expect(result.stderr).toContain('Available values:');
    });

    it('returns error when combining reserved keywords with explicit ids', async () => {
      const projectDir = await prepareFixture('tmp-init');
      const emptyProjectDir = path.join(projectDir, '..', 'empty-project');
      await fs.mkdir(emptyProjectDir, { recursive: true });

      const result = await runCLI(['init', '--tools', 'all,claude'], { cwd: emptyProjectDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Cannot combine reserved values "all" or "none" with specific tool IDs');
    });
  });
});
