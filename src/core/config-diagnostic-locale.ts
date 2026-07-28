import { getCliLocale } from './cli-locale.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';
import type {
  ConfigDiagnostic,
  ConfigDiagnosticReporter,
} from './config-diagnostics.js';

export function formatConfigDiagnostic(
  diagnostic: ConfigDiagnostic,
  locale: CliLocale = getCliLocale()
): string {
  const messages = getLocaleCatalog(locale).config.diagnostics as Record<string, string>;
  const template = messages[diagnostic.key];
  if (!template) return diagnostic.fallback;
  return formatLocaleMessage(template, diagnostic.values ?? {});
}

export function createConfigDiagnosticReporter(
  locale: CliLocale = getCliLocale()
): ConfigDiagnosticReporter {
  return (diagnostic) => {
    const message = formatConfigDiagnostic(diagnostic, locale);
    if (diagnostic.output === 'error') {
      console.error(message);
    } else {
      console.warn(message);
    }
  };
}
