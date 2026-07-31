import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCEPTANCE_V2_SCHEMA,
  ATTEMPT_INTENT_SCHEMA,
  ATTEMPT_SUMMARY_SCHEMA,
  EXPECTED_FAIL_CLOSED_PIPELINES,
  OBSERVATION_ARMS,
  OBSERVATION_CHECKPOINT_SCHEMA,
  OBSERVATION_RESULT_SCHEMA,
  REQUIRED_CI_JOBS,
  SUPPORTED_PIPELINES,
  acceptanceRunV2Path,
  attemptDirectory,
  attemptIntentPath,
  attemptSummaryPath,
  auditAcceptanceOwnership,
  authorizeParentDelivery,
  catalogLegacyHistory,
  classifyControlUsage,
  ciEvidencePath,
  collectSuccessfulCiEvidence,
  createObservationAttempt,
  finalizeAcceptanceAttempt,
  observationDirectory,
  readAcceptanceRunV2,
  readAttemptIntent,
  readAttemptSummary,
  readJsonBounded,
  readObservationCheckpoint,
  recordLocalEvidence,
  recordObservationResult,
  recordParentDelivery,
  reuseCompletedObservation,
  seedPendingCiEvidence,
  validateAcceptanceRunV2,
  validateCompletedObservation,
  validateCurrentLocalEvidence,
  validateObservationCheckpoint,
  validateObservationResult,
  writeAttemptSummary,
  writeJsonCreateOnce,
  writeObservationCheckpoint,
  writeObservationLog,
} from '../../../scripts/session-cache-acceptance/protocol.mjs';
import {
  runObservationArm,
} from '../../../scripts/session-cache-acceptance/observation-harness.mjs';
import {
  hashExactFileSet,
  sha256File,
} from '../../../scripts/session-cache-acceptance/physical-preflight.mjs';
import { writeDaemonState } from '../../../src/core/management-api/daemon-state.js';
import { startManagementServer } from '../../../src/core/management-api/server.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';
import { createCanonicalAcceptanceRun } from './fixtures.js';

const execFileAsync = promisify(execFile);
const protocolUrl = pathToFileURL(path.resolve(
  'scripts/session-cache-acceptance/protocol.mjs'
)).href;

function repositoryBinaryFiles(repositoryRoot: string) {
  const files = ['bin/rasen.js', 'package.json'];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(
          path.relative(repositoryRoot, absolute).replace(/\\/gu, '/')
        );
      }
    }
  };
  walk(path.join(repositoryRoot, 'dist'));
  return files.sort();
}

const candidate = {
  contentFingerprint: 'a'.repeat(64),
  binaryFingerprint: 'b'.repeat(64),
  repositoryRoot: process.cwd(),
  createdAt: '2026-07-31T01:00:00.000Z',
  baselineSha: 'c'.repeat(40),
  treeOid: 'd'.repeat(40),
  deliveryManifestFingerprint: 'e'.repeat(64),
};
const admissionBinding = {
  ownerInstanceId: 'acceptance-owner',
  ownerPid: 101,
  ownerProcessCreationIdentity: 'win-created:1001',
  hostId: 'acceptance-host',
  childPid: 202,
  childProcessCreationIdentity: 'win-created:2002',
  boundAt: '2026-07-31T01:00:00.000Z',
};
const fixedNow = () => new Date('2026-07-31T01:00:00.000Z');

