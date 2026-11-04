import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SessionHostRegistryError,
  createSessionHostRegistry,
  prunedRequestIdMayExist,
} from '../../../src/core/session-host/registry.js';
import {
  toSessionHostView,
  type HostedSessionRecord,
} from '../../../src/core/session-host/contracts.js';
import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  createProviderAuthorityReference,
  encodeProcessAuthorityReference,
} from '../../../src/core/session-host/process-authority/reference-codec.js';

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-host-registry-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function record(cwd: string, sessionId = randomUUID()): HostedSessionRecord {
  const canonical = fs.realpathSync.native(cwd);
  const now = '2026-08-04T00:00:00.000Z';
  return {
    sessionId,
    backend: 'replay',
    cwd: canonical,
    cwdDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    hostState: 'idle',
    generation: 1,
    createdAt: now,
    updatedAt: now,
    requests: [],
  };
}

function exactTeacherAttempt(sessionId: string, requestId: string) {
  const provider = {
    providerId: 'test.exact-teacher',
    capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
    protocolVersion: 1,
  } as const;
  const processRef = encodeProcessAuthorityReference(
    {
      ...provider,
      commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
      providerReferenceVersion: 1,
      semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
    },
    createProviderAuthorityReference(1, Buffer.from('teacher-authority-0001'))
  );
  return {
    processRef,
    facts: {
      schema: 'rasen-exact-teacher-session-attempt/1',
      recordVersion: 1,
      attemptId: 'teacher-attempt-0001',
      provider,
      processRef,
      runId: 'run-0001',
      actionId: 'teacher-action-0001',
      invocationId: 'teacher-invocation-0001',
      attempt: 1,
      stableSessionId: sessionId,
      requestId,
      journalRevision: 7,
      phase: 'result-quarantined',
      baselineIdentity: 'manifest:baseline',
      hostedReceipt: {
        stableSessionId: sessionId,
        requestId,
        resultRef: 'sha256:result-object-0001',
        resultDigest: 'a'.repeat(64),
      },
      quarantineIdentity: `quarantine:sha256:${'a'.repeat(64)}`,
    },
  } as const;
}

function rewriteValidDocument(
  registryPath: string,
  mutate: (payload: Record<string, any>) => void
): void {
  const document = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as Record<string, any>;
  const { digest: _oldDigest, ...payload } = document;
  mutate(payload);
  const digest = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  fs.writeFileSync(registryPath, `${JSON.stringify({ ...payload, digest })}\n`, 'utf8');
}

