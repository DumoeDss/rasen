import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  OBSERVATION_ARMS,
  OBSERVATION_CHECKPOINT_SCHEMA,
  OBSERVATION_RESULT_SCHEMA,
  MIN_CONTROL_CONTEXT_TOKENS,
  classifyControlUsage,
  observationDirectory,
  readObservationCheckpoint,
  recordObservationResult,
  validateCompletedObservation,
  writeObservationCheckpoint,
  writeObservationLog,
  writeObservationProductGap,
} from './protocol.mjs';

export class ObservationInterruptedError extends Error {
  constructor() {
    super('observation_interrupted');
    this.name = 'ObservationInterruptedError';
  }
}

export function createPhysicalObservationClock() {
  return {
    physical: true,
    wallNow: () => new Date(),
    monotonicNow: () => performance.now(),
    sleep: (milliseconds, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new ObservationInterruptedError());
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          reject(new ObservationInterruptedError());
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, milliseconds);
        // Deliberately keep the timer referenced. The physical observation
        // process must stay alive after its short bootstrap child exits.
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
  };
}

async function waitForPhysicalTarget(options) {
  const existing = readObservationCheckpoint(
    options.workDir,
    options.attemptId,
    options.armId
  );
  if (
    existing !== null
    && (
      existing.candidate.contentFingerprint
        !== options.candidate.contentFingerprint
      || existing.candidate.binaryFingerprint
        !== options.candidate.binaryFingerprint
      || JSON.stringify(existing.identity)
        !== JSON.stringify({
          ...options.identity,
          cwd: path.resolve(options.identity.cwd),
        })
      || existing.targetElapsedMs !== options.minimumElapsedMs
      || existing.startedAt !== options.startedAt.toISOString()
      || existing.cadenceToleranceMs
        !== (options.cadenceToleranceMs ?? null)
      || existing.deadlineApplicationToleranceMs
        !== (options.deadlineApplicationToleranceMs ?? null)
      || (
        existing.state !== 'initializing'
        && (
          JSON.stringify(existing.admissionBinding)
            !== JSON.stringify(options.admissionBinding ?? null)
          || JSON.stringify(existing.schedulerBaseline)
            !== JSON.stringify(options.schedulerBaseline ?? null)
          || existing.controlContextBaselineTokens
            !== (options.controlContextBaselineTokens ?? null)
        )
      )
    )
  ) {
    throw new Error('observation_checkpoint_identity_mismatch');
  }
  const startedAt = options.startedAt;
  let elapsed = existing?.elapsedMonotonicMs ?? 0;
  const write = (state) =>
    writeObservationCheckpoint(
      options.workDir,
      options.attemptId,
      options.armId,
      {
      schema: OBSERVATION_CHECKPOINT_SCHEMA,
      attemptId: options.attemptId,
      candidate: options.candidate,
      armId: options.armId,
      identity: options.identity,
      admissionBinding: options.admissionBinding ?? null,
      schedulerBaseline: options.schedulerBaseline ?? null,
      controlContextBaselineTokens:
        options.controlContextBaselineTokens ?? null,
      schedulerPreterminalOwnerProof:
        existing?.schedulerPreterminalOwnerProof ?? null,
      startedAt: startedAt.toISOString(),
      cadenceToleranceMs: options.cadenceToleranceMs ?? null,
      deadlineApplicationToleranceMs:
        options.deadlineApplicationToleranceMs ?? null,
      targetElapsedMs: options.minimumElapsedMs,
      elapsedMonotonicMs: elapsed,
      state,
      updatedAt: options.clock.wallNow().toISOString(),
      }
    );
  write(elapsed >= options.minimumElapsedMs ? 'ready' : 'waiting');
  try {
    while (elapsed < options.minimumElapsedMs) {
      const segment = Math.min(
        options.checkpointIntervalMs ?? 60_000,
        options.minimumElapsedMs - elapsed
      );
      const segmentStarted = options.clock.monotonicNow();
      await options.clock.sleep(segment, options.signal);
      elapsed += Math.max(
        0,
        options.clock.monotonicNow() - segmentStarted
      );
      elapsed = Math.min(elapsed, 24 * 60 * 60 * 1000);
      write(elapsed >= options.minimumElapsedMs ? 'ready' : 'waiting');
    }
  } catch (error) {
    if (
      error instanceof ObservationInterruptedError
      || options.signal?.aborted
    ) {
      write('interrupted');
      throw new ObservationInterruptedError();
    }
    throw error;
  }
  return { startedAt, elapsedMonotonicMs: elapsed };
}

