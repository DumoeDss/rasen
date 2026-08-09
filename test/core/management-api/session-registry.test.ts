import { afterEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createDurableSessionRegistryStore,
  createExactClaudeTranscriptProbe,
  createSessionRegistry,
  durableSessionMessageIdDigest,
  durablePathsEqual,
  MAX_DURABLE_IDEMPOTENCY_TOMBSTONES,
  MAX_DURABLE_TERMINAL_WAKES,
  nodeDurableRegistryFileSystem,
  resolveDurableSessionRegistryPaths,
  type DurableRegistryFileSystem,
  type RegisterDurableSessionInput,
  type TrustedCanonicalRunRef,
} from '../../../src/core/management-api/session-registry.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

describe('session-registry (design D2)', () => {
  it('creates a record in state starting with the given fields', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 'do a thing', cwd: '/tmp/proj' });

    expect(record.kind).toBe('auto');
    expect(record.task).toBe('do a thing');
    expect(record.cwd).toBe('/tmp/proj');
    expect(record.state).toBe('starting');
    expect(typeof record.id).toBe('string');
    expect(record.id.length).toBeGreaterThan(0);
    expect(record.changeName).toBeUndefined();
  });

  it('carries changeName only when provided', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'goal', task: 't', cwd: '/tmp', changeName: 'my-change' });
    expect(record.changeName).toBe('my-change');
  });

  it('get/list return copies, not live references', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    const fetched = registry.get(record.id)!;
    fetched.task = 'mutated';
    expect(registry.get(record.id)!.task).toBe('t');

    const listed = registry.list();
    listed[0].task = 'also mutated';
    expect(registry.get(record.id)!.task).toBe('t');
  });

  it('get returns undefined for an unknown id', () => {
    const registry = createSessionRegistry();
    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  it('updateState patches pid, agentSessionId, and termination fields', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    registry.updateState(record.id, 'running', { pid: 4242 });
    expect(registry.get(record.id)!.state).toBe('running');
    expect(registry.get(record.id)!.pid).toBe(4242);

    registry.updateState(record.id, 'running', { agentSessionId: 'agent-abc' });
    expect(registry.get(record.id)!.agentSessionId).toBe('agent-abc');
  });

  it('updateState on an unknown id is a silent no-op', () => {
    const registry = createSessionRegistry();
    expect(() => registry.updateState('nope', 'running')).not.toThrow();
  });

  it('touchOutput updates lastOutputAt', async () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });
    const before = registry.get(record.id)!.lastOutputAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    registry.touchOutput(record.id);

    expect(registry.get(record.id)!.lastOutputAt).toBeGreaterThan(before);
  });

  it('finalize sets state exited, endedAt, and the termination reason', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    registry.finalize(record.id, 'exit', 0, null);

    const finalRecord = registry.get(record.id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('exit');
    expect(finalRecord.exitCode).toBe(0);
    expect(finalRecord.exitSignal).toBeNull();
    expect(typeof finalRecord.endedAt).toBe('number');
  });

  it('finalize preserves the first-set termination reason', () => {
    const registry = createSessionRegistry();
    const record = registry.create({ kind: 'auto', task: 't', cwd: '/tmp' });

    registry.updateState(record.id, 'exiting', { terminationReason: 'killed' });
    registry.finalize(record.id, 'signal', null, 'SIGTERM');

    expect(registry.get(record.id)!.terminationReason).toBe('killed');
  });

  it('prunes the oldest exited record once the retention cap (50) is exceeded, keeping live records', () => {
    const registry = createSessionRegistry();

    const liveRecord = registry.create({ kind: 'auto', task: 'still running', cwd: '/tmp' });

    const exitedIds: string[] = [];
    for (let i = 0; i < 55; i++) {
      const r = registry.create({ kind: 'auto', task: `t${i}`, cwd: '/tmp' });
      exitedIds.push(r.id);
      registry.finalize(r.id, 'exit', 0, null);
    }

    const all = registry.list();
    const exitedCount = all.filter((r) => r.state === 'exited').length;
    expect(exitedCount).toBe(50);

    // The still-running record survives regardless of the exited cap.
    expect(registry.get(liveRecord.id)).toBeDefined();

    // The earliest-finalized exited records were pruned; the most recent ones remain.
    expect(registry.get(exitedIds[0])).toBeUndefined();
    expect(registry.get(exitedIds[exitedIds.length - 1])).toBeDefined();
  });

  it('records the execution binding alongside the planning space', () => {
    const registry = createSessionRegistry();
    const record = registry.create({
      kind: 'auto',
      task: 't',
      cwd: '/repo',
      space: { type: 'store', id: 'team-store', root: '/store' },
      execution: { kind: 'project', projectId: 'p1', root: '/repo' },
    });

    expect(registry.get(record.id)?.execution).toEqual({
      kind: 'project',
      projectId: 'p1',
      root: '/repo',
    });
  });

  it('records planning-only as an explicit kind, not an absent field', () => {
    const registry = createSessionRegistry();
    const record = registry.create({
      kind: 'auto',
      task: 't',
      cwd: '/store',
      space: { type: 'store', id: 'team-store', root: '/store' },
      execution: { kind: 'planning-only' },
    });

    expect(registry.get(record.id)?.execution).toEqual({ kind: 'planning-only' });
  });

  it('copies the nested space and execution refs on read', () => {
    const registry = createSessionRegistry();
    const record = registry.create({
      kind: 'auto',
      task: 't',
      cwd: '/repo',
      space: { type: 'store', id: 'team-store', root: '/store' },
      execution: { kind: 'project', projectId: 'p1', root: '/repo' },
    });

    // Mutating a "copy" must not retarget the session for the next reader.
    const first = registry.get(record.id)!;
    (first.execution as { root: string }).root = '/somewhere-else';
    (first.space as { root: string }).root = '/other-store';

    expect(registry.get(record.id)?.execution).toMatchObject({ root: '/repo' });
    expect(registry.get(record.id)?.space).toMatchObject({ root: '/store' });
  });
});

