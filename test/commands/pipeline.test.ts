import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  createPipelinePackage,
  encodePackage,
  type PipelinePackageInput,
} from '../../src/core/workflow-package/index.js';
import { loadWorkflowCatalog } from '../../src/core/workflow-registry/index.js';
import {
  cliProjectRoot,
  runCLI,
  terminateActiveCliChildren,
} from '../helpers/run-cli.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { getGlobalDataDir } from '../../src/core/index.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

const BUILTIN_NAMES = [
  'auto-decompose',
  'bug-fix',
  'full-feature',
  'goal-loop-evaluate',
  'goal-loop-measure',
  'goal-loop-research',
  'small-feature',
  'task-loop',
] as const;
const PIPELINE_LOCALES = ['en', 'ja', 'zh-cn'] as const;
const fakeClaudeBinary = path.join(
  cliProjectRoot,
  'test',
  'fixtures',
  'claude',
  process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs'
);

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
    lifecycle: 'Normalized bounded-loop lifecycle policies:',
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
    lifecycle: '正規化された境界付きループのライフサイクルポリシー:',
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
    lifecycle: '已规范化的有界循环生命周期策略：',
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
  let testDir: string;
  let changesDir: string;

  beforeAll(async () => {
    if (process.platform !== 'win32') await fs.chmod(fakeClaudeBinary, 0o755);
  });

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(projectRoot, '.rasen-pipeline-command-')
    );
    changesDir = path.join(testDir, 'rasen', 'changes');
    await fs.mkdir(changesDir, { recursive: true });
  });

  afterEach(async () => {
    // A Vitest case timeout does not cancel the in-flight runCLI promise. Reap
    // its exact child before removing the cwd so Windows cannot report EBUSY.
    await terminateActiveCliChildren();
    await cleanupTempPathAsync(testDir);
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
        expect(show.stdout).toContain(expected.lifecycle);

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
        expect(validation.stdout).toContain(expected.lifecycle);

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
      // This assertion case intentionally launches sixteen separate CLIs. On
      // Windows, four-worker process/FS contention can nearly double its
      // isolated duration without changing any command result.
      120_000
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
      expect(payloads.show.source).toBe('package');
      // Engine support analysis (task 12.8): additive fields shared with start,
      // management detail, and Canvas. bug-fix normalizes to a v2 ReviewCycle
      // BoundedLoop (D4 migration), so both legacy and reconciler engines are
      // available.
      //
      // ECP-5 (task 6.1): this used to assert `supported: false` /
      // `execution_profile_unavailable` with the comment "`show` has no
      // launch-time profile, so reconciler support remains unsupported at
      // display time" — which encoded the DEFECT as the contract. `show`
      // passed `profile: null`, so every pipeline reported that reason
      // whatever its shape, and `executable-parallel-pipelines` scenario 1
      // ("`rasen pipeline show` SHALL report `availableEngines` including
      // `reconciler` with reason `supported_v2_parallel`") was unsatisfiable.
      // `show` now resolves a DISCOVERY profile — the same bindings the launch
      // profile resolves — so the reason is the definition's real shape.
      expect(payloads.show.availableEngines).toEqual(['reconciler']);
      expect(payloads.show.reconcilerSupport).toMatchObject({
        supported: true,
        reason: 'supported_v2_executable',
      });
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
      120_000
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
      expect(bugFix.stages).toContain('root:propose');
      expect(bugFix.executionView).toMatchObject({
        authoredVersion: 2,
        buildOrder: expect.arrayContaining(['root:propose', 'root:archive']),
        availableEngines: expect.arrayContaining(['reconciler']),
        reconcilerSupport: { supported: true },
      });
      expect(bugFix.executionView.stages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodePath: 'root:propose',
            capability: expect.objectContaining({ id: 'skill:rasen-propose' }),
          }),
        ])
      );
      expect(bugFix.executionView.capabilityPaths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ profilePath: 'root:verify/strategy' }),
        ])
      );
      expect(bugFix.executionView.policyPaths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ profilePath: 'root:verify/strategy' }),
        ])
      );
      expect(typeof bugFix.description).toBe('string');

      const compatibilityFixtures = json.pipelines.filter(
        (pipeline: any) => pipeline.compatibilityBoundary !== undefined
      );
      expect(compatibilityFixtures).toEqual([
        expect.objectContaining({
          name: 'auto-decompose',
          authoredVersion: 1,
          compatibilityBoundary: 'issue-dispatch-0.3.0',
        }),
      ]);
    });

    it('prints a human-readable table without --json', async () => {
      const result = await runCLI(['pipeline', 'list'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('bug-fix');
      expect(result.stdout).toContain('[package]');
      expect(result.stdout).toContain(
        'Compatibility input boundary: issue-dispatch-0.3.0'
      );
    });

    it.each(['project', 'user'] as const)(
      'refuses a same-name %s task-loop shadow before creating a Run',
      async (layer) => {
        const changeId = `shadowed-task-loop-${layer}`;
        await fs.mkdir(path.join(changesDir, changeId), { recursive: true });
        const dataHome = path.join(testDir, `data-${layer}`);
        const pipelineBase = layer === 'project'
          ? path.join(testDir, 'rasen', 'pipelines')
          : path.join(dataHome, 'rasen', 'pipelines');
        const pipelineDir = path.join(pipelineBase, 'task-loop');
        await fs.mkdir(pipelineDir, { recursive: true });
        await fs.writeFile(
          path.join(pipelineDir, 'pipeline.yaml'),
          [
            'version: 1',
            'name: task-loop',
            'description: A valid but unauthorized same-name shadow.',
            'stages:',
            '  - id: apply',
            '    skill: rasen-apply-change',
            '    role: implementer',
            '    requires: []',
          ].join('\n'),
          'utf8'
        );
        const ephemera = path.join(
          testDir,
          '.rasen',
          'changes',
          changeId,
          'ephemera'
        );
        await fs.mkdir(ephemera, { recursive: true });
        const inputFile = path.join(ephemera, 'task-loop-input.json');
        await fs.writeFile(
          inputFile,
          JSON.stringify({
            taskLoop: {
              format: 'task-loop-input/1',
              goal: 'Prove package provenance is enforced.',
              artifactTargets: ['README.md'],
              bar: [
                {
                  id: 'package-only',
                  criterion: 'The package built-in is the selected definition.',
                  evidenceHint: 'Inspect the winning resolver source.',
                },
              ],
              constraints: [],
            },
          }),
          'utf8'
        );

        const result = await runCLI(
          [
            'pipeline',
            'start',
            changeId,
            'task-loop',
            '--input-file',
            inputFile,
            '--engine',
            'reconciler',
            '--json',
          ],
          {
            cwd: testDir,
            env: { XDG_DATA_HOME: dataHome, RASEN_AGENT_RUNTIME: 'codex' },
          }
        );
        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          'reserved for the exact package built-in Pipeline'
        );
      }
    );
  });

  describe('show', () => {
    it(
      'keeps incomplete exact-capability v2 visible and stops execution at its truthful unavailable boundary',
      async () => {
        const workflow = loadWorkflowCatalog().definitions.find(
          (definition) =>
            definition.skill.template.name === 'rasen-apply-change'
        );
        expect(workflow).toBeDefined();
        const name = 'exact-capability-v2';
        const pipelineDir = path.join(testDir, 'rasen', 'pipelines', name);
        await fs.mkdir(pipelineDir, { recursive: true });
        await fs.writeFile(
          path.join(pipelineDir, 'pipeline.yaml'),
          JSON.stringify({
            version: 2,
            id: name,
            sourceId: `fixture:${name}`,
            name,
            inputs: [],
            artifacts: [],
            outcomes: ['done'],
            declarations: [],
            root: {
              nodes: [
                {
                  id: 'implement',
                  kind: 'AtomicStage',
                  capability: {
                    id: 'skill:rasen-apply-change',
                    version: workflow!.digest,
                  },
                  execution: {
                    version: 1,
                    role: 'implementer',
                    workspace: { access: 'write' },
                  },
                },
              ],
              connections: [],
            },
          }),
          'utf-8'
        );

        const list = await runCLI(['pipeline', 'list', '--json'], {
          cwd: testDir,
        });
        expect(list.exitCode).toBe(0);
        const listed = JSON.parse(list.stdout).pipelines.find(
          (pipeline: any) => pipeline.name === name
        );
        expect(listed).toMatchObject({
          authoredVersion: 2,
          definitionValid: true,
          planAvailable: true,
          executable: false,
          executionMode: 'unavailable',
          unavailableReason: 'ecp_v2_runtime_unavailable',
        });
        expect(listed).not.toHaveProperty('prepared');

        const detail = await runCLI(['pipeline', 'show', name, '--json'], {
          cwd: testDir,
        });
        expect(detail.exitCode).toBe(0);
        expect(JSON.parse(detail.stdout)).toMatchObject({
          version: 2,
          name,
          definition: { version: 2, name },
          preparation: {
            definitionValid: true,
            planAvailable: true,
            executable: false,
            executionMode: 'unavailable',
            unavailableReason: 'ecp_v2_runtime_unavailable',
          },
          buildOrder: ['root:implement'],
          stages: [
            expect.objectContaining({
              nodePath: 'root:implement',
              workspace: 'write',
            }),
          ],
        });

        const execution = await runCLI(
          ['pipeline', 'show', name, '--for-execution', '--json'],
          { cwd: testDir }
        );
        expect(execution.exitCode).toBe(1);
        expect(execution.stderr).toContain('ecp_v2_runtime_unavailable');
        expect(execution.stderr).not.toContain('pipeline_not_found');
      },
      60_000
    );

    it('projects a closed AtomicStage-to-Finish native v2 graph identically before and after execution preflight', async () => {
      const workflow = loadWorkflowCatalog().definitions.find(
        (definition) => definition.skill.template.name === 'rasen-apply-change'
      );
      expect(workflow).toBeDefined();
      const name = 'closed-native-v2';
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', name);
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        JSON.stringify({
          version: 2,
          id: `pipeline:${name}`,
          sourceId: `fixture:${name}`,
          name,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [
              {
                id: 'apply',
                kind: 'AtomicStage',
                capability: {
                  id: 'skill:rasen-apply-change',
                  version: workflow!.digest,
                },
                execution: {
                  version: 1,
                  role: 'implementer',
                  workspace: { access: 'write' },
                },
              },
              { id: 'finish', kind: 'Finish', outcome: 'done' },
            ],
            connections: [
              {
                id: 'apply-to-finish',
                from: { node: 'apply', port: 'done' },
                to: { node: 'finish', port: 'start' },
              },
            ],
          },
        }),
        'utf-8'
      );

      const display = await runCLI(['pipeline', 'show', name, '--json'], {
        cwd: testDir,
      });
      const execution = await runCLI(
        ['pipeline', 'show', name, '--for-execution', '--json'],
        { cwd: testDir }
      );
      expect(display.exitCode).toBe(0);
      expect(execution.exitCode, execution.stderr).toBe(0);
      expect(JSON.parse(execution.stdout)).toEqual(JSON.parse(display.stdout));
      expect(JSON.parse(display.stdout)).toMatchObject({
        buildOrder: ['root:apply'],
        capabilityPaths: [
          expect.objectContaining({ profilePath: 'root:apply' }),
        ],
        policyPaths: [
          expect.objectContaining({ profilePath: 'root:apply' }),
        ],
        stages: [
          expect.objectContaining({
            nodePath: 'root:apply',
            capability: {
              id: 'skill:rasen-apply-change',
              version: workflow!.digest,
            },
            role: 'implementer',
            workspace: 'write',
          }),
        ],
        preparation: { executable: true, executionMode: 'reconciler' },
      });
    });

    it('shows the same invalid v2 winner in CLI inventory and detail', async () => {
      const name = 'invalid-v2-detail';
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', name);
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        JSON.stringify({
          version: 2,
          id: name,
          sourceId: `fixture:${name}`,
          name,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [{ id: 'choice', kind: 'Choice' }],
            connections: [],
          },
        }),
        'utf-8'
      );

      const list = await runCLI(['pipeline', 'list', '--json'], {
        cwd: testDir,
      });
      const listed = JSON.parse(list.stdout).pipelines.find(
        (pipeline: any) => pipeline.name === name
      );
      expect(listed).toMatchObject({
        definitionValid: false,
        diagnostics: [
          expect.objectContaining({
            code: 'INVALID_SOURCE',
            path: '/root/nodes/0/outcomes',
          }),
        ],
      });

      const detail = await runCLI(['pipeline', 'show', name, '--json'], {
        cwd: testDir,
      });
      expect(detail.exitCode).toBe(0);
      expect(JSON.parse(detail.stdout)).toMatchObject({
        name,
        preparation: {
          definitionValid: false,
          diagnostics: [
            expect.objectContaining({
              code: 'INVALID_SOURCE',
              path: '/root/nodes/0/outcomes',
            }),
          ],
        },
      });

      const execution = await runCLI(
        ['pipeline', 'show', name, '--for-execution', '--json'],
        { cwd: testDir }
      );
      expect(execution.exitCode).toBe(1);
      expect(execution.stderr).toContain('INVALID_SOURCE');
      expect(execution.stderr).toContain('/root/nodes/0/outcomes');
    });

    it('preserves lifecycle diagnostic code and JSON Pointer through validate and show', async () => {
      const name = 'missing-loop-lifecycle-v2';
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', name);
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        JSON.stringify({
          version: 2,
          id: name,
          sourceId: `fixture:${name}`,
          name,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [
            {
              id: 'body',
              kind: 'Composite',
              provenance: 'custom',
              inputs: [],
              artifacts: [],
              outcomes: ['done'],
              graph: {
                nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
                connections: [],
              },
            },
          ],
          root: {
            nodes: [
              {
                id: 'loop',
                kind: 'BoundedLoop',
                body: 'body',
                limits: { maxIterations: 2, maxActions: 4, budget: 4 },
                exits: { done: { action: 'exit', outcome: 'done' } },
              },
            ],
            connections: [],
          },
        }),
        'utf-8'
      );

      const validation = await runCLI(
        ['pipeline', 'validate', pipelineDir, '--json'],
        { cwd: testDir }
      );
      expect(validation.exitCode).toBe(1);
      expect(JSON.parse(validation.stdout.trim())).toMatchObject({
        validation: {
          valid: false,
          diagnostics: [
            expect.objectContaining({
              code: 'MISSING_LIFECYCLE_POLICY',
              path: '/root/nodes/0/lifecycle',
            }),
          ],
        },
      });

      const detail = await runCLI(['pipeline', 'show', name, '--json'], {
        cwd: testDir,
      });
      expect(detail.exitCode).toBe(0);
      expect(JSON.parse(detail.stdout.trim())).toMatchObject({
        preparation: {
          definitionValid: false,
          diagnostics: [
            expect.objectContaining({
              code: 'MISSING_LIFECYCLE_POLICY',
              path: '/root/nodes/0/lifecycle',
            }),
          ],
        },
      });
    });

    it('preserves invalid-v2 preparation identity and context for direct and decompose execution admission', async () => {
      const childName = 'invalid-execution-child';
      const childDir = path.join(testDir, 'rasen', 'pipelines', childName);
      await fs.mkdir(childDir, { recursive: true });
      await fs.writeFile(
        path.join(childDir, 'pipeline.yaml'),
        JSON.stringify({
          version: 2,
          id: childName,
          sourceId: `fixture:${childName}`,
          name: childName,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [{ id: 'choice', kind: 'Choice' }],
            connections: [],
          },
        }),
        'utf-8'
      );
      const parentName = 'invalid-execution-parent';
      const parentDir = path.join(testDir, 'rasen', 'pipelines', parentName);
      await fs.mkdir(parentDir, { recursive: true });
      await fs.writeFile(
        path.join(parentDir, 'pipeline.yaml'),
        [
          'version: 1',
          `name: ${parentName}`,
          'stages:',
          '  - id: children',
          '    kind: decompose',
          `    childPipeline: ${childName}`,
          '',
        ].join('\n'),
        'utf-8'
      );

      const direct = await runCLI(
        ['pipeline', 'show', childName, '--for-execution', '--json'],
        { cwd: testDir }
      );
      const recursive = await runCLI(
        ['pipeline', 'show', parentName, '--for-execution', '--json'],
        { cwd: testDir }
      );

      expect(direct.exitCode).toBe(1);
      expect(recursive.exitCode).toBe(1);
      for (const result of [direct, recursive]) {
        expect(result.stderr).toContain('INVALID_SOURCE');
        expect(result.stderr).toContain('/root/nodes/0/outcomes');
        expect(result.stderr).toContain('Choice outcomes');
      }
      expect(recursive.stderr).toContain(
        `Decompose stage 'children' references childPipeline '${childName}'`
      );
    });

    it.each([
      {
        label: 'malformed YAML',
        name: 'invalid-detail-yaml',
        source: 'version: 2\nname: invalid-detail-yaml\nroot: [\n',
        expectedCode: 'INVALID_SOURCE',
        expectedPath: '/',
        expectedDefinition: {},
      },
      {
        label: 'malformed JSON',
        name: 'invalid-detail-json',
        source: '{"version":2,"name":"invalid-detail-json","root":',
        expectedCode: 'INVALID_SOURCE',
        expectedPath: '/',
        expectedDefinition: {},
      },
      {
        label: 'unsupported version',
        name: 'invalid-detail-version',
        source: 'version: 99\nname: invalid-detail-version\n',
        expectedCode: 'UNSUPPORTED_VERSION',
        expectedPath: '/version',
        expectedDefinition: {
          version: 99,
          name: 'invalid-detail-version',
        },
      },
      {
        label: 'malformed nested v2 value',
        name: 'invalid-detail-nested',
        source: JSON.stringify({
          version: 2,
          id: 'invalid-detail-nested',
          sourceId: 'fixture:invalid-detail-nested',
          name: 'invalid-detail-nested',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [{ id: 'choice', kind: 'Choice' }],
            connections: [],
          },
        }),
        expectedCode: 'INVALID_SOURCE',
        expectedPath: '/root/nodes/0/outcomes',
        expectedDefinition: {
          version: 2,
          id: 'invalid-detail-nested',
          sourceId: 'fixture:invalid-detail-nested',
          name: 'invalid-detail-nested',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [{ id: 'choice', kind: 'Choice' }],
            connections: [],
          },
        },
      },
      {
        label: 'parseable semantic-invalid v2 value',
        name: 'invalid-detail-semantic',
        source: JSON.stringify({
          version: 2,
          id: 'invalid-detail-semantic',
          sourceId: 'fixture:invalid-detail-semantic',
          name: 'invalid-detail-semantic',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [
              { id: 'duplicate', kind: 'Finish', outcome: 'done' },
              { id: 'duplicate', kind: 'Finish', outcome: 'done' },
            ],
            connections: [],
          },
        }),
        expectedCode: 'DUPLICATE_ID',
        expectedPath: '/root/nodes/1/id',
        expectedDefinition: {
          version: 2,
          id: 'invalid-detail-semantic',
          sourceId: 'fixture:invalid-detail-semantic',
          name: 'invalid-detail-semantic',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [
              { id: 'duplicate', kind: 'Finish', outcome: 'done' },
              { id: 'duplicate', kind: 'Finish', outcome: 'done' },
            ],
            connections: [],
          },
        },
      },
      {
        label: 'duplicate authored-contract v2 value',
        name: 'invalid-detail-duplicate-contract',
        source: JSON.stringify({
          version: 2,
          id: 'invalid-detail-duplicate-contract',
          sourceId: 'fixture:invalid-detail-duplicate-contract',
          name: 'invalid-detail-duplicate-contract',
          inputs: [
            { name: 'payload', type: 'text/plain' },
            { name: 'payload', type: 'application/json' },
          ],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
            connections: [],
          },
        }),
        expectedCode: 'DUPLICATE_ID',
        expectedPath: '/inputs/1/name',
        expectedDefinition: {
          version: 2,
          id: 'invalid-detail-duplicate-contract',
          sourceId: 'fixture:invalid-detail-duplicate-contract',
          name: 'invalid-detail-duplicate-contract',
          inputs: [
            { name: 'payload', type: 'text/plain' },
            { name: 'payload', type: 'application/json' },
          ],
          artifacts: [],
          outcomes: ['done'],
          declarations: [],
          root: {
            nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
            connections: [],
          },
        },
      },
    ])(
      'keeps $label inventory/detail preparation diagnostics identical without parser leakage',
      async ({ name, source, expectedCode, expectedPath, expectedDefinition }) => {
        const pipelineDir = path.join(testDir, 'rasen', 'pipelines', name);
        await fs.mkdir(pipelineDir, { recursive: true });
        await fs.writeFile(
          path.join(pipelineDir, 'pipeline.yaml'),
          source,
          'utf-8'
        );

        const list = await runCLI(['pipeline', 'list', '--json'], {
          cwd: testDir,
        });
        expect(list.exitCode).toBe(0);
        const listed = JSON.parse(list.stdout).pipelines.find(
          (pipeline: any) => pipeline.name === name
        );
        expect(listed.definitionValid).toBe(false);
        expect(listed).not.toHaveProperty('authoredText');
        expect(listed).not.toHaveProperty('authoredDefinition');
        expect(listed.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: expectedCode }),
          ])
        );

        const detail = await runCLI(['pipeline', 'show', name, '--json'], {
          cwd: testDir,
        });
        expect(detail.exitCode).toBe(0);
        expect(detail.stderr).not.toMatch(/BAD_INDENT|YAMLParseError/);
        const shown = JSON.parse(detail.stdout);
        expect(shown.definition).toEqual(expectedDefinition);
        expect(shown.preparation.diagnostics).toEqual(listed.diagnostics);

        const execution = await runCLI(
          ['pipeline', 'show', name, '--for-execution', '--json'],
          { cwd: testDir }
        );
        expect(execution.exitCode).toBe(1);
        expect(execution.stderr).not.toMatch(/BAD_INDENT|YAMLParseError/);
        expect(execution.stderr).toContain(expectedCode);
        expect(execution.stderr).toContain(expectedPath);
      },
      60_000
    );

    it('exposes normalized Pipeline definition v1 in JSON and human output', async () => {
      const jsonResult = await runCLI(['pipeline', 'show', 'auto-decompose', '--json'], {
        cwd: testDir,
      });
      const humanResult = await runCLI(['pipeline', 'show', 'auto-decompose'], {
        cwd: testDir,
      });

      expect(jsonResult.exitCode).toBe(0);
      expect(JSON.parse(jsonResult.stdout.trim()).version).toBe(1);
      expect(humanResult.exitCode).toBe(0);
      expect(humanResult.stdout).toContain('Definition version: 1');
    });

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
      expect(executable.stderr).toMatch(/CAPABILITY_DISABLED/);
      expect(executable.stderr).toMatch(/installed but disabled/);
      expect(executable.stderr).not.toMatch(/unknown skill/);
      expect(executable.stdout).not.toMatch(/"buildOrder"/);
    });

    it('returns the DAG, buildOrder, and full stage fields via --json', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
        cwd: testDir,
        env: { CODEX_THREAD_ID: 'command-test-thread' },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.name).toBe('bug-fix');
      expect(json.hostRuntime).toBe('codex');
      expect(json.hostRuntimeSource).toBe('codex-thread-id');
      expect(typeof json.description).toBe('string');
      expect(Array.isArray(json.buildOrder)).toBe(true);
      expect(json.buildOrder[0]).toBe('root:propose');

      // Every stage carries the full field set (defaults made explicit).
      const stage = json.stages[0];
      for (const field of [
        'id',
        'nodePath',
        'profilePath',
        'capability',
        'role',
        'requires',
        'workspace',
        'gate',
        'effectiveGate',
        'leadReview',
        'verifyPolicy',
        'runtime',
        'dispatchMode',
        'bridge',
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
        threshold: 0.85,
        source: 'default',
      });
      expect(stage.id).toBe('propose');
      expect(stage.runtime).toEqual({ value: 'codex', source: 'host' });
      expect(stage.dispatchMode).toBe('native');
      expect(stage.capability.id).toBe('skill:rasen-propose');
      expect(stage.gate).toBe(true);
      // build order length equals stage count
      expect(json.buildOrder.length).toBe(json.stages.length);
    });

    it('labels an unknown host as legacy fallback instead of native', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
        cwd: testDir,
        env: {
          RASEN_AGENT_RUNTIME: '',
          CODEX_THREAD_ID: '',
          CODEX_SANDBOX: '',
          CLAUDECODE: '',
        },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.hostRuntime).toBe('unknown');
      expect(json.hostRuntimeSource).toBe('unknown');
      expect(json.stages[0]).toMatchObject({
        runtime: { value: 'claude', source: 'legacy-default' },
        dispatchMode: 'legacy-fallback',
      });
    });

    it('threads run-local role flags through the final execution preflight and JSON plan', async () => {
      const home = path.join(testDir, '.run-local-rescue-home');
      await fs.mkdir(path.join(home, 'schemes'), { recursive: true });
      await fs.writeFile(
        path.join(home, 'schemes', 'codex-final.yaml'),
        [
          'handoff: 0.61',
          'handoffRoles:',
          '  planner: 0.62',
          'reuse: 0.31',
          'reuseRoles:',
          '  planner: 0.32',
          '',
        ].join('\n'),
        'utf-8'
      );
      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({ thresholds: { bindings: { codex: 'codex-final' } } }),
        'utf-8'
      );
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'run-local-rescue');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: run-local-rescue
stages:
  - id: propose
    skill: rasen-propose
    role: planner
