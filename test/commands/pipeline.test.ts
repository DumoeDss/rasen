import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  createPipelinePackage,
  encodePackage,
  type PipelinePackageInput,
} from '../../src/core/workflow-package/index.js';
import { runCLI } from '../helpers/run-cli.js';

const BUILTIN_NAMES = [
  'auto-decompose',
  'bug-fix',
  'full-feature',
  'goal-loop-evaluate',
  'goal-loop-measure',
  'goal-loop-research',
  'small-feature',
] as const;
const PIPELINE_LOCALES = ['en', 'ja', 'zh-cn'] as const;

function packagedPipeline(
  name: string,
  stages: string[] = [
    '  - id: implement',
    '    skill: rasen-apply-change',
    '    role: implementer',
    '    requires: []',
  ]
): PipelinePackageInput {
  return {
    name,
    files: [
      {
        path: 'pipeline.yaml',
        content: [`name: ${name}`, 'stages:', ...stages, ''].join('\n'),
      },
    ],
  };
}

async function writePipelinePackage(
  destination: string,
  inputs: PipelinePackageInput[]
): Promise<void> {
  const packageValue = createPipelinePackage(
    inputs.map((input) => input.name),
    inputs
  );
  await fs.writeFile(destination, encodePackage(packageValue));
}

const HUMAN_LOCALE_CASES = [
  {
    locale: 'en',
    listHeading: 'Available pipelines:',
    builtInDescription: 'Minimal bug-fix pipeline',
    pipelineLabel: 'Pipeline: bug-fix',
    roleRuntimes: 'Role runtimes:',
    suggested: 'Suggested pipeline: bug-fix',
    noRunState: 'No run-state (auto-run.json) found',
    createdDraft: 'Created pipeline draft at',
    valid: 'Pipeline is valid.',
    invalid: 'Pipeline is invalid.',
    imported: 'Imported pipeline(s) from',
    exported: 'Exported pipeline',
    confirmation: 'Deletion requires --yes in non-interactive mode',
    deleted: 'Deleted pipeline',
    referrerWarning: 'was still referenced by:',
    collision: 'Pipeline "bug-fix" already exists',
    destinationExists: 'Export destination already exists; use --force',
    notFound: "Pipeline 'missing-pipeline' not found",
  },
  {
    locale: 'ja',
    listHeading: '利用可能なパイプライン:',
    builtInDescription: '最小限のバグ修正パイプライン',
    pipelineLabel: 'パイプライン: bug-fix',
    roleRuntimes: '役割別runtime:',
    suggested: '推奨パイプライン: bug-fix',
    noRunState: '実行状態（auto-run.json）が見つかりません',
    createdDraft: 'パイプラインドラフトを',
    valid: 'パイプラインは有効です。',
    invalid: 'パイプラインは無効です。',
    imported: 'からパイプラインをimportしました',
    exported: 'を',
    confirmation: '非対話モードで削除するには--yesが必要です',
    deleted: 'を削除しました。',
    referrerWarning: 'まだ参照されていました:',
    collision: 'パイプライン"bug-fix"は既に存在します',
    destinationExists: 'export先が既に存在します',
    notFound: "パイプライン'missing-pipeline'が見つかりません",
  },
  {
    locale: 'zh-cn',
    listHeading: '可用流水线：',
    builtInDescription: '最简缺陷修复流水线',
    pipelineLabel: '流水线：bug-fix',
    roleRuntimes: '各角色运行时：',
    suggested: '建议流水线：bug-fix',
    noRunState: '未找到运行状态（auto-run.json）',
    createdDraft: '创建流水线草稿',
    valid: '流水线有效。',
    invalid: '流水线无效。',
    imported: '导入流水线',
    exported: '导出到',
    confirmation: '非交互模式下删除需要 --yes',
    deleted: '已删除流水线',
    referrerWarning: '仍被以下引用方引用',
    collision: '流水线 "bug-fix" 已存在',
    destinationExists: '导出目标已存在',
    notFound: "未找到流水线 'missing-pipeline'",
  },
] as const;

