import { describe, expect, it } from 'vitest';

import { resolveCliLocale } from '../../src/utils/locale.js';

describe('resolveCliLocale', () => {
  it('prefers the Rasen override over standard locale variables', () => {
    expect(
      resolveCliLocale({
        language: 'en',
        env: { RASEN_LANG: 'ja', LC_ALL: 'en_US.UTF-8' },
        platform: 'linux',
        systemLocale: 'en-US',
      })
    ).toBe('ja');
  });

  it('uses an explicit saved language before automatic detection', () => {
    expect(
      resolveCliLocale({
        language: 'en',
        env: { LANG: 'ja_JP.UTF-8' },
        platform: 'linux',
        systemLocale: 'ja-JP',
      })
    ).toBe('en');
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

  it('respects higher-precedence Unix locale variables even when LANG is Japanese', () => {
    expect(
      resolveCliLocale({
        language: 'auto',
        env: { LC_ALL: 'C.UTF-8', LANG: 'ja_JP.UTF-8' },
        platform: 'linux',
        systemLocale: 'ja-JP',
      })
    ).toBe('en');
  });

  it('uses the Windows system locale instead of Unix locale variables', () => {
    expect(
      resolveCliLocale({
        language: 'auto',
        env: { LANG: 'en_US.UTF-8' },
        platform: 'win32',
        systemLocale: 'ja-JP',
      })
    ).toBe('ja');
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
