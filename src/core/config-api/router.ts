/**
 * Method + pathname dispatch for `/api/v1/*` (design.md D1/D2/D3/D4/D5 of
 * `unified-config-api`). No configuration logic lives here — every handler
 * wraps `resolveEffectiveConfig()`, the config-key registry, and the two
 * scope write paths (`updateProjectConfigKey`, `writeGlobalConfigKeyMinimalDiff`).
 */
import type * as http from 'node:http';

import {
  classifyWildcardPath,
  findConfigKeyDefinition,
  validateConfigKeyPath,
  validateConfigValue,
  NOT_SETTABLE_KEYS,
  type ConfigKeyDefinition,
  type ConfigScope,
} from '../config-keys.js';
import type { EffectiveConfigEntry } from '../effective-config.js';
import { resolveEffectiveConfig } from '../effective-config.js';
import { updateProjectConfigKey, type ResolvedGatePolicy } from '../project-config.js';
import { readProjectRegistryState } from '../project-registry.js';
import { pathIsDirectory } from '../file-state.js';
import {
  resolveConfigContext,
  contextResolveOptions,
  contextStoreRef,
  contextProjectRef,
  firstQueryValue,
  type ConfigContext,
} from './config-context.js';
import { serializeConfigEntry } from './serialize.js';
import { writeGlobalConfigKeyMinimalDiff, GlobalConfigWriteError } from './global-write.js';
import { serveStatic } from './static.js';
import type { ProjectRef, StoreLayerRef } from './wire-types.js';

/** A write scope on the config API — the registry scopes plus nothing else. */
type WriteScope = ConfigScope;
const WRITE_SCOPES: readonly WriteScope[] = ['global', 'store', 'project'];

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

/**
 * Finds the effective-config entry addressed by `key`. A wildcard family
 * instance matches by its `instanceKey`; a fixed key (or a family template)
 * matches by `definition.key`. The template guard (`instanceKey === undefined`)
 * keeps a family's template entry from shadowing an instance whose path equals
 * some other key.
 */
function findEntryByKey(
  entries: EffectiveConfigEntry[],
  key: string
): EffectiveConfigEntry | undefined {
  return entries.find(
    (e) => e.instanceKey === key || (e.instanceKey === undefined && e.definition.key === key)
  );
}

/**
 * The "absent shape" entry for a well-formed but unset wildcard family
 * instance path (design D5): a valid path returns no effective value rather
 * than an unknown-key error. Returns null when `key` is not a well-formed
 * family instance (the caller then answers unknown_key/404).
 */
function absentInstanceEntry(key: string): EffectiveConfigEntry | null {
  const classification = classifyWildcardPath(key);
  if (classification.kind !== 'match') return null;
  return {
    definition: classification.definition,
    value: undefined,
    source: 'default',
    scopeValues: {},
    instanceKey: key,
  };
}

async function handleHealth(res: http.ServerResponse, context: ConfigApiContext): Promise<void> {
  sendJson(res, 200, { ok: true, version: context.version, project: context.launchProjectRef });
}

async function handleListConfig(
  res: http.ServerResponse,
  url: URL,
  context: ConfigApiContext
): Promise<void> {
  const ctx = await resolveConfigContext(
    firstQueryValue(url, 'project'),
    firstQueryValue(url, 'space'),
    context
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.code, ctx.message, ctx.fix);
    return;
  }
  const entries = resolveEffectiveConfig(contextResolveOptions(ctx.context)).map(serializeConfigEntry);
  sendJson(res, 200, {
    project: contextProjectRef(ctx.context),
    store: contextStoreRef(ctx.context),
    entries,
  });
}

