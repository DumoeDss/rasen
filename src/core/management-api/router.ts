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
import { handleArchive } from './archive.js';
import { handleRuns } from './runs.js';
import { handleTaskDetail } from './task-detail.js';
import {
  handleGetSession,
  handleKillSession,
  handleLaunchSession,
  handleListSessions,
  type LaunchSpaceResolution,
} from './sessions.js';
import { handleSpaces, handleSpaceWorktrees } from './spaces.js';
import { handleLocalPaths } from './local-paths.js';
import { createSessionRegistry } from './session-registry.js';
import { createAgentCliResolver, createSessionSupervisor, type SessionSupervisor } from './supervisor.js';
import { createChangeSubmitter } from './submit.js';
import { createSpaceCreator } from './create-space.js';
import {
  handleWorkflowDetail,
  handleWorkflowValidation,
  handleWorkflowsList,
} from './workflows.js';
import { createWorkflowSubmitter } from './workflow-submit.js';
import { createWorkflowEnablementSubmitter, handleWorkflowEnablementRead } from './workflow-enablement.js';
import { handleListPipelines } from './pipelines.js';
import { createPipelineSubmitter } from './pipeline-submit.js';
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
  '/api/v1/archive',
  '/api/v1/runs',
  '/api/v1/sessions',
  '/api/v1/spaces',
  '/api/v1/spaces/worktrees',
  '/api/v1/local-paths',
  '/api/v1/workflows',
  '/api/v1/workflow-validation',
  '/api/v1/workflow-enablement',
  '/api/v1/pipelines',
]);

const SESSION_ID_PATH_PREFIX = '/api/v1/sessions/';
const TASK_ID_PATH_PREFIX = '/api/v1/tasks/';
const WORKFLOW_ID_PATH_PREFIX = '/api/v1/workflows/';
const PIPELINE_ID_PATH_PREFIX = '/api/v1/pipelines/';

/**
 * Matches `/api/v1/tasks/<id>` exactly one segment deep (mirrors
 * `matchSessionIdPath`), returning the percent-decoded id. Unlike a session
 * id, the id is a change/portfolio NAME, not a UUID — no format constraint is
 * applied here (the handler validates it via `validateChangeName`); the check
 * only rejects a missing or multi-segment suffix, which was never a "tasks
 * path" to begin with and falls through to the rest of the server's routing.
 */
