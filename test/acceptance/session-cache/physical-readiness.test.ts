import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ObservationInterruptedError,
  createPhysicalObservationClock,
  runObservationArm,
} from '../../../scripts/session-cache-acceptance/observation-harness.mjs';
import {
  OBSERVATION_ARMS,
  createObservationAttempt,
  observationDirectory,
  readJsonBounded,
  readObservationCheckpoint,
  validateCompletedObservation,
} from '../../../scripts/session-cache-acceptance/protocol.mjs';
import {
  extractExactAppendedUsage,
  captureExactTranscriptContextBaseline,
  captureExactTranscriptBaseline,
  captureExactTranscriptState,
  inspectSchedulerTranscriptCausalAppend,
  restoreExactTranscriptBaseline,
  transcriptUsageLimits,
} from '../../../scripts/session-cache-acceptance/transcript-usage.mjs';
import {
  CAPACITY_SCHEMA,
  MAX_EVIDENCE_FINGERPRINT_BYTES,
  MAX_EXECUTABLE_FINGERPRINT_BYTES,
  fingerprintSelectedExecutable,
  hashExactFileSet,
  inspectPhysicalCapacity,
  parseWindowsCommandLine,
  sha256File,
  verifyCandidateDaemonArgv,
  verifyCapacityProofDocument,
} from '../../../scripts/session-cache-acceptance/physical-preflight.mjs';
import {
  PHYSICAL_OPERATION_TIMEOUT_MS,
  assertPhysicalSchedulerDeadlineFresh,
  createAdmittedAction,
  derivePhysicalSchedulerDeadlineAt,
} from '../../../scripts/session-cache-acceptance/prepare-physical.mjs';
import {
  boundedSpawn,
  createObservationDriver,
  decodePublicCliFailure,
} from '../../../scripts/session-cache-acceptance/rasen-cli-driver.mjs';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const candidate = {
  contentFingerprint: '1'.repeat(64),
  binaryFingerprint: '2'.repeat(64),
  repositoryRoot: process.cwd(),
  createdAt: '2026-07-31T01:00:00.000Z',
};
const admissionBinding = {
  ownerInstanceId: 'physical-owner',
  ownerPid: 101,
  ownerProcessCreationIdentity: 'win-created:1010',
  hostId: 'physical-host',
  childPid: 202,
  childProcessCreationIdentity: 'win-created:2020',
  boundAt: '2026-07-31T01:00:00.000Z',
};
const schedulerTouchText =
  'Keepalive touch. Reply with exactly: OK. Do not use any tools.';

