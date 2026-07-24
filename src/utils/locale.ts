import { execSync } from 'node:child_process';

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

/**
 * One Unix locale environment value either resolves to a supported locale,
 * explicitly requests unlocalized output (`C`/`POSIX`), names a language we
 * do not ship, or carries no language information at all (`UTF-8`, malformed
 * values). Only the last kind lets resolution continue with the next source.
 */
type UnixLocaleValueClass = CliLocale | 'portable' | 'unsupported-language' | 'no-language';

function classifyUnixLocaleValue(value: string): UnixLocaleValueClass {
  const supported = parseCliLocale(value);
  if (supported) return supported;

  const base = value
    .trim()
    .toLowerCase()
    .split(/[.@]/, 1)[0]
    .replaceAll('_', '-');
  if (base === 'c' || base === 'posix') return 'portable';
  // Encoding-only values (macOS terminals export `LC_CTYPE=UTF-8`) name no
  // language even though `utf` looks like a language subtag.
  if (/^utf-?8$/.test(base)) return 'no-language';
  return /^[a-z]{2,3}(?:-|$)/.test(base) ? 'unsupported-language' : 'no-language';
}

let darwinOsLocaleProbed = false;
let darwinOsLocale: string | undefined;

/**
 * Reads the macOS user locale (`AppleLocale`), which Node's ICU never
 * reflects. Silent and memoized: probed at most once per process, and only
 * on the `auto` path after every locale environment variable failed to name
 * a language, so correctly-configured shells never pay its cost.
 */
function readDarwinOsLocale(): string | undefined {
  if (!darwinOsLocaleProbed) {
    darwinOsLocaleProbed = true;
    try {
      darwinOsLocale =
        execSync('defaults read -g AppleLocale', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        }).trim() || undefined;
    } catch {
      darwinOsLocale = undefined;
    }
  }
  return darwinOsLocale;
}

export interface ResolveCliLocaleOptions {
  language?: CliLanguage;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  systemLocale?: string;
  readOsLocale?: () => string | undefined;
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
      if (!value?.trim()) continue;
      const classified = classifyUnixLocaleValue(value);
      if (classified === 'no-language') continue;
      if (classified === 'portable' || classified === 'unsupported-language') return 'en';
      return classified;
    }
    if (platform === 'darwin') {
      const osLocale = parseCliLocale((options.readOsLocale ?? readDarwinOsLocale)());
      if (osLocale) return osLocale;
    }
  }

  return parseCliLocale(systemLocale) ?? 'en';
}