async function handleGetConfigKey(
  res: http.ServerResponse,
  url: URL,
  key: string,
  context: ConfigApiContext
): Promise<void> {
  const ctx = await resolveConfigContext(
    firstQueryValue(url, 'project'),
    firstQueryValue(url, 'space'),
    context
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.code, ctx.message, ctx.fix);
    return;
  }
  const entries = resolveEffectiveConfig(contextResolveOptions(ctx.context));
  const entry = findEntryByKey(entries, key) ?? absentInstanceEntry(key);
  if (!entry) {
    sendError(res, 404, 'unknown_key', `Unknown configuration key "${key}".`);
    return;
  }
  sendJson(res, 200, { entry: serializeConfigEntry(entry), store: contextStoreRef(ctx.context) });
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
 * Shared key-path/value validation for PUT and DELETE (D3/D5). Resolves the
 * registry definition (a fixed key or a wildcard family) the write targets so
 * the caller validates the value against it. There is no wildcard carve-out:
 * a family instance is an ordinary key — `featureFlags.<name>` included. A
 * malformed instance path names the family's pattern; a valid instance in a
 * scope the family does not admit names the settable scopes.
 */
function validateWriteKey(
  key: string,
  scope: ConfigScope,
  res: http.ServerResponse
): { ok: true; definition: ConfigKeyDefinition } | { ok: false } {
  const wildcard = classifyWildcardPath(key);
  if (wildcard.kind === 'wrong_shape') {
    sendError(res, 400, 'invalid_key', `"${key}" does not match the ${wildcard.definition.pattern} shape.`);
    return { ok: false };
  }
  if (wildcard.kind === 'bad_placeholder') {
    sendError(
      res,
      400,
      'invalid_key',
      `"${wildcard.segment}" is not a valid segment for ${wildcard.definition.pattern} (use letters, digits, hyphens, or underscores).`
    );
    return { ok: false };
  }
  if (wildcard.kind === 'match') {
    const family = wildcard.definition;
    if (!family.scopes.includes(scope)) {
      sendError(
        res,
        400,
        'invalid_scope',
        `"${key}" is not settable in scope "${scope}"; it is settable in: ${family.scopes.join(', ')}.`,
        `Use scope: ${family.scopes.map((s) => `"${s}"`).join(' or ')} instead.`
      );
      return { ok: false };
    }
    return { ok: true, definition: family };
  }

  const validation = validateConfigKeyPath(key, scope);
  if (!validation.valid) {
    if (NOT_SETTABLE_KEYS.has(key)) {
      sendError(res, 400, 'not_settable', validation.reason ?? `"${key}" is not settable.`);
      return { ok: false };
    }
    // Distinguish "this key doesn't exist at all" (404 unknown_key) from
    // "this key exists, just not in the scope you asked for" (400
    // invalid_scope). With three scopes, the hint names EVERY scope the key
    // IS settable in (registry lookup) rather than a binary other-scope
    // guess — e.g. `handoff.threshold` rejected at scope "global"? no; but
    // `profile` (global-only) PUT with scope "store" answers with `global`.
    const settableScopes = WRITE_SCOPES.filter(
      (candidate) => findConfigKeyDefinition(key, candidate) !== undefined
    );
    if (settableScopes.length > 0) {
      sendError(
        res,
        400,
        'invalid_scope',
        `"${key}" is not settable in scope "${scope}"; it is settable in: ${settableScopes.join(', ')}.`,
        `Use scope: ${settableScopes.map((s) => `"${s}"`).join(' or ')} instead.`
      );
    } else {
      sendError(res, 404, 'unknown_key', validation.reason ?? `Unknown configuration key "${key}".`);
    }
    return { ok: false };
  }
  return { ok: true, definition: findConfigKeyDefinition(key, scope)! };
}

