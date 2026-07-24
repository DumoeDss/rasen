import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import { spaceRouteFromSelector } from '../store/use-space.js';
import { useT } from '../i18n/store.js';

/**
 * The `/` (and unknown-path) bootstrap (management-ui-shell design D1). It
 * never renders lasting content — it resolves a planning space and redirects
 * to that space's canonical `/p/<id>/board` or `/s/<id>/board` route:
 *
 *   1. `?space=<selector>` from the launch URL `rasen ui` prints (which
 *      survives `token.ts`'s scrub — it preserves `location.search`). Parsed
 *      verbatim as an opaque token (D5) and replaced into a clean route so
 *      the query never lingers or becomes a back-button entry.
 *   2. else `GET /api/v1/health`'s launch project → `/p/<id>/board`.
 *   3. else the first `GET /api/v1/spaces` entry.
 *   4. else an explicit empty state — never a blank page or a spinner.
 *
 * `route(…, true)` (replace) guards against a redirect loop.
 */
export function SpaceBootstrap() {
  const t = useT();
  const { route } = useLocation();
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolveSpace() {
      const selector = new URLSearchParams(location.search).get('space');
      if (selector) {
        const target = spaceRouteFromSelector(selector);
        if (target) {
          route(target, true);
          return;
        }
      }

      try {
        const health = await client.health();
        if (cancelled) return;
        if (health.project) {
          route(`/p/${encodeURIComponent(health.project.projectId)}/board`, true);
          return;
        }
      } catch {
        // Fall through to the spaces listing — a failed health probe is not
        // fatal to bootstrap; the spaces listing may still resolve a space.
      }

      try {
        const { spaces } = await client.listSpaces();
        if (cancelled) return;
        const first = spaces[0];
        if (first) {
          const prefix = first.type === 'project' ? 'p' : 's';
          route(`/${prefix}/${encodeURIComponent(first.id)}/board`, true);
          return;
        }
      } catch {
        // Fall through to the empty state.
      }

      if (!cancelled) setEmpty(true);
    }

    void resolveSpace();
    return () => {
      cancelled = true;
    };
  }, []);

  if (empty) {
    return (
      <div class="space-bootstrap__empty" data-testid="no-space-empty-state">
        <p>
          {t('spaces.bootstrap.empty_pre')}<code>rasen ui</code>{t('spaces.bootstrap.empty_post')}
        </p>
      </div>
    );
  }

  return <p class="space-bootstrap__resolving">{t('spaces.bootstrap.resolving')}</p>;
}
