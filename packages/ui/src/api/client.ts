/**
 * Single fetch wrapper for the config API (design.md D5). Nothing else in the
 * app touches `fetch` directly: every call goes through here so auth headers,
 * content-type, and error-envelope narrowing happen in exactly one place.
 */
import { getToken, markUnauthorized } from './token.js';
import type {
  ApiErrorBody,
  ArchiveResponse,
  ChangesResponse,
  ConfigScope,
  CreateSpaceRequest,
  CreateSpaceResponse,
  GetConfigKeyResponse,
  HealthResponse,
  LaunchSessionRequest,
  ListConfigResponse,
  ListPipelinesResponse,
  ListProjectsResponse,
  LocalPathsResponse,
  PipelineMutationRequest,
  PipelineMutationResponse,
  RunsResponse,
  SessionActionResponse,
  SessionDetailResponse,
  SessionsResponse,
  SpacesResponse,
  StatusResponse,
  SubmitChangeRequest,
  SubmitChangeResponse,
  TaskDetailResponse,
  WorkflowDetailResponse,
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

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.fix = body.error.fix;
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

export function getKey(key: string, space?: string): Promise<GetConfigKeyResponse> {
  return request<GetConfigKeyResponse>(
    `/api/v1/config/${encodeURIComponent(key)}${spaceQuery(space)}`
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

/** The active changes for the current planning space (design.md D6); no selector = launch-project fallback. */
export function listChanges(space?: string): Promise<ChangesResponse> {
  return request<ChangesResponse>(`/api/v1/changes${spaceQuery(space)}`);
}

/** Per-change run state for the current planning space (design.md D6); no selector = launch-project fallback. */
export function listRuns(space?: string): Promise<RunsResponse> {
  return request<RunsResponse>(`/api/v1/runs${spaceQuery(space)}`);
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
 * Read-only directory enumeration for the create-space picker
 * (local-path-browsing design D3). No `path` starts at home; an explicit
 * absolute path enumerates it (the sole escape above home); a relative path
 * 400s. The value is encoded once here at the single client seam.
 */
export function listLocalPaths(path?: string): Promise<LocalPathsResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<LocalPathsResponse>(`/api/v1/local-paths${query}`);
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
