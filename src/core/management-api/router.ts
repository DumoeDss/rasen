/**
 * Method + pathname dispatch for the management route group (design.md D2 of
 * `rasen-ui-slice1-readonly-api`): handles `GET /api/v1/status|changes|runs`
 * itself and delegates every other request — config-api endpoints and static
 * assets alike — to the existing `createRouter` from `config-api/router.js`,
 * called with the same token/context. `config-api/router.ts` is never
 * modified; this only imports its public `createRouter` export.
 */
import type * as http from 'node:http';

import { createRouter as createConfigRouter, type ConfigApiContext } from '../config-api/router.js';
import { handleChanges } from './changes.js';
import { handleRuns } from './runs.js';
import type { StatusResponse } from './wire-types.js';

/** Same shape as the config API's context — one token, one launch project, one server. */
export type ManagementApiContext = ConfigApiContext;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const MANAGEMENT_PATHS = new Set(['/api/v1/status', '/api/v1/changes', '/api/v1/runs']);

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

/** Builds the request handler for the management server, closed over one session's context. */
export function createRouter(
  context: ManagementApiContext
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  // A single delegate instance, built once — `createRouter` (config-api) is a
  // pure function of `context`, so there is no benefit to rebuilding it per
  // request, and it keeps delegation cheap on the hot path.
  const delegate = createConfigRouter(context);

  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (!MANAGEMENT_PATHS.has(pathname)) {
      await delegate(req, res);
      return;
    }

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
      const result = await handleChanges(context.launchProjectRoot ?? undefined);
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
    const runsResponse = await handleRuns(context.launchProjectRoot);
    sendJson(res, 200, runsResponse);
  };
}
