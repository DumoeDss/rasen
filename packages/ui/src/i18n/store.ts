/**
 * The locale store + hooks (design D5). The UI package has NO state library
 * (the planning context's "zustand" note was wrong — `packages/ui/package.json`
 * lists only preact/preact-iso/@xyflow/dagre; the `config-ui-package` spec
 * mandates no new runtime dependency). So this is a tiny hand-rolled external
 * store: a module-level `currentLocale` + a subscriber set, plus Preact hooks
 * that subscribe via `useState`/`useEffect`. This gives the whole tree a
 * re-render on locale change (the provider sits at the app root, task 2.3) AND
 * lets non-component code read the current locale synchronously (design D5's
 * "keeping the locale in a store ... lets non-component code read it too") —
 * exactly what `config/labels.ts`'s `labelFor` needs.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { translate } from './catalog.js';
import { resolveUiLocale } from './resolver.js';
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from './types.js';

// ---- module-level external store ----

let currentLocale: UiLocale = DEFAULT_UI_LOCALE;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

/**
 * Set the active locale (no-op if unchanged or invalid). Notifies every
 * subscribed component to re-render with the new locale.
 */
export function setLocale(locale: UiLocale): void {
  if (!isUiLocale(locale) || locale === currentLocale) return;
  currentLocale = locale;
  notify();
}

/** The active locale — readable from non-component code (e.g. `config/labels.ts`). */
export function getCurrentLocale(): UiLocale {
  return currentLocale;
}

/**
 * Translate against the CURRENT locale — for non-component code that cannot
 * call a hook (e.g. `config/labels.ts`'s `labelFor`). Component code SHOULD use
 * `useT()` instead so it re-renders on locale change.
 */
export function tNow(key: string, values?: Record<string, string | number>): string {
  return translate(currentLocale, key, values);
}

/** Resolve and apply a language config value directly (no network). */
export function setLocaleFromLanguage(language: string | undefined): void {
  setLocale(resolveUiLocale(language));
}

async function readLanguageValue(space?: string): Promise<string | undefined> {
  try {
    const res = await client.getKey('language', space);
    const value = res?.entry?.value;
    return typeof value === 'string' ? value : undefined;
  } catch {
    // A failed read (network, 401, or a test that doesn't mock getKey) leaves
    // the locale as-is — the bootstrap default `en` is always a safe fallback.
    return undefined;
  }
}

/**
 * Re-resolve the locale from the config API's effective `language` value
 * (design D5; spec req 2). Called on app boot by `<LocaleBootstrap>` and after
 * a successful `putKey('language', …)` from the Config page. Never throws — a
 * failed read leaves the locale unchanged.
 */
export async function refreshLocale(space?: string): Promise<void> {
  const language = await readLanguageValue(space);
  setLocale(resolveUiLocale(language));
}

// ---- Preact hooks ----

/**
 * Subscribe a component to the active locale. Re-renders the component whenever
 * `setLocale`/`refreshLocale` changes the locale.
 */
export function useLocale(): UiLocale {
  const [locale, setLocal] = useState<UiLocale>(currentLocale);
  useEffect(() => {
    const sub = (): void => setLocal(currentLocale);
    subscribers.add(sub);
    // Sync in case the locale changed between the initial render and subscribe
    // (the bootstrap effect resolves the real locale immediately after mount).
    setLocal(currentLocale);
    return () => {
      subscribers.delete(sub);
    };
  }, []);
  return locale;
}

/**
 * Returns a `t(key, values?)` bound to the current locale. The closure is
 * memoized on the locale so identity is stable across renders that don't change
 * locale (avoids needless child re-renders).
 */
export function useT(): (key: string, values?: Record<string, string | number>) => string {
  const locale = useLocale();
  return useMemo(
    () => (key: string, values?: Record<string, string | number>): string =>
      translate(locale, key, values),
    [locale]
  );
}

/** Test-only: reset the store to the default locale and clear subscribers (for test isolation). */
export function __resetLocaleForTesting(): void {
  currentLocale = DEFAULT_UI_LOCALE;
  subscribers.clear();
}
