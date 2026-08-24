/**
 * Single fetch wrapper for the config API (design.md D5). Nothing else in the
 * app touches `fetch` directly: every call goes through here so auth headers,
 * content-type, and error-envelope narrowing happen in exactly one place.
 */
import { getToken, markUnauthorized } from './token.js';
import type {
  ApiErrorBody,
  AuditReportDetailResponse,
  AuditReportsResponse,
  AuditRuntime,
  AuditSessionsResponse,
  ArchiveResponse,
  ChangeRunView,
  ChangesResponse,
  ConfigScope,
  ChooseLocalPathRequest,
  ChooseLocalPathResponse,
  CreateSpaceRequest,
  CreateSpaceResponse,
  GetConfigKeyResponse,
  HealthResponse,
  LaunchSessionRequest,
  ListConfigResponse,
  ListPipelinesResponse,
  ListProjectsResponse,
  LocalPathsResponse,
  LocalPathSelectionKind,
  PipelineCatalogResponse,
  PipelineDetailResponse,
  PipelineMutationRequest,
  PipelineMutationResponse,
  PipelineValidationResponse,
  ProfileListResponse,
  ProfileMutationRequest,
  ProfileMutationResponse,
  RunControlRequestBody,
  RunControlResponseBody,
  RunsResponse,
  ResolveLocalPathResponse,
  SessionActionResponse,
  SessionDetailResponse,
  SessionsResponse,
  SpacesResponse,
  SpaceWorktreesResponse,
  StatusResponse,
  StoreChangesResponse,
  StoreChangeIssueLinksResponse,
  StoreExecutionPlanPublishRequest,
  StoreExecutionPlanPublishResponse,
  StoreExecutionPlanResponse,
  StoreIssueAttentionResponse,
  StoreIssueCreateRequest,
  StoreIssueDetailResponse,
  StoreIssueProjectionResponse,
  StoreIssueProjectionsResponse,
  StoreIssueRecordResponse,
  StoreIssueReferencesResponse,
  StoreIssuesResponse,
  StoreIssueSetStateRequest,
  StoreIssueState,
  StoreProjectsResponse,
  StoreTargetLinesResponse,
  SubmitChangeRequest,
  SubmitChangeResponse,
  TaskDetailResponse,
  ThresholdSchemeCatalogResponse,
  ThresholdSchemeMutationRequest,
  ThresholdSchemeMutationResponse,
  ThemeCatalogResponse,
  ThemeImportResponse,
  WorkflowDependenciesResponse,
  WorkflowDetailResponse,
  WorkflowEnablementMutationRequest,
  WorkflowEnablementResponse,
  WorkflowListResponse,
  WorkflowMutationRequest,
  WorkflowMutationResponse,
  WorkflowValidationResponse,
  WriteConfigKeyResponse,
} from './types.js';

export class ApiError extends Error {
  code: string;
  fix?: string;
  status: number;
  /**
   * Present only for a workflow-enablement apply failure (space-workflow-
   * enablement design D5): the selection write succeeded but `update` did
   * not, so the response carries the space's actual post-write state
   * alongside the CLI's own error message.
   */
  state?: unknown;
  details?: ApiErrorBody['error']['details'];

  constructor(status: number, body: ApiErrorBody & { state?: unknown }) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.fix = body.error.fix;
    this.state = body.state;
    this.details = body.error.details;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: boolean } = {}
): Promise<T> {
  const { json, headers, ...rest } = init;
  const token = getToken();
  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };
  if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  if (json) finalHeaders['Content-Type'] = 'application/json';

  const res = await fetch(path, { ...rest, headers: finalHeaders });

  if (res.status === 401) {
    markUnauthorized();
  }

  let body: unknown = undefined;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!res.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(res.status, body);
    }
    throw new ApiError(res.status, {
      error: { code: 'unknown_error', message: `Request to ${path} failed with status ${res.status}.` },
    });
  }

  return body as T;
}

/**
 * Space scoping (design.md D6): a `<type>:<id>` selector, URL-encoded once
 * here at the single client seam. Omitting it sends no `space` param,
 * preserving the server's launch-project fallback exactly. Every space-scoped
 * endpoint — management AND config (W2 design D7: the config client moved
 * wholesale off `?project=`) — routes through this one helper.
 */
