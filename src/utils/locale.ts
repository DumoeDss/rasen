export type CliLocale = 'en' | 'ja';
export type CliLanguage = 'auto' | CliLocale;

const UNIX_LOCALE_ENV_KEYS = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const;

export function parseCliLocale(value: string | undefined): CliLocale | undefined {
  if (!value?.trim()) return undefined;

  const normalized = value.trim().toLowerCase().replaceAll('_', '-');
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return undefined;
}

export interface ResolveCliLocaleOptions {
  language?: CliLanguage;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  systemLocale?: string;
}

export function resolveCliLocale(options: ResolveCliLocaleOptions = {}): CliLocale {
  const env = options.env ?? process.env;
  const override = parseCliLocale(env.RASEN_LANG);
  if (override) return override;

  const language = options.language ?? 'auto';
  if (language !== 'auto') return language;

  const platform = options.platform ?? process.platform;
  const systemLocale = options.systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;

  if (platform !== 'win32') {
    for (const key of UNIX_LOCALE_ENV_KEYS) {
      const value = env[key];
      if (value?.trim()) return parseCliLocale(value) ?? 'en';
    }
  }

  return parseCliLocale(systemLocale) ?? 'en';
}