async function respondWithReResolvedEntry(
  res: http.ServerResponse,
  key: string,
  context: ConfigContext
): Promise<void> {
  const entries = resolveEffectiveConfig(contextResolveOptions(context));
  // A family instance whose last value was just unset resolves to nothing, so
  // fall back to the absent shape rather than 500 (design D5: a valid instance
  // path reads as absent, not an error).
  const entry = findEntryByKey(entries, key) ?? absentInstanceEntry(key);
  if (!entry) {
    // Should not happen for any key that passed validateWriteKey, but fail
    // loudly rather than silently returning nothing.
    sendError(res, 500, 'internal_error', `"${key}" wrote successfully but could not be re-resolved.`);
    return;
  }
  sendJson(res, 200, { entry: serializeConfigEntry(entry), store: contextStoreRef(context) });
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
  const payload = body.value as {
    scope?: unknown;
    value?: unknown;
    project?: unknown;
    space?: unknown;
  };

  if (payload.scope !== 'global' && payload.scope !== 'store' && payload.scope !== 'project') {
    sendError(res, 400, 'scope_required', 'Body must include "scope": "global", "store", or "project".');
    return;
  }
  const scope: ConfigScope = payload.scope;

  if (!('value' in payload)) {
    sendError(res, 400, 'invalid_value', 'Body must include a "value" field.');
    return;
  }
  const value = payload.value;

  const keyCheck = validateWriteKey(key, scope, res);
  if (!keyCheck.ok) return;

  const valueError = validateConfigValue(keyCheck.definition, value);
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
  if (payload.space !== undefined && typeof payload.space !== 'string') {
    sendError(res, 400, 'bad_request', 'Body field "space" must be a string when present.');
    return;
  }
  const projectSelector = firstQueryValue(url, 'project') ?? payload.project;
  const spaceSelector = firstQueryValue(url, 'space') ?? payload.space;
  const ctx = await resolveConfigContext(projectSelector, spaceSelector, context);
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.code, ctx.message, ctx.fix);
    return;
  }

  if (scope === 'global') {
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
  } else {
    const target = resolveScopedWriteTarget(scope, ctx.context, res);
    if (!target.ok) return;
    try {
      updateProjectConfigKey(target.root, key, value);
    } catch (error) {
      sendError(res, 400, 'write_failed', error instanceof Error ? error.message : String(error));
      return;
    }
  }

  await respondWithReResolvedEntry(res, key, ctx.context);
}

/**
 * Resolves the file root a `store`- or `project`-scope write lands in, and
 * rejects a scope/space mismatch (design D6): a `store` write requires a store
 * context; a `project` write requires a project context with a resolvable
 * root. Global writes are space-independent and never reach here.
 */
function resolveScopedWriteTarget(
  scope: 'store' | 'project',
  context: ConfigContext,
  res: http.ServerResponse
): { ok: true; root: string } | { ok: false } {
  if (scope === 'store') {
    if (context.kind !== 'store') {
      sendError(
        res,
        400,
        'invalid_scope',
        'Scope "store" is only valid when addressing a store space.',
        'Address the store space with `?space=store:<id>`.'
      );
      return { ok: false };
    }
    return { ok: true, root: context.storeRoot };
  }

  // scope === 'project'
  if (context.kind === 'store') {
    sendError(
      res,
      400,
      'invalid_scope',
      'Scope "project" is not valid when addressing a store space.',
      'Use scope: "store" to edit the store\'s own values.'
    );
    return { ok: false };
  }
  if (!context.root) {
    sendError(
      res,
      400,
      'project_required',
      `Scope "project" requires a resolvable project; pass ?project=<id|root> or run "rasen config ui" inside a Rasen project.`
    );
    return { ok: false };
  }
  return { ok: true, root: context.root };
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
  if (scopeParam !== 'global' && scopeParam !== 'store' && scopeParam !== 'project') {
    sendError(res, 400, 'scope_required', 'Query must include "scope=global", "scope=store", or "scope=project".');
    return;
  }
  const scope: ConfigScope = scopeParam;

  if (!validateWriteKey(key, scope, res).ok) return;

  const ctx = await resolveConfigContext(
    firstQueryValue(url, 'project'),
    firstQueryValue(url, 'space'),
    context
  );
  if (!ctx.ok) {
    sendError(res, ctx.status, ctx.code, ctx.message, ctx.fix);
    return;
  }

  if (scope === 'global') {
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
  } else {
    const target = resolveScopedWriteTarget(scope, ctx.context, res);
    if (!target.ok) return;
    try {
      updateProjectConfigKey(target.root, key, undefined);
    } catch (error) {
      sendError(res, 400, 'write_failed', error instanceof Error ? error.message : String(error));
      return;
    }
  }

  await respondWithReResolvedEntry(res, key, ctx.context);
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
