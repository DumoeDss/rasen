/**
 * `http.createServer` lifecycle for the management server. Also the seam
 * design D2 of `rasen-ui-unify-management-surface` names as the composition
 * point for the two route groups: the management group (`createManagementRouter`)
 * and the config group (`createRouter` from `config-api/router.js`, unmodified) —
 * dispatch by path (`isManagementPath`) lives here now, not privately inside
 * the management router. Otherwise a straight copy of config-api's
 * loopback-bind / socket-tracking / 2s-shutdown-guard pattern (that file is
 * import-only, never modified), plus the `x-rasen-daemon` / `x-rasen-pid`
 * identity-header stamp (design D3 of the prior batch) applied to every
 * response BEFORE routing, so it covers management-handled, delegated,
 * static, and 401 responses alike.
 */
import * as http from 'node:http';
import type { Socket } from 'node:net';

import { createRouter as createConfigRouter } from '../config-api/router.js';
import { resolveProjectHome, type ProjectHome } from '../project-home.js';
import { createManagementRouter, isManagementPath, type ManagementApiContext } from './router.js';

export interface StartManagementServerOptions {
  context: ManagementApiContext;
  /** Ephemeral (OS-assigned) when omitted or 0. */
  port?: number;
}

export interface ManagementServerHandle {
  server: http.Server;
  port: number;
  /** Closes the server and force-destroys any live sockets; resolves once shutdown has settled (bounded by the guard timer). */
  stopServer: () => Promise<void>;
}

/** Backstop so shutdown can never hang past this, even if `server.close()`'s callback never fires. */
const SHUTDOWN_GUARD_MS = 2000;

const LOOPBACK_HOST = '127.0.0.1';

export function startManagementServer(
  options: StartManagementServerOptions
): Promise<ManagementServerHandle> {
  const context = options.context;

  // Server-lifetime project-home cache (design D5, m4): resolved lazily on
  // first need, cached once found, re-probed on every call while still null
  // — a registry-mapping lookup (root -> machine-home dir) that cannot
  // un-register mid-session in any supported flow, so caching a hit never
  // goes stale; the null case covers the one real transition (unregistered
  // -> registered mid-session).
  let cachedHome: ProjectHome | null = null;
  const resolveHome = async (): Promise<ProjectHome | null> => {
    if (cachedHome) return cachedHome;
    if (!context.launchProjectRoot) return null;
    try {
      const home = await resolveProjectHome(context.launchProjectRoot, { ensure: false });
      if (home) cachedHome = home;
      return home;
    } catch {
      return null;
    }
  };

  // Two route groups (design D2): the config group is the existing,
  // unmodified `config-api/router.ts` delegate; the management group
  // handles only its own three paths. The server owns the dispatch.
  const configHandler = createConfigRouter(context);
  const managementHandler = createManagementRouter(context, resolveHome);

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (isManagementPath(pathname)) {
      await managementHandler(req, res, pathname);
      return;
    }
    await configHandler(req, res);
  };

  const daemonHeader = context.version;
  const pidHeader = String(process.pid);

  const server = http.createServer((req, res) => {
    // Unconditional (design D3 of the prior batch): set before any routing
    // so even a 401 or a static-asset response carries both headers — a
    // prober hitting any path can classify what answered.
    res.setHeader('x-rasen-daemon', daemonHeader);
    res.setHeader('x-rasen-pid', pidHeader);

    handler(req, res).catch((error) => {
      if (res.headersSent) {
        // A response (almost certainly a static asset) is already
        // streaming — writing a JSON envelope now would concatenate onto
        // an in-flight body and hand the client a corrupt response
        // instead of a clean failure (review round 1 m3). Destroying the
        // socket is the honest failure mode here.
        res.destroy();
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
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
