import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CreateRouteLeaseRequestSchema,
  FrozenInferenceRouteSchema,
  MAX_INFERENCE_FILE_BYTES,
  OmniCrossRouteError,
  OmniCrossUpstreamSchema,
  StageInferenceSchema,
  assertSameFrozenInferenceIdentity,
  buildRoutedChildEnvironment,
  computeOmniCrossConfigRevision,
  createInferenceFile,
  createOmniCrossRouteLeaseClient,
  crossCheckInferenceFile,
  normalizeOmniCrossEndpoint,
  readInferenceFile,
  reduceLaunchDescriptor,
  resolveOmniCrossControlAuthority,
  withOmniCrossRoute,
  type CreateRouteLeaseRequest,
  type FrozenInferenceRoute,
  type OmniCrossClock,
  type OmniCrossRouteLeaseClient,
  type OmniCrossHttpTransport,
} from '../../../src/core/omnicross/index.js';
import { sanitizeAgentDiagnosticValue } from '../../../src/core/agent-diagnostics.js';
import { startFakeOmniCrossDaemon } from '../../fixtures/omnicross/fake-daemon.js';

const tempRoots: string[] = [];
const daemons: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function connection(endpoint: string) {
  const base = {
    endpoint,
    controlTokenEnv: 'TEST_OMNICROSS_ADMIN_TOKEN',
    requestTimeoutMs: 1_000,
    leaseTtlSeconds: 60,
  };
  return { ...base, configRevision: computeOmniCrossConfigRevision(base) };
}

function route(endpoint: string, runtime: 'claude' | 'codex' = 'codex'): FrozenInferenceRoute {
  return FrozenInferenceRouteSchema.parse({
    broker: 'omnicross',
    runtime,
    upstream: { kind: 'provider', providerId: runtime === 'codex' ? 'deepseek-api' : 'anthropic' },
    model: runtime === 'codex' ? 'deepseek-chat' : 'claude-sonnet-4-6',
    connection: connection(endpoint),
  });
}

function request(runtime: 'claude' | 'codex' = 'codex'): CreateRouteLeaseRequest {
  return CreateRouteLeaseRequestSchema.parse({
    schemaVersion: 'omnicross.route-lease.request/1',
    consumer: 'rasen',
    runtime,
    upstream: { kind: 'provider', providerId: 'provider-1' },
    model: runtime === 'codex' ? 'deepseek-chat' : 'claude-sonnet-4-6',
    execution: { runId: 'run-1', stageId: 'ship', attempt: 1 },
    idempotencyKey: 'run-1-ship-1',
    ttlSeconds: 60,
  });
}

function codexLease(
  frozen: FrozenInferenceRoute,
  expiresAt: string,
  token = 'route-secret'
) {
  return {
    schemaVersion: 'omnicross.route-lease/1' as const,
    leaseId: 'lease-clock',
    expiresAt,
    runtime: frozen.runtime,
    upstream: frozen.upstream,
    model: frozen.model,
    launch: {
      env: { OMNICROSS_CODEX_ROUTE_TOKEN: token },
      extraArgs: [
        '-c', 'model_provider="omnicross"',
        '-c', 'model_providers.omnicross.name="omnicross"',
        '-c', 'model_providers.omnicross.base_url="http://127.0.0.1:8766/openai"',
        '-c', 'model_providers.omnicross.wire_api="responses"',
        '-c', 'model_providers.omnicross.env_key="OMNICROSS_CODEX_ROUTE_TOKEN"',
        '-c', 'disable_response_storage=true',
      ],
    },
  };
}

class FakeClock implements OmniCrossClock {
  private serial = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = ++this.serial;
    this.timers.set(id, { at: this.current + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    this.current += ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.current)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }

