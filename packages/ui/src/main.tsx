import { render } from 'preact';
import { initTokenFromLocation } from './api/token.js';
import { App } from './app.js';
import { initializeTheme } from './theme/runtime.js';
import './style.css';

// Legacy fragment handling runs before anything else so an old launch URL is
// scrubbed before the app mounts. Current launches use the HttpOnly session.
initTokenFromLocation();

// Editorial is applied synchronously, then the global preference and catalog
// resolve before the first application frame. Failure and timeout still mount.
void initializeTheme().finally(() => {
  render(<App />, document.getElementById('app')!);
});
