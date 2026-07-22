/**
 * Method + pathname dispatch for `/api/v1/*` (design.md D1/D2/D3/D4/D5 of
 * `unified-config-api`). No configuration logic lives here — every handler
 * wraps `resolveEffectiveConfig()`, the config-key registry, and the two
 * scope write paths (`updateProjectConfigKey`, `writeGlobalConfigKeyMinimalDiff`).
 */
import type * as http from 'node:http';

import {
  findConfigKeyDefinition,
  findWildcardDefinition,
  validateConfigKeyPath,
  validateConfigValue,
  NOT_SETTABLE_KEYS,
  type ConfigScope,
} from '../config-keys.js';
import { resolveEffectiveConfig } from '../effective-config.js';
import { updateProjectConfigKey } from '../project-config.js';
import { readProjectRegistryState } from '../project-registry.js';
import { pathIsDirectory } from '../file-state.js';
import { listPipelinesWithInfo, loadPipelineByName } from '../pipeline-registry/index.js';
import { resolveProjectSelector } from './project-addressing.js';
import { serializeConfigEntry } from './serialize.js';
import { writeGlobalConfigKeyMinimalDiff, GlobalConfigWriteError } from './global-write.js';
import { serveStatic } from './static.js';
import type { ProjectRef, WirePipeline } from './wire-types.js';

export interface ConfigApiContext {
  /** Per-session bearer token minted at server startup (D5). */
  token: string;
  /** The Rasen root resolved from cwd at server startup, or null outside a project. */
  launchProjectRoot: string | null;
  launchProjectRef: ProjectRef | null;
  /** CLI version, from package.json. */
  version: string;
  /** Resolved UI package `dist/` directory, or null when not installed (D7). */
  uiAssetsDir: string | null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function sendError(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
  fix?: string
): void {
  sendJson(res, status, { error: { code, message, ...(fix ? { fix } : {}) } });
}

type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; code: string; message: string };

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
      if (settled) return; // already over cap; drain without buffering further
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        // Deliberately do NOT req.destroy() here: that tears down the whole
        // duplex socket and would drop the 413 response the router is about
        // to write on it. Just stop buffering — the client's remaining
        // bytes drain harmlessly once 'end' fires (or the socket closes
        // after the response, whichever the client does first).
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
      if (raw.trim() === '') {
        finish({ ok: true, value: undefined });
        return;
      }
      try {
        finish({ ok: true, value: JSON.parse(raw) });
      } catch {
        finish({ ok: false, status: 400, code: 'bad_request', message: 'Request body is not valid JSON.' });
      }
    });
    req.on('error', () => {
      finish({ ok: false, status: 400, code: 'bad_request', message: 'Failed to read the request body.' });
    });
  });
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match !== null && match[1] === token;
}

