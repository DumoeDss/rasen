import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { SpaceSwitcher } from './SpaceSwitcher.js';
import { RasenLogo } from './RasenLogo.js';
import { isPipelineCanvasPath, parseSelector, parseSpacePath, spaceHref, spaceSection } from '../store/use-space.js';
import { getRecentSpaces } from '../store/recent-spaces.js';
import { useT } from '../i18n/store.js';

/**
 * App layout (management-ui-shell design D7; config-ui-package spec): header
 * (platform title, space-scoped nav, space switcher) + content area. Store
 * execution lives in Operations; project live work stays on Board and Task
 * Detail. Navigation is built from the space prefix in the URL, with active
 * detection relative to that prefix; there is no separate Sessions entry or
 * running-run summary. On a space-agnostic route
 * (/workflows, /spaces) the nav falls back to the most recently visited space
 * so the space-scoped entries stay reachable; only when no space has ever
 * been visited (the `/` bootstrap or a fresh browser) are the space-scoped
 * controls omitted — the switcher still renders so the user can pick a space.
 *
 * The `Workflows` and `Profiles` entries (workflows-ui / profiles-ui specs) are
 * space-agnostic and therefore ALWAYS rendered — the installable library and
 * the named profiles are user-wide, reachable from any space or none. The
 * `Pipelines` entry (pipelines-ui spec), by contrast, is
 * space-SCOPED (a pipeline's effective configuration resolves against the
 * addressed space), so it sits inside the space-scoped block beside Config and
 * only renders when a space is resolved.
 */
export function Layout({ children }: { children: ComponentChildren }) {
  const t = useT();
  const { path } = useLocation();
  const routeSpace = parseSpacePath(path);
  // On a space-agnostic route (/workflows, /spaces) the URL carries no space,
  // which used to drop the whole space-scoped nav block and strand the user
  // there. Fall back to the most recently visited space (recorded by the
  // switcher on every space-scoped visit) so Board/Archive/Config/Pipelines
  // stay reachable; the truly-first visit with no recency still degrades to
  // the switcher-only header.
  const space = routeSpace ?? parseSelector(getRecentSpaces()[0] ?? '');
  // Active-state derives from the URL's OWN space, not the recent-space
  // fallback: on a space-agnostic route (/profiles, /workflows, /spaces, /) the
  // space-scoped entries still render (reachability is a feature) but none is
  // the current route, so `section` is null and Board/Archive/Config/Pipelines
  // get no aria-current — only Workflows/Profiles highlight themselves.
  const section = routeSpace ? spaceSection(path) : null;
  const onIssues = routeSpace
    ? routeSpace.type === 'store'
      ? path === spaceHref(routeSpace, 'issues') || path.startsWith(`${spaceHref(routeSpace, 'issues')}/`)
      : path === spaceHref(routeSpace, 'issues')
    : false;
  const onOperations =
    routeSpace?.type === 'store' && path === spaceHref(routeSpace, 'operations');
  const onUnlinkedChanges =
    routeSpace?.type === 'store' && path === spaceHref(routeSpace, 'unlinked-changes');
  const onWorkflows = path.startsWith('/workflows');
  const onProfiles = path.startsWith('/profiles');
  const onAudit = path.startsWith('/audit');
  // The pipeline canvas route is viewport-locked (pipelines-ui spec): the shell
  // fixes the content height and lets the editor's panels scroll internally.
  // Every other route keeps the normal document-scrolling content area.
  const onCanvas = isPipelineCanvasPath(path);

  return (
    <div class={`app-shell${onCanvas ? ' app-shell--canvas' : ''}`}>
      <header class="app-header">
        <div class="app-header__inner">
          <div class="app-brand">
            <RasenLogo />
            <h1>Rasen</h1>
          </div>
          <nav>
            {space && (
              <>
                {space.type === 'project' ? (
                  <>
                    <a
                      href={spaceHref(space, 'board')}
                      data-testid="nav-board"
                      aria-current={section === 'board' && !onIssues ? 'page' : undefined}
                    >
                      {t('nav.board')}
                    </a>
                    <a
                      href={spaceHref(space, 'issues')}
                      data-testid="nav-issues"
                      aria-current={onIssues ? 'page' : undefined}
                    >
                      {t('nav.issues')}
                    </a>
                  </>
                ) : (
                  <>
                    <a
                      href={spaceHref(space, 'issues')}
                      data-testid="nav-issues"
                      aria-current={onIssues ? 'page' : undefined}
                    >
                      {t('nav.issues')}
                    </a>
                    <a
                      href={spaceHref(space, 'operations')}
                      data-testid="nav-operations"
                      aria-current={onOperations ? 'page' : undefined}
                    >
                      {t('nav.operations')}
                    </a>
                    <a
                      href={spaceHref(space, 'unlinked-changes')}
                      data-testid="nav-unlinked-changes"
                      aria-current={onUnlinkedChanges ? 'page' : undefined}
                    >
                      {t('nav.unlinked_changes')}
                    </a>
                  </>
                )}
                <a
                  href={spaceHref(space, 'archive')}
                  aria-current={section === 'archive' ? 'page' : undefined}
                >
                  {t('nav.archive')}
                </a>
                <a href={spaceHref(space, 'config')} aria-current={section === 'config' ? 'page' : undefined}>
                  {t('nav.config')}
                </a>
                <a
                  href={spaceHref(space, 'pipelines')}
                  data-testid="nav-pipelines"
                  aria-current={section === 'pipelines' ? 'page' : undefined}
                >
                  {t('nav.pipelines')}
                </a>
              </>
            )}
            <a href="/workflows" data-testid="nav-workflows" aria-current={onWorkflows ? 'page' : undefined}>
              {t('nav.workflows')}
            </a>
            <a href="/profiles" data-testid="nav-profiles" aria-current={onProfiles ? 'page' : undefined}>
              {t('nav.profiles')}
            </a>
            <a href="/audit" data-testid="nav-audit" aria-current={onAudit ? 'page' : undefined}>
              Audit
            </a>
          </nav>
          <SpaceSwitcher />
        </div>
      </header>
      <main
        class={`app-content${onCanvas ? ' app-content--canvas' : ''}${onAudit ? ' app-content--audit' : ''}`}
      >
        {children}
      </main>
    </div>
  );
}
