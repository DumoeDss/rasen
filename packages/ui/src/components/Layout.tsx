import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { SpaceSwitcher } from './SpaceSwitcher.js';
import { RunningSessionsMenu } from './RunningSessionsMenu.js';
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
 */
export function Layout({ children }: { children: ComponentChildren }) {
  const { path } = useLocation();
  const space = parseSpacePath(path);
  const section = spaceSection(path);

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__inner">
          <h1>Rasen</h1>
          {space && (
            <nav>
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
            </nav>
          )}
          {space && <RunningSessionsMenu />}
          <SpaceSwitcher />
        </div>
      </header>
      <main class="app-content">{children}</main>
    </div>
  );
}
