import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { SpaceSwitcher } from './SpaceSwitcher.js';
import { RunningSessionsMenu } from './RunningSessionsMenu.js';
import { ThemeToggle } from './ThemeToggle.js';
import { parseSpacePath, spaceHref, spaceSection } from '../store/use-space.js';

/**
 * App layout (management-ui-shell design D7; config-ui-package spec): header
 * (platform title, space-scoped nav, running-run summary, space switcher) +
 * content area. Navigation offers Board · Archive · Config for the current
 * planning space, built from the space prefix in the URL, with active
 * detection relative to that prefix. There is no Sessions entry — live runs
 * surface through the running-run summary. When no space is resolved yet (the
 * `/` bootstrap or the empty state) the space-scoped controls are omitted; the
 * switcher still renders so the user can pick a space.
 *
 * The `Workflows` entry (workflows-ui spec) is space-agnostic and therefore
 * ALWAYS rendered — the installable library is user-wide, reachable from any
 * space or none. LEAD merge point: the Pipelines page (W3) adds a sibling
 * space-agnostic entry to this same nav — keep the addition minimal and
 * additive.
 */
export function Layout({ children }: { children: ComponentChildren }) {
  const { path } = useLocation();
  const space = parseSpacePath(path);
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
              </>
            )}
            <a href="/workflows" data-testid="nav-workflows" aria-current={onWorkflows ? 'page' : undefined}>
              Workflows
            </a>
          </nav>
          {space && <RunningSessionsMenu />}
          <SpaceSwitcher />
        </div>
      </header>
      <main class="app-content">{children}</main>
      <ThemeToggle />
    </div>
  );
}
