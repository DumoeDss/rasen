/**
 * Route-leave guard (config-ui-package spec "Leaving the Config route with a
 * staged draft asks first", design D5). While `active`, intercepts an
 * in-app navigation click before preact-iso's router sees it and hands the
 * intended href to `onIntercept` so the caller can open a confirm dialog
 * instead of navigating. A `beforeunload` handler covers hard navigation and
 * tab close with the browser-native prompt.
 *
 * The click listener is registered on `document` in the **capture** phase so it
 * runs before preact-iso's bubble-phase router listener (otherwise the route
 * would already have changed by the time we could prevent it). It only
 * intercepts an unmodified left-click on a same-origin `<a>` whose target path
 * differs from the current one — every modified click, external link, and
 * same-path click is left alone. The latest `onIntercept` is read through a ref
 * so the effect re-subscribes only when `active` flips, not on every render.
 *
 * Out of scope (fails safe — the draft is only ever discarded, never applied): an
 * in-app `history.back()`/`popstate` navigation bypasses this guard; only a full
 * document unload is caught, by `beforeunload`.
 */
import { useEffect, useRef } from 'preact/hooks';

/**
 * The active guard's interceptor, if any (module-global so programmatic
 * navigators — which never dispatch a DOM click the capture listener could see
 * — can consult it too, per m2). Set while a `useNavigationGuard` is active;
 * returns `true` when it intercepted the navigation (caller must not proceed).
 */
let activeIntercept: ((href: string) => boolean) | null = null;

/**
 * Navigate via `route`, but let an active navigation guard intercept first
 * (m2). Programmatic in-app navigation (e.g. the space switcher's `route()`
 * calls) MUST go through this so a dirty profile draft gets the same
 * discard/stay confirmation an anchor click would; without it the draft is
 * silently discarded on a space switch or "Manage spaces".
 */
export function guardedRoute(
  route: (href: string, replace?: boolean) => void,
  href: string,
  replace?: boolean
): void {
  if (activeIntercept && activeIntercept(href)) return;
  route(href, replace);
}

export function useNavigationGuard(active: boolean, onIntercept: (href: string) => void): void {
  const onInterceptRef = useRef(onIntercept);
  onInterceptRef.current = onIntercept;

  useEffect(() => {
    if (!active) return;

    // Programmatic navigators consult this while the guard is active.
    activeIntercept = (href: string) => {
      onInterceptRef.current(href);
      return true;
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      // Only a plain left-click navigates in-app; a modified click (new tab,
      // download, etc.) is the browser's to handle.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      const rawHref = anchor.getAttribute('href');
      if (rawHref === null || rawHref === '') return;
      if (anchor.hasAttribute('download') || anchor.getAttribute('target') === '_blank') return;

      let url: URL;
      try {
        url = new URL((anchor as HTMLAnchorElement).href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // external link
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return; // same page (e.g. a hash-only or no-op link)
      }

      event.preventDefault();
      event.stopPropagation();
      onInterceptRef.current(url.pathname + url.search + url.hash);
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy assignment some browsers still require to show the prompt.
      event.returnValue = '';
    };

    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      activeIntercept = null;
    };
  }, [active]);
}
