import { describe, expect, it } from 'vitest';

import { ALL_EXPERTS, ALL_WORKFLOWS } from '../../src/core/profiles.js';
import { formatLocaleMessage, getLocaleCatalog } from '../../src/locales/index.js';
import { ROOT_OPTION_DESCRIPTIONS } from '../../src/cli/help-localization.js';
import { INSTALLER_MESSAGE_KEYS } from '../../src/core/completions/factory.js';
import { CONFIG_DIAGNOSTIC_KEYS } from '../../src/core/config-diagnostics.js';

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
  it('keeps English and Japanese keys and placeholders in sync', () => {
    const en = collectLeafStrings(getLocaleCatalog('en'));
    const ja = collectLeafStrings(getLocaleCatalog('ja'));

    expect([...ja.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, template] of en) {
      expect(placeholders(ja.get(key) ?? ''), key).toEqual(placeholders(template));
    }
  });

  it('defines a name and description for every workflow in both languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      const workflows = getLocaleCatalog(locale).profile.prompt.workflows;
      expect(Object.keys(workflows).sort()).toEqual([...ALL_WORKFLOWS].sort());
      for (const workflow of ALL_WORKFLOWS) {
        expect(workflows[workflow].name).not.toBe('');
        expect(workflows[workflow].description).not.toBe('');
      }
    }
  });

  it('defines a name and description for every built-in expert in both languages (mirrors the workflow guard; ALL_WORKFLOWS/profile.prompt.workflows stay untouched — experts are a disjoint id space)', () => {
    for (const locale of ['en', 'ja'] as const) {
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

  it('formats known placeholders and preserves unknown placeholders', () => {
    expect(formatLocaleMessage('{name}: {count} / {missing}', { name: 'demo', count: 2 }))
      .toBe('demo: 2 / {missing}');
  });

  it('defines translations for every visible root option description', () => {
    for (const locale of ['en', 'ja'] as const) {
      const descriptions = getLocaleCatalog(locale).commandDescriptions as Record<string, string>;
      for (const description of ROOT_OPTION_DESCRIPTIONS) {
        expect(descriptions[description], `${locale}: ${description}`).toBeTruthy();
      }
    }
  });

  it('defines every structured installer message in both languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      const messages = getLocaleCatalog(locale).completion.installerMessages;
      expect(Object.keys(messages).sort()).toEqual([...INSTALLER_MESSAGE_KEYS].sort());
    }
  });

  it('defines every structured config diagnostic in both languages', () => {
    for (const locale of ['en', 'ja'] as const) {
      const messages = getLocaleCatalog(locale).config.diagnostics;
      expect(Object.keys(messages).sort()).toEqual([...CONFIG_DIAGNOSTIC_KEYS].sort());
    }
  });
});
