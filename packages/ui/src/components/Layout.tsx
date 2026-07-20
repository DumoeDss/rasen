import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { ProjectSwitcher } from './ProjectSwitcher.js';

/**
 * App layout (design D4 of `rasen-ui-unify-management-surface`): header
 * (platform title, nav, project switcher) + content area. Navigation offers
 * Board (the platform home, `/`) and Config (`/config`), with the active
 * view indicated; the board is also reachable at `/board` but the nav link
 * points at `/` so the active check treats both routes as "Board".
 */
export function Layout({ children }: { children: ComponentChildren }) {
  const { url } = useLocation();
  const isBoard = url === '/' || url.startsWith('/board');
  const isConfig = url.startsWith('/config');

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__inner">
          <h1>Rasen</h1>
          <nav>
            <a href="/" aria-current={isBoard ? 'page' : undefined}>
              Board
            </a>
            <a href="/config" aria-current={isConfig ? 'page' : undefined}>
              Config
            </a>
          </nav>
          <ProjectSwitcher />
        </div>
      </header>
      <main class="app-content">{children}</main>
    </div>
  );
}