function matchTaskIdPath(pathname: string): string | null {
  if (!pathname.startsWith(TASK_ID_PATH_PREFIX)) return null;
  const rest = pathname.slice(TASK_ID_PATH_PREFIX.length);
  if (rest.length === 0 || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/**
 * Matches `/api/v1/workflows/<id>` exactly one segment deep (workflow-http-api
 * design D3), returning the percent-decoded id. Workflow ids are user-chosen,
 * so NO format constraint is applied here — a workflow legitimately named
 * `validate` must resolve as a detail path, and the handler returns 404 for an
 * unknown id. The check only rejects a missing or multi-segment suffix
 * (`/api/v1/workflows/<id>/extra` falls through to the rest of the server's
 * routing, spec: "Deeper workflow suffixes are not management paths"). The
 * bare collection `/api/v1/workflows` has no trailing slash and so never
 * matches this prefix.
 */
function matchWorkflowIdPath(pathname: string): string | null {
  if (!pathname.startsWith(WORKFLOW_ID_PATH_PREFIX)) return null;
  const rest = pathname.slice(WORKFLOW_ID_PATH_PREFIX.length);
  if (rest.length === 0 || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/**
 * Matches `/api/v1/pipelines/<name>` exactly one segment deep (mirrors
 * `matchWorkflowIdPath`; unify-pipeline-http-api design D2), reserving the
 * detail path for a future change. Until that contract lands, a matched path
 * answers the management group's 404 `not_found` rather than falling through
 * (deeper suffixes still fall through — `/api/v1/pipelines/<name>/extra` was
 * never a "pipelines path" to begin with).
 */
function matchPipelineIdPath(pathname: string): string | null {
  if (!pathname.startsWith(PIPELINE_ID_PATH_PREFIX)) return null;
  const rest = pathname.slice(PIPELINE_ID_PATH_PREFIX.length);
  if (rest.length === 0 || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

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

/** Methods admitted per management path (design D1/D4; space-creation D5): everywhere GETs, `/changes`, `/sessions`, and `/spaces` also POST, session-id paths also DELETE. */
function isMethodAdmitted(pathname: string, method: string | undefined): boolean {
  if (matchSessionIdPath(pathname) !== null) {
    return method === 'GET' || method === 'DELETE';
  }
  if (matchTaskIdPath(pathname) !== null) {
    return method === 'GET';
  }
  if (matchWorkflowIdPath(pathname) !== null) {
    return method === 'GET';
  }
  if (matchPipelineIdPath(pathname) !== null) {
    // The detail contract does not exist yet — every method reaches the
    // dispatch below, which answers 404 uniformly (design D2): a reserved
    // path that has no contract yet is "not found", not "method not allowed".
    return true;
  }
  if (pathname === '/api/v1/workflows') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/workflow-enablement') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/sessions') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/pipelines') {
    return method === 'GET' || method === 'POST';
  }
  if (method === 'GET') return true;
  return (
    (pathname === '/api/v1/changes' || pathname === '/api/v1/spaces') && method === 'POST'
  );
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
  return (
    MANAGEMENT_PATHS.has(stripped) ||
    matchSessionIdPath(stripped) !== null ||
    matchTaskIdPath(stripped) !== null ||
    matchWorkflowIdPath(stripped) !== null ||
    matchPipelineIdPath(stripped) !== null
  );
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string, fix?: string): void {
  sendJson(res, status, { error: { code, message, ...(fix ? { fix } : {}) } });
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

  // One space creator per server instance (space-creation design D5): its own
  // cap-1 concurrency, independent of change submission's cap.
  const createSpace = createSpaceCreator();
  // The workflow mutation bridge (workflow-http-api design D4): its own cap-1
  // state, admitting only the four workflow bounded-cli ops.
  const submitWorkflow = createWorkflowSubmitter(context);
  // The per-space workflow-enablement mutation bridge (space-workflow-
  // enablement design D5): its own cap-1 state, independent of the
  // workflow-library bridge above.
  const submitWorkflowEnablement = createWorkflowEnablementSubmitter(context);
  // The pipeline-library mutation bridge (pipeline-http-api design D6,
  // unify-pipeline-http-api design D3): its own cap-1 concurrency, admitting
  // only the four pipeline bounded-cli ops through the shared admission
  // whitelist. GET /api/v1/pipelines is this router's own read handler; POST
  // rides this bridge.
  const submitPipeline = createPipelineSubmitter(context);

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

    if (pathname === '/api/v1/workflows' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      // The workflow bridge guards and admits its own input (unknown op → 400,
      // relative path / option-shaped id → 400, all before any spawn); no
      // `space` selector — workflow endpoints have no space addressing (design
      // D2), so cwd is the launch project resolved inside the submitter.
      const result = await submitWorkflow(body.value ?? {});
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

    if (pathname === '/api/v1/workflow-enablement' && req.method === 'GET') {
      const result = await handleWorkflowEnablementRead(url.searchParams.get('root') ?? undefined);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/workflow-enablement' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const result = await submitWorkflowEnablement(body.value ?? {});
      if (!result.ok) {
        res.writeHead(result.status, JSON_HEADERS);
        res.end(
          JSON.stringify({
            error: { code: result.code, message: result.message },
            ...(result.state !== undefined ? { state: result.state } : {}),
          })
        );
        return;
      }
      sendJson(res, 200, result.response);
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

    if (pathname === '/api/v1/archive') {
      // Space-resolved exactly like `/changes`: explicit selector through the
      // registries, omitted → launch-project fallback, no root → 400.
      const space = await resolveRequestSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const home = await resolveHomeForRoot(space.root ?? null);
      const result = await handleArchive(space.root, home);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/spaces' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const result = await createSpace(body.value);
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

    if (pathname === '/api/v1/spaces') {
      sendJson(res, 200, await handleSpaces());
      return;
    }

    if (pathname === '/api/v1/spaces/worktrees') {
      // Space-resolved exactly like `/changes` (worktree-aware-spaces D3):
      // explicit selector through the registries, omitted → launch-project
      // fallback. A resolved-but-non-git root yields an empty inventory; no
      // resolvable root at all likewise yields an empty inventory, never an error.
      const space = await resolveRequestSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      if (!space.root) {
        sendJson(res, 200, { worktrees: [] });
        return;
      }
      sendJson(res, 200, await handleSpaceWorktrees(space.root));
      return;
    }

    if (pathname === '/api/v1/local-paths') {
      const pathParam = url.searchParams.get('path') ?? undefined;
      const result = await handleLocalPaths(pathParam);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/workflows' && req.method === 'GET') {
      const result = handleWorkflowsList();
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/workflow-validation') {
      // No space addressing on workflow endpoints (design D2): the validation
      // project context is the server's launch project, falling back to the
      // server cwd — exactly as the CLI resolves it from its own cwd.
      const target = url.searchParams.get('target') ?? undefined;
      const projectRoot = context.launchProjectRoot ?? process.cwd();
      const result = handleWorkflowValidation(target, projectRoot);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    const workflowId = matchWorkflowIdPath(pathname);
    if (workflowId !== null && req.method === 'GET') {
      const result = handleWorkflowDetail(workflowId);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/pipelines' && req.method === 'GET') {
      await handleListPipelines(res, url, context, sendError, sendJson);
      return;
    }

    if (pathname === '/api/v1/pipelines' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      // The bridge guards and admits its own input (unknown op → 400,
      // relative path / option-shaped name → 400, all before any spawn).
      const result = await submitPipeline(body.value ?? {});
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

    if (matchPipelineIdPath(pathname) !== null) {
      // The detail contract does not exist yet (unify-pipeline-http-api
      // design D2): a reserved path answers not-found from the management
      // group rather than falling through to another route group.
      sendError(res, 404, 'not_found', `No route for ${req.method} ${pathname}.`);
      return;
    }

    const taskId = matchTaskIdPath(pathname);
    if (taskId !== null && req.method === 'GET') {
      // Space-resolved exactly like `/changes`: explicit selector through the
      // registries, omitted → launch-project fallback, no root → 400.
      const space = await resolveRequestSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const home = await resolveHomeForRoot(space.root ?? null);
      const result = await handleTaskDetail(space.root, home, taskId);
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
