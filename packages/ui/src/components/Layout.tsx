import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { SpaceSwitcher } from './SpaceSwitcher.js';
import { RunningSessionsMenu } from './RunningSessionsMenu.js';
import { ThemeToggle } from './ThemeToggle.js';
import { parseSelector, parseSpacePath, spaceHref, spaceSection } from '../store/use-space.js';
import { getRecentSpaces } from '../store/recent-spaces.js';

/**
 * App layout (management-ui-shell design D7; config-ui-package spec): header
 * (platform title, space-scoped nav, running-run summary, space switcher) +
 * content area. Navigation offers Board · Archive · Config for the current
 * planning space, built from the space prefix in the URL, with active
 * detection relative to that prefix. There is no Sessions entry — live runs
 * surface through the running-run summary. On a space-agnostic route
 * (/workflows, /spaces) the nav falls back to the most recently visited space
 * so the space-scoped entries stay reachable; only when no space has ever
 * been visited (the `/` bootstrap or a fresh browser) are the space-scoped
 * controls omitted — the switcher still renders so the user can pick a space.
 *
 * The `Workflows` entry (workflows-ui spec) is space-agnostic and therefore
 * ALWAYS rendered — the installable library is user-wide, reachable from any
 * space or none. The `Pipelines` entry (pipelines-ui spec), by contrast, is
 * space-SCOPED (a pipeline's effective configuration resolves against the
 * addressed space), so it sits inside the space-scoped block beside Config and
 * only renders when a space is resolved.
 */
export function Layout({ children }: { children: ComponentChildren }) {
  const { path } = useLocation();
  const routeSpace = parseSpacePath(path);
  // On a space-agnostic route (/workflows, /spaces) the URL carries no space,
  // which used to drop the whole space-scoped nav block and strand the user
  // there. Fall back to the most recently visited space (recorded by the
  // switcher on every space-scoped visit) so Board/Archive/Config/Pipelines
  // stay reachable; the truly-first visit with no recency still degrades to
  // the switcher-only header.
  const space = routeSpace ?? parseSelector(getRecentSpaces()[0] ?? '');
  const section = spaceSection(path);
  const onWorkflows = path.startsWith('/workflows');

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__inner">
          <h1>Rasen</h1>
          <nav>
            {space && (
              <>
                <a href={spaceHref(space, 'board')} aria-current={section === 'board' ? 'page' : undefined}>
                  Board
                </a>
                <a
                  href={spaceHref(space, 'archive')}
                  aria-current={section === 'archive' ? 'page' : undefined}
                >
                  Archive
                </a>
                <a href={spaceHref(space, 'config')} aria-current={section === 'config' ? 'page' : undefined}>
                  Config
                </a>
                <a
                  href={spaceHref(space, 'pipelines')}
                  data-testid="nav-pipelines"
                  aria-current={section === 'pipelines' ? 'page' : undefined}
                >
                  Pipelines
                </a>
              </>
            )}
            <a href="/workflows" data-testid="nav-workflows" aria-current={onWorkflows ? 'page' : undefined}>
              Workflows
            </a>
          </nav>
          {routeSpace && <RunningSessionsMenu />}
          <SpaceSwitcher />
        </div>
      </header>
      <main class="app-content">{children}</main>
      <ThemeToggle />
    </div>
  );
}
