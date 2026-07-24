/**
 * UI-owned locale types (design D1/D4/D5). These mirror the CLI's
 * `CliLocale` / `CliLanguage` shape but are declared here — `packages/ui` is a
 * standalone package and cannot import the CLI's `src/`.
 *
 * The `language` config key (reused as-is, NOT widened) holds a `UiLanguage`:
 * `auto` or one of the concrete supported locales. The resolver turns a
 * `UiLanguage` (plus the browser environment for `auto`) into a concrete
 * `UiLocale` that selects a message catalog.
 */

/**
 * The concrete UI locales that ship a message catalog (design D7). `en` is the
 * source catalog (every key lives here, and it is the fallback for any miss in
 * another locale — design D6); `zh-cn` ships complete; `ja` ships framework
 * chrome + high-traffic (accepted-known gaps fall back to `en`).
 */
export const SUPPORTED_UI_LOCALES = ['en', 'ja', 'zh-cn'] as const;
export type UiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

/**
 * The values the `language` config key accepts (mirrors the registry enum
 * `['auto', 'en', 'ja', 'zh-cn']`). `auto` resolves from the browser; the
 * others are concrete locales.
 */
export const UI_LANGUAGES = ['auto', 'en', 'ja', 'zh-cn'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** The fallback locale when detection fails or yields an unsupported locale (design D4/D6). */
export const DEFAULT_UI_LOCALE: UiLocale = 'en';

/** True when a string is one of the concrete supported UI locales. */
export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (SUPPORTED_UI_LOCALES as readonly string[]).includes(value);
}
