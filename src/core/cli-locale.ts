import { getGlobalConfig } from './global-config.js';
import { resolveCliLocale, type CliLocale } from '../utils/locale.js';

export function getCliLocale(): CliLocale {
  // Locale resolution must stay silent and side-effect free. Commands that
  // consume config render any diagnostics after the locale has been chosen.
  return resolveCliLocale({
    language: getGlobalConfig({ reporter: () => {}, persistMigrations: false }).language ?? 'auto',
  });
}