describe('durable hosted Session registry', () => {
  it('round-trips exact Teacher restart-union facts without projecting authority details', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const stateDir = path.join(root, 'state');
    const requestId = randomUUID();
    const original = record(cwd);
    const exact = exactTeacherAttempt(original.sessionId, requestId);
    const exactRecord = {
      ...original,
      requests: [{
        requestId,
        inputDigest: 'b'.repeat(64),
        generation: 1,
        state: 'settled' as const,
        preparedAt: original.createdAt,
        sentAt: original.createdAt,
        settledAt: original.createdAt,
        resultRef: exact.facts.hostedReceipt.resultRef,
        resultDigest: exact.facts.hostedReceipt.resultDigest,
      }],
      process: {
        generation: 1,
        ownerToken: 'teacher-owner-token',
        runtimeRef: exact.processRef,
        preparedAt: original.createdAt,
      },
      exactTeacherAttempt: exact.facts,
    } as HostedSessionRecord;

    const first = createSessionHostRegistry({ stateDir });
    await first.create(exactRecord);
    const restarted = createSessionHostRegistry({ stateDir });
    await restarted.load();

    expect(restarted.get(original.sessionId)).toEqual({
      ...exactRecord,
      revision: 0,
    });
    expect(toSessionHostView(restarted.get(original.sessionId)!))
      .not.toHaveProperty('exactTeacherAttempt');
    expect(JSON.stringify(toSessionHostView(restarted.get(original.sessionId)!)))
      .not.toContain('rasen-process-authority/1:');
    const bytes = fs.readFileSync(restarted.paths.registryPath, 'utf8');
    expect(bytes).not.toMatch(/\bpid\b|processName|nativeHandle|resultBody/i);
  });

  it('keeps exact Teacher provider and canonical attempt identity immutable', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const requestId = randomUUID();
    const original = record(cwd);
    const exact = exactTeacherAttempt(original.sessionId, requestId);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    await registry.create({
      ...original,
      requests: [{
        requestId,
        inputDigest: 'b'.repeat(64),
        generation: 1,
        state: 'settled',
        preparedAt: original.createdAt,
        resultRef: exact.facts.hostedReceipt.resultRef,
        resultDigest: exact.facts.hostedReceipt.resultDigest,
      }],
      process: {
        generation: 1,
        ownerToken: 'teacher-owner-token',
        runtimeRef: exact.processRef,
        preparedAt: original.createdAt,
      },
      exactTeacherAttempt: exact.facts,
    });

    await expect(registry.update(original.sessionId, 1, (current) => ({
      ...current,
      exactTeacherAttempt: {
        ...current.exactTeacherAttempt!,
        runId: 'forged-run',
      },
    }))).rejects.toThrow(/immutable|identity/i);
    expect(registry.get(original.sessionId)?.exactTeacherAttempt?.runId).toBe('run-0001');
  });

  it('preserves unknown, future, and crossed exact-authority bytes while failing closed', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const stateDir = path.join(root, 'state');
    const requestId = randomUUID();
    const original = record(cwd);
    const exact = exactTeacherAttempt(original.sessionId, requestId);
    const registry = createSessionHostRegistry({ stateDir });
    await registry.create({
      ...original,
      requests: [{
        requestId,
        inputDigest: 'b'.repeat(64),
        generation: 1,
        state: 'settled',
        preparedAt: original.createdAt,
        resultRef: exact.facts.hostedReceipt.resultRef,
        resultDigest: exact.facts.hostedReceipt.resultDigest,
      }],
      process: {
        generation: 1,
        ownerToken: 'teacher-owner-token',
        runtimeRef: exact.processRef,
        preparedAt: original.createdAt,
      },
      exactTeacherAttempt: exact.facts,
    });
    const validBytes = fs.readFileSync(registry.paths.registryPath, 'utf8');
    const mutations: Array<(facts: Record<string, any>, session: Record<string, any>) => void> = [
      (facts) => { facts.futureAuthority = 'must-fail'; },
      (facts) => { facts.phase = 'future-authority-phase'; },
      (facts) => { facts.stableSessionId = randomUUID(); },
      (facts) => { facts.requestId = randomUUID(); },
      (facts) => { facts.provider.protocolVersion += 1; },
      (facts) => { facts.hostedReceipt.resultDigest = 'c'.repeat(64); },
      (facts) => { facts.quarantineIdentity = `quarantine:sha256:${'d'.repeat(64)}`; },
      (facts, session) => {
        facts.processRef = facts.processRef.replace(
          'rasen-process-authority/1:',
          'rasen-process-authority/2:'
        );
        session.process.runtimeRef = facts.processRef;
      },
    ];

    for (const mutate of mutations) {
      fs.writeFileSync(registry.paths.registryPath, validBytes, 'utf8');
      rewriteValidDocument(registry.paths.registryPath, (payload) => {
        const session = payload.sessions[original.sessionId];
        mutate(session.exactTeacherAttempt, session);
      });
      const authoredBytes = fs.readFileSync(registry.paths.registryPath, 'utf8');
      await expect(createSessionHostRegistry({ stateDir }).load()).rejects.toMatchObject({
        code: 'registry-corrupt',
      });
      expect(fs.readFileSync(registry.paths.registryPath, 'utf8')).toBe(authoredBytes);
    }
  });

  it('publishes owner-only canonical records and returns deep copies', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const original = record(cwd);

    await registry.create(original);
    const first = registry.get(original.sessionId)!;
    first.requests.push({
      requestId: randomUUID(),
      inputDigest: 'mutated',
      generation: 1,
      state: 'settled',
      preparedAt: original.createdAt,
    });

    expect(registry.get(original.sessionId)?.requests).toEqual([]);
    expect(registry.paths.registryPath).toBe(
      path.join(root, 'state', 'session-host', 'registry.json')
    );
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.dirname(registry.paths.registryPath)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(registry.paths.registryPath).mode & 0o777).toBe(0o600);
    }
    const bytes = fs.readFileSync(registry.paths.registryPath, 'utf8');
    expect(bytes).not.toMatch(/prompt|privateKey|environment|credential|Action|EvidenceStore/);
  });

  it('uses generation compare-and-swap and preserves the winner', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const initial = record(cwd);
    await registry.create(initial);

    await registry.update(initial.sessionId, 1, (current) => ({
      ...current,
      generation: 2,
      updatedAt: '2026-08-04T00:00:01.000Z',
    }));

    await expect(
      registry.update(initial.sessionId, 1, (current) => current)
    ).rejects.toMatchObject({ code: 'stale-generation' });
    expect(registry.get(initial.sessionId)?.generation).toBe(2);
  });

  it('uses a monotonic lifecycle revision to fence same-process-generation mutations', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const initial = await registry.create(record(cwd));
    expect(initial.revision).toBe(0);

    const winner = await registry.update(
      initial.sessionId,
      { generation: 1, revision: 0 },
      (current) => ({ ...current, recoveryReason: 'winner' })
    );
    expect(winner).toMatchObject({ generation: 1, revision: 1, recoveryReason: 'winner' });
    await expect(registry.update(
      initial.sessionId,
      { generation: 1, revision: 0 },
      (current) => ({ ...current, hostState: 'retired' })
    )).rejects.toMatchObject({ code: 'stale-generation' });
    expect(registry.get(initial.sessionId)).toMatchObject({
      generation: 1, revision: 1, hostState: 'idle', recoveryReason: 'winner',
    });
  });

  it('recovers one complete generation at every injected mutation boundary', async () => {
    const scenarios = [
      ['before-lease', 1],
      ['after-lease', 1],
      ['after-candidate-write', 1],
      ['after-candidate-flush', 1],
      ['before-replace', 1],
      ['after-replace', 2],
      ['before-lease-release', 2],
    ] as const;

    for (const [faultPhase, diskGeneration] of scenarios) {
      const root = tempRoot();
      const cwd = path.join(root, 'checkout');
      fs.mkdirSync(cwd);
      const stateDir = path.join(root, 'state');
      const initialRegistry = createSessionHostRegistry({ stateDir });
      const initial = record(cwd);
      await initialRegistry.create(initial);

      const faulting = createSessionHostRegistry({
        stateDir,
        fault: (phase) => {
          if (phase === faultPhase) throw new Error(`injected crash at ${faultPhase}`);
        },
      });
      await expect(
        faulting.update(initial.sessionId, 1, (current) => ({
          ...current,
          generation: 2,
          updatedAt: '2026-08-04T00:00:02.000Z',
        }))
      ).rejects.toThrow(`injected crash at ${faultPhase}`);

      const recovered = createSessionHostRegistry({ stateDir, processAlive: () => false });
      await recovered.load();
      expect(recovered.get(initial.sessionId)?.generation, faultPhase).toBe(diskGeneration);
      await recovered.update(initial.sessionId, diskGeneration, (current) => ({
        ...current,
        generation: diskGeneration + 1,
        updatedAt: '2026-08-04T00:00:03.000Z',
      }));
      expect(recovered.get(initial.sessionId)?.generation).toBe(diskGeneration + 1);
      expect(
        fs.readdirSync(recovered.paths.root).filter((name) => name.endsWith('.candidate')),
        faultPhase
      ).toEqual([]);
    }
  });

  it('fails closed on malformed bytes, unknown schema, digest mismatch, and missing cwd', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const stateDir = path.join(root, 'state');
    const registry = createSessionHostRegistry({ stateDir });
    const initial = record(cwd);
    await registry.create(initial);
    const validBytes = fs.readFileSync(registry.paths.registryPath, 'utf8');

    for (const replacement of [
      '{oops',
      validBytes.replace('rasen-session-host-registry/2', 'unknown/9'),
      validBytes.replace(/"digest":"[0-9a-f]+"/, '"digest":"00"'),
    ]) {
      fs.writeFileSync(registry.paths.registryPath, replacement);
      const reader = createSessionHostRegistry({ stateDir });
      await expect(reader.load()).rejects.toBeInstanceOf(SessionHostRegistryError);
    }

    fs.writeFileSync(registry.paths.registryPath, validBytes);
    fs.rmSync(cwd, { recursive: true });
    await expect(createSessionHostRegistry({ stateDir }).load()).rejects.toMatchObject({
      code: 'registry-corrupt',
    });
    expect(fs.readFileSync(registry.paths.registryPath, 'utf8')).toBe(validBytes);
  });

  it('fails closed on unknown nested fields, relative/noncanonical cwd, and injected read/cwd permission denial', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const stateDir = path.join(root, 'state');
    const registry = createSessionHostRegistry({ stateDir });
    const initial = record(cwd);
    await registry.create(initial);
    const original = fs.readFileSync(registry.paths.registryPath, 'utf8');

    rewriteValidDocument(registry.paths.registryPath, (payload) => {
      payload.sessions[initial.sessionId].unknownAuthority = 'must-fail';
    });
    await expect(createSessionHostRegistry({ stateDir }).load()).rejects.toMatchObject({
      code: 'registry-corrupt',
    });

    fs.writeFileSync(registry.paths.registryPath, original, 'utf8');
    rewriteValidDocument(registry.paths.registryPath, (payload) => {
      const session = payload.sessions[initial.sessionId];
      session.cwd = 'relative/checkout';
      session.cwdDigest = createHash('sha256').update(session.cwd, 'utf8').digest('hex');
    });
    await expect(createSessionHostRegistry({ stateDir }).load()).rejects.toMatchObject({
      code: 'registry-corrupt',
    });

    fs.writeFileSync(registry.paths.registryPath, original, 'utf8');
    const readDenied = new Error('registry read denied') as NodeJS.ErrnoException;
    readDenied.code = 'EACCES';
    await expect(createSessionHostRegistry({
      stateDir,
      readRegistryFile: async () => { throw readDenied; },
    }).load()).rejects.toMatchObject({ code: 'registry-corrupt' });
    expect(fs.readFileSync(registry.paths.registryPath, 'utf8')).toBe(original);

    const cwdDenied = new Error('cwd read denied') as NodeJS.ErrnoException;
    cwdDenied.code = 'EACCES';
    await expect(createSessionHostRegistry({
      stateDir,
      statCwd: () => { throw cwdDenied; },
    }).load()).rejects.toMatchObject({ code: 'registry-corrupt' });
    expect(fs.readFileSync(registry.paths.registryPath, 'utf8')).toBe(original);
  });

  it('reports a live exact lease as busy without deleting its owner token', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    await registry.load();
    fs.mkdirSync(path.dirname(registry.paths.leasePath), { recursive: true });
    const token = `${JSON.stringify({ version: 1, pid: process.pid, nonce: 'live', createdAt: new Date().toISOString() })}\n`;
    fs.writeFileSync(registry.paths.leasePath, token, { flag: 'wx' });

    await expect(registry.create(record(cwd))).rejects.toMatchObject({
      code: 'registry-busy',
    });
    expect(fs.readFileSync(registry.paths.leasePath, 'utf8')).toBe(token);
  });

  it('serializes a real competing process and lets one successor recover after owner death', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const stateDir = path.join(root, 'state');
    const registry = createSessionHostRegistry({ stateDir });
    await registry.load();
    const fixture = path.resolve('test/fixtures/session-host/registry-lease-holder.mjs');
    const child = spawn(process.execPath, [fixture, registry.paths.leasePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.stdout!.once('data', (chunk) => {
          const ready = JSON.parse(chunk.toString('utf8')) as { ready?: unknown };
          if (ready.ready === true) resolve();
          else reject(new Error('lease fixture did not become ready'));
        });
      });
      const contender = record(cwd);
      await expect(registry.create(contender)).rejects.toMatchObject({
        code: 'registry-busy',
      });
      expect(fs.readFileSync(registry.paths.leasePath, 'utf8')).toContain(`"pid":${child.pid}`);

      child.kill();
      await new Promise<void>((resolve) => child.once('close', () => resolve()));
      const successor = createSessionHostRegistry({ stateDir });
      await successor.create(contender);
      expect(successor.get(contender.sessionId)).toMatchObject({
        sessionId: contender.sessionId,
      });
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });

  it('recovers one provably dead lease and never removes a successor token', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const stateDir = path.join(root, 'state');
    const registry = createSessionHostRegistry({ stateDir, processAlive: () => false });
    await registry.load();
    fs.mkdirSync(path.dirname(registry.paths.leasePath), { recursive: true });
    fs.writeFileSync(
      registry.paths.leasePath,
      `${JSON.stringify({ version: 1, pid: 999999, nonce: 'dead-generation', createdAt: new Date().toISOString() })}\n`
    );

    const created = record(cwd);
    await registry.create(created);
    expect(registry.get(created.sessionId)).toMatchObject({ sessionId: created.sessionId });
    expect(
      fs.existsSync(path.join(registry.paths.root, '.registry.writer.dead-generation.recovered'))
    ).toBe(true);
    expect(fs.existsSync(registry.paths.leasePath)).toBe(false);
  });

  it('retries injected Windows sharing violations and keeps the candidate same-directory', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    let attempts = 0;
    const registry = createSessionHostRegistry({
      stateDir: path.join(root, 'state'),
      platform: 'win32',
      rename: async (from, to) => {
        attempts += 1;
        expect(path.dirname(from)).toBe(path.dirname(to));
        if (attempts < 3) {
          const error = new Error('sharing violation') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        }
        await fs.promises.rename(from, to);
      },
    });
    await registry.create(record(cwd));
    expect(attempts).toBe(3);
  });

  it('exhausts a locked Windows target without replacing the winner or leaking a candidate', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const stateDir = path.join(root, 'state');
    const initialRegistry = createSessionHostRegistry({ stateDir });
    const initial = record(cwd);
    await initialRegistry.create(initial);
    let attempts = 0;
    const locked = createSessionHostRegistry({
      stateDir,
      platform: 'win32',
      renameAttempts: 3,
      rename: async () => {
        attempts += 1;
        const error = new Error('locked target') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      },
    });
    await expect(locked.update(initial.sessionId, 1, (current) => ({
      ...current,
      generation: 2,
    }))).rejects.toMatchObject({ code: 'registry-busy' });
    expect(attempts).toBe(3);

    const reader = createSessionHostRegistry({ stateDir });
    await reader.load();
    expect(reader.get(initial.sessionId)?.generation).toBe(1);
    expect(fs.readdirSync(reader.paths.root).filter((name) => name.endsWith('.candidate'))).toEqual([]);
  });

  it('exercises injected Windows drive/case/separator identity and rejects a junction alias', async () => {
    const root = tempRoot();
    const stateDir = path.join(root, 'state');
    const canonical = 'C:\\Long Path\\ユニコード\\checkout';
    const variant = 'c:/Long Path/ユニコード/checkout';
    const windowsRecord = record(root);
    windowsRecord.cwd = variant;
    windowsRecord.cwdDigest = createHash('sha256').update(variant, 'utf8').digest('hex');
    const registry = createSessionHostRegistry({
      stateDir,
      pathPlatform: 'win32',
      statCwd: () => ({ isDirectory: () => true }),
      realpathCwd: () => canonical,
    });
    await registry.create(windowsRecord);
    expect(registry.get(windowsRecord.sessionId)?.cwd).toBe(variant);

    const aliasRecord = record(root);
    aliasRecord.cwd = 'C:\\Long Path\\alias-junction';
    aliasRecord.cwdDigest = createHash('sha256').update(aliasRecord.cwd, 'utf8').digest('hex');
    await expect(registry.create(aliasRecord)).rejects.toThrow('session cwd is not canonical');
  });

  it('bounds settled history while preserving ambiguous requests', async () => {
    const root = tempRoot();
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const initial = record(cwd);
    initial.requests = Array.from({ length: 70 }, (_, index) => ({
      requestId: randomUUID(),
      inputDigest: String(index),
      generation: 1,
      state: 'settled' as const,
      preparedAt: new Date(Date.parse(initial.createdAt) + index).toISOString(),
      settledAt: new Date(Date.parse(initial.createdAt) + index + 1).toISOString(),
      resultDigest: String(index),
    }));
    initial.requests.push({
      requestId: randomUUID(),
      inputDigest: 'ambiguous',
      generation: 1,
      state: 'ambiguous',
      preparedAt: '2026-08-04T00:01:00.000Z',
    });
    await registry.create(initial);
    await registry.update(initial.sessionId, 1, (current) => current);
    const retained = registry.get(initial.sessionId)!.requests;
    expect(retained).toHaveLength(65);
    expect(retained.some((request) => request.state === 'ambiguous')).toBe(true);
    expect(retained.filter((request) => request.state === 'settled')).toHaveLength(64);
    const updated = registry.get(initial.sessionId)!;
    expect(updated.prunedRequestFilter).toBeTypeOf('string');
    expect(prunedRequestIdMayExist(updated, initial.requests[0].requestId)).toBe(true);
    let fresh = randomUUID();
    while (prunedRequestIdMayExist(updated, fresh)) fresh = randomUUID();
    expect(prunedRequestIdMayExist(updated, fresh)).toBe(false);
  });
});
