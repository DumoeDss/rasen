/**
 * Handler for the management route group only (design.md D2 of
 * `rasen-ui-unify-management-surface`): `GET /api/v1/status|changes|runs`.
 * The server (not this module) decides whether a request belongs here — via
 * `isManagementPath` — and owns the config route group's delegate; this
 * module no longer constructs it (that was `rasen-ui-slice1-readonly-api`'s
 * shape, before the two route groups became the server's composition seam).
 */
import type * as http from 'node:http';
import * as path from 'node:path';

import type { ConfigApiContext } from '../config-api/router.js';
import { resolveSpaceSelector } from '../config-api/project-addressing.js';
import type { ProjectHome } from '../project-home.js';
import {
  getProjectRegistryPath,
  parseProjectRegistryState,
} from '../project-registry.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { derivePlanningSpaceId } from '../change-run/internal/identity.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import { handleChanges } from './changes.js';
import { handleArchive } from './archive.js';
import {
  resolveStoreSpace,
  handleStoreProjects,
  handleStoreTargetLines,
  handleStoreChanges,
  handleStoreIssues,
  handleStoreIssue,
  handleStoreIssueReferences,
  handleStoreExecutionPlan,
  handleStoreIssueCreate,
  handleStoreIssueSetState,
  handleStorePublishPlan,
  type StoreChangesFilter,
} from './stores.js';
import { handleRuns, handleRunDetail } from './runs.js';
import { handleRunControl, createProductionRunControlSpawner, type RunControlSpawner } from './run-control.js';
import { handleTaskDetail } from './task-detail.js';
import {
  handleGetSession,
  handleKillSession,
  handleLaunchSession,
  handleListSessions,
} from './sessions.js';
import { handleSpaces, handleSpaceWorktrees } from './spaces.js';
import { handleLocalPaths } from './local-paths.js';
import { resolveLocalPath } from './local-path-resolver.js';
import { createLocalPathChooser } from './local-path-chooser.js';
import { createSessionRegistry } from './session-registry.js';
import { createAgentCliResolver, createSessionSupervisor, type SessionSupervisor } from './supervisor.js';
import { createSessionHost } from '../session-host/host.js';
import { createSessionHostRegistry } from '../session-host/registry.js';
import { createClaudeSessionBackend } from '../session-host/claude-backend.js';
import { createSessionHostOwnership } from '../session-host/ownership.js';
import { createHostedProcessScope } from '../session-host/process-capsule/hosted-process-scope.js';
import type {
  ExactTeacherAttemptPhaseCommitter,
  SessionHost,
  SessionHostCommand,
} from '../session-host/contracts.js';
import {
  createExactTeacherAttemptJournal,
  createExactTeacherAttemptPersistence,
  type ExactTeacherAuthorityPolicy,
  type TrustedCompletionProducerResolver,
} from '../frozen-action-executor/index.js';
import type { WorkspaceReservationRegistry } from '../change-run/internal/reservations.js';
import {
  handleHostedSessionDispatch,
  hostedSessionToWire,
} from './hosted-sessions.js';
import {
  handleFrozenActionContinuation,
  handleFrozenActionDispatch,
} from './frozen-action-executor.js';
import {
  createReusableSessionService,
  reusableSessionHttpStatus,
  type ReusableSessionOwnerShutdownResult,
  type ReusableSessionService,
} from './reusable-session-api.js';
import { createChangeSubmitter } from './submit.js';
import { createSpaceCreator } from './create-space.js';
import {
  handleWorkflowDependenciesRead,
  handleWorkflowDetail,
  handleWorkflowValidation,
  handleWorkflowsList,
} from './workflows.js';
import { createWorkflowSubmitter } from './workflow-submit.js';
import { createWorkflowEnablementSubmitter, handleWorkflowEnablementRead } from './workflow-enablement.js';
import { handleProfileMutation, handleProfilesRead } from './profiles.js';
import { handleListPipelines, handlePipelineCatalog, handlePipelineDetail, handlePipelineValidation } from './pipelines.js';
import {
  handleThresholdSchemeCatalog,
  handleThresholdSchemeMutation,
} from './threshold-schemes.js';
import { createPipelineSubmitter } from './pipeline-submit.js';
import {
  REUSABLE_SESSION_API_SCHEMA,
  type LaunchSessionRequest,
  type StatusResponse,
  type SubmitChangeRequest,
} from './wire-types.js';
import {
  installTheme,
  listImportedThemes,
  MAX_THEME_BYTES,
  ThemeLibraryError,
} from '../theme-library/index.js';
import {
  AuditManagementService,
  AuditServiceError,
  MAX_RECENT_AUDIT_LIMIT,
  type AuditManagementOptions,
} from '../token-audit/management.js';
import { hasRuntimeCapability } from '../runtime-adapters.js';
import { getGlobalDataDir } from '../global-config.js';

/**
 * Extended resolution for the runs endpoints, which additionally accept a
 * `planning:<PlanningSpaceId>` selector (design §13). The selector is resolved
 * through the registered project homes to one canonical physical root before
 * list, detail, or control authorization is evaluated.
 */
type RunsSpaceResolution =
  | { ok: true; root: string | undefined; planningSpaceId?: string }
  | { ok: false; status: number; code: string; message: string; candidates?: string[] };

/** Resolution of a request's optional `space` selector to a planning-space root (planning-space-addressing design D2). */
type RequestSpaceResolution =
  | { ok: true; root: string | undefined }
  | { ok: false; status: number; code: string; message: string };

/**
 * Checks whether a `project:<projectId>` selector matches multiple registered
 * independent clones (design §13: duplicate clone homes →
 * `project_selector_ambiguous`). Returns candidate PlanningSpaceIds when
 * ambiguous so the client can disambiguate with `planning:<id>`.
 */
