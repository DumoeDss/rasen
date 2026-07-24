/**
 * `<LocaleBootstrap>` (design D5; task 2.3): a thin component mounted inside
 * `<LocationProvider>` in `app.tsx`, ABOVE the `<Router>`, that seeds the locale
 * store from the config API's effective `language` value on app load. The store
 * itself is module-level (see `./store.ts`), so this component only owns the
 * bootstrap effect and otherwise renders its children unchanged — every
 * component below subscribes via `useT()`/`useLocale()` and re-renders on a
 * locale change for free.
 */
import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { refreshLocale } from './store.js';

export function LocaleBootstrap({ children }: { children: ComponentChildren }) {
  // Seed once on app boot (design D5). `refreshLocale` is defensive — a failed
  // read leaves the store at its `en` default, so a boot before the config API
  // is reachable (or a test that doesn't mock it) degrades gracefully to
  // English, matching today's hardcoded-English behavior.
  useEffect(() => {
    void refreshLocale();
  }, []);

  return <>{children}</>;
}
