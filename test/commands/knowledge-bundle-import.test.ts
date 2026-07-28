import * as path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bundleImportCommand,
  registerKnowledgeCommand,
} from '../../src/commands/knowledge.js';
import {
  KnowledgeBundleImportError,
  type ImportKnowledgeBundleOptions,
  type KnowledgeBundleImportResult,
} from '../../src/core/knowledge-bundle/import.js';
import { COMMAND_REGISTRY } from '../../src/core/completions/command-registry.js';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUNDLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUNDLE_PATH = path.resolve('transport', 'portable.bundle.json');

function result(
  overrides: Partial<KnowledgeBundleImportResult> = {}
): KnowledgeBundleImportResult {
  return {
    state: 'previewed',
    changed: false,
    refused: true,
    projectId: PROJECT_ID,
    projectRoot: path.resolve('project'),
    bundleId: BUNDLE_ID,
    bundlePath: BUNDLE_PATH,
    baseProjectCommit: 'c'.repeat(40),
    added: [
      {
        id: 'portable-added-routing',
        knowledgeKey: 'portable-added-routing-key',
        status: 'active',
        contentDigest: `sha256:${'a'.repeat(64)}`,
      },
    ],
    alreadyPresent: [
      {
        id: 'portable-present-routing',
        knowledgeKey: 'portable-present-routing-key',
        status: 'active',
        contentDigest: `sha256:${'b'.repeat(64)}`,
      },
    ],
    conflicts: [
      {
        id: 'portable-conflict-routing',
        knowledgeKey: 'portable-conflict-routing-key',
        reason: 'content-differs',
        bundle: {
          contentDigest: `sha256:${'c'.repeat(64)}`,
          status: 'active',
        },
        local: {
          kind: 'managed',
          contentDigest: `sha256:${'d'.repeat(64)}`,
          status: 'retired',
        },
      },
    ],
    warnings: [
      {
        code: 'base_project_commit_provenance',
        baseProjectCommit: 'c'.repeat(40),
      },
    ],
    ...overrides,
  };
}

