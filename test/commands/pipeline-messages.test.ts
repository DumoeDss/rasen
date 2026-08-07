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

  // Exact strings, not `toContain('omp')`: the English copy already contains
  // "c-omp-atibility", so a substring check passes even when `{host}` is
  // never interpolated. `test/locales/catalog.test.ts` already guards key and
  // placeholder parity, so the value this test alone can defend is the COPY.
  //
  // The old copy made TWO claims and only one became false. Forcing the
  // override no longer "lifts the context-probe refusal" — Oh My Pi is the only
  // host that can trigger this warning and it now has its own reader, so there
  // is no refusal to lift. But the override DOES still redirect
  // `agent context --latest` to the forced runtime's store, and that half is now
  // MORE consequential: it is the one thing that undoes the probe capability,
  // silently substituting another conversation's occupancy. So the negative
  // assertion below targets the refusal claim specifically rather than the word
  // "context", which would forbid the true caveat as well.
  it.each([
    {
      locale: 'en',
      expected:
        'Warning: LEAD host runtime omp has no dispatch adapter; using the legacy compatibility route. ' +
        'Set RASEN_AGENT_RUNTIME=claude|codex for deterministic dispatch — note that the same override ' +
        'also redirects `rasen agent context --latest` to that runtime\'s session store, so this host\'s ' +
        'own occupancy is no longer what gets reported.',
    },
    {
      locale: 'ja',
      expected:
        '警告: LEADのホストruntime omp にはdispatchアダプタがないため、legacy互換ルートを使用します。' +
        '決定的なdispatchには RASEN_AGENT_RUNTIME=claude|codex を設定してください。' +
        'ただしこの override は `rasen agent context --latest` の参照先セッションストアも指定した runtime に' +
        '切り替えるため、以降はこのホスト自身の占有率が報告されなくなります。',
    },
    {
      locale: 'zh-cn',
      expected:
        '警告：LEAD 工具宿主 omp 没有派发适配器，正在使用旧版兼容路由。' +
        '设置 RASEN_AGENT_RUNTIME=claude|codex 可获得确定的派发行为。' +
        '但该 override 同时会把 `rasen agent context --latest` 的读取目标切换到该 runtime 的会话存储，' +
        '此后报告的将不再是本宿主自己的占用率。',
    },
  ] as const)('names the host and keeps only the still-true probe caveat in $locale', (row) => {
    const rendered = formatPipelineExecutionNotice(
      {
        kind: 'host-runtime-without-dispatch-adapter',
        host: 'omp',
        override: 'RASEN_AGENT_RUNTIME',
      },
      row.locale
    );
    expect(rendered).toBe(row.expected);
    expect(rendered, row.locale).not.toMatch(/\{\w+\}/);
    // The claim that became false: that the override lifts a probe REFUSAL.
    expect(rendered, row.locale).not.toMatch(/refusal|拒否|拒绝/i);
  });

  it('formats the inheriting-store-config and unavailable-store notices', () => {
    const byAlias = formatPipelineRootSelectionNotice(
      {
        kind: 'inheriting-store-config',
        filePath: '/repo/rasen/config.yaml',
        storeId: 'team-store',
        resolvedBy: 'alias',
      },
      'en'
    );
    expect(byAlias).toContain("declares store 'team-store'");
    expect(byAlias).toContain('configuration inherits from that store');
    expect(byAlias).toContain('display name');

    // The notice states WHICH of the identity or the name resolved it.
    const byIdentity = formatPipelineRootSelectionNotice(
      {
        kind: 'inheriting-store-config',
        filePath: '/repo/rasen/config.yaml',
        storeId: 'team-store',
        resolvedBy: 'uid',
      },
      'en'
    );
    expect(byIdentity).toContain('permanent identity');

    const unavailable = formatPipelineRootSelectionNotice(
      {
        kind: 'unavailable-store-declaration',
        filePath: '/repo/rasen/config.yaml',
        storeId: 'team-store',
        reason: 'not-registered',
        repair: 'rasen store register <path>',
      },
      'en'
    );
    expect(unavailable).toContain('cannot be used on this machine');
    expect(unavailable).toContain('it is not registered on this machine');
    expect(unavailable).toContain('rasen store register');

    // zh-cn renders every one without falling back to English.
    const inheritingZh = formatPipelineRootSelectionNotice(
      {
        kind: 'inheriting-store-config',
        filePath: '/repo/rasen/config.yaml',
        storeId: 'team-store',
        resolvedBy: 'alias',
      },
      'zh-cn'
    );
    expect(inheritingZh).toContain('配置从该 Store 继承');

    const unavailableZh = formatPipelineRootSelectionNotice(
      {
        kind: 'unavailable-store-declaration',
        filePath: '/repo/rasen/config.yaml',
        storeId: 'team-store',
        reason: 'alias-ambiguous',
        repair: 'rasen store upgrade-identity team-store --apply',
      },
      'zh-cn'
    );
    expect(unavailableZh).toContain('该名称匹配到多个已注册的 Store');
    expect(unavailableZh).not.toContain('matches more than one');
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
