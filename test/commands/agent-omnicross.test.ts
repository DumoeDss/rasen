import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentCommand } from '../../src/commands/agent.js';
import {
  computeOmniCrossConfigRevision,
  createInferenceFile,
  FrozenInferenceRouteSchema,
  type FrozenInferenceRoute,
} from '../../src/core/omnicross/index.js';
import {
  EcpDefinitionModule,
  PipelineYamlSchema,
  createCapabilityCatalogSnapshot,
  projectPreparedPipelineExecutionView,
} from '../../src/core/pipeline-registry/index.js';
import { startFakeOmniCrossDaemon } from '../fixtures/omnicross/fake-daemon.js';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const binaries = {
  codex: path.join(fixtureRoot, 'codex', process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.mjs'),
  claude: path.join(fixtureRoot, 'claude', process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs'),
};

let root: string;
let promptFile: string;
let inferenceFile: string;
let output: string[];
let logSpy: ReturnType<typeof vi.spyOn>;
const saved: Record<string, string | undefined> = {};
const daemons: Array<{ close(): Promise<void> }> = [];

beforeAll(() => {
  if (process.platform !== 'win32') Object.values(binaries).forEach((file) => fs.chmodSync(file, 0o755));
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-agent-omnicross-'));
  promptFile = path.join(root, 'prompt with spaces.txt');
  inferenceFile = path.join(root, 'route with spaces.json');
  for (const key of ['RASEN_HOME', 'RASEN_CODEX_BIN', 'RASEN_CLAUDE_BIN', 'TEST_ROUTE_ADMIN']) {
    saved[key] = process.env[key];
  }
  process.env.RASEN_HOME = path.join(root, 'rasen-home');
  process.env.RASEN_CODEX_BIN = binaries.codex;
  process.env.RASEN_CLAUDE_BIN = binaries.claude;
  output = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => output.push(String(value)));
  process.exitCode = undefined;
});

afterEach(async () => {
  logSpy.mockRestore();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.exitCode = undefined;
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
  fs.rmSync(root, { recursive: true, force: true });
});

function connection(endpoint: string) {
  const base = {
    endpoint,
    controlTokenEnv: 'TEST_ROUTE_ADMIN',
    requestTimeoutMs: 1_000,
    leaseTtlSeconds: 60,
  };
  return { ...base, configRevision: computeOmniCrossConfigRevision(base) };
}

function writeRoute(
  endpoint: string,
  runtime: 'codex' | 'claude',
  attempt: number,
  sessionId?: string,
  admittedRoute?: FrozenInferenceRoute
) {
  const model = runtime === 'codex' ? 'deepseek-chat' : 'claude-sonnet-4-6';
  const frozen = admittedRoute ?? {
    broker: 'omnicross' as const,
    runtime,
    upstream: { kind: 'provider' as const, providerId: runtime === 'codex' ? 'deepseek-api' : 'anthropic-api' },
    model,
    connection: connection(endpoint),
  };
  fs.writeFileSync(inferenceFile, JSON.stringify(createInferenceFile(frozen, {
    runId: 'run-vertical',
    stageId: runtime === 'codex' ? 'ship' : 'implement',
    attempt,
    ...(sessionId ? { sessionId } : {}),
  })), 'utf8');
  return model;
}

function codexRouteFromExecutionView(endpoint: string): FrozenInferenceRoute {
  const pipeline = PipelineYamlSchema.parse({
    version: 1,
    name: 'vertical-routed-pipeline',
    stages: [{
      id: 'ship',
      kind: 'standard',
      skill: 'rasen-ship',
      role: 'shipper',
      requires: [],
      gate: false,
      leadReview: false,
      runtime: 'codex',
      model: 'deepseek-chat',
      inference: {
        broker: 'omnicross',
        upstream: { kind: 'provider', providerId: 'deepseek-api' },
      },
    }],
  });
  const catalog = createCapabilityCatalogSnapshot([{
    id: 'skill:rasen-ship',
    version: `sha256:${'c'.repeat(64)}`,
    availability: 'enabled',
    inputs: [],
    artifacts: [{ name: 'result', type: 'artifact/json' }],
    outcomes: ['done'],
    limits: { maxActions: 8 },
  }]);
  const prepared = EcpDefinitionModule.prepare(pipeline, catalog);
  if (!prepared.ok) throw prepared.error;
  const view = projectPreparedPipelineExecutionView(prepared.value, catalog, {
    overrides: { gates: new Map(), models: new Map(), handoff: new Map(), runtimes: new Map() },
    basePolicy: { effective: 'on', source: 'default' },
    host: { runtime: 'codex', source: 'process' },
    omnicrossConnection: connection(endpoint),
  });
  return FrozenInferenceRouteSchema.parse(view.stages[0]?.inference);
}

function receipt() {
  expect(output).toHaveLength(1);
  return JSON.parse(output[0]!) as Record<string, unknown>;
}

function readPersistedTree(directory: string): string {
  const values: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && fs.statSync(target).size <= 256 * 1024) {
        values.push(fs.readFileSync(target, 'utf8'));
      }
    }
  };
  visit(directory);
  return values.join('\n');
}