describe('pipeline command', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-pipeline-command-tmp');
  const changesDir = path.join(testDir, 'rasen', 'changes');

  beforeEach(async () => {
    await fs.mkdir(changesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  async function createIsolatedProposeOnlyHome(name: string): Promise<string> {
    const home = path.join(testDir, name);
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({ profile: 'custom', delivery: 'both', workflows: ['propose'] })
    );
    return home;
  }

  describe('localized human presentation', () => {
    it.each(HUMAN_LOCALE_CASES)(
      'localizes representative $locale paths across all ten subcommands',
      async (expected) => {
        const home = path.join(testDir, `.pipeline-locale-home-${expected.locale}`);
        const env = { RASEN_HOME: home, RASEN_LANG: expected.locale };
        const changeName = `locale-change-${expected.locale}`;
        await fs.mkdir(path.join(changesDir, changeName), { recursive: true });

        const list = await runCLI(['pipeline', 'list'], { cwd: testDir, env });
        expect(list.exitCode).toBe(0);
        expect(list.stdout).toContain(expected.listHeading);
        expect(list.stdout).toContain(expected.builtInDescription);

        const show = await runCLI(['pipeline', 'show', 'bug-fix'], { cwd: testDir, env });
        expect(show.exitCode).toBe(0);
        expect(show.stdout).toContain(expected.pipelineLabel);
        expect(show.stdout).toContain(expected.builtInDescription);

        const missing = await runCLI(
          ['pipeline', 'show', 'missing-pipeline'],
          { cwd: testDir, env }
        );
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toContain(expected.notFound);

        const agents = await runCLI(
          ['pipeline', 'agents', 'bug-fix'],
          { cwd: testDir, env }
        );
        expect(agents.exitCode).toBe(0);
        expect(agents.stdout).toContain(expected.roleRuntimes);

        const classify = await runCLI(
          ['pipeline', 'classify', 'fix the broken login'],
          { cwd: testDir, env }
        );
        expect(classify.exitCode).toBe(0);
        expect(classify.stdout).toContain(expected.suggested);
        expect(classify.stdout).toContain('keyword');

        const resume = await runCLI(
          ['pipeline', 'resume', changeName],
          { cwd: testDir, env }
        );
        expect(resume.exitCode).toBe(0);
        expect(resume.stdout).toContain(expected.noRunState);

        const draftName = `draft-${expected.locale}`;
        const draftPath = path.join(testDir, draftName);
        const init = await runCLI(
          ['pipeline', 'init', draftName, '--output', draftPath],
          { cwd: testDir, env }
        );
        expect(init.exitCode).toBe(0);
        expect(init.stdout).toContain(expected.createdDraft);
        expect(init.stdout).toContain(draftPath);

        const collision = await runCLI(
          ['pipeline', 'init', 'bug-fix', '--output', path.join(testDir, 'bug-fix')],
          { cwd: testDir, env }
        );
        expect(collision.exitCode).toBe(1);
        expect(collision.stderr).toContain(expected.collision);

        const validation = await runCLI(
          ['pipeline', 'validate', 'bug-fix'],
          { cwd: testDir, env }
        );
        expect(validation.exitCode).toBe(0);
        expect(validation.stdout).toContain(expected.valid);

        const invalidDraft = path.join(testDir, `invalid-${expected.locale}`);
        await fs.mkdir(invalidDraft, { recursive: true });
        const invalidValidation = await runCLI(
          ['pipeline', 'validate', invalidDraft],
          { cwd: testDir, env }
        );
        expect(invalidValidation.exitCode).toBe(1);
        expect(invalidValidation.stdout).toContain(expected.invalid);
        expect(invalidValidation.stdout).toContain('pipeline_manifest_missing');

        const pipelineName = `localized-${expected.locale}`;
        const childName = `localized-child-${expected.locale}`;
        const parentName = `localized-parent-${expected.locale}`;
        const packagePath = path.join(testDir, `localized-${expected.locale}.rasenpkg`);
        await writePipelinePackage(packagePath, [
          packagedPipeline(pipelineName),
          packagedPipeline(childName),
          packagedPipeline(parentName, [
            '  - id: fanout',
            '    kind: decompose',
            `    childPipeline: ${childName}`,
            '    requires: []',
          ]),
        ]);

        const imported = await runCLI(
          ['pipeline', 'import', packagePath],
          { cwd: testDir, env }
        );
        expect(imported.exitCode).toBe(0);
        expect(imported.stdout).toContain(expected.imported);
        expect(imported.stdout).toContain(pipelineName);

        const exportPath = path.join(testDir, `export-${expected.locale}.rasenpkg`);
        const exported = await runCLI(
          ['pipeline', 'export', pipelineName, exportPath],
          { cwd: testDir, env }
        );
        expect(exported.exitCode).toBe(0);
        expect(exported.stdout).toContain(expected.exported);
        expect(exported.stdout).toContain(exportPath);

        const destinationExists = await runCLI(
          ['pipeline', 'export', pipelineName, exportPath],
          { cwd: testDir, env }
        );
        expect(destinationExists.exitCode).toBe(1);
        expect(destinationExists.stderr).toContain(expected.destinationExists);

        const confirmation = await runCLI(
          ['pipeline', 'delete', pipelineName],
          { cwd: testDir, env }
        );
        expect(confirmation.exitCode).toBe(1);
        expect(confirmation.stderr).toContain(expected.confirmation);

        const deleted = await runCLI(
          ['pipeline', 'delete', pipelineName, '--yes'],
          { cwd: testDir, env }
        );
        expect(deleted.exitCode).toBe(0);
        expect(deleted.stdout).toContain(expected.deleted);

        const forcedDelete = await runCLI(
          ['pipeline', 'delete', childName, '--yes', '--force'],
          { cwd: testDir, env }
        );
        expect(forcedDelete.exitCode).toBe(0);
        expect(forcedDelete.stderr).toContain(expected.referrerWarning);
        expect(forcedDelete.stderr).toContain(`decompose:${parentName}`);
      },
      60_000
    );
  });

  describe('locale-neutral JSON contracts', () => {
    it('keeps all ten subcommand payloads identical across locales', async () => {
      async function collect(locale: (typeof PIPELINE_LOCALES)[number]) {
        const root = path.join(testDir, `json-${locale}`);
        const home = path.join(root, 'home');
        const env = { RASEN_HOME: home, RASEN_LANG: locale };
        const changeName = 'json-change';
        await fs.mkdir(path.join(root, 'rasen', 'changes', changeName), {
          recursive: true,
        });

        const packagePath = path.join(root, 'json-pipe.rasenpkg');
        await writePipelinePackage(packagePath, [packagedPipeline('json-pipe')]);

        const runJson = async (args: string[]) => {
          const result = await runCLI(args, { cwd: root, env });
          expect(result.exitCode, `${locale}: ${args.join(' ')}`).toBe(0);
          expect(result.stderr, `${locale}: ${args.join(' ')}`).toBe('');
          return JSON.parse(result.stdout.trim());
        };

        const payloads = {
          list: await runJson(['pipeline', 'list', '--json']),
          show: await runJson(['pipeline', 'show', 'bug-fix', '--json']),
          agents: await runJson(['pipeline', 'agents', 'bug-fix', '--json']),
          classify: await runJson([
            'pipeline',
            'classify',
            'fix the broken login',
            '--json',
          ]),
          resume: await runJson([
            'pipeline',
            'resume',
            changeName,
            '--json',
          ]),
          init: await runJson([
            'pipeline',
            'init',
            'json-draft',
            '--output',
            path.join(root, 'json-draft'),
            '--json',
          ]),
          validate: await runJson([
            'pipeline',
            'validate',
            'bug-fix',
            '--json',
          ]),
          import: await runJson([
            'pipeline',
            'import',
            packagePath,
            '--json',
          ]),
          export: await runJson([
            'pipeline',
            'export',
            'json-pipe',
            path.join(root, 'json-pipe-export.rasenpkg'),
            '--json',
          ]),
          delete: await runJson([
            'pipeline',
            'delete',
            'json-pipe',
            '--yes',
            '--json',
          ]),
        };

        const normalizePaths = (value: unknown): unknown => {
          if (typeof value === 'string') {
            return value.split(root).join('<ROOT>');
          }
          if (Array.isArray(value)) return value.map(normalizePaths);
          if (value && typeof value === 'object') {
            return Object.fromEntries(
              Object.entries(value).map(([key, nested]) => [key, normalizePaths(nested)])
            );
          }
          return value;
        };

        return normalizePaths(payloads);
      }

      const [english, japanese, chinese] = await Promise.all(
        PIPELINE_LOCALES.map((locale) => collect(locale))
      );
      expect(japanese).toEqual(english);
      expect(chinese).toEqual(english);

      const payloads = english as Record<string, any>;
      const bugFixList = payloads.list.pipelines.find(
        (pipeline: any) => pipeline.name === 'bug-fix'
      );
      expect(bugFixList).toMatchObject({
        source: 'package',
        description: expect.stringContaining('Minimal bug-fix pipeline'),
      });
      expect(payloads.show.description).toContain('Minimal bug-fix pipeline');
      expect(Object.prototype.hasOwnProperty.call(payloads.show, 'source')).toBe(false);
      expect(payloads.classify).toMatchObject({
        suggested: 'bug-fix',
        basis: 'keyword',
      });
      expect(payloads.classify.matched).toEqual(['fix', 'broken']);
      expect(payloads.resume.note).toContain('No run-state');
      expect(payloads.import.digests['json-pipe']).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(payloads.export.pipeline.name).toBe('json-pipe');
      expect(payloads.delete).toEqual({
        deleted: 'json-pipe',
        forcedReferrers: [],
        status: [],
      });
    }, 60_000);

    it('keeps forced-referrer delete JSON byte-stable and stderr-silent across locales', async () => {
      async function collect(locale: (typeof PIPELINE_LOCALES)[number]) {
        const root = path.join(testDir, `forced-delete-json-${locale}`);
        const home = path.join(root, 'home');
        const env = { RASEN_HOME: home, RASEN_LANG: locale };
        await fs.mkdir(root, { recursive: true });
        const packagePath = path.join(root, 'forced-delete.rasenpkg');
        await writePipelinePackage(packagePath, [
          packagedPipeline('json-child'),
          packagedPipeline('json-parent', [
            '  - id: fanout',
            '    kind: decompose',
            '    childPipeline: json-child',
            '    requires: []',
          ]),
        ]);

        const imported = await runCLI(
          ['pipeline', 'import', packagePath, '--json'],
          { cwd: root, env }
        );
        expect(imported.exitCode).toBe(0);
        expect(imported.stderr).toBe('');

        return runCLI(
          [
            'pipeline',
            'delete',
            'json-child',
            '--yes',
            '--force',
            '--json',
          ],
          { cwd: root, env }
        );
      }

      const results = await Promise.all(PIPELINE_LOCALES.map(collect));
      const expected = `${JSON.stringify({
        deleted: 'json-child',
        forcedReferrers: ['decompose:json-parent'],
        status: [],
      }, null, 2)}\n`;

      for (const result of results) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(expected);
        expect(result.stderr).toBe('');
      }
    }, 60_000);
  });

  describe('pipeline description content ownership', () => {
    it.each([
      { locale: 'ja', source: 'project' },
      { locale: 'zh-cn', source: 'project' },
      { locale: 'ja', source: 'user' },
      { locale: 'zh-cn', source: 'user' },
    ] as const)(
      'preserves a same-name $source override under $locale',
      async ({ locale, source }) => {
        const home = path.join(testDir, `.ownership-home-${locale}-${source}`);
        const baseDir = source === 'project'
          ? path.join(testDir, 'rasen', 'pipelines')
          : path.join(home, 'pipelines');
        const pipelineDir = path.join(baseDir, 'bug-fix');
        const authoredDescription = `Author-owned ${source} description / 用户原文`;
        await fs.mkdir(pipelineDir, { recursive: true });
        await fs.writeFile(
          path.join(pipelineDir, 'pipeline.yaml'),
          [
            'name: bug-fix',
            `description: ${authoredDescription}`,
            'stages:',
            '  - id: implement',
            '    skill: rasen-apply-change',
            '    role: implementer',
            '    requires: []',
            '',
          ].join('\n'),
          'utf-8'
        );
        const env = { RASEN_HOME: home, RASEN_LANG: locale };
        const localizedBuiltIn = HUMAN_LOCALE_CASES.find(
          (entry) => entry.locale === locale
        )!.builtInDescription;

        const list = await runCLI(['pipeline', 'list'], { cwd: testDir, env });
        expect(list.exitCode).toBe(0);
        expect(list.stdout).toContain(authoredDescription);
        expect(list.stdout).not.toContain(localizedBuiltIn);

        const show = await runCLI(['pipeline', 'show', 'bug-fix'], {
          cwd: testDir,
          env,
        });
        expect(show.exitCode).toBe(0);
        expect(show.stdout).toContain(authoredDescription);
        expect(show.stdout).not.toContain(localizedBuiltIn);

        const listJson = await runCLI(
          ['pipeline', 'list', '--json'],
          { cwd: testDir, env }
        );
        const listed = JSON.parse(listJson.stdout).pipelines.find(
          (pipeline: any) => pipeline.name === 'bug-fix'
        );
        expect(listed).toMatchObject({
          name: 'bug-fix',
          description: authoredDescription,
          source,
        });

        const showJson = await runCLI(
          ['pipeline', 'show', 'bug-fix', '--json'],
          { cwd: testDir, env }
        );
        const shown = JSON.parse(showJson.stdout);
        expect(shown.description).toBe(authoredDescription);
        expect(Object.prototype.hasOwnProperty.call(shown, 'source')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(shown, 'localizedDescription')).toBe(false);
      },
      30_000
    );
  });

  describe('list', () => {
    it('returns the built-in pipelines with source via --json', async () => {
      const result = await runCLI(['pipeline', 'list', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Array.isArray(json.pipelines)).toBe(true);

      const names = json.pipelines.map((p: any) => p.name);
      for (const name of BUILTIN_NAMES) {
        expect(names).toContain(name);
      }

      const bugFix = json.pipelines.find((p: any) => p.name === 'bug-fix');
      expect(bugFix).toBeDefined();
      expect(bugFix.source).toBe('package');
      expect(Array.isArray(bugFix.stages)).toBe(true);
      expect(bugFix.stages).toContain('propose');
      expect(typeof bugFix.description).toBe('string');
    });

    it('prints a human-readable table without --json', async () => {
      const result = await runCLI(['pipeline', 'list'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('bug-fix');
      expect(result.stdout).toContain('[package]');
    });
  });

  describe('show', () => {
    it('keeps the display JSON contract unchanged after a successful execution preflight', async () => {
      const displayOnly = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
        cwd: testDir,
      });
      const executable = await runCLI(
        ['pipeline', 'show', 'bug-fix', '--for-execution', '--json'],
        { cwd: testDir }
      );

      expect(displayOnly.exitCode).toBe(0);
      expect(executable.exitCode).toBe(0);
      expect(JSON.parse(executable.stdout.trim())).toEqual(
        JSON.parse(displayOnly.stdout.trim())
      );
    });

    it.each([
      {
        locale: 'ja',
        warning: '警告: 保存済みプロファイルから不明なワークフローIDを除外します: ff',
      },
      {
        locale: 'zh-cn',
        warning: '警告：已从存储的配置方案中忽略未知工作流 ID：ff',
      },
    ] as const)(
      'localizes stale-profile preflight warnings for show and resume in $locale',
      async ({ locale, warning }) => {
        const name = `stale-profile-${locale}`;
        const pipelineDir = path.join(testDir, 'rasen', 'pipelines', name);
        const changeName = `stale-profile-change-${locale}`;
        const home = path.join(testDir, `.stale-profile-home-${locale}`);
        await fs.mkdir(pipelineDir, { recursive: true });
        await fs.mkdir(path.join(changesDir, changeName), { recursive: true });
        await fs.mkdir(home, { recursive: true });
        await fs.writeFile(
          path.join(pipelineDir, 'pipeline.yaml'),
          [
            `name: ${name}`,
            'stages:',
            '  - id: propose',
            '    skill: rasen-propose',
            '    role: planner',
            '',
          ].join('\n'),
          'utf-8'
        );
        await fs.writeFile(
          path.join(changesDir, changeName, 'auto-run.json'),
          JSON.stringify({ pipeline: name, completed: [] }),
          'utf-8'
        );
        await fs.writeFile(
          path.join(home, 'config.json'),
          JSON.stringify({
            profile: 'custom',
            delivery: 'both',
            workflows: ['propose', 'ff'],
          }),
          'utf-8'
        );
        const env = { RASEN_HOME: home, RASEN_LANG: locale };

        const show = await runCLI(
          ['pipeline', 'show', name, '--for-execution'],
          { cwd: testDir, env }
        );
        expect(show.exitCode).toBe(0);
        expect(show.stderr).toContain(warning);
        expect(show.stderr).not.toContain('dropping unknown workflow');

        const resume = await runCLI(
          ['pipeline', 'resume', changeName],
          { cwd: testDir, env }
        );
        expect(resume.exitCode).toBe(0);
        expect(resume.stderr).toContain(warning);
        expect(resume.stderr).not.toContain('dropping unknown workflow');

        for (const args of [
          ['pipeline', 'show', name, '--for-execution', '--json'],
          ['pipeline', 'resume', changeName, '--json'],
        ]) {
          const json = await runCLI(args, { cwd: testDir, env });
          expect(json.exitCode).toBe(0);
          expect(json.stderr).toBe('');
          expect(() => JSON.parse(json.stdout)).not.toThrow();
        }
      },
      30_000
    );

    it('blocks a fresh executable DAG when the active profile disables a known skill', async () => {
      const home = await createIsolatedProposeOnlyHome('.fresh-execution-home');

      const displayOnly = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
        cwd: testDir,
        env: { RASEN_HOME: home },
      });
      expect(displayOnly.exitCode).toBe(0);

      const executable = await runCLI(
        ['pipeline', 'show', 'bug-fix', '--for-execution', '--json'],
        { cwd: testDir, env: { RASEN_HOME: home } }
      );
      expect(executable.exitCode).toBe(1);
      expect(executable.stderr).toMatch(/known but disabled skill/);
      expect(executable.stderr).not.toMatch(/unknown skill/);
      expect(executable.stdout).not.toMatch(/"buildOrder"/);
    });

    it('returns the DAG, buildOrder, and full stage fields via --json', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.name).toBe('bug-fix');
      expect(typeof json.description).toBe('string');
      expect(Array.isArray(json.buildOrder)).toBe(true);
      expect(json.buildOrder[0]).toBe('propose');

      // Every stage carries the full field set (defaults made explicit).
      const stage = json.stages[0];
      for (const field of [
        'id',
        'skill',
        'role',
        'requires',
        'gate',
        'loop',
        'parallelGroup',
        'condition',
        'leadReview',
        'verifyPolicy',
        'runtime',
        'runtimeSource',
        'sessionReuse',
        'sandbox',
        'model',
        'effort',
        'handoff',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(stage, field)).toBe(true);
      }
      // handoff is the fully-resolved config (built-in defaults when unset).
      expect(stage.handoff).toMatchObject({
        threshold: 0.5,
        maxRelays: 3,
        stallLimit: 2,
        source: 'default',
      });
      expect(stage.id).toBe('propose');
      expect(stage.skill).toBe('rasen-propose');
      expect(stage.gate).toBe(true);
      // build order length equals stage count
      expect(json.buildOrder.length).toBe(json.stages.length);
    });

    it('resolves role-level and stage-level Codex runtime choices via --json', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'codex-mix');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: codex-mix
agents:
  planner:
    runtime: codex
    sessionReuse: run-planner
    sandbox: workspace-write
  reviewer: claude
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: verify
    skill: rasen:review
    role: reviewer
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
    requires: [propose]
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'codex-mix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      const propose = json.stages.find((s: any) => s.id === 'propose');
      const verify = json.stages.find((s: any) => s.id === 'verify');

      expect(propose.runtime).toBe('codex');
      expect(propose.runtimeSource).toBe('agent');
      expect(propose.sessionReuse).toBe('run-planner');
      expect(propose.sandbox).toBe('workspace-write');
      expect(verify.runtime).toBe('codex');
      expect(verify.runtimeSource).toBe('stage');
      expect(verify.sessionReuse).toBe('review-thread');
      expect(verify.sandbox).toBe('read-only');
    });

    it('errors with available list on unknown name', async () => {
      const result = await runCLI(['pipeline', 'show', 'does-not-exist', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Pipeline 'does-not-exist' not found");
      expect(result.stderr).toContain('bug-fix');
    });

    it('surfaces origin: composed for a LEAD-composed project pipeline (autonomy-ladder rung 2)', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'composed-widget');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: composed-widget
origin: composed
stages:
  - id: apply
    skill: rasen-apply-change
    role: implementer
  - id: verify
    skill: rasen:review
    role: reviewer
    requires: [apply]
  - id: review-loop
    skill: rasen-review-cycle
    requires: [verify]
    loop:
      kind: review-cycle
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'composed-widget', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.origin).toBe('composed');

      const humanResult = await runCLI(['pipeline', 'show', 'composed-widget'], { cwd: testDir });
      expect(humanResult.exitCode).toBe(0);
      expect(humanResult.stdout).toContain('Origin: composed');
    });

    it('omits origin from a human-authored pipeline (bug-fix built-in)', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Object.prototype.hasOwnProperty.call(json, 'origin')).toBe(false);
    });

    it('surfaces a decompose stage with its kind and resolved childPipeline', async () => {
      const result = await runCLI(['pipeline', 'show', 'auto-decompose', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.buildOrder[0]).toBe('decompose');
      const dec = json.stages.find((s: any) => s.id === 'decompose');
      expect(dec.kind).toBe('decompose');
      expect(dec.childPipeline).toBe('small-feature');
      expect(dec.skill).toBeNull();
    });

    it('surfaces the resolved per-stage handoff config (stage > role > pipeline)', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'handoff-mix');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: handoff-mix
handoff:
  threshold: 0.4
  roles:
    reviewer: 0.65
  maxRelays: 4
  stallLimit: 3
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: review
    skill: rasen:review
    role: reviewer
    requires: [propose]
  - id: fix
    skill: rasen-apply-change
    role: fixer
    requires: [review]
    handoff:
      threshold: 0.8
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'handoff-mix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      const propose = json.stages.find((s: any) => s.id === 'propose');
      const review = json.stages.find((s: any) => s.id === 'review');
      const fix = json.stages.find((s: any) => s.id === 'fix');

      expect(propose.handoff).toMatchObject({ threshold: 0.4, maxRelays: 4, stallLimit: 3, source: 'pipeline' });
      expect(review.handoff).toMatchObject({ threshold: 0.65, source: 'role' });
      expect(fix.handoff).toMatchObject({ threshold: 0.8, maxRelays: 4, source: 'stage' });
    });

    it('surfaces the resolved reuse config at the top level (declared block)', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'reuse-mix');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: reuse-mix