  get pending(): number {
    return this.timers.size;
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('closed inference contracts', () => {
  it.each([
    { kind: 'provider', providerId: 'p', keyId: 'key-1' },
    { kind: 'account', providerId: 'p', accountId: 'a' },
    { kind: 'account-group', providerId: 'p', group: 'premium' },
    { kind: 'account-pool', providerId: 'p' },
  ])('accepts upstream kind $kind', (upstream) => {
    expect(OmniCrossUpstreamSchema.parse(upstream)).toEqual(upstream);
    expect(StageInferenceSchema.parse({ broker: 'omnicross', upstream })).toBeTruthy();
  });

  it.each(['token', 'apiKey', 'baseUrl', 'ingress', 'transformer']) (
    'rejects secret or transport field %s',
    (field) => {
      expect(() => StageInferenceSchema.parse({
        broker: 'omnicross',
        upstream: { kind: 'provider', providerId: 'p' },
        [field]: 'forbidden',
      })).toThrow();
    }
  );

  it('rejects incomplete and unknown upstream variants', () => {
    expect(() => OmniCrossUpstreamSchema.parse({ kind: 'account', providerId: 'p' })).toThrow();
    expect(() => OmniCrossUpstreamSchema.parse({ kind: 'fallback', providerId: 'p' })).toThrow();
  });
});

describe('connection and inference-file boundaries', () => {
  it.each([
    ['http://localhost:8765', 'http://localhost:8765'],
    ['http://127.99.1.2:8765/', 'http://127.99.1.2:8765'],
    ['http://[::1]:8765', 'http://[::1]:8765'],
  ])('normalizes loopback endpoint %s', (input, expected) => {
    expect(normalizeOmniCrossEndpoint(input)).toBe(expected);
  });

  it.each(['https://localhost:8765', 'http://example.com:8765', 'http://localhost:8765/path', 'http://u:p@localhost:8765']) (
    'rejects endpoint %s',
    (endpoint) => expect(() => normalizeOmniCrossEndpoint(endpoint)).toThrow(OmniCrossRouteError)
  );

  it('looks up the control token without changing the environment or revision', () => {
    const identity = connection('http://127.0.0.1:8765');
    const env = { TEST_OMNICROSS_ADMIN_TOKEN: 'admin-secret' };
    expect(resolveOmniCrossControlAuthority(identity, env)).toEqual({
      connection: identity,
      controlToken: 'admin-secret',
    });
    expect(env).toEqual({ TEST_OMNICROSS_ADMIN_TOKEN: 'admin-secret' });
  });

  it('reads strict UTF-8 from a Windows-style path with spaces and cross-checks identity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen inference spaces '));
    tempRoots.push(root);
    const file = path.join(root, 'attempt route.json');
    const value = createInferenceFile(route('http://127.0.0.1:8765'), {
      runId: 'run-1', stageId: 'ship', attempt: 2, sessionId: 'thread-1',
    });
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
    const parsed = readInferenceFile(file);
    crossCheckInferenceFile(parsed, {
      runtime: 'codex',
      model: 'deepseek-chat',
      resumeSessionId: 'thread-1',
      route: value.route,
      attempt: value.attempt,
    });
    expect(parsed).toEqual(value);
  });

