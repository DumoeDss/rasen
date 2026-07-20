import type { ComponentChildren } from 'preact';
import { ProjectSwitcher } from './ProjectSwitcher.js';

/** App layout (design.md D6): header (title, project switcher, nav) + content area. */
export function Layout({ children }: { children: ComponentChildren }) {
  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__inner">
          <h1>Rasen Config</h1>
          <nav>
            <a href="/config">Config</a>
          </nav>
          <ProjectSwitcher />
        </div>
      </header>
      <main class="app-content">{children}</main>
    </div>
  );
}
