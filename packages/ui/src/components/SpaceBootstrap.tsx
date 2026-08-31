import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import {
  isStoreUid,
  parseSelector,
  spaceEntryForSelector,
  spaceFromEntry,
  spaceHomeHref,
  spaceRouteFromSelector,
} from '../store/use-space.js';
import { useT } from '../i18n/store.js';

/**
 * The `/` (and unknown-path) bootstrap (management-ui-shell design D1). It
 * never renders lasting content — it resolves a planning space and redirects
 * to that space's canonical project Board or Store Issues route:
 *
 *   1. `?space=<selector>` from the launch URL `rasen ui` prints (which
 *      survives `token.ts`'s scrub — it preserves `location.search`). Parsed
 *      as an opaque project id or Store uid (D5). A legacy Store alias first
 *      resolves through the catalog and is replaced by its uid only when the
 *      match is unique.
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
  const [unresolvedStore, setUnresolvedStore] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveSpace() {
      const selector = new URLSearchParams(location.search).get('space');
      if (selector) {
        const parsed = parseSelector(selector);
        if (parsed) {
          if (parsed.type === 'project' || isStoreUid(parsed.id)) {
            const target = spaceRouteFromSelector(selector);
            if (target) {
              route(target, true);
              return;
            }
          } else {
            try {
              const { spaces } = await client.listSpaces();
              if (cancelled) return;
              const entry = spaceEntryForSelector(spaces, parsed);
              if (entry?.type === 'store') {
                route(spaceHomeHref(spaceFromEntry(entry)), true);
                return;
              }
            } catch {
              // A legacy alias cannot be trusted without a fresh catalog.
            }
            if (!cancelled) setUnresolvedStore(parsed.id);
            return;
          }
        }
      }

      try {
        const health = await client.health();
        if (cancelled) return;
        if (health.project) {
          const id = health.project.projectId;
          route(spaceHomeHref({ type: 'project', id, selector: `project:${id}` }), true);
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
          route(spaceHomeHref(spaceFromEntry(first)), true);
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

  if (unresolvedStore !== null) {
    return (
      <div class="space-bootstrap__empty" data-testid="unresolved-space-state">
        <p>{t('spaces.bootstrap.unresolved_store', { selector: unresolvedStore })}</p>
      </div>
    );
  }

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
