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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRouter as createConfigRouter } from '../config-api/router.js';
import type { ChangeFinalizerOptions } from './finalize.js';
import { getGlobalDataDir } from '../global-config.js';
import { createTrustedExecutionAdapterProducerResolver } from '../pipeline-registry/trusted-execution-adapters.js';
import { createProductionExactTeacherAuthorityPolicy } from '../frozen-action-executor/index.js';
import { resolveProjectHome, type ProjectHome } from '../project-home.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  createManagementRouter,
  isManagementPath,
  type ManagementApiContext,
  type ManagementRouterOptions,
} from './router.js';
import type {
  ReusableSessionOwnerShutdownDiagnostic,
} from './reusable-session-api.js';

export interface StartManagementServerOptions {
  context: ManagementApiContext;
  /** Ephemeral (OS-assigned) when omitted or 0. */
  port?: number;
  /** Test/embedded-host override; production uses the Rasen machine-data root. */
  hostStateRoot?: string;
  /** Test/embedded-host override for the change finalizer (L3+L5). */
  finalizer?: ChangeFinalizerOptions;
  /** Test/daemon-only overrides for the sessions supervisor (design D1's injectable resolver, task 3.3's fixture CLI override). */
  sessions?: ManagementRouterOptions;
}

export interface ManagementServerHandle {
  server: http.Server;
  port: number;
  /** Closes the server and force-destroys any live sockets; resolves once shutdown has settled (bounded by the guard timer). */
  stopServer: () => Promise<void>;
}

export class ManagementServerOwnerShutdownError extends Error {
  readonly code = 'owner_shutdown_failed';
  readonly failures: ReusableSessionOwnerShutdownDiagnostic[];

  constructor(
    message: string,
    failures: ReusableSessionOwnerShutdownDiagnostic[]
  ) {
    super(message);
    this.name = 'ManagementServerOwnerShutdownError';
    this.failures = failures.map((failure) => ({ ...failure }));
  }
}

/** Backstop so shutdown can never hang past this, even if `server.close()`'s callback never fires. */
const SHUTDOWN_GUARD_MS = 2000;

/** Backstop on reaping live sessions (design D6) — bounds the wait past the supervisor's own SIGTERM-then-SIGKILL grace period. */
const SESSION_SHUTDOWN_GUARD_MS = 8000;

const LOOPBACK_HOST = '127.0.0.1';
export const AUDIT_VIEWER_ASSET_PATH = '/assets/audit-viewer.html';
export const BROWSER_SESSION_PATH = '/api/v1/auth/session';
const BROWSER_SESSION_COOKIE = 'rasen_session';

