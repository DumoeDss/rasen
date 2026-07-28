/**
 * Concurrent-launch convergence (task 3.3): when this spawner's own
 * detached child loses a race to bind the port (its `daemon run` would exit
 * `EADDRINUSE` in the real world — simulated here by never actually binding
 * anything), `spawnDaemonDetached`'s readiness poll must still find and
 * adopt the winner that starts answering mid-wait, converging on success
 * rather than treating the winner as a foreign/failed state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// This spawner's own subprocess never actually does anything — it
// simulates the losing side of the race (its real `daemon run` would exit
// EADDRINUSE almost immediately in the real world). Only the poll matters
// for this test.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: () => ({
      pid: 999999,
      unref: () => {},
    }),
  };
});

describe('spawnDaemonDetached convergence (task 3.3)', () => {
  let tempHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let winner: http.Server | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-daemon-converge-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = tempHome;
  });

  afterEach(async () => {
    if (winner) await new Promise<void>((resolve) => winner!.close(() => resolve()));
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
    vi.resetModules();
  });

  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = http.createServer();
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        probe.close((err) => (err ? reject(err) : resolve(port)));
      });
    });
  }

  it('adopts a concurrent SAME-version winner that starts answering mid-wait, without treating it as a failure', async () => {
    const port = await freePort();
    const { spawnDaemonDetached } = await import('../../src/commands/daemon.js');

    // The "winner" (a concurrent sibling process that won the EADDRINUSE
    // race) starts answering with rasen identity partway through this
    // call's readiness poll (poll interval is 250ms) — not before it.
    const winnerTimer = setTimeout(() => {
      winner = http.createServer((_req, res) => {
        res.writeHead(200, { 'x-rasen-daemon': '0.1.5', 'x-rasen-pid': '424242' });
        res.end('{}');
      });
      winner.listen(port, '127.0.0.1');
    }, 400);

    try {
      const result = await spawnDaemonDetached(port, '0.1.5');
      expect(result).toEqual({ ok: true, port, version: '0.1.5', pid: 424242 });
    } finally {
      clearTimeout(winnerTimer);
    }
  }, 10_000);

  it('review m2: a DIFFERENT-version rasen daemon appearing mid-wait fails as version-mismatch, never converges', async () => {
    const port = await freePort();
    const { spawnDaemonDetached } = await import('../../src/commands/daemon.js');

    const winnerTimer = setTimeout(() => {
      winner = http.createServer((_req, res) => {
        res.writeHead(200, { 'x-rasen-daemon': '0.0.1-stale', 'x-rasen-pid': '13579' });
        res.end('{}');
      });
      winner.listen(port, '127.0.0.1');
    }, 400);

    try {
      const result = await spawnDaemonDetached(port, '0.1.5');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('version-mismatch');
      expect(result.message).toContain('0.0.1-stale');
    } finally {
      clearTimeout(winnerTimer);
    }
  }, 10_000);
});