function checkProjectAmbiguity(projectId: string): { ambiguous: boolean; candidates: string[] } {
  const registryPath = getProjectRegistryPath();
  if (!existsSync(registryPath)) return { ambiguous: false, candidates: [] };
  let state;
  try {
    state = parseProjectRegistryState(readFileSync(registryPath, 'utf-8'));
  } catch {
    return { ambiguous: false, candidates: [] };
  }
  const matchingEntries = Object.entries(state.projects)
    .filter(([, entry]) => entry.projectId === projectId)
  if (matchingEntries.length <= 1) return { ambiguous: false, candidates: [] };
  // Derive the PlanningSpaceId for each matching root (same chain as CLI).
  const candidates = [...new Set(
    matchingEntries.map(([, entry]) => derivePlanningSpaceId(entry.name) as string)
  )].sort();
  return { ambiguous: true, candidates };
}

function resolvePlanningSelector(planningSpaceId: string): RunsSpaceResolution {
  if (!/^planning-space:[0-9a-f]{64}$/.test(planningSpaceId)) {
    return {
      ok: false,
      status: 400,
      code: 'planning_selector_invalid',
      message: 'planning selector must contain one full PlanningSpaceId.',
    };
  }
  const registryPath = getProjectRegistryPath();
  if (!existsSync(registryPath)) {
    return {
      ok: false,
      status: 404,
      code: 'planning_selector_unavailable',
      message: `PlanningSpaceId ${planningSpaceId} is not registered on this machine.`,
    };
  }
  let state;
  try {
    state = parseProjectRegistryState(readFileSync(registryPath, 'utf8'));
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'planning_registry_unavailable',
      message: 'The project registry cannot resolve an exact planning root.',
    };
  }
  const roots = new Set<string>();
  for (const [registeredRoot, entry] of Object.entries(state.projects)) {
    if (derivePlanningSpaceId(entry.name) !== planningSpaceId) continue;
    try {
      if (!statSync(registeredRoot).isDirectory()) continue;
      roots.add(FileSystemUtils.canonicalizeExistingPath(registeredRoot));
    } catch {
      // A missing/unreadable registration is unavailable authority, never a
      // cwd or registry-order fallback.
    }
  }
  if (roots.size === 0) {
    return {
      ok: false,
      status: 404,
      code: 'planning_selector_unavailable',
      message: `PlanningSpaceId ${planningSpaceId} has no available registered root.`,
    };
  }
  if (roots.size > 1) {
    return {
      ok: false,
      status: 409,
      code: 'planning_selector_ambiguous',
      message: `PlanningSpaceId ${planningSpaceId} maps to multiple registered roots.`,
    };
  }
  return {
    ok: true,
    root: [...roots][0]!,
    planningSpaceId,
  };
}

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
  /** Test override for the durable hosted lifecycle; production constructs one per daemon/server. */
  sessionHostOverride?: SessionHost;
  /** Test-only parent data directory for the durable hosted registry. */
  sessionHostStateDir?: string;
  /** Server-owned exact Teacher provider policy; never accepted from HTTP. */
  exactTeacherAuthorityPolicy?: ExactTeacherAuthorityPolicy;
  /** Test-only exact Teacher host override. Production constructs a separate host. */
  exactTeacherSessionHostOverride?: SessionHost;
  /** Test-only phase committer paired with the exact Teacher host override. */
  exactTeacherAttemptCommitterOverride?: ExactTeacherAttemptPhaseCommitter;
  /** Dedicated durable registry root for the exact Teacher lane. */
  exactTeacherSessionHostStateDir?: string;
  /** Daemon-owned signer lookup; never accepted from an HTTP request body. */
  frozenActionProducerResolver?: TrustedCompletionProducerResolver;
  /** Daemon-owned RunStore root used by frozen Action execution. */
  frozenActionStoreRoot?: string;
  /** Test-only deterministic observer for exact Teacher workspace fencing. */
  frozenActionWorkspaceObserver?: (cwd: string) => string;
  /** Optional daemon-scoped override shared by every reopened Run context. */
  workspaceReservationRegistry?: WorkspaceReservationRegistry;
  /** Test/daemon override for native runtime homes and the Rasen machine-data directory. */
  audit?: AuditManagementOptions;
  /**
   * Test-only override for the POST run-control bridge's spawn seam (task
   * 13.7/13.8). Production passes nothing — the router creates the real
   * subprocess spawner. Tests inject a fake that asserts argv + returns a
   * canned receipt.
   */
  runControlSpawner?: RunControlSpawner;
  /** Test/daemon override captured once for every Run list/detail/control request. */
  runsRoot?: string;
  /** Test-only replacement for the durable reusable-session service. */
  reusableSessionService?: ReusableSessionService;
}

