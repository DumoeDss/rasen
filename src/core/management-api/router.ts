/**
 * Handler for the management route group only (design.md D2 of
 * `rasen-ui-unify-management-surface`): `GET /api/v1/status|changes|runs`.
 * The server (not this module) decides whether a request belongs here — via
 * `isManagementPath` — and owns the config route group's delegate; this
 * module no longer constructs it (that was `rasen-ui-slice1-readonly-api`'s
 * shape, before the two route groups became the server's composition seam).
 */
import type * as http from 'node:http';

import type { ConfigApiContext } from '../config-api/router.js';
import type { ProjectHome } from '../project-home.js';
import { handleChanges } from './changes.js';
import { handleRuns } from './runs.js';
import {
  handleGetSession,
  handleKillSession,
  handleLaunchSession,
  handleListSessions,
} from './sessions.js';
import { createSessionRegistry } from './session-registry.js';
import { createAgentCliResolver, createSessionSupervisor, type SessionSupervisor } from './supervisor.js';
import { createChangeSubmitter } from './submit.js';
import type { LaunchSessionRequest, StatusResponse, SubmitChangeRequest } from './wire-types.js';

/** Same shape as the config API's context — one token, one launch project, one server. */
export type ManagementApiContext = ConfigApiContext;

/** Test/daemon-only overrides for the sessions supervisor this router constructs (design D1's injectable resolver). */
export interface ManagementRouterOptions {
  resolveAgentCliOverride?: () => Promise<string | null>;
  maxConcurrentSessions?: number;
  sessionKillGraceMs?: number;
}

