import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { resetTokenStateForTest } from '../../src/api/token.js';
import { configListFixture } from '../fixtures/config-list.js';
import { projectsListFixture } from '../fixtures/projects-list.js';
import { healthFixture } from '../fixtures/health.js';
import { errorsFixture } from '../fixtures/errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    resetTokenStateForTest();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects no Authorization header when no token is set', async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(200, healthFixture));
    await client.health();
    const [, init] = (fetch as any).mock.calls[0];
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('sends GET without a Content-Type header for reads', async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(200, configListFixture));
    await client.listConfig();
    const [, init] = (fetch as any).mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('sets Content-Type: application/json on PUT', async () => {
    (fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { entry: configListFixture.entries[1] })
    );
    await client.putKey('proactive', { scope: 'global', value: true });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ scope: 'global', value: true });
    expect(url).toBe('/api/v1/config/proactive');
  });

  it('sets Content-Type: application/json on DELETE and puts scope in the query string', async () => {
    (fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { entry: configListFixture.entries[1] })
    );
    await client.deleteKey('proactive', 'project', 'proj_abc123');
    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(url).toContain('scope=project');
    expect(url).toContain('project=proj_abc123');
  });

  it('appends ?project= on reads when a project is given', async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(200, configListFixture));
    await client.listConfig('proj_abc123');
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/v1/config?project=proj_abc123');
  });

  it('returns typed data for listProjects', async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(200, projectsListFixture));
    const result = await client.listProjects();
    expect(result.projects).toHaveLength(2);
  });

  it('narrows a non-2xx body to ApiError with code/message/fix', async () => {
    const { status, body } = errorsFixture.invalid_scope;
    (fetch as any).mockResolvedValueOnce(jsonResponse(status, body));
    await expect(client.putKey('repoMode', { scope: 'project', value: 'solo' })).rejects.toMatchObject(
      {
        code: 'invalid_scope',
        fix: 'Use scope: "global" instead.',
      }
    );
  });

  it('narrows scope_required errors', async () => {
    const { status, body } = errorsFixture.scope_required;
    (fetch as any).mockResolvedValueOnce(jsonResponse(status, body));
    try {
      await client.putKey('proactive', { scope: undefined as any, value: true });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('scope_required');
    }
  });

  it('narrows project_required errors', async () => {
    const { status, body } = errorsFixture.project_required;
    (fetch as any).mockResolvedValueOnce(jsonResponse(status, body));
    await expect(client.putKey('autopilot.gates', { scope: 'project', value: 'off' })).rejects.toMatchObject(
      { code: 'project_required' }
    );
  });

  it('falls back to a synthetic error when the body is not a valid error envelope', async () => {
    (fetch as any).mockResolvedValueOnce(new Response('not json', { status: 500 }));
    await expect(client.health()).rejects.toMatchObject({ code: 'unknown_error', status: 500 });
  });
});
