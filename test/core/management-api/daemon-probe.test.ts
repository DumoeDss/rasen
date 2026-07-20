import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';

import { probeDaemon, probeDaemonPort, resolveDefaultDaemonPort } from '../../../src/core/management-api/daemon-probe.js';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('daemon-probe (design D3, task 2.2)', () => {
  let server: http.Server | undefined;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    if (server) await close(server);
    server = undefined;
    process.env = originalEnv;
  });

  it('classifies no-listener when nothing answers', async () => {
    // An unused ephemeral port with nothing bound — bind-then-close to get
    // a free port number deterministically, without racing a real listener.
    const probe = http.createServer();
    const port = await listen(probe);
    await close(probe);

    const result = await probeDaemonPort(port);
    expect(result).toEqual({ kind: 'no-listener' });
  });

  it('classifies foreign when a listener answers without rasen identity headers', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const port = await listen(server);

    const result = await probeDaemonPort(port);
    expect(result).toEqual({ kind: 'foreign' });
  });

  it('classifies rasen-daemon by identity headers, even on a non-2xx response', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(401, { 'x-rasen-daemon': '0.1.5', 'x-rasen-pid': '4242' });
      res.end('{}');
    });
    const port = await listen(server);

    const result = await probeDaemonPort(port);
    expect(result).toEqual({ kind: 'rasen-daemon', version: '0.1.5', pid: 4242 });
  });

  it('ignores HTTP_PROXY/HTTPS_PROXY env vars (loopback probe must never be proxy-routed)', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'x-rasen-daemon': '0.1.5', 'x-rasen-pid': '7' });
      res.end('{}');
    });
    const port = await listen(server);

    // A bogus, unreachable proxy — if the probe honored it, the request
    // would hang/fail and this would misclassify as no-listener.
    process.env.HTTP_PROXY = 'http://127.0.0.1:1';
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
    process.env.NO_PROXY = '';

    const result = await probeDaemonPort(port);
    expect(result).toEqual({ kind: 'rasen-daemon', version: '0.1.5', pid: 7 });
  });

  it('probes the state-file port hint first, then the default port', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'x-rasen-daemon': '0.1.5', 'x-rasen-pid': '99' });
      res.end('{}');
    });
    const hintedPort = await listen(server);

    const emptyProbe = http.createServer();
    const defaultPort = await listen(emptyProbe);
    await close(emptyProbe);

    const probed = await probeDaemon(defaultPort, hintedPort);
    expect(probed.port).toBe(hintedPort);
    expect(probed.result).toEqual({ kind: 'rasen-daemon', version: '0.1.5', pid: 99 });
  });

  it('falls through to the default port when the hinted port answers no-listener', async () => {
    const emptyProbe = http.createServer();
    const hintedPort = await listen(emptyProbe);
    await close(emptyProbe);

    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'x-rasen-daemon': '0.1.5', 'x-rasen-pid': '55' });
      res.end('{}');
    });
    const defaultPort = await listen(server);

    const probed = await probeDaemon(defaultPort, hintedPort);
    expect(probed.port).toBe(defaultPort);
    expect(probed.result).toEqual({ kind: 'rasen-daemon', version: '0.1.5', pid: 55 });
  });

  it('resolveDefaultDaemonPort: RASEN_DAEMON_PORT override, else 8791', () => {
    expect(resolveDefaultDaemonPort({})).toBe(8791);
    expect(resolveDefaultDaemonPort({ RASEN_DAEMON_PORT: '9999' })).toBe(9999);
    expect(resolveDefaultDaemonPort({ RASEN_DAEMON_PORT: 'not-a-number' })).toBe(8791);
    expect(resolveDefaultDaemonPort({ RASEN_DAEMON_PORT: '-1' })).toBe(8791);
  });
});
