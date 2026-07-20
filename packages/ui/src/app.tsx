import { useEffect, useState } from 'preact/hooks';
import { LocationProvider, Router, Route } from 'preact-iso';
import { hasToken, isUnauthorized, onUnauthorized } from './api/token.js';
import { Layout } from './components/Layout.js';
import { ConfigPage } from './components/ConfigPage.js';
import { BoardPage } from './components/BoardPage.js';
import { SessionsPage } from './components/SessionsPage.js';
import { RelaunchNotice } from './components/RelaunchNotice.js';

/**
 * Root shell: boots with the full-screen re-launch notice when there is no
 * token, and switches to it on any subsequent 401. Otherwise mounts
 * path-based routing with the board as the platform home (design D4 of
 * `rasen-ui-unify-management-surface`, third destination added by design D1
 * of `slice3-sessions-ui`): `/` and `/board` both render the board,
 * `/config` renders the config page, `/sessions` renders the sessions page,
 * and unknown paths fall back to the board rather than the config page.
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
          <Route path="/" component={BoardPage} />
          <Route path="/board" component={BoardPage} />
          <Route path="/config" component={ConfigPage} />
          <Route path="/sessions" component={SessionsPage} />
          <Route default component={BoardPage} />
        </Router>
      </Layout>
    </LocationProvider>
  );
}