describe('durable reusable-session registry', () => {
  const temporaryPaths: string[] = [];

  function makeRun(runId = 'run-1'): TrustedCanonicalRunRef {
    const canonicalRunDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-durable-registry-'))
    );
    temporaryPaths.push(canonicalRunDir);
    return {
      kind: 'trusted-canonical-run',
      runId,
      canonicalRunDir,
    };
  }

  function makeWorkspace(): string {
    const workspace = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-durable-workspace-'))
    );
    temporaryPaths.push(workspace);
    return workspace;
  }

  function registrationInput(
    cwd: string,
    sessionKey = 'reviewer@invocation-1'
  ): RegisterDurableSessionInput {
    const now = '2026-07-30T09:00:00.000Z';
    return {
      sessionKey,
      role: 'reviewer',
      cwd,
      attachedRoots: [cwd],
      claudeSessionId: `claude-${sessionKey.replace(/[^a-z0-9]/giu, '-')}`,
      owner: {
        ownerInstanceId: 'owner-a',
        ownerPid: 101,
        hostId: `host-${sessionKey}`,
        childPid: 202,
        boundAt: now,
      },
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        touchesUsed: 0,
        deadlineAction: 'stop',
      },
    };
  }

  afterEach(async () => {
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  it('creates the first strict registry beside an admitted canonical run and round-trips it', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const now = '2026-07-30T09:00:00.000Z';
    const store = createDurableSessionRegistryStore({ run, clock: () => now });

    expect(resolveDurableSessionRegistryPaths(run)).toEqual({
      canonicalRunDir: run.canonicalRunDir,
      registryPath: path.join(run.canonicalRunDir, 'sessions.json'),
      mutationLockPath: path.join(run.canonicalRunDir, 'sessions.json.lock'),
      wakeLockDirectory: path.join(run.canonicalRunDir, 'session-wake-locks'),
    });
    expect(await store.read()).toMatchObject({
      ok: false,
      diagnostic: { code: 'registry_absent' },
    });

    const registered = await store.register({
      sessionKey: 'reviewer@invocation-1',
      role: 'reviewer',
      nodeId: 'review',
      invocationId: 'invocation-1',
      cwd,
      attachedRoots: [cwd],
      claudeSessionId: 'claude-session-1',
      owner: {
        ownerInstanceId: 'owner-a',
        ownerPid: 101,
        hostId: 'host-a',
        childPid: 202,
        boundAt: now,
      },
      touchPolicy: {
        mode: 'auto',
        deadlineAt: '2026-07-30T11:00:00.000Z',
        maxTouches: 2,
        touchesUsed: 0,
        deadlineAction: 'stop',
      },
      launcherSessionId: 'launcher-a',
    });

    expect(registered).toMatchObject({
      ok: true,
      registry: {
        schema: 'rasen-session-registry/1',
        runId: 'run-1',
        revision: 1,
        launcherSessionIds: ['launcher-a'],
      },
      session: {
        sessionKey: 'reviewer@invocation-1',
        status: 'idle',
        cwd,
        claudeSessionId: 'claude-session-1',
      },
    });
    expect(await store.read()).toEqual(registered.ok
      ? { ok: true, registry: registered.registry }
      : registered);
  });

  it('reports unsupported, corrupt, and run-mismatched state without rewriting it', async () => {
    const run = makeRun();
    const paths = resolveDurableSessionRegistryPaths(run);
    const store = createDurableSessionRegistryStore({ run });

    const cases = [
      {
        bytes: '{"schema":"rasen-session-registry/99"}\n',
        code: 'unsupported_schema',
      },
      {
        bytes: '{"schema":"rasen-session-registry/1",',
        code: 'registry_corrupt',
      },
      {
        bytes: `${JSON.stringify({
          schema: 'rasen-session-registry/1',
          runId: 'other-run',
          revision: 0,
          updatedAt: '2026-07-30T09:00:00.000Z',
          launcherSessionIds: [],
          sessions: [],
        })}\n`,
        code: 'run_mismatch',
      },
    ] as const;

    for (const item of cases) {
      fs.writeFileSync(paths.registryPath, item.bytes, 'utf-8');
      expect(await store.read()).toMatchObject({
        ok: false,
        diagnostic: { code: item.code },
      });
      expect(fs.readFileSync(paths.registryPath, 'utf-8')).toBe(item.bytes);
    }
  });

  it('rejects unexpected fields and duplicate logical identities as corruption', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const paths = resolveDurableSessionRegistryPaths(run);
    const store = createDurableSessionRegistryStore({ run });
    const session = {
      sessionKey: 'duplicate',
      role: 'reviewer',
      hostKind: 'stream-json',
      cwd,
      attachedRoots: [],
      claudeSessionId: 'claude-1',
      status: 'lost',
      lifecycle: {
        createdAt: '2026-07-30T09:00:00.000Z',
        updatedAt: '2026-07-30T09:00:00.000Z',
      },
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        touchesUsed: 0,
        deadlineAction: 'stop',
      },
      wakes: [],
    };

    fs.writeFileSync(paths.registryPath, `${JSON.stringify({
      schema: 'rasen-session-registry/1',
      runId: run.runId,
      revision: 1,
      updatedAt: '2026-07-30T09:00:00.000Z',
      launcherSessionIds: [],
      sessions: [
        session,
        { ...session, unexpected: true },
      ],
    })}\n`);

    expect(await store.read()).toMatchObject({
      ok: false,
      diagnostic: { code: 'registry_corrupt' },
    });
  });

  it('strictly rejects raw, unknown, duplicate, unsorted, and over-cap idempotency state', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const paths = resolveDurableSessionRegistryPaths(run);
    const store = createDurableSessionRegistryStore({ run });
    expect((await store.register(registrationInput(cwd))).ok).toBe(true);
    const valid = JSON.parse(
      fs.readFileSync(paths.registryPath, 'utf-8')
    ) as Record<string, unknown> & {
      sessions: Array<Record<string, unknown>>;
    };
    const digestA = durableSessionMessageIdDigest('strict-a');
    const digestB = durableSessionMessageIdDigest('strict-b');
    const sortedDigests = [digestA, digestB].sort();

    const cases = [
      (registry: typeof valid) => {
        registry.sessions[0].messageIdempotency = [{
          messageId: 'raw-id-must-not-survive',
          outcome: 'completed',
        }];
      },
      (registry: typeof valid) => {
        registry.sessions[0].idempotencyTombstones = [{
          messageIdDigest: digestA,
          disposition: 'completed',
          unexpected: true,
        }];
      },
      (registry: typeof valid) => {
        registry.sessions[0].idempotencyTombstones = [
          { messageIdDigest: digestA, disposition: 'completed' },
          { messageIdDigest: digestA, disposition: 'completed' },
        ];
      },
      (registry: typeof valid) => {
        registry.sessions[0].idempotencyTombstones = [
          {
            messageIdDigest: sortedDigests[1],
            disposition: 'completed',
          },
          {
            messageIdDigest: sortedDigests[0],
            disposition: 'delivery_uncertain',
          },
        ];
      },
      (registry: typeof valid) => {
        registry.sessions[0].idempotencyTombstones = Array.from(
          { length: MAX_DURABLE_IDEMPOTENCY_TOMBSTONES + 1 },
          (_, index) => ({
            messageIdDigest: index.toString(16).padStart(64, '0'),
            disposition: 'completed',
          })
        );
      },
      (registry: typeof valid) => {
        registry.sessions[0].status = 'waking';
        registry.sessions[0].inFlight = {
          messageId: 'raw-in-flight-id',
          admittedAt: '2026-07-30T09:01:00.000Z',
          phase: 'dispatching',
          dispatchFenceAt: '2026-07-30T09:01:01.000Z',
        };
      },
    ];

    for (const corrupt of cases) {
      const candidate = structuredClone(valid);
      corrupt(candidate);
      const bytes = `${JSON.stringify(candidate, null, 2)}\n`;
      fs.writeFileSync(paths.registryPath, bytes, 'utf-8');
      expect(await store.read()).toMatchObject({
        ok: false,
        diagnostic: { code: 'registry_corrupt' },
      });
      expect(fs.readFileSync(paths.registryPath, 'utf-8')).toBe(bytes);
    }
  });

  it('keeps a strict 4096-entry digest-only registry below the 0.75 MiB budget', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const paths = resolveDurableSessionRegistryPaths(run);
    const store = createDurableSessionRegistryStore({ run });
    expect((await store.register(registrationInput(cwd))).ok).toBe(true);
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    const tombstones = Array.from(
      { length: MAX_DURABLE_IDEMPOTENCY_TOMBSTONES },
      (_, index) => ({
        messageIdDigest: index.toString(16).padStart(64, '0'),
        disposition:
          index % 2 === 0 ? 'completed' : 'delivery_uncertain',
      })
    );
    registry.sessions[0].idempotencyTombstones = tombstones;
    registry.sessions[0].wakes = tombstones
      .slice(-MAX_DURABLE_TERMINAL_WAKES)
      .map((tombstone, index) => ({
        messageIdDigest: tombstone.messageIdDigest,
        admittedAt: new Date(Date.UTC(2026, 6, 30, 9, 0, index))
          .toISOString(),
        dispatchFenceAt: new Date(Date.UTC(2026, 6, 30, 9, 1, index))
          .toISOString(),
        settledAt: new Date(Date.UTC(2026, 6, 30, 9, 2, index))
          .toISOString(),
        outcome: tombstone.disposition,
        code: 'bounded-presentation-code',
        resultRef: `result-${index}`,
        resultDigest: index.toString(16).padStart(64, '0'),
      }));
    const bytes = `${JSON.stringify(registry, null, 2)}\n`;
    fs.writeFileSync(paths.registryPath, bytes, 'utf-8');

    expect(await store.read()).toMatchObject({ ok: true });
    expect(Buffer.byteLength(bytes, 'utf-8')).toBeLessThan(0.75 * 1024 * 1024);
    expect(bytes).not.toContain('"messageId"');
    expect(bytes).not.toContain('"messageIdempotency"');

    expect((await store.register(registrationInput(cwd, 'second-session'))).ok)
      .toBe(true);
    const roundTripped = JSON.parse(
      fs.readFileSync(paths.registryPath, 'utf-8')
    );
    expect(roundTripped.sessions[0].idempotencyTombstones).toEqual(tombstones);
  });

  it('rejects invalid lifecycle combinations and symlink registry candidates', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const paths = resolveDurableSessionRegistryPaths(run);
    const store = createDurableSessionRegistryStore({ run });
    const invalidRetired = {
      sessionKey: 'invalid-retired',
      role: 'reviewer',
      hostKind: 'stream-json',
      cwd,
      attachedRoots: [],
      claudeSessionId: 'claude-invalid',
      status: 'retired',
      owner: {
        ownerInstanceId: 'old-owner',
        ownerPid: 101,
        hostId: 'old-host',
        childPid: 202,
        boundAt: '2026-07-30T09:00:00.000Z',
      },
      lifecycle: {
        createdAt: '2026-07-30T09:00:00.000Z',
        updatedAt: '2026-07-30T09:00:00.000Z',
      },
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        touchesUsed: 0,
        deadlineAction: 'stop',
      },
      wakes: [],
    };
    fs.writeFileSync(paths.registryPath, `${JSON.stringify({
      schema: 'rasen-session-registry/1',
      runId: run.runId,
      revision: 1,
      updatedAt: '2026-07-30T09:00:00.000Z',
      launcherSessionIds: [],
      sessions: [invalidRetired],
    })}\n`);
    expect(await store.read()).toMatchObject({
      ok: false,
      diagnostic: { code: 'registry_corrupt' },
    });

    fs.rmSync(paths.registryPath);
    const actual = path.join(run.canonicalRunDir, 'actual-registry.json');
    fs.writeFileSync(actual, '{}\n');
    try {
      fs.symlinkSync(actual, paths.registryPath, 'file');
      expect(await store.read()).toMatchObject({
        ok: false,
        diagnostic: { code: 'registry_corrupt' },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  });

  it('keeps the prior revision intact across write, flush, rename, and cleanup faults', async () => {
    const boundaries = ['writeExclusive', 'flushFile', 'replace'] as const;
    for (const boundary of boundaries) {
      const run = makeRun(`run-${boundary}`);
      const cwd = makeWorkspace();
      const baseline = createDurableSessionRegistryStore({ run });
      expect((await baseline.register(registrationInput(cwd, 'baseline'))).ok).toBe(true);
      const paths = resolveDurableSessionRegistryPaths(run);
      const priorBytes = fs.readFileSync(paths.registryPath, 'utf-8');
      const injected = Object.assign(new Error(`injected ${boundary}`), {
        code: 'EIO',
      });
      const filesystem: DurableRegistryFileSystem = {
        ...nodeDurableRegistryFileSystem,
        [boundary]: () => {
          throw injected;
        },
      };
      const failing = createDurableSessionRegistryStore({ run, filesystem });
      expect(await failing.register(registrationInput(cwd, `second-${boundary}`)))
        .toMatchObject({
          ok: false,
          diagnostic: {
            code: 'registry_write_failed',
            causeCode: 'EIO',
          },
        });
      expect(fs.readFileSync(paths.registryPath, 'utf-8')).toBe(priorBytes);
      expect((await baseline.list())).toMatchObject({
        ok: true,
        sessions: [{ sessionKey: 'baseline' }],
      });
    }

    const cleanupRun = makeRun('run-cleanup');
    const cleanupCwd = makeWorkspace();
    const cleanupPaths = resolveDurableSessionRegistryPaths(cleanupRun);
    const cleanupFilesystem: DurableRegistryFileSystem = {
      ...nodeDurableRegistryFileSystem,
      replace: () => {
        throw Object.assign(new Error('injected replace'), { code: 'EIO' });
      },
      remove: () => {
        throw Object.assign(new Error('injected cleanup'), { code: 'EACCES' });
      },
    };
    const cleanupStore = createDurableSessionRegistryStore({
      run: cleanupRun,
      filesystem: cleanupFilesystem,
    });
    expect(await cleanupStore.register(registrationInput(cleanupCwd, 'cleanup')))
      .toMatchObject({
        ok: false,
        diagnostic: { code: 'registry_write_failed', causeCode: 'EIO' },
      });
    expect(fs.existsSync(cleanupPaths.registryPath)).toBe(false);
    expect(
      fs.readdirSync(cleanupRun.canonicalRunDir)
        .filter((name) => name.startsWith('.sessions.json.') && name.endsWith('.tmp'))
    ).toHaveLength(1);

    if (process.platform === 'win32') {
      const retryRun = makeRun('run-retry');
      const retryCwd = makeWorkspace();
      let replacements = 0;
      const retryFilesystem: DurableRegistryFileSystem = {
        ...nodeDurableRegistryFileSystem,
        replace: (sourcePath, targetPath) => {
          replacements += 1;
          if (replacements < 3) {
            throw Object.assign(new Error('injected sharing violation'), {
              code: 'EPERM',
            });
          }
          nodeDurableRegistryFileSystem.replace(sourcePath, targetPath);
        },
      };
      const retryStore = createDurableSessionRegistryStore({
        run: retryRun,
        filesystem: retryFilesystem,
        replaceDeadlineMs: 100,
        replacePollMs: 1,
        sleep: async () => undefined,
      });
      expect(await retryStore.register(registrationInput(retryCwd, 'retry')))
        .toMatchObject({ ok: true });
      expect(replacements).toBe(3);
    }

    const posixRun = makeRun('run-posix-injected');
    const posixCwd = makeWorkspace();
    let directoryFlushes = 0;
    const posixFilesystem: DurableRegistryFileSystem = {
      ...nodeDurableRegistryFileSystem,
      flushDirectory: () => {
        directoryFlushes += 1;
      },
    };
    const posixStore = createDurableSessionRegistryStore({
      run: posixRun,
      platform: 'linux',
      filesystem: posixFilesystem,
    });
    expect(await posixStore.register(registrationInput(posixCwd, 'posix-base')))
      .toMatchObject({ ok: true });
    expect(directoryFlushes).toBe(1);
    const posixPaths = resolveDurableSessionRegistryPaths(posixRun);
    const posixPrior = fs.readFileSync(posixPaths.registryPath, 'utf-8');
    let posixReplacements = 0;
    let posixSleeps = 0;
    const blockedPosixStore = createDurableSessionRegistryStore({
      run: posixRun,
      platform: 'linux',
      filesystem: {
        ...nodeDurableRegistryFileSystem,
        replace: () => {
          posixReplacements += 1;
          throw Object.assign(new Error('injected POSIX permission failure'), {
            code: 'EPERM',
          });
        },
      },
      sleep: async () => {
        posixSleeps += 1;
      },
    });
    expect(await blockedPosixStore.register(
      registrationInput(posixCwd, 'posix-no-retry')
    )).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'registry_write_failed',
        causeCode: 'EPERM',
      },
    });
    expect(posixReplacements).toBe(1);
    expect(posixSleeps).toBe(0);
    expect(fs.readFileSync(posixPaths.registryPath, 'utf-8')).toBe(posixPrior);
  });

  it('canonicalizes supported path aliases once and rejects a symlinked run directory', async () => {
    const run = makeRun();
    const targetA = makeWorkspace();
    const targetB = makeWorkspace();
    const aliasParent = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-durable-alias-'))
    );
    temporaryPaths.push(aliasParent);
    const alias = path.join(aliasParent, 'work & [alias]');
    fs.symlinkSync(
      targetA,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const store = createDurableSessionRegistryStore({ run });
    const registered = await store.register(registrationInput(alias, 'alias-session'));
    expect(registered).toMatchObject({
      ok: true,
      session: {
        cwd: fs.realpathSync.native(targetA),
        attachedRoots: [fs.realpathSync.native(targetA)],
      },
    });
    expect(FileSystemUtils.canonicalizeExistingPath(alias)).toBe(
      fs.realpathSync.native(targetA)
    );

    fs.rmSync(alias, { recursive: true, force: true });
    fs.symlinkSync(
      targetB,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect((await store.get('alias-session'))).toMatchObject({
      ok: true,
      session: { cwd: fs.realpathSync.native(targetA) },
    });

    const runAlias = path.join(aliasParent, 'run-alias');
    fs.symlinkSync(
      run.canonicalRunDir,
      runAlias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect(() => resolveDurableSessionRegistryPaths({
      kind: 'trusted-canonical-run',
      runId: run.runId,
      canonicalRunDir: runAlias,
    })).toThrow(/canonical|symlink/iu);
    expect(durablePathsEqual('C:\\Work\\Repo', 'c:\\work\\repo', 'win32')).toBe(true);
    expect(durablePathsEqual('/Work/Repo', '/work/repo', 'linux')).toBe(false);
    expect(durablePathsEqual('/srv//runs/../runs/a', '/srv/runs/a', 'linux'))
      .toBe(true);
  });

  it('probes only the exact regular Claude transcript and rejects a symlink candidate', async () => {
    const cwd = makeWorkspace();
    const projectsDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-claude-projects-'))
    );
    temporaryPaths.push(projectsDirectory);
    fs.writeFileSync(path.join(projectsDirectory, 'same-prefix-newer.jsonl'), '{}\n');
    fs.writeFileSync(path.join(projectsDirectory, 'exact-session.jsonl'), '{"ok":true}\n');
    const probe = createExactClaudeTranscriptProbe({
      projectsDirectoryForCwd: () => projectsDirectory,
    });

    expect(await probe({ cwd, claudeSessionId: 'exact-session' })).toMatchObject({
      exists: true,
      path: path.join(projectsDirectory, 'exact-session.jsonl'),
      size: 12,
    });
    expect(await probe({ cwd, claudeSessionId: 'same-prefix' })).toMatchObject({
      exists: false,
      reason: 'missing',
    });
    expect(await probe({ cwd, claudeSessionId: '../escape' })).toMatchObject({
      exists: false,
      reason: 'invalid_session_identity',
    });

    fs.rmSync(path.join(projectsDirectory, 'exact-session.jsonl'));
    const target = path.join(projectsDirectory, 'target.jsonl');
    fs.writeFileSync(target, '{}\n');
    try {
      fs.symlinkSync(target, path.join(projectsDirectory, 'exact-session.jsonl'), 'file');
      expect(await probe({ cwd, claudeSessionId: 'exact-session' })).toMatchObject({
        exists: false,
        reason: 'symlink',
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  });
});
