import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { resetTokenStateForTest } from '../../src/api/token.js';
import { configListFixture } from '../fixtures/config-list.js';
import { projectsListFixture } from '../fixtures/projects-list.js';
import { healthFixture } from '../fixtures/health.js';
import { errorsFixture } from '../fixtures/errors.js';
import { sessionDetailFixture, sessionsListFixture } from '../fixtures/sessions-list.js';
import type { PipelineDetailResponse } from '../../src/api/types.js';

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

  it('preserves the full discriminated v2 Definition and preparation capability contract', async () => {
    const detail: PipelineDetailResponse = {
      pipeline: {
        name: 'v2-client-contract',
        description: 'v2',
        provenance: 'user',
        sourceLayer: 'project',
        stages: [],
        authoredVersion: 2,
        normalizedVersion: 2,
        definitionValid: true,
        planAvailable: true,
        executable: false,
        executionMode: 'unavailable',
        unavailableReason: 'ecp_v2_runtime_unavailable',
      },
      definition: {
        version: 2,
        id: 'definition:v2-client-contract',
        sourceId: 'fixture:v2-client-contract',
        name: 'v2-client-contract',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
          connections: [],
        },
        unexposed: { preserve: true },
      },
      preparation: {
        authoredVersion: 2,
        normalizedVersion: 2,
        definitionValid: true,
        diagnostics: [],
        digests: {
          source: 'source-digest',
          capability: 'capability-digest',
          plan: 'plan-digest',
        },
        planAvailable: true,
        executable: false,
        executionMode: 'unavailable',
        unavailableReason: 'ecp_v2_runtime_unavailable',
      },
      editable: true,
    };
    (fetch as any).mockResolvedValueOnce(jsonResponse(200, detail));

    const result = await client.getPipelineDetail(
      'v2-client-contract',
      'project:proj_abc123'
    );

    expect(result).toEqual(detail);
    expect(result.definition.version).toBe(2);
    expect(result.preparation).toMatchObject({
      planAvailable: true,
      executable: false,
      unavailableReason: 'ecp_v2_runtime_unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('"payload"');
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

  it('sets Content-Type: application/json on DELETE and puts scope + space in the query string', async () => {
    (fetch as any).mockResolvedValueOnce(
      jsonResponse(200, { entry: configListFixture.entries[1], store: null })
    );
    await client.deleteKey('proactive', 'project', 'project:proj_abc123');
    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(url).toContain('scope=project');
    // The config client moved wholesale onto ?space= (W2 design D7).
    expect(url).toContain('space=project%3Aproj_abc123');
    expect(url).not.toContain('project=proj_abc123');
  });

  it('appends ?space= on config reads when a space selector is given (W2 design D7)', async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(200, configListFixture));
    await client.listConfig('project:proj_abc123');
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/v1/config?space=project%3Aproj_abc123');
  });

  it('returns typed data for listProjects', async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(200, projectsListFixture));
    const result = await client.listProjects();
    expect(result.projects).toHaveLength(2);
  });

  it('uses the typed theme catalog/import routes and sends raw JSON bytes', async () => {
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse(200, { themes: [], skipped: [] }))
      .mockResolvedValueOnce(jsonResponse(201, {
        theme: {
          schemaVersion: 1,
          id: 'forest-paper',
          name: 'Forest Paper',
          mode: 'light',
          tokens: { light: {} },
          effects: [],
        },
      }));
    expect(await client.listThemes()).toEqual({ themes: [], skipped: [] });
    const document = '{"schemaVersion":1}';
    expect((await client.importTheme(document)).theme.id).toBe('forest-paper');
    const [url, init] = (fetch as any).mock.calls[1];
    expect(url).toBe('/api/v1/themes/import');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(document);
  });

  it('passes startup AbortSignals through config and theme catalog reads', async () => {
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse(200, { entry: configListFixture.entries[0] }))
      .mockResolvedValueOnce(jsonResponse(200, { themes: [], skipped: [] }));
    const controller = new AbortController();
    await Promise.all([
      client.getKey('ui.theme', undefined, controller.signal),
      client.listThemes(controller.signal),
    ]);
    expect((fetch as any).mock.calls[0][1].signal).toBe(controller.signal);
    expect((fetch as any).mock.calls[1][1].signal).toBe(controller.signal);
  });

  it('preserves stable theme validation details on ApiError', async () => {
    (fetch as any).mockResolvedValueOnce(jsonResponse(400, {
      error: {
        code: 'invalid_theme',
        message: 'Theme manifest failed validation.',
        details: [{ path: 'tokens.dark.canvas', code: 'invalid_token', message: 'Invalid color.' }],
      },
    }));
    await expect(client.importTheme('{}')).rejects.toMatchObject({
      code: 'invalid_theme',
      details: [{ path: 'tokens.dark.canvas', code: 'invalid_token' }],
    });
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

  it('createChange POSTs json to /api/v1/changes and returns the created change', async () => {
    (fetch as any).mockResolvedValueOnce(
      jsonResponse(201, { change: { id: 'my-change', path: '/proj/rasen/changes/my-change', schema: 'spec-driven' } })
    );
    const result = await client.createChange({ name: 'my-change', description: 'A description' });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/v1/changes');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ name: 'my-change', description: 'A description' });
    expect(result.change.id).toBe('my-change');
  });

  it('createChange surfaces the CLI error verbatim, with cliExitCode/stderr, on a cli_error response', async () => {
    (fetch as any).mockResolvedValueOnce(
      jsonResponse(422, {
        error: {
          code: 'cli_error',
          message: "Change 'my-change' already exists at /proj/rasen/changes/my-change",
          cliExitCode: 1,
          stderr: '',
        },
      })
    );
    await expect(client.createChange({ name: 'my-change', description: 'desc' })).rejects.toMatchObject({
      code: 'cli_error',
      message: "Change 'my-change' already exists at /proj/rasen/changes/my-change",
    });
  });

  describe('sessions (slice3-sessions-ui design D6)', () => {
    it('listSessions GETs /api/v1/sessions with auth and returns the shape-checked fixture', async () => {
      (fetch as any).mockResolvedValueOnce(jsonResponse(200, sessionsListFixture));
      const result = await client.listSessions();
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/sessions');
      expect(init.method).toBeUndefined(); // default GET
      expect(result.sessions).toHaveLength(sessionsListFixture.sessions.length);
      expect(result.sessions[0]!.session.id).toBe('sess-live-with-progress');
    });

    it('getSession GETs /api/v1/sessions/:id and returns record + tails', async () => {
      (fetch as any).mockResolvedValueOnce(jsonResponse(200, sessionDetailFixture));
      const result = await client.getSession('sess-live-with-progress');
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/sessions/sess-live-with-progress');
      expect(result.tails.stdout).toContain('building');
    });

    it('launchSession POSTs json to /api/v1/sessions with the request body', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(201, { session: sessionsListFixture.sessions[2]!.session })
      );
      const result = await client.launchSession({ kind: 'auto', task: 'do a thing' });
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/sessions');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ kind: 'auto', task: 'do a thing' });
      expect(result.session.id).toBe('sess-no-change');
    });

    it('killSession DELETEs /api/v1/sessions/:id and returns the patched record', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(202, {
          session: { ...sessionsListFixture.sessions[0]!.session, state: 'exiting' },
        })
      );
      const result = await client.killSession('sess-live-with-progress');
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/sessions/sess-live-with-progress');
      expect(init.method).toBe('DELETE');
      expect(result.session.state).toBe('exiting');
    });

    it('surfaces a 404 kill (session already gone) as an ApiError', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(404, { error: { code: 'not_found', message: 'Session not found.' } })
      );
      await expect(client.killSession('gone')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    });

    it('surfaces server rejection envelopes verbatim on launch (agent_cli_unavailable)', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(503, {
          error: { code: 'agent_cli_unavailable', message: 'No agent CLI could be resolved on this machine.' },
        })
      );
      await expect(client.launchSession({ kind: 'auto', task: 'x' })).rejects.toMatchObject({
        code: 'agent_cli_unavailable',
      });
    });
  });

  describe('space scoping (management-ui-shell design D6)', () => {
    it('threads the space selector as ?space= on listChanges/listRuns/listSessions', async () => {
      // A fresh Response per call — a Response body can only be read once.
      (fetch as any).mockImplementation(() => Promise.resolve(jsonResponse(200, { changes: [], errors: [] })));
      await client.listChanges('project:proj_abc123');
      await client.listRuns('store:my-store');
      await client.listSessions('project:proj_abc123');
      const urls = (fetch as any).mock.calls.map((c: unknown[]) => c[0]);
      // encodeURIComponent leaves the id verbatim but escapes the `:` separator.
      expect(urls[0]).toBe('/api/v1/changes?space=project%3Aproj_abc123');
      expect(urls[1]).toBe('/api/v1/runs?space=store%3Amy-store');
      expect(urls[2]).toBe('/api/v1/sessions?space=project%3Aproj_abc123');
    });

    it('omits ?space= entirely when no selector is given (preserving the launch-project fallback)', async () => {
      (fetch as any).mockImplementation(() => Promise.resolve(jsonResponse(200, { changes: [], errors: [] })));
      await client.listChanges();
      await client.listRuns();
      await client.listSessions();
      const urls = (fetch as any).mock.calls.map((c: unknown[]) => c[0]);
      expect(urls[0]).toBe('/api/v1/changes');
      expect(urls[1]).toBe('/api/v1/runs');
      expect(urls[2]).toBe('/api/v1/sessions');
    });

    it('carries the space selector in the launchSession body, not the query', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(201, { session: sessionsListFixture.sessions[2]!.session })
      );
      await client.launchSession({ kind: 'auto', task: 'do a thing', space: 'store:my-store' });
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/sessions'); // no query
      expect(JSON.parse(init.body)).toEqual({ kind: 'auto', task: 'do a thing', space: 'store:my-store' });
    });

    it('carries the runtime execution selector in the launchSession JSON body', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(201, { session: sessionsListFixture.sessions[2]!.session })
      );
      await client.launchSession({
        kind: 'auto',
        task: 'do a thing',
        space: 'store:my-store',
        execution: 'project:member-a',
      });
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/sessions');
      expect(JSON.parse(init.body)).toEqual({
        kind: 'auto',
        task: 'do a thing',
        space: 'store:my-store',
        execution: 'project:member-a',
      });
    });

    it('keeps the opaque id byte-for-byte (mixed case / separators) inside the query', async () => {
      (fetch as any).mockResolvedValueOnce(jsonResponse(200, { changes: [], errors: [] }));
      await client.listChanges('project:Proj_Mixed-Case.v2');
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toContain('Proj_Mixed-Case.v2'); // no lowercasing / canonicalization
    });

    it('listSpaces GETs /api/v1/spaces', async () => {
      (fetch as any).mockResolvedValueOnce(jsonResponse(200, { spaces: [] }));
      await client.listSpaces();
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/spaces');
      expect(init.method).toBeUndefined();
    });
  });

  describe('reconciler runs (14.1/14.2)', () => {
    it('listRuns threads cursor and limit for reconciler pagination', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(200, { runs: [], reconcilerRuns: [], hasMore: false })
      );
      await client.listRuns('project:test', { cursor: 'abc123', limit: 50 });
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toContain('space=project%3Atest');
      expect(url).toContain('cursor=abc123');
      expect(url).toContain('limit=50');
    });

    it('listRuns omits cursor/limit when not provided (backward-compatible)', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(200, { runs: [], reconcilerRuns: [], hasMore: false })
      );
      await client.listRuns('project:test');
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/runs?space=project%3Atest');
    });

    it('getRunDetail GETs the exact run detail route with percent-encoded ids', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(200, {
          format: 'change-run-view/1',
          engine: 'reconciler',
          runId: 'run:abc',
          change: {
            planningSpaceId: 'ps:1',
            projectId: 'p',
            changeId: 'my-change',
            instanceId: 'ci:1',
          },
          recordVersion: 1,
          status: 'running',
          sourceState: 'active',
          workspace: { instanceId: 'wi:1', scope: 'current' },
          drift: {
            definition: 'unchanged',
            sourceRevision: { provenance: 'unchanged', content: 'unchanged', semantic: 'unchanged' },
            capability: 'unchanged',
            policy: 'unchanged',
            workspace: 'unchanged',
          },
          sections: [],
        })
      );
      const view = await client.getRunDetail('my-change', 'run:abc', 'project:test');
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/runs/my-change/run%3Aabc?space=project%3Atest');
      expect(view.format).toBe('change-run-view/1');
      expect(view.engine).toBe('reconciler');
    });

    it('getRunDetail omits space query when no selector is given', async () => {
      (fetch as any).mockResolvedValueOnce(
        jsonResponse(200, {
          format: 'change-run-view/1',
          engine: 'reconciler',
          runId: 'run:abc',
          change: { planningSpaceId: 'ps:1', projectId: 'p', changeId: 'c', instanceId: 'ci:1' },
          recordVersion: 1,
          status: 'running',
          sourceState: 'active',
          workspace: { instanceId: 'wi:1', scope: 'current' },
          drift: {
            definition: 'unchanged',
            sourceRevision: { provenance: 'unchanged', content: 'unchanged', semantic: 'unchanged' },
            capability: 'unchanged',
            policy: 'unchanged',
            workspace: 'unchanged',
          },
          sections: [],
        })
      );
      await client.getRunDetail('c', 'run:abc');
      const [url] = (fetch as any).mock.calls[0];
      expect(url).toBe('/api/v1/runs/c/run%3Aabc');
    });
  });
});
