import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';

const baseContext: ManagementApiContext = {
  token: 'tok',
  launchProjectRoot: null,
  launchProjectRef: null,
  version: '0.0.0-test',
  uiAssetsDir: null,
};

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
