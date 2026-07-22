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
  RunsResponse,
  SessionActionResponse,
  SessionDetailResponse,
  SessionsResponse,
  SpacesResponse,
  StatusResponse,
  SubmitChangeRequest,
  SubmitChangeResponse,
  TaskDetailResponse,
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

/** Config-api scoping (unchanged): the config endpoints stay on `?project=` (planning-space-addressing did not move config onto `?space=`). */
function projectQuery(project?: string): string {
  return project ? `?project=${encodeURIComponent(project)}` : '';
}

/**
 * Management-api space scoping (design.md D6): a `<type>:<id>` selector,
 * URL-encoded once here at the single client seam. Omitting it sends no
 * `space` param, preserving the server's launch-project fallback exactly.
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

export function listConfig(project?: string): Promise<ListConfigResponse> {
  return request<ListConfigResponse>(`/api/v1/config${projectQuery(project)}`);
}

/** Read-only gates inventory (D5/D6): the available pipelines and their gate-carrying stages. */
export function listPipelines(): Promise<ListPipelinesResponse> {
  return request<ListPipelinesResponse>('/api/v1/pipelines');
}

export function getKey(key: string, project?: string): Promise<GetConfigKeyResponse> {
  return request<GetConfigKeyResponse>(
    `/api/v1/config/${encodeURIComponent(key)}${projectQuery(project)}`
  );
}

export function putKey(
  key: string,
  body: { scope: ConfigScope; value: unknown },
  project?: string
): Promise<WriteConfigKeyResponse> {
  return request<WriteConfigKeyResponse>(
    `/api/v1/config/${encodeURIComponent(key)}${projectQuery(project)}`,
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
  project?: string
): Promise<WriteConfigKeyResponse> {
  const query = new URLSearchParams({ scope });
  if (project) query.set('project', project);
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
