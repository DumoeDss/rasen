import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';

const BUILTIN_NAMES = ['bug-fix', 'full-feature', 'small-feature'] as const;

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
      fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-pipeline-store-root-'))
    );
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      OPENSPEC_TELEMETRY: '0',
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
    fs.mkdirSync(path.join(rootDir, 'openspec', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'openspec', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  }

  async function registerStoreFixture(id: string): Promise<string> {
    const root = path.join(tempDir, 'stores', id);
    createOpenSpecRoot(root);
    await registerStore({ id, localPath: root, globalDataDir });
    return fs.realpathSync.native(root);
  }

  function writeStorePipeline(name: string, content: string): void {
    const dir = path.join(storeRoot, 'openspec', 'pipelines', name);
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
    const changeDir = path.join(storeRoot, 'openspec', 'changes', 'wip-change');
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
    expect(fs.existsSync(path.join(appRepo, 'openspec'))).toBe(false);
  });

  it('list and validate --pipelines report the same store pipeline set', async () => {
    writeStorePipeline(
      'store-only-pipeline',
      [
        'name: store-only-pipeline',
        'stages:',
        '  - id: propose',
        '    skill: openspec-propose',
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
      'openspec',
      'pipelines',
      'small-feature',
      'pipeline.yaml'
    );
    expect(fs.existsSync(overridePath)).toBe(true);
    expect(fs.existsSync(path.join(appRepo, 'openspec'))).toBe(false);

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
