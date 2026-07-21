import { describe, expect, it } from 'vitest';

import {
  parseCliLocale,
  resolveCliLocale,
  SUPPORTED_CLI_LOCALES,
} from '../../src/utils/locale.js';

describe('SUPPORTED_CLI_LOCALES', () => {
  it('lists every canonical persisted CLI locale', () => {
    expect(SUPPORTED_CLI_LOCALES).toEqual(['en', 'ja', 'zh-cn']);
  });
});

describe('parseCliLocale', () => {
  it.each([
    'zh',
    'zh-cn',
    'zh-CN',
    'zh_CN.UTF-8',
    'zh-SG',
    'zh-Hans',
    'zh-Hans-TW',
    '  ZH_hAnS_sg.UTF-8@calendar  ',
  ])('normalizes Simplified Chinese alias %j to zh-cn', (value) => {
    expect(parseCliLocale(value)).toBe('zh-cn');
  });

  it.each([
    'zh-TW',
    'zh-HK',
    'zh-MO',
    'zh-Hant',
    'zh-Hant-CN',
    'zh-CN-Hant',
    'zh-Latn-CN',
    'zh-US',
    'zh-419',
  ])('rejects Traditional Chinese or unknown-region locale %j', (value) => {
    expect(parseCliLocale(value)).toBeUndefined();
  });

  it('ignores script-like subtags after extension and private-use singletons', () => {
    expect(parseCliLocale('zh-TW-x-hans')).toBeUndefined();
    expect(parseCliLocale('zh-CN-x-hant')).toBe('zh-cn');
    expect(parseCliLocale('zh-CN-u-ca-hebr')).toBe('zh-cn');
  });

  it('preserves English and Japanese locale normalization', () => {
    expect(parseCliLocale('en_US.UTF-8@calendar')).toBe('en');
    expect(parseCliLocale('ja_JP.UTF-8@calendar')).toBe('ja');
  });
});

describe('resolveCliLocale', () => {
  it('preserves Japanese RASEN_LANG override precedence', () => {
    expect(
      resolveCliLocale({
        language: 'en',
        env: { RASEN_LANG: 'ja', LC_ALL: 'en_US.UTF-8' },
        platform: 'linux',
        systemLocale: 'en-US',
      })
    ).toBe('ja');
  });

  it('prefers and normalizes the Rasen override over standard locale variables', () => {
    expect(
      resolveCliLocale({
        language: 'en',
        env: { RASEN_LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US.UTF-8' },
        platform: 'linux',
        systemLocale: 'en-US',
      })
    ).toBe('zh-cn');
  });

  it('ignores an invalid Rasen override and continues with the persisted language', () => {
    expect(
      resolveCliLocale({
        language: 'ja',
        env: { RASEN_LANG: 'zh-TW', LC_ALL: 'zh_CN.UTF-8' },
        platform: 'linux',
        systemLocale: 'zh-Hans',
      })
    ).toBe('ja');
  });

  it('preserves an explicit saved English language before automatic detection', () => {
    expect(
      resolveCliLocale({
        language: 'en',
        env: { LANG: 'ja_JP.UTF-8' },
        platform: 'linux',
        systemLocale: 'ja-JP',
      })
    ).toBe('en');
  });

  it('uses an explicit saved zh-cn language before automatic detection', () => {
    expect(
      resolveCliLocale({
        language: 'zh-cn',
        env: { LANG: 'ja_JP.UTF-8' },
        platform: 'linux',
        systemLocale: 'ja-JP',
      })
    ).toBe('zh-cn');
  });

  it('recognizes Japanese LANG variants on Unix in auto mode', () => {
    expect(
      resolveCliLocale({
        language: 'auto',
        env: { LANG: 'ja_JP.UTF-8' },
        platform: 'darwin',
        systemLocale: 'en-US',
      })
    ).toBe('ja');
  });

  it('respects an unsupported high-precedence Unix locale instead of trying lower-priority locales', () => {
    expect(
      resolveCliLocale({
        language: 'auto',
        env: { LC_ALL: 'zh_TW.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'zh_CN.UTF-8' },
        platform: 'linux',
        systemLocale: 'zh-Hans',
      })
    ).toBe('en');
  });

  it('preserves Japanese Windows system locale resolution', () => {
    expect(
      resolveCliLocale({
        language: 'auto',
        env: { LANG: 'en_US.UTF-8' },
        platform: 'win32',
        systemLocale: 'ja-JP',
      })
    ).toBe('ja');
  });

  it('uses the Windows system locale instead of Unix locale variables', () => {
    expect(
      resolveCliLocale({
        language: 'auto',
        env: { LC_ALL: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' },
        platform: 'win32',
        systemLocale: 'zh-Hans-SG',
      })
    ).toBe('zh-cn');
  });

  it('falls back to English when no supported locale is detected', () => {
    expect(
      resolveCliLocale({
        language: 'auto',
        env: { LANG: 'fr_FR.UTF-8' },
        platform: 'linux',
        systemLocale: 'ja-JP',
      })
    ).toBe('en');
  });
});
