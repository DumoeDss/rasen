/**
 * Locale resolver (design D4). A PURE function of an injected `language` value
 * plus an injectable browser-language getter — pure so tests drive it directly
 * rather than fighting jsdom's `navigator.language`.
 *
 * - A concrete supported locale (`en` | `ja` | `zh-cn`) is returned directly.
 * - `auto` (and any unrecognized value, treated defensively as `auto`) inspects
 *   the BROWSER environment: the primary language subtag of `navigator.language`
 *   is reduced to lowercase and mapped through an EXPLICIT constant table —
 *   `zh` → `zh-cn`, `ja` → `ja`, `en` → `en`. The map is a literal list per the
 *   project's "use existing constants; don't invent detection mechanisms" rule,
 *   NOT a regex.
 * - Any unmapped preference, an undetectable preference, or a thrown detection
 *   falls back to {@link DEFAULT_UI_LOCALE} (`en`).
 *
 * The CLI's `resolveCliLocale` (`src/utils/locale.ts`) CANNOT be reused: it
 * resolves `auto` via Node-only detection (Unix env vars, macOS `AppleLocale`
 * through `execSync`) that cannot run in a browser bundle. The UI detects from
 * the browser instead — this module imports nothing Node-side.
 */
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from './types.js';

/**
 * Explicit primary-subtag → supported-locale map (design D4). Keys are the
 * lowercased primary language subtag (the segment before the first `-`/`_` in
 * a BCP-47 tag like `zh-CN` or `ja-JP`). A subtag absent from this table falls
 * back to English.
 */
const SUBTAG_TO_LOCALE: Record<string, UiLocale> = {
  zh: 'zh-cn',
  ja: 'ja',
  en: 'en',
};

/** A seam for tests: how the resolver reads the browser's language preference. */
export type BrowserLanguageGetter = () => string | undefined;

/**
 * The default browser-language getter: reads `navigator.language` defensively.
 * Returns `undefined` when `navigator` is absent (SSR / a stripped environment)
 * or access throws.
 */
export const defaultBrowserLanguage: BrowserLanguageGetter = () => {
  if (typeof navigator === 'undefined') return undefined;
  try {
    return navigator.language;
  } catch {
    return undefined;
  }
};

/**
 * Reduce a BCP-47 tag to its lowercased primary subtag (e.g. `zh-CN` → `zh`,
 * `ja-JP` → `ja`, `en` → `en`). Returns the empty string for an empty/garbage
 * input so it cannot collide with a real map key.
 */
function primarySubtag(tag: string): string {
  const segment = tag.split(/[-_]/)[0] ?? '';
  return segment.toLowerCase();
}

/**
 * Resolve a concrete {@link UiLocale} from the `language` config value (design
 * D4). The optional second argument lets tests stub the browser-language source;
 * production code leaves it as the default `navigator.language` getter.
 */
export function resolveUiLocale(
  language: string | undefined,
  getBrowserLanguage: BrowserLanguageGetter = defaultBrowserLanguage
): UiLocale {
  if (isUiLocale(language)) return language;

  // `auto`, and defensively any unrecognized value, resolve from the browser.
  let raw: string | undefined;
  try {
    raw = getBrowserLanguage();
  } catch {
    raw = undefined;
  }
  if (raw) {
    const subtag = primarySubtag(raw);
    if (subtag) {
      const mapped = SUBTAG_TO_LOCALE[subtag];
      if (mapped) return mapped;
    }
  }
  return DEFAULT_UI_LOCALE;
}
