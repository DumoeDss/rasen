import { describe, expect, it } from 'vitest';

import {
  formatPipelineError,
  formatPipelineErrorDetail,
  formatPipelineExecutionNotice,
  formatPipelineRootSelectionNotice,
  getPipelineMessages,
  pipelineMessageError,
} from '../../src/commands/pipeline-messages.js';
import type { CliLocale } from '../../src/utils/locale.js';

const CASES: Array<{
  locale: CliLocale;
  prompt: string;
  cancellation: string;
  collision: string;
  summary: string;
  rawDetail: string;
}> = [
  {
    locale: 'en',
    prompt: 'Replace /tmp/demo.rasenpkg?',
    cancellation: 'Export cancelled',
    collision: 'Pipeline "bug-fix" already exists',
    summary: 'Error: Pipeline "child" is still referenced',
    rawDetail: 'Pipeline "child" is still referenced',
  },
  {
    locale: 'ja',
    prompt: '/tmp/demo.rasenpkgを置き換えますか?',
    cancellation: 'exportをキャンセルしました',
    collision: 'パイプライン"bug-fix"は既に存在します',
    summary: 'パイプラインは既知の参照元からまだ参照されています。',
    rawDetail: '詳細: Pipeline "child" is still referenced',
  },
  {
    locale: 'zh-cn',
    prompt: '替换 /tmp/demo.rasenpkg？',
    cancellation: '导出已取消',
    collision: '流水线 "bug-fix" 已存在',
    summary: '该流水线仍被已知引用方引用。',
    rawDetail: '原始详情： Pipeline "child" is still referenced',
  },
];

describe('pipeline messages', () => {
  it.each(CASES)('formats stable prompt and result keys in $locale', (expected) => {
    const messages = getPipelineMessages(expected.locale);

    expect(
      messages.format('replaceDestination', { path: '/tmp/demo.rasenpkg' })
    ).toBe(expected.prompt);
    expect(messages.format('exportCancelled')).toBe(expected.cancellation);
    expect(messages.format('pipelineIdCollision', { name: 'bug-fix' })).toBe(
      expected.collision
    );
  });

  it.each([
    {
      locale: 'en',
      store: 'Using Rasen root: team-context (/tmp/store)',
      project: 'Using Rasen root: project app (/tmp/project)',
      stale: 'Warning: dropping unknown workflow id(s) from stored profile: ff',
    },
    {
      locale: 'ja',
      store: '使用するRasenルート: team-context (/tmp/store)',
      project: '使用するRasenルート: プロジェクト app (/tmp/project)',
      stale: '警告: 保存済みプロファイルから不明なワークフローIDを除外します: ff',
    },
    {
      locale: 'zh-cn',
      store: '使用 Rasen 根目录：team-context（/tmp/store）',
      project: '使用 Rasen 根目录：项目 app（/tmp/project）',
      stale: '警告：已从存储的配置方案中忽略未知工作流 ID：ff',
    },
  ] as const)('formats typed transitive notices in $locale', (expected) => {
    expect(formatPipelineRootSelectionNotice({
      kind: 'selected-root',
      path: '/tmp/store',
      storeId: 'team-context',
      storeType: 'store',
    }, expected.locale)).toBe(expected.store);
    expect(formatPipelineRootSelectionNotice({
      kind: 'selected-root',
      path: '/tmp/project',
      storeId: 'app',
      storeType: 'project',
    }, expected.locale)).toBe(expected.project);
    expect(formatPipelineExecutionNotice({
      kind: 'unknown-profile-workflows',
      workflowIds: ['ff'],
    }, expected.locale)).toBe(expected.stale);
  });

  it.each(CASES)('formats typed command errors in $locale', (expected) => {
    const error = pipelineMessageError(
      'pipelineIdCollision',
      { name: 'bug-fix' },
      'pipeline_id_collision'
    );

    expect(formatPipelineError(error, expected.locale)).toContain(expected.collision);
    expect(formatPipelineErrorDetail(error, 'en')).toBe(
      'Pipeline "bug-fix" already exists'
    );
  });

  it.each(CASES)(
    'localizes core error framing in $locale while retaining raw detail',
    (expected) => {
      const error = Object.assign(
        new Error('Pipeline "child" is still referenced'),
        { code: 'pipeline_in_use' }
      );
      const formatted = formatPipelineError(error, expected.locale);

      expect(formatted).toContain(expected.summary);
      expect(formatted).toContain(expected.rawDetail);
    }
  );

  it.each(['ja', 'zh-cn'] as const)(
    'localizes package descriptions but preserves project and user content in %s',
    (locale) => {
      const messages = getPipelineMessages(locale);
      const authored = '用户编写的原始说明';
      const packageDescription = messages.description(
        'bug-fix',
        'package',
        'Minimal bug-fix pipeline'
      );

      expect(packageDescription).not.toBe('Minimal bug-fix pipeline');
      expect(messages.description('bug-fix', 'project', authored)).toBe(authored);
      expect(messages.description('bug-fix', 'user', authored)).toBe(authored);
    }
  );
});
