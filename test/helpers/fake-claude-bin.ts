import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '..', 'fixtures', 'management-api');

/**
 * Resolves the fake-CLI fixture's spawnable form for the current platform
 * (design D2). On win32, `session-fake-cli.mjs` is not directly executable
 * (Node throws synchronously, `EFTYPE`), so tests point at the sibling
 * `.cmd` wrapper (`@node "%~dp0session-fake-cli.mjs" %*`) instead — this
 * drives the exact real-world `.cmd`-shim spawn codepath that
 * `supervisor.ts`'s Windows-aware spawn (`spawnAgentCli`) handles. On POSIX,
 * the `.mjs` is spawned directly, as before.
 */
export const fakeClaudeBin =
  process.platform === 'win32'
    ? path.join(fixturesDir, 'session-fake-cli.cmd')
    : path.join(fixturesDir, 'session-fake-cli.mjs');
