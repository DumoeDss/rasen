export const SUPPORTED_CLI_LOCALES = ['en', 'ja', 'zh-cn'] as const;

export type CliLocale = (typeof SUPPORTED_CLI_LOCALES)[number];
export type CliLanguage = 'auto' | CliLocale;

const UNIX_LOCALE_ENV_KEYS = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const;

export function parseCliLocale(value: string | undefined): CliLocale | undefined {
  if (!value?.trim()) return undefined;

  const normalized = value
    .trim()
    .toLowerCase()
    .split(/[.@]/, 1)[0]
    .replaceAll('_', '-');
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'zh') return 'zh-cn';
  if (!normalized.startsWith('zh-')) return undefined;

  const subtags = normalized.split('-').slice(1);
  const extensionIndex = subtags.findIndex((subtag) => /^[a-z0-9]$/.test(subtag));
  const coreSubtags = extensionIndex === -1 ? subtags : subtags.slice(0, extensionIndex);
  const scripts = coreSubtags.filter((subtag) => /^[a-z]{4}$/.test(subtag));
  if (scripts.includes('hant')) return undefined;
  if (scripts.length === 1 && scripts[0] === 'hans') return 'zh-cn';
  if (scripts.length > 0) return undefined;

  const region = coreSubtags.find((subtag) => /^[a-z]{2}$|^\d{3}$/.test(subtag));
  return region === 'cn' || region === 'sg' ? 'zh-cn' : undefined;
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
