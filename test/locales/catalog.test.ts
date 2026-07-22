import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_PIPELINE_IDS,
  PIPELINE_ERROR_KEYS,
  PIPELINE_MESSAGE_KEYS,
} from '../../src/commands/pipeline-messages.js';
import { getPackagePipelinesDir } from '../../src/core/pipeline-registry/index.js';
import { ALL_EXPERTS, ALL_WORKFLOWS } from '../../src/core/profiles.js';
import { formatLocaleMessage, getLocaleCatalog } from '../../src/locales/index.js';
import { ROOT_OPTION_DESCRIPTIONS } from '../../src/cli/help-localization.js';
import { INSTALLER_MESSAGE_KEYS } from '../../src/core/completions/factory.js';
import { CONFIG_DIAGNOSTIC_KEYS } from '../../src/core/config-diagnostics.js';
import { SUPPORTED_CLI_LOCALES } from '../../src/utils/locale.js';

function collectLeafStrings(
  value: unknown,
  prefix = '',
  result = new Map<string, string>()
): Map<string, string> {
  if (typeof value === 'string') {
    result.set(prefix, value);
    return result;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result;

  for (const [key, nested] of Object.entries(value)) {
    collectLeafStrings(nested, prefix ? `${prefix}.${key}` : key, result);
  }
  return result;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

describe('locale catalogs', () => {
  it('keeps every supported locale key and placeholder in sync with English', () => {
    const en = collectLeafStrings(getLocaleCatalog('en'));

    for (const locale of SUPPORTED_CLI_LOCALES) {
      const catalog = getLocaleCatalog(locale);
      const localized = collectLeafStrings(catalog);

      expect(catalog.locale).toBe(locale);
      expect([...localized.keys()].sort(), locale).toEqual([...en.keys()].sort());
      for (const [key, template] of en) {
        expect(placeholders(localized.get(key) ?? ''), `${locale}: ${key}`).toEqual(
          placeholders(template)
        );
      }
    }
  });

  it('defines a name and description for every workflow in every supported locale', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const workflows = getLocaleCatalog(locale).profile.prompt.workflows;
      expect(Object.keys(workflows).sort()).toEqual([...ALL_WORKFLOWS].sort());
      for (const workflow of ALL_WORKFLOWS) {
        expect(workflows[workflow].name).not.toBe('');
        expect(workflows[workflow].description).not.toBe('');
      }
    }
  });

  it('defines a name and description for every built-in expert in every supported locale (mirrors the workflow guard; ALL_WORKFLOWS/profile.prompt.workflows stay untouched — experts are a disjoint id space)', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const experts = getLocaleCatalog(locale).profile.prompt.experts as Record<
        string,
        { name: string; description: string }
      >;
      expect(Object.keys(experts).sort()).toEqual([...ALL_EXPERTS].sort());
      for (const expert of ALL_EXPERTS) {
        expect(experts[expert].name).not.toBe('');
        expect(experts[expert].description).not.toBe('');
      }
    }
  });

  it('defines metadata for every actual package pipeline in every supported locale', () => {
    const packageDir = getPackagePipelinesDir();
    const packageIds = fs
      .readdirSync(packageDir, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory()
          && fs.existsSync(path.join(packageDir, entry.name, 'pipeline.yaml'))
      )
      .map((entry) => entry.name)
      .sort();

    expect([...BUILT_IN_PIPELINE_IDS].sort()).toEqual(packageIds);
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const builtIns = getLocaleCatalog(locale).pipeline.builtIns;
      expect(Object.keys(builtIns).sort(), locale).toEqual(packageIds);
      for (const id of BUILT_IN_PIPELINE_IDS) {
        expect(builtIns[id].description, `${locale}: ${id}`).not.toBe('');
      }
    }
  });

  it('defines every stable pipeline message and error key in every supported locale', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const pipeline = getLocaleCatalog(locale).pipeline;
      expect(Object.keys(pipeline.messages).sort(), `${locale}: messages`).toEqual(
        [...PIPELINE_MESSAGE_KEYS].sort()
      );
      expect(Object.keys(pipeline.errors).sort(), `${locale}: errors`).toEqual(
        [...PIPELINE_ERROR_KEYS].sort()
      );
    }
  });

  it('formats known placeholders and preserves unknown placeholders', () => {
    expect(formatLocaleMessage('{name}: {count} / {missing}', { name: 'demo', count: 2 }))
      .toBe('demo: 2 / {missing}');
  });

  it('uses natural Simplified Chinese for human-facing profile and config labels', () => {
    const catalog = getLocaleCatalog('zh-cn');
    const profile = catalog.profile.ui;

    expect(formatLocaleMessage(profile.diffProfile, {
      before: 'full',
      after: 'core',
    })).toBe('配置方案：full -> core');
    expect(profile.diffWorkflowsAdded).toBe('工作流：已添加 {items}');
    expect(catalog.config.editor.source).toEqual({
      default: '默认',
      global: '全局',
      // `store` is the ratified store config scope (W1); the label stays the
      // bare proper noun "store" in every locale, matching how Store is left
      // untranslated elsewhere in the zh-cn catalog.
      store: 'store',
      project: '项目',
      'env-override': '环境变量覆盖',
    });

    const reviewText = [
      catalog.pipeline.messages.openFindings,
      catalog.profile.prompt.experts.cso.description,
      catalog.profile.prompt.experts.qa.description,
      catalog.profile.prompt.experts.review.description,
    ].join('\n');
    expect(reviewText).not.toContain('发现');
    expect(catalog.pipeline.messages.workerHandleWarning).toContain('智能体工作者');
    expect(catalog.pipeline.messages.workerHandleWarning).not.toContain('工作进程');
    expect(catalog.config.descriptions['telemetry.enabled']).toContain(
      '环境变量中的停用设置'
    );
  });

  it('defines Simplified Chinese Commander help labels', () => {
    expect(getLocaleCatalog('zh-cn').help).toEqual({
      titles: {
        'Usage:': '用法：',
        'Arguments:': '参数：',
        'Options:': '选项：',
        'Global Options:': '全局选项：',
        'Commands:': '命令：',
      },
      helpOption: '显示命令帮助',
      helpCommand: '显示指定命令的帮助',
    });
  });

  it('defines translations for every visible root option description', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const descriptions = getLocaleCatalog(locale).commandDescriptions as Record<string, string>;
      for (const description of ROOT_OPTION_DESCRIPTIONS) {
        expect(descriptions[description], `${locale}: ${description}`).toBeTruthy();
      }
    }
  });

  it('defines every structured installer message in every supported locale', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const messages = getLocaleCatalog(locale).completion.installerMessages;
      expect(Object.keys(messages).sort()).toEqual([...INSTALLER_MESSAGE_KEYS].sort());
    }
  });

  it('defines every structured config diagnostic in every supported locale', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const messages = getLocaleCatalog(locale).config.diagnostics;
      expect(Object.keys(messages).sort()).toEqual([...CONFIG_DIAGNOSTIC_KEYS].sort());
    }
  });
});