describe('rasen knowledge bundle import command', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalExitCode: typeof process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalExitCode = process.exitCode;
    process.env.RASEN_LANG = 'en';
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function lastJson(): Record<string, unknown> | undefined {
    for (const [value] of [...logSpy.mock.calls].reverse()) {
      try {
        return JSON.parse(String(value)) as Record<string, unknown>;
      } catch {
        // Continue to the one JSON document.
      }
    }
    return undefined;
  }

  it('passes the positional path, project, and dry-run intent and emits stable JSON facts', async () => {
    const calls: ImportKnowledgeBundleOptions[] = [];
    await bundleImportCommand(
      {
        bundle: BUNDLE_PATH,
        project: PROJECT_ID,
        dryRun: true,
        json: true,
      },
      async (options) => {
        calls.push(options);
        return result();
      }
    );

    expect(calls).toEqual([
      {
        bundle: BUNDLE_PATH,
        project: PROJECT_ID,
        dryRun: true,
      },
    ]);
    expect(lastJson()).toMatchObject({
      ok: true,
      state: 'previewed',
      refused: true,
      changed: false,
      project: PROJECT_ID,
      bundle: {
        id: BUNDLE_ID,
        path: BUNDLE_PATH,
        baseProjectCommit: 'c'.repeat(40),
      },
      added: [{ id: 'portable-added-routing' }],
      alreadyPresent: [{ id: 'portable-present-routing' }],
      conflicts: [
        {
          id: 'portable-conflict-routing',
          reason: 'content-differs',
          message: expect.stringContaining('portable-conflict-routing'),
        },
      ],
      warnings: [
        {
          code: 'base_project_commit_provenance',
          message: expect.stringContaining('provenance only'),
        },
      ],
    });
  });

  it.each([
    [
      'en',
      'Previewed bundle',
      'conflict',
      [
        'content differs',
        'lifecycle differs',
        'target is occupied or unreadable',
        'active',
        'retired',
      ],
    ],
    [
      'zh-cn',
      '已预览',
      '冲突',
      ['内容不同', '生命周期状态不同', '目标已占用或无法读取', '启用', '已停用'],
    ],
    [
      'ja',
      'プレビュー',
      '競合',
      [
        '内容が異なる',
        'ライフサイクル状態が異なる',
        '対象が占有済みまたは読取不能',
        '有効',
        '廃止済み',
      ],
    ],
  ])(
    'localizes complete human preview facts without English fallback in %s',
    async (locale, heading, conflictWord, localizedClassifications) => {
      process.env.RASEN_LANG = locale;
      await bundleImportCommand(
        {
          bundle: BUNDLE_PATH,
          project: PROJECT_ID,
          dryRun: true,
        },
        async () =>
          result({
            conflicts: [
              {
                id: 'portable-content-conflict',
                knowledgeKey: 'portable-content-conflict-key',
                reason: 'content-differs',
                bundle: {
                  contentDigest: `sha256:${'c'.repeat(64)}`,
                  status: 'active',
                },
                local: {
                  kind: 'managed',
                  contentDigest: `sha256:${'d'.repeat(64)}`,
                  status: 'retired',
                },
              },
              {
                id: 'portable-lifecycle-conflict',
                knowledgeKey: 'portable-lifecycle-conflict-key',
                reason: 'lifecycle-differs',
                bundle: {
                  contentDigest: `sha256:${'e'.repeat(64)}`,
                  status: 'retired',
                },
                local: {
                  kind: 'managed',
                  contentDigest: `sha256:${'e'.repeat(64)}`,
                  status: 'active',
                },
              },
              {
                id: 'portable-occupied-conflict',
                knowledgeKey: 'portable-occupied-conflict-key',
                reason: 'target-occupied',
                bundle: {
                  contentDigest: `sha256:${'f'.repeat(64)}`,
                  status: 'active',
                },
                local: {
                  kind: 'occupied',
                  description: 'unmanaged target reason in English',
                },
              },
            ],
          })
      );
      const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n');

      expect(output).toContain(heading);
      expect(output).toContain(conflictWord);
      expect(output).toContain(PROJECT_ID);
      expect(output).toContain(BUNDLE_ID);
      expect(output).toContain(BUNDLE_PATH);
      expect(output).toContain('portable-added-routing');
      expect(output).toContain('portable-present-routing');
      expect(output).toContain('portable-content-conflict');
      expect(output).toContain('portable-lifecycle-conflict');
      expect(output).toContain('portable-occupied-conflict');
      for (const localized of localizedClassifications) {
        expect(output).toContain(localized);
      }
      if (locale !== 'en') {
        for (const raw of [
          'content-differs',
          'lifecycle-differs',
          'target-occupied',
          'active',
          'retired',
          'unmanaged target reason in English',
        ]) {
          expect(output).not.toContain(raw);
        }
      }
      expect(process.exitCode).toBeUndefined();
    }
  );

  it('reports every apply conflict in JSON and human output with changed=false', async () => {
    const plan = result();
    const importer = async (): Promise<KnowledgeBundleImportResult> => {
      throw new KnowledgeBundleImportError(
        'knowledge_bundle_import_conflict',
        'conflict',
        {
          details: { conflictCount: '1' },
          issues: [
            { recordId: 'portable-conflict-routing', reason: 'content-differs' },
          ],
          plan,
        }
      );
    };

    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID, json: true },
      importer
    );
    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_bundle_import_conflict',
        changed: false,
        plan: {
          conflicts: [{ id: 'portable-conflict-routing' }],
        },
        repair: expect.stringContaining('Resolve every named local conflict'),
      },
    });

    logSpy.mockClear();
    errorSpy.mockClear();
    process.exitCode = undefined;
    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID },
      importer
    );
    const human = errorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(human).toContain('portable-conflict-routing');
    expect(human).toContain('nothing was imported');
    expect(human).toContain('Resolve every named local conflict');
    expect(process.exitCode).toBe(1);
  });

  it('reports rollback uncertainty and retained transaction paths in JSON and human output', async () => {
    const retainedPath = path.resolve(
      'machine-data',
      'project-knowledge',
      PROJECT_ID,
      'learned-skills',
      'portable-retained-routing'
    );
    const importer = async (): Promise<KnowledgeBundleImportResult> => {
      throw new KnowledgeBundleImportError(
        'knowledge_bundle_import_rollback_failed',
        'rollback could not be verified',
        {
          details: {
            reason: 'injected rollback ambiguity',
            rollback: `${retainedPath}: contents changed; retained`,
          },
          changed: 'unknown',
          retainedPaths: [retainedPath],
        }
      );
    };

    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID, json: true },
      importer
    );
    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_bundle_import_rollback_failed',
        changed: 'unknown',
        retainedPaths: [retainedPath],
      },
    });

    logSpy.mockClear();
    errorSpy.mockClear();
    process.exitCode = undefined;
    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID },
      importer
    );
    const human = errorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(human).toContain('cleanup could not be verified');
    expect(human).toContain('Change status is unknown');
    expect(human).toContain('retained transaction path');
    expect(human).toContain(retainedPath);
    expect(process.exitCode).toBe(1);
  });

  it('preserves the exact lock path in JSON and localized human failure output', async () => {
    const lockPath = path.resolve(
      'machine-data',
      'learned-skill-locks',
      'project.lock'
    );
    const importer = async (): Promise<KnowledgeBundleImportResult> => {
      throw new KnowledgeBundleImportError(
        'knowledge_bundle_import_lock_failed',
        'lock unavailable',
        {
          details: {
            reason: 'timeout',
            lockPath,
          },
        }
      );
    };

    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID, json: true },
      importer
    );
    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_bundle_import_lock_failed',
        changed: false,
        lockPath,
      },
    });

    logSpy.mockClear();
    errorSpy.mockClear();
    process.exitCode = undefined;
    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID },
      importer
    );
    const human = errorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(human).toContain('lock path');
    expect(human).toContain(lockPath);
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [
      'zh-cn',
      'knowledge_bundle_import_catalog_unavailable',
      'unregistered_project',
      '该项目尚未在本机注册',
      '修复或在本机注册目标项目',
    ],
    [
      'zh-cn',
      'knowledge_bundle_import_catalog_unavailable',
      'typed_owner_mismatch',
      '解析出的所有者与项目永久身份不一致',
      '修复或在本机注册目标项目',
    ],
    [
      'zh-cn',
      'knowledge_bundle_import_catalog_unavailable',
      'knowledge_owner_scope_mismatch',
      '解析出的所有者具有错误的知识范围',
      '修复或在本机注册目标项目',
    ],
    [
      'zh-cn',
      'knowledge_bundle_import_lock_failed',
      'timeout',
      '另一个操作持续占用目录',
      '请稍后重试',
    ],
    [
      'zh-cn',
      'knowledge_bundle_import_lock_failed',
      'create-failed',
      '无法创建锁文件',
      '检查已点名锁所在目录的权限',
    ],
    [
      'ja',
      'knowledge_bundle_import_catalog_unavailable',
      'unregistered_project',
      'プロジェクトがこのマシンに登録されていません',
      '対象プロジェクトを修復またはこのマシンに登録',
    ],
    [
      'ja',
      'knowledge_bundle_import_catalog_unavailable',
      'typed_owner_mismatch',
      '解決された所有者がプロジェクトの恒久 ID と一致しません',
      '対象プロジェクトを修復またはこのマシンに登録',
    ],
    [
      'ja',
      'knowledge_bundle_import_catalog_unavailable',
      'knowledge_owner_scope_mismatch',
      '解決された所有者の知識スコープが正しくありません',
      '対象プロジェクトを修復またはこのマシンに登録',
    ],
    [
      'ja',
      'knowledge_bundle_import_lock_failed',
      'timeout',
      '別の操作がカタログを使用し続けたため',
      'しばらくして再試行',
    ],
    [
      'ja',
      'knowledge_bundle_import_lock_failed',
      'create-failed',
      'ロックファイルを作成できませんでした',
      'ロックを含むディレクトリの権限を確認',
    ],
  ])(
    '%s localizes %s reason %s without leaking the stable code',
    async (locale, code, reason, classification, repairFragment) => {
      process.env.RASEN_LANG = locale;
      const lockPath = path.resolve(
        'machine-data',
        'learned-skill-locks',
        'project.lock'
      );
      const importer = async (): Promise<KnowledgeBundleImportResult> => {
        throw new KnowledgeBundleImportError(
          code as
            | 'knowledge_bundle_import_catalog_unavailable'
            | 'knowledge_bundle_import_lock_failed',
          'stable refusal',
          {
            details: {
              reason,
              ...(code === 'knowledge_bundle_import_lock_failed'
                ? { lockPath }
                : { diagnostic: 'dynamic catalog diagnostic data' }),
            },
          }
        );
      };

      await bundleImportCommand(
        { bundle: BUNDLE_PATH, project: PROJECT_ID, json: true },
        importer
      );
      expect(lastJson()).toMatchObject({
        ok: false,
        error: {
          code,
          reason,
          ...(code === 'knowledge_bundle_import_lock_failed'
            ? { lockPath }
            : { diagnostic: 'dynamic catalog diagnostic data' }),
        },
      });

      logSpy.mockClear();
      errorSpy.mockClear();
      process.exitCode = undefined;
      await bundleImportCommand(
        { bundle: BUNDLE_PATH, project: PROJECT_ID },
        importer
      );
      const human = errorSpy.mock.calls.map(([value]) => String(value)).join('\n');
      expect(human).toContain(classification);
      expect(human).toContain(repairFragment);
      if (code === 'knowledge_bundle_import_lock_failed') {
        expect(human).toContain(lockPath);
      }
      expect(human).not.toContain(reason);
      expect(process.exitCode).toBe(1);
    }
  );

  it.each([
    [
      'en',
      'knowledge_bundle_import_project_unavailable',
      'project_resolver_threw',
      'the machine project registry or project home could not be read',
      'Repair the machine project registry or project home',
    ],
    [
      'en',
      'knowledge_bundle_import_catalog_unavailable',
      'resolver_threw',
      'catalog resolution threw while reading machine project state',
      'Repair or register the target project',
    ],
    [
      'zh-cn',
      'knowledge_bundle_import_project_unavailable',
      'project_resolver_threw',
      '无法读取本机项目注册表或项目主目录',
      '修复本机项目注册表或项目主目录',
    ],
    [
      'zh-cn',
      'knowledge_bundle_import_catalog_unavailable',
      'resolver_threw',
      '读取本机项目状态时，目录解析器发生异常',
      '修复或在本机注册目标项目',
    ],
    [
      'ja',
      'knowledge_bundle_import_project_unavailable',
      'project_resolver_threw',
      'マシンのプロジェクト登録情報またはプロジェクトホームを読み取れませんでした',
      'マシンのプロジェクト登録情報またはプロジェクトホームを修復',
    ],
    [
      'ja',
      'knowledge_bundle_import_catalog_unavailable',
      'resolver_threw',
      'マシンのプロジェクト状態の読み取り中にカタログ解決で例外が発生しました',
      '対象プロジェクトを修復またはこのマシンに登録',
    ],
  ])(
    '%s renders a stable localized composed-reader refusal for %s',
    async (locale, code, reason, classification, repairFragment) => {
      process.env.RASEN_LANG = locale;
      const diagnostic = 'dynamic reader diagnostic data';
      const importer = async (): Promise<KnowledgeBundleImportResult> => {
        throw new KnowledgeBundleImportError(
          code as
            | 'knowledge_bundle_import_project_unavailable'
            | 'knowledge_bundle_import_catalog_unavailable',
          diagnostic,
          {
            details: {
              reason,
              diagnostic,
              repair: 'core repair data',
            },
            changed: false,
          }
        );
      };

      await bundleImportCommand(
        { bundle: BUNDLE_PATH, project: PROJECT_ID, json: true },
        importer
      );
      expect(lastJson()).toMatchObject({
        ok: false,
        error: {
          code,
          changed: false,
          reason,
          diagnostic,
          repair: expect.stringContaining(repairFragment),
        },
      });

      logSpy.mockClear();
      errorSpy.mockClear();
      process.exitCode = undefined;
      await bundleImportCommand(
        { bundle: BUNDLE_PATH, project: PROJECT_ID },
        importer
      );
      const human = errorSpy.mock.calls.map(([value]) => String(value)).join('\n');
      expect(human).toContain(classification);
      expect(human).toContain(repairFragment);
      expect(human).not.toContain(reason);
      expect(process.exitCode).toBe(1);
    }
  );

  it('reports a truly unknown failure conservatively without claiming a transaction ran', async () => {
    const importer = async (): Promise<KnowledgeBundleImportResult> => {
      throw new Error('unexpected composed seam escape');
    };

    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID, json: true },
      importer
    );
    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_bundle_import_failed',
        changed: 'unknown',
        reason: 'unclassified_failure',
        diagnostic: 'unexpected composed seam escape',
        repair: expect.stringContaining('Inspect the diagnostic'),
      },
    });
    expect(JSON.stringify(lastJson())).not.toContain('add-only import transaction');

    logSpy.mockClear();
    errorSpy.mockClear();
    process.exitCode = undefined;
    await bundleImportCommand(
      { bundle: BUNDLE_PATH, project: PROJECT_ID },
      importer
    );
    const human = errorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(human).toContain('unclassified failure');
    expect(human).toContain('could not be determined whether anything changed');
    expect(human).toContain('Inspect the diagnostic');
    expect(human).not.toContain('add-only import transaction');
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['missing bundle', ['bundle', 'import']],
    ['missing project', ['bundle', 'import', BUNDLE_PATH]],
  ])('Commander rejects %s before core work', async (_label, args) => {
    const program = new Command();
    program.exitOverride();
    registerKnowledgeCommand(program);
    await expect(
      program.parseAsync(['node', 'rasen', 'knowledge', ...args])
    ).rejects.toBeDefined();
  });

  it('registers the import positional and only its three supported flags', () => {
    const knowledge = COMMAND_REGISTRY.find((entry) => entry.name === 'knowledge');
    const bundle = knowledge?.subcommands?.find((entry) => entry.name === 'bundle');
    const imported = bundle?.subcommands?.find((entry) => entry.name === 'import');

    expect(imported).toMatchObject({
      acceptsPositional: true,
      positionalType: 'path',
      positionals: [{ name: 'bundle', type: 'path' }],
    });
    expect(imported?.flags.map((flag) => flag.name)).toEqual([
      'project',
      'dry-run',
      'json',
    ]);
  });
});
