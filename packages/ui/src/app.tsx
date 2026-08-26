import { useEffect, useState } from 'preact/hooks';
import { LocationProvider, Router, Route, lazy, useLocation } from 'preact-iso';
import { hasToken, isUnauthorized, onUnauthorized } from './api/token.js';
import { Layout } from './components/Layout.js';
import { ConfigPage } from './components/ConfigPage.js';
import { BoardPage } from './components/BoardPage.js';
import { SpaceBootstrap } from './components/SpaceBootstrap.js';
import { ArchivePage } from './components/ArchivePage.js';
import { IssueBoardPage } from './components/IssueBoardPage.js';
import { IssueDetailPage } from './components/IssueDetailPage.js';
import { OperationsPage } from './components/OperationsPage.js';
import { UnlinkedChangesPage } from './components/UnlinkedChangesPage.js';
import { TaskDetailPage } from './components/TaskDetailPage.js';
import { SpacesPage } from './components/SpacesPage.js';
import { WorkflowsPage } from './components/WorkflowsPage.js';
import { ProfilesPage } from './components/ProfilesPage.js';
import { PipelinesPage } from './components/PipelinesPage.js';
import { AuditPage } from './components/AuditPage.js';
import { RelaunchNotice } from './components/RelaunchNotice.js';
import { LocaleBootstrap } from './i18n/LocaleBootstrap.js';
import { useT } from './i18n/store.js';
import { parseSpacePath, spaceHomeHref, spaceHref } from './store/use-space.js';
import { SpaceCatalogProvider } from './store/space-catalog.js';

/**
 * Lazy route (pipeline-canvas-view design D1): the canvas page and its
 * dependencies (`@xyflow/react`, `dagre`, the preact/compat-aliased React
 * runtime) live in a chunk fetched only when a graph route is opened —
 * `preact-iso`'s `lazy()` gives this chunk boundary for free at the route
 * level, so every other page's bundle stays canvas-free.
 */
const PipelineCanvasPage = lazy(() =>
  import('./canvas/PipelineCanvasPage.js').then((m) => m.PipelineCanvasPage)
);

/**
 * Redirects a bare space root to its namespace-aware canonical home.
 */
function SpaceRootRedirect() {
  const { path, route } = useLocation();
  useEffect(() => {
    const space = parseSpacePath(path);
    if (space) route(spaceHomeHref(space), true);
  }, [path]);
  return null;
}

/** Retains legacy Store Board bookmarks without mounting the project Board. */
function LegacyStoreBoardRedirect() {
  const t = useT();
  const { path, route } = useLocation();
  useEffect(() => {
    const space = parseSpacePath(path);
    if (space?.type === 'store') route(spaceHref(space, 'issues'), true);
  }, [path]);
  return <p class="route-redirect" data-testid="legacy-store-board-redirect">{t('issues.redirect.board')}</p>;
}

/** Store Task aliases hand execution work to Operations without guessing a Run. */
function LegacyStoreTaskRedirect() {
  const t = useT();
  const { path, route } = useLocation();
  useEffect(() => {
    const space = parseSpacePath(path);
    if (space?.type === 'store') route(spaceHref(space, 'operations'), true);
  }, [path]);
  return <p class="route-redirect" data-testid="legacy-store-task-redirect">{t('issues.redirect.task')}</p>;
}

/**
 * Root shell: boots with the full-screen re-launch notice when there is no
 * token, and switches to it on any subsequent 401. Otherwise the URL is the
 * source of truth for the selected planning space (management-ui-shell design
 * D1): `/` bootstraps and redirects to a resolved space route; every
 * space-scoped view lives under a `/p/:projectId/…` or `/s/:storeId/…` prefix
 * so it always renders for a resolved space. Every section now renders its
 * real page; the shell carries no placeholders. Store execution lives in
 * Operations, while project live work remains on Board and Task Detail. The
 * former `/sessions` top-level page and header summary are gone. `/workflows` is a deliberately
 * space-agnostic route (workflows-ui spec): the installable library is
 * user-wide, so it carries no space prefix, exactly like `/spaces`.
 */
export function App() {
  const [unauthorized, setUnauthorized] = useState(!hasToken() || isUnauthorized());

  useEffect(() => onUnauthorized(() => setUnauthorized(true)), []);

  if (unauthorized) {
    return <RelaunchNotice />;
  }

  return (
    <LocationProvider>
      <LocaleBootstrap>
        <SpaceCatalogProvider>
          <Layout>
          <Router>
          <Route path="/" component={SpaceBootstrap} />
          <Route path="/spaces" component={SpacesPage} />
          <Route path="/workflows" component={WorkflowsPage} />
          <Route path="/profiles" component={ProfilesPage} />
          <Route path="/audit" component={AuditPage} />
          <Route path="/p/:projectId/board" component={BoardPage} />
          <Route path="/s/:storeId/board" component={LegacyStoreBoardRedirect} />
          <Route path="/p/:projectId/config" component={ConfigPage} />
          <Route path="/s/:storeId/config" component={ConfigPage} />
          <Route path="/p/:projectId/pipelines" component={PipelinesPage} />
          <Route path="/s/:storeId/pipelines" component={PipelinesPage} />
          <Route path="/p/:projectId/pipelines/:name" component={PipelineCanvasPage} />
          <Route path="/s/:storeId/pipelines/:name" component={PipelineCanvasPage} />
          {/* The Issue read surface (issue-board-ui spec) is STORE-ONLY: an
              Issue is Store-level cross-project intent, so there is no `/p/`
              pair — a project space offers no Issues section at all. */}
          <Route path="/s/:storeId/issues" component={IssueBoardPage} />
          <Route path="/s/:storeId/issues/:issueId" component={IssueDetailPage} />
          <Route path="/s/:storeId/operations" component={OperationsPage} />
          <Route path="/s/:storeId/unlinked-changes" component={UnlinkedChangesPage} />
          <Route path="/p/:projectId/archive" component={ArchivePage} />
          <Route path="/s/:storeId/archive" component={ArchivePage} />
          <Route path="/p/:projectId/task/:changeName" component={TaskDetailPage} />
          <Route path="/s/:storeId/task/:changeName" component={LegacyStoreTaskRedirect} />
          <Route path="/p/:projectId" component={SpaceRootRedirect} />
          <Route path="/s/:storeId" component={SpaceRootRedirect} />
          <Route default component={SpaceBootstrap} />
        </Router>
          </Layout>
        </SpaceCatalogProvider>
      </LocaleBootstrap>
    </LocationProvider>
  );
}
