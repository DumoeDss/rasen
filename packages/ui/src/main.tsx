import { render } from 'preact';
import { initTokenFromLocation } from './api/token.js';
import { App } from './app.js';
import { initializeTheme } from './theme/runtime.js';
import './style.css';

// Token handling runs before anything else (design.md D4): the fragment must
// be read and scrubbed before the app mounts and starts issuing API calls.
initTokenFromLocation();

// Editorial is applied synchronously, then the global preference and catalog
// resolve before the first application frame. Failure and timeout still mount.
void initializeTheme().finally(() => {
  render(<App />, document.getElementById('app')!);
});
