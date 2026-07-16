import { render } from 'preact';
import { initTokenFromLocation } from './api/token.js';
import { App } from './app.js';
import './style.css';

// Token handling runs before anything else (design.md D4): the fragment must
// be read and scrubbed before the app mounts and starts issuing API calls.
initTokenFromLocation();

render(<App />, document.getElementById('app')!);
