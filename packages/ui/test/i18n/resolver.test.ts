/**
 * Locale resolver (ui-i18n design D4; spec req 3). Pure function of an injected
 * `language` value + an injectable browser-language getter — driven directly
 * rather than through jsdom's `navigator.language`.
 */
import { describe, expect, it } from 'vitest';
import { resolveUiLocale } from '../../src/i18n/resolver.js';

describe('resolveUiLocale — concrete values pass through', () => {
  it('returns a concrete supported locale directly', () => {
    expect(resolveUiLocale('en')).toBe('en');
    expect(resolveUiLocale('ja')).toBe('ja');
    expect(resolveUiLocale('zh-cn')).toBe('zh-cn');
  });
});

describe('resolveUiLocale — auto resolves from the browser', () => {
  it('maps a zh-* preference to zh-cn', () => {
    expect(resolveUiLocale('auto', () => 'zh-CN')).toBe('zh-cn');
    expect(resolveUiLocale('auto', () => 'zh-TW')).toBe('zh-cn');
    expect(resolveUiLocale('auto', () => 'zh-Hans')).toBe('zh-cn');
  });

  it('maps a ja-* preference to ja', () => {
    expect(resolveUiLocale('auto', () => 'ja-JP')).toBe('ja');
  });

  it('maps an en-* preference to en', () => {
    expect(resolveUiLocale('auto', () => 'en-US')).toBe('en');
    expect(resolveUiLocale('auto', () => 'en-GB')).toBe('en');
  });

  it('falls back to en for an unsupported browser preference', () => {
    expect(resolveUiLocale('auto', () => 'fr-FR')).toBe('en');
    expect(resolveUiLocale('auto', () => 'de-DE')).toBe('en');
    expect(resolveUiLocale('auto', () => 'ko-KR')).toBe('en');
  });

  it('falls back to en when no preference is detectable', () => {
    expect(resolveUiLocale('auto', () => undefined)).toBe('en');
    expect(resolveUiLocale('auto', () => '')).toBe('en');
  });

  it('falls back to en when detection throws', () => {
    expect(
      resolveUiLocale('auto', () => {
        throw new Error('navigator gone');
      })
    ).toBe('en');
  });
});

describe('resolveUiLocale — defensive cases', () => {
  it('treats an unrecognized language value like auto (browser path, en fallback)', () => {
    // The registry enum restricts to auto/en/ja/zh-cn, but an unrecognized
    // value must never crash — it falls through to browser detection.
    expect(resolveUiLocale('klingon', () => 'en-US')).toBe('en');
    expect(resolveUiLocale(undefined, () => 'ja-JP')).toBe('ja');
  });
});
