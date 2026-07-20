/**
 * Single fetch wrapper for the config API (design.md D5). Nothing else in the
 * app touches `fetch` directly: every call goes through here so auth headers,
 * content-type, and error-envelope narrowing happen in exactly one place.
 */
import { getToken, markUnauthorized } from './token.js';
import type {
  ApiErrorBody,
  ConfigScope,
  GetConfigKeyResponse,
  HealthResponse,
  ListConfigResponse,
  ListPipelinesResponse,
  ListProjectsResponse,
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

function projectQuery(project?: string): string {
  return project ? `?project=${encodeURIComponent(project)}` : '';
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
