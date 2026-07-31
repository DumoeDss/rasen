import { Command } from 'commander';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerSessionCommand,
  selectSessionOwner,
} from '../../../src/commands/session.js';
import { writeDaemonState } from '../../../src/core/management-api/daemon-state.js';
import {
  createSessionHostCoordinator,
  createExactClaudeTranscriptProbe,
  durableSessionMessageIdDigest,
  resolveDurableSessionRegistryPaths,
  type ClaudeTranscriptFacts,
  type DurableTouchPolicy,
  type TrustedCanonicalRunRef,
} from '../../../src/core/management-api/durable-session-registry.js';
import { createReusableSessionService } from '../../../src/core/management-api/reusable-session-api.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';
import {
  createAcceptanceSupervisor,
  createCanonicalAcceptanceRun,
} from './fixtures.js';

const transcriptFacts = (): ClaudeTranscriptFacts => ({
  exists: true,
  path: 'exact-regular-transcript.jsonl',
  canonicalPath: 'exact-regular-transcript.jsonl',
  size: 128,
  mtimeMs: 1234,
});

describe('session cache portfolio lifecycle acceptance', () => {
  const temporaryPaths: string[] = [];

  async function setup() {
    const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-cache-acceptance-'))
    );
    temporaryPaths.push(root);
    const fixture = await createCanonicalAcceptanceRun(root, 'bug-fix');
    const run: TrustedCanonicalRunRef = {
      kind: 'trusted-canonical-run',
      runId: fixture.plan.runId,
      canonicalRunDir: fs.realpathSync.native(fixture.manifest.runDirectory),
    };
    return { root, fixture, run };
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  it('executes create, sequential wakes, contention, later wake, touch, and terminal retirement through the real coordinator', async () => {
    const { fixture, run } = await setup();
    const primary = createAcceptanceSupervisor();
    const contender = createAcceptanceSupervisor();
    let now = '2026-07-30T09:00:00.000Z';
    const policy: DurableTouchPolicy = {
      mode: 'auto',
      deadlineAt: '2026-07-30T12:00:00.000Z',
      maxTouches: 2,
      touchesUsed: 0,
      deadlineAction: 'stop',
    };
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: primary.supervisor,
      ownerInstanceId: 'acceptance-owner-primary',
      ownerPid: 101,
      clock: () => now,
      transcriptProbe: transcriptFacts,
    });
    const competingCoordinator = createSessionHostCoordinator({
      run,
      supervisor: contender.supervisor,
      ownerInstanceId: 'acceptance-owner-contender',
      ownerPid: 202,
      clock: () => now,
      transcriptProbe: transcriptFacts,
    });

    const bootstrap = await coordinator.register({
      sessionKey: 'portfolio-reviewer',
      messageId: 'accepted-bootstrap',
      role: fixture.action.agent.role,
      actionId: fixture.action.actionId,
      nodeId: fixture.action.nodeId,
      invocationId: fixture.action.invocationId,
      message: 'bounded bootstrap',
      cwd: fixture.manifest.workspace,
      attachedRoots: [],
      space: {
        type: 'project',
        id: fixture.record.change.projectId,
        root: fixture.manifest.workspace,
      },
      execution: {
        kind: 'project',
        projectId: fixture.record.change.projectId,
        root: fixture.manifest.workspace,
      },
      model: fixture.action.agent.model,
      effort: fixture.action.agent.reasoningEffort,
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      touchPolicy: policy,
    });
    expect(bootstrap).toMatchObject({
      ok: true,
      disposition: 'completed',
      session: {
        sessionKey: 'portfolio-reviewer',
        status: 'idle',
        actionId: fixture.action.actionId,
      },
    });

    for (const [index, timestamp] of [
      ['one', '2026-07-30T09:01:00.000Z'],
      ['two', '2026-07-30T09:02:00.000Z'],
    ] as const) {
      now = timestamp;
      expect(
        await coordinator.wake({
          sessionKey: 'portfolio-reviewer',
          messageId: `sequential-${index}`,
          message: `bounded wake ${index}`,
          kind: 'interactive',
          timeoutMs: 3000,
          noOutputTimeoutMs: 1000,
        })
      ).toMatchObject({ ok: true, disposition: 'completed' });
    }

    now = '2026-07-30T09:03:00.000Z';
    const release = primary.pauseNextWake();
    const accepted = coordinator.wake({
      sessionKey: 'portfolio-reviewer',
      messageId: 'overlap-accepted',
      message: 'bounded accepted overlap',
      kind: 'interactive',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    while (primary.calls.wake.length < 3) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const rejected = await competingCoordinator.wake({
      sessionKey: 'portfolio-reviewer',
      messageId: 'overlap-rejected',
      message: 'must not reach a host',
      kind: 'interactive',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(rejected).toMatchObject({ ok: false, code: 'wake_busy' });
    expect(contender.calls.create).toHaveLength(0);
    expect(contender.calls.wake).toHaveLength(0);
    expect(contender.calls.recover).toHaveLength(0);
    release();
    expect(await accepted).toMatchObject({ ok: true, disposition: 'completed' });

    now = '2026-07-30T09:04:00.000Z';
    const later = await coordinator.wake({
      sessionKey: 'portfolio-reviewer',
      messageId: 'later-wake',
      message: 'bounded later wake',
      kind: 'interactive',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(later).toMatchObject({ ok: true, disposition: 'completed' });
    if (!later.ok || later.disposition !== 'completed') {
      throw new Error('Expected the later wake to complete.');
    }

    now = '2026-07-30T09:54:00.000Z';
    const touch = await coordinator.wake({
      sessionKey: 'portfolio-reviewer',
      messageId: 'touch-ordinal-1-attempt-1',
      message: 'bounded coordinator touch',
      kind: 'touch',
      expectedLastWakeAt: later.session.lifecycle.lastWakeAt!,
      touchOrdinal: 1,
      touchAttempt: 1,
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(touch).toMatchObject({
      ok: true,
      disposition: 'completed',
      session: { touchPolicy: { touchesUsed: 1 } },
      wake: { kind: 'touch', touchOrdinal: 1, touchAttempt: 1 },
    });

    const retired = await coordinator.retire(
      'portfolio-reviewer',
      'acceptance-complete'
    );
    expect(retired).toMatchObject({
      ok: true,
      session: { status: 'retired' },
    });
    const beforeRejected = {
      create: primary.calls.create.length,
      wake: primary.calls.wake.length,
      recover: primary.calls.recover.length,
      delivered: primary.calls.deliveredMessages.length,
    };
    expect(
      await coordinator.wake({
        sessionKey: 'portfolio-reviewer',
        messageId: 'after-retirement',
        message: 'must not dispatch',
        kind: 'interactive',
        timeoutMs: 3000,
        noOutputTimeoutMs: 1000,
      })
    ).toMatchObject({ ok: false, code: 'session_retired' });
    expect({
      create: primary.calls.create.length,
      wake: primary.calls.wake.length,
      recover: primary.calls.recover.length,
      delivered: primary.calls.deliveredMessages.length,
    }).toEqual(beforeRejected);

    const registry = JSON.parse(
      fs.readFileSync(
        resolveDurableSessionRegistryPaths(run).registryPath,
        'utf8'
      )
    );
    const session = registry.sessions[0];
    expect(session).toMatchObject({
      sessionKey: 'portfolio-reviewer',
      status: 'retired',
      touchPolicy: { touchesUsed: 1 },
    });
    expect(session.idempotencyTombstones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageIdDigest: durableSessionMessageIdDigest('accepted-bootstrap'),
        }),
        expect.objectContaining({
          messageIdDigest: durableSessionMessageIdDigest(
            'touch-ordinal-1-attempt-1'
          ),
        }),
      ])
    );
    expect(JSON.stringify(registry)).not.toContain('must not dispatch');
    expect(JSON.stringify(registry)).not.toContain('after-retirement');
  });

  it('recovers after owned-host loss with stable logical/transcript identity and a new process binding', async () => {
    const { fixture, run } = await setup();
    const ownerA = createAcceptanceSupervisor();
    const productionTranscriptProbe = createExactClaudeTranscriptProbe({
      projectsDirectoryForCwd: (cwd) => {
        expect(fs.realpathSync.native(cwd)).toBe(
          fs.realpathSync.native(fixture.manifest.workspace)
        );
        return fixture.manifest.transcriptDirectory;
      },
    });
    const coordinatorA = createSessionHostCoordinator({
      run,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-before-loss',
      ownerPid: 301,
      transcriptProbe: productionTranscriptProbe,
    });
    const registered = await coordinatorA.register({
      sessionKey: 'durable-reviewer',
      messageId: 'durability-bootstrap',
      role: fixture.action.agent.role,
      actionId: fixture.action.actionId,
      nodeId: fixture.action.nodeId,
      invocationId: fixture.action.invocationId,
      message: 'bounded durability bootstrap',
      cwd: fixture.manifest.workspace,
      attachedRoots: [],
      model: fixture.action.agent.model,
      effort: fixture.action.agent.reasoningEffort,
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        touchesUsed: 0,
        deadlineAction: 'stop',
      },
    });
    if (!registered.ok || registered.disposition !== 'completed') {
      throw new Error('Expected registration to complete.');
    }
    const before = registered.session;
    const exactTranscriptPath = path.join(
      fixture.manifest.transcriptDirectory,
      `${before.claudeSessionId}.jsonl`
    );
    fs.writeFileSync(
      exactTranscriptPath,
      `${JSON.stringify({ type: 'result', usage: { input_tokens: 1 } })}\n`
    );
    const beforeFacts = await productionTranscriptProbe({
      cwd: before.cwd,
      claudeSessionId: before.claudeSessionId!,
    });
    expect(beforeFacts).toMatchObject({
      exists: true,
      canonicalPath: fs.realpathSync.native(exactTranscriptPath),
    });
    ownerA.loseHost(before.owner!.hostId);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await coordinatorA.get('durable-reviewer');
      if (state.ok && state.session.status === 'lost') break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const ownerB = createAcceptanceSupervisor();
    const coordinatorB = createSessionHostCoordinator({
      run,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-after-loss',
      ownerPid: 302,
      transcriptProbe: productionTranscriptProbe,
    });
    const recovered = await coordinatorB.wake({
      sessionKey: 'durable-reviewer',
      messageId: 'after-process-loss',
      message: 'bounded recovery wake',
      kind: 'interactive',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(recovered).toMatchObject({
      ok: true,
      disposition: 'completed',
      session: {
        sessionKey: before.sessionKey,
        cwd: before.cwd,
        claudeSessionId: before.claudeSessionId,
        actionId: before.actionId,
        owner: { ownerInstanceId: 'owner-after-loss' },
      },
    });
    if (!recovered.ok || recovered.disposition !== 'completed') {
      throw new Error('Expected recovery wake to complete.');
    }
    expect(recovered.session.owner!.hostId).not.toBe(before.owner!.hostId);
    expect(recovered.session.owner!.childPid).not.toBe(before.owner!.childPid);
    expect(ownerB.calls.recover).toHaveLength(1);
    expect(ownerB.calls.create).toHaveLength(0);
    expect(
      await productionTranscriptProbe({
        cwd: recovered.session.cwd,
        claudeSessionId: recovered.session.claudeSessionId!,
      })
    ).toMatchObject({
      exists: true,
      canonicalPath: fs.realpathSync.native(exactTranscriptPath),
    });
  });

  it('keeps foreground correctness when daemon absence is affirmative and reaps the owner after CLI completion', async () => {
    const { fixture } = await setup();
    const host = createAcceptanceSupervisor();
    const service = createReusableSessionService({
      supervisor: host.supervisor,
      runsRoot: fixture.manifest.runsRoot,
      ownerInstanceId: 'affirmative-no-daemon-owner',
      coordinatorFactory: (run, supervisor) =>
        createSessionHostCoordinator({
          run,
          supervisor,
          ownerInstanceId: 'affirmative-no-daemon-owner',
          transcriptProbe: transcriptFacts,
        }),
    });
    const selectOwner = async () => ({
      ok: true as const,
      mode: 'foreground' as const,
      service,
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command().name('rasen');
    registerSessionCommand(program, 'en', { selectOwner });
    await program.parseAsync(
      [
        'session',
        'exec',
        '--run',
        fixture.plan.runId,
        '--session',
        'foreground-reviewer',
        '--action',
        fixture.manifest.actionFile,
        '--cwd',
        fixture.manifest.workspace,
        '--touch',
        'never',
        '--json',
      ],
      { from: 'user' }
    );
    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(String(output.mock.calls[0]![0]))).toMatchObject({
      schema: 'rasen-session-command/1',
      ownerMode: 'foreground',
      ok: true,
      command: 'exec',
    });
    expect(host.calls.create).toHaveLength(1);
    expect(host.calls.shutdown).toBeGreaterThanOrEqual(1);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(fixture.manifest.runDirectory, 'sessions.json'),
          'utf8'
        )
      ).sessions[0]
    ).toMatchObject({
      sessionKey: 'foreground-reviewer',
      status: 'lost',
    });
  });

  it('uses the production daemon state/socket/PID selector and never foregrounds ambiguous or live ownership', async () => {
    const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-owner-selection-'))
    );
    temporaryPaths.push(root);
    const previousHome = process.env.RASEN_HOME;
    const previousPort = process.env.RASEN_DAEMON_PORT;
    const reserve = http.createServer();
    await new Promise<void>((resolve) =>
      reserve.listen(0, '127.0.0.1', resolve)
    );
    const address = reserve.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a reserved TCP port.');
    }
    const port = address.port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    process.env.RASEN_HOME = root;
    process.env.RASEN_DAEMON_PORT = String(port);
    let server: http.Server | undefined;
    try {
      writeDaemonState({
        version: 'stale',
        pid: 2_147_483_647,
        port,
        token: 'stale-token',
        startedAt: Date.now(),
      });
      const absent = await selectSessionOwner();
      expect(absent).toMatchObject({ ok: true, mode: 'foreground' });
      if (absent.ok && absent.mode === 'foreground') {
        expect(await absent.service.ownerShutdown()).toEqual({ ok: true });
      }

      writeDaemonState({
        version: 'live-recorded',
        pid: process.pid,
        port,
        token: 'live-recorded-token',
        startedAt: Date.now(),
      });
      expect(await selectSessionOwner()).toMatchObject({
        ok: false,
        code: 'daemon_identity_ambiguous',
      });

      server = http.createServer(() => {
        // An accepted connection without an attributable protocol response is
        // intentionally ambiguous and must not select foreground ownership.
      });
      await new Promise<void>((resolve) =>
        server!.listen(0, '127.0.0.1', resolve)
      );
      const hanging = server.address();
      if (hanging === null || typeof hanging === 'string') {
        throw new Error('Expected a hanging TCP listener.');
      }
      process.env.RASEN_DAEMON_PORT = String(hanging.port);
      expect(await selectSessionOwner()).toMatchObject({
        ok: false,
        code: 'daemon_identity_ambiguous',
      });
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;

      const version = JSON.parse(
        fs.readFileSync(path.resolve('package.json'), 'utf8')
      ).version as string;
      server = http.createServer((request, response) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('X-Rasen-Daemon', version);
        response.setHeader('X-Rasen-Pid', String(process.pid));
        response.end(
          JSON.stringify({
            status: 'running',
            version,
            pid: process.pid,
          })
        );
      });
      await new Promise<void>((resolve) =>
        server!.listen(0, '127.0.0.1', resolve)
      );
      const live = server.address();
      if (live === null || typeof live === 'string') {
        throw new Error('Expected a live protocol listener.');
      }
      process.env.RASEN_DAEMON_PORT = String(live.port);
      writeDaemonState({
        version,
        pid: process.pid,
        port: live.port,
        token: 'live-token',
        startedAt: Date.now(),
      });
      expect(await selectSessionOwner()).toMatchObject({
        ok: true,
        mode: 'daemon',
        pid: process.pid,
        port: live.port,
      });
    } finally {
      if (server?.listening) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      if (previousHome === undefined) delete process.env.RASEN_HOME;
      else process.env.RASEN_HOME = previousHome;
      if (previousPort === undefined) delete process.env.RASEN_DAEMON_PORT;
      else process.env.RASEN_DAEMON_PORT = previousPort;
    }
  });
});
