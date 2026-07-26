import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import type {
  PipelineCatalogResponse,
  WirePipelineDefinition,
} from '../../../src/core/management-api/wire-types.js';
import type { DispatchRuntime } from '../../../src/core/runtime-adapters.js';
import { getGlobalDataDir } from '../../../src/core/index.js';
import {
  createCapabilityCatalogSnapshot,
  EcpDefinitionModule,
} from '../../../src/core/pipeline-registry/index.js';
import { registerStore } from '../../../src/core/store/registry.js';
import {
  decodePackage,
  type PipelinePackage,
} from '../../../src/core/workflow-package/index.js';
import { runCLI } from '../../helpers/run-cli.js';
import { definitionIssuePathTarget } from '../../../packages/ui/src/canvas/draft.js';

const TOKEN = 'test-token-pipelines-abc123';

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => any;
}

function req(
  port: number,
  options: { method: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body),
          });
        });
      }
    );
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * `/api/v1/pipelines` (pipeline-http-api), served by the management route
 * group (unify-pipeline-http-api): moved here from
 * `test/core/config-api/router.test.ts` — the config router no longer
 * mentions pipelines. Also covers the unified error envelope and the
 * reserved one-segment detail path (design D2).
 */
describe('management-api pipelines endpoints (pipeline-http-api, moved by unify-pipeline-http-api)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ManagementServerHandle;
  let storeRoots: string[];

  function writeScheme(name: string, content: string): void {
    const directory = path.join(tempConfigHome, 'rasen', 'schemes');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.yaml`), content);
  }

  function writeBoundPipeline(root = projectRoot): void {
    const directory = path.join(root, 'rasen', 'pipelines', 'bound-policy');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'pipeline.yaml'),
      [
        'name: bound-policy',
        'agents:',
        '  planner: claude',
        '  implementer: codex',
        'handoff:',
        '  threshold: 0.8',
        'reuse:',
        '  threshold: 0.4',
        'stages:',
        '  - id: plan',
        '    skill: rasen-propose',
        '    role: planner',
        '  - id: apply',
        '    skill: rasen-apply-change',
        '    role: implementer',
        '    requires: [plan]',
        '',
      ].join('\n')
    );
  }

  function writeLifecyclePipeline(root = projectRoot): void {
    const directory = path.join(root, 'rasen', 'pipelines', 'threshold-lifecycle');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'pipeline.yaml'),
      [
        'name: threshold-lifecycle',
        'agents:',
        '  implementer: codex',
        'stages:',
        '  - id: apply',
        '    skill: rasen-apply-change',
        '    role: implementer',
        '',
      ].join('\n')
    );
  }

  function v2Definition(name = 'definition-v2') {
    return {
      version: 2 as const,
      id: `definition:${name}`,
      sourceId: `fixture:${name}`,
      name,
      description: 'Complete Definition v2 fixture',
      inputs: [{ name: 'request', type: 'text/plain', required: true }],
      artifacts: [{ name: 'report', type: 'artifact/report' }],
      outcomes: ['done'],
      declarations: [
        {
          id: 'preserved-body',
          kind: 'Composite' as const,
          provenance: 'custom' as const,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [{ id: 'body-finish', kind: 'Finish' as const, outcome: 'done' }],
            connections: [],
          },
          extensionMetadata: { keep: true },
        },
      ],
      root: {
        nodes: [{ id: 'finish', kind: 'Finish' as const, outcome: 'done' }],
        connections: [],
      },
      limits: { maxActions: 4, budget: 4 },
      extensionMetadata: { keep: 'exactly' },
    };
  }

  function writeV2Pipeline(name = 'definition-v2', root = projectRoot): void {
    const directory = path.join(root, 'rasen', 'pipelines', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'pipeline.yaml'),
      JSON.stringify(v2Definition(name), null, 2)
    );
  }

  async function makeStore(id: string, configContent: string): Promise<string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rasen-pipelines-api-store-${id}-`));
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), configContent);
    await registerStore({ id, localPath: root, globalDataDir: getGlobalDataDir() });
    storeRoots.push(root);
    return root;
  }

  async function startServer(overrides: Partial<ManagementApiContext> = {}): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: { projectId: 'launch-proj', name: 'proj', root: projectRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
      ...overrides,
    };
    handle = await startManagementServer({ context });
    return handle;
  }

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, ...extra };
  }

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipelines-api-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipelines-api-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    process.env.XDG_DATA_HOME = tempConfigHome;
    delete process.env.RASEN_LANG;
    storeRoots = [];
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    fs.rmSync(tempConfigHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
    for (const root of storeRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  describe('pipelines inventory (pipeline-http-api)', () => {
    it('keeps an invalid project winner visible with diagnostics instead of falling through', async () => {
      const name = 'invalid-winner';
      const userDirectory = path.join(
        tempConfigHome,
        'rasen',
        'pipelines',
        name
      );
      fs.mkdirSync(userDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(userDirectory, 'pipeline.yaml'),
        `name: ${name}\nstages:\n  - id: apply\n    skill: rasen-apply-change\n`
      );
      const projectDirectory = path.join(
        projectRoot,
        'rasen',
        'pipelines',
        name
      );
      fs.mkdirSync(projectDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, 'pipeline.yaml'),
        `version: 99\nname: ${name}\n`
      );
      const h = await startServer();

      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines',
        headers: authed(),
      });

      expect(res.status).toBe(200);
      const winners = res
        .json()
        .pipelines.filter((pipeline: any) => pipeline.name === name);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({
        sourceLayer: 'project',
        authoredVersion: 99,
        definitionValid: false,
        planAvailable: false,
        executable: false,
        diagnostics: [
          expect.objectContaining({
            code: 'UNSUPPORTED_VERSION',
            path: '/version',
          }),
        ],
      });
    });

    it('returns declared + effective per-stage metadata, provenance, with boolean gates', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(Array.isArray(body.pipelines)).toBe(true);

      const bugFix = body.pipelines.find((p: any) => p.name === 'bug-fix');
      expect(bugFix).toBeDefined();
      expect(typeof bugFix.description).toBe('string');
      // Built-in pipelines report built-in provenance from the package layer.
      expect(bugFix.provenance).toBe('built-in');
      expect(bugFix.sourceLayer).toBe('package');

      const propose = bugFix.stages.find((s: any) => s.id === 'propose');
      expect(propose).toMatchObject({ id: 'propose', role: 'planner', skill: 'rasen-propose', gate: true });
      // Each stage carries effective values with sources (no config → definition/default).
      expect(propose.effectiveGate).toEqual({ value: true, source: 'stage' });
      expect(propose.effectiveRuntime).toEqual({ value: 'claude', source: 'default' });
      expect(propose.effectiveModel).toHaveProperty('source');
      expect(propose.effectiveHandoff).toHaveProperty('source');

      const goalLoop = body.pipelines.find((p: any) => p.name === 'goal-loop-measure');
      if (goalLoop) {
        const defineGoal = goalLoop.stages.find((s: any) => s.id === 'define-goal');
        // The vet type is retired: define-goal is an ordinary gate: true, and
        // every stage's declared/effective gate is a boolean.
        expect(defineGoal.gate).toBe(true);
        expect(defineGoal.effectiveGate.value).toBe(true);
        for (const stage of goalLoop.stages) {
          expect(typeof stage.gate).toBe('boolean');
          expect(typeof stage.effectiveGate.value).toBe('boolean');
        }
      }
    });

    it('reflects the gate mask in effective gates: off base + per-stage on pierces it', async () => {
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nautopilot:\n  gates: off\npipelines:\n  bug-fix:\n    gates:\n      propose: on\n'
      );
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines', headers: authed() });
      const body = res.json() as any;
      const bugFix = body.pipelines.find((p: any) => p.name === 'bug-fix');
      const propose = bugFix.stages.find((s: any) => s.id === 'propose');
      // The per-stage `on` instance pierces the `off` base.
      expect(propose.effectiveGate).toEqual({ value: true, source: 'stage-override-project' });
      // Every other ordinary gated stage reports off, naming the base layer.
      const otherGated = bugFix.stages.find(
        (s: any) => s.id !== 'propose' && s.gate === true
      );
      if (otherGated) {
        expect(otherGated.effectiveGate.value).toBe(false);
        expect(otherGated.effectiveGate.source).toBe('autopilot-project');
      }
    });

    it('projects runtime-bound handoff and independently resolved reuse metadata without changing legacy fields', async () => {
      writeBoundPipeline();
      writeScheme(
        'claude-policy',
        'handoff: 0.51\nhandoffRoles:\n  planner: 0.52\nreuse: 0.21\nreuseRoles:\n  planner: 0.22\n'
      );
      writeScheme(
        'codex-policy',
        'handoff: 0.61\nhandoffRoles:\n  implementer: 0.62\nreuse: 0.31\nreuseRoles:\n  implementer: 0.32\n'
      );
      writeScheme(
        'default-policy',
        'handoff: 0.71\nreuse: 0.33\n'
      );
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        [
          'schema: spec-driven',
          'thresholds:',
          '  bindings:',
          '    claude: claude-policy',
          '    codex: codex-policy',
          '    default: default-policy',
          '',
        ].join('\n')
      );

      const server = await startServer();
      const response = await req(server.port, {
        method: 'GET',
        path: '/api/v1/pipelines',
        headers: authed(),
      });
      expect(response.status).toBe(200);
      const pipeline = (response.json() as any).pipelines.find(
        (candidate: any) => candidate.name === 'bound-policy'
      );
      expect(pipeline).toBeDefined();

      const plan = pipeline.stages.find((stage: any) => stage.id === 'plan');
      expect(plan).toMatchObject({
        id: 'plan',
        role: 'planner',
        skill: 'rasen-propose',
        gate: false,
        effectiveRuntime: { value: 'claude', source: 'agent' },
        effectiveHandoff: {
          value: 0.52,
          source: 'project-scheme-role',
          binding: {
            scope: 'project',
            row: 'claude',
            scheme: 'claude-policy',
          },
        },
      });
      const apply = pipeline.stages.find((stage: any) => stage.id === 'apply');
      expect(apply.effectiveRuntime).toEqual({
        value: 'codex',
        source: 'agent',
      });
      expect(apply.effectiveHandoff).toMatchObject({
        value: 0.62,
        source: 'project-scheme-role',
        binding: {
          scope: 'project',
          row: 'codex',
          scheme: 'codex-policy',
        },
      });

      expect(pipeline.effectiveReuse).toMatchObject({
        planner: 'auto',
        implementer: 'auto',
        threshold: 0.33,
        roles: { planner: 0.22, implementer: 0.32 },
        sources: {
          threshold: 'project-scheme',
          roles: {
            planner: 'project-scheme-role',
            implementer: 'project-scheme-role',
          },
        },
        bindings: {
          threshold: {
            scope: 'project',
            row: 'default',
            scheme: 'default-policy',
          },
          roles: {
            planner: {
              scope: 'project',
              row: 'claude',
              scheme: 'claude-policy',
            },
            implementer: {
              scope: 'project',
              row: 'codex',
              scheme: 'codex-policy',
            },
          },
        },
      });
    });

    it('preserves dangling diagnostics while falling through to an inherited-store binding', async () => {
      writeBoundPipeline();
      writeScheme(
        'store-policy',
        'handoff: 0.64\nhandoffRoles:\n  implementer: 0.65\nreuse: 0.34\nreuseRoles:\n  implementer: 0.35\n'
      );
      await makeStore(
        'threshold-store',
        'schema: spec-driven\nthresholds:\n  bindings:\n    codex: store-policy\n'
      );
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        [
          'schema: spec-driven',
          'store: threshold-store',
          'thresholds:',
          '  bindings:',
          '    codex: missing-project-policy',
          '',
        ].join('\n')
      );

      const server = await startServer();
      const response = await req(server.port, {
        method: 'GET',
        path: '/api/v1/pipelines',
        headers: authed(),
      });
      expect(response.status).toBe(200);
      const pipeline = (response.json() as any).pipelines.find(
        (candidate: any) => candidate.name === 'bound-policy'
      );
      const apply = pipeline.stages.find((stage: any) => stage.id === 'apply');
      expect(apply.effectiveHandoff).toMatchObject({
        value: 0.65,
        source: 'store-scheme-role',
        binding: {
          scope: 'store',
          row: 'codex',
          scheme: 'store-policy',
        },
        diagnostics: [
          {
            code: 'missing-scheme',
            scope: 'project',
            row: 'codex',
            scheme: 'missing-project-policy',
          },
        ],
      });
      expect(pipeline.effectiveReuse).toMatchObject({
        threshold: 0.4,
        roles: { implementer: 0.35 },
        bindings: {
          roles: {
            implementer: {
              scope: 'store',
              row: 'codex',
              scheme: 'store-policy',
            },
          },
        },
      });
      expect(pipeline.effectiveReuse.bindings?.threshold).toBeUndefined();
      expect(pipeline.effectiveReuse.diagnostics).toEqual([
        expect.objectContaining({
          code: 'missing-scheme',
          scope: 'project',
          row: 'codex',
          scheme: 'missing-project-policy',
        }),
      ]);
    });

    it('uses one role runtime for CLI, inventory, and detail regardless of conflicting stage order', async () => {
      writeScheme(
        'claude-reuse',
        'handoff: 0.5\nreuse: 0.25\nreuseRoles:\n  planner: 0.11\n'
      );
      writeScheme(
        'codex-reuse',
        'handoff: 0.5\nreuse: 0.25\nreuseRoles:\n  planner: 0.22\n'
      );
      fs.writeFileSync(
        path.join(tempConfigHome, 'rasen', 'config.json'),
        JSON.stringify({
          thresholds: {
            bindings: { claude: 'claude-reuse', codex: 'codex-reuse' },
          },
        })
      );

      const writePipeline = (name: string, runtimes: ['claude' | 'codex', 'claude' | 'codex']) => {
        const directory = path.join(projectRoot, 'rasen', 'pipelines', name);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
          path.join(directory, 'pipeline.yaml'),
          [
            `name: ${name}`,
            'agents:',
            '  planner: claude',
            'stages:',
            '  - id: first',
            '    skill: rasen-propose',
            '    role: planner',
            `    runtime: ${runtimes[0]}`,
            '  - id: second',
            '    skill: rasen-propose',
            '    role: planner',
            `    runtime: ${runtimes[1]}`,
            '    requires: [first]',
            '',
          ].join('\n')
        );
      };
      writePipeline('role-runtime-forward', ['codex', 'claude']);
      writePipeline('role-runtime-reverse', ['claude', 'codex']);

      const server = await startServer();
      const inventoryResponse = await req(server.port, {
        method: 'GET',
        path: '/api/v1/pipelines',
        headers: authed(),
      });
      expect(inventoryResponse.status).toBe(200);
      const inventory = inventoryResponse.json() as {
        pipelines: Array<{
          name: string;
          roleRuntimes: Record<string, { value: DispatchRuntime; source: string }>;
          effectiveReuse: { roles: { planner: number } };
        }>;
      };

      for (const name of ['role-runtime-forward', 'role-runtime-reverse']) {
        const listed = inventory.pipelines.find((pipeline) => pipeline.name === name)!;
        expect(listed.roleRuntimes.planner).toEqual({
          value: 'claude',
          source: 'declaration',
        });
        expect(listed.effectiveReuse.roles.planner).toBe(0.11);

        const detailResponse = await req(server.port, {
          method: 'GET',
          path: `/api/v1/pipelines/${name}`,
          headers: authed(),
        });
        expect(detailResponse.status).toBe(200);
        const detail = detailResponse.json() as {
          pipeline: {
            roleRuntimes: Record<string, { value: DispatchRuntime; source: string }>;
            effectiveReuse: { roles: { planner: number } };
          };
        };
        expect(detail.pipeline.roleRuntimes.planner).toEqual(
          listed.roleRuntimes.planner
        );
        expect(detail.pipeline.effectiveReuse.roles.planner).toBe(
          listed.effectiveReuse.roles.planner
        );

        const cli = await runCLI(['pipeline', 'show', name, '--json'], {
          cwd: projectRoot,
          env: {
            RASEN_HOME: '',
            XDG_CONFIG_HOME: tempConfigHome,
            XDG_DATA_HOME: tempConfigHome,
          },
        });
        expect(cli.exitCode).toBe(0);
        const shown = JSON.parse(cli.stdout) as {
          reuse: { roles: { planner: number } };
        };
        expect(shown.reuse.roles.planner).toBe(
          listed.effectiveReuse.roles.planner
        );
      }
    });

    it('runs the threshold UI/core lifecycle through create, bind, resolve, dangling delete, remove, and legacy fallback', async () => {
      writeLifecyclePipeline();
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        [
          'schema: spec-driven',
          'handoff:',
          '  threshold: 0.73',
          '  roles:',
          '    implementer: 0.74',
          '',
        ].join('\n')
      );

      const server = await startServer();
      const scheme = {
        handoff: 0.61,
        handoffRoles: { implementer: 0.62 },
        reuse: 0.31,
        reuseRoles: { implementer: 0.32 },
      };
      const created = await req(server.port, {
        method: 'POST',
        path: '/api/v1/threshold-schemes',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'create',
          name: 'lifecycle-policy',
          scheme,
        }),
      });
      expect(created.status).toBe(201);

      const bound = await req(server.port, {
        method: 'PUT',
        path: '/api/v1/config/thresholds.bindings.codex',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 'lifecycle-policy' }),
      });
      expect(bound.status).toBe(200);
      expect((bound.json() as any).entry).toMatchObject({
        instanceKey: 'thresholds.bindings.codex',
        value: 'lifecycle-policy',
        source: 'project',
      });

      const readLifecycle = async (): Promise<any> => {
        const response = await req(server.port, {
          method: 'GET',
          path: '/api/v1/pipelines',
          headers: authed(),
        });
        expect(response.status).toBe(200);
        return (response.json() as any).pipelines.find(
          (candidate: any) => candidate.name === 'threshold-lifecycle'
        );
      };

      const resolved = await readLifecycle();
      expect(resolved.stages[0].effectiveHandoff).toMatchObject({
        value: 0.62,
        source: 'project-scheme-role',
        binding: {
          scope: 'project',
          row: 'codex',
          scheme: 'lifecycle-policy',
        },
      });
      expect(resolved.effectiveReuse).toMatchObject({
        threshold: 0.25,
        roles: { implementer: 0.32 },
        sources: {
          threshold: 'default',
          roles: { implementer: 'project-scheme-role' },
        },
        bindings: {
          roles: {
            implementer: {
              scope: 'project',
              row: 'codex',
              scheme: 'lifecycle-policy',
            },
          },
        },
      });

      const deletedWhileBound = await req(server.port, {
        method: 'POST',
        path: '/api/v1/threshold-schemes',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'delete', name: 'lifecycle-policy' }),
      });
      expect(deletedWhileBound.status).toBe(200);
      expect(
        fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf8')
      ).toContain('codex: lifecycle-policy');

      const dangling = await readLifecycle();
      expect(dangling.stages[0].effectiveHandoff).toMatchObject({
        value: 0.74,
        source: 'project-role',
        diagnostics: [
          {
            code: 'missing-scheme',
            scope: 'project',
            row: 'codex',
            scheme: 'lifecycle-policy',
          },
        ],
      });
      expect(dangling.effectiveReuse).toMatchObject({
        threshold: 0.25,
        roles: { implementer: 0.25 },
        sources: {
          threshold: 'default',
          roles: { implementer: 'default' },
        },
        diagnostics: [
          {
            code: 'missing-scheme',
            scope: 'project',
            row: 'codex',
            scheme: 'lifecycle-policy',
          },
        ],
      });

      const recreated = await req(server.port, {
        method: 'POST',
        path: '/api/v1/threshold-schemes',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'create',
          name: 'lifecycle-policy',
          scheme,
        }),
      });
      expect(recreated.status).toBe(201);
      expect((await readLifecycle()).stages[0].effectiveHandoff.binding).toEqual({
        scope: 'project',
        row: 'codex',
        scheme: 'lifecycle-policy',
      });

      const removed = await req(server.port, {
        method: 'DELETE',
        path: '/api/v1/config/thresholds.bindings.codex?scope=project',
        headers: authed({ 'Content-Type': 'application/json' }),
      });
      expect(removed.status).toBe(200);

      const legacyFallback = await readLifecycle();
      expect(legacyFallback.stages[0].effectiveHandoff).toMatchObject({
        value: 0.74,
        source: 'project-role',
      });
      expect(legacyFallback.stages[0].effectiveHandoff.binding).toBeUndefined();
      expect(legacyFallback.stages[0].effectiveHandoff.diagnostics).toBeUndefined();
      expect(legacyFallback.effectiveReuse).toMatchObject({
        threshold: 0.25,
        roles: { implementer: 0.25 },
      });
      expect(legacyFallback.effectiveReuse.bindings).toBeUndefined();
      expect(legacyFallback.effectiveReuse.diagnostics).toBeUndefined();
    });

    it('rejects PUT and DELETE with 405 (POST is the mutation bridge)', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipelines', headers: authed() });
        expect(res.status).toBe(405);
        expect((res.json() as any).error.code).toBe('method_not_allowed');
      }
    });

    it('POST rejects an unknown op with 400 spawning nothing', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'nonsense' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST rejects a relative path / option-shaped name before any spawn', async () => {
      const h = await startServer();
      const relative = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'import', path: 'relative/pkg.rasenpkg' }),
      });
      expect(relative.status).toBe(400);

      const optionName = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'delete', name: '--force' }),
      });
      expect(optionName.status).toBe(400);
    });

    it('requires the session token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines' });
      expect(res.status).toBe(401);
      expect((res.json() as any).error.code).toBe('unauthorized');
    });
  });

  /**
   * Composition test (unify-pipeline-http-api task 6.2): proves the composed
   * management server answers the full method matrix on `/api/v1/pipelines`
   * with the SAME status+code contract the config router previously served,
   * now sourced from the management group, plus the unified envelope's
   * optional `fix` field and the reserved one-segment detail path.
   */
  describe('composition: management group answers /api/v1/pipelines (design R1)', () => {
    it('GET without a token is 401 unauthorized, answered by the management group', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines' });
      expect(res.status).toBe(401);
      const body = res.json() as any;
      expect(body.error.code).toBe('unauthorized');
      expect(body.error.fix).toBeUndefined();
    });

    it('authorized GET succeeds with no client-visible change', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines', headers: authed() });
      expect(res.status).toBe(200);
      expect(Array.isArray((res.json() as any).pipelines)).toBe(true);
    });

    it('authorized POST routes to the CLI-backed mutation bridge rather than 405', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'nonsense' }),
      });
      // Reaches the bridge's own input guard (400), never a 405 — proves POST
      // is admitted and dispatched, not rejected as an unadmitted method.
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('invalid_input');
    });

    it('PUT and DELETE are rejected with 405 method_not_allowed and modify no file', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipelines', headers: authed() });
        expect(res.status).toBe(405);
        expect((res.json() as any).error.code).toBe('method_not_allowed');
      }
    });

    it('a trailing slash is tolerated exactly like every other management path', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/', headers: authed() });
      expect(res.status).toBe(200);
    });

    it('a space-resolution error keeps its fix hint after the route-group move', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines?project=no-such-project-id',
        headers: authed(),
      });
      expect(res.status).toBe(404);
      const body = res.json() as any;
      expect(body.error.code).toBe('project_not_found');
      expect(typeof body.error.fix).toBe('string');
      expect(body.error.fix.length).toBeGreaterThan(0);
    });

    it('the one-segment detail path serves the detail contract, deeper suffixes fall through', async () => {
      const h = await startServer();

      const detail = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/bug-fix', headers: authed() });
      expect(detail.status).toBe(200);
      const body = detail.json() as any;
      expect(body.pipeline.name).toBe('bug-fix');
      expect(body.definition.name).toBe('bug-fix');
      expect(body.definition.version).toBe(1);
      expect(body.editable).toBe(false);

      // A two-segment suffix was never claimed by either group's dispatch — it
      // falls through past the management group to the config group's
      // catch-all 404, still a 404 but via a different route (not asserted
      // here beyond "not silently a management 2xx/405").
      const deeper = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines/bug-fix/extra',
        headers: authed(),
      });
      expect(deeper.status).toBe(404);
    });
  });

  describe('pipeline detail (pipeline-definition-api)', () => {
    it('returns the invalid winning source and preparation diagnostics instead of 404', async () => {
      const name = 'invalid-detail-winner';
      const projectDirectory = path.join(
        projectRoot,
        'rasen',
        'pipelines',
        name
      );
      fs.mkdirSync(projectDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, 'pipeline.yaml'),
        JSON.stringify({
          ...v2Definition(name),
          root: {
            nodes: [{ id: 'choice', kind: 'Choice' }],
            connections: [],
          },
        })
      );
      const h = await startServer();

      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/pipelines/${name}`,
        headers: authed(),
      });

      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.definition).toMatchObject({ version: 2, name });
      expect(body.pipeline).toMatchObject({
        name,
        sourceLayer: 'project',
        definitionValid: false,
        planAvailable: false,
        executable: false,
      });
      expect(body.preparation).toMatchObject({
        authoredVersion: 2,
        normalizedVersion: 2,
        definitionValid: false,
        diagnostics: [
          expect.objectContaining({
            code: 'INVALID_SOURCE',
            path: '/root/nodes/0/outcomes',
          }),
        ],
        planAvailable: false,
        executable: false,
      });
    });

    it('returns both views plus editable for a user pipeline', async () => {
      const h = await startServer();
      const userDir = path.join(tempConfigHome, 'rasen', 'pipelines', 'my-pipe');
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(
        path.join(userDir, 'pipeline.yaml'),
        'name: my-pipe\nstages:\n  - id: implement\n    skill: rasen-apply-change\n    role: implementer\n'
      );
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/my-pipe', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.pipeline.name).toBe('my-pipe');
      expect(body.definition.version).toBe(1);
      expect(body.definition.stages[0].id).toBe('implement');
      expect(body.editable).toBe(true);
      expect(body.preparation).toMatchObject({
        authoredVersion: 1,
        normalizedVersion: 2,
        definitionValid: true,
        planAvailable: true,
        executable: true,
        executionMode: 'legacy',
      });
      expect(body.preparation.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'LEGACY_NORMALIZED', severity: 'warning' }),
        ])
      );
      expect(body.preparation.digests).toMatchObject({
        source: expect.any(String),
        capability: expect.any(String),
        plan: expect.any(String),
      });
      expect(body).not.toHaveProperty('plan');
      expect(body.preparation).not.toHaveProperty('plan');
    });

    it('returns the complete v2 definition and preparation capability without plan internals', async () => {
      writeV2Pipeline();
      const h = await startServer();

      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines/definition-v2',
        headers: authed(),
      });

      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.definition).toEqual(v2Definition());
      expect(body.pipeline).toMatchObject({
        name: 'definition-v2',
        sourceLayer: 'project',
        authoredVersion: 2,
        definitionValid: true,
        planAvailable: true,
        executable: false,
        executionMode: 'unavailable',
        unavailableReason: 'ecp_v2_runtime_unavailable',
      });
      expect(body.preparation).toMatchObject({
        authoredVersion: 2,
        normalizedVersion: 2,
        definitionValid: true,
        diagnostics: [],
        planAvailable: true,
        executable: false,
        executionMode: 'unavailable',
        unavailableReason: 'ecp_v2_runtime_unavailable',
      });
      expect(body.preparation.digests.plan).toEqual(expect.any(String));
      expect(JSON.stringify(body)).not.toContain('"payload"');
    });

    it('404s an unknown name, 400s a malformed name', async () => {
      const h = await startServer();
      const unknown = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/no-such-pipeline', headers: authed() });
      expect(unknown.status).toBe(404);
      expect((unknown.json() as any).error.code).toBe('not_found');

      const malformed = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/-bad-name', headers: authed() });
      expect(malformed.status).toBe(400);
    });

    it('rejects PUT/DELETE/POST with 405', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE', 'POST']) {
        const res = await req(h.port, { method, path: '/api/v1/pipelines/bug-fix', headers: authed() });
        expect(res.status).toBe(405);
      }
    });

    it('a pipeline named catalog is served by detail, not shadowed by the catalog endpoint', async () => {
      const h = await startServer();
      const userDir = path.join(tempConfigHome, 'rasen', 'pipelines', 'catalog');
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(
        path.join(userDir, 'pipeline.yaml'),
        'name: catalog\nstages:\n  - id: implement\n    skill: rasen-apply-change\n'
      );
      const detail = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/catalog', headers: authed() });
      expect(detail.status).toBe(200);
      expect((detail.json() as any).pipeline.name).toBe('catalog');

      const catalogEndpoint = await req(h.port, { method: 'GET', path: '/api/v1/pipeline-catalog', headers: authed() });
      expect(catalogEndpoint.status).toBe(200);
      expect(Array.isArray((catalogEndpoint.json() as any).roles)).toBe(true);
    });
  });

  describe('pipeline-catalog (pipeline-definition-api)', () => {
    it('reports vocabulary sourced from the schemas plus the skill inventory', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipeline-catalog', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as PipelineCatalogResponse;
      expectTypeOf(body.runtimes).toEqualTypeOf<DispatchRuntime[]>();
      expect(body.roles).toEqual(expect.arrayContaining(['planner', 'implementer', 'reviewer', 'fixer', 'shipper']));
      expect(body.runtimes).toEqual(['claude', 'codex']);
      expect(body.loopKinds).toEqual(expect.arrayContaining(['review-cycle', 'goal']));
      expect(Array.isArray(body.skills)).toBe(true);
      expect(body.skills.length).toBeGreaterThan(0);
      expect(body.skills[0]).toHaveProperty('enabled');
      for (const skill of body.skills) {
        expect(skill.capability).toEqual({
          id: `skill:${skill.id}`,
          version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
        });
      }
      expect(body.gate.default).toBe(false);
      expect(body.handoff.fractionRange).toEqual([0, 1]);
    });

    it('rejects POST/PUT/DELETE with 405', async () => {
      const h = await startServer();
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipeline-catalog', headers: authed() });
        expect(res.status).toBe(405);
      }
    });

    it('requires the session token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipeline-catalog' });
      expect(res.status).toBe(401);
    });
  });

  describe('pipeline-validation (pipeline-definition-api)', () => {
    function validDefinition() {
      return {
        version: 1 as const,
        name: 'draft',
        stages: [
          { id: 'implement', skill: 'rasen-apply-change', role: 'implementer' },
          { id: 'review', skill: 'rasen-review', role: 'reviewer', requires: ['implement'] },
        ],
      };
    }

    it('200s a valid draft with no error issues', async () => {
      expectTypeOf<WirePipelineDefinition['version']>().toEqualTypeOf<1>();
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition: validDefinition() }),
      });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.valid).toBe(true);
      expect(body.issues.filter((i: any) => i.severity === 'error')).toHaveLength(0);
    });

    it('reports an actionable /version issue for an unknown content version', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          definition: { ...validDefinition(), version: 99 },
        }),
      });

      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.valid).toBe(false);
      expect(body.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
            code: 'UNSUPPORTED_VERSION',
            path: '/version',
            message: expect.stringMatching(
              /received 99.*supported versions are 1 and 2.*upgrade/
            ),
          }),
        ])
      );
    });

    it.each(['zed', 'unknown'])(
      'rejects non-dispatch runtime %s in pipeline drafts',
      async (runtime) => {
        const h = await startServer();
        const definition = {
          ...validDefinition(),
          agents: { implementer: runtime },
          stages: [
            { id: 'implement', skill: 'rasen-apply-change', role: 'implementer' },
            {
              id: 'review',
              skill: 'rasen-review',
              role: 'reviewer',
              runtime,
              requires: ['implement'],
            },
          ],
        };
        const res = await req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition }),
        });
        expect(res.status).toBe(200);
        const body = res.json() as any;
        expect(body.valid).toBe(false);
        expect(body.issues.some((issue: any) => /runtime/.test(issue.path))).toBe(true);
      }
    );

    it('accepts a floor-free ui draft but rejects the equivalent composed draft', async () => {
      const h = await startServer();
      const floorFreeDefinition = {
        name: 'floor-free',
        stages: [{ id: 'implement', skill: 'rasen-apply-change', role: 'implementer' }],
      };

      const [uiResponse, composedResponse] = await Promise.all([
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: { ...floorFreeDefinition, origin: 'ui' } }),
        }),
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: { ...floorFreeDefinition, origin: 'composed' } }),
        }),
      ]);

      expect(uiResponse.status).toBe(200);
      const uiBody = uiResponse.json() as any;
      expect(uiBody.valid).toBe(true);
      expect(uiBody.issues.filter((issue: any) => /quality-floor/.test(issue.message))).toHaveLength(0);

      expect(composedResponse.status).toBe(200);
      const composedBody = composedResponse.json() as any;
      expect(composedBody.valid).toBe(false);
      expect(composedBody.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
            message: expect.stringMatching(/origin: composed.*quality-floor/),
          }),
        ])
      );
    });

    it('200s an invalid draft reporting all issues (cycle + unknown skill)', async () => {
      const h = await startServer();
      const definition = {
        name: 'draft',
        stages: [
          { id: 'a', skill: 'no-such-skill', requires: ['b'] },
          { id: 'b', skill: 'rasen-apply-change', requires: ['a'] },
        ],
      };
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition }),
      });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.valid).toBe(false);
      expect(body.issues.length).toBeGreaterThanOrEqual(2);
      expect(body.issues).toContainEqual(
        expect.objectContaining({
          code: 'GRAPH_CYCLE',
          path: '/stages/1/requires/0',
          message: 'Cyclic dependency detected: a → b → a',
        })
      );
      expect(body.issues.some((i: any) => i.path === '/stages/0/skill')).toBe(true);
    });

    it('400s a body with no definition member; never spawns anything for validation', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ notADefinition: true }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects GET/PUT/DELETE with 405', async () => {
      const h = await startServer();
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipeline-validation', headers: authed() });
        expect(res.status).toBe(405);
      }
    });

    it('runs without a 409 even while a pipeline mutation is in flight', async () => {
      const h = await startServer();
      // No concurrent mutation actually spawned here (unit-scope), but the
      // endpoint must not touch the bridge's cap-1 slot at all: two concurrent
      // validation requests both succeed.
      const [a, b] = await Promise.all([
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: validDefinition() }),
        }),
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: validDefinition() }),
        }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
    });
  });

  describe('save op (POST /api/v1/pipelines, pipeline-definition-api)', () => {
    it('preserves v2 meaning through validate, save, detail, and package export', async () => {
      const h = await startServer();
      const definition = v2Definition('api-v2-roundtrip');
      const corePreparation = EcpDefinitionModule.prepare(
        definition,
        createCapabilityCatalogSnapshot([])
      );
      expect(corePreparation.ok).toBe(true);
      if (!corePreparation.ok) throw corePreparation.error;
      const validation = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition }),
      });
      const validationBody = validation.json() as any;
      expect(validationBody.valid).toBe(true);
      expect(validationBody.preparation.digests).toEqual(
        corePreparation.value.digests
      );

      const save = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: 'api-v2-roundtrip',
          definition,
        }),
      });
      expect(save.status).toBe(201);
      expect((save.json() as any).preparation.digests.plan).toBe(
        validationBody.preparation.digests.plan
      );

      const detail = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines/api-v2-roundtrip',
        headers: authed(),
      });
      expect(detail.status).toBe(200);
      const detailBody = detail.json() as any;
      expect(detailBody.definition).toEqual(definition);
      expect(detailBody.preparation.digests.plan).toBe(
        validationBody.preparation.digests.plan
      );

      const destination = path.join(
        projectRoot,
        'exports',
        'api-v2-roundtrip.rasenpkg'
      );
      const exported = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'export',
          name: 'api-v2-roundtrip',
          path: destination,
        }),
      });
      expect(exported.status).toBe(200);
      const packageValue = decodePackage(
        fs.readFileSync(destination),
        'pipeline'
      ) as PipelinePackage;
      const manifest = packageValue.pipelines[0]!.files.find(
        (file) => file.path === 'pipeline.yaml'
      )!;
      expect(manifest.content).toContain('extensionMetadata');
      const exportedPreparation = EcpDefinitionModule.prepare(
        manifest.content,
        createCapabilityCatalogSnapshot([])
      );
      expect(exportedPreparation.ok).toBe(true);
      if (exportedPreparation.ok) {
        expect(exportedPreparation.value.digests).toEqual(
          corePreparation.value.digests
        );
      }
      expect(path.resolve(destination)).toBe(destination);
    });

    it('returns the exact validation diagnostics and never writes an invalid v2 draft', async () => {
      const h = await startServer();
      const definition = {
        ...v2Definition('invalid-v2'),
        root: {
          nodes: [
            {
              id: 'first-gate',
              kind: 'Gate' as const,
              outcomes: ['continue'],
            },
            {
              id: 'second-gate',
              kind: 'Gate' as const,
              outcomes: ['continue'],
            },
          ],
          connections: [
            {
              id: 'first-to-second',
              from: { node: 'first-gate', port: 'continue' },
              to: { node: 'second-gate', port: 'input' },
            },
            {
              id: 'second-to-first',
              from: { node: 'second-gate', port: 'continue' },
              to: { node: 'first-gate', port: 'input' },
            },
          ],
        },
      };
      const corePreparation = EcpDefinitionModule.prepare(
        definition,
        createCapabilityCatalogSnapshot([])
      );
      expect(corePreparation.ok).toBe(false);
      if (corePreparation.ok) throw new Error('Expected the cycle fixture to fail.');
      const validation = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition }),
      });
      expect(validation.status).toBe(200);
      const validationBody = validation.json() as any;
      expect(validationBody.valid).toBe(false);
      expect(validationBody.preparation.diagnostics).toEqual(
        corePreparation.error.diagnostics
      );
      const cycleIssue = validationBody.preparation.diagnostics.find(
        (issue: { code?: string }) => issue.code === 'GRAPH_CYCLE'
      );
      expect(cycleIssue).toBeDefined();
      expect(definitionIssuePathTarget(definition, cycleIssue.path)).toEqual({
        kind: 'connection',
        index: 0,
        id: 'first-to-second',
      });

      const save = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'invalid-v2', definition }),
      });

      expect(save.status).toBe(422);
      expect((save.json() as any).error.diagnostics).toEqual(
        validationBody.preparation.diagnostics
      );
      expect(
        fs.existsSync(
          path.join(tempConfigHome, 'rasen', 'pipelines', 'invalid-v2')
        )
      ).toBe(false);
    });

    it('keeps duplicate contract diagnostics identical across validate and blocked save', async () => {
      const h = await startServer();
      const base = v2Definition('duplicate-contract-v2');
      const definition = {
        ...base,
        inputs: [
          { name: 'request', type: 'text/plain', required: true },
          { name: 'request', type: 'application/json', required: true },
        ],
        declarations: [
          {
            ...base.declarations[0],
            outcomes: ['done', 'done'],
          },
        ],
      };
      const corePreparation = EcpDefinitionModule.prepare(
        definition,
        createCapabilityCatalogSnapshot([])
      );
      expect(corePreparation.ok).toBe(false);
      if (corePreparation.ok) {
        throw new Error('Expected duplicate authored contracts to fail.');
      }

      const validation = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition }),
      });
      expect(validation.status).toBe(200);
      const validationBody = validation.json() as any;
      expect(validationBody.valid).toBe(false);
      expect(validationBody.preparation.diagnostics).toEqual(
        corePreparation.error.diagnostics
      );
      expect(validationBody.preparation.diagnostics).toEqual([
        expect.objectContaining({
          code: 'DUPLICATE_ID',
          path: '/declarations/0/outcomes/1',
          related: [
            expect.objectContaining({
              path: '/declarations/0/outcomes/0',
            }),
          ],
        }),
        expect.objectContaining({
          code: 'DUPLICATE_ID',
          path: '/inputs/1/name',
          related: [
            expect.objectContaining({
              path: '/inputs/0/name',
            }),
          ],
        }),
      ]);

      const save = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: 'duplicate-contract-v2',
          definition,
        }),
      });
      expect(save.status).toBe(422);
      expect((save.json() as any).error.diagnostics).toEqual(
        validationBody.preparation.diagnostics
      );
      expect(
        fs.existsSync(
          path.join(
            tempConfigHome,
            'rasen',
            'pipelines',
            'duplicate-contract-v2'
          )
        )
      ).toBe(false);
    });

    it('keeps preparation warnings visible on validation and successful save', async () => {
      const h = await startServer();
      const definition = {
        version: 1,
        name: 'warning-visible',
        stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
      };
      const validation = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition }),
      });
      expect((validation.json() as any).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'LEGACY_NORMALIZED' }),
        ])
      );

      const save = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: 'warning-visible',
          definition,
        }),
      });
      expect(save.status).toBe(201);
      expect((save.json() as any).preparation.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'LEGACY_NORMALIZED' }),
        ])
      );
    });

    it('creates a new user pipeline with 201, then detail round-trips it', async () => {
      const h = await startServer();
      const definition = {
        name: 'saved-pipe',
        stages: [{ id: 'implement', skill: 'rasen-apply-change', role: 'implementer' }],
      };
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe', definition }),
      });
      expect(res.status).toBe(201);

      const detail = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/saved-pipe', headers: authed() });
      expect(detail.status).toBe(200);
      expect((detail.json() as any).definition.stages[0].skill).toBe('rasen-apply-change');
    });

    it('refuses overwrite without force (422), then force succeeds (200)', async () => {
      const h = await startServer();
      const definition = {
        name: 'saved-pipe-2',
        stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
      };
      const first = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe-2', definition }),
      });
      expect(first.status).toBe(201);

      const noForce = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe-2', definition }),
      });
      expect(noForce.status).toBe(422);

      const forced = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe-2', definition, force: true }),
      });
      expect(forced.status).toBe(200);
    });

    it('refuses saving over a built-in name regardless of force', async () => {
      const h = await startServer();
      const definition = {
        name: 'bug-fix',
        stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
      };
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'bug-fix', definition, force: true }),
      });
      expect(res.status).toBe(422);
    });
  });
});
