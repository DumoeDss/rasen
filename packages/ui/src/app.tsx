import { useEffect, useState } from 'preact/hooks';
import { LocationProvider, Router, Route } from 'preact-iso';
import { hasToken, isUnauthorized, onUnauthorized } from './api/token.js';
import { Layout } from './components/Layout.js';
import { ConfigPage } from './components/ConfigPage.js';
import { BoardPage } from './components/BoardPage.js';
import { RelaunchNotice } from './components/RelaunchNotice.js';

/**
 * Root shell (design.md D6): boots with the full-screen re-launch notice when
 * there is no token, and switches to it on any subsequent 401. Otherwise
 * mounts path-based routing (design.md D3) with the config page as the sole
 * module and a catch-all redirect to it.
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
          <Route path="/" component={ConfigPage} />
          <Route path="/config" component={ConfigPage} />
          <Route path="/board" component={BoardPage} />
          <Route default component={ConfigPage} />
        </Router>
      </Layout>
    </LocationProvider>
  );
}
