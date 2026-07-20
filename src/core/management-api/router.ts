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
import type { StatusResponse } from './wire-types.js';

/** Same shape as the config API's context — one token, one launch project, one server. */
export type ManagementApiContext = ConfigApiContext;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** The three management endpoints, canonical (no trailing slash) form. */
const MANAGEMENT_PATHS = new Set(['/api/v1/status', '/api/v1/changes', '/api/v1/runs']);

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
  return MANAGEMENT_PATHS.has(stripOneTrailingSlash(pathname));
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
  resolveHome: () => Promise<ProjectHome | null>
): (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => Promise<void> {
  return async (req, res, rawPathname) => {
    const pathname = stripOneTrailingSlash(rawPathname);

    if (!isAuthorized(req, context.token)) {
      sendError(res, 401, 'unauthorized', 'Missing or invalid bearer token.');
      return;
    }

    if (req.method !== 'GET') {
      sendError(res, 405, 'method_not_allowed', `${req.method} not allowed on ${pathname}.`);
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

    // pathname === '/api/v1/runs': no launch project means no changes could
    // exist to report runs for — an empty listing, not an error (unlike
    // `/changes`, which requires a resolvable project to enumerate at all).
    if (!context.launchProjectRoot) {
      sendJson(res, 200, { runs: [] });
      return;
    }
    const home = await resolveHome();
    const runsResponse = await handleRuns(context.launchProjectRoot, home);
    sendJson(res, 200, runsResponse);
  };
}