`,
        'utf-8'
      );
      await fs.writeFile(
        path.join(testDir, 'rasen', 'config.yaml'),
        [
          'schema: spec-driven',
          'pipelines:',
          '  run-local-rescue:',
          '    runtimes:',
          '      planner: claude',
          '',
        ].join('\n'),
        'utf-8'
      );
      const env = {
        CODEX_THREAD_ID: 'command-test-thread',
        RASEN_HOME: home,
      };

      const bridged = await runCLI(
        ['pipeline', 'show', 'run-local-rescue', '--for-execution', '--json'],
        {
          cwd: testDir,
          env: {
            ...env,
            RASEN_CLAUDE_BIN: fakeClaudeBinary,
          },
        }
      );
      expect(bridged.exitCode).toBe(0);
      const bridgedJson = JSON.parse(bridged.stdout.trim());
      expect(bridgedJson.stages[0]).toMatchObject({
        runtime: 'claude',
        dispatchMode: 'exec-bridge',
        bridge: 'claude-print',
      });

      const rescued = await runCLI(
        [
          'pipeline',
          'show',
          'run-local-rescue',
          '--for-execution',
          '--planner',
          'codex',
          '--json',
        ],
        { cwd: testDir, env }
      );
      expect(rescued.exitCode).toBe(0);
      const json = JSON.parse(rescued.stdout.trim());
      expect(json.stages[0]).toMatchObject({
        runtime: 'codex',
        runtimeSource: 'invocation',
        dispatchMode: 'native',
        handoff: {
          threshold: 0.62,
          source: 'global-scheme-role',
          binding: {
            scope: 'global',
            row: 'codex',
            scheme: 'codex-final',
          },
        },
      });
      expect(json.reuse).toMatchObject({
        roles: { planner: 0.32 },
        sources: { roles: { planner: 'global-scheme-role' } },
        bindings: {
          roles: {
            planner: {
              scope: 'global',
              row: 'codex',
              scheme: 'codex-final',
            },
          },
        },
      });
    });

    it('resolves role-level and stage-level Codex runtime choices via --json', async () => {
      const home = path.join(testDir, '.stage-runtime-binding-home');
      await fs.mkdir(path.join(home, 'schemes'), { recursive: true });
      await fs.writeFile(
        path.join(home, 'schemes', 'stage-codex.yaml'),
        'handoff: 0.71\nhandoffRoles:\n  reviewer: 0.72\nreuse: 0.25\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({ thresholds: { bindings: { codex: 'stage-codex' } } }),
        'utf-8'
      );
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
    skill: rasen-review
    role: reviewer
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
    requires: [propose]
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'codex-mix', '--json'], {
        cwd: testDir,
        env: {
          CODEX_THREAD_ID: 'command-test-thread',
          RASEN_HOME: home,
        },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      const propose = json.stages.find((s: any) => s.id === 'propose');
      const verify = json.stages.find((s: any) => s.id === 'verify');

      expect(propose.runtime).toBe('codex');
      expect(propose.runtimeSource).toBe('agent');
      expect(propose.dispatchMode).toBe('native');
      expect(propose.sessionReuse).toBe('run-planner');
      expect(propose.sandbox).toBe('workspace-write');
      expect(verify.runtime).toBe('codex');
      expect(verify.runtimeSource).toBe('stage');
      expect(verify.dispatchMode).toBe('native');
      expect(verify.handoff).toMatchObject({
        threshold: 0.72,
        source: 'global-scheme-role',
        binding: {
          scope: 'global',
          row: 'codex',
          scheme: 'stage-codex',
        },
      });
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
    skill: rasen-review
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
      expect(json.compatibilityBoundary).toBe('issue-dispatch-0.3.0');
      expect(json.buildOrder[0]).toBe('decompose');
      const dec = json.stages.find((s: any) => s.id === 'decompose');
      expect(dec.kind).toBe('decompose');
      expect(dec.childPipeline).toBe('small-feature');
      expect(dec.skill).toBeNull();

      const human = await runCLI(['pipeline', 'show', 'auto-decompose'], {
        cwd: testDir,
      });
      expect(human.exitCode).toBe(0);
      expect(human.stdout).toContain(
        'Compatibility input boundary: issue-dispatch-0.3.0'
      );
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
    skill: rasen-review
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

    it('loads one runtime-binding scheme snapshot for handoff and reuse', async () => {
      const home = path.join(testDir, '.binding-home');
      await fs.mkdir(path.join(home, 'schemes'), { recursive: true });
      await fs.writeFile(
        path.join(home, 'schemes', 'focused.yaml'),
        'handoff: 0.55\nhandoffRoles:\n  reviewer: 0.6\nreuse: 0.2\nreuseRoles:\n  planner: 0.3\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({ thresholds: { bindings: { codex: 'focused' } } }),
        'utf-8'
      );
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'bound-show');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: bound-show
agents:
  planner: codex
  reviewer: codex
stages:
  - id: plan
    skill: rasen-propose
    role: planner
  - id: review
    skill: rasen-review
    role: reviewer
    requires: [plan]
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'bound-show', '--json'], {
        cwd: testDir,
        env: { RASEN_HOME: home },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.stages.find((stage: any) => stage.id === 'review').handoff).toMatchObject({
        threshold: 0.6,
        source: 'global-scheme-role',
        binding: { row: 'codex', scheme: 'focused' },
      });
      expect(json.reuse.roles.planner).toBe(0.3);
      expect(json.reuse.sources.roles.planner).toBe('global-scheme-role');
    });

    it('reports dangling bindings and falls back without failing pipeline show', async () => {
      const home = path.join(testDir, '.dangling-home');
      await fs.mkdir(home, { recursive: true });
      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({ thresholds: { bindings: { default: 'missing' } } }),
        'utf-8'
      );
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
        cwd: testDir,
        env: { RASEN_HOME: home },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.stages[0].handoff.diagnostics).toEqual([
        expect.objectContaining({ code: 'missing-scheme', scheme: 'missing' }),
      ]);
    });

    it('text show deduplicates stage-handoff and reuse binding warnings while preserving fallback output', async () => {
      const home = path.join(testDir, '.text-diagnostic-home');
      await fs.mkdir(path.join(home, 'schemes'), { recursive: true });
      await fs.writeFile(
        path.join(home, 'schemes', 'broken.yaml'),
        'handoff: [\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(home, 'schemes', 'focused.yaml'),
        'handoff: 0.55\nreuse: 0.2\n',
        'utf-8'
      );
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'text-diagnostics');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: text-diagnostics
agents:
  planner: claude
  implementer: claude
  reviewer: codex
stages:
  - id: review
    skill: rasen-review
    role: reviewer
`,
        'utf-8'
      );

      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({ thresholds: { bindings: { codex: 'broken' } } }),
        'utf-8'
      );
      const stageWarning = await runCLI(['pipeline', 'show', 'text-diagnostics'], {
        cwd: testDir,
        env: { RASEN_HOME: home },
      });
      expect(stageWarning.exitCode).toBe(0);
      expect(stageWarning.stdout).toContain('Pipeline: text-diagnostics');
      expect(stageWarning.stdout).toContain('review');
      expect(
        stageWarning.stderr.match(
          /Threshold binding global\.codex references invalid scheme "broken"/gu
        )
      ).toHaveLength(1);

      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({
          thresholds: { bindings: { codex: 'focused', default: 'missing-reuse' } },
        }),
        'utf-8'
      );
      const reuseWarning = await runCLI(['pipeline', 'show', 'text-diagnostics'], {
        cwd: testDir,
        env: { RASEN_HOME: home },
      });
      expect(reuseWarning.exitCode).toBe(0);
      expect(reuseWarning.stdout).toContain('Pipeline: text-diagnostics');
      expect(reuseWarning.stdout).toContain('review');
      expect(
        reuseWarning.stderr.match(
          /Threshold binding global\.default references missing scheme "missing-reuse"/gu
        )
      ).toHaveLength(1);
    });

    it('reports native-v2 session reuse per stage instead of fabricating a legacy pipeline-wide reuse block', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json).not.toHaveProperty('reuse');
      expect(json.stages.every((stage: any) => stage.sessionReuse)).toBe(true);
      expect(json.stages[0].sessionReuse).toEqual({
        effective: 'never',
        source: 'default',
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
    skill: rasen-review
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
        expect(reviewerStage.model).toEqual({
          value: 'fable',
          source: 'global-role',
        });
      }
      const implementerStage = json.stages.find((s: any) => s.role === 'implementer');
      if (implementerStage) {
        expect(implementerStage.model).toEqual({
          value: 'opus',
          source: 'project-role',
        });
      }
    });

    it('renders the native goal-loop measure lifecycle in human-readable show', async () => {
      const result = await runCLI(['pipeline', 'show', 'goal-loop-measure'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('iterate: limits={"maxIterations":5');
      expect(result.stdout).toContain('"stallIterations":2');
      expect(result.stdout).toContain('rasen-goal-iterate');
    });

    it('renders the native goal-loop evaluate lifecycle in human-readable show', async () => {
      const result = await runCLI(['pipeline', 'show', 'goal-loop-evaluate'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('iterate: limits={"maxIterations":5');
      expect(result.stdout).toContain('"stallIterations":2');
      expect(result.stdout).toContain('rasen-goal-iterate');
    });

    // autopilot-gate-policy: the vet type is retired — define-goal is an
    // ordinary gate: true reported as a boolean in --json and rendered as the
    // plain `gate` label in the human table (no `gate(vet)` variant remains).
    it('reports define-goal gate as a boolean true in --json and renders the plain gate label', async () => {
      const jsonResult = await runCLI(['pipeline', 'show', 'goal-loop-measure', '--json'], {
        cwd: testDir,
      });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      const defineGoal = json.stages.find((s: any) => s.id === 'define-goal');
      expect(defineGoal.gate).toBe(true);
      const ship = json.stages.find((s: any) => s.id === 'ship');
      expect(ship.gate).toBe(true);

      const humanResult = await runCLI(['pipeline', 'show', 'goal-loop-measure'], { cwd: testDir });
      expect(humanResult.exitCode).toBe(0);
      expect(humanResult.stdout).not.toContain('gate(vet)');
    });

    it('renders the native ReviewCycle lifecycle for small-feature', async () => {
      const result = await runCLI(['pipeline', 'show', 'small-feature'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('review-loop: limits={"maxIterations":3');
      expect(result.stdout).toContain('rasen-review-cycle');
    });

    it('shows and validates the exact authored native lifecycle strategy', async () => {
      const shown = await runCLI(
        ['pipeline', 'show', 'goal-loop-measure', '--json'],
        { cwd: testDir }
      );
      const validated = await runCLI(
        ['pipeline', 'validate', 'goal-loop-measure', '--json'],
        { cwd: testDir }
      );
      expect(shown.exitCode, shown.stderr).toBe(0);
      expect(validated.exitCode, validated.stderr).toBe(0);

      const showJson = JSON.parse(shown.stdout.trim());
      const validationJson = JSON.parse(validated.stdout.trim()).validation;
      expect(showJson.boundedLoops).toHaveLength(1);
      expect(validationJson.normalizedVersion).toBe(2);
      expect(validationJson.boundedLoops).toEqual(showJson.boundedLoops);
      expect(showJson.boundedLoops[0]).toMatchObject({
        nodeId: 'iterate',
        limits: { maxIterations: 5, maxActions: 40, budget: 40 },
        lifecycle: {
          version: 1,
          thresholds: { stallIterations: 2, sameBlockerAttempts: 3 },
          strategy: {
            maxAttempts: 1,
            requireMaterialChange: true,
            capability: {
              id: 'skill:rasen-goal-iterate',
              version: expect.any(String),
            },
          },
          exits: {
            iterationLimit: {
              action: 'strategy',
            },
            blocked: {
              action: 'human-required',
              outcome: 'goal-human-required',
            },
          },
        },
      });
      expect(showJson.boundedLoops[0].lifecycle.strategy.capability.version).toBe(
        'sha256:9522e1108c941534a888d5a0230ba29f1b7719a75949411b36e05f664d95331b'
      );
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
        {
          cwd: testDir,
          env: {
            RASEN_AGENT_RUNTIME: 'claude',
            // Configuration must not require the target runtime binary.
            PATH: '',
          },
        }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.name).toBe('small-feature');
      expect(json.configPath).toContain(path.join('rasen', 'config.yaml'));
      expect(json.hostRuntime).toBe('claude');
      expect(json.effectiveRoles.planner).toEqual({
        runtime: 'codex',
        source: 'config-project',
        dispatchMode: 'exec-bridge',
        bridge: 'codex-exec',
      });
      expect(json.effectiveRoles.reviewer).toEqual({
        runtime: 'codex',
        source: 'config-project',
        dispatchMode: 'exec-bridge',
        bridge: 'codex-exec',
      });
      expect(json.effectiveRoles.implementer).toEqual({
        runtime: 'claude',
        source: 'host',
        dispatchMode: 'native',
      });

      // Config instances were written, and NO pipeline definition file was created.
      const configText = await fs.readFile(path.join(testDir, 'rasen', 'config.yaml'), 'utf-8');
      expect(configText).toContain('codex');
      const overridePath = path.join(testDir, 'rasen', 'pipelines', 'small-feature', 'pipeline.yaml');
      await expect(fs.stat(overridePath)).rejects.toBeDefined();

      const show = await runCLI(['pipeline', 'show', 'small-feature', '--json'], {
        cwd: testDir,
        env: { RASEN_AGENT_RUNTIME: 'claude' },
      });
      expect(show.exitCode).toBe(0);
      const shown = JSON.parse(show.stdout.trim());
      const propose = shown.stages.find((s: any) => s.id === 'propose');
      const verify = shown.stages.find((s: any) => s.id === 'verify');
      const apply = shown.stages.find((s: any) => s.id === 'apply');

      expect(propose.runtime).toEqual({
        value: 'codex',
        source: 'stage-override-project',
      });
      expect(propose.dispatchMode).toBe('exec-bridge');
      expect(verify.runtime).toEqual({
        value: 'codex',
        source: 'stage-override-project',
      });
      expect(apply.runtime).toEqual({ value: 'claude', source: 'host' });
      expect(apply.dispatchMode).toBe('native');
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
      const result = await runCLI(['pipeline', 'agents', 'small-feature', '--json'], {
        cwd: testDir,
        env: {
          RASEN_AGENT_RUNTIME: '',
          CODEX_THREAD_ID: '',
          CODEX_SANDBOX: '',
          CLAUDECODE: '',
        },
      });
      const json = JSON.parse(result.stdout.trim());
      expect(json.effectiveRoles.planner).toEqual({
        runtime: 'claude',
        source: 'legacy-default',
        dispatchMode: 'legacy-fallback',
      });
    });

    it('prints current effective role runtimes when no updates are passed', async () => {
      const result = await runCLI(['pipeline', 'agents', 'bug-fix', '--json'], {
        cwd: testDir,
        env: { CODEX_THREAD_ID: 'command-test-thread' },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.configPath).toBeNull();
      expect(json.hostRuntime).toBe('codex');
      expect(json.effectiveRoles).toEqual({
        planner: { runtime: 'codex', source: 'host', dispatchMode: 'native' },
        implementer: { runtime: 'codex', source: 'host', dispatchMode: 'native' },
        reviewer: { runtime: 'codex', source: 'host', dispatchMode: 'native' },
        fixer: { runtime: 'codex', source: 'host', dispatchMode: 'native' },
        shipper: { runtime: 'codex', source: 'host', dispatchMode: 'native' },
      });
    });

    it.each(['zed', 'gemini'])('rejects non-dispatch role runtime %s', async (runtime) => {
      const result = await runCLI(['pipeline', 'agents', 'small-feature', '--planner', runtime, '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`Invalid runtime '${runtime}'`);
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
      expect(json.suggested).not.toBe('auto-decompose');
      expect(json.available).toContain('auto-decompose');
      expect(json.matched).toEqual([]);
      expect(json.basis).toBe('default');
    });

    it('lists task-loop as explicit-only but never classifies into it', async () => {
      const result = await runCLI(
        ['pipeline', 'classify', 'run a task loop over this artifact', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.available).toContain('task-loop');
      expect(json.suggested).toBe('small-feature');
      expect(json.suggested).not.toBe('task-loop');
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
    it('keeps the auto-decompose v1 compatibility fixture on legacy stage resume', async () => {
      const changeDir = path.join(changesDir, 'auto-decompose-legacy-resume');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'auto-decompose',
          stages: {
            decompose: { status: 'done' },
            propose: { status: 'pending' },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(
        ['pipeline', 'resume', 'auto-decompose-legacy-resume', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        pipeline: 'auto-decompose',
        completed: ['decompose'],
        next: 'propose',
      });
    });

    it('resumes a legacy run-state after its package pipeline migrates to native v2', async () => {
      const changeDir = path.join(changesDir, 'native-v2-resume');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'small-feature',
          engine: { effective: 'legacy', source: 'default' },
          stages: {
            propose: { status: 'done' },
            apply: { status: 'in_progress' },
            verify: { status: 'pending' },
            'review-loop': { status: 'pending' },
            ship: { status: 'pending' },
            archive: { status: 'pending' },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(
        ['pipeline', 'resume', 'native-v2-resume', '--json'],
        { cwd: testDir }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("Cannot read properties of null");
      const json = JSON.parse(result.stdout.trim());
      expect(json.pipeline).toBe('small-feature');
      expect(json.completed).toEqual(['propose']);
      expect(json.next).toBe('apply');
      expect(json.ready).toEqual(['apply']);
      expect(json.remaining).toEqual([
        'apply',
        'verify',
        'review-loop',
        'ship',
        'archive',
      ]);
      expect(json.legacySkillHints).toBeUndefined();
    });

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
      expect(result.stderr).toMatch(/installed but disabled/);
      expect(result.stderr).not.toMatch(/unknown skill/);
      expect(result.stdout).not.toMatch(/"ready"/);
    });

    it('surfaces the old→new hint (not a bare unknown-skill error) when a resumed pipeline stage names a retired colon skill (B1)', async () => {
      // Regression guard for the ADDED spec scenario "User pipeline authored with
      // colon reference resumes with a hint": a pre-rebrand project pipeline stage
      // references the retired colon identity `rasen:review`. Resume must not
      // dead-end at preflight — it resolves the ref for validation and surfaces the
      // old→new hint so the resumer renames the stage. The colon id stays an
      // INVALID execution id (validate/dispatch still reject it — design D3: this
      // is a hint, not silent acceptance).
      const home = path.join(testDir, '.legacy-colon-home');
      await fs.mkdir(home, { recursive: true });
      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({ profile: 'full', delivery: 'both' })
      );
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'legacy-colon-pipe');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        [
          'name: legacy-colon-pipe',
          'stages:',
          '  - id: propose',
          '    skill: rasen-propose',
          '  - id: review',
          '    skill: rasen:review',
          '',
        ].join('\n'),
        'utf-8'
      );
      const changeDir = path.join(changesDir, 'legacy-colon-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'legacy-colon-pipe', completed: ['propose'] }),
        'utf-8'
      );

      const result = await runCLI(
        ['pipeline', 'resume', 'legacy-colon-change', '--json'],
        { cwd: testDir, env: { RASEN_HOME: home } }
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toMatch(/unknown skill/);
      const json = JSON.parse(result.stdout.trim());
      expect(json.legacySkillHints).toEqual(
        expect.arrayContaining([{ stage: 'review', from: 'rasen:review', to: 'rasen-review' }])
      );

      // The retired colon id remains an INVALID execution id: the execution
      // preflight view still rejects it (D3 — hint, not silent acceptance).
      const forExec = await runCLI(
        ['pipeline', 'show', 'legacy-colon-pipe', '--for-execution', '--json'],
        { cwd: testDir, env: { RASEN_HOME: home } }
      );
      expect(forExec.exitCode).toBe(1);
      expect(forExec.stderr).toMatch(/rasen:review/);
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

    it('surfaces frozen knowledgeContext for retain/codify resume routing', async () => {
      const changeDir = path.join(changesDir, 'knowledge-context-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          completed: ['propose', 'apply'],
          knowledgeContext: {
            version: 1,
            planningRoot: { type: 'store', id: 'team' },
            owner: { type: 'project', id: 'web' },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(
        ['pipeline', 'resume', 'knowledge-context-change', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).knowledgeContext).toEqual({
        version: 1,
        planningRoot: { type: 'store', id: 'team' },
        owner: { type: 'project', id: 'web' },
      });
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

    it('surfaces an exact Claude bridge sessionId/cwd in JSON and human resume output', async () => {
      const changeDir = path.join(changesDir, 'claude-session-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            propose: {
              status: 'done',
              worker: {
                runtime: 'claude',
                dispatchMode: 'exec-bridge',
                role: 'planner',
                sessionId: 'claude-session-propose-1',
                cwd: testDir,
                sandbox: 'workspace-write',
              },
            },
          },
        }),
        'utf-8'
      );

      const jsonResult = await runCLI(
        ['pipeline', 'resume', 'claude-session-change', '--json'],
        { cwd: testDir }
      );
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      expect(json.workers.propose).toMatchObject({
        runtime: 'claude',
        dispatchMode: 'exec-bridge',
        sessionId: 'claude-session-propose-1',
        cwd: testDir,
      });
      expect(Object.prototype.hasOwnProperty.call(json, 'workerHandleWarnings')).toBe(false);

      const textResult = await runCLI(
        ['pipeline', 'resume', 'claude-session-change'],
        { cwd: testDir }
      );
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('claude-session-propose-1');
      expect(textResult.stdout).toContain(testDir);
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

    it('reports an invalid portfolio without falling back to parent auto-run.json', async () => {
      const changeDir = path.join(changesDir, 'invalid-portfolio');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify({
          parent: 'invalid-portfolio',
          children: [
            {
              id: 'invalid-portfolio-child',
              pipeline: 'small-feature',
              dependsOn: [],
              status: 'done',
              // A structurally invalid `prerequisites` (non-array) makes the
              // portfolio genuinely invalid even after M4's status normalization
              // restored tolerance for unrecognized status values.
              prerequisites: 'not-an-array',
            },
          ],
        }),
        'utf-8'
      );
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'auto-decompose',
          stages: {
            decompose: { status: 'done' },
            ship: { status: 'pending' },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(
        ['pipeline', 'resume', 'invalid-portfolio', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json).toMatchObject({
        change: 'invalid-portfolio',
        isPortfolio: true,
        hasRunState: false,
        invalidPortfolioState: true,
        pipeline: null,
        next: null,
        remaining: [],
      });
      expect(json.portfolioStatePath).toContain('portfolio-run.json');
      expect(json.note).toContain('prerequisites');

      const textResult = await runCLI(
        ['pipeline', 'resume', 'invalid-portfolio'],
        { cwd: testDir }
      );
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Invalid portfolio run-state');
      expect(textResult.stdout).toContain('prerequisites');
    });

    it('resumes portfolio-level delivery after every child has completed', async () => {
      const changeDir = path.join(changesDir, 'delivery-pending');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify({
          parent: 'delivery-pending',
          children: [
            { id: 'child-a', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'child-b', pipeline: 'small-feature', dependsOn: ['child-a'], status: 'skipped' },
          ],
        }),
        'utf-8'
      );

      const result = await runCLI(
        ['pipeline', 'resume', 'delivery-pending', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        isPortfolio: true,
        childrenComplete: true,
        delivery: { status: 'pending' },
        complete: false,
        next: 'portfolio-delivery',
        remaining: ['portfolio-delivery'],
      });

      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify({
          parent: 'delivery-pending',
          children: [
            { id: 'child-a', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'child-b', pipeline: 'small-feature', dependsOn: ['child-a'], status: 'skipped' },
          ],
          delivery: { status: 'done', mode: 'local' },
        }),
        'utf-8'
      );
      const complete = await runCLI(
        ['pipeline', 'resume', 'delivery-pending', '--json'],
        { cwd: testDir }
      );
      expect(JSON.parse(complete.stdout.trim())).toMatchObject({
        childrenComplete: true,
        delivery: { status: 'done', mode: 'local' },
        complete: true,
        next: null,
        remaining: [],
      });
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

    // The defect this group exists to remove: a paused portfolio offered
    // `ship`. The trigger was upstream of stage counting — one out-of-enum
    // child status made the whole portfolio record unreadable, the lenient
    // reader returned null, and the parent lost its portfolio identity and
    // fell through to the stage-based branch, which is the only place delivery
    // could be reached.
    it('still resolves as a portfolio when a child carries an out-of-enum status, and offers no delivery', async () => {
      const changeDir = path.join(changesDir, 'portfolio-drifted');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify({
          parent: 'portfolio-drifted',
          children: [
            { id: 'pd-a', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'pd-b', pipeline: 'small-feature', dependsOn: [], status: 'skipped' },
            // A word the reader has not learned. It must not disarm the guard.
            { id: 'pd-f', pipeline: 'small-feature', dependsOn: [], status: 'propose-done' },
          ],
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'portfolio-drifted', '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.isPortfolio).toBe(true);
      expect(json.complete).toBe(false);
      expect(json.remainingChildren).toEqual(['pd-f']);
      const drifted = json.children.find((c: { id: string }) => c.id === 'pd-f');
      expect(drifted.status).toBe('unknown');
      // The value AS WRITTEN is preserved and visible, not silently dropped.
      expect(drifted.statusRaw).toBe('propose-done');
      expect(
        json.children.find((c: { id: string }) => c.id === 'pd-a').statusRaw
      ).toBeUndefined();
      // Delivery is not reachable from the portfolio answer at all.
      expect(json.next).toBeUndefined();
      expect(json.ready).toBeUndefined();
      expect(json.remaining).toBeUndefined();
    });

    it('reports a genuinely unreadable portfolio record with path+reason and offers no next step', async () => {
      const changeDir = path.join(changesDir, 'portfolio-unreadable');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, 'portfolio-run.json'), '{ not valid json', 'utf-8');
      // A stage list that, taken alone, would leave only `ship`. If resume ever
      // degrades to the stage frontier, this is what it would offer.
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: {
            propose: { status: 'done' },
            apply: { status: 'done' },
            verify: { status: 'done' },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'portfolio-unreadable', '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.invalidPortfolioState).toBe(true);
      expect(json.portfolioStatePath).toContain('portfolio-run.json');
      expect(json.note).toContain('could not be read');
      expect(json.next).toBeNull();
      expect(json.ready).toEqual([]);
      expect(json.remaining).toEqual([]);
      // Specifically NOT the stage frontier the auto-run.json above would give.
      expect(json.pipeline).toBeNull();

      const textResult = await runCLI(['pipeline', 'resume', 'portfolio-unreadable'], {
        cwd: testDir,
      });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('could not be read');
      expect(textResult.stdout).not.toContain('Next: ship');
    });

    // Defense in depth: even with NO portfolio record at all, a parent whose
    // stages are honestly marked `delegated` cannot present `ship` as its
    // frontier.
    it('counts delegated stages as outstanding and does not offer delivery, with no portfolio record', async () => {
      const changeDir = path.join(changesDir, 'delegated-parent');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: {
            propose: { status: 'delegated' },
            apply: { status: 'delegated' },
            verify: { status: 'delegated' },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'delegated-parent', '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.completed).toEqual([]);
      expect(json.next).toBe('propose');
      expect(json.remaining).toContain('propose');
      expect(json.ready).not.toContain('ship');
      expect(json.next).not.toBe('ship');
    });

    // B2 regression guard: delegated stages + a corrupt portfolio-run.json must
    // report the invalid portfolio and NOT fall through to a stage-based resume
    // that could offer delivery (ship). The stage list below would leave only
    // `ship` if the stage frontier were used — exactly the defect B2 prevents.
    it('reports an invalid portfolio and offers no delivery when delegated stages meet a corrupt portfolio record', async () => {
      const changeDir = path.join(changesDir, 'delegated-corrupt-portfolio');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: {
            propose: { status: 'delegated' },
            apply: { status: 'delegated' },
            verify: { status: 'delegated' },
          },
        }),
        'utf-8'
      );
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        '{ not valid json',
        'utf-8'
      );

      const result = await runCLI(
        ['pipeline', 'resume', 'delegated-corrupt-portfolio', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.invalidPortfolioState).toBe(true);
      expect(json.portfolioStatePath).toContain('portfolio-run.json');
      expect(json.note).toContain('could not be read');
      expect(json.next).toBeNull();
      expect(json.ready).toEqual([]);
      expect(json.remaining).toEqual([]);
      // Specifically NOT the stage frontier the auto-run.json would give.
      expect(json.pipeline).toBeNull();
    });

    it('resumes a change with no portfolio record from its own stages, exactly as before', async () => {
      const changeDir = path.join(changesDir, 'undivided-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose', 'apply'] }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'undivided-change', '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.isPortfolio).toBeUndefined();
      expect(json.invalidPortfolioState).toBeUndefined();
      expect(json.pipeline).toBe('bug-fix');
      expect(json.next).toBe('verify');
      expect(json.remaining).toEqual(['verify', 'ship', 'archive']);
    });

    it('reports a portfolio whose children have all finished as complete', async () => {
      const changeDir = path.join(changesDir, 'portfolio-finished');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify({
          parent: 'portfolio-finished',
          children: [
            { id: 'pf-a', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'pf-b', pipeline: 'small-feature', dependsOn: ['pf-a'], status: 'skipped' },
          ],
          delivery: { status: 'done' },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'portfolio-finished', '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.isPortfolio).toBe(true);
      expect(json.complete).toBe(true);
      expect(json.remainingChildren).toEqual([]);
      expect(json.runnableChildren).toEqual([]);
    });
  });

  // The three-location sticky-legacy chain (file-placement D3): the execution
  // root's ephemera directory first, then the legacy machine-home work
  // directory, then the change directory.
  describe('resume run-state location chain (file-placement)', () => {
    function normalizePaths(str: string): string {
      return str.replace(/\\/g, '/');
    }

    /**
     * Mints machine identity for `testDir` and returns the resolved LEGACY
     * work directory for `changeName`. No workflow surface mints any more (the
     * work directory is legacy-read only), so identity is established through
     * the resolver directly — the way `rasen init` does.
     */
    async function mintWorkDir(changeName: string, globalDataDir: string): Promise<string> {
      await fs.writeFile(path.join(testDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      await fs.mkdir(path.join(changesDir, changeName), { recursive: true });
      await fs.writeFile(
        path.join(changesDir, changeName, 'proposal.md'),
        '## Why\nTest.\n\n## What Changes\n- test'
      );
      await resolveProjectHome(testDir, {
        ensure: true,
        globalDataDir: getGlobalDataDir({ env: { XDG_DATA_HOME: globalDataDir } }),
      });
      const statusResult = await runCLI(['status', '--change', changeName, '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      const statusJson = JSON.parse(statusResult.stdout);
      expect(typeof statusJson.workDir).toBe('string');
      return statusJson.workDir as string;
    }

    it('resolves run-state from the execution root ephemera directory first', async () => {
      const globalDataDir = path.join(testDir, 'global-data-ephemera-first');
      const workDir = await mintWorkDir('ephemera-first-change', globalDataDir);
      const ephemeraDir = path.join(
        testDir,
        '.rasen',
        'changes',
        'ephemera-first-change',
        'ephemera'
      );
      await fs.mkdir(ephemeraDir, { recursive: true });
      await fs.writeFile(
        path.join(ephemeraDir, 'auto-run.json'),
        JSON.stringify(
          { pipeline: 'bug-fix', stages: { propose: { status: 'done' }, implement: { status: 'done' } } },
          null,
          2
        )
      );
      // A legacy copy in the work directory must LOSE to the ephemera copy.
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'ephemera-first-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(normalizePaths(json.runStateDir)).toContain(
        '.rasen/changes/ephemera-first-change/ephemera'
      );
      expect(json.completed).toContain('implement');
    });

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
