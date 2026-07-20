import en from './en.json' with { type: 'json' };
import ja from './ja.json' with { type: 'json' };

import type { CliLocale } from '../utils/locale.js';

export type LocaleCatalog = typeof en;

const CATALOGS = {
  en,
  ja,
} satisfies Record<CliLocale, LocaleCatalog>;

export function getLocaleCatalog(locale: CliLocale): LocaleCatalog {
  return CATALOGS[locale];
}

export function formatLocaleMessage(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}