reuse:
  planner: never
  threshold: 0.4
  roles:
    planner: 0.5
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: apply
    skill: rasen-apply-change
    role: implementer
    requires: [propose]
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'reuse-mix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.reuse).toEqual({
        planner: 'never',
        implementer: 'auto',
        threshold: 0.4,
        roles: { planner: 0.5, implementer: 0.4 },
      });
    });

    it('surfaces the resolved reuse config as built-in defaults when no block is declared', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.reuse).toEqual({
        planner: 'auto',
        implementer: 'auto',
        threshold: 0.25,
        roles: { planner: 0.25, implementer: 0.25 },
      });
    });

    it('a fraction-only pipeline show --json is byte-identical to pre-change output', async () => {
      // Regression guard for the dual-form threshold widening: a fixture that
      // declares no absolute thresholds and names no preset-known model must
      // resolve to EXACTLY the same handoff/reuse shape a pre-change build
      // would have produced. toEqual is exact (no extra/missing/renamed
      // keys tolerated) — a key add/rename/reorder in the resolved shape
      // fails this test, unlike a typeof/enum-membership check.
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'fraction-only');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: fraction-only
handoff:
  threshold: 0.4
  roles:
    reviewer: 0.65
  maxRelays: 4
  stallLimit: 3
reuse:
  threshold: 0.3
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: review
    skill: rasen:review
    role: reviewer
    requires: [propose]
  - id: fix
    skill: rasen-apply-change
    role: fixer
    requires: [review]
    handoff:
      threshold: 0.8
  - id: none
    skill: rasen-apply-change
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'fraction-only', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.reuse).toEqual({
        planner: 'auto',
        implementer: 'auto',
        threshold: 0.3,
        roles: { planner: 0.3, implementer: 0.3 },
      });

      const byId = Object.fromEntries(json.stages.map((s: any) => [s.id, s.handoff]));
      expect(byId).toEqual({
        propose: { threshold: 0.4, maxRelays: 4, stallLimit: 3, source: 'pipeline' },
        review: { threshold: 0.65, maxRelays: 4, stallLimit: 3, source: 'role' },
        fix: { threshold: 0.8, maxRelays: 4, stallLimit: 3, source: 'stage' },
        none: { threshold: 0.4, maxRelays: 4, stallLimit: 3, source: 'pipeline' },
      });
    });

    it('reports an absolute { remainingTokens } handoff threshold as the object form', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'handoff-abs');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: handoff-abs