export interface ManagementRouterHandle {
  handle: (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => Promise<void>;
  supervisor: SessionSupervisor;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const MAX_BODY_BYTES = 64 * 1024;

/** The management endpoints with no path parameter, canonical (no trailing slash) form. */
const MANAGEMENT_PATHS = new Set(['/api/v1/status', '/api/v1/changes', '/api/v1/runs', '/api/v1/sessions']);

const SESSION_ID_PATH_PREFIX = '/api/v1/sessions/';

/**
 * Matches `/api/v1/sessions/<id>` exactly one segment deep (design D4/D6:
 * "SHALL match exactly one additional path segment"); a deeper suffix
 * (`/api/v1/sessions/<id>/extra`) returns null and falls through to the
 * rest of the server's routing, same as any other unmatched path.
 */
function matchSessionIdPath(pathname: string): string | null {
  if (!pathname.startsWith(SESSION_ID_PATH_PREFIX)) return null;
  const rest = pathname.slice(SESSION_ID_PATH_PREFIX.length);
  if (rest.length === 0 || rest.includes('/')) return null;
  return rest;
}

/** Methods admitted per management path (design D1/D4): everywhere GETs, `/changes` and `/sessions` also POST, session-id paths also DELETE. */
function isMethodAdmitted(pathname: string, method: string | undefined): boolean {
  if (matchSessionIdPath(pathname) !== null) {
    return method === 'GET' || method === 'DELETE';
  }
  if (pathname === '/api/v1/sessions') {
    return method === 'GET' || method === 'POST';
  }
  if (method === 'GET') return true;
  return pathname === '/api/v1/changes' && method === 'POST';
}

type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; code: string; message: string };

/** Reads and JSON-parses the request body, capped like the config API's own reader. */
function readJsonBody(req: http.IncomingMessage): Promise<BodyReadResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: BodyReadResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        finish({
          ok: false,
          status: 413,
          code: 'payload_too_large',
          message: `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
        });
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        finish({ ok: true, value: raw.trim() === '' ? undefined : JSON.parse(raw) });
      } catch {
        finish({ ok: false, status: 400, code: 'bad_request', message: 'Request body is not valid JSON.' });
      }
    });
    req.on('error', () => {
      finish({ ok: false, status: 400, code: 'bad_request', message: 'Failed to read the request body.' });
    });
  });
}

/**
 * Normalizes exactly one trailing slash (design D6): `/api/v1/status/` is
 * treated as `/api/v1/status`. Deeper suffixes (`/api/v1/status/extra`) are
 * left as-is, so they still miss `MANAGEMENT_PATHS` and fall through to the
 * config route group — no prefix matching.
 */
function stripOneTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** Whether `pathname` (raw, as received) addresses a management endpoint (t1: tolerant of one trailing slash). */
export function isManagementPath(pathname: string): boolean {
  const stripped = stripOneTrailingSlash(pathname);
  return MANAGEMENT_PATHS.has(stripped) || matchSessionIdPath(stripped) !== null;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match !== null && match[1] === token;
}

/**
 * Builds the request handler for the management route group, closed over
 * one session's context. The caller must have already established that
 * `pathname` satisfies `isManagementPath` and must pass the server-lifetime
 * resolved project home (design D5/m4) rather than letting this module
 * re-resolve it per request.
 */
export function createManagementRouter(
  context: ManagementApiContext,
  resolveHome: () => Promise<ProjectHome | null>,
  options: ManagementRouterOptions = {}
): ManagementRouterHandle {
  // One submitter per server instance (design D3's cap-1 concurrency is
  // per-server state, closed over here rather than module-scoped).
  const submitChange = createChangeSubmitter(context);

  // One supervisor per server instance (design D4/task 2.4): its own
  // registry, its own concurrency cap, its own agent-CLI resolution cache.
  // `server.ts` reaches into the returned handle to call `shutdownAll` on
  // clean exit (design D6).
  const supervisor = createSessionSupervisor({
    registry: createSessionRegistry(),
    resolveAgentCli: options.resolveAgentCliOverride ?? createAgentCliResolver(),
    maxConcurrent: options.maxConcurrentSessions,
    killGraceMs: options.sessionKillGraceMs,
  });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, rawPathname: string): Promise<void> => {
    const pathname = stripOneTrailingSlash(rawPathname);

    if (!isAuthorized(req, context.token)) {
      sendError(res, 401, 'unauthorized', 'Missing or invalid bearer token.');
      return;
    }

    if (!isMethodAdmitted(pathname, req.method)) {
      sendError(res, 405, 'method_not_allowed', `${req.method} not allowed on ${pathname}.`);
      return;
    }

    if (pathname === '/api/v1/changes' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        // Only after the response is already sent: on 413 in particular, a
        // client may still be mid-upload past our cap, and the response is
        // fully written by now so tearing down the request side no longer
        // risks dropping it (review t2). Harmless no-op if the client
        // already finished sending.
        req.destroy();
        return;
      }
      const request = (body.value ?? {}) as Partial<SubmitChangeRequest>;
      const result = await submitChange(request.name, request.description);
      if (!result.ok) {
        res.writeHead(result.status, JSON_HEADERS);
        res.end(
          JSON.stringify({
            error: {
              code: result.code,
              message: result.message,
              ...(result.cliExitCode !== undefined ? { cliExitCode: result.cliExitCode } : {}),
              ...(result.stderr !== undefined ? { stderr: result.stderr } : {}),
            },
          })
        );
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (pathname === '/api/v1/status') {
      const body: StatusResponse = {
        version: context.version,
        pid: process.pid,
        project: context.launchProjectRef,
      };
      sendJson(res, 200, body);
      return;
    }

    if (pathname === '/api/v1/changes') {
      const home = await resolveHome();
      const result = await handleChanges(context.launchProjectRoot ?? undefined, home);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/sessions' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const request = (body.value ?? {}) as Partial<LaunchSessionRequest>;
      const result = await handleLaunchSession(supervisor, context.launchProjectRoot ?? null, request);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (pathname === '/api/v1/sessions' && req.method === 'GET') {
      const home = await resolveHome();
      const response = handleListSessions(supervisor, context.launchProjectRoot ?? null, home);
      sendJson(res, 200, response);
      return;
    }

    const sessionId = matchSessionIdPath(pathname);
    if (sessionId !== null && req.method === 'GET') {
      const result = handleGetSession(supervisor, sessionId);
      if (!result.ok) {
        sendError(res, 404, 'not_found', `No session with id ${sessionId}.`);
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (sessionId !== null && req.method === 'DELETE') {
      const result = handleKillSession(supervisor, sessionId);
      if (!result.ok) {
        sendError(res, 404, 'not_found', `No session with id ${sessionId}.`);
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (pathname === '/api/v1/runs') {
      // No launch project means no changes could exist to report runs for —
      // an empty listing, not an error (unlike `/changes`, which requires a
      // resolvable project to enumerate at all).
      if (!context.launchProjectRoot) {
        sendJson(res, 200, { runs: [] });
        return;
      }
      const home = await resolveHome();
      const runsResponse = await handleRuns(context.launchProjectRoot, home);
      sendJson(res, 200, runsResponse);
      return;
    }
  };

  return { handle, supervisor };
}
