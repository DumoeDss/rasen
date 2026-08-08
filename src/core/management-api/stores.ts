/**
 * The Store aggregate route family.
 *
 * Reads:
 *   GET  /api/v1/stores/:storeUid/issues
 *   GET  /api/v1/stores/:storeUid/issues/:issueId
 *   GET  /api/v1/stores/:storeUid/issues/:issueId/plans/:revisionId
 *   GET  /api/v1/stores/:storeUid/projects
 *   GET  /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes
 *
 * Mutations, every one of which writes ONLY by spawning the CLI:
 *   POST /api/v1/stores/:storeUid/issues
 *   POST /api/v1/stores/:storeUid/issues/:issueId/plans
 *   POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes
 *
 * Two rules this module exists to hold:
 *
 *   - **`:storeUid` is the Store's STABLE IDENTITY.** It is never read as the
 *     local id a `store:<id>` space selector carries, and a UID that resolves
 *     to no registered Store is rejected rather than falling back to the launch
 *     project, a recent space, or the only registered Store.
 *   - **A scope is complete or the request is refused.** Every scope segment
 *     comes from the PATH and from nowhere else — not a query filter, not a
 *     session, not the launch project, not a previously viewed selection — and
 *     a project or target line the Store's own catalogs do not declare is
 *     refused before any subprocess is spawned and before any file is touched.
 *     The Issue paths are the counter-case that keeps the rule honest: they
 *     require the Store and must NOT require a project or a target line.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { StoreError } from '../store/errors.js';
import {
  createStoreQueryByUid,
  listProjectEntries,
  listTargetLineEntries,
  nodeStoreQueryFileSystem,
  resolveQueryStoreByUid,
  type StoreQueryModule,
} from '../store/query/index.js';
import { getBoundedCliEntry } from './whitelist.js';
import type {
  StoreAggregateChangesResponse,
  StoreExecutionPlanResponse,
  StoreIssueDetailResponse,
  StoreIssueListResponse,
  StoreProjectRollupResponse,
} from './wire-types.js';

const require = createRequire(import.meta.url);

/** Hard timeout per subprocess: an Issue write is one validated file write. */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const MAX_TEXT_LENGTH = 4_000;

/** Any C0 control character or DEL. */
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/;

// -----------------------------------------------------------------------------
// Path matching
// -----------------------------------------------------------------------------

export const STORE_PATH_PREFIX = '/api/v1/stores/';

export type StoreRoute =
  | { readonly kind: 'issues'; readonly storeUid: string }
  | { readonly kind: 'issue'; readonly storeUid: string; readonly issueId: string }
  | { readonly kind: 'issue-plans'; readonly storeUid: string; readonly issueId: string }
  | {
      readonly kind: 'issue-plan';
      readonly storeUid: string;
      readonly issueId: string;
      readonly revisionId: string;
    }
  | { readonly kind: 'projects'; readonly storeUid: string }
  | {
      readonly kind: 'line-changes';
      readonly storeUid: string;
      readonly projectId: string;
      readonly targetLineId: string;
    };

function decodeSegment(segment: string): string | null {
  if (segment.length === 0) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.length === 0 ? null : decoded;
  } catch {
    return null;
  }
}

function decodeAll(segments: readonly string[]): readonly string[] | null {
  const decoded = segments.map(decodeSegment);
  return decoded.some(value => value === null) ? null : (decoded as string[]);
}

/**
 * Matches the aggregate family EXACTLY. A partial prefix is not a management
 * path and falls through, so an incomplete scope can never be answered by this
 * route group at all — which is the routing half of the scope-completeness rule.
 *
 * The 8-segment change-finalization path deliberately does not match here; it
 * has its own matcher and its own bridge.
 */
export function matchStoreRoute(pathname: string): StoreRoute | null {
  if (!pathname.startsWith(STORE_PATH_PREFIX)) return null;
  const parts = decodeAll(pathname.slice(STORE_PATH_PREFIX.length).split('/'));
  if (parts === null) return null;

  if (parts.length === 2 && parts[1] === 'issues') {
    return { kind: 'issues', storeUid: parts[0] as string };
  }
  if (parts.length === 3 && parts[1] === 'issues') {
    return {
      kind: 'issue',
      storeUid: parts[0] as string,
      issueId: parts[2] as string,
    };
  }
  if (parts.length === 4 && parts[1] === 'issues' && parts[3] === 'plans') {
    return {
      kind: 'issue-plans',
      storeUid: parts[0] as string,
      issueId: parts[2] as string,
    };
  }
  if (parts.length === 5 && parts[1] === 'issues' && parts[3] === 'plans') {
    return {
      kind: 'issue-plan',
      storeUid: parts[0] as string,
      issueId: parts[2] as string,
      revisionId: parts[4] as string,
    };
  }
  if (parts.length === 2 && parts[1] === 'projects') {
    return { kind: 'projects', storeUid: parts[0] as string };
  }
  if (
    parts.length === 6 &&
    parts[1] === 'projects' &&
    parts[3] === 'lines' &&
    parts[5] === 'changes'
  ) {
    return {
      kind: 'line-changes',
      storeUid: parts[0] as string,
      projectId: parts[2] as string,
      targetLineId: parts[4] as string,
    };
  }
  return null;
}