function hasJsonContentType(req: http.IncomingMessage): boolean {
  const raw = req.headers['content-type'];
  if (!raw) return false;
  return raw.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

interface ProjectContextOk {
  ok: true;
  root: string | undefined;
  ref: ProjectRef | null;
}
interface ProjectContextErr {
  ok: false;
  status: number;
  code: string;
  message: string;
  fix?: string;
}

/**
 * Resolves the `project` selector (explicit id/root, or the server's launch
 * project when omitted) shared by every read and write endpoint (D4).
 */
async function resolveProjectContext(
  selector: string | undefined,
  context: ConfigApiContext
): Promise<ProjectContextOk | ProjectContextErr> {
  if (selector === undefined || selector === '') {
    return { ok: true, root: context.launchProjectRoot ?? undefined, ref: context.launchProjectRef };
  }
  const resolved = await resolveProjectSelector(selector);
  if (!resolved) {
    return {
      ok: false,
      status: 404,
      code: 'project_not_found',
      message: `No registered project matches "${selector}".`,
      fix: 'Open the project with the CLI once (run any `rasen` command inside it to register it), then retry.',
    };
  }
  return { ok: true, root: resolved.root, ref: resolved.ref };
}

function firstQueryValue(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null ? undefined : value;
}

async function handleHealth(res: http.ServerResponse, context: ConfigApiContext): Promise<void> {
  sendJson(res, 200, { ok: true, version: context.version, project: context.launchProjectRef });
}

async function handleListConfig(
  res: http.ServerResponse,
  url: URL,
  context: ConfigApiContext
): Promise<void> {
  const projectCtx = await resolveProjectContext(firstQueryValue(url, 'project'), context);
  if (!projectCtx.ok) {
    sendError(res, projectCtx.status, projectCtx.code, projectCtx.message, projectCtx.fix);
    return;
  }
  const entries = resolveEffectiveConfig({ projectRoot: projectCtx.root }).map(serializeConfigEntry);
  sendJson(res, 200, { project: projectCtx.ref, entries });
}

async function handleGetConfigKey(
  res: http.ServerResponse,
  url: URL,
  key: string,
  context: ConfigApiContext
): Promise<void> {
  const projectCtx = await resolveProjectContext(firstQueryValue(url, 'project'), context);
  if (!projectCtx.ok) {
    sendError(res, projectCtx.status, projectCtx.code, projectCtx.message, projectCtx.fix);
    return;
  }
  const entry = resolveEffectiveConfig({ projectRoot: projectCtx.root }).find(
    (e) => e.definition.key === key
  );
  if (!entry) {
    sendError(res, 404, 'unknown_key', `Unknown configuration key "${key}".`);
    return;
  }
  sendJson(res, 200, { entry: serializeConfigEntry(entry) });
}

async function handleListProjects(res: http.ServerResponse): Promise<void> {
  const state = await readProjectRegistryState();
  // Registry entries whose root no longer exists on disk (deleted clones,
  // leaked test temp dirs) are dead weight for a switcher UI — filter them
  // here rather than surfacing them for the user to trip over. Read-only:
  // actually pruning the registry stays `rasen doctor --gc`'s job.
  const entries = state ? Object.entries(state.projects) : [];
  const liveFlags = await Promise.all(entries.map(([root]) => pathIsDirectory(root)));
  const projects: ProjectRef[] = entries
    .filter((_, i) => liveFlags[i])
    .map(([root, entry]) => ({
      projectId: entry.projectId,
      name: entry.name,
      root,
    }));
  sendJson(res, 200, { projects });
}

/**
 * Read-only gates inventory (D5): reuses the same in-process pipeline
 * registry loader the CLI uses (`listPipelinesWithInfo` +
 * `loadPipelineByName`), resolved against the server's launch project root
 * — no pipeline logic reimplemented here. A pipeline that fails to (re)load
 * between the listing and load calls (e.g. deleted mid-request) is skipped
 * rather than failing the whole response.
 */
async function handleListPipelines(
  res: http.ServerResponse,
  context: ConfigApiContext
): Promise<void> {
  const projectRoot = context.launchProjectRoot ?? undefined;
  const infos = listPipelinesWithInfo(projectRoot);
  const pipelines: WirePipeline[] = [];
  for (const info of infos) {
    let pipeline;
    try {
      pipeline = loadPipelineByName(info.name, projectRoot);
    } catch {
      continue;
    }
    pipelines.push({
      name: pipeline.name,
      description: pipeline.description ?? '',
      stages: pipeline.stages.map((stage) => ({
        id: stage.id,
        role: stage.role ?? null,
        skill: stage.skill ?? null,
        gate: stage.gate,
      })),
    });
  }
  sendJson(res, 200, { pipelines });
}

/** Shared key-path/value validation for PUT and DELETE (D3). */
function validateWriteKey(
  key: string,
  scope: ConfigScope,
  res: http.ServerResponse
): { ok: true } | { ok: false } {
  const rawKeys = key.split('.');
  if (rawKeys.length === 2 && findWildcardDefinition(rawKeys[0]!, scope)) {
    sendError(
      res,
      400,
      'not_supported',
      `"${key}" (a featureFlags entry) is not exposed via the config API in v1.`,
      `Use \`rasen config set --scope global ${key} <value>\` instead.`
    );
    return { ok: false };
  }

  const validation = validateConfigKeyPath(key, scope);
  if (!validation.valid) {
    if (NOT_SETTABLE_KEYS.has(key)) {
      sendError(res, 400, 'not_settable', validation.reason ?? `"${key}" is not settable.`);
      return { ok: false };
    }
    // Distinguish "this key doesn't exist at all" (404 unknown_key) from
    // "this key exists, just not in the scope you asked for" (400
    // invalid_scope) — a real registry key like `repoMode` (global-only)
    // PUT with scope: "project" is a plausible client mistake, not a typo'd
    // key, and answering 404 for it is misleading (M3).
    const otherScope: ConfigScope = scope === 'global' ? 'project' : 'global';
    const otherScopeDefinition = findConfigKeyDefinition(key, otherScope);
    if (otherScopeDefinition) {
      sendError(
        res,
        400,
        'invalid_scope',
        `"${key}" is only settable in scope "${otherScope}", not "${scope}".`,
        `Use scope: "${otherScope}" instead.`
      );
    } else {
      sendError(res, 404, 'unknown_key', validation.reason ?? `Unknown configuration key "${key}".`);
    }
    return { ok: false };
  }
  return { ok: true };
}

async function respondWithReResolvedEntry(
  res: http.ServerResponse,
  key: string,
  projectRoot: string | undefined
): Promise<void> {
  const entry = resolveEffectiveConfig({ projectRoot }).find((e) => e.definition.key === key);
  if (!entry) {
    // Should not happen for any key that passed validateWriteKey (wildcard
    // leaves are rejected before a write is attempted), but fail loudly
    // rather than silently returning nothing.
    sendError(res, 500, 'internal_error', `"${key}" wrote successfully but could not be re-resolved.`);
    return;
  }
  sendJson(res, 200, { entry: serializeConfigEntry(entry) });
}

async function handlePutConfigKey(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  key: string,
  context: ConfigApiContext
): Promise<void> {
  if (!hasJsonContentType(req)) {
    sendError(res, 415, 'unsupported_media_type', 'PUT requires "Content-Type: application/json".');
    return;
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, body.status, body.code, body.message);
    return;
  }
  if (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
    sendError(res, 400, 'bad_request', 'Request body must be a JSON object.');
    return;
  }
  const payload = body.value as { scope?: unknown; value?: unknown; project?: unknown };

  if (payload.scope !== 'global' && payload.scope !== 'project') {
    sendError(res, 400, 'scope_required', 'Body must include "scope": "global" or "project".');
    return;
  }
  const scope: ConfigScope = payload.scope;

  if (!('value' in payload)) {
    sendError(res, 400, 'invalid_value', 'Body must include a "value" field.');
    return;
  }
  const value = payload.value;

  if (!validateWriteKey(key, scope, res).ok) return;

  const definition = findConfigKeyDefinition(key, scope)!;
  const valueError = validateConfigValue(definition, value);
  if (valueError) {
    sendError(res, 400, 'invalid_value', valueError);
    return;
  }

  if (payload.project !== undefined && typeof payload.project !== 'string') {
    // A present-but-wrong-type `project` must not be silently ignored: that
    // would fall back to the launch project and could land a write in the
    // wrong project's config.yaml with no client-visible error (M2).
    sendError(res, 400, 'bad_request', 'Body field "project" must be a string when present.');
    return;
  }
  const selector = firstQueryValue(url, 'project') ?? payload.project;
  const projectCtx = await resolveProjectContext(selector, context);
  if (!projectCtx.ok) {
    sendError(res, projectCtx.status, projectCtx.code, projectCtx.message, projectCtx.fix);
    return;
  }

  if (scope === 'project') {
    if (!projectCtx.root) {
      sendError(
        res,
        400,
        'project_required',
        `Scope "project" requires a resolvable project; pass ?project=<id|root> or run "rasen config ui" inside a Rasen project.`
      );
      return;
    }
    try {
      updateProjectConfigKey(projectCtx.root, key, value);
    } catch (error) {
      sendError(
        res,
        400,
        'write_failed',
        error instanceof Error ? error.message : String(error)
      );
      return;
    }
  } else {
    try {
      writeGlobalConfigKeyMinimalDiff(key, value);
    } catch (error) {
      if (error instanceof GlobalConfigWriteError) {
        sendError(res, 400, 'invalid_value', error.message);
      } else {
        // A fs-layer failure (EACCES, disk full, ...) — not a validation
        // problem, so `write_failed` (not `invalid_value`/`internal_error`)
        // is the accurate D2 code; 500 because it's a server/environment
        // fault, not something the client's request caused (M4).
        sendError(res, 500, 'write_failed', error instanceof Error ? error.message : String(error));
      }
      return;
    }
  }

  await respondWithReResolvedEntry(res, key, projectCtx.root);
}