  it('rejects malformed, oversized, and invalid UTF-8 files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-inference-invalid-'));
    tempRoots.push(root);
    const malformed = path.join(root, 'malformed.json');
    const oversized = path.join(root, 'oversized.json');
    const invalidUtf8 = path.join(root, 'invalid-utf8.json');
    fs.writeFileSync(malformed, '{ nope', 'utf8');
    fs.writeFileSync(oversized, Buffer.alloc(MAX_INFERENCE_FILE_BYTES + 1, 0x78));
    fs.writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]));
    for (const file of [malformed, oversized, invalidUtf8]) {
      expect(() => readInferenceFile(file)).toThrow(OmniCrossRouteError);
    }
  });

  it('detects every frozen broker identity field', () => {
    const original = route('http://127.0.0.1:8765');
    const changed = route('http://127.0.0.1:8766');
    expect(() => assertSameFrozenInferenceIdentity(original, changed)).toThrow();
  });

  it('builds an isolated child environment without Admin or stale Claude credentials', () => {
    const parent = {
      PATH: 'fixture-path',
      TEST_OMNICROSS_ADMIN_TOKEN: 'admin-secret',
      ANTHROPIC_API_KEY: 'stale-user-key',
      ANTHROPIC_AUTH_TOKEN: 'stale-user-token',
    };
    const child = buildRoutedChildEnvironment(
      parent,
      'TEST_OMNICROSS_ADMIN_TOKEN',
      {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:8766/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'route-token',
        ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      }
    );
    expect(child).toMatchObject({
      PATH: 'fixture-path',
      ANTHROPIC_AUTH_TOKEN: 'route-token',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    });
    expect(child.TEST_OMNICROSS_ADMIN_TOKEN).toBeUndefined();
    expect(child.ANTHROPIC_API_KEY).toBeUndefined();
    expect(parent).toHaveProperty('TEST_OMNICROSS_ADMIN_TOKEN', 'admin-secret');
  });

  it('recursively removes explicit sentinel secrets from structured values', () => {
    const sentinel = 'sentinel-route-secret-492837';
    const sanitized = sanitizeAgentDiagnosticValue({
      summary: sentinel,
      nested: [{ echoed: `prefix-${sentinel}-suffix` }],
      ordinary: 'kept',
    }, [sentinel]);
    expect(JSON.stringify(sanitized)).not.toContain(sentinel);
    expect(sanitized).toMatchObject({ ordinary: 'kept' });
  });
});