function hasLoopbackHost(req: http.IncomingMessage): boolean {
  const rawHost = req.headers.host;
  if (!rawHost || Array.isArray(rawHost)) return false;
  try {
    const hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
    return hostname === LOOPBACK_HOST || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function browserSessionCookie(req: http.IncomingMessage): string | null {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return null;
  for (const part of rawCookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== BROWSER_SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function issueBrowserSession(res: http.ServerResponse, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${BROWSER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`
  );
}

function auditViewerFile(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../viewer/audit.html');
}

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
  const hostStateRoot = options.hostStateRoot ?? getGlobalDataDir();
  const sessions: ManagementRouterOptions = {
    ...options.sessions,
    exactTeacherAuthorityPolicy:
      options.sessions?.exactTeacherAuthorityPolicy ??
      createProductionExactTeacherAuthorityPolicy({
        hostPlatform: process.platform,
        hostStateRoot,
      }),
    exactTeacherSessionHostStateDir:
      options.sessions?.exactTeacherSessionHostStateDir ??
      path.join(hostStateRoot, 'exact-teacher-session-host'),
    frozenActionProducerResolver:
      options.sessions?.frozenActionProducerResolver ??
      createTrustedExecutionAdapterProducerResolver(hostStateRoot),
    frozenActionStoreRoot:
      options.sessions?.frozenActionStoreRoot ?? path.join(hostStateRoot, 'runs'),
  };
  const {
    handle: managementHandler,
    sessionHost,
    exactTeacherSessionHost,
    shutdownReusableSessions,
    shutdownPathChooser,
  } = createManagementRouter(context, resolveHomeForRoot, {
    ...sessions,
    // L3+L5: the Store change-finalization bridge options pass through
    // unchanged; production leaves them unset (the finalizer resolves its own
    // CLI entry) and tests inject a fixture CLI.
    ...(options.finalizer === undefined ? {} : { finalizer: options.finalizer }),
  });

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

    // A cookie bootstrap is safe only for an explicitly loopback Host. The
    // socket bind alone does not stop DNS rebinding: a hostile hostname can
    // resolve to 127.0.0.1 while retaining its attacker-controlled origin.
    if (!hasLoopbackHost(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: { code: 'forbidden_host', message: 'Loopback Host required.' } }));
      return;
    }

    if (pathname === BROWSER_SESSION_PATH) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' });
        res.end('Method not allowed');
        return;
      }
      issueBrowserSession(res, context.token);
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    // Route handlers retain their existing Bearer-token contract. A valid
    // HttpOnly browser session is translated at this composition boundary so
    // browser and CLI callers share one authorization decision downstream.
    if (browserSessionCookie(req) === context.token) {
      req.headers.authorization = `Bearer ${context.token}`;
    }

    // Stable single-project entry point. The daemon's launch project is the
    // only unambiguous meaning of a project-less path; canonical multi-project
    // routes remain unchanged after this one redirect.
    if (pathname === '/p/config' && req.method === 'GET') {
      issueBrowserSession(res, context.token);
      if (!context.launchProjectRef) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('No launch project is available for /p/config.');
        return;
      }
      res.writeHead(302, {
        Location: `/p/${encodeURIComponent(context.launchProjectRef.projectId)}/config`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    // The initial HTML navigation establishes a session before the SPA makes
    // its first API request. Static assets are harmlessly covered as well.
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      issueBrowserSession(res, context.token);
    }

    if (pathname === AUDIT_VIEWER_ASSET_PATH) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' });
        res.end('Method not allowed');
        return;
      }
      const viewerPath = auditViewerFile();
      if (!fs.existsSync(viewerPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Audit viewer not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(viewerPath).pipe(res);
      return;
    }
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
  let stopPromise: Promise<void> | undefined;
  const stopServer = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      // Reap every live supervised session before the process actually
      // exits (design D6): the in-memory registry has no adopter in this
      // child-1 world, so anything still running past this point would be
      // an orphaned agent process with no observer and no kill switch.
      // Covers both a clean `server.close()` and the SIGINT/SIGTERM path
      // (`ui-launch.ts` calls this same `stopServer`), bounded so a
      // SIGTERM-resistant session can never hang shutdown indefinitely.
      // Each supervisor/host tree cleanup owns a bounded graceful/forced
      // deadline. Bound only the reusable coordinator override here; the
      // hosted Session trees keep their own full close-authority contracts.
      // Start every owner before observing any result so one rejection cannot
      // skip another lane's shutdown. The reusable owner remains the sole
      // caller of supervisor shutdown.
      let reusableGuard: NodeJS.Timeout | undefined;
      const reusableDrain = Promise.race([
        shutdownReusableSessions(),
        new Promise<never>((_resolve, reject) => {
          reusableGuard = setTimeout(
            () => reject(new Error('Reusable-session owner shutdown exceeded the bounded server drain.')),
            SESSION_SHUTDOWN_GUARD_MS
          );
          reusableGuard.unref?.();
        }),
      ]).finally(() => {
        if (reusableGuard !== undefined) clearTimeout(reusableGuard);
      });
      const hostedDrain = sessionHost.shutdown('server-shutdown');
      const exactTeacherDrain = exactTeacherSessionHost?.shutdown('server-shutdown');
      const pathChooserDrain = shutdownPathChooser();
      const drain = Promise.allSettled([
        reusableDrain,
        hostedDrain,
        exactTeacherDrain ?? Promise.resolve(),
        pathChooserDrain,
      ]);
      const drainOutcome = await drain;
      let shutdownError: Error | undefined;
      const [reusableResult, hostedResult, exactTeacherResult, pathChooserResult] = drainOutcome;
      if (reusableResult.status === 'rejected') {
        shutdownError =
          reusableResult.reason instanceof Error
            ? reusableResult.reason
            : new Error(String(reusableResult.reason));
      } else if (!reusableResult.value.ok) {
        shutdownError = new ManagementServerOwnerShutdownError(
          reusableResult.value.message,
          reusableResult.value.failures
        );
      }
      if (shutdownError === undefined && hostedResult.status === 'rejected') {
        shutdownError =
          hostedResult.reason instanceof Error
            ? hostedResult.reason
            : new Error(String(hostedResult.reason));
      }
      if (shutdownError === undefined && exactTeacherResult.status === 'rejected') {
        shutdownError =
          exactTeacherResult.reason instanceof Error
            ? exactTeacherResult.reason
            : new Error(String(exactTeacherResult.reason));
      }
      if (shutdownError === undefined && pathChooserResult.status === 'rejected') {
        shutdownError =
          pathChooserResult.reason instanceof Error
            ? pathChooserResult.reason
            : new Error(String(pathChooserResult.reason));
      }

      await new Promise<void>((resolve) => {
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
      if (shutdownError) throw shutdownError;
      stopped = true;
    })().finally(() => {
      if (!stopped) stopPromise = undefined;
    });
    return stopPromise;
  };

  return (async () => {
    const recovery = await sessionHost.reconcileOnStart();
    if (!recovery.ready) {
      throw new Error(
        `Hosted Session registry reconciliation failed${recovery.diagnostics.length ? `: ${recovery.diagnostics.join('; ')}` : '.'}`
      );
    }
    if (exactTeacherSessionHost !== undefined) {
      const exactRecovery = await exactTeacherSessionHost.reconcileOnStart();
      if (!exactRecovery.ready) {
        throw new Error(
          `Exact Teacher Session registry reconciliation failed${
            exactRecovery.diagnostics.length
              ? `: ${exactRecovery.diagnostics.join('; ')}`
              : '.'
          }`
        );
      }
    }
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
  })();
}