async function handleDeleteConfigKey(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  key: string,
  context: ConfigApiContext
): Promise<void> {
  if (!hasJsonContentType(req)) {
    sendError(res, 415, 'unsupported_media_type', 'DELETE requires "Content-Type: application/json".');
    return;
  }

  const scopeParam = firstQueryValue(url, 'scope');
  if (scopeParam !== 'global' && scopeParam !== 'project') {
    sendError(res, 400, 'scope_required', 'Query must include "scope=global" or "scope=project".');
    return;
  }
  const scope: ConfigScope = scopeParam;

  if (!validateWriteKey(key, scope, res).ok) return;

  const projectCtx = await resolveProjectContext(firstQueryValue(url, 'project'), context);
  if (!projectCtx.ok) {
    sendError(res, projectCtx.status, projectCtx.code, projectCtx.message, projectCtx.fix);
    return;
  }

  if (scope === 'project') {
    if (!projectCtx.root) {
      sendError(
        res,
        400,
        'project_required',
        `Scope "project" requires a resolvable project; pass ?project=<id|root> or run "rasen config ui" inside a Rasen project.`
      );
      return;
    }
    try {
      updateProjectConfigKey(projectCtx.root, key, undefined);
    } catch (error) {
      sendError(res, 400, 'write_failed', error instanceof Error ? error.message : String(error));
      return;
    }
  } else {
    try {
      writeGlobalConfigKeyMinimalDiff(key, undefined);
    } catch (error) {
      if (error instanceof GlobalConfigWriteError) {
        sendError(res, 400, 'invalid_value', error.message);
      } else {
        // A fs-layer failure (EACCES, disk full, ...) — not a validation
        // problem, so `write_failed` (not `invalid_value`/`internal_error`)
        // is the accurate D2 code; 500 because it's a server/environment
        // fault, not something the client's request caused (M4).
        sendError(res, 500, 'write_failed', error instanceof Error ? error.message : String(error));
      }
      return;
    }
  }

  await respondWithReResolvedEntry(res, key, projectCtx.root);
}