describe('rasen agent dispatch OmniCross vertical path', () => {
  it('routes Codex fresh and exact resume through replacement leases', async () => {
    const daemon = await startFakeOmniCrossDaemon();
    daemons.push(daemon);
    process.env.TEST_ROUTE_ADMIN = daemon.controlToken;
    fs.writeFileSync(promptFile, 'MODE=success\nTHREAD_ID=vertical-thread', 'utf8');
    const admittedRoute = codexRouteFromExecutionView(daemon.endpoint);
    const model = writeRoute(daemon.endpoint, 'codex', 1, undefined, admittedRoute);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({
      ok: true,
      runtime: 'codex',
      threadId: 'vertical-thread',
      route: { leaseId: 'lease-1', model: 'deepseek-chat' },
    });
    expect(JSON.stringify(receipt())).not.toContain('route-token-1');

    output = [];
    fs.writeFileSync(promptFile, 'MODE=success', 'utf8');
    writeRoute(daemon.endpoint, 'codex', 2, 'vertical-thread');
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, resume: 'vertical-thread', json: true,
    });
    expect(receipt()).toMatchObject({
      ok: true,
      runtime: 'codex',
      threadId: 'vertical-thread',
      route: { leaseId: 'lease-2', model: 'deepseek-chat' },
    });
    expect(JSON.stringify(receipt())).not.toContain('route-token-2');
    expect(daemon.requests.filter((entry) => entry.method === 'POST')).toHaveLength(2);
    expect(daemon.requests.filter((entry) => entry.method === 'DELETE')).toHaveLength(2);
    const persisted = readPersistedTree(root);
    expect(persisted).not.toContain(daemon.controlToken);
    expect(persisted).not.toMatch(/route-token-[12]/);
    const persistentRouteArtifacts = fs.readdirSync(root, { recursive: true })
      .map(String)
      .filter((name) => /omnicross.*(?:key|binding|lease|token)/i.test(name));
    expect(persistentRouteArtifacts).toEqual([]);
  });

  it('routes Claude fresh and exact continuation with the frozen model', async () => {
    const daemon = await startFakeOmniCrossDaemon();
    daemons.push(daemon);
    process.env.TEST_ROUTE_ADMIN = daemon.controlToken;
    fs.writeFileSync(promptFile, 'MODE=success\nSESSION_ID=vertical-session', 'utf8');
    const model = writeRoute(daemon.endpoint, 'claude', 1);
    await new AgentCommand().dispatch({
      runtime: 'claude', promptFile, inferenceFile, contract: 'leaf', sandbox: 'workspace-write',
      model, cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({
      ok: true,
      runtime: 'claude',
      sessionId: 'vertical-session',
      route: { leaseId: 'lease-1', model },
    });

    output = [];
    fs.writeFileSync(promptFile, 'MODE=success', 'utf8');
    writeRoute(daemon.endpoint, 'claude', 2, 'vertical-session');
    await new AgentCommand().dispatch({
      runtime: 'claude', promptFile, inferenceFile, contract: 'leaf', sandbox: 'workspace-write',
      model, cwd: root, resume: 'vertical-session', json: true,
    });
    expect(receipt()).toMatchObject({ ok: true, sessionId: 'vertical-session', route: { leaseId: 'lease-2' } });
  });

  it('fails before runtime spawn when control auth is missing', async () => {
    const daemon = await startFakeOmniCrossDaemon();
    daemons.push(daemon);
    delete process.env.TEST_ROUTE_ADMIN;
    const marker = path.join(root, 'spawned.json');
    fs.writeFileSync(promptFile, `MODE=success\nMARKER_FILE=${marker}`, 'utf8');
    const model = writeRoute(daemon.endpoint, 'codex', 1);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({ ok: false, failure: { kind: 'invalid-config' } });
    expect(fs.existsSync(marker)).toBe(false);
    expect(daemon.requests).toHaveLength(0);
  });

  it('fails closed on structured upstream errors without CLI-login fallback', async () => {
    const daemon = await startFakeOmniCrossDaemon({
      failCreate: {
        status: 404,
        code: 'upstream_not_found',
        message: 'frozen upstream was deleted',
        retryable: false,
      },
    });
    daemons.push(daemon);
    process.env.TEST_ROUTE_ADMIN = daemon.controlToken;
    const marker = path.join(root, 'spawned.json');
    fs.writeFileSync(promptFile, `MODE=success\nMARKER_FILE=${marker}`, 'utf8');
    const model = writeRoute(daemon.endpoint, 'codex', 1);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({ ok: false, failure: { kind: 'upstream-invalid' } });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it.each([
    ['model_not_supported', 'model-invalid'],
    ['format_unsupported', 'format-unsupported'],
    ['idempotency_conflict', 'idempotency-conflict'],
    ['unsupported_schema', 'unsupported-schema'],
    ['capacity_exhausted', 'capacity-exhausted'],
  ] as const)('fails closed on daemon %s without runtime spawn', async (code, kind) => {
    const daemon = await startFakeOmniCrossDaemon({
      failCreate: {
        status: code === 'capacity_exhausted' ? 429 : 400,
        code,
        message: `fake ${code}`,
        retryable: false,
      },
    });
    daemons.push(daemon);
    process.env.TEST_ROUTE_ADMIN = daemon.controlToken;
    const marker = path.join(root, 'spawned.json');
    fs.writeFileSync(promptFile, `MODE=success\nMARKER_FILE=${marker}`, 'utf8');
    const model = writeRoute(daemon.endpoint, 'codex', 1);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({ ok: false, failure: { kind } });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('fails closed on invalid control auth without runtime spawn', async () => {
    const daemon = await startFakeOmniCrossDaemon();
    daemons.push(daemon);
    process.env.TEST_ROUTE_ADMIN = 'wrong-control-token';
    const marker = path.join(root, 'spawned.json');
    fs.writeFileSync(promptFile, `MODE=success\nMARKER_FILE=${marker}`, 'utf8');
    const model = writeRoute(daemon.endpoint, 'codex', 1);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({
      ok: false,
      failure: { kind: 'control-unauthorized' },
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('fails closed when the configured daemon is unreachable', async () => {
    const daemon = await startFakeOmniCrossDaemon();
    const endpoint = daemon.endpoint;
    await daemon.close();
    process.env.TEST_ROUTE_ADMIN = 'unused-control-token';
    const marker = path.join(root, 'spawned.json');
    fs.writeFileSync(promptFile, `MODE=success\nMARKER_FILE=${marker}`, 'utf8');
    const model = writeRoute(endpoint, 'codex', 1);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({
      ok: false,
      failure: { kind: 'daemon-unavailable' },
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('rejects an expired or mismatched launch descriptor before runtime spawn', async () => {
    const expired = await startFakeOmniCrossDaemon({ createExpiryMs: 500 });
    daemons.push(expired);
    process.env.TEST_ROUTE_ADMIN = expired.controlToken;
    const marker = path.join(root, 'spawned.json');
    fs.writeFileSync(promptFile, `MODE=success\nMARKER_FILE=${marker}`, 'utf8');
    const model = writeRoute(expired.endpoint, 'codex', 1);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({
      ok: false,
      failure: { kind: 'invalid-descriptor' },
    });
    expect(fs.existsSync(marker)).toBe(false);

    output = [];
    const mismatched = await startFakeOmniCrossDaemon({
      descriptor: (_request, token) => ({
        env: { OMNICROSS_CODEX_ROUTE_TOKEN: token },
        extraArgs: ['-c', 'model_provider="unexpected"'],
      }),
    });
    daemons.push(mismatched);
    process.env.TEST_ROUTE_ADMIN = mismatched.controlToken;
    writeRoute(mismatched.endpoint, 'codex', 2);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, json: true,
    });
    expect(receipt()).toMatchObject({
      ok: false,
      failure: { kind: 'invalid-descriptor' },
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('terminates the runtime and releases when renewal loses the route', async () => {
    const daemon = await startFakeOmniCrossDaemon({
      createExpiryMs: 6_000,
      failRenew: {
        status: 404,
        code: 'lease_not_found',
        message: 'lease disappeared',
        retryable: false,
      },
    });
    daemons.push(daemon);
    process.env.TEST_ROUTE_ADMIN = daemon.controlToken;
    fs.writeFileSync(promptFile, 'MODE=timeout', 'utf8');
    const model = writeRoute(daemon.endpoint, 'codex', 1);
    await new AgentCommand().dispatch({
      runtime: 'codex', promptFile, inferenceFile, contract: 'leaf', sandbox: 'read-only', model,
      cwd: root, timeoutMs: 5_000, json: true,
    });
    expect(receipt()).toMatchObject({
      ok: false,
      failure: { kind: 'route-lost' },
      route: { leaseId: 'lease-1' },
    });
    expect(daemon.activeLeases.size).toBe(0);
  });

  it.each(['codex', 'claude'] as const)(
    'releases the %s lease after runtime timeout',
    async (runtime) => {
      const daemon = await startFakeOmniCrossDaemon();
      daemons.push(daemon);
      process.env.TEST_ROUTE_ADMIN = daemon.controlToken;
      fs.writeFileSync(promptFile, 'MODE=timeout', 'utf8');
      const model = writeRoute(daemon.endpoint, runtime, 1);
      await new AgentCommand().dispatch({
        runtime,
        promptFile,
        inferenceFile,
        contract: 'leaf',
        sandbox: 'read-only',
        model,
        cwd: root,
        timeoutMs: 100,
        json: true,
      });
      expect(receipt()).toMatchObject({
        ok: false,
        failure: { kind: 'timeout' },
        route: { leaseId: 'lease-1' },
      });
      expect(daemon.activeLeases.size).toBe(0);
      expect(daemon.requests.filter((entry) => entry.method === 'DELETE')).toHaveLength(1);
    }
  );
});
