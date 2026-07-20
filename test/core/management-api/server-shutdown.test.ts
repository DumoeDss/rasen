import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeClaudeBin = path.resolve(__dirname, '..', '..', 'fixtures', 'management-api', 'session-fake-cli.mjs');

const TOKEN = 'test-token-shutdown-abc123';

function req(
  port: number,
  options: { method: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; json: () => unknown }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method: options.method, path: options.path, headers: options.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(body) });
        });
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

/** Signal-0 liveness probe (mirrors kill-tree.ts's `isProcessAlive`) — used here only to assert the fixture's process tree is actually gone after shutdown. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('foreground server shutdown reaps live sessions (design D6, task 3.4)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ManagementServerHandle | undefined;

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-shutdown-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-shutdown-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    process.env.XDG_DATA_HOME = tempConfigHome;
    process.env.RASEN_CLAUDE_BIN = fakeClaudeBin;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    fs.rmSync(tempConfigHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  // (review t2: the termination *reason* itself is asserted at the
  // supervisor level — supervisor.test.ts's "shutdownAll() tree-kills every
  // live session with the given reason" — since the registry is
  // unobservable once this HTTP-level server has actually closed; this
  // test's job is proving the process is actually dead, not re-asserting
  // the reason string.)
  it('clean shutdown tree-kills every live session before the server closes (process death, HTTP-level)', async () => {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: { projectId: 'launch-proj', name: 'proj', root: projectRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    handle = await startManagementServer({ context });

    // A session that never exits on its own (idle-after-init) — only a
    // deliberate kill (or the server's own shutdown reaping) ends it.
    const launchRes = await req(handle.port, {
      method: 'POST',
      path: '/api/v1/sessions',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ kind: 'auto', task: 'MODE=idle-after-init x' }),
    });
    expect(launchRes.status).toBe(201);
    const body = launchRes.json() as { session: { id: string; pid?: number } };
    const pid = body.session.pid;
    expect(typeof pid).toBe('number');

    // Give the fixture a moment to actually be running (past the init line).
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(isAlive(pid!)).toBe(true);

    // Clean shutdown: `stopServer()` is the same path both `server.close()`
    // and `ui-launch.ts`'s SIGINT/SIGTERM handler drive.
    await handle.stopServer();

    // The fixture's process tree must actually be gone — not just marked
    // exited in a registry nobody re-checked.
    expect(isAlive(pid!)).toBe(false);
  }, 15_000);

  it('a server shut down with no live sessions closes promptly (no session-shutdown wait is incurred when nothing is live)', async () => {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: { projectId: 'launch-proj', name: 'proj', root: projectRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    handle = await startManagementServer({ context });

    const start = Date.now();
    await handle.stopServer();
    // Well under the 8s session-shutdown backstop — nothing was live to wait on.
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