function digestJson(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function armIdentities(root = process.cwd()) {
  const runId = `run:${'f'.repeat(64)}`;
  return {
    'control-hit-55m': {
      runId,
      sessionKey: 'immutable-hit',
      cwd: root,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    },
    'control-miss-65m': {
      runId,
      sessionKey: 'immutable-miss',
      cwd: root,
      policy: {
        mode: 'never' as const,
        deadlineAt: null,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    },
    'scheduler-cadence-deadline': {
      runId,
      sessionKey: 'immutable-scheduler',
      cwd: root,
      policy: {
        mode: 'auto' as const,
        deadlineAt: '2026-07-31T01:55:00.000Z',
        maxTouches: 1,
        deadlineAction: 'retire-silent' as const,
      },
    },
  };
}

function createAttempt(root: string, identities = armIdentities()) {
  return createObservationAttempt(
    root,
    { candidate, arms: identities },
    fixedNow
  );
}

function completedResult(
  attemptId: string,
  armId: keyof typeof OBSERVATION_ARMS,
  identities = armIdentities()
) {
  const scheduler = armId === 'scheduler-cadence-deadline';
  const miss = armId === 'control-miss-65m';
  const elapsed = scheduler
    ? 56 * 60 * 1000
    : miss
      ? 65 * 60 * 1000
      : 55 * 60 * 1000;
  const endedAt = new Date(
    new Date('2026-07-31T01:00:00.000Z').valueOf() + elapsed
  ).toISOString();
  const identity = identities[armId];
  const touchAttempt = 1;
  const messageIdHash = digestJson({
    runId: identity.runId,
    sessionKey: identity.sessionKey,
    ordinal: 1,
    attempt: touchAttempt,
  });
  const messageId = `rasen-touch-v1-${messageIdHash}`;
  const touchMessageIdDigest = createHash('sha256')
    .update(
      `rasen-session-message-id/1\0${Buffer.byteLength(messageId, 'utf8')}:`,
      'utf8'
    )
    .update(messageId, 'utf8')
    .digest('hex');
  const touchText =
    'Keepalive touch. Reply with exactly: OK. Do not use any tools.';
  const transcriptTouchTextDigest = createHash('sha256')
    .update(
      `rasen-session-cache-touch-text/1\0${Buffer.byteLength(touchText, 'utf8')}:`,
      'utf8'
    )
    .update(touchText, 'utf8')
    .digest('hex');
  const claudeSessionId = 'scheduler-claude';
  const claudeSessionIdDigest = createHash('sha256')
    .update(claudeSessionId, 'utf8')
    .digest('hex');
  const admissionBindingFingerprint = digestJson({
    ownerInstanceId: admissionBinding.ownerInstanceId,
    ownerPid: admissionBinding.ownerPid,
    ownerProcessCreationIdentity:
      admissionBinding.ownerProcessCreationIdentity,
    hostId: admissionBinding.hostId,
    childPid: admissionBinding.childPid,
    childProcessCreationIdentity:
      admissionBinding.childProcessCreationIdentity,
  });
  const preterminal = {
    admissionBindingFingerprint,
    ownerBindingFingerprint: digestJson({
      ...admissionBinding,
      boundAt: '2026-07-31T01:50:05.000Z',
    }),
    claudeSessionIdDigest,
    touchMessageIdDigest,
    touchOrdinal: 1 as const,
    touchAttempt,
    touchSettledAt: '2026-07-31T01:50:05.000Z',
    observedAt: '2026-07-31T01:50:06.000Z',
  };
  const preterminalOwnerProofFingerprint = digestJson(preterminal);
  const terminalLogicalSessionFingerprint = digestJson({
    runId: identity.runId,
    sessionKey: identity.sessionKey,
    cwd: path.resolve(identity.cwd),
    claudeSessionId,
  });
  const touchResultDigest = '1'.repeat(64);
  const transcriptAssistantChainFingerprint = '2'.repeat(64);
  const touchTranscriptBindingFingerprint = digestJson({
    runId: identity.runId,
    sessionKey: identity.sessionKey,
    claudeSessionIdDigest,
    touchOrdinal: 1,
    touchAttempt,
    touchMessageIdDigest,
    transcriptTouchTextDigest,
    touchAt: '2026-07-31T01:50:00.000Z',
    touchDispatchedAt: '2026-07-31T01:50:00.500Z',
    transcriptTouchAt: '2026-07-31T01:50:01.000Z',
    transcriptAssistantAt: '2026-07-31T01:50:02.000Z',
    transcriptResultAt: '2026-07-31T01:50:03.000Z',
    touchSettledAt: '2026-07-31T01:50:05.000Z',
    touchResultDigest,
    transcriptResultDigest: touchResultDigest,
    transcriptAssistantChainFingerprint,
    preterminalOwnerProofFingerprint,
    terminalLogicalSessionFingerprint,
  });
  const schedulerCheckpoint = {
    schema: OBSERVATION_CHECKPOINT_SCHEMA,
    attemptId,
    candidate,
    armId,
    identity,
    admissionBinding,
    schedulerBaseline: scheduler
      ? {
          claudeSessionId,
          transcriptPathFingerprint: '3'.repeat(64),
          transcriptFileIdentityFingerprint: '4'.repeat(64),
          transcriptSize: 100,
          transcriptPrefixFingerprint: '5'.repeat(64),
          capturedAt: '2026-07-31T01:00:00.000Z',
        }
      : null,
    controlContextBaselineTokens: scheduler ? null : 100_000,
    schedulerPreterminalOwnerProof: scheduler ? preterminal : null,
    startedAt: '2026-07-31T01:00:00.000Z',
    cadenceToleranceMs: scheduler
      ? OBSERVATION_ARMS['scheduler-cadence-deadline'].cadenceToleranceMs
      : null,
    deadlineApplicationToleranceMs: scheduler
      ? OBSERVATION_ARMS['scheduler-cadence-deadline']
          .deadlineApplicationToleranceMs
      : null,
    targetElapsedMs: OBSERVATION_ARMS[armId].minimumElapsedMs,
    elapsedMonotonicMs: elapsed,
    state: 'ready' as const,
    updatedAt: endedAt,
  };
  const result = {
    schema: OBSERVATION_RESULT_SCHEMA,
    attemptId,
    candidate,
    armId,
    identity,
    admissionBinding,
    startedAt: '2026-07-31T01:00:00.000Z',
    endedAt,
    elapsedMonotonicMs: elapsed,
    physicalElapsed: true,
    controlContextBaselineTokens: scheduler ? null : 100_000,
    usageCounters: scheduler
      ? null
      : {
          inputTokens: 2,
          cacheCreationInputTokens: miss ? 90_000 : 0,
          cacheReadInputTokens: miss ? 0 : 90_000,
          outputTokens: 500,
        },
    touchesObserved: scheduler ? 1 : 0,
    deadlineApplied: scheduler,
    schedulerEvidence: scheduler
      ? {
          eligibilityAt: '2026-07-31T01:00:00.000Z',
          touchAt: '2026-07-31T01:50:00.000Z',
          expectedCadenceMs:
            OBSERVATION_ARMS['scheduler-cadence-deadline'].expectedCadenceMs,
          cadenceToleranceMs:
            OBSERVATION_ARMS['scheduler-cadence-deadline']
              .cadenceToleranceMs,
          deadlineApplicationToleranceMs:
            OBSERVATION_ARMS['scheduler-cadence-deadline']
              .deadlineApplicationToleranceMs,
          transcriptPathFingerprint: '3'.repeat(64),
          transcriptFileIdentityFingerprint: '4'.repeat(64),
          transcriptSizeBefore: 100,
          transcriptSizeAfter: 200,
          transcriptAppendedBytes: 100,
          transcriptAppendFingerprint: '6'.repeat(64),
          terminalAssistantRows: 1 as const,
          completedWakeCountSinceBaseline: 1 as const,
          touchOrdinal: 1 as const,
          touchAttempt,
          touchesUsed: 1 as const,
          touchMessageIdDigest,
          touchResultDigest,
          transcriptTouchTextDigest,
          transcriptAssistantChainFingerprint,
          transcriptResultDigest: touchResultDigest,
          transcriptTouchAt: '2026-07-31T01:50:01.000Z',
          transcriptAssistantAt: '2026-07-31T01:50:02.000Z',
          transcriptResultAt: '2026-07-31T01:50:03.000Z',
          touchDispatchedAt: '2026-07-31T01:50:00.500Z',
          claudeSessionIdDigest,
          preterminalOwnerProofFingerprint,
          terminalLogicalSessionFingerprint,
          touchTranscriptBindingFingerprint,
          touchSettledAt: '2026-07-31T01:50:05.000Z',
          deadlineReason: 'touch-deadline-expired' as const,
          deadlineAction: 'retire-silent' as const,
          configuredDeadlineAt: '2026-07-31T01:55:00.000Z',
          deadlineAppliedAt: '2026-07-31T01:55:00.000Z',
        }
      : null,
    classification: scheduler
      ? 'one_touch_then_deadline' as const
      : miss
        ? 'cache_miss_or_rewrite' as const
        : 'cache_hit' as const,
    disposition: 'completed' as const,
    reasonCode: null,
    provenance: { kind: 'observed' as const },
  };
  return { result, schedulerCheckpoint };
}

function writeCompletedCheckpointChain(
  root: string,
  attemptId: string,
  armId: keyof typeof OBSERVATION_ARMS,
  readyCheckpoint: ReturnType<typeof completedResult>['schedulerCheckpoint']
) {
  writeObservationCheckpoint(root, attemptId, armId, {
    ...readyCheckpoint,
    admissionBinding: null,
    schedulerBaseline: null,
    controlContextBaselineTokens: null,
    schedulerPreterminalOwnerProof: null,
    elapsedMonotonicMs: 0,
    state: 'initializing',
    updatedAt: readyCheckpoint.startedAt,
  });
  writeObservationCheckpoint(root, attemptId, armId, {
    ...readyCheckpoint,
    schedulerPreterminalOwnerProof: null,
    elapsedMonotonicMs: 0,
    state: 'waiting',
    updatedAt: readyCheckpoint.startedAt,
  });
  return writeObservationCheckpoint(
    root,
    attemptId,
    armId,
    readyCheckpoint
  );
}

function settleAttempt(
  root: string,
  attemptId: string,
  identities = armIdentities()
) {
  for (const armId of Object.keys(OBSERVATION_ARMS) as Array<
    keyof typeof OBSERVATION_ARMS
  >) {
    const { result, schedulerCheckpoint } =
      completedResult(attemptId, armId, identities);
    writeCompletedCheckpointChain(
      root,
      attemptId,
      armId,
      schedulerCheckpoint
    );
    recordObservationResult(root, attemptId, result);
  }
  return writeAttemptSummary(root, attemptId, {
    launcherExits: Object.keys(OBSERVATION_ARMS).map((armId) => ({
      armId,
      code: 0,
    })),
  }, () => new Date('2026-07-31T01:56:00.000Z'));
}

describe('immutable session-cache acceptance generations', () => {
  const temporaryPaths: string[] = [];

  function workDir(label = 'rasen-immutable-attempt-') {
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

  it('publishes immutable named policies and rejects jointly tampered constants', () => {
    expect(SUPPORTED_PIPELINES).toEqual([
      'bug-fix',
      'small-feature',
      'full-feature',
      'goal-loop-measure',
      'goal-loop-evaluate',
      'goal-loop-research',
    ]);
    expect(EXPECTED_FAIL_CLOSED_PIPELINES).toEqual(['auto-decompose']);
    expect(REQUIRED_CI_JOBS).toHaveLength(5);
    expect(OBSERVATION_ARMS['scheduler-cadence-deadline']).toMatchObject({
      cadenceToleranceMs: 5 * 60 * 1000,
      deadlineApplicationToleranceMs: 10 * 60 * 1000,
    });

    const root = workDir();
    const attempt = createAttempt(root);
    const { result, schedulerCheckpoint } = completedResult(
      attempt.attemptId,
      'scheduler-cadence-deadline'
    );
    const tamperedResult = structuredClone(result);
    const tamperedCheckpoint = structuredClone(schedulerCheckpoint);
    tamperedResult.schedulerEvidence!.cadenceToleranceMs = 6 * 60 * 1000;
    tamperedResult.schedulerEvidence!.deadlineApplicationToleranceMs =
      11 * 60 * 1000;
    tamperedCheckpoint.cadenceToleranceMs = 6 * 60 * 1000;
    tamperedCheckpoint.deadlineApplicationToleranceMs = 11 * 60 * 1000;
    expect(() => validateObservationResult(tamperedResult)).toThrow(
      /OBSERVATION_ARMS/u
    );
    expect(() => validateObservationCheckpoint({
      ...tamperedCheckpoint,
      sequence: 1,
    })).toThrow(/OBSERVATION_ARMS/u);
  });

  it.each([
    {
      label: 'exact hit threshold',
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 15_000,
        cacheReadInputTokens: 85_000,
        outputTokens: 0,
      },
      expected: 'cache_hit',
    },
    {
      label: 'just below hit threshold',
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 15_000,
        cacheReadInputTokens: 84_999,
        outputTokens: 0,
      },
      expected: 'ambiguous',
    },
    {
      label: 'exact rewrite threshold',
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 70_000,
        cacheReadInputTokens: 30_000,
        outputTokens: 0,
      },
      expected: 'cache_miss_or_rewrite',
    },
    {
      label: 'just below rewrite threshold',
      usage: {
        inputTokens: 30_001,
        cacheCreationInputTokens: 69_999,
        cacheReadInputTokens: 0,
        outputTokens: 0,
      },
      expected: 'ambiguous',
    },
    {
      label: 'collapsed apparent hit',
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 15,
        cacheReadInputTokens: 85,
        outputTokens: 0,
      },
      expected: 'ambiguous',
    },
    {
      label: 'collapsed apparent rewrite',
      usage: {
        inputTokens: 30,
        cacheCreationInputTokens: 70,
        cacheReadInputTokens: 0,
        outputTokens: 0,
      },
      expected: 'ambiguous',
    },
    {
      label: 'undersized bootstrap context',
      baseline: 29_999,
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 100_000,
        outputTokens: 0,
      },
      expected: 'ambiguous',
    },
  ])(
    'classifies $label against the persisted bootstrap context',
    (testCase) => {
      const baseline = 'baseline' in testCase
        ? testCase.baseline
        : 100_000;
      expect(classifyControlUsage(testCase.usage, baseline))
        .toBe(testCase.expected);
    }
  );

  it('writes one immutable intent and disjoint create-once arm files without a ledger', () => {
    const root = workDir();
    const attempt = createAttempt(root);
    expect(attempt.schema).toBe(ATTEMPT_INTENT_SCHEMA);
    expect(fs.existsSync(acceptanceRunV2Path(root))).toBe(false);
    expect(readAttemptIntent(root, attempt.attemptId)).toEqual(attempt);

    const hit = completedResult(attempt.attemptId, 'control-hit-55m').result;
    const miss = completedResult(attempt.attemptId, 'control-miss-65m').result;
    recordObservationResult(root, attempt.attemptId, hit);
    recordObservationResult(root, attempt.attemptId, miss);
    writeObservationLog(root, attempt.attemptId, 'control-hit-55m', [
      {
        at: hit.endedAt,
        event: 'arm_settled',
        code: null,
      },
    ]);
    expect(
      path.dirname(path.join(
        observationDirectory(root, attempt.attemptId, 'control-hit-55m'),
        'result.json'
      ))
    ).not.toBe(
      observationDirectory(root, attempt.attemptId, 'control-miss-65m')
    );
    expect(() =>
      recordObservationResult(root, attempt.attemptId, hit)
    ).toThrow(/already_exists/u);
    expect(fs.existsSync(acceptanceRunV2Path(root))).toBe(false);
  });

  it('finalizes a control miss whose first request predominantly rewrites the cache', () => {
    const root = workDir('rasen-mixed-cache-miss-');
    const attempt = createAttempt(root);
    for (const armId of Object.keys(OBSERVATION_ARMS) as Array<
      keyof typeof OBSERVATION_ARMS
    >) {
      const { result, schedulerCheckpoint } = completedResult(
        attempt.attemptId,
        armId
      );
      if (armId === 'control-miss-65m') {
        result.controlContextBaselineTokens = 98_747;
        schedulerCheckpoint.controlContextBaselineTokens = 98_747;
        result.usageCounters = {
          inputTokens: 2,
          cacheCreationInputTokens: 77_027,
          cacheReadInputTokens: 21_736,
          outputTokens: 545,
        };
      }
      writeCompletedCheckpointChain(
        root,
        attempt.attemptId,
        armId,
        schedulerCheckpoint
      );
      recordObservationResult(root, attempt.attemptId, result);
    }
    writeAttemptSummary(root, attempt.attemptId, {
      launcherExits: Object.keys(OBSERVATION_ARMS).map((armId) => ({
        armId,
        code: 0,
      })),
    }, fixedNow);
    expect(
      finalizeAcceptanceAttempt(root, attempt.attemptId, fixedNow)
    ).toMatchObject({
      selectedAttemptId: attempt.attemptId,
      localEvidence: { physicalRetention: true },
    });
  });

  it('rejects a control result whose baseline differs from its ready checkpoint', () => {
    const root = workDir('rasen-control-baseline-drift-');
    const attempt = createAttempt(root);
    const evidence = completedResult(
      attempt.attemptId,
      'control-hit-55m'
    );
    writeCompletedCheckpointChain(
      root,
      attempt.attemptId,
      'control-hit-55m',
      evidence.schedulerCheckpoint
    );
    evidence.result.controlContextBaselineTokens = 90_000;
    recordObservationResult(root, attempt.attemptId, evidence.result);
    expect(() =>
      validateCompletedObservation(
        root,
        attempt.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/physical_result_hit_semantics_invalid/u);
  });

  it('rejects a completed control without a pre-wake checkpoint lifecycle', () => {
    const root = workDir('rasen-control-checkpoint-lifecycle-');
    const attempt = createAttempt(root);
    const evidence = completedResult(
      attempt.attemptId,
      'control-hit-55m'
    );
    writeObservationCheckpoint(
      root,
      attempt.attemptId,
      'control-hit-55m',
      evidence.schedulerCheckpoint
    );
    recordObservationResult(root, attempt.attemptId, evidence.result);
    expect(() =>
      validateCompletedObservation(
        root,
        attempt.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/physical_result_checkpoint_lifecycle_invalid/u);
  });

  it('rejects an interrupted checkpoint that skips resume-waiting before ready', () => {
    const root = workDir('rasen-control-interrupted-ready-');
    const attempt = createAttempt(root);
    const evidence = completedResult(
      attempt.attemptId,
      'control-hit-55m'
    );
    const ready = evidence.schedulerCheckpoint;
    writeObservationCheckpoint(root, attempt.attemptId, 'control-hit-55m', {
      ...ready,
      admissionBinding: null,
      controlContextBaselineTokens: null,
      elapsedMonotonicMs: 0,
      state: 'initializing',
      updatedAt: ready.startedAt,
    });
    writeObservationCheckpoint(root, attempt.attemptId, 'control-hit-55m', {
      ...ready,
      elapsedMonotonicMs: 0,
      state: 'waiting',
      updatedAt: ready.startedAt,
    });
    writeObservationCheckpoint(root, attempt.attemptId, 'control-hit-55m', {
      ...ready,
      elapsedMonotonicMs: 1,
      state: 'interrupted',
      updatedAt: ready.startedAt,
    });
    writeObservationCheckpoint(
      root,
      attempt.attemptId,
      'control-hit-55m',
      ready
    );
    recordObservationResult(root, attempt.attemptId, evidence.result);
    expect(() =>
      validateCompletedObservation(
        root,
        attempt.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/physical_result_checkpoint_lifecycle_invalid/u);
  });

  it('rejects a non-ready checkpoint that already reached its target', () => {
    const root = workDir('rasen-control-waiting-at-target-');
    const attempt = createAttempt(root);
    const evidence = completedResult(
      attempt.attemptId,
      'control-hit-55m'
    );
    const ready = evidence.schedulerCheckpoint;
    writeObservationCheckpoint(root, attempt.attemptId, 'control-hit-55m', {
      ...ready,
      admissionBinding: null,
      controlContextBaselineTokens: null,
      elapsedMonotonicMs: 0,
      state: 'initializing',
      updatedAt: ready.startedAt,
    });
    writeObservationCheckpoint(root, attempt.attemptId, 'control-hit-55m', {
      ...ready,
      elapsedMonotonicMs: 0,
      state: 'waiting',
      updatedAt: ready.startedAt,
    });
    writeObservationCheckpoint(root, attempt.attemptId, 'control-hit-55m', {
      ...ready,
      state: 'waiting',
      updatedAt: ready.startedAt,
    });
    writeObservationCheckpoint(
      root,
      attempt.attemptId,
      'control-hit-55m',
      ready
    );
    recordObservationResult(root, attempt.attemptId, evidence.result);
    expect(() =>
      validateCompletedObservation(
        root,
        attempt.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/physical_result_checkpoint_lifecycle_invalid/u);
  });

  it('rejects a ready checkpoint written after the completed control result', () => {
    const root = workDir('rasen-control-checkpoint-after-result-');
    const attempt = createAttempt(root);
    const evidence = completedResult(
      attempt.attemptId,
      'control-hit-55m'
    );
    evidence.schedulerCheckpoint.updatedAt = new Date(
      new Date(evidence.result.endedAt).valueOf() + 1
    ).toISOString();
    writeCompletedCheckpointChain(
      root,
      attempt.attemptId,
      'control-hit-55m',
      evidence.schedulerCheckpoint
    );
    recordObservationResult(root, attempt.attemptId, evidence.result);
    expect(() =>
      validateCompletedObservation(
        root,
        attempt.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/physical_result_wall_clock_invalid/u);
  });

  it('routes two launch/observe processes through the real product admission fence', async () => {
    const root = workDir('rasen-real-product-admission-');
    const evidenceRoot = path.join(root, 'evidence');
    const repositoryRoot = fs.realpathSync.native(process.cwd());
    const previousEnv = { ...process.env };
    let server: Awaited<ReturnType<typeof startManagementServer>> | undefined;
    try {
      process.env.RASEN_HOME = root;
      process.env.RASEN_CLAUDE_BIN = fakeClaudeBin;
      process.env.RASEN_TELEMETRY = '0';
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprojectId: admission-proof\n'
      );
      const fixture = await createCanonicalAcceptanceRun(
        root,
        'bug-fix',
        {
          acceptancePipeline: 'bug-fix',
          deterministicAgentBarrier: 'DELAY_RESULT=5000',
        }
      );
      const token = 'real-product-admission-token';
      const version = JSON.parse(
        fs.readFileSync(
          path.join(repositoryRoot, 'package.json'),
          'utf8'
        )
      ).version;
      server = await startManagementServer({
        context: {
          token,
          launchProjectRoot: fixture.manifest.workspace,
          launchProjectRef: {
            projectId: 'admission-proof',
            name: 'admission-proof',
            root: fixture.manifest.workspace,
          },
          version,
          uiAssetsDir: null,
        },
      });
      writeDaemonState({
        version,
        pid: process.pid,
        port: server.port,
        token,
        startedAt: Date.now(),
      });

      const binaryFiles = repositoryBinaryFiles(repositoryRoot);
      const proofCandidate = {
        ...candidate,
        contentFingerprint: '7'.repeat(64),
        binaryFingerprint: hashExactFileSet(repositoryRoot, binaryFiles),
        repositoryRoot: process.cwd(),
        createdAt: new Date().toISOString(),
      };
      const identities = {
        'control-hit-55m': {
          runId: fixture.plan.runId,
          sessionKey: 'competing-product-admission',
          cwd: fixture.manifest.workspace,
          policy: {
            mode: 'never',
            deadlineAt: null,
            maxTouches: 0,
            deadlineAction: 'stop',
          },
        },
        'control-miss-65m': {
          runId: fixture.plan.runId,
          sessionKey: 'unused-miss-control',
          cwd: fixture.manifest.workspace,
          policy: {
            mode: 'never',
            deadlineAt: null,
            maxTouches: 0,
            deadlineAction: 'stop',
          },
        },
        'scheduler-cadence-deadline': {
          runId: fixture.plan.runId,
          sessionKey: 'unused-scheduler',
          cwd: fixture.manifest.workspace,
          policy: {
            mode: 'auto',
            deadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            maxTouches: 1,
            deadlineAction: 'retire-silent',
          },
        },
      };
      const allArmIdentities = Object.fromEntries(
        Object.entries(identities).map(([armId, identity]) => [
          armId,
          identity.sessionKey,
        ])
      );
      const daemonStatePath = path.join(root, 'daemon', 'daemon.json');
      for (const [armId, identity] of Object.entries(identities)) {
        const configDirectory = path.join(
          evidenceRoot,
          'physical',
          armId
        );
        fs.mkdirSync(configDirectory, { recursive: true });
        fs.writeFileSync(
          path.join(configDirectory, 'observation-config.json'),
          `${JSON.stringify({
            actionFile: fixture.manifest.actionFile,
            admissionProofMode: true,
            allArmIdentities,
            armId,
            binaryFiles,
            candidate: proofCandidate,
            claude: {
              binaryPath: fs.realpathSync.native(fakeClaudeBin),
              binaryFingerprint: sha256File(fakeClaudeBin),
              version: 'acceptance-agent-binary-fixture',
              home: root,
            },
            daemon: {
              pid: process.pid,
              port: server.port,
              version,
            },
            daemonStatePath,
            driverModule: path.join(
              repositoryRoot,
              'scripts',
              'session-cache-acceptance',
              'rasen-cli-driver.mjs'
            ),
            identity,
            operationTimeoutMs: 30_000,
            rasenBin: path.join(repositoryRoot, 'bin', 'rasen.js'),
            rasenHome: root,
            workDir: evidenceRoot,
          })}\n`
        );
      }

      const launchPath = path.join(
        repositoryRoot,
        'scripts',
        'session-cache-acceptance',
        'launch-physical.mjs'
      );
      const launchEnv = {
        ...process.env,
        RASEN_SESSION_CACHE_REAL_OBSERVATION: '1',
        RASEN_SESSION_CACHE_ADMISSION_PROOF: '1',
      };
      const launched = await Promise.allSettled([
        execFileAsync(process.execPath, [
          launchPath,
          '--work-dir',
          evidenceRoot,
          '--arm',
          'control-hit-55m',
        ], {
          cwd: repositoryRoot,
          env: launchEnv,
          windowsHide: true,
          timeout: 45_000,
        }),
        execFileAsync(process.execPath, [
          launchPath,
          '--work-dir',
          evidenceRoot,
          '--arm',
          'control-hit-55m',
        ], {
          cwd: repositoryRoot,
          env: launchEnv,
          windowsHide: true,
          timeout: 45_000,
        }),
      ]);
      const processOutput = launched.map((outcome) =>
        outcome.status === 'fulfilled'
          ? outcome.value.stdout
          : String(
              (outcome.reason as { stdout?: string }).stdout ?? ''
            )
      ).join('\n');
      expect(processOutput).toContain(
        'rasen-session-cache-physical-launch/2'
      );
      expect(processOutput).toContain('"reasonCode":"wake_busy"');

      const attemptIds = fs.readdirSync(
        path.join(evidenceRoot, 'attempts')
      ).sort();
      expect(attemptIds).toHaveLength(2);
      const results = attemptIds.flatMap((attemptId) => {
        const resultPath = path.join(
          observationDirectory(
            evidenceRoot,
            attemptId,
            'control-hit-55m'
          ),
          'result.json'
        );
        return fs.existsSync(resultPath)
          ? [readJsonBounded(resultPath)]
          : [];
      });
      expect(results).toEqual([
        expect.objectContaining({
          disposition: 'inconclusive',
          reasonCode: 'wake_busy',
          admissionBinding: null,
        }),
      ]);

      const registry = readJsonBounded(
        path.join(fixture.manifest.runDirectory, 'sessions.json')
      );
      expect(registry.sessions).toHaveLength(1);
      const session = registry.sessions[0];
      expect(session).toMatchObject({
        sessionKey: 'competing-product-admission',
        status: 'idle',
        owner: {
          ownerPid: process.pid,
        },
      });
      expect(session.wakes).toHaveLength(1);
      expect(session.wakes[0]).toMatchObject({
        kind: 'interactive',
        outcome: 'completed',
      });
      expect(session.inFlight).toBeUndefined();

      const agentEvents = fs.readFileSync(
        path.join(fixture.manifest.workspace, 'host-fixture-events.ndjson'),
        'utf8'
      ).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
      expect(agentEvents.filter((event) => event.type === 'spawn'))
        .toEqual([
          expect.objectContaining({
            cwd: fs.realpathSync.native(session.cwd),
          }),
        ]);
      expect(agentEvents.filter((event) => event.type === 'delivery'))
        .toHaveLength(1);
      expect(fs.existsSync(acceptanceRunV2Path(evidenceRoot))).toBe(false);
    } finally {
      let shutdownError: unknown;
      try {
        await server?.stopServer();
      } catch (error) {
        shutdownError = error;
      }
      process.env = previousEnv;
      if (shutdownError !== undefined) throw shutdownError;
    }
  }, 60_000);

  it('keeps a crashed incomplete generation and starts a new generation unchanged', () => {
    const root = workDir('rasen-crash-generation-');
    const first = createAttempt(root);
    const firstBytes = fs.readFileSync(
      attemptIntentPath(root, first.attemptId)
    );
    const second = createAttempt(root);
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(fs.existsSync(attemptSummaryPath(root, first.attemptId))).toBe(false);
    expect(fs.readFileSync(attemptIntentPath(root, first.attemptId)))
      .toEqual(firstBytes);
    expect(readAttemptIntent(root, second.attemptId).attemptId)
      .toBe(second.attemptId);
  });

  it('appends monotonic checkpoints and restores the exact start and constants', async () => {
    const root = workDir('rasen-checkpoint-generation-');
    const identities = armIdentities();
    const attempt = createAttempt(root, identities);
    let wall = new Date(candidate.createdAt).valueOf();
    let monotonic = 0;
    const controller = new AbortController();
    await expect(runObservationArm({
      workDir: root,
      attemptId: attempt.attemptId,
      armId: 'scheduler-cadence-deadline',
      candidate,
      identity: identities['scheduler-cadence-deadline'],
      signal: controller.signal,
      checkpointIntervalMs: 60_000,
      clock: {
        physical: false,
        wallNow: () => new Date(wall),
        monotonicNow: () => monotonic,
        sleep: async () => {
          controller.abort();
          throw new Error('observation_interrupted');
        },
      },
      driver: {
        preflight: async () => ({
          isolated: true,
          capacityVerified: true,
          availableSlots: 3,
        }),
        bootstrap: async ({ persistBootstrapState }) => {
          await persistBootstrapState({
            admissionBinding,
            schedulerBaseline: {
              claudeSessionId: 'checkpoint-session',
              transcriptPathFingerprint: '1'.repeat(64),
              transcriptFileIdentityFingerprint: '2'.repeat(64),
              transcriptSize: 10,
              transcriptPrefixFingerprint: '3'.repeat(64),
              capturedAt: candidate.createdAt,
            },
          });
          return {
            admissionBinding,
            schedulerBaseline: {
              claudeSessionId: 'checkpoint-session',
              transcriptPathFingerprint: '1'.repeat(64),
              transcriptFileIdentityFingerprint: '2'.repeat(64),
              transcriptSize: 10,
              transcriptPrefixFingerprint: '3'.repeat(64),
              capturedAt: candidate.createdAt,
            },
          };
        },
      },
    })).rejects.toThrow(/observation_interrupted/u);
    const directory = path.join(
      observationDirectory(
        root,
        attempt.attemptId,
        'scheduler-cadence-deadline'
      ),
      'checkpoints'
    );
    const files = fs.readdirSync(directory).sort();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toEqual(files.slice().sort());
    const latest = readObservationCheckpoint(
      root,
      attempt.attemptId,
      'scheduler-cadence-deadline'
    )!;
    expect(latest).toMatchObject({
      startedAt: candidate.createdAt,
      cadenceToleranceMs: 5 * 60 * 1000,
      deadlineApplicationToleranceMs: 10 * 60 * 1000,
      state: 'interrupted',
    });
  });

  it('returns a completed arm without observer, process, or file side effects', async () => {
    const root = workDir('rasen-completed-noop-');
    const identities = armIdentities();
    const attempt = createAttempt(root, identities);
    const hitEvidence = completedResult(
      attempt.attemptId,
      'control-hit-55m',
      identities
    );
    writeCompletedCheckpointChain(
      root,
      attempt.attemptId,
      'control-hit-55m',
      hitEvidence.schedulerCheckpoint
    );
    recordObservationResult(root, attempt.attemptId, hitEvidence.result);
    const resultPath = path.join(
      observationDirectory(root, attempt.attemptId, 'control-hit-55m'),
      'result.json'
    );
    const before = fs.statSync(resultPath);
    const driver = {
      preflight: vi.fn(),
      bootstrap: vi.fn(),
      wakeAndReadUsage: vi.fn(),
    };
    await expect(runObservationArm({
      workDir: root,
      attemptId: attempt.attemptId,
      armId: 'control-hit-55m',
      candidate,
      identity: identities['control-hit-55m'],
      driver,
    })).resolves.toMatchObject({ disposition: 'completed' });
    expect(driver.preflight).not.toHaveBeenCalled();
    expect(driver.bootstrap).not.toHaveBeenCalled();
    expect(fs.statSync(resultPath)).toMatchObject({
      size: before.size,
      mtimeMs: before.mtimeMs,
    });
  });

  it('reuses a completed generation by immutable validated copy only', () => {
    const root = workDir('rasen-reuse-generation-');
    const source = createAttempt(root);
    const hitEvidence = completedResult(
      source.attemptId,
      'control-hit-55m'
    );
    writeCompletedCheckpointChain(
      root,
      source.attemptId,
      'control-hit-55m',
      hitEvidence.schedulerCheckpoint
    );
    recordObservationResult(root, source.attemptId, hitEvidence.result);
    const sourcePath = path.join(
      observationDirectory(root, source.attemptId, 'control-hit-55m'),
      'result.json'
    );
    const sourceBytes = fs.readFileSync(sourcePath);
    const target = createAttempt(root);
    const reused = reuseCompletedObservation(
      root,
      target.attemptId,
      source.attemptId,
      'control-hit-55m',
      fixedNow
    );
    expect(reused).toMatchObject({
      attemptId: target.attemptId,
      provenance: {
        kind: 'reused-copy',
        sourceAttemptId: source.attemptId,
      },
    });
    expect(fs.readFileSync(sourcePath)).toEqual(sourceBytes);
    expect(validateCompletedObservation(
      root,
      target.attemptId,
      'control-hit-55m'
    )).toMatchObject({ disposition: 'completed' });
    expect(() =>
      reuseCompletedObservation(
        root,
        target.attemptId,
        source.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/already_exists/u);
    const targetPath = path.join(
      observationDirectory(root, target.attemptId, 'control-hit-55m'),
      'result.json'
    );
    const tamperedReuse = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    tamperedReuse.controlContextBaselineTokens = 90_000;
    fs.writeFileSync(
      targetPath,
      `${JSON.stringify(tamperedReuse, null, 2)}\n`
    );
    expect(() =>
      validateCompletedObservation(
        root,
        target.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/observation_reuse_evidence_mismatch/u);

    const schedulerSource = createAttempt(root);
    const schedulerEvidence = completedResult(
      schedulerSource.attemptId,
      'scheduler-cadence-deadline'
    );
    writeCompletedCheckpointChain(
      root,
      schedulerSource.attemptId,
      'scheduler-cadence-deadline',
      schedulerEvidence.schedulerCheckpoint
    );
    recordObservationResult(
      root,
      schedulerSource.attemptId,
      schedulerEvidence.result
    );
    const schedulerTarget = createAttempt(root);
    const targetArm = observationDirectory(
      root,
      schedulerTarget.attemptId,
      'scheduler-cadence-deadline'
    );
    expect(() =>
      reuseCompletedObservation(
        root,
        schedulerTarget.attemptId,
        schedulerSource.attemptId,
        'scheduler-cadence-deadline'
      )
    ).toThrow(/scheduler_observation_reuse_prohibited/u);
    expect(fs.existsSync(targetArm)).toBe(false);
  });

  it('requires a target-native scheduler checkpoint chain before finalization', () => {
    const recordResults = (
      root: string,
      attemptId: string
    ) => {
      for (const armId of Object.keys(OBSERVATION_ARMS) as Array<
        keyof typeof OBSERVATION_ARMS
      >) {
        const evidence = completedResult(attemptId, armId);
        if (armId !== 'scheduler-cadence-deadline') {
          writeCompletedCheckpointChain(
            root,
            attemptId,
            armId,
            evidence.schedulerCheckpoint
          );
        }
        recordObservationResult(
          root,
          attemptId,
          evidence.result
        );
      }
      writeAttemptSummary(root, attemptId, {
        launcherExits: Object.keys(OBSERVATION_ARMS).map((armId) => ({
          armId,
          code: 0,
        })),
      });
    };

    const missingRoot = workDir('rasen-scheduler-checkpoint-missing-');
    const missing = createAttempt(missingRoot);
    recordResults(missingRoot, missing.attemptId);
    expect(() =>
      finalizeAcceptanceAttempt(missingRoot, missing.attemptId)
    ).toThrow(/physical_result_checkpoint_lifecycle_invalid/u);
    expect(fs.existsSync(acceptanceRunV2Path(missingRoot))).toBe(false);

    const wrongRoot = workDir('rasen-scheduler-checkpoint-wrong-attempt-');
    const wrong = createAttempt(wrongRoot);
    const other = createAttempt(wrongRoot);
    const wrongEvidence = completedResult(
      wrong.attemptId,
      'scheduler-cadence-deadline'
    );
    const checkpointDirectory = path.join(
      observationDirectory(
        wrongRoot,
        wrong.attemptId,
        'scheduler-cadence-deadline'
      ),
      'checkpoints'
    );
    writeJsonCreateOnce(
      path.join(checkpointDirectory, '00000001.json'),
      {
        ...wrongEvidence.schedulerCheckpoint,
        sequence: 1,
        attemptId: other.attemptId,
      }
    );
    recordResults(wrongRoot, wrong.attemptId);
    expect(() =>
      finalizeAcceptanceAttempt(wrongRoot, wrong.attemptId)
    ).toThrow(/observation_checkpoint_identity_mismatch/u);
    expect(fs.existsSync(acceptanceRunV2Path(wrongRoot))).toBe(false);

    const tamperedRoot = workDir('rasen-scheduler-checkpoint-tampered-');
    const tampered = createAttempt(tamperedRoot);
    settleAttempt(tamperedRoot, tampered.attemptId);
    const checkpointPath = path.join(
      observationDirectory(
        tamperedRoot,
        tampered.attemptId,
        'scheduler-cadence-deadline'
      ),
      'checkpoints',
      '00000001.json'
    );
    const checkpoint = readJsonBounded(checkpointPath);
    checkpoint.cadenceToleranceMs = 6 * 60 * 1000;
    fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint)}\n`);
    expect(() =>
      finalizeAcceptanceAttempt(tamperedRoot, tampered.attemptId)
    ).toThrow(/OBSERVATION_ARMS/u);
    expect(fs.existsSync(acceptanceRunV2Path(tamperedRoot))).toBe(false);
  });

  it('selects exactly one complete attempt and rejects cross-attempt evidence', () => {
    const root = workDir('rasen-finalizer-selection-');
    const selected = createAttempt(root);
    const other = createAttempt(root);
    settleAttempt(root, selected.attemptId);
    settleAttempt(root, other.attemptId);
    const otherIntentBefore = fs.readFileSync(
      attemptIntentPath(root, other.attemptId)
    );
    const run = finalizeAcceptanceAttempt(root, selected.attemptId, fixedNow);
    expect(run).toMatchObject({
      schema: ACCEPTANCE_V2_SCHEMA,
      selectedAttemptId: selected.attemptId,
      localEvidence: { physicalRetention: true },
    });
    expect(fs.readFileSync(attemptIntentPath(root, other.attemptId)))
      .toEqual(otherIntentBefore);
    expect(finalizeAcceptanceAttempt(root, selected.attemptId, fixedNow))
      .toEqual(run);
    expect(() =>
      finalizeAcceptanceAttempt(root, other.attemptId, fixedNow)
    ).toThrow(/canonical_v2_record_conflict/u);

    const tamperedRoot = workDir('rasen-cross-attempt-');
    const first = createAttempt(tamperedRoot);
    const second = createAttempt(tamperedRoot);
    settleAttempt(tamperedRoot, first.attemptId);
    settleAttempt(tamperedRoot, second.attemptId);
    const summaryPath = attemptSummaryPath(tamperedRoot, first.attemptId);
    const summary = readJsonBounded(summaryPath);
    summary.arms['control-hit-55m'].resultPath = [
      'attempts',
      second.attemptId,
      'arms',
      'control-hit-55m',
      'result.json',
    ].join('/');
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`);
    expect(() =>
      finalizeAcceptanceAttempt(tamperedRoot, first.attemptId, fixedNow)
    ).toThrow(/result_path_invalid/u);
  });

  it('admits only one canonical generation under real multiprocess finalizers', async () => {
    const root = workDir('rasen-multiprocess-finalizer-');
    const attempt = createAttempt(root);
    settleAttempt(root, attempt.attemptId);
    const script = `
      const protocol = await import(process.env.PROTOCOL_URL);
      try {
        const run = protocol.finalizeAcceptanceAttempt(
          process.env.WORK_DIR,
          process.env.ATTEMPT_ID
        );
        process.stdout.write(JSON.stringify({
          ok: true,
          attemptId: run.selectedAttemptId,
        }));
      } catch (error) {
        process.stdout.write(JSON.stringify({
          ok: false,
          code: error.message,
        }));
      }
    `;
    const env = {
      ...process.env,
      PROTOCOL_URL: protocolUrl,
      WORK_DIR: root,
      ATTEMPT_ID: attempt.attemptId,
    };
    const finalizers = await Promise.all([
      execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
        env,
        windowsHide: true,
      }),
      execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
        env,
        windowsHide: true,
      }),
    ]);
    const outcomes = finalizers.map(({ stdout }) => JSON.parse(stdout));
    expect(outcomes.every((value) => value.ok === true)).toBe(true);
    expect(new Set(outcomes.map((value) => value.attemptId)))
      .toEqual(new Set([attempt.attemptId]));
    expect(readAcceptanceRunV2(root).selectedAttemptId).toBe(attempt.attemptId);
    expect(fs.readdirSync(root).filter(
      (name) => name === 'acceptance-run-v2.json'
    )).toHaveLength(1);
  });

  it('bounded-validates Windows paths and rejects symlinked or oversized evidence', () => {
    const root = workDir('rasen Windows evidence ');
    const windowsRoot = fs.realpathSync.native(root);
    const identities = armIdentities(windowsRoot);
    const windowsCandidate = { ...candidate, repositoryRoot: windowsRoot };
    const attempt = createObservationAttempt(
      root,
      { candidate: windowsCandidate, arms: identities },
      fixedNow
    );
    expect(readAttemptIntent(root, attempt.attemptId).candidate.repositoryRoot)
      .toBe(path.resolve(windowsRoot));

    const result = completedResult(
      attempt.attemptId,
      'control-hit-55m',
      identities
    ).result;
    result.candidate = windowsCandidate;
    recordObservationResult(root, attempt.attemptId, result);
    const resultPath = path.join(
      observationDirectory(root, attempt.attemptId, 'control-hit-55m'),
      'result.json'
    );
    const realResult = `${resultPath}.real`;
    fs.renameSync(resultPath, realResult);
    fs.symlinkSync(realResult, resultPath, 'file');
    expect(() =>
      validateCompletedObservation(
        root,
        attempt.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/bounded_regular_file_invalid/u);
    fs.unlinkSync(resultPath);
    fs.renameSync(realResult, resultPath);
    fs.writeFileSync(resultPath, Buffer.alloc(1024 * 1024 + 1, 0x20));
    expect(() =>
      validateCompletedObservation(
        root,
        attempt.attemptId,
        'control-hit-55m'
      )
    ).toThrow(/bounded_regular_file_invalid/u);
  });

  it('finalizes v2 beside the actual legacy shape without parsing or changing v1', async () => {
    const root = workDir('rasen-legacy-history-');
    const legacy = path.join(root, 'acceptance-run.json');
    const actualLegacyShape = {
      schema: 'rasen-session-cache-acceptance/1',
      revision: 1,
      candidate: {
        contentFingerprint:
          'd689976faeb0a1a530d87329ddd7c9073b82b16766c77133709a4005e983167d',
        binaryFingerprint:
          '4824ee2de2d75f53468c28e7d1a1ff779645dd896343b11e946143081400311e',
        repositoryRoot: process.cwd(),
        createdAt: '2026-07-30T22:25:09.881Z',
        baselineSha: '2551baed92f1973f05d9619b9289a8416ca20b3d',
        treeOid: 'fbf6080aa456c3c3e286cc1a72b3cf7092b40cd0',
        deliveryManifestFingerprint:
          '622c3d17788cbecf21117d450182c85fd6ab449da6b09e25051d914893222a5b',
      },
      supportedPipelines: [...SUPPORTED_PIPELINES],
      expectedFailClosedPipelines: [...EXPECTED_FAIL_CLOSED_PIPELINES],
      requiredCiJobs: [...REQUIRED_CI_JOBS],
      arms: Object.fromEntries(
        Object.keys(OBSERVATION_ARMS).map((armId) => [
          armId,
          {
            armId,
            status: 'not_started',
            identity: null,
            admissionBinding: null,
            resultPath: null,
          },
        ])
      ),
      localEvidence: {
        nativeWindows: true,
        injectedPosix: true,
        nativeLinux: false,
        physicalRetention: false,
        recordPath: 'local-evidence.json',
        note:
          'Focused native Windows and injected POSIX cases are local branch proof only; they do not substitute for native Linux CI or physical 50/55/65-minute retention evidence.',
      },
      productGaps: [],
      authorization: {
        state: 'awaiting_parent_authorization',
        remoteMutationAllowed: false,
        authorizer: null,
        authorizedAt: null,
        deliveryMode: null,
        frozenTreeFingerprint: null,
      },
      ciState: 'pending',
      updatedAt: '2026-07-30T22:25:10.572Z',
    };
    fs.writeFileSync(
      legacy,
      `${JSON.stringify(actualLegacyShape, null, 2)}\n`
    );
    const before = fs.readFileSync(legacy);
    const catalog = catalogLegacyHistory(root);
    expect(catalog).toContainEqual({
      relativePath: 'acceptance-run.json',
      kind: 'file',
      bytes: before.byteLength,
      fingerprint: createHash('sha256').update(before).digest('hex'),
      descendantCount: 0,
      catalogPolicy: 'bounded-named-file-sha256',
    });
    const attempt = createAttempt(root);
    expect(attempt.legacyHistory).toContainEqual(expect.objectContaining({
      relativePath: 'acceptance-run.json',
    }));
    settleAttempt(root, attempt.attemptId);
    const finalized = finalizeAcceptanceAttempt(root, attempt.attemptId);
    expect(finalized).toMatchObject({
      schema: ACCEPTANCE_V2_SCHEMA,
      selectedAttemptId: attempt.attemptId,
    });
    expect(fs.readFileSync(legacy)).toEqual(before);
    const v2Before = fs.readFileSync(acceptanceRunV2Path(root));
    expect(finalizeAcceptanceAttempt(root, attempt.attemptId))
      .toEqual(finalized);
    expect(fs.readFileSync(acceptanceRunV2Path(root))).toEqual(v2Before);
    expect(
      Object.hasOwn(await import(protocolUrl), 'seedAcceptanceRun')
    ).toBe(false);

    const tamperedRoot = workDir('rasen-legacy-tampered-');
    const tamperedLegacyPath = path.join(
      tamperedRoot,
      'acceptance-run.json'
    );
    fs.writeFileSync(tamperedLegacyPath, '{tampered legacy bytes}\n');
    const tamperedLegacy = fs.readFileSync(tamperedLegacyPath);
    const tamperedAttempt = createAttempt(tamperedRoot);
    settleAttempt(tamperedRoot, tamperedAttempt.attemptId);
    expect(finalizeAcceptanceAttempt(
      tamperedRoot,
      tamperedAttempt.attemptId
    )).toMatchObject({ schema: ACCEPTANCE_V2_SCHEMA });
    expect(fs.readFileSync(tamperedLegacyPath)).toEqual(tamperedLegacy);

    const incompatibleRoot = workDir('rasen-v2-second-writer-');
    const incompatibleAttempt = createAttempt(incompatibleRoot);
    settleAttempt(incompatibleRoot, incompatibleAttempt.attemptId);
    fs.writeFileSync(
      acceptanceRunV2Path(incompatibleRoot),
      '{"schema":"rasen-session-cache-acceptance/1"}\n'
    );
    const incompatibleBytes = fs.readFileSync(
      acceptanceRunV2Path(incompatibleRoot)
    );
    expect(() =>
      finalizeAcceptanceAttempt(
        incompatibleRoot,
        incompatibleAttempt.attemptId
      )
    ).toThrow(/canonical_v2_record_incompatible/u);
    expect(fs.readFileSync(acceptanceRunV2Path(incompatibleRoot)))
      .toEqual(incompatibleBytes);
  });

  it('catalogues only bounded named markers beside growing legacy history', () => {
    const root = workDir('rasen-growing-legacy-history-');
    const history = path.join(root, 'history');
    const attempts = path.join(root, 'attempts');
    const logs = path.join(root, 'logs');
    const historyDescendants = path.join(history, 'candidate', 'attempt');
    const attemptDescendants = path.join(attempts, 'old-attempt', 'events');
    const logDescendants = path.join(logs, 'archived');
    fs.mkdirSync(historyDescendants, { recursive: true });
    fs.mkdirSync(attemptDescendants, { recursive: true });
    fs.mkdirSync(logDescendants, { recursive: true });
    for (let index = 0; index < 300; index += 1) {
      const body = Buffer.from(`immutable-${index}\n`, 'utf8');
      fs.writeFileSync(
        path.join(historyDescendants, `${index}.json`),
        body
      );
      fs.writeFileSync(
        path.join(attemptDescendants, `${index}.json`),
        body
      );
      fs.writeFileSync(
        path.join(logDescendants, `${index}.log`),
        body
      );
    }
    const sentinel = path.join(historyDescendants, '299.json');
    const sentinelBefore = fs.readFileSync(sentinel);
    const legacy = path.join(root, 'acceptance-run.json');
    fs.writeFileSync(legacy, '{immutable malformed v1 bytes}\n');
    const legacyBefore = fs.readFileSync(legacy);

    expect(catalogLegacyHistory(root)).toEqual([
      {
        relativePath: 'history',
        kind: 'directory',
        bytes: 0,
        fingerprint: null,
        descendantCount: null,
        catalogPolicy: 'named-root-marker-no-descendant-enumeration',
      },
      {
        relativePath: 'acceptance-run.json',
        kind: 'file',
        bytes: legacyBefore.byteLength,
        fingerprint: createHash('sha256')
          .update(legacyBefore)
          .digest('hex'),
        descendantCount: 0,
        catalogPolicy: 'bounded-named-file-sha256',
      },
    ]);

    const attempt = createObservationAttempt(root, {
      attemptId: '11111111-1111-4111-8111-111111111111',
      candidate,
      arms: armIdentities(),
    }, fixedNow);
    expect(attempt.legacyHistory).toHaveLength(2);
    expect(attempt.legacyHistory).toContainEqual(expect.objectContaining({
      relativePath: 'history',
      catalogPolicy: 'named-root-marker-no-descendant-enumeration',
    }));
    expect(fs.readFileSync(sentinel)).toEqual(sentinelBefore);
    expect(fs.readFileSync(legacy)).toEqual(legacyBefore);
    expect(fs.readdirSync(historyDescendants)).toHaveLength(300);
    expect(fs.readdirSync(attemptDescendants)).toHaveLength(300);
    expect(fs.readdirSync(logDescendants)).toHaveLength(300);
  });

  it('fails closed for unsafe named legacy roots and files', () => {
    const symlinkRoot = workDir('rasen-legacy-root-symlink-');
    const symlinkTarget = workDir('rasen-legacy-root-target-');
    fs.symlinkSync(
      symlinkTarget,
      path.join(symlinkRoot, 'history'),
      'junction'
    );
    expect(() => catalogLegacyHistory(symlinkRoot))
      .toThrow(/legacy_history_symlink/u);

    const danglingRoot = workDir('rasen-legacy-root-dangling-');
    fs.symlinkSync(
      path.join(danglingRoot, 'missing-history-target'),
      path.join(danglingRoot, 'history'),
      'junction'
    );
    expect(() => catalogLegacyHistory(danglingRoot))
      .toThrow(/legacy_history_symlink/u);

    const liveFileRoot = workDir('rasen-legacy-file-symlink-');
    const liveFileTarget = path.join(liveFileRoot, 'capacity-target.json');
    fs.writeFileSync(
      liveFileTarget,
      '{"schema":"rasen-session-supervisor-capacity-proof/2"}\n'
    );
    fs.symlinkSync(
      liveFileTarget,
      path.join(liveFileRoot, 'capacity-proof.json'),
      'file'
    );
    expect(() => catalogLegacyHistory(liveFileRoot))
      .toThrow(/legacy_history_symlink/u);

    const danglingFileRoot = workDir('rasen-legacy-file-dangling-');
    fs.symlinkSync(
      path.join(danglingFileRoot, 'missing-capacity-target.json'),
      path.join(danglingFileRoot, 'capacity-proof.json'),
      'file'
    );
    expect(() => catalogLegacyHistory(danglingFileRoot))
      .toThrow(/legacy_history_symlink/u);

    const nonregularRoot = workDir('rasen-legacy-root-nonregular-');
    fs.writeFileSync(path.join(nonregularRoot, 'history'), 'not a directory\n');
    expect(() => catalogLegacyHistory(nonregularRoot))
      .toThrow(/legacy_history_not_regular/u);

    const oversizedRoot = workDir('rasen-legacy-file-oversized-');
    fs.writeFileSync(
      path.join(oversizedRoot, 'capacity-proof.json'),
      Buffer.alloc(1024 * 1024 + 1, 0x20)
    );
    expect(() => catalogLegacyHistory(oversizedRoot))
      .toThrow(/legacy_history_file_oversize/u);

    const wrongSchemaRoot = workDir('rasen-legacy-schema-invalid-');
    fs.writeFileSync(
      path.join(wrongSchemaRoot, 'capacity-proof.json'),
      '{"schema":"rasen-session-supervisor-capacity-proof/999"}\n'
    );
    expect(() => catalogLegacyHistory(wrongSchemaRoot))
      .toThrow(/legacy_history_schema_invalid:capacity-proof\.json/u);
  });

  it('keeps an empty failed attempt immutable without poisoning a new ID', () => {
    const root = workDir('rasen-empty-failed-generation-');
    const invalidLegacy = path.join(root, 'capacity-proof.json');
    fs.writeFileSync(
      invalidLegacy,
      Buffer.alloc(1024 * 1024 + 1, 0x20)
    );
    const failedId = '22222222-2222-4222-8222-222222222222';
    expect(() => createObservationAttempt(root, {
      attemptId: failedId,
      candidate,
      arms: armIdentities(),
    }, fixedNow)).toThrow(/legacy_history_file_oversize/u);
    const failedDirectory = attemptDirectory(root, failedId);
    expect(fs.readdirSync(failedDirectory)).toEqual([]);
    expect(() => createObservationAttempt(root, {
      attemptId: failedId,
      candidate,
      arms: armIdentities(),
    }, fixedNow)).toThrow(/attempt_id_already_exists/u);

    fs.unlinkSync(invalidLegacy);
    const next = createObservationAttempt(root, {
      attemptId: '33333333-3333-4333-8333-333333333333',
      candidate,
      arms: armIdentities(),
    }, fixedNow);
    expect(readAttemptIntent(root, next.attemptId)).toEqual(next);
    expect(fs.readdirSync(failedDirectory)).toEqual([]);
    expect(fs.existsSync(attemptIntentPath(root, failedId))).toBe(false);
  });

  it('strictly rejects unknown fields, attempt reuse, and summary overwrite', () => {
    const root = workDir();
    const attempt = createAttempt(root);
    expect(() =>
      createObservationAttempt(root, {
        attemptId: attempt.attemptId,
        candidate,
        arms: armIdentities(),
      })
    ).toThrow(/attempt_id_already_exists/u);
    const intent = readJsonBounded(attemptIntentPath(root, attempt.attemptId));
    expect(() => readAttemptIntent(root, 'not-an-attempt')).toThrow(
      /attempt_id_invalid/u
    );
    expect(() => writeJsonCreateOnce(
      attemptIntentPath(root, attempt.attemptId),
      intent
    )).toThrow(/already_exists/u);
    const summary = writeAttemptSummary(root, attempt.attemptId);
    expect(summary).toMatchObject({
      schema: ATTEMPT_SUMMARY_SCHEMA,
      status: 'incomplete',
    });
    expect(readAttemptSummary(root, attempt.attemptId)).toEqual(summary);
    expect(() =>
      writeAttemptSummary(root, attempt.attemptId)
    ).toThrow(/already_exists/u);
  });

  it('preserves typed local evidence, default-deny delivery, and exact CI binding', () => {
    const root = workDir('rasen-local-ci-');
    const attempt = createAttempt(root);
    settleAttempt(root, attempt.attemptId);
    const finalized = finalizeAcceptanceAttempt(root, attempt.attemptId);
    expect(finalized.authorization).toMatchObject({
      state: 'awaiting_parent_authorization',
      remoteMutationAllowed: false,
    });
    const logs = path.join(root, 'logs');
    fs.mkdirSync(logs);
    const gateDefinitions = {
      focusedVitest: {
        gateType: 'focused-vitest',
        platformClaims: ['native-windows', 'injected-posix'],
        allowsEmptyOutput: false,
      },
      eslint: {
        gateType: 'eslint',
        platformClaims: [],
        allowsEmptyOutput: true,
      },
      nodeCheck: {
        gateType: 'node-check',
        platformClaims: [],
        allowsEmptyOutput: false,
      },
      ownership: {
        gateType: 'ownership-audit',
        platformClaims: [],
        allowsEmptyOutput: false,
      },
      strictValidation: {
        gateType: 'strict-validation',
        platformClaims: [],
        allowsEmptyOutput: false,
      },
    };
    const gates = Object.fromEntries(
      Object.entries(gateDefinitions).map(([name, definition]) => {
        const outputPath = path.join(logs, `${name}.log`);
        const exitCodePath = path.join(logs, `${name}.exit`);
        fs.writeFileSync(outputPath, definition.allowsEmptyOutput ? '' : 'ok\n');
        fs.writeFileSync(exitCodePath, '0\n');
        return [name, {
          ...definition,
          outputPath: path.relative(root, outputPath),
          exitCodePath: path.relative(root, exitCodePath),
        }];
      })
    );
    const local = recordLocalEvidence(root, { gates }, fixedNow);
    expect(local.localEvidence).toMatchObject({
      nativeWindows: true,
      injectedPosix: true,
      nativeLinux: false,
    });
    expect(validateCurrentLocalEvidence(root)).toMatchObject({
      nativeWindows: true,
      injectedPosix: true,
    });
    authorizeParentDelivery(root, {
      authorizer: 'portfolio-owner',
      deliveryMode: 'pr',
      frozenTreeFingerprint: candidate.contentFingerprint,
      frozenTreeOid: candidate.treeOid,
      repository: 'example/repository',
      githubOrigin: 'https://github.com',
    }, fixedNow);
    recordParentDelivery(root, {
      currentTreeFingerprint: candidate.contentFingerprint,
      currentTreeOid: candidate.treeOid,
      deliveredSha: '9'.repeat(40),
    }, fixedNow);
    expect(seedPendingCiEvidence(root, fixedNow)).toMatchObject({
      state: 'pending',
      deliverySha: '9'.repeat(40),
    });
    const workflowRuns = [{
      id: 42,
      run_attempt: 3,
      head_sha: '9'.repeat(40),
      status: 'completed',
      conclusion: 'success',
      repository: { full_name: 'example/repository' },
      html_url: 'https://github.com/example/repository/actions/runs/42',
      url: 'https://api.github.com/repos/example/repository/actions/runs/42',
    }];
    const jobs = REQUIRED_CI_JOBS.map((name, index) => ({
      id: 100 + index,
      name,
      status: 'completed',
      conclusion: 'success',
      run_id: 42,
      run_attempt: 3,
      run_url:
        'https://api.github.com/repos/example/repository/actions/runs/42',
      head_sha: '9'.repeat(40),
      html_url:
        `https://github.com/example/repository/actions/runs/42/job/${100 + index}`,
      url:
        `https://api.github.com/repos/example/repository/actions/jobs/${100 + index}`,
    }));
    expect(collectSuccessfulCiEvidence(root, {
      workflowRuns,
      jobs,
      deliveryScope: 'portfolio',
      platformEvidence: 'native',
    }, fixedNow)).toMatchObject({ state: 'successful' });
    expect(readJsonBounded(ciEvidencePath(root))).toMatchObject({
      state: 'successful',
    });
  });

  it('keeps schemas strict and ownership acceptance-only', () => {
    const root = workDir('rasen-v2-schema-');
    const attempt = createAttempt(root);
    settleAttempt(root, attempt.attemptId);
    const run = finalizeAcceptanceAttempt(root, attempt.attemptId);
    expect(validateAcceptanceRunV2(run)).toEqual(run);
    expect(() => validateAcceptanceRunV2({
      ...run,
      bearerToken: 'secret',
    })).toThrow();
    expect(auditAcceptanceOwnership([
      'scripts/session-cache-acceptance/protocol.mjs',
      'test/acceptance/session-cache/protocol.test.ts',
    ]).owned).toHaveLength(2);
    expect(() =>
      auditAcceptanceOwnership(['src/core/management-api/supervisor.ts'])
    ).toThrow(/acceptance_ownership_violation/u);
  });
});
