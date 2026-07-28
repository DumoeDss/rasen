/**
 * The catalog index + `translate` (design D2/D3/D6). Mirrors the CLI's
 * `src/locales/index.ts` layout (catalog type via `typeof en`, a catalog index,
 * `{placeholder}` interpolation) WITHOUT sharing code — `packages/ui` cannot
 * import the CLI's `src/`, and UI strings are a different set from CLI prompt
 * strings anyway.
 *
 * Catalog JSON is imported with `with { type: 'json' }` (matching the CLI).
 * `en` is the source catalog; `ja` ships partial (framework chrome + high-
 * traffic, design D7) and therefore the catalogs map is typed as
 * `Record<UiLocale, Record<string, string>>` rather than the CLI's strict
 * `satisfies Record<CliLocale, LocaleCatalog>` — a miss in a non-`en` catalog
 * falls back to the `en` entry (design D6).
 */
import en from './locales/en.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };
import zhCn from './locales/zh-cn.json' with { type: 'json' };

import type { UiLocale } from './types.js';
import { formatMessage } from './format.js';

/**
 * The shape of the `en` source catalog — every key the UI references lives
 * here. Other locales are typed loosely (`Record<string, string>`) because `ja`
 * is intentionally partial.
 */
export type UiLocaleCatalog = typeof en;

const CATALOGS: Record<UiLocale, Record<string, string>> = {
  en,
  ja,
  'zh-cn': zhCn,
};

/** The message catalog for a locale (the `en` catalog for `en`). */
export function getLocaleCatalog(locale: UiLocale): Record<string, string> {
  return CATALOGS[locale];
}

/**
 * Translate `key` in `locale`, interpolating `{placeholder}`s when `values` is
 * given (design D3). Fallback discipline (design D6): a key missing from the
 * active locale renders the `en` entry; a key missing from BOTH (an
 * implementation bug — the key-existence test, task 7.4, guards this) renders
 * the key itself so the bug is visible during development rather than blank.
 */
export function translate(
  locale: UiLocale,
  key: string,
  values?: Record<string, string | number>
): string {
  const active = CATALOGS[locale];
  const template = active[key] ?? CATALOGS.en[key];
  if (template === undefined) return key;
  return values ? formatMessage(template, values) : template;
}
