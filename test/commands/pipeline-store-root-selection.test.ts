import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';

const BUILTIN_NAMES = [
  'auto-decompose',
  'bug-fix',
  'full-feature',
  'goal-loop-evaluate',
  'goal-loop-measure',
  'goal-loop-research',
  'small-feature',
] as const;

// The pipeline command group resolves its root through the same store-selection
// layer as `validate` — `--store <id>` operates on the registered store's root,
// never the cwd. XDG_* is redirected at a per-test temp dir so the real global
// store registry / config at %APPDATA%\openspec is never touched (guards the
// recorded config-pollution incident).
describe('pipeline command store root selection', () => {
  let tempDir: string;
  let appRepo: string;
  let storeRoot: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-store-root-'))
    );
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });
    appRepo = path.join(tempDir, 'app-repo');
    fs.mkdirSync(appRepo, { recursive: true });
    storeRoot = await registerStoreFixture('team-context');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createOpenSpecRoot(rootDir: string): void {
    fs.mkdirSync(path.join(rootDir, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  }

  async function registerStoreFixture(id: string): Promise<string> {
    const root = path.join(tempDir, 'stores', id);
    createOpenSpecRoot(root);
    await registerStore({ id, localPath: root, globalDataDir });
    return fs.realpathSync.native(root);
  }

  function writeStorePipeline(name: string, content: string): void {
    const dir = path.join(storeRoot, 'rasen', 'pipelines', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pipeline.yaml'), content, 'utf-8');
  }

  function parseJson(result: RunCLIResult): any {
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(
        `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
      );
    }
  }

  it('resume reads run-state from the store change directory (hasRunState:true)', async () => {
    // A change with recorded run-state lives in the STORE, not the cwd.
    const changeDir = path.join(storeRoot, 'rasen', 'changes', 'wip-change');
    fs.mkdirSync(changeDir, { recursive: true });
    // bug-fix build order: propose -> apply -> verify -> ship -> archive
    fs.writeFileSync(
      path.join(changeDir, 'auto-run.json'),
      JSON.stringify({ pipeline: 'bug-fix', completed: ['propose', 'apply'] }, null, 2),
      'utf-8'
    );

    const result = await runCLI(
      ['pipeline', 'resume', 'wip-change', '--store', 'team-context', '--json'],
      { cwd: appRepo, env }
    );
    expect(result.exitCode).toBe(0);
    const json = parseJson(result);
    expect(json.change).toBe('wip-change');
    expect(json.hasRunState).toBe(true);
    expect(json.pipeline).toBe('bug-fix');
    expect(json.completed).toEqual(['propose', 'apply']);
    expect(json.next).toBe('verify');
    expect(json.remaining).toEqual(['verify', 'ship', 'archive']);

    // No local openspec/ was scaffolded in the unrelated cwd.
    expect(fs.existsSync(path.join(appRepo, 'rasen'))).toBe(false);
  });

  it('list and validate --pipelines report the same store pipeline set', async () => {
    writeStorePipeline(
      'store-only-pipeline',
      [
        'name: store-only-pipeline',
        'stages:',
        '  - id: propose',
        '    skill: rasen-propose',
        '    role: planner',
      ].join('\n')
    );

    const listResult = await runCLI(
      ['pipeline', 'list', '--store', 'team-context', '--json'],
      { cwd: appRepo, env }
    );
    expect(listResult.exitCode).toBe(0);
    const listNames = new Set<string>(
      parseJson(listResult).pipelines.map((p: any) => p.name)
    );
    expect(listNames.has('store-only-pipeline')).toBe(true);
    for (const name of BUILTIN_NAMES) {
      expect(listNames.has(name)).toBe(true);
    }

    const validateResult = await runCLI(
      ['validate', '--pipelines', '--store', 'team-context', '--json'],
      { cwd: appRepo, env }
    );
    expect(validateResult.exitCode).toBe(0);
    const validateNames = new Set<string>(
      parseJson(validateResult).items
        .filter((i: any) => i.type === 'pipeline')
        .map((i: any) => i.id)
    );

    expect(listNames).toEqual(validateNames);
  });

  it.each([
    {
      locale: 'en',
      heading: 'Available pipelines:',
      builtIn: 'Minimal bug-fix pipeline',
      banner: 'Using Rasen root: team-context',
    },
    {
      locale: 'ja',
      heading: '利用可能なパイプライン:',
      builtIn: '最小限のバグ修正パイプライン',
      banner: '使用するRasenルート: team-context',
    },
    {
      locale: 'zh-cn',
      heading: '可用流水线：',
      builtIn: '最简缺陷修复流水线',
      banner: '使用 Rasen 根目录：team-context',
    },
  ] as const)(
    'keeps --store root selection while localizing human output in $locale',
    async ({ locale, heading, builtIn, banner }) => {
      writeStorePipeline(
        'store-authored',
        [
          'name: store-authored',
          'description: Store-authored description',
          'stages:',
          '  - id: propose',
          '    skill: rasen-propose',
          '    role: planner',
        ].join('\n')
      );

      const result = await runCLI(
        ['pipeline', 'list', '--store', 'team-context'],
        { cwd: appRepo, env: { ...env, RASEN_LANG: locale } }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(heading);
      expect(result.stdout).toContain(builtIn);
      expect(result.stdout).toContain('Store-authored description');
      expect(result.stdout).toContain('[project]');
      expect(result.stderr).toContain(banner);
      expect(result.stderr).toContain(storeRoot);
      if (locale !== 'en') {
        expect(result.stderr).not.toContain('Using Rasen root');
      }
      expect(fs.existsSync(path.join(appRepo, 'rasen'))).toBe(false);
    },
    30_000
  );

  it.each([
    {
      locale: 'ja',
      banner: '使用するRasenルート: プロジェクト linked-project',
    },
    {
      locale: 'zh-cn',
      banner: '使用 Rasen 根目录：项目 linked-project',
    },
  ] as const)(
    'localizes --project root selection in $locale',
    async ({ locale, banner }) => {
      const projectRoot = path.join(tempDir, `projects-${locale}`, 'linked-project');
      createOpenSpecRoot(projectRoot);
      const added = await runCLI(
        [
          'store',
          'add-project',
          projectRoot,
          '--to',
          'team-context',
          '--as',
          'linked-project',
          '--json',
        ],
        { cwd: appRepo, env }
      );
      expect(added.exitCode).toBe(0);

      const result = await runCLI(
        ['pipeline', 'list', '--project', 'linked-project'],
        { cwd: appRepo, env: { ...env, RASEN_LANG: locale } }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(banner);
      expect(result.stderr).toContain(fs.realpathSync.native(projectRoot));
      expect(result.stderr).not.toContain('Using Rasen root');
    },
    30_000
  );

  it.each([
    {
      locale: 'ja',
      warning: 'でstore \'team-context\'が指定されていますが、このディレクトリは実体のあるRasenルートのため、この指定は無視されます。',
    },
    {
      locale: 'zh-cn',
      warning: " 声明了 Store 'team-context'，但此目录本身就是 Rasen 根目录；该声明已被忽略。",
    },
  ] as const)(
    'localizes ignored store pointers and keeps JSON silent in $locale',
    async ({ locale, warning }) => {
      createOpenSpecRoot(appRepo);
      const configPath = path.join(appRepo, 'rasen', 'config.yaml');
      fs.writeFileSync(
        configPath,
        'schema: spec-driven\nstore: team-context\n',
        'utf-8'
      );
      const localizedEnv = { ...env, RASEN_LANG: locale };

      const human = await runCLI(['pipeline', 'list'], {
        cwd: appRepo,
        env: localizedEnv,
      });
      expect(human.exitCode).toBe(0);
      expect(human.stderr).toContain(`${configPath}${warning}`);
      expect(human.stderr).not.toContain('the declaration is ignored');

      const json = await runCLI(['pipeline', 'list', '--json'], {
        cwd: appRepo,
        env: localizedEnv,
      });
      expect(json.exitCode).toBe(0);
      expect(json.stderr).toBe('');
      expect(parseJson(json).pipelines).toBeDefined();
    },
    30_000
  );

  it('agents writes the project override under the store root, where validate sees it', async () => {
    const result = await runCLI(
      ['pipeline', 'agents', 'small-feature', '--planner', 'codex', '--store', 'team-context', '--json'],
      { cwd: appRepo, env }
    );
    expect(result.exitCode).toBe(0);
    const json = parseJson(result);
    expect(json.effectiveRoles.planner).toBe('codex');

    // The override landed under the STORE root, not the cwd.
    const overridePath = path.join(
      storeRoot,
      'rasen',
      'pipelines',
      'small-feature',
      'pipeline.yaml'
    );
    expect(fs.existsSync(overridePath)).toBe(true);
    expect(fs.existsSync(path.join(appRepo, 'rasen'))).toBe(false);

    // A root-aware validate of the store sees the override as a valid pipeline.
    const validate = await runCLI(
      ['validate', '--pipelines', '--store', 'team-context', '--json'],
      { cwd: appRepo, env }
    );
    expect(validate.exitCode).toBe(0);
    const validateJson = parseJson(validate);
    const smallFeature = validateJson.items.find((i: any) => i.id === 'small-feature');
    expect(smallFeature).toBeDefined();
    expect(smallFeature.valid).toBe(true);
  });
});
