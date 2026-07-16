/**
 * `http.createServer` lifecycle for the config API (design.md D1/D6):
 * loopback-only bind, ephemeral port by default, connection-tracking so
 * shutdown can force-destroy idle keep-alive sockets instead of waiting on
 * them (this repo's history: undici keep-alive once hung CLI exit ~10 s —
 * `server.close()` alone has the same failure class for a server that has
 * accepted browser keep-alive connections).
 */
import * as http from 'node:http';
import type { Socket } from 'node:net';

import { createRouter, type ConfigApiContext } from './router.js';

export interface StartConfigApiServerOptions {
  context: ConfigApiContext;
  /** Ephemeral (OS-assigned) when omitted or 0. */
  port?: number;
}

export interface ConfigApiServerHandle {
  server: http.Server;
  port: number;
  /** Closes the server and force-destroys any live sockets; resolves once shutdown has settled (bounded by the guard timer). */
  stopServer: () => Promise<void>;
}

/** Backstop so shutdown can never hang past this, even if `server.close()`'s callback never fires. */
const SHUTDOWN_GUARD_MS = 2000;

const LOOPBACK_HOST = '127.0.0.1';

export function startConfigApiServer(
  options: StartConfigApiServerOptions
): Promise<ConfigApiServerHandle> {
  const handler = createRouter(options.context);
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      );
    });
  });

  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  let stopped = false;
  const stopServer = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    stopped = true;
    return new Promise<void>((resolve) => {
      const guard = setTimeout(resolve, SHUTDOWN_GUARD_MS);
      guard.unref?.();
      server.close(() => {
        clearTimeout(guard);
        resolve();
      });
      // Force-destroy every tracked socket immediately — `server.close()`
      // alone only stops accepting new connections and waits for existing
      // (including idle keep-alive) ones to end on their own, which is
      // exactly the open-socket exit hang this repo has been bitten by.
      for (const socket of sockets) {
        socket.destroy();
      }
    });
  };

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
      server.removeListener('error', onError);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
      resolve({ server, port, stopServer });
    });
  });
}