/** GET everywhere; POST additionally on the three mutation shapes. */
export function storeRouteAdmitsMethod(route: StoreRoute, method: string | undefined): boolean {
  if (method === 'GET') return true;
  if (method !== 'POST') return false;
  return route.kind === 'issues' || route.kind === 'issue-plans' || route.kind === 'line-changes';
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface StoreApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  fix?: string;
  cliExitCode?: number;
  stderr?: string;
}

export type StoreApiResult = { ok: true; status: number; response: unknown } | StoreApiFailure;

function failureFrom(error: unknown): StoreApiFailure {
  if (error instanceof StoreError) {
    return {
      ok: false,
      status: error.diagnostic.code === 'issue_scope_required' ? 404 : 422,
      code: error.diagnostic.code,
      message: error.diagnostic.message,
      ...(error.diagnostic.fix === undefined ? {} : { fix: error.diagnostic.fix }),
    };
  }
  return {
    ok: false,
    status: 500,
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export interface StoreReadFilters {
  readonly outcomes?: readonly string[];
  readonly state?: string;
}

/**
 * Serves one aggregate read. Every response is computed from a FRESH read at
 * request time — there is no cache to invalidate, because the query Module
 * persists no index — and carries the module's per-node states, unsearched-ref
 * list, and completeness flag unchanged.
 */
export async function serveStoreRead(
  route: StoreRoute,
  filters: StoreReadFilters = {},
  options: { readonly query?: StoreQueryModule; readonly globalDataDir?: string } = {}
): Promise<StoreApiResult> {
  const query = options.query ?? createStoreQueryByUid();
  const scope = {
    store: route.storeUid,
    startPath: process.cwd(),
    ...(options.globalDataDir === undefined ? {} : { globalDataDir: options.globalDataDir }),
  };
  try {
    switch (route.kind) {
      case 'issues': {
        const page = await query.listIssues(scope);
        return { ok: true, status: 200, response: page satisfies StoreIssueListResponse };
      }
      case 'issue': {
        const detail = await query.showIssue({ ...scope, issueId: route.issueId });
        return { ok: true, status: 200, response: detail satisfies StoreIssueDetailResponse };
      }
      case 'issue-plans': {
        const plan = await query.resolveExecutionPlan({ ...scope, issueId: route.issueId });
        return { ok: true, status: 200, response: plan satisfies StoreExecutionPlanResponse };
      }
      case 'issue-plan': {
        const plan = await query.resolveExecutionPlan({
          ...scope,
          issueId: route.issueId,
          revisionId: route.revisionId,
        });
        return { ok: true, status: 200, response: plan satisfies StoreExecutionPlanResponse };
      }
      case 'projects': {
        const projects = await query.listProjects(scope);
        const lines = await query.listTargetLines(scope);
        const response: StoreProjectRollupResponse = {
          storeId: projects.storeId,
          storeUid: projects.storeUid,
          projects: projects.projects,
          targetLines: lines.targetLines,
          unsearchedRefs: projects.unsearchedRefs,
          complete: projects.complete && lines.complete,
        };
        return { ok: true, status: 200, response };
      }
      case 'line-changes': {
        // The path's project and line NARROW the read. On a read there is no
        // authority to complete, so this is a filter in the URL rather than an
        // exception to the scope-completeness rule, which governs mutations.
        const grouped = await query.listChanges({
          ...scope,
          projects: [route.projectId],
          targetLines: [route.targetLineId],
          ...(filters.outcomes === undefined
            ? {}
            : { outcomes: filters.outcomes as never }),
          ...(filters.state === undefined
            ? {}
            : { state: filters.state as 'active' | 'archived' }),
        });
        return {
          ok: true,
          status: 200,
          response: grouped satisfies StoreAggregateChangesResponse,
        };
      }
    }
  } catch (error) {
    return failureFrom(error);
  }
}

// -----------------------------------------------------------------------------
// Mutations
// -----------------------------------------------------------------------------

function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

function invalidValue(label: string, value: unknown, cap = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return `${label} must be a non-empty string.`;
  }
  if (value.startsWith('-')) return `${label} must not be option-shaped.`;
  if (value.length > cap) return `${label} must be at most ${cap} characters.`;
  if (CONTROL_CHAR_PATTERN.test(value) || value.includes('\n')) {
    return `${label} must not contain control characters.`;
  }
  return null;
}

interface CliRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

function runCli(
  cliEntry: string,
  cwd: string,
  argv: readonly string[],
  timeoutMs: number,
  killGraceMs: number
): Promise<CliRun> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliEntry, ...argv], {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
      killTimer.unref?.();
    }, timeoutMs);
    timeoutTimer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    const finish = (run: CliRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(run);
    };
    child.on('error', error => {
      finish({ exitCode: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on('close', code => {
      finish({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

function parseJsonPayload(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The CLI's `--json` failure envelope, surfaced UNCHANGED. */
function cliDiagnostic(stdout: string, stderr: string): { code: string; message: string } {
  const payload = parseJsonPayload(stdout);
  const status = payload?.status;
  if (Array.isArray(status) && status.length > 0) {
    const first = status[0] as { code?: unknown; message?: unknown };
    if (typeof first.code === 'string' && typeof first.message === 'string') {
      return { code: first.code, message: first.message };
    }
  }
  return {
    code: 'cli_error',
    message:
      stderr.trim().length > 0
        ? stderr.trim()
        : 'The CLI exited with an error and produced no message.',
  };
}

export interface StoreMutationBody {
  issueId?: unknown;
  title?: unknown;
  changeId?: unknown;
  description?: unknown;
  proposal?: unknown;
  schema?: unknown;
  nodes?: unknown;
  nodesFile?: unknown;
}

/**
 * Verifies the request's scope against the Store's OWN catalogs.
 *
 * This runs before any subprocess exists. A project or target line the Store
 * does not declare is refused here, so a scoped mutation can never reach the
 * CLI with a scope the Store cannot support — and no file is touched on the way
 * to finding that out.
 */
export async function assertDeclaredScope(
  storeUid: string,
  scope: { readonly projectId: string; readonly targetLineId: string },
  globalDataDir?: string
): Promise<StoreApiFailure | null> {
  let store;
  try {
    store = await resolveQueryStoreByUid(
      { fs: nodeStoreQueryFileSystem },
      {
        storeUid,
        ...(globalDataDir === undefined ? {} : { globalDataDir }),
      }
    );
  } catch (error) {
    return failureFrom(error);
  }
  const dependencies = { fs: nodeStoreQueryFileSystem };
  const projects = await listProjectEntries(dependencies, store.registeredRoot);
  const lines = await listTargetLineEntries(dependencies, store.registeredRoot);
  if (!projects.some(entry => entry.projectId === scope.projectId && entry.catalog !== null)) {
    return {
      ok: false,
      status: 422,
      code: 'store_query_scope_incomplete',
      message: `Store '${store.storeId}' declares no project catalog for '${scope.projectId}'.`,
      fix: 'Address a project the Store declares. The server never substitutes the only project, the launch project, or a previously viewed selection.',
    };
  }
  if (
    !lines.some(entry => entry.targetLineId === scope.targetLineId && entry.catalog !== null)
  ) {
    return {
      ok: false,
      status: 422,
      code: 'store_query_scope_incomplete',
      message: `Store '${store.storeId}' declares no target-line catalog for '${scope.targetLineId}'.`,
      fix: 'Address a target line the Store declares. A branch name is never a target line.',
    };
  }
  return null;
}

export interface StoreMutationOptions {
  timeoutMs?: number;
  killGraceMs?: number;
  cliEntryOverride?: string;
  cwdOverride?: string;
  globalDataDir?: string;
}

/**
 * Builds the Store mutation bridge closed over one server's context and its own
 * cap-1 concurrency state, exactly as the change-submission and finalization
 * bridges do. The server process itself writes no workspace file.
 */
export function createStoreMutator(
  context: { readonly launchProjectRoot?: string | null },
  options: StoreMutationOptions = {}
): (route: StoreRoute, body: StoreMutationBody) => Promise<StoreApiResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const cliEntry = options.cliEntryOverride ?? resolveCliEntry();
  let inFlight = false;

  return async (route, body) => {
    const op =
      route.kind === 'issues'
        ? 'create-issue'
        : route.kind === 'issue-plans'
          ? 'publish-execution-plan'
          : 'create-scoped-change';
    if (!getBoundedCliEntry(op)) {
      return {
        ok: false,
        status: 500,
        code: 'internal_error',
        message: `${op} is not present in the admission whitelist.`,
      };
    }
    if (inFlight) {
      return {
        ok: false,
        status: 409,
        code: 'busy',
        message: 'Another Store mutation is already in flight.',
      };
    }

    const built = await buildArgv(route, body, options.globalDataDir);
    if (!built.ok) return built;

    const cwd = options.cwdOverride ?? context.launchProjectRoot;
    if (!cwd) {
      return {
        ok: false,
        status: 409,
        code: 'no_project',
        message:
          'No Rasen project is available for this server; launch `rasen ui` inside a checkout.',
      };
    }

    inFlight = true;
    try {
      const run = await runCli(cliEntry, cwd, built.argv, timeoutMs, killGraceMs);
      if (run.timedOut) {
        return {
          ok: false,
          status: 504,
          code: 'cli_timeout',
          message: 'The CLI subprocess timed out.',
        };
      }
      if (run.exitCode !== 0) {
        const diagnostic = cliDiagnostic(run.stdout, run.stderr);
        return {
          ok: false,
          status: 422,
          code: diagnostic.code,
          message: diagnostic.message,
          ...(run.exitCode === null ? {} : { cliExitCode: run.exitCode }),
          stderr: run.stderr,
        };
      }
      return {
        ok: true,
        status: 201,
        response: parseJsonPayload(run.stdout) ?? { ok: true },
      };
    } finally {
      inFlight = false;
    }
  };
}

/** The exact argv the bridge executes. There is no second command builder. */
export async function buildArgv(
  route: StoreRoute,
  body: StoreMutationBody,
  globalDataDir?: string
): Promise<{ ok: true; argv: string[] } | StoreApiFailure> {
  const storeProblem = invalidValue('storeUid', route.storeUid, 256);
  if (storeProblem !== null) {
    return { ok: false, status: 400, code: 'invalid_input', message: storeProblem };
  }

  if (route.kind === 'issues') {
    const issueId = body.issueId;
    const title = body.title;
    for (const [label, value, cap] of [
      ['issueId', issueId, 128],
      ['title', title, 200],
    ] as const) {
      const problem = invalidValue(label, value, cap);
      if (problem !== null) {
        return { ok: false, status: 400, code: 'invalid_input', message: problem };
      }
    }
    return {
      ok: true,
      argv: [
        'store',
        'issue',
        'new',
        issueId as string,
        '--store',
        route.storeUid,
        '--title',
        title as string,
        '--json',
      ],
    };
  }

  if (route.kind === 'issue-plans') {
    const nodesFile = body.nodesFile;
    const problem = invalidValue('nodesFile', nodesFile, 4_096);
    if (problem !== null) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_input',
        message:
          'nodesFile is required: a plan revision is authored from a YAML node list so the server never assembles a graph of its own.',
      };
    }
    return {
      ok: true,
      argv: [
        'store',
        'issue',
        'plan',
        route.issueId,
        '--store',
        route.storeUid,
        '--from-file',
        nodesFile as string,
        '--json',
      ],
    };
  }

  // The scoped Change creation. Every scope segment is read from the PATH.
  if (route.kind !== 'line-changes') {
    return {
      ok: false,
      status: 405,
      code: 'method_not_allowed',
      message: `${route.kind} does not admit a mutation.`,
    };
  }
  const changeId = body.changeId;
  const problem = invalidValue('changeId', changeId, 128);
  if (problem !== null) {
    return { ok: false, status: 400, code: 'invalid_input', message: problem };
  }
  for (const [label, value] of [
    ['projectId', route.projectId],
    ['targetLineId', route.targetLineId],
  ] as const) {
    const segmentProblem = invalidValue(label, value, 256);
    if (segmentProblem !== null) {
      return { ok: false, status: 400, code: 'invalid_input', message: segmentProblem };
    }
  }
  const declared = await assertDeclaredScope(
    route.storeUid,
    { projectId: route.projectId, targetLineId: route.targetLineId },
    globalDataDir
  );
  if (declared !== null) return declared;

  const argv = [
    'new',
    'change',
    changeId as string,
    '--store',
    route.storeUid,
    '--project',
    route.projectId,
    '--target-line',
    route.targetLineId,
    '--json',
  ];
  for (const [flag, value] of [
    ['--description', body.description],
    ['--proposal', body.proposal],
    ['--schema', body.schema],
  ] as const) {
    if (value === undefined) continue;
    const optionProblem = invalidValue(flag.slice(2), value);
    if (optionProblem !== null) {
      return { ok: false, status: 400, code: 'invalid_input', message: optionProblem };
    }
    argv.push(flag, value as string);
  }
  return { ok: true, argv };
}
