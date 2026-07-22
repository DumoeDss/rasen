import { useEffect, useState } from 'preact/hooks';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { hasToken, isUnauthorized, onUnauthorized } from './api/token.js';
import { Layout } from './components/Layout.js';
import { ConfigPage } from './components/ConfigPage.js';
import { BoardPage } from './components/BoardPage.js';
import { SpaceBootstrap } from './components/SpaceBootstrap.js';
import { ArchivePage } from './components/ArchivePage.js';
import { TaskDetailPage } from './components/TaskDetailPage.js';
import { SpacesPage } from './components/SpacesPage.js';
import { RelaunchNotice } from './components/RelaunchNotice.js';
import { parseSpacePath, spaceHref } from './store/use-space.js';

/**
 * Redirects a bare space root (`/p/<id>` or `/s/<id>`, no section) to that
 * space's board (board-ui spec). Replace-history so the section-less URL is
 * not a distinct back-button entry.
 */
function SpaceRootRedirect() {
  const { path, route } = useLocation();
  useEffect(() => {
    const space = parseSpacePath(path);
    if (space) route(spaceHref(space, 'board'), true);
  }, [path]);
  return null;
}

/**
 * Root shell: boots with the full-screen re-launch notice when there is no
 * token, and switches to it on any subsequent 401. Otherwise the URL is the
 * source of truth for the selected planning space (management-ui-shell design
 * D1): `/` bootstraps and redirects to a resolved space route; every
 * space-scoped view lives under a `/p/:projectId/…` or `/s/:storeId/…` prefix
 * so it always renders for a resolved space. Every section — Board, Config,
 * Archive, Task detail — now renders its real page; the shell carries no
 * placeholders. The former `/sessions` top-level page is gone — live runs
 * surface through the header summary.
 */
export function App() {
  const [unauthorized, setUnauthorized] = useState(!hasToken() || isUnauthorized());

  useEffect(() => onUnauthorized(() => setUnauthorized(true)), []);

  if (unauthorized) {
    return <RelaunchNotice />;
  }

  return (
    <LocationProvider>
      <Layout>
        <Router>
          <Route path="/" component={SpaceBootstrap} />
          <Route path="/spaces" component={SpacesPage} />
          <Route path="/p/:projectId/board" component={BoardPage} />
          <Route path="/s/:storeId/board" component={BoardPage} />
          <Route path="/p/:projectId/config" component={ConfigPage} />
          <Route path="/s/:storeId/config" component={ConfigPage} />
          <Route path="/p/:projectId/archive" component={ArchivePage} />
          <Route path="/s/:storeId/archive" component={ArchivePage} />
          <Route path="/p/:projectId/task/:changeName" component={TaskDetailPage} />
          <Route path="/s/:storeId/task/:changeName" component={TaskDetailPage} />
          <Route path="/p/:projectId" component={SpaceRootRedirect} />
          <Route path="/s/:storeId" component={SpaceRootRedirect} />
          <Route default component={SpaceBootstrap} />
        </Router>
      </Layout>
    </LocationProvider>
  );
}