function spaceQuery(selector?: string): string {
  return selector ? `?space=${encodeURIComponent(selector)}` : '';
}

export function health(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/v1/health');
}

export function listProjects(): Promise<ListProjectsResponse> {
  return request<ListProjectsResponse>('/api/v1/projects');
}

/** Fresh validated imported-theme catalog. Built-ins are merged by the UI runtime. */
export function listThemes(signal?: AbortSignal): Promise<ThemeCatalogResponse> {
  return request<ThemeCatalogResponse>('/api/v1/themes', { signal });
}

/** Upload one JSON manifest. The server validates and atomically installs it. */
export function importTheme(document: string | Blob): Promise<ThemeImportResponse> {
  return request<ThemeImportResponse>('/api/v1/themes/import', {
    method: 'POST',
    body: document,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The effective config for a planning space (W2 design D7); no selector = launch-project fallback. */
export function listConfig(space?: string): Promise<ListConfigResponse> {
  return request<ListConfigResponse>(`/api/v1/config${spaceQuery(space)}`);
}

/**
 * The addressed space's resolved pipelines (pipeline-http-api): each stage's
 * declared gate plus its effective gate/model/handoff/runtime with a
 * scope-qualified source. No selector = launch-project fallback.
 */
export function listPipelines(space?: string): Promise<ListPipelinesResponse> {
  return request<ListPipelinesResponse>(`/api/v1/pipelines${spaceQuery(space)}`);
}

/** Installation-wide threshold schemes, preset seeds, and binding-row vocabulary. */
export function listThresholdSchemes(): Promise<ThresholdSchemeCatalogResponse> {
  return request<ThresholdSchemeCatalogResponse>('/api/v1/threshold-schemes');
}

/** Create, update, or delete one machine-level threshold scheme. */
export function mutateThresholdScheme(
  body: ThresholdSchemeMutationRequest
): Promise<ThresholdSchemeMutationResponse> {
  return request<ThresholdSchemeMutationResponse>('/api/v1/threshold-schemes', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

/**
 * One pipeline's declared definition plus its resolved effective view
 * (pipeline-definition-api, pipeline-canvas-view's data source): `definition`
 * carries `requires`/`parallelGroup`, absent from `listPipelines`' resolved
 * stage shape — the graph view draws edges and groups from it. `name` is
 * percent-encoded like every other path segment; no selector = launch-project
 * fallback, same threading as `listPipelines`.
 */
export function getPipelineDetail(name: string, space?: string): Promise<PipelineDetailResponse> {
  return request<PipelineDetailResponse>(`/api/v1/pipelines/${encodeURIComponent(name)}${spaceQuery(space)}`);
}

/**
 * Run a pipeline-library mutation through the CLI-backed bridge (import / init /
 * export / delete). On failure the thrown `ApiError.message` is the CLI's own
 * error text, verbatim.
 */
export function mutatePipeline(body: PipelineMutationRequest): Promise<PipelineMutationResponse> {
  return request<PipelineMutationResponse>('/api/v1/pipelines', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

/**
 * Dry-run validation of a draft definition (pipeline-definition-api): the
 * server is the sole authority on validity; the client's own `wouldCreateCycle`
 * check is only a fast-path UX guard on top of this. `space` mirrors the
 * detail/save calls' selector threading — no selector = launch-project fallback.
 */
export function validatePipeline(definition: unknown, space?: string): Promise<PipelineValidationResponse> {
  return request<PipelineValidationResponse>('/api/v1/pipeline-validation', {
    method: 'POST',
    json: true,
    body: JSON.stringify({ definition, space }),
  });
}

/**
 * The installation-wide assembly vocabulary for the canvas editor (roles,
 * skills with their enabled state, runtimes, stage kinds, loop kinds, verify
 * policies, condition-label suggestions, gate default, handoff bounds).
 * Fetched once per editor entry and cached for the page's lifetime — the
 * vocabulary changes only with installs, not per space.
 */
export function getPipelineCatalog(): Promise<PipelineCatalogResponse> {
  return request<PipelineCatalogResponse>('/api/v1/pipeline-catalog');
}

export function getKey(key: string, space?: string, signal?: AbortSignal): Promise<GetConfigKeyResponse> {
  return request<GetConfigKeyResponse>(
    `/api/v1/config/${encodeURIComponent(key)}${spaceQuery(space)}`,
    { signal }
  );
}

export function putKey(
  key: string,
  body: { scope: ConfigScope; value: unknown },
  space?: string
): Promise<WriteConfigKeyResponse> {
  return request<WriteConfigKeyResponse>(
    `/api/v1/config/${encodeURIComponent(key)}${spaceQuery(space)}`,
    {
      method: 'PUT',
      json: true,
      body: JSON.stringify(body),
    }
  );
}

// ---- Management API (board) ----

export function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/api/v1/status');
}

/** Installation-wide recent native sessions; no planning-space selector. */
export function discoverAuditSessions(limit = 50): Promise<AuditSessionsResponse> {
  return request<AuditSessionsResponse>(`/api/v1/audits/sessions?limit=${encodeURIComponent(String(limit))}`);
}

/** Valid direct reports in the machine-wide analytics directory. */
export function listAuditReports(): Promise<AuditReportsResponse> {
  return request<AuditReportsResponse>('/api/v1/audits');
}

export function getAuditReport(id: string): Promise<AuditReportDetailResponse> {
  return request<AuditReportDetailResponse>(`/api/v1/audits/${encodeURIComponent(id)}`);
}

export function runSessionAudit(runtime: AuditRuntime, sessionId: string): Promise<AuditReportDetailResponse> {
  return request<AuditReportDetailResponse>('/api/v1/audits', {
    method: 'POST',
    json: true,
    body: JSON.stringify({ runtime, sessionId }),
  });
}

/**
 * Uploads browser-granted bytes, never a server-side path. The raw request
 * still uses the shared bearer/error/401 seam; the filename is only a
 * percent-encoded basename/type hint.
 */
export function importAuditFile(file: File): Promise<AuditReportDetailResponse> {
  return request<AuditReportDetailResponse>('/api/v1/audits/import', {
    method: 'POST',
    headers: { 'X-Rasen-Filename': encodeURIComponent(file.name) },
    body: file,
  });
}

/** The active changes for the current planning space (design.md D6); no selector = launch-project fallback. */
export function listChanges(space?: string): Promise<ChangesResponse> {
  return request<ChangesResponse>(`/api/v1/changes${spaceQuery(space)}`);
}

/**
 * Per-change run state for the current planning space (design.md D6); no
 * selector = launch-project fallback. The response is additive: legacy
 * `runs` (per-change auto-run/portfolio/goal-run state) PLUS reconciler-engine
 * Run summaries from the machine-home store, projected through the shared
 * projector. The reconciler list is cursor-paginated (task 13.3/13.4); pass
 * `cursor` from a prior page's `nextCursor` to fetch the next page.
 *
 * The UI consumes server truth — it never derives status/waits/terminal
 * client-side.
 */
export function listRuns(
  space?: string,
  opts?: { cursor?: string; limit?: number }
): Promise<RunsResponse> {
  const params = new URLSearchParams();
  if (space) params.set('space', space);
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit !== undefined && Number.isFinite(opts.limit)) {
    params.set('limit', String(opts.limit));
  }
  const query = params.toString();
  return request<RunsResponse>(query ? `/api/v1/runs?${query}` : '/api/v1/runs');
}

/**
 * Exact Run detail: `GET /api/v1/runs/<changeId>/<runId>` (task 13.5/13.6).
 * The server projects the Run through the shared projector (read-only
 * `inspect`, `ensure: false` — never mints identity). A Run from a different
 * worktree is projected read-only with `workspace.scope: 'other'` and no
 * controls or granted Actions. The UI renders what the server projects — it
 * never re-derives frontier/waits/terminal/drift client-side.
 */
export function getRunDetail(
  changeId: string,
  runId: string,
  space?: string
): Promise<ChangeRunView> {
  const encoded = `/api/v1/runs/${encodeURIComponent(changeId)}/${encodeURIComponent(runId)}`;
  return request<ChangeRunView>(space ? `${encoded}${spaceQuery(space)}` : encoded);
}

/**
 * Submit a Run control decision: `POST /api/v1/runs/<changeId>/<runId>` (task
 * 14.5/14.6, design §13/§14). The server's pre-spawn admission validates the
 * body, workspace scope, terminal/engine state, and `expectedRecordVersion`;
 * spawns the CLI subprocess to apply the decision atomically; and returns the
 * sealed response — the committed view + an EMPTY action list (defer-sealed:
 * the first atomic grant happens on a later trusted CLI `resume-run`, never
 * over HTTP). Browser response loss/replay therefore cannot turn an
 * unconsumed admission into an uncertain already-delivered effect.
 *
 * The caller builds the body from projected `allowedControls` + the displayed
 * `recordVersion` and replaces its local view from `response.view` on success
 * — it NEVER optimistically mutates. On a 409 `record_version_conflict` the
 * caller MUST refetch committed truth via {@link getRunDetail} and re-render
 * from the server projection; other non-2xx statuses surface as {@link ApiError}.
 */
export function postRunControl(
  changeId: string,
  runId: string,
  body: RunControlRequestBody,
  space?: string
): Promise<RunControlResponseBody> {
  const encoded = `/api/v1/runs/${encodeURIComponent(changeId)}/${encodeURIComponent(runId)}`;
  return request<RunControlResponseBody>(space ? `${encoded}${spaceQuery(space)}` : encoded, {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

/** The archived changes for the current planning space (ui-space-redesign-archive-page design D1/D6); no selector = launch-project fallback. */
export function listArchive(space?: string): Promise<ArchiveResponse> {
  return request<ArchiveResponse>(`/api/v1/archive${spaceQuery(space)}`);
}

/** Every addressable planning space (planning-space-addressing design D6), for the space switcher. */
export function listSpaces(): Promise<SpacesResponse> {
  return request<SpacesResponse>('/api/v1/spaces');
}

/**
 * The live worktree inventory for a planning space (worktree-aware-spaces D3):
 * each worktree's root, branch, main flag, and active-change count. Non-git
 * space roots answer an empty inventory. No selector = launch-project fallback.
 */
export function listSpaceWorktrees(space?: string): Promise<SpaceWorktreesResponse> {
  return request<SpaceWorktreesResponse>(`/api/v1/spaces/worktrees${spaceQuery(space)}`);
}

/**
 * Read-only directory enumeration for the create-space picker
 * (local-path-browsing design D3). No `path` starts at home; an explicit
 * absolute path enumerates it (the sole escape above home); a relative path
 * 400s. The value is encoded once here at the single client seam.
 */
export function listLocalPaths(path?: string): Promise<LocalPathsResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<LocalPathsResponse>(`/api/v1/local-paths${query}`);
}

export function resolveLocalPath(
  path: string,
  kind: LocalPathSelectionKind
): Promise<ResolveLocalPathResponse> {
  const query = new URLSearchParams({ path, kind });
  return request<ResolveLocalPathResponse>(`/api/v1/local-paths/resolve?${query.toString()}`);
}

export function chooseLocalPath(body: ChooseLocalPathRequest): Promise<ChooseLocalPathResponse> {
  return request<ChooseLocalPathResponse>('/api/v1/local-paths/choose', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

/**
 * Creates a planning space (space-creation design D4): the server spawns the
 * CLI (`init` / `store register` / `store setup`) — it never writes workspace
 * files itself. On failure the thrown `ApiError.message` is the CLI's own
 * error text, verbatim.
 */
export function createSpace(body: CreateSpaceRequest): Promise<CreateSpaceResponse> {
  return request<CreateSpaceResponse>('/api/v1/spaces', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

/**
 * One Task's full roster — active + archived children and portfolio dependency
 * hints (ui-space-redesign-task-detail design D1). The `id` is the polymorphic
 * Task id (a portfolio container OR a bare change), used verbatim (only
 * percent-encoded); no selector = launch-project fallback.
 */
export function getTaskDetail(id: string, space?: string): Promise<TaskDetailResponse> {
  return request<TaskDetailResponse>(`/api/v1/tasks/${encodeURIComponent(id)}${spaceQuery(space)}`);
}

/**
 * The platform's first write path (design D1 of
 * `platform-slice2-task-submission`): submits `{ name, description }` to
 * the CLI-backed bridge. On failure the thrown `ApiError.message` is the
 * CLI's own error text, verbatim.
 */
export function createChange(body: SubmitChangeRequest): Promise<SubmitChangeResponse> {
  return request<SubmitChangeResponse>('/api/v1/changes', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

export function deleteKey(
  key: string,
  scope: ConfigScope,
  space?: string
): Promise<WriteConfigKeyResponse> {
  const query = new URLSearchParams({ scope });
  if (space) query.set('space', space);
  return request<WriteConfigKeyResponse>(`/api/v1/config/${encodeURIComponent(key)}?${query}`, {
    method: 'DELETE',
    json: true,
  });
}

// ---- Sessions (slice3-sessions-ui design D6) ----
// All four calls route through the single `request()` seam, same as every
// other call in this file — auth headers and ApiError narrowing untouched.

/** Sessions for the current planning space (design.md D6); no selector = launch-project fallback. */
export function listSessions(space?: string): Promise<SessionsResponse> {
  return request<SessionsResponse>(`/api/v1/sessions${spaceQuery(space)}`);
}

export function getSession(id: string): Promise<SessionDetailResponse> {
  return request<SessionDetailResponse>(`/api/v1/sessions/${encodeURIComponent(id)}`);
}

export function launchSession(body: LaunchSessionRequest): Promise<SessionActionResponse> {
  return request<SessionActionResponse>('/api/v1/sessions', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

export function killSession(id: string): Promise<SessionActionResponse> {
  return request<SessionActionResponse>(`/api/v1/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    json: true,
  });
}

// ---- Workflow library (workflow-http-api design D3/D4) ----
// The workflow endpoints carry NO space selector — the library is user-wide
// and its endpoints have no space addressing (design D2). All four route
// through the single `request()` seam like every other call.

/** The user-wide workflow library (mirrors `workflow list --json`). */
export function listWorkflows(): Promise<WorkflowListResponse> {
  return request<WorkflowListResponse>('/api/v1/workflows');
}

/** The advisory workflow dependency graph (strong closure + weak enhances per unit; design D7). */
export function getWorkflowDependencies(): Promise<WorkflowDependenciesResponse> {
  return request<WorkflowDependenciesResponse>('/api/v1/workflow-dependencies');
}

/** One workflow's full definition and usage (mirrors `workflow show --json`); id used verbatim, only percent-encoded. */
export function getWorkflow(id: string): Promise<WorkflowDetailResponse> {
  return request<WorkflowDetailResponse>(`/api/v1/workflows/${encodeURIComponent(id)}`);
}

/** Validate an installed id or an absolute draft/package path (mirrors `workflow validate --json`). */
export function validateWorkflow(target: string): Promise<WorkflowValidationResponse> {
  return request<WorkflowValidationResponse>(
    `/api/v1/workflow-validation?target=${encodeURIComponent(target)}`
  );
}

/**
 * Run a library mutation through the CLI-backed bridge (import / init /
 * export / delete). On failure the thrown `ApiError.message` is the CLI's own
 * error text, verbatim.
 */
export function mutateWorkflow(body: WorkflowMutationRequest): Promise<WorkflowMutationResponse> {
  return request<WorkflowMutationResponse>('/api/v1/workflows', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

// ---- Per-space workflow enablement (space-workflow-enablement design D4/D5) ----
// Unlike the library endpoints above, these ARE space-addressed — but via an
// explicit absolute `root`, not the `?space=` selector (a toggle always
// targets one concrete filesystem root, resolved from the spaces listing).

/** The addressed space's per-unit enablement state (mirrors `GET /api/v1/workflow-enablement`). */
export function getWorkflowEnablement(root: string): Promise<WorkflowEnablementResponse> {
  return request<WorkflowEnablementResponse>(
    `/api/v1/workflow-enablement?root=${encodeURIComponent(root)}`
  );
}

/**
 * Enable / disable / reset / set-profile / clear-profile a space. On an apply
 * failure the thrown `ApiError.message` is the CLI's own error text verbatim,
 * and `ApiError.state` carries the space's actual post-write enablement state.
 */
export function mutateWorkflowEnablement(
  body: WorkflowEnablementMutationRequest
): Promise<WorkflowEnablementResponse> {
  return request<WorkflowEnablementResponse>('/api/v1/workflow-enablement', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

// ---- Named workflow profiles (ui-profile-workflow-split profile-http-api) ----
// Profile writes touch only a YAML file server-side (no bounded-CLI bridge);
// both calls route through the single `request()` seam like every other call.

/** Every available profile — built-in `full`/`core` plus saved profiles (a broken file carries its error). */
export function listProfiles(): Promise<ProfileListResponse> {
  return request<ProfileListResponse>('/api/v1/profiles');
}

/**
 * Create / update / delete a saved profile. On failure the thrown
 * `ApiError.message` is the library's own validation text, verbatim.
 */
export function mutateProfile(body: ProfileMutationRequest): Promise<ProfileMutationResponse> {
  return request<ProfileMutationResponse>('/api/v1/profiles', {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

// ---- Store aggregate (store-issue-resources) ----
// Cross-project reads (Issues, Execution Plans, project/target-line rollups,
// grouped Changes) plus the three Issue/Plan mutations, every one addressed
// through the same `space` selector every other call in this file uses — a
// Store is addressed by its stable identity, never a filesystem path or
// display alias (management-ui-shell). Reads are lock-free and never mutate
// (management-http-api); the two write endpoints below (`createStoreIssue`,
// `setStoreIssueState`) take no project/target line at all, since an Issue is
// Store-level intent — only `publishStoreExecutionPlan` carries per-node
// scope, and the caller is responsible for never submitting an incomplete one
// (board-ui: "An aggregate view never submits a mutation with an incomplete
// scope").

/** Every project the Store's catalog declares, with its role flags and Change counts. */
export function getStoreProjects(space?: string): Promise<StoreProjectsResponse> {
  return request<StoreProjectsResponse>(`/api/v1/stores/projects${spaceQuery(space)}`);
}

/** Every target line the Store's catalog declares, with its owning projects and Change counts. */
export function getStoreTargetLines(space?: string): Promise<StoreTargetLinesResponse> {
  return request<StoreTargetLinesResponse>(`/api/v1/stores/target-lines${spaceQuery(space)}`);
}

export interface StoreChangesFilter {
  projects?: string[];
  targetLines?: string[];
  outcomes?: string[];
  state?: 'active' | 'archived';
}

/**
 * Changes grouped by project AND target line (board-ui: the same Change alias
 * in two projects is two board entries). Filters narrow; an empty
 * project/target-line group in the response is a group that exists and has no
 * Changes yet — the caller renders it, never hides it.
 */
export function getStoreChanges(space?: string, filter?: StoreChangesFilter): Promise<StoreChangesResponse> {
  const params = new URLSearchParams();
  if (space) params.set('space', space);
  for (const project of filter?.projects ?? []) params.append('project', project);
  for (const targetLine of filter?.targetLines ?? []) params.append('targetLine', targetLine);
  for (const outcome of filter?.outcomes ?? []) params.append('outcome', outcome);
  if (filter?.state) params.set('state', filter.state);
  const query = params.toString();
  return request<StoreChangesResponse>(query ? `/api/v1/stores/changes?${query}` : '/api/v1/stores/changes');
}

/** Every Store-level Issue, optionally narrowed by state. */
export function getStoreIssues(space?: string, state?: StoreIssueState): Promise<StoreIssuesResponse> {
  const params = new URLSearchParams();
  if (space) params.set('space', space);
  if (state) params.set('state', state);
  const query = params.toString();
  return request<StoreIssuesResponse>(query ? `/api/v1/stores/issues?${query}` : '/api/v1/stores/issues');
}

/**
 * One Issue's full detail: its record plus its resolved current Execution
 * Plan (board-ui: each Issue shows the Changes its plan references, each with
 * its owning project; a reference the Store cannot read is reported
 * unreadable with the reason, never omitted).
 */
export function getStoreIssue(issueId: string, space?: string): Promise<StoreIssueDetailResponse> {
  const params = new URLSearchParams({ issueId });
  if (space) params.set('space', space);
  return request<StoreIssueDetailResponse>(`/api/v1/stores/issue?${params.toString()}`);
}

/**
 * The Issue PROJECTION reads (issue-read-surface). Each is a passthrough of
 * the same core composition `rasen store issue list|show` and
 * `rasen store attention` print, re-derived on every request: there is no
 * cache on either side of this call, so a refresh is a re-derivation and
 * nothing here holds a second copy of any status fact.
 */

/** Every Issue with its projected status, optionally narrowed by lifecycle state. */
export function getStoreIssueProjections(
  space?: string,
  state?: StoreIssueState
): Promise<StoreIssueProjectionsResponse> {
  const params = new URLSearchParams();
  if (space) params.set('space', space);
  if (state) params.set('state', state);
  const query = params.toString();
  return request<StoreIssueProjectionsResponse>(
    query ? `/api/v1/stores/issue-projections?${query}` : '/api/v1/stores/issue-projections'
  );
}

/** One Issue's whole read: status, delivery evidence, and review from one derivation. */
export function getStoreIssueProjection(
  issueId: string,
  space?: string
): Promise<StoreIssueProjectionResponse> {
  const params = new URLSearchParams({ issueId });
  if (space) params.set('space', space);
  return request<StoreIssueProjectionResponse>(`/api/v1/stores/issue-projection?${params.toString()}`);
}

/**
 * The Store-wide needs-attention scan, optionally narrowed to one Issue. An
 * unknown narrowing id is REFUSED by the server (404), never answered with an
 * empty scan — the empty state is a claim about scanned Issues.
 */
export function getStoreIssueAttention(
  space?: string,
  issueId?: string
): Promise<StoreIssueAttentionResponse> {
  const params = new URLSearchParams();
  if (space) params.set('space', space);
  if (issueId) params.set('issueId', issueId);
  const query = params.toString();
  return request<StoreIssueAttentionResponse>(
    query ? `/api/v1/stores/issue-attention?${query}` : '/api/v1/stores/issue-attention'
  );
}

/** Fresh Store-wide Change-to-Issue association read; no client cache/index. */
export function getStoreChangeIssueLinks(
  space?: string
): Promise<StoreChangeIssueLinksResponse> {
  return request<StoreChangeIssueLinksResponse>(
    `/api/v1/stores/change-issue-links${spaceQuery(space)}`
  );
}

/** The derived reverse lookup: which Issues reference a given Change instance. */
export function getStoreIssueReferences(
  changeInstanceId: string,
  space?: string
): Promise<StoreIssueReferencesResponse> {
  const params = new URLSearchParams({ changeInstanceId });
  if (space) params.set('space', space);
  return request<StoreIssueReferencesResponse>(`/api/v1/stores/issue-references?${params.toString()}`);
}

/** One Issue's resolved Execution Plan; omitted `revisionId` selects the latest published revision. */
export function getStoreExecutionPlan(
  issueId: string,
  space?: string,
  revisionId?: string
): Promise<StoreExecutionPlanResponse> {
  const params = new URLSearchParams({ issueId });
  if (space) params.set('space', space);
  if (revisionId) params.set('revisionId', revisionId);
  return request<StoreExecutionPlanResponse>(`/api/v1/stores/execution-plan?${params.toString()}`);
}

/** Create a new Store-level Issue. Takes no project or target line — an Issue is Store-level intent. */
export function createStoreIssue(
  body: StoreIssueCreateRequest,
  space?: string
): Promise<StoreIssueRecordResponse> {
  return request<StoreIssueRecordResponse>(`/api/v1/stores/issues${spaceQuery(space)}`, {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

/** Declare an Issue's lifecycle state. `reason` is required by the server for `dropped`. */
export function setStoreIssueState(
  body: StoreIssueSetStateRequest,
  space?: string
): Promise<StoreIssueRecordResponse> {
  return request<StoreIssueRecordResponse>(`/api/v1/stores/issue-state${spaceQuery(space)}`, {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}

/**
 * Publish a new Execution Plan revision for an Issue. Every node the caller
 * builds MUST already carry a complete `projectId` + `targetLineId` — the
 * server refuses the whole request otherwise (`store_query_scope_incomplete`)
 * and this client makes no attempt to fill a missing part itself.
 */
export function publishStoreExecutionPlan(
  body: StoreExecutionPlanPublishRequest,
  space?: string
): Promise<StoreExecutionPlanPublishResponse> {
  return request<StoreExecutionPlanPublishResponse>(`/api/v1/stores/execution-plan${spaceQuery(space)}`, {
    method: 'POST',
    json: true,
    body: JSON.stringify(body),
  });
}