function inconclusiveReason(arm, observation) {
  if (observation.clockAmbiguous) return 'clock_ambiguity';
  if (arm.automaticTouch) {
    if (observation.touchesObserved !== 1) return 'touch_count_ambiguous';
    if (!observation.deadlineApplied) return 'deadline_not_observed';
    return null;
  }
  if (observation.usageCounters === null) return 'usage_counters_unavailable';
  const classification = classifyControlUsage(
    observation.usageCounters,
    observation.controlContextBaselineTokens
  );
  if (classification !== arm.expectedClassification) {
    return 'cache_classification_mismatch';
  }
  return null;
}

/**
 * Runs one named arm. The default clock is physical. Tests may inject a
 * deterministic clock, but those results are deliberately forced to
 * `inconclusive` and cannot close the final acceptance gate.
 */
async function runObservationArmInternal(options) {
  const arm = OBSERVATION_ARMS[options.armId];
  if (arm === undefined) throw new Error(`Unknown observation arm: ${options.armId}`);
  const clock = options.clock ?? createPhysicalObservationClock();
  const driver = options.driver;
  const cadenceToleranceMs = arm.automaticTouch
    ? arm.cadenceToleranceMs
    : null;
  const deadlineApplicationToleranceMs = arm.automaticTouch
    ? arm.deadlineApplicationToleranceMs
    : null;
  let priorCheckpoint = readObservationCheckpoint(
    options.workDir,
    options.attemptId,
    options.armId,
  );
  let startedAt =
    priorCheckpoint === null
      ? clock.wallNow()
      : new Date(priorCheckpoint.startedAt);
  if (priorCheckpoint === null) {
    priorCheckpoint = writeObservationCheckpoint(
      options.workDir,
      options.attemptId,
      options.armId,
      {
        schema: OBSERVATION_CHECKPOINT_SCHEMA,
        attemptId: options.attemptId,
        candidate: options.candidate,
        armId: options.armId,
        identity: options.identity,
        admissionBinding: null,
        schedulerBaseline: null,
        controlContextBaselineTokens: null,
        schedulerPreterminalOwnerProof: null,
        startedAt: startedAt.toISOString(),
        cadenceToleranceMs,
        deadlineApplicationToleranceMs,
        targetElapsedMs: arm.minimumElapsedMs,
        elapsedMonotonicMs: 0,
        state: 'initializing',
        updatedAt: clock.wallNow().toISOString(),
      }
    );
  }
  let elapsedMonotonicMs = 0;
  const events = [
    { at: startedAt.toISOString(), event: 'arm_started', code: null },
  ];
  let preflight;
  try {
    preflight = await driver.preflight({
      armId: options.armId,
      identity: options.identity,
      requiredIsolatedSlots: options.requiredIsolatedSlots ?? 3,
    });
  } catch {
    preflight = {
      isolated: false,
      capacityVerified: false,
      availableSlots: 0,
    };
  }
  if (
    preflight.isolated !== true
    || preflight.capacityVerified !== true
    || preflight.availableSlots < (options.requiredIsolatedSlots ?? 3)
  ) {
    const endedAt = clock.wallNow();
    const result = {
      schema: OBSERVATION_RESULT_SCHEMA,
      attemptId: options.attemptId,
      candidate: {
        ...options.candidate,
        repositoryRoot: path.resolve(options.candidate.repositoryRoot),
      },
      armId: options.armId,
      identity: {
        ...options.identity,
        cwd: path.resolve(options.identity.cwd),
      },
      admissionBinding: null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      elapsedMonotonicMs: Math.max(
        0,
        elapsedMonotonicMs
      ),
      physicalElapsed: clock.physical === true,
      controlContextBaselineTokens: null,
      usageCounters: null,
      touchesObserved: 0,
      deadlineApplied: false,
      schedulerEvidence: null,
      classification: 'ambiguous',
      disposition: 'inconclusive',
      reasonCode: 'capacity_or_isolation_unproven',
    };
    recordObservationResult(options.workDir, options.attemptId, result);
    events.push({
      at: endedAt.toISOString(),
      event: 'arm_settled',
      code: result.reasonCode,
    });
    writeObservationLog(
      options.workDir,
      options.attemptId,
      options.armId,
      events
    );
    return result;
  }

  let observation;
  let admissionBinding = null;
  let schedulerBaseline = null;
  let controlContextBaselineTokens = null;
  let observationOperationStartedAt = null;
  try {
    let checkpoint = readObservationCheckpoint(
      options.workDir,
      options.attemptId,
      options.armId
    );
    if (checkpoint === null) throw new Error('observation_checkpoint_missing');
    if (
      checkpoint.startedAt !== startedAt.toISOString()
      || checkpoint.cadenceToleranceMs !== cadenceToleranceMs
      || checkpoint.deadlineApplicationToleranceMs
        !== deadlineApplicationToleranceMs
    ) {
      throw new Error('observation_checkpoint_interval_drift');
    }
    if (checkpoint.state === 'initializing') {
      const admitted = await driver.bootstrap({
        armId: options.armId,
        identity: options.identity,
        startedAt: startedAt.toISOString(),
        cadenceToleranceMs,
        deadlineApplicationToleranceMs,
        persistBootstrapState: async (bootstrapState) => {
          const current = readObservationCheckpoint(
            options.workDir,
            options.attemptId,
            options.armId
          );
          if (
            current === null
            || current.state !== 'initializing'
            || current.startedAt !== startedAt.toISOString()
            || current.cadenceToleranceMs !== cadenceToleranceMs
            || current.deadlineApplicationToleranceMs
              !== deadlineApplicationToleranceMs
          ) {
            throw new Error('observation_bootstrap_checkpoint_drift');
          }
          writeObservationCheckpoint(
            options.workDir,
            options.attemptId,
            options.armId,
            {
              ...current,
              admissionBinding:
                bootstrapState?.admissionBinding ?? null,
              schedulerBaseline:
                bootstrapState?.schedulerBaseline ?? null,
              controlContextBaselineTokens:
                bootstrapState?.controlContextBaselineTokens ?? null,
              state: 'waiting',
              updatedAt: clock.wallNow().toISOString(),
            }
          );
        },
      });
      admissionBinding = admitted?.admissionBinding ?? null;
      schedulerBaseline = admitted?.schedulerBaseline ?? null;
      controlContextBaselineTokens =
        admitted?.controlContextBaselineTokens ?? null;
    } else if (typeof driver.resume === 'function') {
      const resumed = await driver.resume({
        armId: options.armId,
        identity: options.identity,
        checkpoint,
      });
      admissionBinding =
        resumed?.admissionBinding ?? checkpoint.admissionBinding;
      schedulerBaseline =
        resumed?.schedulerBaseline ?? checkpoint.schedulerBaseline;
      controlContextBaselineTokens =
        resumed?.controlContextBaselineTokens
        ?? checkpoint.controlContextBaselineTokens;
    } else {
      admissionBinding = checkpoint.admissionBinding;
      schedulerBaseline = checkpoint.schedulerBaseline;
      controlContextBaselineTokens =
        checkpoint.controlContextBaselineTokens;
    }
    if (options.signal?.aborted) {
      throw new ObservationInterruptedError();
    }
    if (
      (
        arm.automaticTouch
        && controlContextBaselineTokens !== null
      )
      || (
        !arm.automaticTouch
        && (
          !Number.isSafeInteger(controlContextBaselineTokens)
          || controlContextBaselineTokens < MIN_CONTROL_CONTEXT_TOKENS
        )
      )
    ) {
      throw new Error('control_context_baseline_invalid');
    }
    const waited = await waitForPhysicalTarget({
      workDir: options.workDir,
      attemptId: options.attemptId,
      armId: options.armId,
      candidate: options.candidate,
      identity: options.identity,
      admissionBinding,
      schedulerBaseline,
      controlContextBaselineTokens,
      startedAt,
      cadenceToleranceMs,
      deadlineApplicationToleranceMs,
      minimumElapsedMs: arm.minimumElapsedMs,
      checkpointIntervalMs: options.checkpointIntervalMs,
      signal: options.signal,
      clock,
    });
    startedAt = waited.startedAt;
    elapsedMonotonicMs = waited.elapsedMonotonicMs;
    observationOperationStartedAt = clock.monotonicNow();
    observation = arm.automaticTouch
      ? await driver.inspectScheduler({
          armId: options.armId,
          identity: options.identity,
          signal: options.signal,
          persistPreterminalProof: async (proof) => {
            const current = readObservationCheckpoint(
              options.workDir,
              options.attemptId,
              options.armId
            );
            if (
              current === null
              || current.startedAt !== startedAt.toISOString()
              || current.schedulerBaseline === null
            ) {
              throw new Error(
                'scheduler_preterminal_checkpoint_missing'
              );
            }
            writeObservationCheckpoint(
              options.workDir,
              options.attemptId,
              options.armId,
              {
                ...current,
                schedulerPreterminalOwnerProof: proof,
                updatedAt: clock.wallNow().toISOString(),
              }
            );
          },
        })
      : await driver.wakeAndReadUsage({
          armId: options.armId,
          identity: options.identity,
          signal: options.signal,
        });
  } catch (error) {
    if (
      error instanceof ObservationInterruptedError
      || (error instanceof Error && error.message === 'observation_interrupted')
    ) {
      throw new ObservationInterruptedError();
    }
    if (
      error?.acceptanceProductGap === true
      && /^[a-z][a-z0-9_]{0,63}$/u.test(error.safeCode ?? '')
      && /^[a-z][a-z0-9_]{0,63}$/u.test(error.gapArea ?? '')
    ) {
      writeObservationProductGap(
        options.workDir,
        options.attemptId,
        options.armId,
        {
          area: error.gapArea,
          caseId: `physical-${options.armId}`,
          code: error.safeCode,
          summary: `Production acceptance command returned stable code ${error.safeCode}.`,
        }
      );
    }
    observation = {
      usageCounters: null,
      touchesObserved: 0,
      deadlineApplied: false,
      schedulerEvidence: null,
      clockAmbiguous: true,
      failureCode:
        error?.acceptanceProductGap === true
          ? error.safeCode
          : /^[a-z][a-z0-9_]{0,63}$/u.test(error?.message ?? '')
            ? error.message
            : 'driver_failure',
    };
  }

  if (typeof driver.revalidateIdentity === 'function') {
    try {
      await driver.revalidateIdentity({
        armId: options.armId,
        identity: options.identity,
        admissionBinding,
        observation,
      });
    } catch (error) {
      const priorFailureCode = observation.failureCode;
      observation = {
        usageCounters: null,
        touchesObserved: 0,
        deadlineApplied: false,
        schedulerEvidence: null,
        clockAmbiguous: true,
        failureCode:
          priorFailureCode
          ?? (/^[a-z][a-z0-9_]{0,63}$/u.test(error?.message ?? '')
            ? error.message
            : 'result_identity_drift'),
      };
    }
  }

  if (observationOperationStartedAt !== null) {
    elapsedMonotonicMs += Math.max(
      0,
      clock.monotonicNow() - observationOperationStartedAt
    );
  }

  const endedAt = clock.wallNow();
  elapsedMonotonicMs = Math.min(
    24 * 60 * 60 * 1000,
    Math.max(0, elapsedMonotonicMs)
  );
  const retentionStartedAt = new Date(
    schedulerBaseline?.capturedAt
      ?? admissionBinding?.boundAt
      ?? startedAt
  );
  const wallElapsedMs =
    endedAt.valueOf() - retentionStartedAt.valueOf();
  const elapsedAmbiguous =
    !Number.isFinite(retentionStartedAt.valueOf())
    || retentionStartedAt.valueOf() < startedAt.valueOf()
    || retentionStartedAt.valueOf() > endedAt.valueOf()
    || wallElapsedMs < arm.minimumElapsedMs
    || elapsedMonotonicMs < arm.minimumElapsedMs
    || Math.abs(wallElapsedMs - elapsedMonotonicMs) > 5 * 60 * 1000;
  const normalized = {
    controlContextBaselineTokens,
    usageCounters: observation.usageCounters ?? null,
    touchesObserved: observation.touchesObserved ?? 0,
    deadlineApplied: observation.deadlineApplied ?? false,
    schedulerEvidence: observation.schedulerEvidence ?? null,
    clockAmbiguous:
      observation.clockAmbiguous === true || elapsedAmbiguous,
  };
  let reason = inconclusiveReason(arm, normalized);
  if (!clock.physical) reason = 'deterministic_clock_not_physical';
  if (observation.failureCode) reason = observation.failureCode;
  const classification = arm.automaticTouch
    ? normalized.touchesObserved === 1 && normalized.deadlineApplied
      ? 'one_touch_then_deadline'
      : 'ambiguous'
    : classifyControlUsage(
      normalized.usageCounters,
      normalized.controlContextBaselineTokens
    );
  const result = {
    schema: OBSERVATION_RESULT_SCHEMA,
    attemptId: options.attemptId,
    candidate: {
      ...options.candidate,
      repositoryRoot: path.resolve(options.candidate.repositoryRoot),
    },
    armId: options.armId,
    identity: {
      ...options.identity,
      cwd: path.resolve(options.identity.cwd),
    },
    admissionBinding,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    elapsedMonotonicMs,
    physicalElapsed: clock.physical === true,
    controlContextBaselineTokens:
      normalized.controlContextBaselineTokens,
    usageCounters: normalized.usageCounters,
    touchesObserved: normalized.touchesObserved,
    deadlineApplied: normalized.deadlineApplied,
    schedulerEvidence: normalized.schedulerEvidence,
    classification,
    disposition: reason === null ? 'completed' : 'inconclusive',
    reasonCode: reason,
  };
  recordObservationResult(options.workDir, options.attemptId, result);
  events.push({
    at: endedAt.toISOString(),
    event: 'arm_settled',
    code: reason,
  });
  writeObservationLog(
    options.workDir,
    options.attemptId,
    options.armId,
    events
  );
  return result;
}

export async function runObservationArm(options) {
  if (typeof options.attemptId !== 'string') {
    throw new Error('attempt_id_required');
  }
  const resultPath = path.join(
    observationDirectory(options.workDir, options.attemptId, options.armId),
    'result.json'
  );
  if (fs.existsSync(resultPath)) {
    return validateCompletedObservation(
      options.workDir,
      options.attemptId,
      options.armId
    );
  }
  return runObservationArmInternal(options);
}
