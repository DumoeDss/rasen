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
import { resolveSpaceSelector } from '../config-api/project-addressing.js';
import { deriveSpaceFromCwd } from '../root-selection.js';
import type { ProjectHome } from '../project-home.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import { handleChanges } from './changes.js';
import { handleRuns } from './runs.js';
import {
  handleGetSession,
  handleKillSession,
  handleLaunchSession,
  handleListSessions,
  type LaunchSpaceResolution,
} from './sessions.js';
import { handleSpaces } from './spaces.js';
import { createSessionRegistry } from './session-registry.js';
import { createAgentCliResolver, createSessionSupervisor, type SessionSupervisor } from './supervisor.js';
import { createChangeSubmitter } from './submit.js';
import type { LaunchSessionRequest, StatusResponse, SubmitChangeRequest } from './wire-types.js';

/** Resolution of a request's optional `space` selector to a planning-space root (planning-space-addressing design D2). */
type RequestSpaceResolution =
  | { ok: true; root: string | undefined }
  | { ok: false; status: number; code: string; message: string };

function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return target;
  }
}

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
const MANAGEMENT_PATHS = new Set([
  '/api/v1/status',
  '/api/v1/changes',
  '/api/v1/runs',
  '/api/v1/sessions',
  '/api/v1/spaces',
]);

const SESSION_ID_PATH_PREFIX = '/api/v1/sessions/';

/** Session ids are server-minted `randomUUID()` values (design D2) — any RFC 4122 textual form is accepted, not just v4, since the format check exists to reject junk, not to pin a version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Matches `/api/v1/sessions/<id>` exactly one segment deep, where `<id>` is
 * UUID-shaped (design D4: "validated as UUID format before lookup" —
 * review m3). A deeper suffix (`/api/v1/sessions/<id>/extra`) or a
 * non-UUID single segment both return null and fall through to the rest of
 * the server's routing, same as any other unmatched path — a junk segment
 * was never a "sessions path" to begin with, not a 404 produced by this
 * route group.
 */
function matchSessionIdPath(pathname: string): string | null {
  if (!pathname.startsWith(SESSION_ID_PATH_PREFIX)) return null;
  const rest = pathname.slice(SESSION_ID_PATH_PREFIX.length);
  if (rest.length === 0 || rest.includes('/')) return null;
  if (!UUID_PATTERN.test(rest)) return null;
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
 * per-space project-home resolver (planning-space-addressing design D2):
 * `resolveHomeForRoot(root)` returns the read-only home for any resolved
 * space root, cached per root by the server, rather than letting this module
 * re-resolve it per request.
 */
export function createManagementRouter(
  context: ManagementApiContext,
  resolveHomeForRoot: (root: string | null) => Promise<ProjectHome | null>,
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

  // Resolves a request's optional `space` selector to a planning-space root
  // (design D2): an explicit selector resolves through the machine registries,
  // an omitted one falls back to the launch project (byte-compat with
  // pre-space clients). Read-only — resolution never mutates any registry.
  const resolveRequestSpace = async (selector: string | undefined): Promise<RequestSpaceResolution> => {
    if (!selector) {
      return { ok: true, root: context.launchProjectRoot ?? undefined };
    }
    const resolved = await resolveSpaceSelector(selector);
    if (!resolved.ok) return resolved;
    return { ok: true, root: resolved.space.root };
  };

  // Session-launch space resolution (design D3): an explicit selector sets the
  // cwd root and the frozen attribution verbatim; an omitted selector falls
  // back to the launch project with the attribution derived from that cwd (or
  // synthesized from the launch project ref when derivation finds no identity,
  // preserving the pre-space run-state join for an unregistered launch project).
  const resolveSessionSpace = async (selector: string | undefined): Promise<LaunchSpaceResolution> => {
    if (selector) {
      const resolved = await resolveSpaceSelector(selector);
      if (!resolved.ok) return resolved;
      return {
        ok: true,
        root: resolved.space.root,
        attribution: { type: resolved.space.type, id: resolved.space.id, root: resolved.space.root },
      };
    }
    const root = context.launchProjectRoot ?? undefined;
    if (!root) {
      return { ok: true, root: undefined, attribution: undefined };
    }
    const derived = await deriveSpaceFromCwd(root);
    const attribution = derived ?? {
      type: 'project' as const,
      id: context.launchProjectRef?.projectId ?? '',
      root: canonicalizeOrResolve(root),
    };
    return { ok: true, root, attribution };
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, rawPathname: string): Promise<void> => {
    const pathname = stripOneTrailingSlash(rawPathname);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const spaceSelector = url.searchParams.get('space') ?? undefined;

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
      // Resolve the optional body `space` before spawning (change-submission
      // spec: an unresolvable selector rejects the request before any
      // subprocess exists); an omitted selector falls back to the launch
      // project inside the submitter.
      if (request.space !== undefined && typeof request.space !== 'string') {
        sendError(res, 400, 'invalid_input', 'space must be a string.');
        return;
      }
      let submitRoot: string | undefined;
      if (typeof request.space === 'string' && request.space !== '') {
        const resolvedSpace = await resolveRequestSpace(request.space);
        if (!resolvedSpace.ok) {
          sendError(res, resolvedSpace.status, resolvedSpace.code, resolvedSpace.message);
          return;
        }
        submitRoot = resolvedSpace.root;
      }
      const result = await submitChange(request.name, request.description, submitRoot);
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
      const space = await resolveRequestSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const home = await resolveHomeForRoot(space.root ?? null);
      const result = await handleChanges(space.root, home);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/spaces') {
      sendJson(res, 200, await handleSpaces());
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
      const result = await handleLaunchSession(supervisor, request, resolveSessionSpace);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (pathname === '/api/v1/sessions' && req.method === 'GET') {
      // A `space` selector filters the listing to that space (design D3); an
      // omitted selector returns every session (compat), so — unlike the
      // data endpoints — there is no launch-project fallback here.
      let filterRoot: string | undefined;
      if (spaceSelector) {
        const resolved = await resolveSpaceSelector(spaceSelector);
        if (!resolved.ok) {
          sendError(res, resolved.status, resolved.code, resolved.message);
          return;
        }
        filterRoot = canonicalizeOrResolve(resolved.space.root);
      }
      const response = await handleListSessions(supervisor, filterRoot, (root) => resolveHomeForRoot(root));
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
      const space = await resolveRequestSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      // No resolvable root (no selector and no launch project) means no
      // changes could exist to report runs for — an empty listing, not an
      // error (unlike `/changes`, which requires a resolvable project).
      if (!space.root) {
        sendJson(res, 200, { runs: [] });
        return;
      }
      const home = await resolveHomeForRoot(space.root);
      const runsResponse = await handleRuns(space.root, home);
      sendJson(res, 200, runsResponse);
      return;
    }
  };

  return { handle, supervisor };
}