export interface ManagementRouterHandle {
  handle: (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => Promise<void>;
  supervisor: SessionSupervisor;
  sessionHost: SessionHost;
  exactTeacherSessionHost?: SessionHost;
  reusableSessionService: ReusableSessionService;
  shutdownReusableSessions: () => Promise<ReusableSessionOwnerShutdownResult>;
  shutdownPathChooser: () => Promise<void>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_HOSTED_BODY_BYTES = 2 * 1024 * 1024 + 16 * 1024;
const MAX_REUSABLE_SESSION_BODY_BYTES = 2 * 1024 * 1024;

/** The management endpoints with no path parameter, canonical (no trailing slash) form. */
const MANAGEMENT_PATHS = new Set([
  '/api/v1/status',
  '/api/v1/changes',
  '/api/v1/archive',
  '/api/v1/runs',
  '/api/v1/sessions',
  '/api/v1/hosted-sessions',
  '/api/v1/hosted-sessions/execute',
  '/api/v1/reusable-sessions',
  '/api/v1/reusable-sessions/wake',
  '/api/v1/reusable-sessions/retire',
  '/api/v1/reusable-sessions/touch-policy',
  '/api/v1/spaces',
  '/api/v1/spaces/worktrees',
  '/api/v1/local-paths',
  '/api/v1/local-paths/resolve',
  '/api/v1/local-paths/choose',
  '/api/v1/workflows',
  '/api/v1/workflow-validation',
  '/api/v1/workflow-dependencies',
  '/api/v1/workflow-enablement',
  '/api/v1/profiles',
  '/api/v1/pipelines',
  '/api/v1/threshold-schemes',
  '/api/v1/pipeline-validation',
  '/api/v1/pipeline-catalog',
  '/api/v1/audits',
  '/api/v1/audits/sessions',
  '/api/v1/audits/import',
  '/api/v1/themes',
  '/api/v1/themes/import',
  '/api/v1/frozen-action-executor/dispatch',
  '/api/v1/frozen-action-executor/continue',
  '/api/v1/stores/projects',
  '/api/v1/stores/target-lines',
  '/api/v1/stores/changes',
  '/api/v1/stores/issues',
  '/api/v1/stores/issue',
  '/api/v1/stores/issue-state',
  '/api/v1/stores/issue-references',
  '/api/v1/stores/execution-plan',
]);

const SESSION_ID_PATH_PREFIX = '/api/v1/sessions/';
const HOSTED_SESSION_PATH_PREFIX = '/api/v1/hosted-sessions/';
const TASK_ID_PATH_PREFIX = '/api/v1/tasks/';
const WORKFLOW_ID_PATH_PREFIX = '/api/v1/workflows/';
const PIPELINE_ID_PATH_PREFIX = '/api/v1/pipelines/';
const AUDIT_ID_PATH_PREFIX = '/api/v1/audits/';

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
 * `matchWorkflowIdPath`; unify-pipeline-http-api design D2). Serves the
 * pipeline detail contract (pipeline-definition-api design D2): a pipeline
 * name is user-chosen, so NO format constraint is applied here — a pipeline
 * legitimately named `validation` or `catalog` must still resolve as a detail
 * path (the validation/catalog contracts live at their OWN top-level paths
 * specifically so they are never shadowed). The handler answers 404 for an
 * unknown name (deeper suffixes still fall through —
 * `/api/v1/pipelines/<name>/extra` was never a "pipelines path" to begin with).
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

function matchAuditIdPath(pathname: string): string | null {
  if (!pathname.startsWith(AUDIT_ID_PATH_PREFIX)) return null;
  const rest = pathname.slice(AUDIT_ID_PATH_PREFIX.length);
  if (rest.length === 0 || rest.includes('/') || rest === 'sessions' || rest === 'import') return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

const RUN_DETAIL_PATH_PREFIX = '/api/v1/runs/';

/**
 * Matches `/api/v1/runs/<changeId>/<runId>` exactly two segments deep (design
 * §13), returning the percent-decoded `{ changeId, runId }` pair. The bare
 * collection `/api/v1/runs` (no trailing slash) never matches this prefix.
 * A deeper suffix (`/api/v1/runs/<changeId>/<runId>/extra`) returns null and
 * falls through to the rest of the server's routing — it was never a "runs
 * detail path" to begin with. Each segment is independently percent-decoded;
 * a malformed escape sequence rejects the match (null), not a 400.
 */
function matchRunDetailPath(pathname: string): { changeId: string; runId: string } | null {
  if (!pathname.startsWith(RUN_DETAIL_PATH_PREFIX)) return null;
  const rest = pathname.slice(RUN_DETAIL_PATH_PREFIX.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) return null; // missing changeId or runId
  const rawChangeId = rest.slice(0, slashIndex);
  const rawRunId = rest.slice(slashIndex + 1);
  if (rawRunId.length === 0 || rawRunId.includes('/')) return null;
  try {
    return {
      changeId: decodeURIComponent(rawChangeId),
      runId: decodeURIComponent(rawRunId),
    };
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

function matchHostedSessionPath(
  pathname: string
): { sessionId: string; operation?: 'cancel' | 'restart' | 'retire' } | null {
  if (!pathname.startsWith(HOSTED_SESSION_PATH_PREFIX)) return null;
  const rest = pathname.slice(HOSTED_SESSION_PATH_PREFIX.length);
  const segments = rest.split('/');
  if (segments.length < 1 || segments.length > 2 || !UUID_PATTERN.test(segments[0] ?? '')) {
    return null;
  }
  if (segments.length === 1) return { sessionId: segments[0]! };
  const operation = segments[1];
  if (operation !== 'cancel' && operation !== 'restart' && operation !== 'retire') return null;
  return { sessionId: segments[0]!, operation };
}

/** Methods admitted per management path (design D1/D4; space-creation D5): everywhere GETs, `/changes`, `/sessions`, and `/spaces` also POST, session-id paths also DELETE. */
function isMethodAdmitted(pathname: string, method: string | undefined): boolean {
  if (pathname === '/api/v1/local-paths/resolve') return method === 'GET';
  if (pathname === '/api/v1/local-paths/choose') return method === 'POST';
  if (pathname === '/api/v1/themes') return method === 'GET';
  if (pathname === '/api/v1/themes/import') return method === 'POST';
  if (matchAuditIdPath(pathname) !== null) return method === 'GET';
  if (pathname === '/api/v1/audits') return method === 'GET' || method === 'POST';
  if (pathname === '/api/v1/audits/sessions') return method === 'GET';
  if (pathname === '/api/v1/audits/import') return method === 'POST';
  const hostedSession = matchHostedSessionPath(pathname);
  if (hostedSession) return hostedSession.operation ? method === 'POST' : method === 'GET';
  if (pathname === '/api/v1/reusable-sessions') return method === 'GET';
  if (
    pathname === '/api/v1/reusable-sessions/wake'
    || pathname === '/api/v1/reusable-sessions/retire'
    || pathname === '/api/v1/reusable-sessions/touch-policy'
  ) {
    return method === 'POST';
  }
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
    // The detail contract is GET-only (pipeline-definition-api spec): PUT,
    // DELETE, and POST on `/api/v1/pipelines/<name>` are all rejected 405.
    return method === 'GET';
  }
  if (matchRunDetailPath(pathname) !== null) {
    // GET detail (task 13.5/13.6) and POST control (task 13.7/13.8).
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/pipeline-validation') {
    // POST-only: GET/PUT/DELETE are rejected 405 (pipeline-definition-api spec).
    return method === 'POST';
  }
  if (pathname === '/api/v1/pipeline-catalog') {
    // GET-only: POST/PUT/DELETE are rejected 405 (pipeline-definition-api spec).
    return method === 'GET';
  }
  if (pathname === '/api/v1/workflows') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/workflow-enablement') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/profiles') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/sessions') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/hosted-sessions') return method === 'GET';
  if (pathname === '/api/v1/hosted-sessions/execute') return method === 'POST';
  if (pathname === '/api/v1/frozen-action-executor/dispatch') return method === 'POST';
  if (pathname === '/api/v1/frozen-action-executor/continue') return method === 'POST';
  if (pathname === '/api/v1/pipelines') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/api/v1/threshold-schemes') {
    return method === 'GET' || method === 'POST';
  }
  if (method === 'GET') return true;
  return (
    (pathname === '/api/v1/changes' || pathname === '/api/v1/spaces') && method === 'POST'
  );
}

function readThemeBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_THEME_BYTES) {
        fail(new ThemeLibraryError('payload_too_large', `Theme document exceeds ${MAX_THEME_BYTES} bytes.`));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', () => fail(new ThemeLibraryError('persistence_failed', 'Failed to read the theme document.')));
  });
}

type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; code: string; message: string };

/** Reads and JSON-parses the request body, capped like the config API's own reader. */
function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = MAX_BODY_BYTES
): Promise<BodyReadResult> {
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
      if (total > maxBytes) {
        finish({
          ok: false,
          status: 413,
          code: 'payload_too_large',
          message: `Request body exceeds ${maxBytes} bytes.`,
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
    req.on('aborted', () => {
      finish({ ok: false, status: 400, code: 'bad_request', message: 'The request body was aborted.' });
    });
    req.on('close', () => {
      if (req.complete) return;
      finish({ ok: false, status: 400, code: 'bad_request', message: 'The request body closed before completion.' });
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
    matchHostedSessionPath(stripped) !== null ||
    matchTaskIdPath(stripped) !== null ||
    matchWorkflowIdPath(stripped) !== null ||
    matchPipelineIdPath(stripped) !== null ||
    matchAuditIdPath(stripped) !== null ||
    matchRunDetailPath(stripped) !== null
  );
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string, fix?: string): void {
  sendJson(res, status, { error: { code, message, ...(fix ? { fix } : {}) } });
}

function sendReusableSessionError(
  res: http.ServerResponse,
  status: number,
  operation: 'wake' | 'list' | 'retire' | 'touch-policy',
  code: string,
  message: string
): void {
  sendJson(res, status, {
    schema: REUSABLE_SESSION_API_SCHEMA,
    ok: false,
    operation,
    code,
    message,
  });
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
  const runsRoot = options.runsRoot ?? path.join(getGlobalDataDir(), 'runs');
  // One submitter per server instance (design D3's cap-1 concurrency is
  // per-server state, closed over here rather than module-scoped).
  const submitChange = createChangeSubmitter(context);

  // One space creator per server instance (space-creation design D5): its own
  // cap-1 concurrency, independent of change submission's cap.
  const createSpace = createSpaceCreator();
  const pathChooser = createLocalPathChooser();
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
  // The POST run-control bridge's spawn seam (task 13.7/13.8): production uses
  // the real subprocess spawner; tests inject a fake through options.
  const runControlSpawner = options.runControlSpawner ?? createProductionRunControlSpawner();
  const audits = new AuditManagementService(options.audit);

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
  const sessionHostRegistry = options.sessionHostOverride
    ? undefined
    : createSessionHostRegistry({
        ...(options.sessionHostStateDir ? { stateDir: options.sessionHostStateDir } : {}),
      });
  const sessionProcessScope = options.sessionHostOverride
    ? undefined
    : createHostedProcessScope();
  const sessionHost =
    options.sessionHostOverride ??
    createSessionHost({
      registry: sessionHostRegistry!,
      ownership: createSessionHostOwnership({
        stateDir: path.join(sessionHostRegistry!.paths.root, 'owners'),
      }),
      processScope: sessionProcessScope!,
      backends: [
        createClaudeSessionBackend({
          processScope: sessionProcessScope!,
          ...(options.resolveAgentCliOverride
            ? { resolveBinary: options.resolveAgentCliOverride }
            : {}),
        }),
      ],
    });
  const exactTeacherAuthority = options.exactTeacherAuthorityPolicy?.resolve();
  let exactTeacherSessionHost = exactTeacherAuthority?.state === 'available'
    ? options.exactTeacherSessionHostOverride
    : undefined;
  let exactTeacherAttemptCommitter = exactTeacherAuthority?.state === 'available'
    ? options.exactTeacherAttemptCommitterOverride
    : undefined;
  if (
    exactTeacherSessionHost === undefined &&
    exactTeacherAttemptCommitter !== undefined
  ) {
    throw new TypeError(
      'An exact Teacher attempt committer override requires its paired SessionHost override.'
    );
  }
  if (
    exactTeacherSessionHost === undefined &&
    exactTeacherAuthority?.state === 'available'
  ) {
    const stateDir = options.exactTeacherSessionHostStateDir ??
      (sessionHostRegistry === undefined
        ? undefined
        : path.join(sessionHostRegistry.paths.root, 'exact-teacher'));
    if (stateDir === undefined) {
      throw new TypeError(
        'The available exact Teacher lane requires a dedicated SessionHost state directory.'
      );
    }
    const registry = createSessionHostRegistry({ stateDir });
    exactTeacherAttemptCommitter = createExactTeacherAttemptPersistence({
      journal: createExactTeacherAttemptJournal({
        root: path.join(stateDir, 'attempt-journal'),
      }),
      sessionRegistry: registry,
    });
    const processScope = exactTeacherAuthority.lane.processScope;
    exactTeacherSessionHost = createSessionHost({
      registry,
      ownership: createSessionHostOwnership({
        stateDir: path.join(registry.paths.root, 'owners'),
      }),
      processScope,
      exactRetirementAuthority: 'coordinator-authenticated',
      exactTeacherAttemptCommitter,
      backends: [
        createClaudeSessionBackend({
          processScope,
          ...(options.resolveAgentCliOverride
            ? { resolveBinary: options.resolveAgentCliOverride }
            : {}),
        }),
      ],
    });
  }
  if (exactTeacherSessionHost === sessionHost) {
    throw new TypeError(
      'The exact Teacher SessionHost must be separate from the ordinary/source SessionHost.'
    );
  }
  const reusableSessionService =
    options.reusableSessionService
    ?? createReusableSessionService({ supervisor, runsRoot });

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

  /**
   * Runs-specific space resolution (design §13). Extends the standard resolver
   * with two runs-only behaviors:
   * 1. `planning:<PlanningSpaceId>` — resolves the exact identifier through the
   *    registry to one canonical physical root, or fails closed when unavailable
   *    or ambiguous.
   * 2. `project:<projectId>` — checks for duplicate clone homes before
   *    delegating; returns `project_selector_ambiguous` with candidate
   *    PlanningSpaceIds when multiple homes share the projectId.
   */
  const resolveRunsSpace = async (selector: string | undefined): Promise<RunsSpaceResolution> => {
    if (selector?.startsWith('planning:')) {
      return resolvePlanningSelector(selector.slice('planning:'.length));
    }
    if (selector?.startsWith('project:')) {
      const projectId = selector.slice('project:'.length);
      const ambiguity = checkProjectAmbiguity(projectId);
      if (ambiguity.ambiguous) {
        return {
          ok: false,
          status: 409,
          code: 'project_selector_ambiguous',
          message: `projectId ${projectId} maps to multiple registered homes. Use space=planning:<PlanningSpaceId> to select one.`,
          candidates: ambiguity.candidates,
        };
      }
    }
    const resolved = await resolveRequestSpace(selector);
    if (!resolved.ok) return resolved;
    return { ok: true, root: resolved.root };
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

    if (pathname === '/api/v1/themes' && req.method === 'GET') {
      sendJson(res, 200, listImportedThemes());
      return;
    }

    if (pathname === '/api/v1/themes/import' && req.method === 'POST') {
      const contentType = req.headers['content-type'];
      if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
        sendError(res, 415, 'unsupported_media_type', 'Theme imports require application/json.');
        return;
      }
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_THEME_BYTES) {
        sendError(res, 413, 'payload_too_large', `Theme document exceeds ${MAX_THEME_BYTES} bytes.`);
        return;
      }
      try {
        const manifest = installTheme(await readThemeBody(req));
        sendJson(res, 201, { theme: manifest });
      } catch (error) {
        if (error instanceof ThemeLibraryError) {
          const status =
            error.code === 'payload_too_large' ? 413
              : error.code === 'identifier_conflict' ? 409
                : error.code === 'persistence_failed' ? 500
                  : 400;
          sendJson(res, status, {
            error: {
              code: error.code,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            },
          });
          return;
        }
        sendError(res, 500, 'persistence_failed', 'Theme could not be installed.');
      }
      return;
    }

    const sendAuditFailure = (error: unknown): void => {
      if (error instanceof AuditServiceError) {
        sendError(res, error.status, error.code, error.message, error.fix);
        return;
      }
      sendError(res, 500, 'internal_error', error instanceof Error ? error.message : String(error));
    };

    if (pathname === '/api/v1/audits/sessions' && req.method === 'GET') {
      const rawLimit = url.searchParams.get('limit');
      let limit: number | undefined;
      if (rawLimit !== null) {
        limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT_AUDIT_LIMIT) {
          sendError(
            res,
            400,
            'invalid_limit',
            `limit must be an integer between 1 and ${MAX_RECENT_AUDIT_LIMIT}.`
          );
          return;
        }
      }
      try {
        sendJson(res, 200, await audits.discover(limit));
      } catch (error) {
        sendAuditFailure(error);
      }
      return;
    }

    if (pathname === '/api/v1/audits' && req.method === 'GET') {
      try {
        sendJson(res, 200, audits.reports.list());
      } catch (error) {
        sendAuditFailure(error);
      }
      return;
    }

    const auditId = matchAuditIdPath(pathname);
    if (auditId !== null && req.method === 'GET') {
      try {
        sendJson(res, 200, audits.reports.read(auditId));
      } catch (error) {
        sendAuditFailure(error);
      }
      return;
    }

    if (pathname === '/api/v1/audits' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const record =
        typeof body.value === 'object' && body.value !== null && !Array.isArray(body.value)
          ? (body.value as Record<string, unknown>)
          : null;
      const keys = record ? Object.keys(record) : [];
      const runtime = record?.runtime;
      const sessionId = record?.sessionId;
      if (
        !record ||
        keys.some((key) => key !== 'runtime' && key !== 'sessionId') ||
        !hasRuntimeCapability(runtime, 'canAudit') ||
        typeof sessionId !== 'string' ||
        sessionId.length === 0
      ) {
        sendError(res, 400, 'invalid_audit_request', 'Submit only an exact runtime and sessionId.');
        return;
      }
      try {
        sendJson(res, 200, await audits.runNative(runtime, sessionId));
      } catch (error) {
        sendAuditFailure(error);
      }
      return;
    }

    if (pathname === '/api/v1/audits/import' && req.method === 'POST') {
      const rejectImport = (
        status: number,
        code: string,
        message: string,
        fix?: string
      ): void => {
        res.once('finish', () => {
          // Graceful FIN so the client reads the JSON before EOF; a bare
          // destroy() sends RST which races the client's read and can
          // truncate the response body (observed as status 0 on the client).
          req.socket?.end();
          // Belt-and-suspenders: if the peer ignores the FIN, force-close the
          // socket shortly. 100ms covers any socket that doesn't close cleanly
          // on FIN alone (e.g., a peer that ignores half-close).
          const teardown = setTimeout(() => req.socket?.destroy(), 100);
          teardown.unref();
        });
        sendError(res, status, code, message, fix);
        // This handles both declared oversize rejection and a streamed body
        // crossing the cap without retaining the socket/request indefinitely.
      };
      const filenameHeader = req.headers['x-rasen-filename'];
      if (!filenameHeader || Array.isArray(filenameHeader)) {
        rejectImport(400, 'invalid_audit_filename', 'The X-Rasen-Filename header is required.');
        return;
      }
      let filename: string;
      try {
        filename = decodeURIComponent(filenameHeader);
      } catch {
        rejectImport(400, 'invalid_audit_filename', 'The audit filename header is malformed.');
        return;
      }
      const lengthHeader = req.headers['content-length'];
      const declared = typeof lengthHeader === 'string' ? Number(lengthHeader) : undefined;
      try {
        sendJson(
          res,
          200,
          await audits.importStream(req, filename, Number.isFinite(declared) ? declared : undefined)
        );
      } catch (error) {
        if (error instanceof AuditServiceError) {
          rejectImport(error.status, error.code, error.message, error.fix);
        } else {
          rejectImport(500, 'internal_error', error instanceof Error ? error.message : String(error));
        }
      }
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

    if (pathname === '/api/v1/profiles' && req.method === 'GET') {
      sendJson(res, 200, handleProfilesRead());
      return;
    }

    if (pathname === '/api/v1/profiles' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      // In-process wrapper over `named-profiles.ts` (design D1): profile writes
      // touch only a YAML file, so no bounded-CLI bridge or cap-1 slot is used.
      const result = handleProfileMutation(body.value ?? {});
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
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

    // Store aggregate paths (store-issue-resources): reads and Issue/Execution
    // Plan mutations scoped to a Store's stable identity, never a display
    // alias — `resolveStoreSpace` (not `resolveRequestSpace`, which discards
    // `uid`) resolves the `space=store:<id>` selector and carries the uid
    // through to every handler below.
    if (pathname === '/api/v1/stores/projects') {
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStoreProjects(space.space);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/target-lines') {
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStoreTargetLines(space.space);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/changes') {
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const filter: StoreChangesFilter = {
        ...(url.searchParams.getAll('project').length > 0
          ? { projects: url.searchParams.getAll('project') }
          : {}),
        ...(url.searchParams.getAll('targetLine').length > 0
          ? { targetLines: url.searchParams.getAll('targetLine') }
          : {}),
        ...(url.searchParams.getAll('outcome').length > 0
          ? { outcomes: url.searchParams.getAll('outcome') as StoreChangesFilter['outcomes'] }
          : {}),
        ...(url.searchParams.get('state') === 'active' || url.searchParams.get('state') === 'archived'
          ? { state: url.searchParams.get('state') as 'active' | 'archived' }
          : {}),
      };
      const result = await handleStoreChanges(space.space, filter);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/issues' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStoreIssueCreate(
        space.space,
        (body.value ?? {}) as { issueId?: unknown; title?: unknown; readme?: unknown }
      );
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/issues') {
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const stateParam = url.searchParams.get('state') ?? undefined;
      const state =
        stateParam === 'open' || stateParam === 'resolved' || stateParam === 'dropped' ? stateParam : undefined;
      const result = await handleStoreIssues(space.space, state);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/issue') {
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStoreIssue(space.space, url.searchParams.get('issueId') ?? undefined);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/issue-state' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStoreIssueSetState(
        space.space,
        (body.value ?? {}) as { issueId?: unknown; state?: unknown; reason?: unknown }
      );
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/issue-references') {
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStoreIssueReferences(
        space.space,
        url.searchParams.get('changeInstanceId') ?? undefined
      );
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/execution-plan' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStorePublishPlan(
        space.space,
        (body.value ?? {}) as { issueId?: unknown; nodes?: unknown }
      );
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/stores/execution-plan') {
      const space = await resolveStoreSpace(spaceSelector);
      if (!space.ok) {
        sendError(res, space.status, space.code, space.message);
        return;
      }
      const result = await handleStoreExecutionPlan(
        space.space,
        url.searchParams.get('issueId') ?? undefined,
        url.searchParams.get('revisionId') ?? undefined
      );
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

    if (pathname === '/api/v1/local-paths/resolve') {
      const result = await resolveLocalPath(
        url.searchParams.get('path') ?? undefined,
        url.searchParams.get('kind') ?? undefined
      );
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
      return;
    }

    if (pathname === '/api/v1/local-paths/choose') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const result = await pathChooser.choose(body.value);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.response);
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

    if (pathname === '/api/v1/workflow-dependencies' && req.method === 'GET') {
      const result = await handleWorkflowDependenciesRead();
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
              ...(result.diagnostics !== undefined
                ? { diagnostics: result.diagnostics }
                : {}),
              ...(result.preparation !== undefined
                ? { preparation: result.preparation }
                : {}),
            },
          })
        );
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (pathname === '/api/v1/threshold-schemes' && req.method === 'GET') {
      handleThresholdSchemeCatalog(res, sendError, sendJson);
      return;
    }

    if (pathname === '/api/v1/threshold-schemes' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      handleThresholdSchemeMutation(res, body.value, sendError, sendJson);
      return;
    }

    if (pathname === '/api/v1/pipeline-catalog' && req.method === 'GET') {
      await handlePipelineCatalog(res, context, sendJson);
      return;
    }

    if (pathname === '/api/v1/pipeline-validation' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      await handlePipelineValidation(res, body.value, context, sendError, sendJson);
      return;
    }

    const pipelineId = matchPipelineIdPath(pathname);
    if (pipelineId !== null && req.method === 'GET') {
      await handlePipelineDetail(res, url, pipelineId, context, sendError, sendJson);
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

    if (pathname === '/api/v1/hosted-sessions/execute' && req.method === 'POST') {
      const body = await readJsonBody(req, MAX_HOSTED_BODY_BYTES);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      if (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
        sendError(res, 400, 'invalid-input', 'Hosted Session execute body must be an object.');
        return;
      }
      const value = body.value as Record<string, unknown>;
      const result = await handleHostedSessionDispatch(sessionHost, {
        ...value,
        op: 'execute',
      } as SessionHostCommand);
      sendJson(res, result.status, result.response);
      return;
    }

    if (pathname === '/api/v1/frozen-action-executor/dispatch' && req.method === 'POST') {
      const body = await readJsonBody(req, MAX_HOSTED_BODY_BYTES);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const result = await handleFrozenActionDispatch({
        host: sessionHost,
        ...(exactTeacherSessionHost === undefined
          ? {}
          : { exactTeacherHost: exactTeacherSessionHost }),
        ...(options.exactTeacherAuthorityPolicy === undefined
          ? {}
          : { exactTeacherAuthorityPolicy: options.exactTeacherAuthorityPolicy }),
        ...(exactTeacherAttemptCommitter === undefined
          ? {}
          : { exactTeacherAttemptCommitter }),
        hostPlatform: process.platform,
        body: body.value,
        ...(options.frozenActionStoreRoot === undefined
          ? {}
          : { storeRoot: options.frozenActionStoreRoot }),
        ...(options.frozenActionProducerResolver === undefined
          ? {}
          : { producerFor: options.frozenActionProducerResolver }),
        ...(options.workspaceReservationRegistry === undefined
          ? {}
          : { reservationRegistry: options.workspaceReservationRegistry }),
        ...(options.frozenActionWorkspaceObserver === undefined
          ? {}
          : { workspaceObserver: options.frozenActionWorkspaceObserver }),
      });
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, result.status, result.result);
      return;
    }

    if (pathname === '/api/v1/frozen-action-executor/continue' && req.method === 'POST') {
      const body = await readJsonBody(req, MAX_HOSTED_BODY_BYTES);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const result = await handleFrozenActionContinuation({
        host: sessionHost,
        ...(exactTeacherSessionHost === undefined
          ? {}
          : { exactTeacherHost: exactTeacherSessionHost }),
        ...(options.exactTeacherAuthorityPolicy === undefined
          ? {}
          : { exactTeacherAuthorityPolicy: options.exactTeacherAuthorityPolicy }),
        ...(exactTeacherAttemptCommitter === undefined
          ? {}
          : { exactTeacherAttemptCommitter }),
        hostPlatform: process.platform,
        body: body.value,
        ...(options.frozenActionStoreRoot === undefined
          ? {}
          : { storeRoot: options.frozenActionStoreRoot }),
        ...(options.frozenActionProducerResolver === undefined
          ? {}
          : { producerFor: options.frozenActionProducerResolver }),
        ...(options.workspaceReservationRegistry === undefined
          ? {}
          : { reservationRegistry: options.workspaceReservationRegistry }),
        ...(options.frozenActionWorkspaceObserver === undefined
          ? {}
          : { workspaceObserver: options.frozenActionWorkspaceObserver }),
      });
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, result.status, result.result);
      return;
    }

    if (pathname === '/api/v1/hosted-sessions' && req.method === 'GET') {
      sendJson(res, 200, { sessions: sessionHost.list() });
      return;
    }

    const hostedSession = matchHostedSessionPath(pathname);
    if (hostedSession && !hostedSession.operation && req.method === 'GET') {
      const session = sessionHost.inspect(hostedSession.sessionId);
      if (!session) {
        sendError(res, 404, 'session-not-found', `No hosted Session with id ${hostedSession.sessionId}.`);
        return;
      }
      sendJson(res, 200, { session });
      return;
    }

    if (hostedSession?.operation && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      if (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
        sendError(res, 400, 'invalid-input', 'Hosted Session control body must be an object.');
        return;
      }
      const value = body.value as Record<string, unknown>;
      const allowedKeys = hostedSession.operation === 'restart' ? [] : ['reason'];
      if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
        sendError(res, 400, 'invalid-input', 'Hosted Session control body contains an unsupported field.');
        return;
      }
      const command: SessionHostCommand =
        hostedSession.operation === 'restart'
          ? { op: 'restart', sessionId: hostedSession.sessionId }
          : {
              op: hostedSession.operation,
              sessionId: hostedSession.sessionId,
              reason:
                typeof value.reason === 'string' && value.reason.trim()
                  ? value.reason
                  : 'requested-by-local-control',
            };
      const result = await handleHostedSessionDispatch(sessionHost, command);
      sendJson(res, result.status, result.response);
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
      const launchProject = context.launchProjectRoot
        ? {
            root: context.launchProjectRoot,
            projectId: context.launchProjectRef?.projectId ?? '',
            name: context.launchProjectRef?.name ?? '',
          }
        : null;
      const result = await handleLaunchSession(supervisor, request, launchProject);
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (pathname === '/api/v1/reusable-sessions' && req.method === 'GET') {
      const queryKeys = [...url.searchParams.keys()];
      if (
        queryKeys.some((key) => key !== 'runId' && key !== 'scope')
        || url.searchParams.getAll('runId').length > 1
        || url.searchParams.getAll('scope').length > 1
      ) {
        sendReusableSessionError(
          res,
          400,
          'list',
          'invalid_request',
          'Reusable-session list accepts only one runId or scope=all.'
        );
        return;
      }
      const runId = url.searchParams.get('runId') ?? undefined;
      const rawScope = url.searchParams.get('scope') ?? undefined;
      if (rawScope !== undefined && rawScope !== 'all') {
        sendReusableSessionError(
          res,
          400,
          'list',
          'invalid_request',
          'Reusable-session scope must be all.'
        );
        return;
      }
      const result = await reusableSessionService.list({
        ...(runId !== undefined ? { runId } : {}),
        ...(rawScope === 'all' ? { scope: 'all' as const } : {}),
      });
      sendJson(res, reusableSessionHttpStatus(result), result);
      return;
    }

    if (
      (
        pathname === '/api/v1/reusable-sessions/wake'
        || pathname === '/api/v1/reusable-sessions/retire'
        || pathname === '/api/v1/reusable-sessions/touch-policy'
      )
      && req.method === 'POST'
    ) {
      const body = await readJsonBody(
        req,
        MAX_REUSABLE_SESSION_BODY_BYTES
      );
      if (!body.ok) {
        const operation =
          pathname.endsWith('/wake')
            ? 'wake'
            : pathname.endsWith('/retire')
              ? 'retire'
              : 'touch-policy';
        sendReusableSessionError(
          res,
          body.status,
          operation,
          body.code,
          body.message
        );
        req.destroy();
        return;
      }
      const result =
        pathname === '/api/v1/reusable-sessions/wake'
          ? await reusableSessionService.wake(body.value)
          : pathname === '/api/v1/reusable-sessions/retire'
            ? await reusableSessionService.retire(body.value)
            : await reusableSessionService.updateTouchPolicy(body.value);
      sendJson(res, reusableSessionHttpStatus(result), result);
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
      for (const hosted of sessionHost.list()) {
        response.sessions.push({ session: hostedSessionToWire(hosted), runState: { kind: 'absent' } });
      }
      sendJson(res, 200, response);
      return;
    }

    const sessionId = matchSessionIdPath(pathname);
    if (sessionId !== null && req.method === 'GET') {
      const result = handleGetSession(supervisor, sessionId);
      if (!result.ok) {
        const hosted = sessionHost.inspect(sessionId);
        if (hosted) {
          sendJson(res, 200, {
            session: hostedSessionToWire(hosted),
            tails: { stdout: '', stderr: '' },
          });
          return;
        }
        sendError(res, 404, 'not_found', `No session with id ${sessionId}.`);
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    if (sessionId !== null && req.method === 'DELETE') {
      const result = handleKillSession(supervisor, sessionId);
      if (!result.ok) {
        const hosted = sessionHost.inspect(sessionId);
        if (hosted) {
          const cancelled = await sessionHost.dispatch({
            op: 'cancel',
            sessionId,
            reason: 'legacy-management-delete',
          });
          sendJson(res, cancelled.ok ? 202 : 409, cancelled);
          return;
        }
        sendError(res, 404, 'not_found', `No session with id ${sessionId}.`);
        return;
      }
      sendJson(res, result.status, result.response);
      return;
    }

    // Exact Run detail: `/api/v1/runs/<changeId>/<runId>` (task 13.5/13.6 GET,
    // 13.7/13.8 POST). Checked before the bare collection route so the more
    // specific path wins.
    const runDetail = matchRunDetailPath(pathname);
    if (runDetail !== null && req.method === 'POST') {
      const space = await resolveRunsSpace(spaceSelector);
      if (!space.ok) {
        if (space.code === 'project_selector_ambiguous') {
          sendJson(res, space.status, {
            error: { code: space.code, message: space.message },
            ...(space.candidates ? { candidates: space.candidates } : {}),
          });
        } else {
          sendError(res, space.status, space.code, space.message);
        }
        return;
      }
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendError(res, body.status, body.code, body.message);
        req.destroy();
        return;
      }
      const home = space.root ? await resolveHomeForRoot(space.root) : null;
      const result = await handleRunControl(
        runDetail.changeId,
        runDetail.runId,
        space.root,
        home,
        body.value,
        runControlSpawner,
        { runsRoot }
      );
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

    if (runDetail !== null && req.method === 'GET') {
      const space = await resolveRunsSpace(spaceSelector);
      if (!space.ok) {
        if (space.code === 'project_selector_ambiguous') {
          sendJson(res, space.status, {
            error: { code: space.code, message: space.message },
            ...(space.candidates ? { candidates: space.candidates } : {}),
          });
        } else {
          sendError(res, space.status, space.code, space.message);
        }
        return;
      }
      const home = space.root ? await resolveHomeForRoot(space.root) : null;
      const result = await handleRunDetail(
        runDetail.changeId,
        runDetail.runId,
        space.root,
        home,
        runsRoot
      );
      if (!result.ok) {
        sendError(res, result.status, result.code, result.message);
        return;
      }
      sendJson(res, 200, result.view);
      return;
    }

    if (pathname === '/api/v1/runs') {
      const space = await resolveRunsSpace(spaceSelector);
      if (!space.ok) {
        if (space.code === 'project_selector_ambiguous') {
          sendJson(res, space.status, {
            error: { code: space.code, message: space.message },
            ...(space.candidates ? { candidates: space.candidates } : {}),
          });
        } else {
          sendError(res, space.status, space.code, space.message);
        }
        return;
      }
      // When a planningSpaceId override is set (planning: selector), there is
      // no root — legacy runs are empty and source state defaults to missing.
      if (space.planningSpaceId && !space.root) {
        const rawLimit = url.searchParams.get('limit');
        const limit = rawLimit !== null ? Number(rawLimit) : undefined;
        const cursor = url.searchParams.get('cursor') ?? undefined;
        const runsResponse = await handleRuns('', null, {
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
          planningSpaceId: space.planningSpaceId,
          runsRoot,
        });
        sendJson(res, 200, runsResponse);
        return;
      }
      // No resolvable root (no selector and no launch project) means no
      // changes could exist to report runs for — an empty listing, not an
      // error (unlike `/changes`, which requires a resolvable project).
      if (!space.root) {
        sendJson(res, 200, { runs: [], reconcilerRuns: [], hasMore: false });
        return;
      }
      const home = await resolveHomeForRoot(space.root);
      // Pagination options from the query string (task 13.3/13.4).
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit !== null ? Number(rawLimit) : undefined;
      const cursor = url.searchParams.get('cursor') ?? undefined;
      const runsResponse = await handleRuns(space.root, home, {
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        ...(space.planningSpaceId ? { planningSpaceId: space.planningSpaceId } : {}),
        runsRoot,
      });
      sendJson(res, 200, runsResponse);
      return;
    }
  };

  return {
    handle,
    supervisor,
    sessionHost,
    ...(exactTeacherSessionHost === undefined ? {} : { exactTeacherSessionHost }),
    reusableSessionService,
    shutdownReusableSessions: () => reusableSessionService.ownerShutdown(),
    shutdownPathChooser: pathChooser.shutdown,
  };
}
