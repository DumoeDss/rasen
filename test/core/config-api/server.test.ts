import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';

const baseContext: ManagementApiContext = {
  token: 'tok',
  launchProjectRoot: null,
  launchProjectRef: null,
  version: '0.0.0-test',
  uiAssetsDir: null,
};

async function request(
  port: number,
  requestPath: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('startManagementServer (config-api retarget: unify-pipeline-http-api)', () => {
  let handle: ManagementServerHandle | undefined;

  afterEach(async () => {
    await handle?.stopServer();
    handle = undefined;
  });

  it('binds to loopback on an ephemeral port', async () => {
    handle = await startManagementServer({ context: baseContext });
    expect(handle.port).toBeGreaterThan(0);
    const address = handle.server.address();
    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
  });

  it('respects a pinned port', async () => {
    const first = await startManagementServer({ context: baseContext });
    const pinnedPort = first.port;
    await first.stopServer();

    handle = await startManagementServer({ context: baseContext, port: pinnedPort });
    expect(handle.port).toBe(pinnedPort);
  });

  it('rejects when the pinned port is already in use', async () => {
    handle = await startManagementServer({ context: baseContext });
    await expect(startManagementServer({ context: baseContext, port: handle.port })).rejects.toThrow();
  });

  it('bootstraps a loopback browser session from the stable /p/config URL without a fragment token', async () => {
    const uiAssetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ui-assets-'));
    fs.writeFileSync(path.join(uiAssetsDir, 'index.html'), '<!doctype html><title>Rasen test UI</title>');

    try {
      handle = await startManagementServer({
        context: {
          ...baseContext,
          launchProjectRoot: uiAssetsDir,
          launchProjectRef: { projectId: 'project with spaces', name: 'Test project', root: uiAssetsDir },
          uiAssetsDir,
        },
      });

      const shortcut = await request(handle.port, '/p/config');
      expect(shortcut.status).toBe(302);
      expect(shortcut.headers.location).toBe('/p/project%20with%20spaces/config');
      const sessionCookie = shortcut.headers['set-cookie']?.[0];
      expect(sessionCookie).toMatch(/^rasen_session=tok;/);
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=Strict');
      expect(sessionCookie).toContain('Path=/');

      const page = await request(handle.port, shortcut.headers.location!, {
        Cookie: sessionCookie!.split(';', 1)[0],
      });
      expect(page.status).toBe(200);
      expect(page.body).toContain('Rasen test UI');

      const health = await request(handle.port, '/api/v1/health', {
        Cookie: sessionCookie!.split(';', 1)[0],
      });
      expect(health.status).toBe(200);

      const status = await request(handle.port, '/api/v1/status', {
        Cookie: sessionCookie!.split(';', 1)[0],
      });
      expect(status.status).toBe(200);

      const refreshed = await request(handle.port, '/api/v1/auth/session');
      expect(refreshed.status).toBe(204);
      expect(refreshed.headers['set-cookie']?.[0]).toMatch(/^rasen_session=tok;/);

      const unauthenticated = await request(handle.port, '/api/v1/health');
      expect(unauthenticated.status).toBe(401);
    } finally {
      fs.rmSync(uiAssetsDir, { recursive: true, force: true });
    }
  });

  it('rejects non-loopback Host headers before issuing a browser session (DNS-rebinding guard)', async () => {
    handle = await startManagementServer({ context: baseContext });
    const response = await request(handle.port, '/p/config', { Host: 'attacker.example' });
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('shuts down promptly even with an open keep-alive connection held by the client (D6)', async () => {
    handle = await startManagementServer({ context: baseContext });
    const keepAliveAgent = new http.Agent({ keepAlive: true });

    await new Promise<void>((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: handle!.port,
          path: '/api/v1/health',
          method: 'GET',
          agent: keepAliveAgent,
          headers: { Authorization: 'Bearer tok', Connection: 'keep-alive' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        }
      );
      request.on('error', reject);
      request.end();
    });

    // The socket is now idle but open (kept alive by the agent) — exactly
    // the shape that once hung CLI exit ~10s via undici keep-alive sockets.
    const start = Date.now();
    await handle.stopServer();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500); // well under the 2s guard timer

    keepAliveAgent.destroy();
  });
});