/** Builds the request handler for the config API server, closed over one session's context. */
export function createRouter(
  context: ConfigApiContext
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      await serveStatic(context.uiAssetsDir, pathname, res);
      return;
    }

    if (!isAuthorized(req, context.token)) {
      sendError(res, 401, 'unauthorized', 'Missing or invalid bearer token.');
      return;
    }

    if (pathname === '/api/v1/health') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'method_not_allowed', `${req.method} not allowed on /api/v1/health.`);
        return;
      }
      await handleHealth(res, context);
      return;
    }

    if (pathname === '/api/v1/projects') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'method_not_allowed', `${req.method} not allowed on /api/v1/projects.`);
        return;
      }
      await handleListProjects(res);
      return;
    }

    if (pathname === '/api/v1/pipelines') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'method_not_allowed', `${req.method} not allowed on /api/v1/pipelines.`);
        return;
      }
      await handleListPipelines(res, context);
      return;
    }

    if (pathname === '/api/v1/config') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'method_not_allowed', `${req.method} not allowed on /api/v1/config.`);
        return;
      }
      await handleListConfig(res, url, context);
      return;
    }

    const keyMatch = /^\/api\/v1\/config\/(.+)$/.exec(pathname);
    if (keyMatch) {
      let key: string;
      try {
        key = decodeURIComponent(keyMatch[1]!);
      } catch {
        // Malformed percent-encoding (e.g. "%zz") throws URIError — a
        // malformed request, not a server fault (M1).
        sendError(res, 400, 'bad_request', 'Malformed percent-encoding in the key path segment.');
        return;
      }
      if (req.method === 'GET') {
        await handleGetConfigKey(res, url, key, context);
        return;
      }
      if (req.method === 'PUT') {
        await handlePutConfigKey(req, res, url, key, context);
        return;
      }
      if (req.method === 'DELETE') {
        await handleDeleteConfigKey(req, res, url, key, context);
        return;
      }
      sendError(res, 405, 'method_not_allowed', `${req.method} not allowed on /api/v1/config/<key>.`);
      return;
    }

    sendError(res, 404, 'not_found', `No route for ${req.method} ${pathname}.`);
  };
}
