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
  createProductionCapabilityCatalogSnapshot,
  EcpDefinitionModule,
  freezeProductionPreparedPipelineRegistry,
  projectPreparedPipelineExecutionView,
  resolvePipelineStageOverrides,
  serializeAuthoredPipelineDefinition,
} from '../../../src/core/pipeline-registry/index.js';
import { registerStore } from '../../../src/core/store/registry.js';
import {
  decodePackage,
  type PipelinePackage,
} from '../../../src/core/workflow-package/index.js';
import { runCLI } from '../../helpers/run-cli.js';
import {
  CONTROL_SOURCE_PORT,
  CONTROL_TARGET_PORT,
  definitionIssuePathTarget,
  duplicateV2Definition,
  updateBoundedLoopContract,
  updateDeclaration,
} from '../../../packages/ui/src/canvas/draft.js';
import type { WirePipelineDefinitionV2 as UiWirePipelineDefinitionV2 } from '../../../packages/ui/src/api/types.js';
import { loadWorkflowCatalog } from '../../../src/core/workflow-registry/index.js';
import { lowerRuntimePlan } from '../../../src/core/change-run/internal/lowerer.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import type { Digest, RunId } from '../../../src/core/change-run/contracts.js';
import {
  CANVAS_V2_APPLY_CAPABILITY,
  CANVAS_V2_AUTHORING_DEFINITION,
  CANVAS_V2_AUTHORING_NAME,
} from '../../../packages/ui/test/fixtures/canvas-v2-authoring.js';

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
      hostRuntime: { runtime: 'unknown', source: 'unknown' },
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
      expect(bugFix.authoredVersion).toBe(2);
      expect(bugFix.buildOrder).toEqual([
        'root:propose',
        'root:apply',
        'root:verify/node:review',
        'root:verify/node:triage',
        'root:verify/node:fix',
        'root:verify/node:re-review',
        'root:ship',
        'root:archive',
      ]);
      expect(bugFix.boundedLoops).toEqual([
        expect.objectContaining({ nodeId: 'verify' }),
      ]);
      expect(bugFix.capabilityPaths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ profilePath: 'root:verify/strategy' }),
        ])
      );
      expect(bugFix.policyPaths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ profilePath: 'root:verify/strategy' }),
        ])
      );
      expect(bugFix.availableEngines).toContain('reconciler');
      expect(bugFix.reconcilerSupport).toMatchObject({ supported: true });
      expect(bugFix).not.toHaveProperty('compatibilityBoundary');

      const compatibilityFixtures = body.pipelines.filter(
        (pipeline: any) => pipeline.compatibilityBoundary !== undefined
      );
      expect(compatibilityFixtures).toEqual([
        expect.objectContaining({
          name: 'auto-decompose',
          authoredVersion: 1,
          compatibilityBoundary: 'issue-dispatch-0.3.0',
        }),
      ]);

      const propose = bugFix.stages.find((s: any) => s.id === 'propose');
      expect(propose).toMatchObject({ id: 'propose', role: 'planner', skill: 'rasen-propose', gate: true });
      expect(propose).toMatchObject({
        nodePath: 'root:propose',
        profilePath: 'root:propose',
        workspace: 'write',
        capability: { id: 'skill:rasen-propose' },
      });
      // The server has no LEAD host context, so it reports the explicit
      // unknown-host compatibility provenance instead of claiming native.
      expect(propose.effectiveGate).toEqual({ value: true, source: 'stage' });
      expect(propose.effectiveRuntime).toEqual({
        value: 'claude',
        source: 'legacy-default',
      });
      expect(propose.dispatchMode).toBe('legacy-fallback');
      expect(propose.bridge).toBeNull();
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

    it('reports configured and absent effective effort identically in inventory and detail', async () => {
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        [
          'schema: spec-driven',
          'pipelines:',
          '  bug-fix:',
          '    efforts:',
          '      propose: max',
          '',
        ].join('\n')
      );
      const h = await startServer();

      const inventoryRes = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines',
        headers: authed(),
      });
      const detailRes = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines/bug-fix',
        headers: authed(),
      });

      expect(inventoryRes.status).toBe(200);
      expect(detailRes.status).toBe(200);
      const inventory = inventoryRes.json() as any;
      const inventoryPipeline = inventory.pipelines.find((pipeline: any) => pipeline.name === 'bug-fix');
      const detailPipeline = (detailRes.json() as any).pipeline;
      for (const pipeline of [inventoryPipeline, detailPipeline]) {
        expect(pipeline.stages.find((stage: any) => stage.id === 'propose').effectiveEffort).toEqual({
          value: 'max',
          source: 'stage-override-project',
        });
        expect(pipeline.stages.find((stage: any) => stage.id === 'apply').effectiveEffort).toEqual({
          value: null,
          source: 'default',
        });
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
      expect(body.definition.version).toBe(2);
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
    it('projects the auto-decompose issue/dispatch compatibility boundary', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines/auto-decompose',
        headers: authed(),
      });

      expect(res.status).toBe(200);
      expect(res.json()).toMatchObject({
        definition: { version: 1, name: 'auto-decompose' },
        pipeline: {
          name: 'auto-decompose',
          sourceLayer: 'package',
          authoredVersion: 1,
          compatibilityBoundary: 'issue-dispatch-0.3.0',
        },
      });
    });

    it.each(['codex', 'claude'] as const)(
      'uses the same %s host-aware runtime provenance in inventory, detail, and the shared CLI projection',
      async (runtime) => {
        const hostRuntime = { runtime, source: 'env-override' as const };
        const h = await startServer({ hostRuntime });
        const inventory = await req(h.port, {
          method: 'GET',
          path: '/api/v1/pipelines',
          headers: authed(),
        });
        const detail = await req(h.port, {
          method: 'GET',
          path: '/api/v1/pipelines/bug-fix',
          headers: authed(),
        });
        const inventoryPropose = (inventory.json() as any).pipelines
          .find((pipeline: any) => pipeline.name === 'bug-fix').stages
          .find((stage: any) => stage.id === 'propose');
        const detailPropose = (detail.json() as any).pipeline.stages
          .find((stage: any) => stage.id === 'propose');

        const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, {
          reporter: false,
        });
        const prepared = registry.load('bug-fix').prepared;
        const cliProjection = projectPreparedPipelineExecutionView(
          prepared,
          registry.catalog,
          {
            host: hostRuntime,
            overrides: resolvePipelineStageOverrides('bug-fix', { projectRoot }),
            basePolicy: { effective: 'on', source: 'default' },
          }
        ).stages.find((stage) => stage.id === 'propose')!;

        const expected = {
          effectiveRuntime: cliProjection.runtime,
          dispatchMode: cliProjection.dispatchMode,
          bridge: cliProjection.bridge,
        };
        expect(inventoryPropose).toMatchObject(expected);
        expect(detailPropose).toMatchObject(expected);
        expect(expected).toEqual({
          effectiveRuntime: { value: runtime, source: 'host' },
          dispatchMode: 'native',
          bridge: null,
        });
        await h.stopServer();
        handle = null;
      }
    );

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

    it('returns non-empty native-v2 execution stages from the shared prepared view', async () => {
      const workflow = loadWorkflowCatalog().definitions.find(
        (candidate) => candidate.skill.template.name === 'rasen-apply-change'
      );
      expect(workflow).toBeDefined();
      const name = 'native-v2-api-view';
      const directory = path.join(projectRoot, 'rasen', 'pipelines', name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'pipeline.yaml'),
        JSON.stringify({
          version: 2,
          id: `pipeline:${name}`,
          sourceId: `project:${name}`,
          name,
          inputs: [],
          artifacts: [],
          outcomes: ['approved', 'rejected', 'done'],
          declarations: [],
          root: {
            nodes: [
              {
                id: 'apply',
                kind: 'AtomicStage',
                capability: {
                  id: 'skill:rasen-apply-change',
                  version: workflow!.digest,
                },
                execution: {
                  version: 1,
                  role: 'implementer',
                  workspace: { access: 'write' },
                  runtime: 'codex',
                  model: 'gpt-fixture',
                  sessionReuse: 'stage',
                },
              },
              {
                id: 'apply-gate',
                kind: 'Gate',
                target: 'apply',
                outcomes: ['approved', 'rejected'],
                dispositions: { approved: 'proceed', rejected: 'escalate' },
              },
            ],
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
      const pipeline = (res.json() as any).pipeline;
      expect(pipeline.buildOrder).toEqual(['root:apply']);
      expect(pipeline.boundedLoops).toEqual([]);
      expect(pipeline.availableEngines).toEqual([]);
      expect(pipeline.reconcilerSupport).toMatchObject({
        supported: false,
        reason: 'unsupported_pipeline_semantics',
      });
      expect(pipeline.stages).toEqual([
        expect.objectContaining({
          id: 'apply',
          nodePath: 'root:apply',
          profilePath: 'root:apply',
          capability: {
            id: 'skill:rasen-apply-change',
            version: workflow!.digest,
          },
          role: 'implementer',
          workspace: 'write',
          gate: true,
          effectiveGate: { value: true, source: 'stage' },
          effectiveModel: { value: 'gpt-fixture', source: 'stage' },
          effectiveRuntime: { value: 'codex', source: 'stage' },
          sessionReuse: {
            effective: 'same-invocation',
            authored: 'stage',
            source: 'definition',
          },
        }),
      ]);
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
    it('accepts Canvas control handles and a body-switched loop through real prepare, validate, save, and detail reload', async () => {
      const definition = structuredClone(CANVAS_V2_AUTHORING_DEFINITION);
      definition.outcomes.push('retry');
      const firstAtomic = definition.root.nodes.find(
        (node) => node.kind === 'AtomicStage'
      );
      if (!firstAtomic || firstAtomic.kind !== 'AtomicStage') {
        throw new Error('Canvas AtomicStage fixture missing');
      }
      definition.root.nodes.push({
        ...structuredClone(firstAtomic),
        id: 'atomic-stage-2',
      });
      definition.root.connections.push({
        id: 'atomic-stage-to-atomic-stage-2',
        from: { node: firstAtomic.id, port: CONTROL_SOURCE_PORT },
        to: { node: 'atomic-stage-2', port: CONTROL_TARGET_PORT },
      });
      const originalBody = definition.declarations[0]!;
      originalBody.outcomes = ['retry', 'done'];
      const loop = definition.root.nodes.find(
        (node) => node.kind === 'BoundedLoop'
      );
      if (!loop || loop.kind !== 'BoundedLoop') {
        throw new Error('Canvas BoundedLoop fixture missing');
      }
      loop.exits = {
        retry: { action: 'continue' },
        done: { action: 'exit', outcome: 'done' },
      };
      const alternateBody = {
        ...structuredClone(originalBody),
        id: 'alternate-work-body',
        outcomes: ['done', 'partial'],
      };
      const alternateStage = alternateBody.graph.nodes[0];
      if (!alternateStage || alternateStage.kind !== 'AtomicStage') {
        throw new Error('alternate body stage fixture missing');
      }
      alternateStage.capability = {
        id: 'skill:alternate-body',
        version: 'sha256:alternate-body',
      };
      definition.declarations.push(alternateBody);
      const switched = updateBoundedLoopContract(definition, 'bounded-loop', {
        body: 'alternate-work-body',
      });
      expect(switched.root.nodes.find((node) => node.id === 'bounded-loop')).toMatchObject({
        body: 'alternate-work-body',
        exits: {
          done: { action: 'exit', outcome: 'done' },
          partial: { action: 'continue' },
        },
      });
      expect(
        (switched.root.nodes.find((node) => node.id === 'bounded-loop') as {
          exits: object;
        }).exits
      ).not.toHaveProperty('retry');

      const canvasCatalog = createCapabilityCatalogSnapshot([
        {
          ...CANVAS_V2_APPLY_CAPABILITY,
          availability: 'enabled',
          inputs: [],
          artifacts: [],
          outcomes: ['retry', 'done'],
          limits: {},
        },
        {
          id: 'skill:alternate-body',
          version: 'sha256:alternate-body',
          availability: 'enabled',
          inputs: [],
          artifacts: [],
          outcomes: ['done', 'partial'],
          limits: {},
        },
      ]);
      const prepared = EcpDefinitionModule.prepare(switched, canvasCatalog);
      expect(
        prepared.ok
          ? []
          : prepared.error.diagnostics.map(
              (issue) => `${issue.code} ${issue.path}: ${issue.message}`
            )
      ).toEqual([]);

      const managementDefinition = structuredClone(
        CANVAS_V2_AUTHORING_DEFINITION
      );
      const managementAtomic = managementDefinition.root.nodes.find(
        (node) => node.kind === 'AtomicStage'
      );
      const managementLoop = managementDefinition.root.nodes.find(
        (node) => node.kind === 'BoundedLoop'
      );
      if (
        !managementAtomic ||
        managementAtomic.kind !== 'AtomicStage' ||
        !managementLoop ||
        managementLoop.kind !== 'BoundedLoop'
      ) {
        throw new Error('Management Canvas fixture is incomplete');
      }
      managementDefinition.root.nodes.push({
        ...structuredClone(managementAtomic),
        id: 'atomic-stage-2',
      });
      managementDefinition.root.connections.push({
        id: 'atomic-stage-to-atomic-stage-2',
        from: { node: managementAtomic.id, port: CONTROL_SOURCE_PORT },
        to: { node: 'atomic-stage-2', port: CONTROL_TARGET_PORT },
      });
      managementLoop.exits = {
        retry: { action: 'continue' },
        done: { action: 'exit', outcome: 'done' },
      };
      managementDefinition.declarations.push({
        ...structuredClone(managementDefinition.declarations[0]!),
        id: 'alternate-work-body',
      });
      const managedSwitched = updateBoundedLoopContract(
        managementDefinition,
        'bounded-loop',
        { body: 'alternate-work-body' }
      );
      expect(
        (managedSwitched.root.nodes.find((node) => node.id === 'bounded-loop') as {
          exits: object;
        }).exits
      ).toEqual({ done: { action: 'exit', outcome: 'done' } });

      const h = await startServer();
      const validation = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition: managedSwitched }),
      });
      expect(validation.status).toBe(200);
      expect((validation.json() as any).valid).toBe(true);

      const save = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: managedSwitched.name,
          definition: managedSwitched,
        }),
      });
      expect(save.status).toBe(201);
      const detail = await req(h.port, {
        method: 'GET',
        path: `/api/v1/pipelines/${managedSwitched.name}`,
        headers: authed(),
      });
      expect(detail.status).toBe(200);
      expect((detail.json() as any).definition.root.connections).toContainEqual({
        id: 'atomic-stage-to-atomic-stage-2',
        from: { node: 'atomic-stage', port: CONTROL_SOURCE_PORT },
        to: { node: 'atomic-stage-2', port: CONTROL_TARGET_PORT },
      });
      expect((detail.json() as any).definition.root.nodes).toContainEqual(
        expect.objectContaining({
          id: 'bounded-loop',
          body: 'alternate-work-body',
          exits: {
            done: { action: 'exit', outcome: 'done' },
          },
        })
      );
    }, 120_000);

    it('prepares and persists declaration-outcome reconciliation for a saved BoundedLoop', async () => {
      const h = await startServer();
      const sourceDetail = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines/small-feature',
        headers: authed(),
      });
      expect(sourceDetail.status).toBe(200);
      const source = duplicateV2Definition(
        (sourceDetail.json() as { definition: UiWirePipelineDefinitionV2 }).definition,
        'canvas-declaration-outcome-reconcile'
      );
      const declaration = source.declarations.find(
        (candidate) => candidate.id === 'review-cycle-body'
      );
      const loop = source.root.nodes.find((candidate) => candidate.id === 'review-loop');
      if (!declaration || !loop || loop.kind !== 'BoundedLoop') {
        throw new Error('review-cycle fixture missing');
      }
      declaration.outcomes = ['stale', 'clean'];
      loop.exits = {
        stale: { action: 'continue' },
        clean: { action: 'exit', outcome: 'review-clean' },
      };

      const reconciled = updateDeclaration(source, declaration.id, {
        outcomes: ['clean', 'needs_fix'],
      });
      const reconciledLoop = reconciled.root.nodes.find(
        (candidate) => candidate.id === 'review-loop'
      );
      expect(reconciledLoop).toMatchObject({
        kind: 'BoundedLoop',
        exits: {
          clean: { action: 'exit', outcome: 'review-clean' },
          needs_fix: { action: 'continue' },
        },
      });
      expect((reconciledLoop as { exits: object }).exits).not.toHaveProperty('stale');

      const workflowCatalog = loadWorkflowCatalog({ projectRoot });
      const enabledSkills = new Set(
        workflowCatalog.definitions.map((definition) => definition.skill.template.name)
      );
      const prepared = EcpDefinitionModule.prepare(
        reconciled,
        createProductionCapabilityCatalogSnapshot(
          workflowCatalog.definitions,
          enabledSkills
        )
      );
      expect(
        prepared.ok
          ? []
          : prepared.error.diagnostics.map(
              (issue) => `${issue.code} ${issue.path}: ${issue.message}`
            )
      ).toEqual([]);

      const validation = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition: reconciled }),
      });
      expect(validation.status).toBe(200);
      expect((validation.json() as { valid: boolean }).valid).toBe(true);

      const save = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: reconciled.name,
          definition: reconciled,
        }),
      });
      expect(save.status).toBe(201);
      const detail = await req(h.port, {
        method: 'GET',
        path: `/api/v1/pipelines/${reconciled.name}`,
        headers: authed(),
      });
      expect(detail.status).toBe(200);
      expect((detail.json() as any).definition.declarations).toContainEqual(
        expect.objectContaining({
          id: 'review-cycle-body',
          outcomes: ['clean', 'needs_fix'],
        })
      );
      expect((detail.json() as any).definition.root.nodes).toContainEqual(
        expect.objectContaining({
          id: 'review-loop',
          exits: {
            clean: { action: 'exit', outcome: 'review-clean' },
            needs_fix: { action: 'continue' },
          },
        })
      );
    }, 120_000);

    it('round-trips the exact blank-Canvas all-eight request through Management, canonical bytes, portable export/import, and one intentional edit', async () => {
      const workflow = loadWorkflowCatalog().definitions.find(
        (candidate) => candidate.skill.template.name === 'rasen-apply-change'
      );
      expect(workflow?.digest).toBe(CANVAS_V2_APPLY_CAPABILITY.version);
      const definition = structuredClone(CANVAS_V2_AUTHORING_DEFINITION);
      expect(definition.root.connections).toEqual([
        {
          id: 'composite-ref:body-report->bounded-loop:brief',
          from: { node: 'composite-ref', port: 'body-report' },
          to: { node: 'bounded-loop', port: 'brief' },
        },
        {
          id: 'bounded-loop:done->choice:input',
          from: { node: 'bounded-loop', port: 'done' },
          to: { node: 'choice', port: 'input' },
        },
        {
          id: 'choice:default->fan-out:input',
          from: { node: 'choice', port: 'default' },
          to: { node: 'fan-out', port: 'input' },
        },
        {
          id: 'choice:parallel->fan-out:input',
          from: { node: 'choice', port: 'parallel' },
          to: { node: 'fan-out', port: 'input' },
        },
        {
          id: 'fan-out:atomic-stage->atomic-stage:input',
          from: { node: 'fan-out', port: 'atomic-stage' },
          to: { node: 'atomic-stage', port: 'input' },
        },
        {
          id: 'atomic-stage:done->join:atomic-stage',
          from: { node: 'atomic-stage', port: 'done' },
          to: { node: 'join', port: 'atomic-stage' },
        },
        {
          id: 'join:done->finish:input',
          from: { node: 'join', port: 'done' },
          to: { node: 'finish', port: 'input' },
        },
      ]);
      const canvasCatalog = createCapabilityCatalogSnapshot([
        {
          ...CANVAS_V2_APPLY_CAPABILITY,
          availability: 'enabled',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          limits: {},
        },
      ]);
      const corePreparation = EcpDefinitionModule.prepare(
        definition,
        canvasCatalog
      );
      expect(
        corePreparation.ok
          ? []
          : corePreparation.error.diagnostics.map(
              (issue) => `${issue.code} ${issue.path}: ${issue.message}`
            )
      ).toEqual([]);
      if (!corePreparation.ok) throw corePreparation.error;
      const profile = resolveRuntimeExecutionProfile(
        corePreparation.value,
        canvasCatalog,
        [],
        {
          layer: 'user',
          kind: 'pipeline-definition-v2',
          sourceId: corePreparation.value.definition.sourceId,
          authoredContentDigest: `sha256:${corePreparation.value.digests.source}` as Digest,
          semanticDigest: `sha256:${corePreparation.value.digests.source}` as Digest,
        },
        { maxAttempts: 3, maxActions: 32 }
      );
      const plan = lowerRuntimePlan(
        corePreparation.value,
        profile,
        `run:${'a'.repeat(64)}` as RunId
      );
      const pathById = new Map(
        plan.nodes.map((node) => [node.nodeId, node.hierarchicalPath] as const)
      );
      const requires = (path: string) =>
        plan.nodes
          .find((node) => node.hierarchicalPath === path)!
          .requires.map((nodeId) => pathById.get(nodeId));
      expect(requires('root:bounded-loop')).toEqual([
        'root:composite-ref/stage',
      ]);
      expect(requires('root:choice')).toEqual(['root:bounded-loop']);
      expect(requires('root:fan-out')).toEqual(['root:choice']);
      expect(requires('root:atomic-stage')).toEqual(['root:fan-out']);
      expect(requires('root:join')).toEqual(['root:atomic-stage']);
      expect(requires('root:finish')).toEqual(['root:join']);
      expect(
        plan.nodes.find((node) => node.hierarchicalPath === 'root:bounded-loop')
      ).toMatchObject({
        kind: 'bounded-loop',
        limits: { maxIterations: 3, maxActions: 12, budget: 12 },
        lifecycle: CANVAS_V2_AUTHORING_DEFINITION.root.nodes.find(
          (node) => node.kind === 'BoundedLoop'
        )!.lifecycle,
        body: {
          kind: 'composite',
          declarationId: 'work-body',
          outcomes: { done: 'done' },
        },
      });
      expect(
        plan.nodes.find((node) => node.hierarchicalPath === 'root:fan-out')
      ).toMatchObject({
        kind: 'fan-out',
        concurrencyCap: 1,
        budget: 1,
        members: [
          {
            hierarchicalPath: 'root:atomic-stage',
            required: true,
            condition: 'always',
          },
        ],
      });
      expect(
        plan.nodes.find((node) => node.hierarchicalPath === 'root:atomic-stage')
      ).toMatchObject({
        kind: 'atomic',
        fanOut: { required: true },
        gate: {
          gateId: 'gate',
          decisionIds: ['approved', 'rejected'],
          outcomes: { approved: 'proceed', rejected: 'escalate' },
        },
      });
      expect(
        plan.nodes.find((node) => node.hierarchicalPath === 'root:join')
      ).toMatchObject({
        kind: 'join',
        outcomes: { proceed: 'done', failed: 'failed' },
      });
      expect(plan.finishNode).toMatchObject({
        hierarchicalPath: 'root:finish',
        outcome: 'done',
      });
      const canonical = serializeAuthoredPipelineDefinition(
        corePreparation.value
      );
      expect(canonical).not.toContain('\r');
      expect(canonical.endsWith('\n')).toBe(true);
      const canonicalRead = EcpDefinitionModule.prepare(canonical, canvasCatalog);
      if (!canonicalRead.ok) throw canonicalRead.error;
      expect(canonicalRead.value.digests).toEqual(corePreparation.value.digests);
      const canonicalDefinition = canonicalRead.value.authoredSource;

      const h = await startServer();
      const validation = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition }),
      });
      expect(validation.status).toBe(200);
      const validated = validation.json() as any;
      expect(validated.valid).toBe(true);
      expect(validated.issues).toEqual([]);
      expect(validated.preparation.digests).toEqual(
        corePreparation.value.digests
      );

      const save = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: CANVAS_V2_AUTHORING_NAME,
          definition,
        }),
      });
      expect(save.status).toBe(201);
      expect((save.json() as any).preparation.digests).toEqual(
        validated.preparation.digests
      );
      const canonicalPath = path.join(
        tempConfigHome,
        'rasen',
        'pipelines',
        CANVAS_V2_AUTHORING_NAME,
        'pipeline.yaml'
      );
      expect(fs.readFileSync(canonicalPath, 'utf8')).toBe(canonical);

      const readDetail = async () => {
        const response = await req(h.port, {
          method: 'GET',
          path: `/api/v1/pipelines/${CANVAS_V2_AUTHORING_NAME}`,
          headers: authed(),
        });
        expect(response.status).toBe(200);
        return response.json() as any;
      };
      const firstDetail = await readDetail();
      expect(firstDetail.definition).toEqual(canonicalDefinition);
      expect(firstDetail.preparation.digests).toEqual(
        validated.preparation.digests
      );
      expect(firstDetail.definition.root.nodes.map((node: { kind: string }) => node.kind).sort()).toEqual([
        'AtomicStage',
        'CompositeRef',
        'BoundedLoop',
        'Choice',
        'Gate',
        'Finish',
        'FanOut',
        'Join',
      ].sort());

      const noOpSave = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: CANVAS_V2_AUTHORING_NAME,
          definition: firstDetail.definition,
          force: true,
        }),
      });
      expect(noOpSave.status).toBe(200);
      expect((noOpSave.json() as any).preparation.digests).toEqual(
        validated.preparation.digests
      );

      const packagePath = path.join(
        projectRoot,
        'portable',
        `${CANVAS_V2_AUTHORING_NAME}.rasenpkg`
      );
      const exported = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'export',
          name: CANVAS_V2_AUTHORING_NAME,
          path: packagePath,
        }),
      });
      expect(exported.status).toBe(200);
      expect(path.resolve(packagePath)).toBe(packagePath);
      const packageValue = decodePackage(
        fs.readFileSync(packagePath),
        'pipeline'
      ) as PipelinePackage;
      const manifest = packageValue.pipelines[0]!.files.find(
        (file) => file.path === 'pipeline.yaml'
      );
      expect(manifest?.content).toBe(canonical);

      const imported = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'import', path: packagePath, force: true }),
      });
      expect(imported.status).toBe(201);
      expect((imported.json() as any).imported).toContain(
        CANVAS_V2_AUTHORING_NAME
      );
      const importedDetail = await readDetail();
      expect(importedDetail.definition).toEqual(canonicalDefinition);
      expect(importedDetail.preparation.digests).toEqual(
        validated.preparation.digests
      );

      const edited = structuredClone(canonicalDefinition);
      const editedConnection = edited.root.connections.find(
        (connection: { id: string }) =>
          connection.id === 'bounded-loop:done->choice:input'
      );
      if (!editedConnection) throw new Error('typed route connection missing');
      editedConnection.id = 'bounded-loop:done->choice:start';
      editedConnection.to.port = 'start';
      const editedSave = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: CANVAS_V2_AUTHORING_NAME,
          definition: edited,
          force: true,
        }),
      });
      expect(editedSave.status).toBe(200);
      const editedDigests = (editedSave.json() as any).preparation.digests;
      expect(editedDigests.source).not.toBe(validated.preparation.digests.source);
      expect(editedDigests.capability).toBe(
        validated.preparation.digests.capability
      );
      expect(editedDigests.plan).not.toBe(validated.preparation.digests.plan);
      const editedDetail = await readDetail();
      expect(editedDetail.definition).toEqual(edited);
      expect({
        ...editedDetail.definition,
        root: {
          ...editedDetail.definition.root,
          connections: canonicalDefinition.root.connections,
        },
      }).toEqual(canonicalDefinition);
      expect(editedDetail.preparation.digests).toEqual(editedDigests);

      const stableSave = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          op: 'save',
          name: CANVAS_V2_AUTHORING_NAME,
          definition: editedDetail.definition,
          force: true,
        }),
      });
      expect(stableSave.status).toBe(200);
      expect((stableSave.json() as any).preparation.digests).toEqual(
        editedDigests
      );
      expect((await readDetail()).preparation.digests).toEqual(editedDigests);
    }, 120_000);

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
              kind: 'Choice' as const,
              outcomes: ['continue'],
            },
            {
              id: 'second-gate',
              kind: 'Choice' as const,
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