describe('HTTP client, descriptor reduction, and lifecycle', () => {
  it('retries one transport-failed create with byte-identical idempotent input', async () => {
    const authority = resolveOmniCrossControlAuthority(
      connection('http://127.0.0.1:8765'),
      { TEST_OMNICROSS_ADMIN_TOKEN: 'admin-secret' }
    );
    const captured: Array<{ body: string; authorization?: string }> = [];
    const createRequest = request();
    const transport: OmniCrossHttpTransport = async (input) => {
      captured.push({ body: input.body, authorization: input.headers.authorization });
      if (captured.length === 1) {
        const error = new Error('request-timeout') as NodeJS.ErrnoException;
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return {
        status: 200,
        headers: { 'cache-control': 'no-store' },
        body: JSON.stringify({
          schemaVersion: 'omnicross.route-lease/1',
          leaseId: 'lease-retry',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          runtime: createRequest.runtime,
          upstream: createRequest.upstream,
          model: createRequest.model,
          launch: codexLease(route('http://127.0.0.1:8765'), new Date(Date.now() + 60_000).toISOString()).launch,
        }),
      };
    };
    const response = await createOmniCrossRouteLeaseClient({ authority, transport })
      .create(createRequest);
    expect(response.leaseId).toBe('lease-retry');
    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual(captured[1]);
    expect(captured[0]?.authorization).toBe('Bearer admin-secret');
  });

  it.each([
    ['control_unauthorized', 401, 'control-unauthorized'],
    ['daemon_not_ready', 503, 'daemon-not-ready'],
    ['model_not_supported', 400, 'model-invalid'],
    ['format_unsupported', 400, 'format-unsupported'],
    ['idempotency_conflict', 409, 'idempotency-conflict'],
    ['capacity_exhausted', 429, 'capacity-exhausted'],
    ['unsupported_schema', 400, 'unsupported-schema'],
  ] as const)('maps daemon code %s to %s', async (code, status, kind) => {
    const authority = resolveOmniCrossControlAuthority(
      connection('http://127.0.0.1:8765'),
      { TEST_OMNICROSS_ADMIN_TOKEN: 'admin-secret' }
    );
    const client = createOmniCrossRouteLeaseClient({
      authority,
      transport: async () => ({
        status,
        headers: {},
        body: JSON.stringify({
          schemaVersion: 'omnicross.error/1',
          error: { code, message: `safe ${code}`, retryable: false },
        }),
      }),
    });
    await expect(client.create(request())).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(OmniCrossRouteError);
      expect((error as OmniCrossRouteError).failure.kind).toBe(kind);
      return true;
    });
  });

  it('authenticates, validates the Codex binding, and releases after success', async () => {
    const daemon = await startFakeOmniCrossDaemon();
    daemons.push(daemon);
    const frozen = route(daemon.endpoint);
    const authority = resolveOmniCrossControlAuthority(
      frozen.connection,
      { TEST_OMNICROSS_ADMIN_TOKEN: daemon.controlToken }
    );
    const result = await withOmniCrossRoute({
      route: frozen,
      attempt: { runId: 'run-1', stageId: 'ship', attempt: 1 },
      client: createOmniCrossRouteLeaseClient({ authority }),
      run: async (binding) => {
        expect(binding.runtime).toBe('codex');
        if (binding.runtime !== 'codex') throw new Error('wrong binding');
        expect(binding.providerOverride).toMatchObject({
          name: 'omnicross',
          wireApi: 'responses',
          envKey: 'OMNICROSS_CODEX_ROUTE_TOKEN',
          disableResponseStorage: true,
        });
        expect(binding.env.OMNICROSS_CODEX_ROUTE_TOKEN).toBe('route-token-1');
        return 'done';
      },
    });
    expect(result).toMatchObject({ ok: true, value: 'done', route: { leaseId: 'lease-1' } });
    expect(daemon.requests.map((entry) => [entry.method, entry.path])).toEqual([
      ['POST', '/admin/api/route-leases'],
      ['DELETE', '/admin/api/route-leases/lease-1'],
    ]);
    expect(daemon.requests[0]?.authorization).toBe(`Bearer ${daemon.controlToken}`);
    expect(daemon.activeLeases.size).toBe(0);
  });

  it('rejects missing no-store and never invokes the runtime callback', async () => {
    const daemon = await startFakeOmniCrossDaemon({ omitNoStore: true });
    daemons.push(daemon);
    const frozen = route(daemon.endpoint);
    const authority = resolveOmniCrossControlAuthority(
      frozen.connection,
      { TEST_OMNICROSS_ADMIN_TOKEN: daemon.controlToken }
    );
    let invoked = false;
    const result = await withOmniCrossRoute({
      route: frozen,
      attempt: { runId: 'run-1', stageId: 'ship', attempt: 1 },
      client: createOmniCrossRouteLeaseClient({ authority }),
      run: async () => { invoked = true; },
    });
    expect(result).toMatchObject({ ok: false, failure: { kind: 'unsupported-schema' } });
    expect(invoked).toBe(false);
  });

  it('redacts explicit control secrets in structured daemon failures', async () => {
    const secret = 'sentinel-admin-secret-928374';
    const daemon = await startFakeOmniCrossDaemon({
      controlToken: secret,
      failCreate: {
        status: 503,
        code: 'daemon_not_ready',
        message: `daemon echoed ${secret}`,
        retryable: false,
      },
    });
    daemons.push(daemon);
    const frozen = route(daemon.endpoint);
    const client = createOmniCrossRouteLeaseClient({
      authority: resolveOmniCrossControlAuthority(
        frozen.connection,
        { TEST_OMNICROSS_ADMIN_TOKEN: secret }
      ),
    });
    await expect(client.create(request())).rejects.toSatisfy((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(secret);
      expect((error as OmniCrossRouteError).failure.message).toContain('<redacted>');
      return true;
    });
  });

  it('rejects token-bearing argv and arbitrary provider overrides', () => {
    const createRequest = request();
    const response = {
      schemaVersion: 'omnicross.route-lease/1' as const,
      leaseId: 'lease-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      runtime: 'codex' as const,
      upstream: createRequest.upstream,
      model: createRequest.model,
      launch: {
        env: { OMNICROSS_CODEX_ROUTE_TOKEN: 'route-secret' },
        extraArgs: ['-c', 'model_provider="route-secret"'],
      },
    };
    expect(() => reduceLaunchDescriptor(createRequest, response)).toThrow(OmniCrossRouteError);
  });

  it('rejects a purported Claude sentinel that could be an upstream credential', () => {
    const createRequest = request('claude');
    expect(() => reduceLaunchDescriptor(createRequest, {
      schemaVersion: 'omnicross.route-lease/1',
      leaseId: 'lease-claude',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      runtime: 'claude',
      upstream: createRequest.upstream,
      model: createRequest.model,
      launch: {
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:8766/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'route-secret',
          ANTHROPIC_API_KEY: 'sk-ant-upstream-secret',
          ANTHROPIC_MODEL: createRequest.model,
        },
        extraArgs: [],
      },
    })).toThrow(OmniCrossRouteError);
  });

  it('cancels the runtime and still releases the lease', async () => {
    const frozen = route('http://127.0.0.1:8765');
    const controller = new AbortController();
    let released = 0;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const client: OmniCrossRouteLeaseClient = {
      async create() {
        return codexLease(frozen, new Date(Date.now() + 60_000).toISOString());
      },
      async renew() {
        throw new Error('renew not expected');
      },
      async release(leaseId) {
        released += 1;
        return { schemaVersion: 'omnicross.route-lease.release/1', leaseId, released: true };
      },
    };
    const resultPromise = withOmniCrossRoute({
      route: frozen,
      attempt: { runId: 'run-cancel', stageId: 'apply', attempt: 1 },
      client,
      signal: controller.signal,
      run: async (_binding, signal) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    await running;
    controller.abort(new Error('cancel test'));
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'cancelled' },
    });
    expect(released).toBe(1);
  });

  it('returns cancelled when the runtime ignores abort and resolves successfully', async () => {
    const frozen = route('http://127.0.0.1:8765');
    const controller = new AbortController();
    let released = 0;
    let started!: () => void;
    let settle!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const ignoredAbort = new Promise<void>((resolve) => { settle = resolve; });
    const client: OmniCrossRouteLeaseClient = {
      async create() {
        return codexLease(frozen, new Date(Date.now() + 60_000).toISOString());
      },
      async renew() {
        throw new Error('renew not expected');
      },
      async release(leaseId) {
        released += 1;
        return { schemaVersion: 'omnicross.route-lease.release/1', leaseId, released: true };
      },
    };
    const resultPromise = withOmniCrossRoute({
      route: frozen,
      attempt: { runId: 'run-cancel-ignored', stageId: 'apply', attempt: 1 },
      client,
      signal: controller.signal,
      run: async () => {
        started();
        await ignoredAbort;
        return 'runtime-success-after-cancel';
      },
    });
    await running;
    controller.abort(new Error('cancel ignored by runtime'));
    settle();
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'cancelled' },
    });
    expect(released).toBe(1);
  });

  it('aborts with route-lost after bounded renewal failure and clears fake timers', async () => {
    const now = Date.now();
    const clock = new FakeClock(now);
    const frozen = route('http://127.0.0.1:8765');
    let renewals = 0;
    let releases = 0;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const client: OmniCrossRouteLeaseClient = {
      async create() {
        return codexLease(frozen, new Date(now + 6_000).toISOString());
      },
      async renew() {
        renewals += 1;
        throw new OmniCrossRouteError({
          kind: 'daemon-unavailable',
          message: 'renewal unavailable',
          retryable: true,
        });
      },
      async release(leaseId) {
        releases += 1;
        return { schemaVersion: 'omnicross.route-lease.release/1', leaseId, released: true };
      },
    };
    const resultPromise = withOmniCrossRoute({
      route: frozen,
      attempt: { runId: 'run-renew', stageId: 'apply', attempt: 1 },
      client,
      clock,
      run: async (_binding, signal) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    await running;
    clock.advance(1_000);
    await flushMicrotasks();
    expect(renewals).toBe(1);
    clock.advance(250);
    await flushMicrotasks();
    const result = await resultPromise;
    expect(result).toMatchObject({ ok: false, failure: { kind: 'route-lost' } });
    expect(renewals).toBe(2);
    expect(releases).toBe(1);
    expect(clock.pending).toBe(0);
  });

  it('keeps a successful result primary when best-effort release fails', async () => {
    const frozen = route('http://127.0.0.1:8765');
    const client: OmniCrossRouteLeaseClient = {
      async create() {
        return codexLease(frozen, new Date(Date.now() + 60_000).toISOString());
      },
      async renew() {
        throw new Error('renew not expected');
      },
      async release() {
        throw new OmniCrossRouteError({
          kind: 'daemon-unavailable',
          message: 'release failed with route-secret',
          retryable: true,
        });
      },
    };
    const result = await withOmniCrossRoute({
      route: frozen,
      attempt: { runId: 'run-release', stageId: 'ship', attempt: 1 },
      client,
      run: async () => 'done',
    });
    expect(result).toMatchObject({
      ok: true,
      value: 'done',
      warnings: [expect.stringContaining('TTL cleanup remains active')],
    });
    expect(JSON.stringify(result)).not.toContain('route-secret');
  });

  it('releases after a spawn/callback failure and redacts the live token', async () => {
    const frozen = route('http://127.0.0.1:8765');
    let releases = 0;
    const client: OmniCrossRouteLeaseClient = {
      async create() {
        return codexLease(
          frozen,
          new Date(Date.now() + 60_000).toISOString(),
          'sentinel-spawn-route-token'
        );
      },
      async renew() {
        throw new Error('renew not expected');
      },
      async release(leaseId) {
        releases += 1;
        return { schemaVersion: 'omnicross.route-lease.release/1', leaseId, released: true };
      },
    };
    const result = await withOmniCrossRoute({
      route: frozen,
      attempt: { runId: 'run-spawn', stageId: 'apply', attempt: 1 },
      client,
      run: async () => {
        throw new Error('spawn failed and echoed sentinel-spawn-route-token');
      },
    });
    expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid-input' } });
    expect(releases).toBe(1);
    expect(JSON.stringify(result)).not.toContain('sentinel-spawn-route-token');
  });

  it('isolates concurrent route tokens and releasing one does not remove the other', async () => {
    const daemon = await startFakeOmniCrossDaemon();
    daemons.push(daemon);
    const firstRoute = route(daemon.endpoint);
    const secondRoute: FrozenInferenceRoute = {
      ...firstRoute,
      upstream: { kind: 'account-pool', providerId: 'qwen-api' },
      model: 'qwen3-coder',
    };
    const client = createOmniCrossRouteLeaseClient({
      authority: resolveOmniCrossControlAuthority(
        firstRoute.connection,
        { TEST_OMNICROSS_ADMIN_TOKEN: daemon.controlToken }
      ),
    });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const tokens: string[] = [];
    const first = withOmniCrossRoute({
      route: firstRoute,
      attempt: { runId: 'run-1', stageId: 'planner', attempt: 1 },
      client,
      run: async (binding) => {
        if (binding.runtime === 'codex') tokens.push(binding.env.OMNICROSS_CODEX_ROUTE_TOKEN);
        await firstGate;
      },
    });
    const second = withOmniCrossRoute({
      route: secondRoute,
      attempt: { runId: 'run-1', stageId: 'ship', attempt: 1 },
      client,
      run: async (binding) => {
        if (binding.runtime === 'codex') tokens.push(binding.env.OMNICROSS_CODEX_ROUTE_TOKEN);
        await secondGate;
      },
    });
    while (daemon.activeLeases.size < 2 || tokens.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(new Set(tokens).size).toBe(2);
    const creates = daemon.requests
      .filter((entry) => entry.method === 'POST' && entry.path === '/admin/api/route-leases')
      .map((entry) => entry.body as CreateRouteLeaseRequest);
    expect(creates.map((entry) => [entry.upstream, entry.model])).toEqual([
      [firstRoute.upstream, firstRoute.model],
      [secondRoute.upstream, secondRoute.model],
    ]);
    releaseFirst();
    await first;
    expect(daemon.activeLeases.size).toBe(1);
    releaseSecond();
    await second;
    expect(daemon.activeLeases.size).toBe(0);
  });
});