function digestJson(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function schedulerMessageIdDigest(
  identity: { runId: string; sessionKey: string },
  ordinal: number,
  attempt: number
) {
  const messageIdHash = digestJson({
    runId: identity.runId,
    sessionKey: identity.sessionKey,
    ordinal,
    attempt,
  });
  const messageId = `rasen-touch-v1-${messageIdHash}`;
  return createHash('sha256')
    .update(
      `rasen-session-message-id/1\0${Buffer.byteLength(messageId, 'utf8')}:`,
      'utf8'
    )
    .update(messageId, 'utf8')
    .digest('hex');
}

function createAttemptForArm(
  workDir: string,
  candidateValue: typeof candidate,
  activeArmId: keyof typeof OBSERVATION_ARMS,
  activeIdentity: {
    runId: string;
    sessionKey: string;
    cwd: string;
    policy: {
      mode: 'auto' | 'never';
      deadlineAt: string | null;
      maxTouches: number;
      deadlineAction: 'stop' | 'retire-silent';
    };
  },
  clock?: () => Date
) {
  const arms = Object.fromEntries(
    Object.keys(OBSERVATION_ARMS).map((armId) => {
      if (armId === activeArmId) return [armId, activeIdentity];
      const automatic = armId === 'scheduler-cadence-deadline';
      return [
        armId,
        {
          ...activeIdentity,
          sessionKey: `unused-${armId}`,
          policy: {
            mode: automatic ? 'auto' : 'never',
            deadlineAt: automatic
              ? '2026-07-31T02:00:00.000Z'
              : null,
            maxTouches: automatic ? 1 : 0,
            deadlineAction: automatic ? 'retire-silent' : 'stop',
          },
        },
      ];
    })
  ) as Record<keyof typeof OBSERVATION_ARMS, typeof activeIdentity>;
  return createObservationAttempt(
    workDir,
    { candidate: candidateValue, arms },
    clock
  ).attemptId;
}

describe('physical observation readiness hardening', () => {
  const temporaryPaths: string[] = [];

  function temporaryDirectory(label: string) {
    const created = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), label))
    );
    temporaryPaths.push(created);
    return created;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  it('keeps the real wait timer referenced and aborts it safely', async () => {
    const unref = vi.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timer);
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    const controller = new AbortController();
    const waiting = createPhysicalObservationClock().sleep(
      60 * 60 * 1000,
      controller.signal
    );
    expect(unref).not.toHaveBeenCalled();
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(ObservationInterruptedError);
    expect(clearTimeout).toHaveBeenCalledWith(timer);
  });

  it('checkpoints interruption and resumes the exact arm without settling it early', async () => {
    const workDir = temporaryDirectory('rasen-physical-resume-');
    const cwd = temporaryDirectory('rasen-physical-cwd-');
    const identity = {
      runId: `run:${'3'.repeat(64)}`,
      sessionKey: 'physical-control-hit',
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    const attemptId = createAttemptForArm(
      workDir,
      candidate,
      'control-hit-55m',
      identity,
      () =>
      new Date('2026-07-31T01:00:00.000Z')
    );
    let wall = new Date('2026-07-31T01:00:00.000Z').valueOf();
    let monotonic = 0;
    const controller = new AbortController();
    await expect(
      runObservationArm({
        workDir,
        attemptId,
        armId: 'control-hit-55m',
        candidate,
        identity,
        signal: controller.signal,
        checkpointIntervalMs: 60_000,
        clock: {
          physical: true,
          wallNow: () => new Date(wall),
          monotonicNow: () => monotonic,
          sleep: async () => {
            controller.abort();
            throw new ObservationInterruptedError();
          },
        },
        driver: {
          preflight: async () => ({
            isolated: true,
            capacityVerified: true,
            availableSlots: 3,
          }),
          bootstrap: async () => ({
            admissionBinding,
            controlContextBaselineTokens: 100_000,
          }),
        },
      })
    ).rejects.toBeInstanceOf(ObservationInterruptedError);
    expect(
      readObservationCheckpoint(workDir, attemptId, 'control-hit-55m')
    ).toMatchObject({
      state: 'interrupted',
      elapsedMonotonicMs: 0,
    });

    const resumed = await runObservationArm({
      workDir,
      attemptId,
      armId: 'control-hit-55m',
      candidate,
      identity,
      checkpointIntervalMs: 60_000,
      clock: {
        physical: true,
        wallNow: () => new Date(wall),
        monotonicNow: () => monotonic,
        sleep: async (milliseconds: number) => {
          wall += milliseconds;
          monotonic += milliseconds;
        },
      },
      driver: {
        preflight: async () => ({
          isolated: true,
          capacityVerified: true,
          availableSlots: 3,
        }),
        bootstrap: async () => ({
          admissionBinding,
          controlContextBaselineTokens: 100_000,
        }),
        wakeAndReadUsage: async () => ({
          usageCounters: {
            inputTokens: 1,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 90_000,
            outputTokens: 1,
          },
          touchesObserved: 0,
          deadlineApplied: false,
          clockAmbiguous: false,
        }),
      },
    });
    expect(resumed).toMatchObject({
      disposition: 'completed',
      classification: 'cache_hit',
      elapsedMonotonicMs: 55 * 60 * 1000,
    });
    expect(
      readObservationCheckpoint(workDir, attemptId, 'control-hit-55m')
    ).toMatchObject({
      state: 'ready',
      controlContextBaselineTokens: 100_000,
    });
  });

  it('keeps a ready checkpoint ready when resuming after a pre-result crash', async () => {
    const workDir = temporaryDirectory('rasen-physical-ready-resume-');
    const cwd = temporaryDirectory('rasen-physical-ready-resume-cwd-');
    const identity = {
      runId: `run:${'7'.repeat(64)}`,
      sessionKey: 'physical-ready-resume',
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    const start = new Date('2026-07-31T01:00:00.000Z').valueOf();
    const attemptId = createAttemptForArm(
      workDir,
      candidate,
      'control-hit-55m',
      identity,
      () => new Date(start)
    );
    let wall = start;
    let monotonic = 0;
    const clock = {
      physical: true,
      wallNow: () => new Date(wall),
      monotonicNow: () => monotonic,
      sleep: async (milliseconds: number) => {
        wall += milliseconds;
        monotonic += milliseconds;
      },
    };
    const preflight = async () => ({
      isolated: true,
      capacityVerified: true,
      availableSlots: 3,
    });
    await expect(
      runObservationArm({
        workDir,
        attemptId,
        armId: 'control-hit-55m',
        candidate,
        identity,
        checkpointIntervalMs: 55 * 60 * 1000,
        clock,
        driver: {
          preflight,
          bootstrap: async () => ({
            admissionBinding: {
              ...admissionBinding,
              boundAt: new Date(start).toISOString(),
            },
            controlContextBaselineTokens: 100_000,
          }),
          wakeAndReadUsage: async () => {
            throw new ObservationInterruptedError();
          },
        },
      })
    ).rejects.toBeInstanceOf(ObservationInterruptedError);
    expect(
      readObservationCheckpoint(workDir, attemptId, 'control-hit-55m')
    ).toMatchObject({ state: 'ready' });

    const result = await runObservationArm({
      workDir,
      attemptId,
      armId: 'control-hit-55m',
      candidate,
      identity,
      checkpointIntervalMs: 55 * 60 * 1000,
      clock,
      driver: {
        preflight,
        resume: async ({ checkpoint }) => ({
          admissionBinding: checkpoint.admissionBinding,
          controlContextBaselineTokens:
            checkpoint.controlContextBaselineTokens,
        }),
        wakeAndReadUsage: async () => ({
          usageCounters: {
            inputTokens: 2,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 90_000,
            outputTokens: 500,
          },
          touchesObserved: 0,
          deadlineApplied: false,
          clockAmbiguous: false,
        }),
      },
    });
    expect(result).toMatchObject({
      disposition: 'completed',
      classification: 'cache_hit',
    });
    expect(
      readObservationCheckpoint(workDir, attemptId, 'control-hit-55m')
    ).toMatchObject({ state: 'ready' });
    expect(
      validateCompletedObservation(
        workDir,
        attemptId,
        'control-hit-55m'
      )
    ).toMatchObject({ disposition: 'completed' });
  });

  it('measures the control retention window after bootstrap without losing the causal start', async () => {
    const workDir = temporaryDirectory('rasen-physical-bootstrap-clock-');
    const cwd = temporaryDirectory('rasen-physical-bootstrap-clock-cwd-');
    const identity = {
      runId: `run:${'4'.repeat(64)}`,
      sessionKey: 'physical-control-bootstrap-clock',
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    const start = new Date('2026-07-31T01:00:00.000Z').valueOf();
    const bootstrapDurationMs = 10 * 60 * 1000;
    const wakeDurationMs = 10 * 60 * 1000;
    const attemptId = createAttemptForArm(
      workDir,
      candidate,
      'control-hit-55m',
      identity,
      () => new Date(start)
    );
    let wall = start;
    let monotonic = 0;
    const result = await runObservationArm({
      workDir,
      attemptId,
      armId: 'control-hit-55m',
      candidate,
      identity,
      checkpointIntervalMs: 55 * 60 * 1000,
      clock: {
        physical: true,
        wallNow: () => new Date(wall),
        monotonicNow: () => monotonic,
        sleep: async (milliseconds: number) => {
          wall += milliseconds;
          monotonic += milliseconds;
        },
      },
      driver: {
        preflight: async () => ({
          isolated: true,
          capacityVerified: true,
          availableSlots: 3,
        }),
        bootstrap: async () => {
          wall += bootstrapDurationMs;
          monotonic += bootstrapDurationMs;
          return {
            admissionBinding: {
              ...admissionBinding,
              boundAt: new Date(wall).toISOString(),
            },
            controlContextBaselineTokens: 100_000,
          };
        },
        wakeAndReadUsage: async () => {
          wall += wakeDurationMs;
          monotonic += wakeDurationMs;
          return {
            usageCounters: {
              inputTokens: 1,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 90_000,
              outputTokens: 1,
            },
            touchesObserved: 0,
            deadlineApplied: false,
            clockAmbiguous: false,
          };
        },
      },
    });
    expect(result).toMatchObject({
      disposition: 'completed',
      classification: 'cache_hit',
      reasonCode: null,
      startedAt: new Date(start).toISOString(),
      admissionBinding: {
        boundAt: new Date(start + bootstrapDurationMs).toISOString(),
      },
      controlContextBaselineTokens: 100_000,
      elapsedMonotonicMs: 65 * 60 * 1000,
      endedAt: new Date(
        start + bootstrapDurationMs + 55 * 60 * 1000 + wakeDurationMs
      ).toISOString(),
    });
    expect(
      validateCompletedObservation(
        workDir,
        attemptId,
        'control-hit-55m'
      )
    ).toMatchObject({
      disposition: 'completed',
      classification: 'cache_hit',
      elapsedMonotonicMs: 65 * 60 * 1000,
    });
  });

  it('classifies a predominantly rewritten control request as a cache miss', async () => {
    const workDir = temporaryDirectory('rasen-physical-mixed-miss-');
    const cwd = temporaryDirectory('rasen-physical-mixed-miss-cwd-');
    const identity = {
      runId: `run:${'5'.repeat(64)}`,
      sessionKey: 'physical-control-mixed-miss',
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    const start = new Date('2026-07-31T01:00:00.000Z').valueOf();
    const attemptId = createAttemptForArm(
      workDir,
      candidate,
      'control-miss-65m',
      identity,
      () => new Date(start)
    );
    let wall = start;
    let monotonic = 0;
    const result = await runObservationArm({
      workDir,
      attemptId,
      armId: 'control-miss-65m',
      candidate,
      identity,
      checkpointIntervalMs: 65 * 60 * 1000,
      clock: {
        physical: true,
        wallNow: () => new Date(wall),
        monotonicNow: () => monotonic,
        sleep: async (milliseconds: number) => {
          wall += milliseconds;
          monotonic += milliseconds;
        },
      },
      driver: {
        preflight: async () => ({
          isolated: true,
          capacityVerified: true,
          availableSlots: 3,
        }),
        bootstrap: async () => ({
          admissionBinding: {
            ...admissionBinding,
            boundAt: new Date(wall).toISOString(),
          },
          controlContextBaselineTokens: 98_747,
        }),
        wakeAndReadUsage: async () => ({
          usageCounters: {
            inputTokens: 2,
            cacheCreationInputTokens: 77_027,
            cacheReadInputTokens: 21_736,
            outputTokens: 545,
          },
          touchesObserved: 0,
          deadlineApplied: false,
          clockAmbiguous: false,
        }),
      },
    });
    expect(result).toMatchObject({
      disposition: 'completed',
      classification: 'cache_miss_or_rewrite',
      reasonCode: null,
      controlContextBaselineTokens: 98_747,
    });
    expect(
      validateCompletedObservation(
        workDir,
        attemptId,
        'control-miss-65m'
      )
    ).toMatchObject({
      disposition: 'completed',
      classification: 'cache_miss_or_rewrite',
    });
  });

  it('budgets the scheduler deadline beyond bootstrap and the latest valid cadence', () => {
    const preparedAt = new Date('2026-07-31T01:00:00.000Z').valueOf();
    const deadlineAt = derivePhysicalSchedulerDeadlineAt(preparedAt);
    const scheduler = OBSERVATION_ARMS['scheduler-cadence-deadline'];
    const deadlineBudgetMs = new Date(deadlineAt).valueOf() - preparedAt;
    expect(deadlineBudgetMs).toBe(
      PHYSICAL_OPERATION_TIMEOUT_MS
        + scheduler.expectedCadenceMs
        + scheduler.cadenceToleranceMs
        + scheduler.deadlineApplicationToleranceMs
    );
    expect(() =>
      assertPhysicalSchedulerDeadlineFresh(
        deadlineAt,
        preparedAt + scheduler.deadlineApplicationToleranceMs - 1
      )
    ).not.toThrow();
    expect(() =>
      assertPhysicalSchedulerDeadlineFresh(
        deadlineAt,
        preparedAt + scheduler.deadlineApplicationToleranceMs
      )
    ).toThrow(/physical_scheduler_deadline_budget_stale/u);
  });

  it('rejects a stale scheduler config before creating an attempt or observer', () => {
    const workDir = temporaryDirectory('rasen-stale-physical-launch-');
    const operationTimeoutMs = 45 * 60 * 1000;
    const scheduler = OBSERVATION_ARMS['scheduler-cadence-deadline'];
    const deadlineAt = new Date(
      Date.now()
        + PHYSICAL_OPERATION_TIMEOUT_MS
        + scheduler.expectedCadenceMs
        + scheduler.cadenceToleranceMs
        + 60_000
    ).toISOString();
    const armIds = Object.keys(OBSERVATION_ARMS) as Array<
      keyof typeof OBSERVATION_ARMS
    >;
    for (const [index, armId] of armIds.entries()) {
      const cwd = path.join(workDir, `cwd-${index}`);
      fs.mkdirSync(cwd, { recursive: true });
      const automatic = OBSERVATION_ARMS[armId].automaticTouch;
      const configDirectory = path.join(workDir, 'physical', armId);
      fs.mkdirSync(configDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(configDirectory, 'observation-config.json'),
        `${JSON.stringify({
          armId,
          candidate,
          identity: {
            runId: `run:${'6'.repeat(64)}`,
            sessionKey: `stale-launch-${index}`,
            cwd,
            policy: {
              mode: automatic ? 'auto' : 'never',
              deadlineAt: automatic ? deadlineAt : null,
              maxTouches: automatic ? 1 : 0,
              deadlineAction: automatic ? 'retire-silent' : 'stop',
            },
          },
          operationTimeoutMs,
          workDir,
        })}\n`
      );
    }
    const launchPath = path.resolve(
      'scripts',
      'session-cache-acceptance',
      'launch-physical.mjs'
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [launchPath, '--work-dir', workDir],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            RASEN_SESSION_CACHE_REAL_OBSERVATION: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        }
      )
    ).toThrow(/physical_scheduler_deadline_budget_stale/u);
    expect(fs.existsSync(path.join(workDir, 'attempts'))).toBe(false);
  });

  it.each(['before-eligibility', 'late-wait', 'after-touch'] as const)(
    'keeps the original scheduler transcript baseline across %s interruption',
    async (phase) => {
      const workDir = temporaryDirectory(`rasen-scheduler-${phase}-`);
      const cwd = temporaryDirectory(`rasen-scheduler-cwd-${phase}-`);
      const identity = {
        runId: `run:${'7'.repeat(64)}`,
        sessionKey: `scheduler-${phase}`,
        cwd,
        policy: {
          mode: 'auto' as const,
          deadlineAt: '2026-07-31T01:55:00.000Z',
          maxTouches: 1,
          deadlineAction: 'retire-silent' as const,
        },
      };
      const schedulerBaseline = {
        claudeSessionId: 'scheduler-claude',
        transcriptPathFingerprint: '1'.repeat(64),
        transcriptFileIdentityFingerprint: '0'.repeat(64),
        transcriptSize: 128,
        transcriptPrefixFingerprint: '2'.repeat(64),
        capturedAt: '2026-07-31T01:00:00.000Z',
      };
      const schedulerCandidate = {
        ...candidate,
        repositoryRoot: process.cwd(),
      };
      const attemptId = createAttemptForArm(
        workDir,
        schedulerCandidate,
        'scheduler-cadence-deadline',
        identity
      );
      let wall = new Date('2026-07-31T01:00:00.000Z').valueOf();
      let monotonic = 0;
      let sleeps = 0;
      const controller = new AbortController();
      await expect(
        runObservationArm({
          workDir,
          attemptId,
          armId: 'scheduler-cadence-deadline',
          candidate: schedulerCandidate,
          identity,
          signal: controller.signal,
          checkpointIntervalMs:
            phase === 'late-wait' ? 49 * 60 * 1000 : 50 * 60 * 1000,
          clock: {
            physical: false,
            wallNow: () => new Date(wall),
            monotonicNow: () => monotonic,
            sleep: async (milliseconds: number) => {
              sleeps += 1;
              if (
                phase === 'before-eligibility'
                || (phase === 'late-wait' && sleeps === 2)
              ) {
                controller.abort();
                throw new ObservationInterruptedError();
              }
              wall += milliseconds;
              monotonic += milliseconds;
            },
          },
          driver: {
            preflight: async () => ({
              isolated: true,
              capacityVerified: true,
              availableSlots: 3,
            }),
            bootstrap: async () => ({
              admissionBinding,
              schedulerBaseline,
            }),
            inspectScheduler: async () => {
              controller.abort();
              throw new ObservationInterruptedError();
            },
          },
        })
      ).rejects.toBeInstanceOf(ObservationInterruptedError);
      const checkpoint = readObservationCheckpoint(
        workDir,
        attemptId,
        'scheduler-cadence-deadline'
      )!;
      expect(checkpoint.schedulerBaseline).toEqual(schedulerBaseline);
      expect(checkpoint.admissionBinding).toEqual(admissionBinding);
      expect(checkpoint.state).toBe(
        phase === 'after-touch' ? 'ready' : 'interrupted'
      );

      const bootstrap = vi.fn();
      const resume = vi.fn(async ({ checkpoint: current }) => {
        expect(current.schedulerBaseline).toEqual(schedulerBaseline);
        return {
          admissionBinding: current.admissionBinding,
          schedulerBaseline: current.schedulerBaseline,
        };
      });
      const result = await runObservationArm({
        workDir,
        attemptId,
        armId: 'scheduler-cadence-deadline',
        candidate: schedulerCandidate,
        identity,
        checkpointIntervalMs: 50 * 60 * 1000,
        clock: {
          physical: false,
          wallNow: () => new Date(wall),
          monotonicNow: () => monotonic,
          sleep: async (milliseconds: number) => {
            wall += milliseconds;
            monotonic += milliseconds;
          },
        },
        driver: {
          preflight: async () => ({
            isolated: true,
            capacityVerified: true,
            availableSlots: 3,
          }),
          bootstrap,
          resume,
          inspectScheduler: async () => {
            wall = new Date('2026-07-31T01:56:00.000Z').valueOf();
            return {
              usageCounters: null,
              touchesObserved: 0,
              deadlineApplied: false,
              clockAmbiguous: true,
              schedulerEvidence: null,
            };
          },
        },
      });
      expect(result.reasonCode).toBe('deterministic_clock_not_physical');
      expect(bootstrap).not.toHaveBeenCalled();
      expect(resume).toHaveBeenCalledTimes(1);
    }
  );

  function transcriptFixture() {
    const root = temporaryDirectory('rasen-transcript-usage-');
    const rasenHome = path.join(root, 'rasen-home');
    const claudeHome = path.join(root, 'claude-home');
    const cwd = path.join(root, 'workspace');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(rasenHome, { recursive: true });
    fs.mkdirSync(claudeHome, { recursive: true });
    const canonicalCwd = fs.realpathSync.native(cwd);
    const identity = {
      runId: `run:${'4'.repeat(64)}`,
      sessionKey: 'physical-hit',
      cwd: canonicalCwd,
    };
    const runDirectory = identity.runId.replace(/[^a-z0-9]/giu, '_');
    const registryDirectory = path.join(rasenHome, 'runs', runDirectory);
    fs.mkdirSync(registryDirectory, { recursive: true });
    const registryPath = path.join(registryDirectory, 'sessions.json');
    const claudeSessionId = 'exact-claude-session';
    const transcriptDirectory = path.join(
      claudeHome,
      '.claude',
      'projects',
      canonicalCwd.replace(/[:\\/.]/gu, '-')
    );
    fs.mkdirSync(transcriptDirectory, { recursive: true });
    const transcriptPath = path.join(
      transcriptDirectory,
      `${claudeSessionId}.jsonl`
    );
    fs.writeFileSync(
      registryPath,
      `${JSON.stringify({
        schema: 'rasen-session-registry/1',
        runId: identity.runId,
        sessions: [
          {
            sessionKey: identity.sessionKey,
            cwd: canonicalCwd,
            claudeSessionId,
          },
        ],
      })}\n`
    );
    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          id: 'before-message',
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 1,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
        },
      })}\n`
    );
    return {
      rasenHome,
      claudeHome,
      identity,
      registryPath,
      transcriptPath,
    };
  }

  it('extracts only four counters from the newly appended exact-session result', () => {
    const fixture = transcriptFixture();
    const before = captureExactTranscriptState(fixture);
    fs.appendFileSync(
      fixture.transcriptPath,
      `${JSON.stringify({
        type: 'assistant',
        uuid: 'not-persisted',
        message: {
          id: 'also-not-persisted',
          content: [{ type: 'text', text: 'never copied to evidence' }],
          usage: {
            input_tokens: 11,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 101,
            output_tokens: 7,
          },
        },
      })}\n`
    );
    expect(
      extractExactAppendedUsage({ ...fixture, before })
    ).toEqual({
      inputTokens: 11,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 101,
      outputTokens: 7,
    });
  });

  it('classifies the first distinct provider request in one agentic wake', () => {
    const fixture = transcriptFixture();
    const before = captureExactTranscriptState(fixture);
    fs.appendFileSync(
      fixture.transcriptPath,
      [
        {
          type: 'assistant',
          message: {
            id: 'cold-entry-request',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 77_027,
              cache_read_input_tokens: 21_736,
              output_tokens: 1,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'cold-entry-request',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 77_027,
              cache_read_input_tokens: 21_736,
              output_tokens: 545,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'warm-tool-continuation',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 1_080,
              cache_read_input_tokens: 80_826,
              output_tokens: 9,
            },
          },
        },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    expect(
      extractExactAppendedUsage({ ...fixture, before })
    ).toEqual({
      inputTokens: 2,
      cacheCreationInputTokens: 77_027,
      cacheReadInputTokens: 21_736,
      outputTokens: 545,
    });
  });

  it('deduplicates a late repeated block without selecting the middle request', () => {
    const fixture = transcriptFixture();
    const before = captureExactTranscriptState(fixture);
    fs.appendFileSync(
      fixture.transcriptPath,
      [
        {
          type: 'assistant',
          message: {
            id: 'entry-request',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 77_027,
              cache_read_input_tokens: 21_736,
              output_tokens: 1,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'tool-continuation',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 1_080,
              cache_read_input_tokens: 80_826,
              output_tokens: 9,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'entry-request',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 77_027,
              cache_read_input_tokens: 21_736,
              output_tokens: 545,
            },
          },
        },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    expect(
      extractExactAppendedUsage({ ...fixture, before })
    ).toEqual({
      inputTokens: 2,
      cacheCreationInputTokens: 77_027,
      cacheReadInputTokens: 21_736,
      outputTokens: 545,
    });
  });

  it('rejects cache-counter drift within one repeated provider request', () => {
    const fixture = transcriptFixture();
    const before = captureExactTranscriptState(fixture);
    fs.appendFileSync(
      fixture.transcriptPath,
      [
        {
          type: 'assistant',
          message: {
            id: 'drifting-request',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 77_027,
              cache_read_input_tokens: 21_736,
              output_tokens: 1,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'drifting-request',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 1_080,
              cache_read_input_tokens: 80_826,
              output_tokens: 9,
            },
          },
        },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    expect(() =>
      extractExactAppendedUsage({ ...fixture, before })
    ).toThrow(/transcript_usage_identity_drift/u);
  });

  it('captures the last provider request before a synthetic zero-usage row', () => {
    const fixture = transcriptFixture();
    fs.appendFileSync(
      fixture.transcriptPath,
      [
        {
          type: 'assistant',
          message: {
            id: 'bootstrap-first',
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 30,
              output_tokens: 1,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'bootstrap-last',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 77_027,
              cache_read_input_tokens: 21_173,
              output_tokens: 545,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'bootstrap-first',
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 30,
              output_tokens: 9,
            },
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'synthetic-terminal-envelope',
            usage: {
              input_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 0,
            },
          },
        },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    expect(
      captureExactTranscriptContextBaseline(fixture)
    ).toEqual({ contextTokens: 98_747 });
  });

  it('restores the original transcript range after later appends and rejects baseline drift', () => {
    const fixture = transcriptFixture();
    const baseline = captureExactTranscriptBaseline({
      ...fixture,
      capturedAt: '2026-07-31T01:00:00.000Z',
    });
    fs.appendFileSync(
      fixture.transcriptPath,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          id: 'scheduler-touch',
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 2,
            output_tokens: 1,
          },
        },
      })}\n`
    );
    const restored = restoreExactTranscriptBaseline({
      ...fixture,
      baseline,
    });
    expect(restored).toMatchObject({
      size: baseline.transcriptSize,
      capturedAt: baseline.capturedAt,
    });
    const bytes = fs.readFileSync(fixture.transcriptPath);
    bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
    fs.writeFileSync(fixture.transcriptPath, bytes);
    expect(() =>
      restoreExactTranscriptBaseline({ ...fixture, baseline })
    ).toThrow(/baseline_drift/u);
  });

  it('rejects transcript scheduler chains without one exact durable cause', () => {
    const baseTime = Date.now() - 60_000;
    const dispatchFenceAt = new Date(baseTime).toISOString();
    const settledAt = new Date(baseTime + 4_000).toISOString();
    // The real transcript shape: no `result` row, inert bookkeeping rows around
    // the touch. Index 1 is the touch prompt, index 3 the provider reply.
    const buildLines = () => ({
      lines: [
        {
          type: 'queue-operation',
          timestamp: new Date(baseTime + 900).toISOString(),
          operation: 'enqueue',
        },
        {
          type: 'user',
          timestamp: new Date(baseTime + 1_000).toISOString(),
          message: { role: 'user', content: schedulerTouchText },
        },
        {
          type: 'last-prompt',
          timestamp: new Date(baseTime + 1_100).toISOString(),
        },
        {
          type: 'assistant',
          timestamp: new Date(baseTime + 2_000).toISOString(),
          session_id: 'exact-claude-session',
          message: {
            id: 'exact-causal-assistant',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 2,
              output_tokens: 1,
            },
          },
        },
        {
          type: 'queue-operation',
          timestamp: new Date(baseTime + 2_100).toISOString(),
          operation: 'dequeue',
        },
      ] as Array<Record<string, unknown>>,
    });
    const secondProviderRequest = {
      type: 'assistant',
      timestamp: new Date(baseTime + 2_500).toISOString(),
      session_id: 'exact-claude-session',
      message: {
        id: 'a-different-provider-request',
        usage: {
          input_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 5,
          output_tokens: 3,
        },
      },
    };
    const scenarios = [
      {
        name: 'a second distinct provider request is attributed to this touch',
        code: /unrelated_append/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines.push({ ...secondProviderRequest });
        },
      },
      {
        name: 'a second prompt lands inside the same fence',
        code: /unrelated_append/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines.push({
            type: 'user',
            timestamp: new Date(baseTime + 2_500).toISOString(),
            message: { role: 'user', content: 'a second unrelated prompt' },
          });
        },
      },
      {
        name: 'the touch prompt is missing entirely',
        code: /unrelated_append/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines.splice(1, 1);
        },
      },
      {
        name: 'the provider reply is missing entirely',
        code: /unrelated_append/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines.splice(3, 1);
        },
      },
      {
        name: 'the reply precedes the prompt',
        code: /causal_timing_invalid/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines[3] = {
            ...lines[3],
            timestamp: new Date(baseTime + 500).toISOString(),
          };
        },
      },
      {
        name: 'the reply lands after the product settled the touch',
        code: /causal_timing_invalid/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines[3] = {
            ...lines[3],
            timestamp: new Date(baseTime + 9_000).toISOString(),
          };
        },
      },
      {
        name: 'the reply belongs to another Claude session',
        code: /assistant_session_mismatch/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines[3] = { ...lines[3], session_id: 'wrong-session' };
        },
      },
      {
        // A later chunk of the SAME request carrying a foreign session is an
        // internally inconsistent transcript; checking only the first chunk
        // would wave it through.
        name: 'a later chunk of the reply belongs to another Claude session',
        code: /assistant_session_mismatch/u,
        mutate(lines: Array<Record<string, unknown>>) {
          const first = lines[3] as { message: { id: string; usage: unknown } };
          lines.push({
            type: 'assistant',
            timestamp: new Date(baseTime + 2_200).toISOString(),
            session_id: 'wrong-session',
            message: { id: first.message.id, usage: first.message.usage },
          });
        },
      },
      {
        name: 'the prompt is not the touch text',
        code: /touch_text_mismatch/u,
        mutate(lines: Array<Record<string, unknown>>) {
          lines[1] = {
            ...lines[1],
            message: { role: 'user', content: 'unrelated wake' },
          };
        },
      },
    ];
    for (const scenario of scenarios) {
      const fixture = transcriptFixture();
      const before = captureExactTranscriptState(fixture);
      const built = buildLines();
      scenario.mutate(built.lines);
      fs.appendFileSync(
        fixture.transcriptPath,
        built.lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
      );
      expect(
        () =>
          inspectSchedulerTranscriptCausalAppend({
            ...fixture,
            before,
            expected: {
              claudeSessionId: 'exact-claude-session',
              dispatchFenceAt,
              settledAt,
            },
          }),
        scenario.name
      ).toThrow(scenario.code);
    }

    const fixture = transcriptFixture();
    const before = captureExactTranscriptState(fixture);
    const built = buildLines();
    fs.appendFileSync(
      fixture.transcriptPath,
      built.lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    const proof = inspectSchedulerTranscriptCausalAppend({
      ...fixture,
      before,
      expected: {
        claudeSessionId: 'exact-claude-session',
        dispatchFenceAt,
        settledAt,
      },
    }).proof;
    // The bookkeeping rows are counted, never used to reject, and never
    // mistaken for the causal pair.
    expect(proof.transcriptUserRows).toBe(1);
    expect(proof.transcriptProviderRequests).toBe(1);
    expect(JSON.stringify(proof)).not.toContain(schedulerTouchText);
    expect(JSON.stringify(proof)).not.toContain('exact-causal-assistant');
    expect(JSON.stringify(proof)).not.toContain('exact-claude-session');

    // Binding the reply by position rather than by message identity would pick
    // the zero-usage synthetic envelope below -- whose timestamp precedes the
    // prompt -- and silently mis-date the causal chain.
    const decoyFixture = transcriptFixture();
    const decoyBefore = captureExactTranscriptState(decoyFixture);
    const decoyLines = buildLines().lines;
    decoyLines.splice(1, 0, {
      type: 'assistant',
      timestamp: new Date(baseTime + 950).toISOString(),
      session_id: 'exact-claude-session',
      message: {
        id: 'a-synthetic-zero-usage-envelope',
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
        },
      },
    });
    fs.appendFileSync(
      decoyFixture.transcriptPath,
      decoyLines.map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    const decoyProof = inspectSchedulerTranscriptCausalAppend({
      ...decoyFixture,
      before: decoyBefore,
      expected: {
        claudeSessionId: 'exact-claude-session',
        dispatchFenceAt,
        settledAt,
      },
    }).proof;
    expect(decoyProof.transcriptProviderRequests).toBe(1);
    expect(decoyProof.terminalAssistantRows).toBe(2);
    expect(decoyProof.transcriptAssistantAt).toBe(
      new Date(baseTime + 2_000).toISOString()
    );
  });

  it('derives scheduler terminal evidence only from the exact durable deadline touch', async () => {
    const fixture = transcriptFixture();
    const now = Date.now();
    const start = now - 51 * 60 * 1000;
    const admittedAt = start + 50 * 60 * 1000;
    const dispatchedAt = admittedAt + 100;
    const transcriptTouchAt = dispatchedAt + 100;
    const transcriptAssistantAt = transcriptTouchAt + 100;
    const settledAt = transcriptAssistantAt + 200;
    const deadline = start + 55 * 60 * 1000;
    const identity = {
      ...fixture.identity,
      policy: {
        mode: 'auto' as const,
        deadlineAt: new Date(deadline).toISOString(),
        maxTouches: 1,
        deadlineAction: 'retire-silent' as const,
      },
    };
    const baseline = captureExactTranscriptBaseline({
      ...fixture,
      identity,
      capturedAt: new Date(start).toISOString(),
    });
    // The real shape observed in attempt 6a87cec0: Claude Code writes no
    // `result` row into the transcript (0 of 1782 transcripts on the reference
    // machine contain one) and interleaves inert bookkeeping rows around the
    // touch. The causal proof must survive them.
    fs.appendFileSync(
      fixture.transcriptPath,
      [
        {
          type: 'queue-operation',
          timestamp: new Date(transcriptTouchAt - 50).toISOString(),
          operation: 'enqueue',
        },
        {
          type: 'user',
          timestamp: new Date(transcriptTouchAt).toISOString(),
          message: {
            role: 'user',
            content: schedulerTouchText,
          },
        },
        {
          type: 'last-prompt',
          timestamp: new Date(transcriptTouchAt + 10).toISOString(),
        },
        {
          type: 'assistant',
          timestamp: new Date(transcriptAssistantAt).toISOString(),
          session_id: 'exact-claude-session',
          message: {
            id: 'exact-touch-result',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 2,
              output_tokens: 1,
            },
          },
        },
        {
          type: 'queue-operation',
          timestamp: new Date(transcriptAssistantAt + 10).toISOString(),
          operation: 'dequeue',
        },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    const admission = {
      ...admissionBinding,
      boundAt: new Date(start).toISOString(),
    };
    const currentBinding = {
      ...admission,
      boundAt: new Date(settledAt).toISOString(),
    };
    const touch = {
      kind: 'touch',
      outcome: 'completed',
      touchOrdinal: 1,
      touchAttempt: 1,
      messageIdDigest: schedulerMessageIdDigest(identity, 1, 1),
      // The product digests the CLI's stdout result envelope, which never
      // appears as a transcript row, so nothing in the transcript can or
      // should reproduce this value.
      resultDigest: digestJson({
        type: 'result',
        subtype: 'success',
        session_id: 'exact-claude-session',
      }),
      admittedAt: new Date(admittedAt).toISOString(),
      dispatchFenceAt: new Date(dispatchedAt).toISOString(),
      settledAt: new Date(settledAt).toISOString(),
    };
    const preterminalSession = {
      sessionKey: identity.sessionKey,
      cwd: identity.cwd,
      claudeSessionId: 'exact-claude-session',
      status: 'idle',
      owner: {
        ownerInstanceId: currentBinding.ownerInstanceId,
        ownerPid: currentBinding.ownerPid,
        hostId: currentBinding.hostId,
        childPid: currentBinding.childPid,
        boundAt: currentBinding.boundAt,
      },
      touchPolicy: {
        ...identity.policy,
        touchesUsed: 1,
      },
      wakes: [touch],
      lifecycle: {},
    };
    const terminalSession = {
      ...preterminalSession,
      status: 'retired',
      owner: undefined,
      lifecycle: {
        reason: 'touch-deadline-expired',
        retiredAt: new Date(deadline).toISOString(),
      },
    };
    const makeDriver = (
      sessions: unknown[],
      schedulerDelay: () => Promise<void> = async () => undefined
    ) => {
      let reads = 0;
      const readExactSession = vi.fn(() =>
        sessions[Math.min(reads++, sessions.length - 1)]
      );
      return {
        driver: createObservationDriver({
        rasenBin: path.join(identity.cwd, 'rasen.js'),
        actionFile: path.join(identity.cwd, 'action.json'),
        rasenHome: fixture.rasenHome,
        claude: { home: fixture.claudeHome },
        readExactSession,
        schedulerDelay,
        schedulerPollIntervalMs: 1,
        revalidateCandidateState: async () => undefined,
        inspectProcessCreationIdentity: async (pid: number) =>
          pid === admission.ownerPid
            ? admission.ownerProcessCreationIdentity
            : admission.childProcessCreationIdentity,
        }),
        readExactSession,
      };
    };
    const { driver } = makeDriver([
      preterminalSession,
      preterminalSession,
      preterminalSession,
      terminalSession,
      terminalSession,
    ]);
    await driver.resume({
      armId: 'scheduler-cadence-deadline',
      identity,
      checkpoint: {
        admissionBinding: admission,
        schedulerBaseline: baseline,
        schedulerPreterminalOwnerProof: null,
        cadenceToleranceMs: 10 * 60 * 1000,
        deadlineApplicationToleranceMs: 10 * 60 * 1000,
      },
    });
    const persistPreterminalProof = vi.fn();
    const evidence = await driver.inspectScheduler({
      armId: 'scheduler-cadence-deadline',
      identity,
      persistPreterminalProof,
    });
    expect(evidence.schedulerEvidence).toMatchObject({
      touchMessageIdDigest: touch.messageIdDigest,
      touchResultDigest: touch.resultDigest,
      touchSettledAt: touch.settledAt,
      deadlineReason: 'touch-deadline-expired',
      deadlineAction: 'retire-silent',
      configuredDeadlineAt: identity.policy.deadlineAt,
      deadlineAppliedAt: terminalSession.lifecycle.retiredAt,
      completedWakeCountSinceBaseline: 1,
      touchOrdinal: 1,
      touchAttempt: 1,
      terminalAssistantRows: 1,
    });
    expect(persistPreterminalProof).toHaveBeenCalledTimes(1);
    await expect(
      driver.revalidateIdentity({
        armId: 'scheduler-cadence-deadline',
        identity,
        admissionBinding: admission,
        observation: evidence,
      })
    ).resolves.toBeUndefined();

    for (const invalidTerminal of [
      {
        ...terminalSession,
        lifecycle: {
          reason: 'manual-retirement',
          retiredAt: new Date(deadline).toISOString(),
        },
      },
      {
        ...terminalSession,
        status: 'lost',
        lifecycle: {
          reason: 'owner_lost',
          updatedAt: new Date().toISOString(),
        },
      },
    ]) {
      let delays = 0;
      const invalid = makeDriver(
        [
          preterminalSession,
          preterminalSession,
          preterminalSession,
          invalidTerminal,
        ],
        async () => {
          delays += 1;
          if (delays >= 2) throw new Error('negative_terminal_observed');
        }
      );
      const invalidDriver = invalid.driver;
      await invalidDriver.resume({
        armId: 'scheduler-cadence-deadline',
        identity,
        checkpoint: {
          admissionBinding: admission,
          schedulerBaseline: baseline,
          schedulerPreterminalOwnerProof: null,
          cadenceToleranceMs: 10 * 60 * 1000,
          deadlineApplicationToleranceMs: 10 * 60 * 1000,
        },
      });
      await expect(
        invalidDriver.inspectScheduler({
          armId: 'scheduler-cadence-deadline',
          identity,
        })
      ).rejects.toThrow(/negative_terminal_observed/u);
      expect(invalid.readExactSession).toHaveBeenCalledTimes(4);
    }

    const wrongBinding = {
      ...preterminalSession,
      owner: {
        ...preterminalSession.owner,
        hostId: 'wrong-host',
      },
    };
    const wrongBindingDriver = makeDriver([
      preterminalSession,
      wrongBinding,
    ]).driver;
    await wrongBindingDriver.resume({
      armId: 'scheduler-cadence-deadline',
      identity,
      checkpoint: {
        admissionBinding: admission,
        schedulerBaseline: baseline,
        schedulerPreterminalOwnerProof: null,
        cadenceToleranceMs: 10 * 60 * 1000,
        deadlineApplicationToleranceMs: 10 * 60 * 1000,
      },
    });
    await expect(
      wrongBindingDriver.inspectScheduler({
        armId: 'scheduler-cadence-deadline',
        identity,
      })
    ).rejects.toThrow(/owned_process_binding_drift/u);

    const unrelatedDriver = makeDriver([
      preterminalSession,
      {
      ...preterminalSession,
      wakes: [
        touch,
        {
          ...touch,
          kind: 'interactive',
          messageIdDigest: 'a'.repeat(64),
          resultDigest: 'b'.repeat(64),
        },
      ],
      },
    ]).driver;
    await unrelatedDriver.resume({
      armId: 'scheduler-cadence-deadline',
      identity,
      checkpoint: {
        admissionBinding: admission,
        schedulerBaseline: baseline,
        schedulerPreterminalOwnerProof: null,
        cadenceToleranceMs: 10 * 60 * 1000,
        deadlineApplicationToleranceMs: 10 * 60 * 1000,
      },
    });
    await expect(
      unrelatedDriver.inspectScheduler({
        armId: 'scheduler-cadence-deadline',
        identity,
      })
    ).rejects.toThrow(/durable_binding_invalid/u);
  });

  it('persists a production-driver scheduler proof through the observer lifecycle', async () => {
    const workDir = temporaryDirectory('rasen-scheduler-driver-observer-');
    const fixture = transcriptFixture();
    const bootstrapDurationMs = 10 * 60 * 1000;
    const start = Date.now() - 61 * 60 * 1000;
    const baselineStart = start + bootstrapDurationMs;
    const admittedAt = baselineStart + 50 * 60 * 1000;
    const dispatchedAt = admittedAt + 100;
    const transcriptTouchAt = dispatchedAt + 100;
    const transcriptAssistantAt = transcriptTouchAt + 100;
    const settledAt = transcriptAssistantAt + 200;
    const deadline = baselineStart + 55 * 60 * 1000;
    const identity = {
      ...fixture.identity,
      sessionKey: 'physical-hit',
      policy: {
        mode: 'auto' as const,
        deadlineAt: new Date(deadline).toISOString(),
        maxTouches: 1,
        deadlineAction: 'retire-silent' as const,
      },
    };
    const baseline = captureExactTranscriptBaseline({
      ...fixture,
      identity,
      capturedAt: new Date(baselineStart).toISOString(),
    });
    fs.appendFileSync(
      fixture.transcriptPath,
      [
        {
          type: 'queue-operation',
          timestamp: new Date(transcriptTouchAt - 50).toISOString(),
          operation: 'enqueue',
        },
        {
          type: 'user',
          timestamp: new Date(transcriptTouchAt).toISOString(),
          message: { role: 'user', content: schedulerTouchText },
        },
        {
          type: 'last-prompt',
          timestamp: new Date(transcriptTouchAt + 10).toISOString(),
        },
        {
          type: 'assistant',
          timestamp: new Date(transcriptAssistantAt).toISOString(),
          session_id: 'exact-claude-session',
          message: {
            id: 'observer-exact-touch-result',
            usage: {
              input_tokens: 2,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 2,
              output_tokens: 1,
            },
          },
        },
        {
          type: 'queue-operation',
          timestamp: new Date(transcriptAssistantAt + 10).toISOString(),
          operation: 'dequeue',
        },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n'
    );
    const admission = {
      ...admissionBinding,
      boundAt: new Date(start).toISOString(),
    };
    const currentBinding = {
      ...admission,
      boundAt: new Date(settledAt).toISOString(),
    };
    const wake = {
      kind: 'touch',
      outcome: 'completed',
      touchOrdinal: 1,
      touchAttempt: 1,
      messageIdDigest: schedulerMessageIdDigest(identity, 1, 1),
      resultDigest: digestJson({
        type: 'result',
        subtype: 'success',
        session_id: 'exact-claude-session',
      }),
      admittedAt: new Date(admittedAt).toISOString(),
      dispatchFenceAt: new Date(dispatchedAt).toISOString(),
      settledAt: new Date(settledAt).toISOString(),
    };
    const preterminal = {
      sessionKey: identity.sessionKey,
      cwd: identity.cwd,
      claudeSessionId: 'exact-claude-session',
      status: 'idle',
      owner: {
        ownerInstanceId: currentBinding.ownerInstanceId,
        ownerPid: currentBinding.ownerPid,
        hostId: currentBinding.hostId,
        childPid: currentBinding.childPid,
        boundAt: currentBinding.boundAt,
      },
      touchPolicy: {
        ...identity.policy,
        touchesUsed: 1,
      },
      wakes: [wake],
      lifecycle: {},
    };
    const terminal = {
      ...preterminal,
      status: 'retired',
      owner: undefined,
      lifecycle: {
        reason: 'touch-deadline-expired',
        retiredAt: new Date(deadline).toISOString(),
      },
    };
    let wall = start;
    let monotonic = 0;
    let reads = 0;
    const sessions = [
      preterminal,
      preterminal,
      preterminal,
      terminal,
      terminal,
    ];
    const productionDriver = createObservationDriver({
      rasenBin: path.join(identity.cwd, 'rasen.js'),
      actionFile: path.join(identity.cwd, 'action.json'),
      rasenHome: fixture.rasenHome,
      claude: { home: fixture.claudeHome },
      readExactSession: () => {
        const value = sessions[Math.min(reads++, sessions.length - 1)];
        if (value.status === 'retired') wall = deadline;
        return value;
      },
      schedulerDelay: async () => undefined,
      schedulerPollIntervalMs: 1,
      revalidateCandidateState: async () => undefined,
      inspectProcessCreationIdentity: async (pid: number) =>
        pid === admission.ownerPid
          ? admission.ownerProcessCreationIdentity
          : admission.childProcessCreationIdentity,
    });
    const attemptId = createAttemptForArm(
      workDir,
      candidate,
      'scheduler-cadence-deadline',
      identity,
      () => new Date(start)
    );
    const result = await runObservationArm({
      workDir,
      attemptId,
      armId: 'scheduler-cadence-deadline',
      candidate,
      identity,
      clock: {
        physical: true,
        wallNow: () => new Date(wall),
        monotonicNow: () => monotonic,
        sleep: async (milliseconds: number) => {
          wall += milliseconds;
          monotonic += milliseconds;
        },
      },
      driver: {
        preflight: async () => ({
          isolated: true,
          capacityVerified: true,
          availableSlots: 3,
        }),
        bootstrap: async ({
          armId,
          identity: armIdentity,
          cadenceToleranceMs,
          deadlineApplicationToleranceMs,
          persistBootstrapState,
        }: {
          armId: string;
          identity: typeof identity;
          cadenceToleranceMs: number;
          deadlineApplicationToleranceMs: number;
          persistBootstrapState: (state: {
            admissionBinding: typeof admission;
            schedulerBaseline: typeof baseline;
          }) => Promise<void>;
        }) => {
          expect(
            readObservationCheckpoint(
              workDir,
              attemptId,
              'scheduler-cadence-deadline'
            )
          ).toMatchObject({
            state: 'initializing',
            startedAt: new Date(start).toISOString(),
            schedulerBaseline: null,
          });
          wall += bootstrapDurationMs;
          monotonic += bootstrapDurationMs;
          const resumed = await productionDriver.resume({
            armId,
            identity: armIdentity,
            checkpoint: {
              admissionBinding: admission,
              schedulerBaseline: baseline,
              schedulerPreterminalOwnerProof: null,
              cadenceToleranceMs,
              deadlineApplicationToleranceMs,
            },
          });
          await persistBootstrapState(resumed);
          expect(
            readObservationCheckpoint(
              workDir,
              attemptId,
              'scheduler-cadence-deadline'
            )
          ).toMatchObject({
            state: 'waiting',
            startedAt: new Date(start).toISOString(),
            schedulerBaseline: baseline,
          });
          return resumed;
        },
        inspectScheduler: productionDriver.inspectScheduler,
        revalidateIdentity: productionDriver.revalidateIdentity,
      },
    });
    expect(result.reasonCode).toBe(null);
    expect(result).toMatchObject({
      disposition: 'completed',
      classification: 'one_touch_then_deadline',
      touchesObserved: 1,
      deadlineApplied: true,
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(deadline).toISOString(),
      elapsedMonotonicMs: 50 * 60 * 1000,
    });
    expect(reads).toBe(5);
    expect(
      readObservationCheckpoint(
        workDir,
        attemptId,
        'scheduler-cadence-deadline'
      )
    ).toMatchObject({
      startedAt: new Date(start).toISOString(),
      schedulerBaseline: {
        capturedAt: new Date(baselineStart).toISOString(),
      },
      schedulerPreterminalOwnerProof: {
        touchMessageIdDigest: wake.messageIdDigest,
        touchAttempt: 1,
      },
    });
    expect(
      validateCompletedObservation(
        workDir,
        attemptId,
        'scheduler-cadence-deadline'
      )
    ).toMatchObject({
      disposition: 'completed',
      schedulerEvidence: {
        touchResultDigest: wake.resultDigest,
        deadlineAppliedAt: new Date(deadline).toISOString(),
      },
    });
  });

  it('fails closed on wrong identity, symlink, oversize, or changed Claude session', () => {
    const wrong = transcriptFixture();
    const registry = JSON.parse(fs.readFileSync(wrong.registryPath, 'utf8'));
    registry.runId = `run:${'9'.repeat(64)}`;
    fs.writeFileSync(wrong.registryPath, JSON.stringify(registry));
    expect(() => captureExactTranscriptState(wrong)).toThrow(
      /registry_identity_mismatch/u
    );

    const oversized = transcriptFixture();
    fs.truncateSync(
      oversized.transcriptPath,
      transcriptUsageLimits.maxTranscriptBytes + 1
    );
    expect(() => captureExactTranscriptState(oversized)).toThrow(
      /transcript_oversize/u
    );

    const changed = transcriptFixture();
    const before = captureExactTranscriptState(changed);
    const changedRegistry = JSON.parse(
      fs.readFileSync(changed.registryPath, 'utf8')
    );
    changedRegistry.sessions[0].claudeSessionId = 'different-session';
    fs.writeFileSync(changed.registryPath, JSON.stringify(changedRegistry));
    expect(() =>
      extractExactAppendedUsage({ ...changed, before })
    ).toThrow(/claude_session_identity_changed/u);

    const linked = transcriptFixture();
    const target = `${linked.transcriptPath}.target`;
    fs.renameSync(linked.transcriptPath, target);
    try {
      fs.symlinkSync(target, linked.transcriptPath, 'file');
      expect(() => captureExactTranscriptState(linked)).toThrow(
        /transcript_symlink/u
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  });

  it('rejects a tampered capacity proof instead of trusting its verified flag', () => {
    const daemon = {
      pid: 123,
      port: 4141,
      version: '0.2.0',
      commandFingerprint: '6'.repeat(64),
      entrypointFingerprint: '7'.repeat(64),
    };
    const moduleFingerprint = '5'.repeat(64);
    const proof = {
      schema: CAPACITY_SCHEMA,
      candidateFingerprint: candidate.contentFingerprint,
      daemon,
      supervisor: {
        maxProcesses: 3,
        liveProcesses: 0,
        availableSlots: 3,
        moduleFingerprint,
      },
      armIds: [
        'control-hit-55m',
        'control-miss-65m',
        'scheduler-cadence-deadline',
      ],
      sessionKeys: ['hit', 'miss', 'scheduler'],
      observedAt: '2026-07-31T01:00:00.000Z',
    };
    expect(
      verifyCapacityProofDocument(proof, {
        candidate,
        daemon,
        supervisorModuleFingerprint: moduleFingerprint,
      })
    ).toBe(proof);
    expect(() =>
      verifyCapacityProofDocument(
        { ...proof, verified: true },
        {
          candidate,
          daemon,
          supervisorModuleFingerprint: moduleFingerprint,
        }
      )
    ).toThrow(/capacity_proof_invalid/u);
    expect(() =>
      verifyCapacityProofDocument(
        {
          ...proof,
          supervisor: { ...proof.supervisor, availableSlots: 2 },
        },
        {
          candidate,
          daemon,
          supervisorModuleFingerprint: moduleFingerprint,
        }
      )
    ).toThrow(/capacity_proof_invalid/u);
  });

  it('recomputes fresh ordinary and reusable live capacity instead of trusting cached counts', async () => {
    const daemon = {
      pid: 321,
      port: 4321,
      version: '0.2.0',
      commandFingerprint: '6'.repeat(64),
      entrypointFingerprint: '7'.repeat(64),
    };
    const responses = new Map([
      ['/api/v1/status', { pid: daemon.pid, version: daemon.version }],
      [
        '/api/v1/sessions',
        { sessions: [{ session: { state: 'running' } }] },
      ],
      [
        '/api/v1/reusable-sessions?scope=all',
        {
          schema: 'rasen-reusable-session-api/1',
          ok: true,
          operation: 'list',
          sessions: [{ status: 'retired' }],
        },
      ],
    ]);
    const inspect = (requiredAvailableSlots: number) =>
      inspectPhysicalCapacity({
        daemonStatePath: 'injected-state',
        daemon,
        candidate,
        armIds: [],
        sessionKeys: [],
        requiredAvailableSlots,
        readDaemonState: () => ({
          pid: daemon.pid,
          port: daemon.port,
          version: daemon.version,
          token: 'injected-token',
        }),
        commandIdentity: () => ({
          commandFingerprint: daemon.commandFingerprint,
          entrypointFingerprint: daemon.entrypointFingerprint,
        }),
        verifySupervisorBuild: () => ({
          maxProcesses: 3,
          moduleFingerprint: '8'.repeat(64),
        }),
        requestJson: async ({ requestPath }: { requestPath: string }) =>
          responses.get(requestPath),
      });
    await expect(inspect(3)).rejects.toThrow(/capacity_insufficient/u);
    await expect(inspect(2)).resolves.toMatchObject({
      supervisor: {
        maxProcesses: 3,
        liveProcesses: 1,
        availableSlots: 2,
      },
    });
    responses.set('/api/v1/reusable-sessions?scope=all', {
      schema: 'rasen-reusable-session-api/1',
      ok: true,
      operation: 'list',
      sessions: [{ status: 'idle' }],
    });
    await expect(inspect(2)).rejects.toThrow(/capacity_insufficient/u);
  });

  it('retains only a bounded stable CLI code and records its declared product owner', async () => {
    const publicFailure = JSON.stringify({
      schema: 'rasen-session-command/1',
      command: 'exec',
      ok: false,
      ownerMode: 'foreground',
      runId: `run:${'a'.repeat(64)}`,
      sessionKey: 'safe-failure',
      outcome: {
        code: 'invalid_action',
        message: 'contains a private path that must not be retained',
      },
    });
    expect(decodePublicCliFailure(publicFailure)).toEqual({
      safeCode: 'invalid_action',
      gapArea: 'cli_protocol',
    });
    expect(() =>
      decodePublicCliFailure(
        JSON.stringify({
          ...JSON.parse(publicFailure),
          prompt: 'secret prompt',
        })
      )
    ).toThrow(/envelope_invalid/u);
    await expect(
      boundedSpawn(
        process.execPath,
        [
          '-e',
          `process.stdout.write(${JSON.stringify(publicFailure)});`
            + "process.stderr.write('token=must-not-leak');process.exit(2);",
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          timeoutMs: 10_000,
        }
      )
    ).rejects.toMatchObject({
      message: 'invalid_action',
      safeCode: 'invalid_action',
      gapArea: 'cli_protocol',
      acceptanceProductGap: true,
    });
    await expect(
      boundedSpawn(
        process.execPath,
        [
          '-e',
          "process.stdout.write('raw prompt token C:\\\\private');process.exit(2);",
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          timeoutMs: 10_000,
        }
      )
    ).rejects.toMatchObject({
      message: 'cli_failure_envelope_invalid',
      safeCode: 'cli_failure_envelope_invalid',
      gapArea: 'cli_protocol',
      acceptanceProductGap: true,
    });

    const workDir = temporaryDirectory('rasen-cli-gap-');
    const cwd = temporaryDirectory('rasen-cli-gap-cwd-');
    const gapCandidate = { ...candidate, repositoryRoot: process.cwd() };
    const gapIdentity = {
      runId: `run:${'b'.repeat(64)}`,
      sessionKey: 'safe-cli-gap',
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    const attemptId = createAttemptForArm(
      workDir,
      gapCandidate,
      'control-hit-55m',
      gapIdentity
    );
    const result = await runObservationArm({
      workDir,
      attemptId,
      armId: 'control-hit-55m',
      candidate: gapCandidate,
      identity: gapIdentity,
      clock: {
        physical: false,
        wallNow: () => new Date('2026-07-31T01:00:00.000Z'),
        monotonicNow: () => 0,
        sleep: async () => undefined,
      },
      driver: {
        preflight: async () => ({
          isolated: true,
          capacityVerified: true,
          availableSlots: 3,
        }),
        bootstrap: async () =>
          boundedSpawn(
            process.execPath,
            [
              '-e',
              `process.stdout.write(${JSON.stringify(publicFailure)});`
                + 'process.exit(2);',
            ],
            {
              cwd,
              env: process.env,
              timeoutMs: 10_000,
            }
          ),
      },
    });
    expect(result).toMatchObject({
      disposition: 'inconclusive',
      reasonCode: 'invalid_action',
    });
    const productGap = readJsonBounded(path.join(
      observationDirectory(workDir, attemptId, 'control-hit-55m'),
      'product-gap.json'
    ));
    expect(productGap).toEqual(expect.objectContaining({
      owner: 'cli-surface',
      code: 'invalid_action',
    }));
    expect(JSON.stringify(productGap)).not.toMatch(
      /private path|secret prompt|token=/u
    );
  });

  it.each([
    {
      label: 'missing',
      code: 'cli_failure_envelope_missing',
      source: "process.stderr.write('token=missing-secret');process.exit(2);",
    },
    {
      label: 'malformed',
      code: 'cli_failure_envelope_invalid',
      source:
        "process.stdout.write('prompt=C:\\\\private\\\\secret');"
        + 'process.exit(2);',
    },
    {
      label: 'unclassified',
      code: 'cli_failure_code_unclassified',
      source: `process.stdout.write(${JSON.stringify(JSON.stringify({
        schema: 'rasen-session-command/1',
        command: 'exec',
        ok: false,
        runId: `run:${'d'.repeat(64)}`,
        sessionKey: 'unclassified',
        outcome: {
          code: 'new_private_provider_code',
          message: 'bearer secret',
        },
      }))});process.exit(2);`,
    },
    {
      label: 'oversized',
      code: 'cli_failure_envelope_oversize',
      // process.exit() discards a buffered stdout write when stdout is a pipe
      // and writes are asynchronous, which is the case on POSIX but not on
      // Windows. Setting exitCode and returning lets Node flush before exiting,
      // so the parent actually receives the oversize payload on every platform.
      source:
        'process.exitCode = 2;'
        + "process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));",
    },
  ])(
    'routes $label nonzero envelope through the full observer without raw leakage',
    async ({ label, code, source }) => {
      const workDir = temporaryDirectory(`rasen-cli-${label}-`);
      const cwd = temporaryDirectory(`rasen-cli-${label}-cwd-`);
      const gapCandidate = { ...candidate, repositoryRoot: process.cwd() };
      const gapIdentity = {
        runId: `run:${'e'.repeat(64)}`,
        sessionKey: `safe-cli-${label}`,
        cwd,
        policy: {
          mode: 'never' as const,
          deadlineAt: null,
          maxTouches: 0,
          deadlineAction: 'stop' as const,
        },
      };
      const attemptId = createAttemptForArm(
        workDir,
        gapCandidate,
        'control-hit-55m',
        gapIdentity
      );
      const result = await runObservationArm({
        workDir,
        attemptId,
        armId: 'control-hit-55m',
        candidate: gapCandidate,
        identity: gapIdentity,
        clock: {
          physical: false,
          wallNow: () => new Date('2026-07-31T01:00:00.000Z'),
          monotonicNow: () => 0,
          sleep: async () => undefined,
        },
        driver: {
          preflight: async () => ({
            isolated: true,
            capacityVerified: true,
            availableSlots: 3,
          }),
          bootstrap: async () =>
            boundedSpawn(process.execPath, ['-e', source], {
              cwd,
              env: process.env,
              timeoutMs: 10_000,
            }),
        },
      });
      expect(result).toMatchObject({
        disposition: 'inconclusive',
        reasonCode: code,
      });
      const productGap = readJsonBounded(path.join(
        observationDirectory(workDir, attemptId, 'control-hit-55m'),
        'product-gap.json'
      ));
      expect(productGap).toEqual(expect.objectContaining({
        owner: 'cli-surface',
        code,
      }));
      expect(JSON.stringify(productGap)).not.toMatch(
        /missing-secret|private|bearer|provider_code|prompt=/u
      );
    }
  );

  it.each([
    'candidate_tree_drift',
    'candidate_binary_drift',
    'daemon_identity_drift',
    'claude_binary_drift',
    'claude_version_drift',
    'owned_process_binding_drift',
  ])('makes result-time %s inconclusive before commit', async (driftCode) => {
    const workDir = temporaryDirectory(`rasen-result-${driftCode}-`);
    const cwd = temporaryDirectory(`rasen-result-cwd-${driftCode}-`);
    const driftCandidate = { ...candidate, repositoryRoot: process.cwd() };
    const driftIdentity = {
      runId: `run:${'c'.repeat(64)}`,
      sessionKey: `drift-${driftCode}`,
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    const attemptId = createAttemptForArm(
      workDir,
      driftCandidate,
      'control-hit-55m',
      driftIdentity
    );
    let wall = new Date('2026-07-31T01:00:00.000Z').valueOf();
    let monotonic = 0;
    const result = await runObservationArm({
      workDir,
      attemptId,
      armId: 'control-hit-55m',
      candidate: driftCandidate,
      identity: driftIdentity,
      clock: {
        physical: true,
        wallNow: () => new Date(wall),
        monotonicNow: () => monotonic,
        sleep: async (milliseconds: number) => {
          wall += milliseconds;
          monotonic += milliseconds;
        },
      },
      driver: {
        preflight: async () => ({
          isolated: true,
          capacityVerified: true,
          availableSlots: 3,
        }),
        bootstrap: async () => ({
          admissionBinding,
          controlContextBaselineTokens: 100_000,
        }),
        wakeAndReadUsage: async () => ({
          usageCounters: {
            inputTokens: 10,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 10,
            outputTokens: 1,
          },
          touchesObserved: 0,
          deadlineApplied: false,
          clockAmbiguous: false,
        }),
        revalidateIdentity: async () => {
          throw new Error(driftCode);
        },
      },
    });
    expect(result).toMatchObject({
      disposition: 'inconclusive',
      classification: 'ambiguous',
      reasonCode: driftCode,
      usageCounters: null,
    });
  });

  it('captures and compares owner, host, PID, and creation identities at result time', async () => {
    const cwd = temporaryDirectory('rasen-owned-binding-');
    const identity = {
      runId: `run:${'f'.repeat(64)}`,
      sessionKey: 'owned-binding',
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    let childCreation = 'win-created:child-original';
    const session = {
      sessionKey: identity.sessionKey,
      cwd,
      status: 'idle',
      touchPolicy: {
        ...identity.policy,
        touchesUsed: 0,
      },
      owner: {
        ownerInstanceId: 'owner-exact',
        ownerPid: 101,
        hostId: 'host-exact',
        childPid: 202,
        boundAt: '2026-07-31T01:00:00.000Z',
      },
    };
    const driver = createObservationDriver({
      rasenBin: path.join(cwd, 'rasen.js'),
      actionFile: path.join(cwd, 'action.json'),
      rasenHome: cwd,
      readExactSession: async () => session,
      revalidateCandidateState: async () => undefined,
      inspectProcessCreationIdentity: async (pid: number) =>
        pid === 101 ? 'win-created:owner-original' : childCreation,
    });
    const frozen = await driver.captureOwnedProcessBinding(identity);
    await expect(
      driver.requireOwnedProcessBinding(identity, frozen)
    ).resolves.toEqual(frozen);
    await expect(
      driver.revalidateIdentity({
        armId: 'control-hit-55m',
        identity,
        admissionBinding: frozen,
        observation: {
          usageCounters: {
            inputTokens: 1,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 1,
            outputTokens: 1,
          },
        },
      })
    ).resolves.toBeUndefined();
    childCreation = 'win-created:child-reused-pid';
    await expect(
      driver.requireOwnedProcessBinding(identity, frozen)
    ).rejects.toThrow(/owned_process_binding_drift/u);
    await expect(
      driver.revalidateIdentity({
        armId: 'control-hit-55m',
        identity,
        admissionBinding: frozen,
        observation: {
          usageCounters: {
            inputTokens: 1,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 1,
            outputTokens: 1,
          },
        },
      })
    ).rejects.toThrow(/owned_process_binding_drift/u);
  });

  it('prohibits admission-proof resume and terminal observation paths', async () => {
    const root = temporaryDirectory('rasen-admission-proof-terminal-');
    const driver = createObservationDriver({
      rasenBin: path.join(root, 'rasen.js'),
      actionFile: path.join(root, 'action.json'),
      rasenHome: root,
      admissionProofMode: true,
    });
    await expect(
      driver.resume({
        armId: 'control-hit-55m',
        identity: {},
        checkpoint: {},
      })
    ).rejects.toThrow(/admission_proof_resume_prohibited/u);
    await expect(
      driver.wakeAndReadUsage({
        armId: 'control-hit-55m',
        identity: {},
      })
    ).rejects.toThrow(/admission_proof_observation_prohibited/u);
    await expect(
      driver.inspectScheduler({
        armId: 'scheduler-cadence-deadline',
        identity: {},
      })
    ).rejects.toThrow(/admission_proof_observation_prohibited/u);
  });

  it('retires or proves absence only for the exact persisted owner binding', async () => {
    const cwd = temporaryDirectory('rasen-retire-binding-');
    const identity = {
      runId: `run:${'1'.repeat(64)}`,
      sessionKey: 'retire-binding',
      cwd,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    let current: Record<string, unknown> | null = {
      sessionKey: identity.sessionKey,
      cwd,
      status: 'idle',
      touchPolicy: { ...identity.policy, touchesUsed: 0 },
      owner: {
        ownerInstanceId: admissionBinding.ownerInstanceId,
        ownerPid: admissionBinding.ownerPid,
        hostId: admissionBinding.hostId,
        childPid: admissionBinding.childPid,
        boundAt: admissionBinding.boundAt,
      },
      lifecycle: {},
    };
    const retire = vi.fn(async () => {
      current = {
        ...current!,
        status: 'retired',
        owner: undefined,
        lifecycle: { reason: 'candidate-superseded' },
      };
      return { ok: true, session: current };
    });
    const driver = createObservationDriver({
      rasenBin: path.join(cwd, 'rasen.js'),
      actionFile: path.join(cwd, 'action.json'),
      rasenHome: cwd,
      readExactSession: async () => current,
      retireExactSession: retire,
      inspectProcessCreationIdentity: async (pid: number) =>
        pid === admissionBinding.ownerPid
          ? admissionBinding.ownerProcessCreationIdentity
          : admissionBinding.childProcessCreationIdentity,
    });
    await expect(
      driver.retireOrProveAbsent({
        identity,
        admissionBinding: {
          ...admissionBinding,
          boundAt: admissionBinding.boundAt,
        },
      })
    ).resolves.toEqual({ state: 'retired' });
    expect(retire).toHaveBeenCalledTimes(1);
    current = null;
    await expect(
      driver.retireOrProveAbsent({
        identity,
        admissionBinding,
      })
    ).resolves.toEqual({ state: 'absent' });
  });

  it('accepts the Windows NVM dist entry resolved by the exact candidate bin shim', () => {
    const repositoryRoot = temporaryDirectory('rasen-daemon-entry-');
    const binDirectory = path.join(repositoryRoot, 'bin');
    const distDirectory = path.join(repositoryRoot, 'dist', 'cli');
    fs.mkdirSync(binDirectory, { recursive: true });
    fs.mkdirSync(distDirectory, { recursive: true });
    const rasenBin = path.join(binDirectory, 'rasen.js');
    const distEntry = path.join(distDirectory, 'index.js');
    fs.writeFileSync(
      rasenBin,
      "#!/usr/bin/env node\nimport { runCli } from '../dist/cli/index.js';\nrunCli();\n"
    );
    fs.writeFileSync(distEntry, 'export function runCli() {}\n');
    const binaryFiles = ['bin/rasen.js', 'dist/cli/index.js'];
    const binaryFingerprint = hashExactFileSet(
      repositoryRoot,
      binaryFiles
    );
    const commandLine =
      `"C:\\nvm4w\\nodejs\\node.exe" "${distEntry}" daemon run --port 8791`;
    const argv = parseWindowsCommandLine(commandLine);
    expect(argv).toEqual([
      'C:\\nvm4w\\nodejs\\node.exe',
      distEntry,
      'daemon',
      'run',
      '--port',
      '8791',
    ]);
    expect(
      verifyCandidateDaemonArgv({
        platform: 'win32',
        argv,
        repositoryRoot,
        rasenBin,
        binaryFiles,
        binaryFingerprint,
      })
    ).toMatchObject({
      entrypointKind: 'dist-entry',
      entrypointFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('rejects foreign, alternate, disguised, symlinked, or fingerprint-drifted daemon entries', () => {
    const repositoryRoot = temporaryDirectory('rasen-daemon-negative-');
    const binDirectory = path.join(repositoryRoot, 'bin');
    const distDirectory = path.join(repositoryRoot, 'dist', 'cli');
    fs.mkdirSync(binDirectory, { recursive: true });
    fs.mkdirSync(distDirectory, { recursive: true });
    const rasenBin = path.join(binDirectory, 'rasen.js');
    const distEntry = path.join(distDirectory, 'index.js');
    const alternateEntry = path.join(distDirectory, 'alternate.js');
    const disguisedEntry = `${distEntry}.evil`;
    fs.writeFileSync(
      rasenBin,
      "#!/usr/bin/env node\nimport { runCli } from '../dist/cli/index.js';\nrunCli();\n"
    );
    fs.writeFileSync(distEntry, 'export function runCli() {}\n');
    fs.writeFileSync(alternateEntry, 'export function runCli() {}\n');
    fs.writeFileSync(disguisedEntry, 'export function runCli() {}\n');
    const binaryFiles = ['bin/rasen.js', 'dist/cli/index.js'];
    const binaryFingerprint = hashExactFileSet(
      repositoryRoot,
      binaryFiles
    );
    const verify = (entry: string, fingerprint = binaryFingerprint) =>
      verifyCandidateDaemonArgv({
        platform: 'win32',
        argv: ['C:\\nvm4w\\nodejs\\node.exe', entry, 'daemon', 'run'],
        repositoryRoot,
        rasenBin,
        binaryFiles,
        binaryFingerprint: fingerprint,
      });
    expect(() => verify(alternateEntry)).toThrow(
      /daemon_candidate_binary_mismatch/u
    );
    expect(() => verify(disguisedEntry)).toThrow(
      /daemon_candidate_binary_mismatch/u
    );

    const foreignRoot = temporaryDirectory('rasen-daemon-foreign-');
    const foreignEntry = path.join(foreignRoot, 'dist', 'cli', 'index.js');
    fs.mkdirSync(path.dirname(foreignEntry), { recursive: true });
    fs.writeFileSync(foreignEntry, 'export function runCli() {}\n');
    expect(() => verify(foreignEntry)).toThrow(
      /daemon_candidate_binary_mismatch/u
    );
    expect(() => verify(distEntry, '0'.repeat(64))).toThrow(
      /daemon_candidate_binary_fingerprint_mismatch/u
    );

    const symlinkTarget = `${distEntry}.target`;
    fs.renameSync(distEntry, symlinkTarget);
    try {
      fs.symlinkSync(symlinkTarget, distEntry, 'file');
      expect(() => verify(distEntry)).toThrow(/daemon_dist_entry_symlink/u);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  });

  it('creates an exact canonical Run and frozen admitted action through production entry points', async () => {
    const root = temporaryDirectory('rasen-physical-prepare-');
    const rasenHome = path.join(root, 'rasen-home');
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(rasenHome, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    execFileSync('git', ['init', '--quiet'], {
      cwd: workspace,
      stdio: 'ignore',
      windowsHide: true,
    });
    const prepared = await createAdmittedAction({
      repositoryRoot: process.cwd(),
      rasenHome,
      candidate,
      armId: 'control-hit-55m',
      workspace: fs.realpathSync.native(workspace),
    });
    expect(prepared.runId).toMatch(/^run:[a-f0-9]{64}$/u);
    expect(prepared.action).toMatchObject({
      kind: 'agent',
      runId: prepared.runId,
      agent: {
        runtime: 'claude',
        session: { reuse: 'same-invocation' },
      },
    });
    const runDirectory = prepared.runId.replace(/[^a-z0-9]/giu, '_');
    expect(
      fs.readdirSync(path.join(rasenHome, 'runs', runDirectory))
        .some((entry) => /^record-v\d+\.json$/u.test(entry))
    ).toBe(true);
  });
});

describe('selected-executable fingerprint bounds', () => {
  const temporaryPaths: string[] = [];

  function temporaryDirectory(label: string) {
    const created = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), label))
    );
    temporaryPaths.push(created);
    return created;
  }

  afterEach(async () => {
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  it('keeps the evidence default at 256 MiB and gives executables a larger finite bound', () => {
    expect(MAX_EVIDENCE_FINGERPRINT_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_EXECUTABLE_FINGERPRINT_BYTES)
      .toBeGreaterThan(MAX_EVIDENCE_FINGERPRINT_BYTES);
    expect(Number.isSafeInteger(MAX_EXECUTABLE_FINGERPRINT_BYTES)).toBe(true);
  });

  it('hashes a multi-chunk file identically to a single-shot digest', () => {
    const directory = temporaryDirectory('rasen-fingerprint-chunk-');
    const target = path.join(directory, 'multi-chunk.bin');
    // Larger than the 1 MiB read chunk, and deliberately not a chunk multiple
    // so the final short read is exercised.
    const payload = Buffer.alloc(3 * 1024 * 1024 + 7, 0);
    for (let offset = 0; offset < payload.length; offset += 4096) {
      payload.writeUInt32LE(offset >>> 2, offset);
    }
    fs.writeFileSync(target, payload);
    expect(sha256File(target)).toBe(
      createHash('sha256').update(payload).digest('hex')
    );
  });

  it('refuses a file past the supplied bound', () => {
    const directory = temporaryDirectory('rasen-fingerprint-bound-');
    const target = path.join(directory, 'bounded.bin');
    fs.writeFileSync(target, Buffer.alloc(2048, 1));
    expect(() => sha256File(target, 1024)).toThrow('fingerprint_file_oversize');
    expect(sha256File(target, 2048)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('fingerprints an oversize selected executable through the approved helper', () => {
    // Regression: Claude Code 2.1.222 ships a 266 MiB single-file native binary.
    // Under the evidence default this failed closed with fingerprint_file_oversize
    // and no physical acceptance run could be prepared at all.
    const directory = temporaryDirectory('rasen-selected-executable-');
    const target = path.join(directory, 'oversize-executable.bin');
    const descriptor = fs.openSync(target, 'w');
    try {
      fs.ftruncateSync(descriptor, MAX_EVIDENCE_FINGERPRINT_BYTES + 1);
    } finally {
      fs.closeSync(descriptor);
    }
    expect(fs.statSync(target).size).toBe(MAX_EVIDENCE_FINGERPRINT_BYTES + 1);
    expect(() => sha256File(target)).toThrow('fingerprint_file_oversize');
    expect(fingerprintSelectedExecutable(target)).toBe(
      sha256File(target, MAX_EXECUTABLE_FINGERPRINT_BYTES)
    );
  });

  it('keeps the executable bound consumed in exactly one place', () => {
    // The helper is the only choke point, so its own bound has to stay pinned:
    // widening it here would reopen the hole everywhere at once.
    const source = fs
      .readFileSync(
        path.join(
          process.cwd(),
          'scripts',
          'session-cache-acceptance',
          'physical-preflight.mjs'
        ),
        'utf8'
      )
      .replace(/\s+/gu, '');
    expect(
      source.split('sha256File(filePath,MAX_EXECUTABLE_FINGERPRINT_BYTES)').length - 1
    ).toBe(1);
    expect(MAX_EXECUTABLE_FINGERPRINT_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });

  it('lets no harness module fingerprint a Claude executable directly', () => {
    // Directory-wide, not an enumerated file list: a new module must not be
    // able to reopen this bug class with zero coverage. sha256File stays
    // exported for legitimate evidence and module fingerprints, so the
    // invariant is narrower than "never call sha256File" -- it is "never hand
    // sha256File something that names a Claude executable", under any bound.
    const harnessDirectory = path.join(
      process.cwd(),
      'scripts',
      'session-cache-acceptance'
    );
    const modules = fs
      .readdirSync(harnessDirectory)
      .filter((entry) => entry.endsWith('.mjs'));
    expect(modules.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const module of modules) {
      const source = fs
        .readFileSync(path.join(harnessDirectory, module), 'utf8')
        .replace(/\s+/gu, '');
      for (const match of source.matchAll(/sha256File\(([^,)]*)/gu)) {
        if (/claude/iu.test(match[1])) offenders.push(`${module}: ${match[0]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes every selected-Claude fingerprint through the approved helper', () => {
    // Positive counterpart: the known call sites must actually still be there,
    // so the invariant above cannot be satisfied by deleting the checks.
    const callSites = [
      {
        module: 'prepare-physical.mjs',
        binaryExpression: 'claudeBinary',
        expectedHelperCalls: 1,
      },
      {
        module: 'rasen-cli-driver.mjs',
        binaryExpression: 'config.claude.binaryPath',
        expectedHelperCalls: 2,
      },
    ];
    for (const site of callSites) {
      const source = fs
        .readFileSync(
          path.join(
            process.cwd(),
            'scripts',
            'session-cache-acceptance',
            site.module
          ),
          'utf8'
        )
        .replace(/\s+/gu, '');
      const helperCalls = source.split(
        `fingerprintSelectedExecutable(${site.binaryExpression})`
      ).length - 1;
      expect(helperCalls).toBe(site.expectedHelperCalls);
    }
  });
});
