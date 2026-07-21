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
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  createManagementRouter,
  isManagementPath,
  type ManagementApiContext,
  type ManagementRouterOptions,
} from './router.js';

export interface StartManagementServerOptions {
  context: ManagementApiContext;
  /** Ephemeral (OS-assigned) when omitted or 0. */
  port?: number;
  /** Test/daemon-only overrides for the sessions supervisor (design D1's injectable resolver, task 3.3's fixture CLI override). */
  sessions?: ManagementRouterOptions;
}

export interface ManagementServerHandle {
  server: http.Server;
  port: number;
  /** Closes the server and force-destroys any live sockets; resolves once shutdown has settled (bounded by the guard timer). */
  stopServer: () => Promise<void>;
}

/** Backstop so shutdown can never hang past this, even if `server.close()`'s callback never fires. */
const SHUTDOWN_GUARD_MS = 2000;

/** Backstop on reaping live sessions (design D6) — bounds the wait past the supervisor's own SIGTERM-then-SIGKILL grace period. */
const SESSION_SHUTDOWN_GUARD_MS = 8000;

const LOOPBACK_HOST = '127.0.0.1';

export function startManagementServer(
  options: StartManagementServerOptions
): Promise<ManagementServerHandle> {
  const context = options.context;

  // Per-space project-home cache (planning-space-addressing design D2,
  // superseding the single launch-home cache): keyed by canonical space root
  // so the daemon can serve any addressable space, not only the one it was
  // launched in. Same null-retry semantics as before — a resolved home is a
  // registry-mapping lookup (root -> machine-home dir) that cannot un-register
  // mid-session, so caching a hit never goes stale; a null is never cached, so
  // the one real transition (a root registered mid-session) is picked up on
  // the next request.
  const homeCache = new Map<string, ProjectHome>();
  const resolveHomeForRoot = async (root: string | null): Promise<ProjectHome | null> => {
    if (!root) return null;
    let key: string;
    try {
      key = FileSystemUtils.canonicalizeExistingPath(root);
    } catch {
      key = root;
    }
    const cached = homeCache.get(key);
    if (cached) return cached;
    try {
      const home = await resolveProjectHome(root, { ensure: false });
      if (home) homeCache.set(key, home);
      return home;
    } catch {
      return null;
    }
  };

  // Two route groups (design D2): the config group is the existing,
  // unmodified `config-api/router.ts` delegate; the management group
  // handles its own paths, now including the sessions route group. The
  // server owns the dispatch.
  const configHandler = createConfigRouter(context);
  const { handle: managementHandler, supervisor } = createManagementRouter(context, resolveHomeForRoot, options.sessions);

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
    return (async () => {
      // Reap every live supervised session before the process actually
      // exits (design D6): the in-memory registry has no adopter in this
      // child-1 world, so anything still running past this point would be
      // an orphaned agent process with no observer and no kill switch.
      // Covers both a clean `server.close()` and the SIGINT/SIGTERM path
      // (`ui-launch.ts` calls this same `stopServer`), bounded so a
      // SIGTERM-resistant session can never hang shutdown indefinitely.
      await Promise.race([
        supervisor.shutdownAll('server-shutdown'),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, SESSION_SHUTDOWN_GUARD_MS);
          t.unref?.();
        }),
      ]);

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
    })();
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