handoff:
  threshold:
    remainingTokens: 60000
stages:
  - id: propose
    skill: rasen-propose
    role: planner
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'handoff-abs', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      const propose = json.stages.find((s: any) => s.id === 'propose');
      expect(propose.handoff).toMatchObject({
        threshold: { remainingTokens: 60000 },
        source: 'pipeline',
      });
    });

    it('resolves source: preset when the stage model matches a preset and nothing is configured', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'handoff-preset');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: handoff-preset
agents:
  implementer:
    model: gpt-5.6-sol
stages:
  - id: apply
    skill: rasen-apply-change
    role: implementer
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'handoff-preset', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      const apply = json.stages.find((s: any) => s.id === 'apply');
      expect(apply.handoff).toMatchObject({
        threshold: { remainingTokens: 60000 },
        source: 'preset',
      });

      const humanResult = await runCLI(['pipeline', 'show', 'handoff-preset'], { cwd: testDir });
      expect(humanResult.exitCode).toBe(0);
      expect(humanResult.stdout).toContain('handoff=60000 tokens remaining(preset)');
    });

    it('pipeline show --json reflects the machine-config model (config-page-coherence)', async () => {
      const rasenHome = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-pipeline-model-home-'));
      await fs.writeFile(
        path.join(rasenHome, 'config.json'),
        JSON.stringify({ models: { default: 'sonnet', roles: { reviewer: 'fable' } } }),
        'utf-8'
      );
      await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\nmodels:\n  roles:\n    implementer: opus\n',
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
        cwd: testDir,
        env: { RASEN_HOME: rasenHome },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      const reviewerStage = json.stages.find((s: any) => s.role === 'reviewer');
      if (reviewerStage) {
        expect(reviewerStage.model).toBe('fable');
        expect(reviewerStage.modelSource).toBe('global-role');
      }
      const implementerStage = json.stages.find((s: any) => s.role === 'implementer');
      if (implementerStage) {
        expect(implementerStage.model).toBe('opus');
        expect(implementerStage.modelSource).toBe('project-role');
      }
    });

    // Goal-loop `pipeline show` human-readable rendering. goal-loop-core
    // generalized the meta line (pipeline.ts) to emit the goal-loop gate label,
    // but shipped no command test for the string. These assert the exact format.
    it('renders the goal-loop measure gate label in human-readable show', async () => {
      const result = await runCLI(['pipeline', 'show', 'goal-loop-measure'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      // The iterate stage meta line names the gate kind + both bounds.
      expect(result.stdout).toContain('loop=goal[measure](max 5, stall 2)');
      // And it must NOT degrade to the review-cycle label format.
      expect(result.stdout).not.toContain('loop=review-cycle');
    });

    it('renders the goal-loop evaluate gate label in human-readable show', async () => {
      const result = await runCLI(['pipeline', 'show', 'goal-loop-evaluate'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('loop=goal[evaluate](max 5, stall 2)');
      expect(result.stdout).not.toContain('loop=review-cycle');
    });

    // autopilot-gate-policy: define-goal's gate widened from true to 'vet'.
    // --json reports the exact string value; the human table surfaces it
    // distinctly as `gate(vet)` so an operator can tell it apart from an
    // ordinary skippable gate at a glance.
    it("reports define-goal gate as 'vet' in --json and renders gate(vet) in human-readable show", async () => {
      const jsonResult = await runCLI(['pipeline', 'show', 'goal-loop-measure', '--json'], {
        cwd: testDir,
      });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      const defineGoal = json.stages.find((s: any) => s.id === 'define-goal');
      expect(defineGoal.gate).toBe('vet');
      const ship = json.stages.find((s: any) => s.id === 'ship');
      expect(ship.gate).toBe(true);

      const humanResult = await runCLI(['pipeline', 'show', 'goal-loop-measure'], { cwd: testDir });
      expect(humanResult.exitCode).toBe(0);
      expect(humanResult.stdout).toContain('gate(vet)');
    });

    // Regression guard: the goal-loop generalization must not have changed the
    // review-cycle label on the existing built-in pipelines.
    it('still renders the review-cycle loop label for small-feature (no regression)', async () => {
      const result = await runCLI(['pipeline', 'show', 'small-feature'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('loop=review-cycle(max 3)');
      // The goal-loop bracket format must not appear on a review-cycle stage.
      expect(result.stdout).not.toContain('loop=goal[');
    });
  });

  describe('agents', () => {
    // The re-pointed `agents` writes `pipelines.<name>.runtimes.<role>` config
    // instances via the standard config write path, which requires an existing
    // rasen/config.yaml — never a frozen pipeline.yaml copy.
    async function writeProjectConfig(): Promise<void> {
      await fs.writeFile(path.join(testDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    }

    it('writes runtime config instances (not a pipeline YAML copy) and switches role runtimes', async () => {
      await writeProjectConfig();
      const result = await runCLI(
        ['pipeline', 'agents', 'small-feature', '--planner', 'codex', '--reviewer', 'codex', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.name).toBe('small-feature');
      expect(json.configPath).toContain(path.join('rasen', 'config.yaml'));
      expect(json.effectiveRoles.planner).toEqual({ runtime: 'codex', source: 'config-project' });
      expect(json.effectiveRoles.reviewer).toEqual({ runtime: 'codex', source: 'config-project' });
      expect(json.effectiveRoles.implementer).toEqual({ runtime: 'claude', source: 'default' });

      // Config instances were written, and NO pipeline definition file was created.
      const configText = await fs.readFile(path.join(testDir, 'rasen', 'config.yaml'), 'utf-8');
      expect(configText).toContain('codex');
      const overridePath = path.join(testDir, 'rasen', 'pipelines', 'small-feature', 'pipeline.yaml');
      await expect(fs.stat(overridePath)).rejects.toBeDefined();

      const show = await runCLI(['pipeline', 'show', 'small-feature', '--json'], { cwd: testDir });
      expect(show.exitCode).toBe(0);
      const shown = JSON.parse(show.stdout.trim());
      const propose = shown.stages.find((s: any) => s.id === 'propose');
      const verify = shown.stages.find((s: any) => s.id === 'verify');
      const apply = shown.stages.find((s: any) => s.id === 'apply');

      expect(propose.runtime).toBe('codex');
      expect(propose.runtimeSource).toBe('stage-override-project');
      expect(verify.runtime).toBe('codex');
      expect(verify.runtimeSource).toBe('stage-override-project');
      expect(apply.runtime).toBe('claude');
      expect(apply.runtimeSource).toBe('default');
    });

    it('unsetting the runtime instance reverts the role to its declaration/default', async () => {
      await writeProjectConfig();
      await runCLI(['pipeline', 'agents', 'small-feature', '--planner', 'codex', '--json'], { cwd: testDir });
      // Remove the instance via `config unset` and confirm the role reverts.
      const unset = await runCLI(
        ['config', 'unset', 'pipelines.small-feature.runtimes.planner', '--scope', 'project'],
        { cwd: testDir }
      );
      expect(unset.exitCode).toBe(0);
      const result = await runCLI(['pipeline', 'agents', 'small-feature', '--json'], { cwd: testDir });
      const json = JSON.parse(result.stdout.trim());
      expect(json.effectiveRoles.planner).toEqual({ runtime: 'claude', source: 'default' });
    });

    it('prints current effective role runtimes when no updates are passed', async () => {
      const result = await runCLI(['pipeline', 'agents', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.configPath).toBeNull();
      expect(json.effectiveRoles).toEqual({
        planner: { runtime: 'claude', source: 'default' },
        implementer: { runtime: 'claude', source: 'default' },
        reviewer: { runtime: 'claude', source: 'default' },
        fixer: { runtime: 'claude', source: 'default' },
        shipper: { runtime: 'claude', source: 'default' },
      });
    });

    it('rejects invalid role runtime values', async () => {
      const result = await runCLI(['pipeline', 'agents', 'small-feature', '--planner', 'gemini', '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid runtime 'gemini'");
    });
  });

  describe('classify', () => {
    it('maps bug-fix indicators', async () => {
      const result = await runCLI(
        ['pipeline', 'classify', 'fix the broken login crash', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('bug-fix');
      expect(json.matched).toContain('fix');
      expect(json.matched).toContain('broken');
      expect(json.matched).toContain('crash');
      expect(json.available).toContain('bug-fix');
      expect(json.basis).toBe('keyword');
    });

    it('maps full-feature indicators', async () => {
      const result = await runCLI(
        ['pipeline', 'classify', 'implement a new module for the subsystem', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('full-feature');
      expect(json.matched).toContain('implement');
      expect(json.matched).toContain('module');
      expect(json.basis).toBe('keyword');
    });

    it('defaults to small-feature with no matched indicators', async () => {
      const result = await runCLI(
        ['pipeline', 'classify', 'add a small toggle to the form', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('small-feature');
      expect(json.matched).toEqual([]);
      expect(json.basis).toBe('default');
    });

    it('prefers bug-fix over full-feature when both classes match', async () => {
      // "implement" (full) + "fix" (bug) — bug-fix takes precedence.
      const result = await runCLI(
        ['pipeline', 'classify', 'implement a fix for the module', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('bug-fix');
      expect(json.basis).toBe('keyword');
    });
  });

  describe('resume', () => {
    it('blocks a resumed executable frontier when the active profile disables a known skill', async () => {
      const home = await createIsolatedProposeOnlyHome('.resume-execution-home');
      const changeDir = path.join(changesDir, 'disabled-resume');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose'] }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'disabled-resume', '--json'], {
        cwd: testDir,
        env: { RASEN_HOME: home },
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/known but disabled skill/);
      expect(result.stderr).not.toMatch(/unknown skill/);
      expect(result.stdout).not.toMatch(/"ready"/);
    });

    it('reports hasRunState:false when no auto-run.json exists', async () => {
      await fs.mkdir(path.join(changesDir, 'my-change'), { recursive: true });
      const result = await runCLI(['pipeline', 'resume', 'my-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.change).toBe('my-change');
      expect(json.hasRunState).toBe(false);
      expect(json.pipeline).toBeNull();
      expect(json.completed).toEqual([]);
      expect(json.next).toBeNull();
      expect(json.remaining).toEqual([]);
      expect(json.note).toContain('No run-state');
    });

    // design D3: a located-but-unparseable auto-run.json is reported
    // distinctly from the no-file case, so the failure is diagnosable.
    it('reports invalidRunState:true with path+reason for a syntactically broken auto-run.json', async () => {
      const changeDir = path.join(changesDir, 'broken-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'auto-run.json'), '{ not valid json', 'utf-8');

      const result = await runCLI(['pipeline', 'resume', 'broken-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.hasRunState).toBe(false);
      expect(json.invalidRunState).toBe(true);
      expect(json.runStatePath).toContain('auto-run.json');
      expect(json.note).toContain('invalid');

      const textResult = await runCLI(['pipeline', 'resume', 'broken-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('invalid');
    });

    it('reports invalidRunState:true for a run-state that fails schema validation', async () => {
      const changeDir = path.join(changesDir, 'schema-broken-change');
      await fs.mkdir(changeDir, { recursive: true });
      // missing required `pipeline` field
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ completed: ['propose'] }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'schema-broken-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.hasRunState).toBe(false);
      expect(json.invalidRunState).toBe(true);
      expect(json.runStatePath).toContain('auto-run.json');
    });

    it('keeps today\'s "not found" output exactly for an absent auto-run.json (no invalidRunState key)', async () => {
      await fs.mkdir(path.join(changesDir, 'absent-change'), { recursive: true });
      const result = await runCLI(['pipeline', 'resume', 'absent-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.hasRunState).toBe(false);
      expect(json.invalidRunState).toBeUndefined();
      expect(json.note).toContain('No run-state');
    });

    it('computes next/remaining from a synthesized auto-run.json', async () => {
      const changeDir = path.join(changesDir, 'wip-change');
      await fs.mkdir(changeDir, { recursive: true });
      // bug-fix build order: propose -> apply -> verify -> ship -> archive
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose', 'apply'] }, null, 2),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'wip-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.change).toBe('wip-change');
      expect(json.hasRunState).toBe(true);
      expect(json.pipeline).toBe('bug-fix');
      expect(json.completed).toEqual(['propose', 'apply']);
      expect(json.next).toBe('verify');
      expect(json.ready).toEqual(['verify']);
      expect(json.remaining).toEqual(['verify', 'ship', 'archive']);
    });

    // autopilot-gate-policy: resume reads the recorded gate policy so a
    // --no-gate run does not need to re-pass the flag on resume.
    it('surfaces the recorded gatePolicy in json and text output', async () => {
      const changeDir = path.join(changesDir, 'gated-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          gatePolicy: { effective: 'off', source: 'flag' },
          completed: ['propose'],
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'gated-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.gatePolicy).toEqual({ effective: 'off', source: 'flag' });

      const textResult = await runCLI(['pipeline', 'resume', 'gated-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Gate policy: off (flag)');
    });

    it('omits gatePolicy when the run-state predates this capability', async () => {
      const changeDir = path.join(changesDir, 'ungated-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose'] }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'ungated-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Object.prototype.hasOwnProperty.call(json, 'gatePolicy')).toBe(false);
    });

    it('surfaces per-stage warm-seed worker pointers (agentId/transcript)', async () => {
      const changeDir = path.join(changesDir, 'seeded-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          tier: 'A',
          stages: {
            propose: { status: 'done', worker: 'planner-1' }, // bare string → not warm-seedable
            apply: {
              status: 'done',
              worker: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'seeded-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.completed.sort()).toEqual(['apply', 'propose']);
      expect(json.next).toBe('verify');
      // Only the structured worker with a reusable pointer is surfaced.
      expect(json.workers).toEqual({
        apply: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
      });
    });

    it('surfaces a reused worker\'s reusedFrom lineage and omits it when absent', async () => {
      const changeDir = path.join(changesDir, 'reused-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          tier: 'A',
          stages: {
            propose: {
              status: 'done',
              worker: { role: 'planner', agentId: 'plan-1', transcript: 'agent-plan-1.jsonl' },
            },
            apply: {
              status: 'done',
              worker: {
                role: 'implementer',
                agentId: 'imp-7',
                transcript: 'agent-imp-7.jsonl',
                reusedFrom: 'child-1',
              },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'reused-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.workers.apply.reusedFrom).toBe('child-1');
      // A worker without the marker does not gain a reusedFrom key.
      expect(Object.prototype.hasOwnProperty.call(json.workers.propose, 'reusedFrom')).toBe(false);
    });

    it('surfaces Codex threadId worker pointers for resume', async () => {
      const changeDir = path.join(changesDir, 'codex-thread-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            propose: {
              status: 'done',
              worker: {
                runtime: 'codex',
                role: 'planner',
                threadId: 'thread-propose-1',
                turnId: 'turn-1',
                sandbox: 'workspace-write',
              },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'codex-thread-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.workers).toEqual({
        propose: {
          runtime: 'codex',
          role: 'planner',
          threadId: 'thread-propose-1',
          turnId: 'turn-1',
          sandbox: 'workspace-write',
        },
      });
    });

    it('surfaces interrupted/escalated stages and open findings (P3)', async () => {
      const changeDir = path.join(changesDir, 'stalled-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            propose: { status: 'done' },
            apply: { status: 'in_progress' },
            verify: { status: 'escalated' },
          },
          openFindings: [{ severity: 'major', summary: 'unhandled error path', stage: 'verify' }],
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'stalled-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.inProgressStages).toEqual(['apply']);
      expect(json.escalatedStages).toEqual(['verify']);
      expect(json.openFindings).toHaveLength(1);
      expect(json.openFindings[0].severity).toBe('major');
    });

    it('errors when the change does not exist', async () => {
      const result = await runCLI(['pipeline', 'resume', 'nope-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Change 'nope-change' not found");
    });

    it('surfaces sessionHandoff and per-stage latest handoff paths', async () => {
      const changeDir = path.join(changesDir, 'handoff-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          sessionHandoff: { path: 'handoff/lead-1.md', pct: 0.52, afterStage: 'apply' },
          stages: {
            propose: { status: 'done' },
            apply: {
              status: 'in_progress',
              handoffs: [
                { n: 1, path: 'handoff/implementer-1.md', reason: 'compaction' },
                { n: 2, path: 'handoff/implementer-2.md', reason: 'budget' },
              ],
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'handoff-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.sessionHandoff).toMatchObject({ path: 'handoff/lead-1.md', pct: 0.52, afterStage: 'apply' });
      // Latest handoff path per stage (highest n).
      expect(json.handoffs).toEqual({ apply: 'handoff/implementer-2.md' });
    });

    it('surfaces the sessionHandoff relay generation n in json and text output', async () => {
      const changeDir = path.join(changesDir, 'relay-gen-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          sessionHandoff: { path: 'handoff/lead-2.md', n: 2, pct: 0.55 },
          stages: { propose: { status: 'done' } },
        }),
        'utf-8'
      );

      const jsonResult = await runCLI(['pipeline', 'resume', 'relay-gen-change', '--json'], { cwd: testDir });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      expect(json.sessionHandoff).toMatchObject({ path: 'handoff/lead-2.md', n: 2 });

      const textResult = await runCLI(['pipeline', 'resume', 'relay-gen-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Session handoff (generation 2): handoff/lead-2.md');
    });

    it('reports generation 1 in text output when sessionHandoff has no n', async () => {
      const changeDir = path.join(changesDir, 'relay-gen1-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          sessionHandoff: { path: 'handoff/lead-1.md' },
          stages: { propose: { status: 'done' } },
        }),
        'utf-8'
      );

      const jsonResult = await runCLI(['pipeline', 'resume', 'relay-gen1-change', '--json'], { cwd: testDir });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      expect(json.sessionHandoff.path).toBe('handoff/lead-1.md');
      expect(Object.prototype.hasOwnProperty.call(json.sessionHandoff, 'n')).toBe(false);

      const textResult = await runCLI(['pipeline', 'resume', 'relay-gen1-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Session handoff (generation 1): handoff/lead-1.md');
    });

    it('omits handoff keys entirely when a run recorded none', async () => {
      const changeDir = path.join(changesDir, 'no-handoff-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose'] }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'no-handoff-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Object.prototype.hasOwnProperty.call(json, 'sessionHandoff')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(json, 'handoffs')).toBe(false);
    });

    it('attaches a contextEstimate to a worker whose transcript is readable', async () => {
      const changeDir = path.join(changesDir, 'ctx-change');
      await fs.mkdir(changeDir, { recursive: true });
      // A real transcript on disk, referenced by absolute path from the worker.
      const transcriptPath = path.join(changeDir, 'agent-imp-7.jsonl');
      await fs.writeFile(
        transcriptPath,
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: 250000 } },
        }) + '\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: {
            apply: {
              status: 'done',
              worker: { role: 'implementer', agentId: 'imp-7', transcript: transcriptPath },
            },
            // A worker whose transcript does NOT exist → no contextEstimate, no failure.
            verify: {
              status: 'done',
              worker: { role: 'reviewer', agentId: 'rev-9', transcript: path.join(changeDir, 'missing.jsonl') },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'ctx-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.workers.apply.contextEstimate).toEqual({
        contextTokens: 250000,
        limit: 1_000_000,
        pct: 0.25,
        remainingTokens: 750000,
      });
      // Unreadable transcript: worker still present, estimate silently omitted.
      expect(json.workers.verify.agentId).toBe('rev-9');
      expect(json.workers.verify.contextEstimate).toBeUndefined();
    });

    // worker-handle validation surfaced on resume (design D1): a name-only
    // worker would be silently dropped from the warm-seed set; resume now warns.
    it('warns on a name-only worker in json + text (exit 0)', async () => {
      const changeDir = path.join(changesDir, 'name-only-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: {
            apply: { status: 'done', worker: { name: 'implementer' } },
          },
        }),
        'utf-8'
      );

      const jsonResult = await runCLI(['pipeline', 'resume', 'name-only-change', '--json'], { cwd: testDir });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      expect(json.workerHandleWarnings).toContainEqual({ stage: 'apply', keys: ['name'] });

      const textResult = await runCLI(['pipeline', 'resume', 'name-only-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Worker handle warning');
      expect(textResult.stdout).toContain("stage 'apply'");
      expect(textResult.stdout).toContain('recorded: name');
    });

    it('emits no workerHandleWarnings for a durable-handle worker', async () => {
      const changeDir = path.join(changesDir, 'durable-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: {
            apply: {
              status: 'done',
              worker: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'durable-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Object.prototype.hasOwnProperty.call(json, 'workerHandleWarnings')).toBe(false);
      // A clean run (durable handles, no duplicate keys) gains neither warning key.
      expect(Object.prototype.hasOwnProperty.call(json, 'duplicateKeyWarnings')).toBe(false);
      // The existing workers assertion still holds.
      expect(json.workers).toEqual({
        apply: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
      });
    });

    // duplicate-key detection in run-state (design D3): JSON.parse silently
    // collapses duplicate keys; resume now surfaces them as a non-fatal warning.
    it('warns on duplicate JSON keys in auto-run.json (last value wins, exit 0)', async () => {
      const changeDir = path.join(changesDir, 'dup-keys-change');
      await fs.mkdir(changeDir, { recursive: true });
      // Hand-written JSON with a duplicate `rounds` key at the root level.
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        '{\n  "pipeline": "bug-fix",\n  "rounds": 1,\n  "completed": ["propose"],\n  "rounds": 2\n}',
        'utf-8'
      );

      const jsonResult = await runCLI(['pipeline', 'resume', 'dup-keys-change', '--json'], { cwd: testDir });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      expect(json.duplicateKeyWarnings).toContainEqual({ path: '$', key: 'rounds' });
      // The file still parses (last value wins) and resume proceeds normally.
      expect(json.hasRunState).toBe(true);
      expect(json.pipeline).toBe('bug-fix');
      expect(json.completed).toEqual(['propose']);

      // Spec SHALL: the duplicate-key warning must also appear in the
      // human-readable output, not only under --json.
      const textResult = await runCLI(['pipeline', 'resume', 'dup-keys-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Duplicate run-state key');
      expect(textResult.stdout).toContain("'rounds'");
      expect(textResult.stdout).toContain('repeated at $');
    });

    it('resumes a decomposed parent from portfolio-run.json (frontier from the DAG)', async () => {
      const changeDir = path.join(changesDir, 'big-feature');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify(
          {
            parent: 'big-feature',
            children: [
              { id: 'big-feature-api', pipeline: 'small-feature', dependsOn: [], status: 'done' },
              { id: 'big-feature-ui', pipeline: 'full-feature', dependsOn: ['big-feature-api'], status: 'pending' },
              { id: 'big-feature-docs', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'big-feature', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.isPortfolio).toBe(true);
      expect(json.complete).toBe(false);
      expect(json.completedChildren).toEqual(['big-feature-api']);
      // -ui unblocked (its prereq is done) and -docs is an independent root
      expect(json.runnableChildren).toEqual(['big-feature-docs', 'big-feature-ui']);
      expect(json.planner).toBeNull(); // no persistent planner recorded
    });

    it('surfaces interrupted and escalated children, not just the runnable frontier (P3)', async () => {
      const changeDir = path.join(changesDir, 'portfolio-mixed');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify({
          parent: 'portfolio-mixed',
          planner: { role: 'planner', agentId: 'plan-9', transcript: 'agent-plan-9.jsonl' },
          children: [
            { id: 'pm-a', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'pm-b', pipeline: 'small-feature', dependsOn: [], status: 'in_progress' },
            { id: 'pm-c', pipeline: 'small-feature', dependsOn: [], status: 'escalated' },
            { id: 'pm-d', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
          ],
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'portfolio-mixed', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.runnableChildren).toEqual(['pm-d']); // only fresh pending + deps satisfied
      expect(json.interruptedChildren).toEqual(['pm-b']); // re-engage via warm-seed
      expect(json.escalatedChildren).toEqual(['pm-c']); // human attention
      // Run-level persistent planner pointer surfaced for warm-seed reuse.
      expect(json.planner).toEqual({ role: 'planner', agentId: 'plan-9', transcript: 'agent-plan-9.jsonl' });
    });
  });

  describe('resume with external work directory (design change-work-dir)', () => {
    function normalizePaths(str: string): string {
      return str.replace(/\\/g, '/');
    }

    /**
     * Mints machine identity for `testDir` (via the ensure surface,
     * `instructions`) and returns the resolved workDir for `changeName`.
     */
    async function mintWorkDir(changeName: string, globalDataDir: string): Promise<string> {
      await fs.writeFile(path.join(testDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      await fs.mkdir(path.join(changesDir, changeName), { recursive: true });
      await fs.writeFile(
        path.join(changesDir, changeName, 'proposal.md'),
        '## Why\nTest.\n\n## What Changes\n- test'
      );
      await runCLI(['instructions', 'proposal', '--change', changeName], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      const statusResult = await runCLI(['status', '--change', changeName, '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      const statusJson = JSON.parse(statusResult.stdout);
      expect(typeof statusJson.workDir).toBe('string');
      return statusJson.workDir as string;
    }

    it('resolves run-state from the work directory for a new-style change', async () => {
      const globalDataDir = path.join(testDir, 'global-data-new');
      const workDir = await mintWorkDir('new-style-change', globalDataDir);
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'new-style-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(normalizePaths(json.runStateDir)).toContain('new-style-change/work');
      expect(json.completed).toContain('propose');
    });

    it('falls back to legacy change-dir run-state when workDir has none, reporting runStateDir = change dir', async () => {
      const globalDataDir = path.join(testDir, 'global-data-legacy');
      await mintWorkDir('legacy-change', globalDataDir);
      const changeDir = path.join(changesDir, 'legacy-change');
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'legacy-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(normalizePaths(json.runStateDir)).toMatch(/legacy-change$/);
      expect(json.completed).toContain('propose');
    });

    it('prefers the work-dir copy when both workDir and changeDir have run-state', async () => {
      const globalDataDir = path.join(testDir, 'global-data-both');
      const workDir = await mintWorkDir('both-change', globalDataDir);
      const changeDir = path.join(changesDir, 'both-change');
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'auto-run.json'),
        JSON.stringify(
          { pipeline: 'bug-fix', stages: { propose: { status: 'done' }, implement: { status: 'done' } } },
          null,
          2
        )
      );
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'both-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(normalizePaths(json.runStateDir)).toContain('both-change/work');
      // Proves the workDir copy (2 stages done) won over the changeDir copy (1).
      expect(json.completed).toContain('implement');
    });

    // scope item 3 / design D1+D4: covers the screenshot path together —
    // workDir-first resolution AND host-tolerant parsing of a Codex-LEAD-written
    // run-state, placed ONLY in the external workDir (no legacy changeDir copy).
    it('resolves and host-tolerantly parses a Codex-flavored run-state found ONLY in the work directory', async () => {
      const globalDataDir = path.join(testDir, 'global-data-codex-host');
      const workDir = await mintWorkDir('codex-host-change', globalDataDir);
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'auto-run.json'),
        JSON.stringify(
          {
            pipeline: 'bug-fix',
            stages: {
              propose: {
                status: 'done',
                worker: { transcript: null, runtime: 'codex-host-fallback', agentId: 'codex-1' },
              },
            },
          },
          null,
          2
        )
      );

      const result = await runCLI(['pipeline', 'resume', 'codex-host-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(json.invalidRunState).toBeUndefined();
      expect(normalizePaths(json.runStateDir)).toContain('codex-host-change/work');
      expect(json.completed).toContain('propose');
    });

    it('portfolio-state resolution follows the same workDir-first/change-dir-fallback matrix', async () => {
      const globalDataDir = path.join(testDir, 'global-data-portfolio');
      const workDir = await mintWorkDir('portfolio-parent', globalDataDir);
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'portfolio-run.json'),
        JSON.stringify(
          {
            parent: 'portfolio-parent',
            children: [
              { id: 'child-a', pipeline: 'bug-fix', dependsOn: [], status: 'done' },
              { id: 'child-b', pipeline: 'bug-fix', dependsOn: ['child-a'], status: 'pending' },
            ],
          },
          null,
          2
        )
      );

      const result = await runCLI(['pipeline', 'resume', 'portfolio-parent', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.isPortfolio).toBe(true);
      expect(normalizePaths(json.runStateDir)).toContain('portfolio-parent/work');
      expect(json.runnableChildren).toEqual(['child-b']);
    });

    // Review finding F1: a corrupt machine-global registry.json must not
    // brick resume — it falls back to reading legacy run-state from the
    // change directory (workDir probe degrades to null, not a thrown error).
    it('falls back to legacy change-dir run-state (never throws) when registry.json is corrupt', async () => {
      const globalDataDir = path.join(testDir, 'global-data-corrupt-registry');
      await mintWorkDir('corrupt-registry-change', globalDataDir);
      const registryPath = path.join(globalDataDir, 'rasen', 'projects', 'registry.json');
      await fs.writeFile(registryPath, '{not valid json');

      const changeDir = path.join(changesDir, 'corrupt-registry-change');
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'corrupt-registry-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(normalizePaths(json.runStateDir)).toMatch(/corrupt-registry-change$/);
      expect(json.completed).toContain('propose');
    });
  });
});

// The pipeline command group resolves its root through the shared root-selection
// layer (parity with `validate --pipelines`): from a nested subdirectory it walks
// up to the nearest qualifying Rasen root rather than treating the cwd as root.
describe('pipeline command root selection (subdirectory)', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-pipeline-root-selection-tmp');
  const nestedDir = path.join(testDir, 'src', 'deeply', 'nested');
  const PROJECT_PIPELINE = 'proj-only-pipeline';

  beforeEach(async () => {
    // A planning shape (specs/ + changes/) makes testDir a qualifying root; a
    // bare openspec/pipelines/ dir alone does NOT qualify (see root-selection).
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
    const pipelineDir = path.join(testDir, 'rasen', 'pipelines', PROJECT_PIPELINE);
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, 'pipeline.yaml'),
      [
        `name: ${PROJECT_PIPELINE}`,
        'stages:',
        '  - id: propose',
        '    skill: rasen-propose',
        '    role: planner',
      ].join('\n'),
      'utf-8'
    );
    await fs.mkdir(nestedDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('resolves the ancestor root and lists the project pipeline from a subdirectory', async () => {
    const result = await runCLI(['pipeline', 'list', '--json'], { cwd: nestedDir });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    const names = json.pipelines.map((p: any) => p.name);
    expect(names).toContain(PROJECT_PIPELINE);
    for (const name of BUILTIN_NAMES) {
      expect(names).toContain(name);
    }
    const proj = json.pipelines.find((p: any) => p.name === PROJECT_PIPELINE);
    expect(proj.source).toBe('project');
  });

  it('sees the same pipeline set as validate --pipelines from the same subdirectory', async () => {
    const listResult = await runCLI(['pipeline', 'list', '--json'], { cwd: nestedDir });
    expect(listResult.exitCode).toBe(0);
    const listNames = new Set<string>(
      JSON.parse(listResult.stdout.trim()).pipelines.map((p: any) => p.name)
    );

    const validateResult = await runCLI(['validate', '--pipelines', '--json'], { cwd: nestedDir });
    expect(validateResult.exitCode).toBe(0);
    const validateNames = new Set<string>(
      JSON.parse(validateResult.stdout.trim()).items
        .filter((i: any) => i.type === 'pipeline')
        .map((i: any) => i.id)
    );

    expect(listNames).toEqual(validateNames);
    expect(listNames.has(PROJECT_PIPELINE)).toBe(true);
  });
});
