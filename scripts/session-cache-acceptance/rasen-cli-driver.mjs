import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

import {
  deriveDeliveryTree,
  readPathManifest,
} from './delivery-candidate.mjs';
import {
  fingerprintSelectedExecutable,
  hashExactFileSet,
  inspectManagementServerCapacity,
  inspectPhysicalCapacity,
  inspectDaemonIdentity,
  sha256File,
  verifyCapacityProofDocument,
} from './physical-preflight.mjs';
import {
  captureExactDurableSession,
  captureExactTranscriptContextBaseline,
  captureExactTranscriptState,
  captureExactTranscriptBaseline,
  extractExactAppendedUsage,
  inspectSchedulerTranscriptCausalAppend,
  restoreExactTranscriptBaseline,
} from './transcript-usage.mjs';
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const SCHEDULER_TOUCH_MESSAGE =
  'Keepalive touch. Reply with exactly: OK. Do not use any tools.';

function digestJson(value) {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function stableBindingFingerprint(binding) {
  return digestJson({
    ownerInstanceId: binding.ownerInstanceId,
    ownerPid: binding.ownerPid,
    ownerProcessCreationIdentity: binding.ownerProcessCreationIdentity,
    hostId: binding.hostId,
    childPid: binding.childPid,
    childProcessCreationIdentity: binding.childProcessCreationIdentity,
  });
}

function schedulerTouchTextDigest() {
  const byteLength = Buffer.byteLength(SCHEDULER_TOUCH_MESSAGE, 'utf8');
  return createHash('sha256')
    .update(
      `rasen-session-cache-touch-text/1\0${byteLength}:`,
      'utf8'
    )
    .update(SCHEDULER_TOUCH_MESSAGE, 'utf8')
    .digest('hex');
}

function schedulerTouchMessageIdDigest(identity, ordinal, attempt) {
  const messageIdHash = createHash('sha256')
    .update(JSON.stringify({
      runId: identity.runId,
      sessionKey: identity.sessionKey,
      ordinal,
      attempt,
    }), 'utf8')
    .digest('hex');
  const messageId = `rasen-touch-v1-${messageIdHash}`;
  const byteLength = Buffer.byteLength(messageId, 'utf8');
  return createHash('sha256')
    .update(`rasen-session-message-id/1\0${byteLength}:`, 'utf8')
    .update(messageId, 'utf8')
    .digest('hex');
}

function regularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  return stat.isFile() && !stat.isSymbolicLink();
}

function parseJsonDocument(value) {
  const parsed = JSON.parse(value.trim());
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('cli_response_not_object');
  }
  return parsed;
}

const CLI_CODE_OWNERS = Object.freeze({
  daemon_foreign: 'cli_protocol',
  daemon_identity_ambiguous: 'daemon_probe',
  daemon_version_mismatch: 'daemon_probe',
  transport_uncertain: 'cli_protocol',
  foreground_shutdown_failed: 'foreground_shutdown',
  host_not_found: 'host_lifecycle',
  host_busy: 'host_capacity',
  session_capacity_exhausted: 'host_capacity',
  run_not_found: 'registry_durability',
  run_identity_mismatch: 'registry_durability',
  run_directory_invalid: 'registry_durability',
  run_mismatch: 'registry_durability',
  session_conflict: 'registry_durability',
  session_retired: 'registry_durability',
  invalid_transition: 'registry_durability',
  wake_busy: 'wake_fence',
  invalid_action: 'cli_protocol',
  invalid_request: 'cli_protocol',
  bad_request: 'cli_protocol',
  payload_too_large: 'cli_protocol',
});

export function decodePublicCliFailure(stdout) {
  if (Buffer.byteLength(stdout, 'utf8') > MAX_PROCESS_OUTPUT_BYTES) {
    throw new Error('cli_failure_envelope_oversize');
  }
  const document = parseJsonDocument(stdout);
  const exactTopLevel = [
    'command',
    'ok',
    'outcome',
    'ownerMode',
    'runId',
    'schema',
    'sessionKey',
  ];
  if (
    document.schema !== 'rasen-session-command/1'
    || document.ok !== false
    || !['exec', 'list', 'retire'].includes(document.command)
    || Object.keys(document).some((key) => !exactTopLevel.includes(key))
    || document.outcome === null
    || typeof document.outcome !== 'object'
    || Array.isArray(document.outcome)
    || Object.keys(document.outcome).some(
      (key) => !['code', 'message', 'failures'].includes(key)
    )
    || typeof document.outcome.code !== 'string'
    || !/^[a-z][a-z0-9_]{0,63}$/u.test(document.outcome.code)
  ) {
    throw new Error('cli_failure_envelope_invalid');
  }
  const area = CLI_CODE_OWNERS[document.outcome.code];
  if (area === undefined) throw new Error('cli_failure_code_unclassified');
  return { safeCode: document.outcome.code, gapArea: area };
}

class PublicCliFailure extends Error {
  constructor(decoded) {
    super(decoded.safeCode);
    this.name = 'PublicCliFailure';
    this.acceptanceProductGap = true;
    this.safeCode = decoded.safeCode;
    this.gapArea = decoded.gapArea;
  }
}

function safeHarnessCliFailure(code) {
  return new PublicCliFailure({
    safeCode: code,
    gapArea: 'cli_protocol',
  });
}

function invalidPublicCliFailure(stdout, error) {
  if (Buffer.byteLength(stdout, 'utf8') === 0) {
    return safeHarnessCliFailure('cli_failure_envelope_missing');
  }
  if (error?.message === 'cli_failure_envelope_oversize') {
    return safeHarnessCliFailure('cli_failure_envelope_oversize');
  }
  if (error?.message === 'cli_failure_code_unclassified') {
    return safeHarnessCliFailure('cli_failure_code_unclassified');
  }
  return safeHarnessCliFailure('cli_failure_envelope_invalid');
}

function referencedDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('observation_interrupted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('observation_interrupted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function currentBinaryFiles(repositoryRoot) {
  const files = ['bin/rasen.js', 'package.json'];
  const walk = (directory) => {
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

async function processCreationIdentity(pid, config, cwd) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('owned_process_pid_invalid');
  }
  if (typeof config.inspectProcessCreationIdentity === 'function') {
    const value = await config.inspectProcessCreationIdentity(pid);
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
      throw new Error('owned_process_creation_identity_ambiguous');
    }
    return value;
  }
  if (process.platform === 'darwin') {
    // macOS has no /proc. `ps -o lstart=` is the portable creation stamp; its
    // one-second granularity is enough to notice the pid being reused by a
    // different process later in the same observation.
    let result;
    try {
      result = await boundedSpawn(
        '/bin/ps',
        ['-p', String(pid), '-o', 'lstart='],
        { cwd, env: process.env, timeoutMs: 60_000 }
      );
    } catch {
      throw new Error('owned_process_creation_identity_ambiguous');
    }
    const value = result.stdout.trim();
    if (value.length === 0 || value.length > 256 || /[\r\n]/u.test(value)) {
      throw new Error('owned_process_creation_identity_ambiguous');
    }
    return `mac-lstart:${value}`;
  }
  if (process.platform !== 'win32') {
    let value;
    try {
      value = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      throw new Error('owned_process_creation_identity_ambiguous');
    }
    const end = value.lastIndexOf(') ');
    const fields = end < 0 ? [] : value.slice(end + 2).trim().split(/\s+/u);
    const startTicks = fields[19];
    if (!/^\d+$/u.test(startTicks ?? '')) {
      throw new Error('owned_process_creation_identity_ambiguous');
    }
    return `proc-start:${startTicks}`;
  }
  // 60s, not 15s: a cold powershell.exe CIM spawn on a loaded CI runner can exceed 15s,
  // and killing it here surfaces as cli_timeout inside the admitted observation
  // (measured: windows-pwsh-shard-3, 2026-08-15, run 31869784203).
  const script =
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" `
    + "-ErrorAction SilentlyContinue;"
    + "if($null -ne $p){$p.CreationDate.ToUniversalTime().Ticks}";
  const result = await boundedSpawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      cwd,
      env: process.env,
      timeoutMs: 60_000,
    }
  );
  const value = result.stdout.trim();
  if (!/^\d+$/u.test(value)) {
    throw new Error('owned_process_creation_identity_ambiguous');
  }
  return `win-created:${value}`;
}

export function boundedSpawn(command, args, options) {
  return new Promise((resolve, reject) => {
    let executable = command;
    let argv = args;
    if (
      process.platform === 'win32'
      && ['.cmd', '.bat'].includes(path.extname(command).toLowerCase())
    ) {
      if (
        [command, ...args].some((value) => /["\r\n&|<>^%!]/u.test(value))
      ) {
        reject(new Error('cli_command_identity_invalid'));
        return;
      }
      executable = process.env.ComSpec ?? 'cmd.exe';
      argv = [
        '/d',
        '/s',
        '/c',
        `"${[command, ...args].map((value) => `"${value}"`).join(' ')}"`,
      ];
    }
    const child = spawn(executable, argv, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.byteLength > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
        finish(safeHarnessCliFailure('cli_failure_envelope_oversize'));
      }
      return next;
    };
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', () =>
      finish(safeHarnessCliFailure('cli_spawn_failed')));
    child.once('close', (code, signal) => {
      if (code !== 0) {
        try {
          finish(
            new PublicCliFailure(
              decodePublicCliFailure(stdout.toString('utf8'))
            )
          );
        } catch (error) {
          finish(invalidPublicCliFailure(stdout.toString('utf8'), error));
        }
        return;
      }
      finish(null, {
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      });
    });
    timer = setTimeout(() => {
      child.kill();
      finish(safeHarnessCliFailure('cli_timeout'));
    }, options.timeoutMs);
    timer.unref?.();
  });
}

export function createObservationDriver(config) {
  const rasenBin = path.resolve(config.rasenBin);
  const actionFile = path.resolve(config.actionFile);
  const rasenHome = path.resolve(config.rasenHome);
  const schedulerSnapshots = new Map();
  const admissionBindings = new Map();
  const schedulerTimings = new Map();
  const schedulerPreterminalProofs = new Map();

  async function runSession(args, identity) {
    const result = await boundedSpawn(
      process.execPath,
      [rasenBin, 'session', ...args, '--json'],
      {
        cwd: identity.cwd,
        env: {
          ...process.env,
          RASEN_TELEMETRY: '0',
          ...(config.rasenHome ? { RASEN_HOME: path.resolve(config.rasenHome) } : {}),
        },
        timeoutMs: config.operationTimeoutMs ?? 30 * 60 * 1000,
      }
    );
    return parseJsonDocument(result.stdout);
  }

  async function listExactSession(identity, { allowAbsent = false } = {}) {
    const injected = typeof config.readExactSession === 'function';
    const response = injected
      ? {
          ok: true,
          sessions: [
            await config.readExactSession(identity),
          ].filter((value) => value !== null),
        }
      : await runSession(
          ['list', '--run', identity.runId],
          identity
        );
    if (response.ok !== true || !Array.isArray(response.sessions)) {
      throw new Error('session_binding_list_invalid');
    }
    const matches = response.sessions.filter(
      (candidate) => candidate?.sessionKey === identity.sessionKey
    );
    if (matches.length === 0 && allowAbsent) return null;
    if (matches.length !== 1) throw new Error('session_binding_ambiguous');
    const projected = matches[0];
    if (
      path.resolve(projected.cwd ?? '') !== path.resolve(identity.cwd)
      || JSON.stringify({
        mode: projected.touchPolicy?.mode,
        deadlineAt: projected.touchPolicy?.deadlineAt ?? null,
        maxTouches: projected.touchPolicy?.maxTouches,
        deadlineAction: projected.touchPolicy?.deadlineAction,
      }) !== JSON.stringify(identity.policy)
    ) {
      throw new Error('session_binding_identity_drift');
    }
    if (injected) return projected;
    const durable = captureExactDurableSession({
      rasenHome,
      identity,
    });
    if (
      durable.status !== projected.status
      || JSON.stringify(durable.lifecycle)
        !== JSON.stringify(projected.lifecycle)
      || JSON.stringify(durable.touchPolicy)
        !== JSON.stringify(projected.touchPolicy)
      || JSON.stringify(
        durable.wakes.map((wake) => ({
          admittedAt: wake.admittedAt,
          ...(wake.dispatchFenceAt !== undefined
            ? { dispatchFenceAt: wake.dispatchFenceAt }
            : {}),
          settledAt: wake.settledAt,
          outcome: wake.outcome,
          ...(wake.kind !== undefined ? { kind: wake.kind } : {}),
          ...(wake.touchOrdinal !== undefined
            ? { touchOrdinal: wake.touchOrdinal }
            : {}),
          ...(wake.touchAttempt !== undefined
            ? { touchAttempt: wake.touchAttempt }
            : {}),
          ...(wake.code !== undefined ? { code: wake.code } : {}),
        }))
      ) !== JSON.stringify(projected.wakes)
    ) {
      throw new Error('session_public_durable_projection_drift');
    }
    return durable;
  }

  async function captureOwnedProcessBinding(identity) {
    const session = await listExactSession(identity);
    const owner = session.owner;
    if (
      owner === null
      || typeof owner !== 'object'
      || typeof owner.ownerInstanceId !== 'string'
      || !Number.isSafeInteger(owner.ownerPid)
      || typeof owner.hostId !== 'string'
      || !Number.isSafeInteger(owner.childPid)
      || typeof owner.boundAt !== 'string'
    ) {
      throw new Error('owned_process_binding_absent_or_ambiguous');
    }
    return {
      ownerInstanceId: owner.ownerInstanceId,
      ownerPid: owner.ownerPid,
      ownerProcessCreationIdentity: await processCreationIdentity(
        owner.ownerPid,
        config,
        identity.cwd
      ),
      hostId: owner.hostId,
      childPid: owner.childPid,
      childProcessCreationIdentity: await processCreationIdentity(
        owner.childPid,
        config,
        identity.cwd
      ),
      boundAt: owner.boundAt,
    };
  }

  async function requireOwnedProcessBinding(identity, expected) {
    if (expected === null || typeof expected !== 'object') {
      throw new Error('owned_process_admission_binding_missing');
    }
    const current = await captureOwnedProcessBinding(identity);
    if (
      stableBindingFingerprint(current)
        !== stableBindingFingerprint(expected)
      || new Date(current.boundAt).valueOf()
        < new Date(expected.boundAt).valueOf()
    ) {
      throw new Error('owned_process_binding_drift');
    }
    return current;
  }

  async function verifyCandidateState(identity, options = {}) {
    if (config.admissionProofMode === true) {
      if (process.env.RASEN_SESSION_CACHE_ADMISSION_PROOF !== '1') {
        throw new Error('admission_proof_opt_in_required');
      }
      if (
        !regularFile(rasenBin)
        || !regularFile(actionFile)
        || fs.realpathSync.native(identity.cwd) !== path.resolve(identity.cwd)
        || JSON.stringify(currentBinaryFiles(config.candidate.repositoryRoot))
          !== JSON.stringify(config.binaryFiles)
        || hashExactFileSet(
          config.candidate.repositoryRoot,
          config.binaryFiles
        ) !== config.candidate.binaryFingerprint
        || fingerprintSelectedExecutable(config.claude.binaryPath)
          !== config.claude.binaryFingerprint
      ) {
        throw new Error('admission_proof_candidate_drift');
      }
      if (
        typeof config.claude.version !== 'string'
        || config.claude.version.length === 0
        || config.claude.version.length > 512
      ) {
        throw new Error('claude_version_drift');
      }
      return inspectManagementServerCapacity({
        daemonStatePath: config.daemonStatePath,
        daemon: config.daemon,
        requiredAvailableSlots:
          options.requiredAvailableSlots ?? 1,
      });
    }
    const manifestPaths = readPathManifest(config.deliveryManifestPath);
    const delivery = deriveDeliveryTree({
      repositoryRoot: config.candidate.repositoryRoot,
      baselineRef: config.candidate.baselineSha,
      changedPaths: manifestPaths,
    });
    if (
      delivery.baselineSha !== config.candidate.baselineSha
      || delivery.treeOid !== config.candidate.treeOid
      || delivery.contentFingerprint !== config.candidate.contentFingerprint
      || delivery.deliveryManifestFingerprint
        !== config.candidate.deliveryManifestFingerprint
    ) {
      throw new Error('candidate_tree_drift');
    }
    if (
      JSON.stringify(currentBinaryFiles(config.candidate.repositoryRoot))
        !== JSON.stringify(config.binaryFiles)
      || hashExactFileSet(
        config.candidate.repositoryRoot,
        config.binaryFiles
      ) !== config.candidate.binaryFingerprint
    ) {
      throw new Error('candidate_binary_drift');
    }
    let capacity;
    if (options.capacity === true) {
      try {
        capacity = await inspectPhysicalCapacity({
          daemonStatePath: config.daemonStatePath,
          daemon: config.daemon,
          rasenBin,
          repositoryRoot: config.candidate.repositoryRoot,
          binaryFiles: config.binaryFiles,
          binaryFingerprint: config.candidate.binaryFingerprint,
          candidate: config.candidate,
          supervisorModule: config.supervisorModule,
          armIds: Object.keys(config.allArmIdentities),
          sessionKeys: Object.values(config.allArmIdentities),
          requiredAvailableSlots: options.requiredAvailableSlots,
        });
      } catch {
        throw new Error('daemon_capacity_drift');
      }
    } else {
      try {
        await inspectDaemonIdentity({
          daemonStatePath: config.daemonStatePath,
          daemon: config.daemon,
          rasenBin,
          repositoryRoot: config.candidate.repositoryRoot,
          binaryFiles: config.binaryFiles,
          binaryFingerprint: config.candidate.binaryFingerprint,
        });
      } catch {
        throw new Error('daemon_identity_drift');
      }
    }
    if (
      fingerprintSelectedExecutable(config.claude.binaryPath)
      !== config.claude.binaryFingerprint
    ) {
      throw new Error('claude_binary_drift');
    }
    const claudeVersion = await boundedSpawn(
      config.claude.binaryPath,
      ['--version'],
      {
        cwd: identity.cwd,
        env: process.env,
        timeoutMs: 15_000,
      }
    );
    if (
      claudeVersion.stdout.trim() !== config.claude.version
      || claudeVersion.stdout.length > 512
    ) {
      throw new Error('claude_version_drift');
    }
    return capacity;
  }

  return {
    captureOwnedProcessBinding,
    requireOwnedProcessBinding,
    async preflight({ armId, identity, requiredIsolatedSlots }) {
      if (config.admissionProofMode === true) {
        const isolatedIdentities = new Set(
          Object.values(config.allArmIdentities)
        );
        const capacity = await verifyCandidateState(identity, {
          capacity: true,
          requiredAvailableSlots: requiredIsolatedSlots,
        });
        return {
          isolated:
            isolatedIdentities.has(identity.sessionKey)
            && isolatedIdentities.size >= requiredIsolatedSlots,
          capacityVerified:
            capacity?.schema
              === 'rasen-session-management-capacity-observation/1',
          availableSlots: capacity?.availableSlots ?? 0,
        };
      }
      const proofPath = path.resolve(config.capacityProofPath);
      const proofStat = fs.lstatSync(proofPath);
      if (
        !proofStat.isFile()
        || proofStat.isSymbolicLink()
        || proofStat.size > 64 * 1024
        || fs.realpathSync.native(proofPath) !== proofPath
      ) {
        throw new Error('capacity_proof_file_invalid');
      }
      const proof = parseJsonDocument(
        fs.readFileSync(proofPath, 'utf8')
      );
      const isolatedIdentities = new Set(
        Object.values(config.allArmIdentities)
      );
      const supervisorModuleFingerprint = sha256File(config.supervisorModule);
      verifyCapacityProofDocument(proof, {
        candidate: config.candidate,
        daemon: config.daemon,
        supervisorModuleFingerprint,
      });
      const capacity = await verifyCandidateState(identity, {
        capacity: true,
        requiredAvailableSlots: requiredIsolatedSlots,
      });
      return {
        isolated:
          regularFile(rasenBin)
          && regularFile(actionFile)
          && fs.realpathSync.native(identity.cwd) === path.resolve(identity.cwd)
          && isolatedIdentities.has(identity.sessionKey)
          && isolatedIdentities.size >= requiredIsolatedSlots,
        capacityVerified:
          capacity?.candidateFingerprint === config.candidate.contentFingerprint
          && proof?.armIds?.includes(armId),
        availableSlots: capacity?.supervisor?.availableSlots ?? 0,
      };
    },
    async bootstrap({
      armId,
      identity,
      startedAt,
      cadenceToleranceMs,
      deadlineApplicationToleranceMs,
      persistBootstrapState,
    }) {
      const args = [
        'exec',
        '--run',
        identity.runId,
        '--session',
        identity.sessionKey,
        '--action',
        actionFile,
        '--cwd',
        identity.cwd,
        '--message-id',
        `${armId}-bootstrap`,
        '--touch',
        identity.policy.mode,
        '--deadline-action',
        identity.policy.deadlineAction,
      ];
      if (identity.policy.mode === 'auto') {
        args.push(
          '--touch-deadline',
          identity.policy.deadlineAt,
          '--max-touches',
          String(identity.policy.maxTouches)
        );
      }
      const response = await runSession(args, identity);
      if (response.ok !== true) throw new Error('bootstrap_not_completed');
      const admissionBinding = await captureOwnedProcessBinding(identity);
      admissionBindings.set(armId, admissionBinding);
      let schedulerBaseline = null;
      let controlContextBaselineTokens = null;
      if (identity.policy.mode === 'auto') {
        if (
          !Number.isInteger(cadenceToleranceMs)
          || cadenceToleranceMs <= 0
          || !Number.isInteger(deadlineApplicationToleranceMs)
          || deadlineApplicationToleranceMs <= 0
        ) {
          throw new Error('scheduler_tolerance_invalid');
        }
        schedulerBaseline = captureExactTranscriptBaseline({
          rasenHome,
          claudeHome: config.claude.home,
          identity,
          capturedAt: new Date().toISOString(),
        });
        if (
          new Date(schedulerBaseline.capturedAt).valueOf()
          < new Date(startedAt).valueOf()
        ) {
          throw new Error('scheduler_eligibility_before_result_start');
        }
        schedulerSnapshots.set(armId, restoreExactTranscriptBaseline({
          rasenHome,
          claudeHome: config.claude.home,
          identity,
          baseline: schedulerBaseline,
        }));
        schedulerTimings.set(armId, {
          cadenceToleranceMs,
          deadlineApplicationToleranceMs,
        });
      } else {
        controlContextBaselineTokens =
          config.admissionProofMode === true
            ? null
            : captureExactTranscriptContextBaseline({
              rasenHome,
              claudeHome: config.claude.home,
              identity,
            }).contextTokens;
      }
      await persistBootstrapState?.({
        admissionBinding,
        schedulerBaseline,
        controlContextBaselineTokens,
      });
      return {
        admissionBinding,
        schedulerBaseline,
        controlContextBaselineTokens,
      };
    },
    async resume({ armId, identity, checkpoint }) {
      if (config.admissionProofMode === true) {
        throw new Error('admission_proof_resume_prohibited');
      }
      const admissionBinding = await requireOwnedProcessBinding(
        identity,
        checkpoint.admissionBinding
      );
      admissionBindings.set(armId, admissionBinding);
      let schedulerBaseline = null;
      if (identity.policy.mode === 'auto') {
        schedulerBaseline = checkpoint.schedulerBaseline;
        if (schedulerBaseline === null) {
          throw new Error('scheduler_transcript_baseline_missing');
        }
        schedulerSnapshots.set(armId, restoreExactTranscriptBaseline({
          rasenHome,
          claudeHome: config.claude.home,
          identity,
          baseline: schedulerBaseline,
        }));
        schedulerTimings.set(armId, {
          cadenceToleranceMs: checkpoint.cadenceToleranceMs,
          deadlineApplicationToleranceMs:
            checkpoint.deadlineApplicationToleranceMs,
        });
        if (checkpoint.schedulerPreterminalOwnerProof !== null) {
          schedulerPreterminalProofs.set(
            armId,
            checkpoint.schedulerPreterminalOwnerProof
          );
        }
      }
      return {
        admissionBinding,
        schedulerBaseline,
        controlContextBaselineTokens:
          checkpoint.controlContextBaselineTokens,
      };
    },
    async wakeAndReadUsage({ armId, identity }) {
      if (config.admissionProofMode === true) {
        throw new Error('admission_proof_observation_prohibited');
      }
      const before = captureExactTranscriptState({
        rasenHome,
        claudeHome: config.claude.home,
        identity,
      });
      const response = await runSession(
        [
          'exec',
          '--run',
          identity.runId,
          '--session',
          identity.sessionKey,
          '--action',
          actionFile,
          '--cwd',
          identity.cwd,
          '--message-id',
          `${armId}-observation`,
          '--touch',
          'never',
        ],
        identity
      );
      if (response.ok !== true) throw new Error('observation_wake_not_completed');
      return {
        usageCounters: extractExactAppendedUsage({
          rasenHome,
          claudeHome: config.claude.home,
          identity,
          before,
        }),
        touchesObserved: 0,
        deadlineApplied: false,
        clockAmbiguous: false,
      };
    },
    async inspectScheduler({
      armId,
      identity,
      signal,
      persistPreterminalProof,
    }) {
      if (config.admissionProofMode === true) {
        throw new Error('admission_proof_observation_prohibited');
      }
      const deadline = new Date(identity.policy.deadlineAt ?? '').valueOf();
      if (!Number.isFinite(deadline)) throw new Error('scheduler_deadline_invalid');
      const before = schedulerSnapshots.get(armId);
      if (before === undefined) throw new Error('scheduler_transcript_snapshot_missing');
      const timing = schedulerTimings.get(armId);
      if (
        !Number.isInteger(timing?.cadenceToleranceMs)
        || timing.cadenceToleranceMs <= 0
        || !Number.isInteger(timing?.deadlineApplicationToleranceMs)
        || timing.deadlineApplicationToleranceMs <= 0
      ) {
        throw new Error('scheduler_tolerance_missing');
      }
      const stopAt = deadline + timing.deadlineApplicationToleranceMs;
      while (Date.now() <= stopAt) {
        const session = await listExactSession(identity);
        const touches = (session.wakes ?? []).filter(
          (wake) =>
            wake.kind === 'touch'
            && wake.outcome === 'completed'
        );
        const completedWakesSinceBaseline = (session.wakes ?? []).filter(
          (wake) =>
            wake.outcome === 'completed'
            && typeof wake.admittedAt === 'string'
            && new Date(wake.admittedAt).valueOf()
              >= new Date(before.capturedAt).valueOf()
        );
        const touch = touches[0];
        const ordinalAgreement =
          touches.length === 1
          && completedWakesSinceBaseline.length === 1
          && completedWakesSinceBaseline[0] === touch
          && touch?.touchOrdinal === 1
          && Number.isInteger(touch?.touchAttempt)
          && touch.touchAttempt > 0
          && session.touchPolicy?.touchesUsed === 1
          && /^[a-f0-9]{64}$/u.test(touch?.messageIdDigest ?? '')
          && /^[a-f0-9]{64}$/u.test(touch?.resultDigest ?? '')
          && typeof touch?.dispatchFenceAt === 'string'
          && touch.messageIdDigest === schedulerTouchMessageIdDigest(
            identity,
            touch.touchOrdinal,
            touch.touchAttempt
          );
        if (touch !== undefined && !ordinalAgreement) {
          throw new Error('scheduler_touch_durable_binding_invalid');
        }
        if (
          ordinalAgreement
          && session.status !== 'retired'
          && !schedulerPreterminalProofs.has(armId)
        ) {
          if (session.claudeSessionId !== before.claudeSessionId) {
            throw new Error('scheduler_claude_session_identity_drift');
          }
          const currentBinding = await requireOwnedProcessBinding(
            identity,
            admissionBindings.get(armId)
          );
          if (currentBinding.boundAt !== touch.settledAt) {
            throw new Error('scheduler_preterminal_owner_history_invalid');
          }
          const proof = {
            admissionBindingFingerprint: stableBindingFingerprint(
              admissionBindings.get(armId)
            ),
            ownerBindingFingerprint: digestJson(currentBinding),
            claudeSessionIdDigest: createHash('sha256')
              .update(before.claudeSessionId, 'utf8')
              .digest('hex'),
            touchMessageIdDigest: touch.messageIdDigest,
            touchOrdinal: 1,
            touchAttempt: touch.touchAttempt,
            touchSettledAt: touch.settledAt,
            observedAt: new Date().toISOString(),
          };
          schedulerPreterminalProofs.set(armId, proof);
          await persistPreterminalProof?.(proof);
        }
        const terminal =
          session.status === 'retired'
          && session.owner === undefined
          && session.lifecycle?.reason === 'touch-deadline-expired'
          && typeof session.lifecycle?.retiredAt === 'string'
          && session.touchPolicy?.deadlineAction === 'retire-silent'
            ? {
                action: 'retire-silent',
                reason: 'touch-deadline-expired',
                appliedAt: session.lifecycle.retiredAt,
              }
            : null;
        const deadlineApplied = terminal !== null;
        if (deadlineApplied) {
          const preterminal = schedulerPreterminalProofs.get(armId);
          if (preterminal === undefined) {
            throw new Error('scheduler_preterminal_owner_proof_missing');
          }
          if (session.claudeSessionId !== before.claudeSessionId) {
            throw new Error('scheduler_terminal_logical_identity_drift');
          }
          const touchAdmittedAt = touch?.admittedAt;
          const touchSettledAt = touch?.settledAt;
          if (
            typeof touchAdmittedAt !== 'string'
            || typeof touchSettledAt !== 'string'
          ) {
            throw new Error('scheduler_touch_timestamp_missing');
          }
          if (!ordinalAgreement) {
            throw new Error('scheduler_touch_durable_binding_invalid');
          }
          if (
            preterminal.touchMessageIdDigest !== touch.messageIdDigest
            || preterminal.touchAttempt !== touch.touchAttempt
            || preterminal.touchSettledAt !== touch.settledAt
          ) {
            throw new Error('scheduler_preterminal_owner_proof_drift');
          }
          const append = inspectSchedulerTranscriptCausalAppend({
            rasenHome,
            claudeHome: config.claude.home,
            identity,
            before,
            expected: {
              claudeSessionId: before.claudeSessionId,
              dispatchFenceAt: touch.dispatchFenceAt,
              settledAt: touch.settledAt,
            },
          });
          if (
            append.proof.transcriptTouchTextDigest
              !== schedulerTouchTextDigest()
          ) {
            throw new Error('scheduler_touch_text_digest_invalid');
          }
          const preterminalOwnerProofFingerprint = digestJson(preterminal);
          const terminalLogicalSessionFingerprint = digestJson({
            runId: identity.runId,
            sessionKey: identity.sessionKey,
            cwd: path.resolve(identity.cwd),
            claudeSessionId: before.claudeSessionId,
          });
          const bindingValues = {
            runId: identity.runId,
            sessionKey: identity.sessionKey,
            claudeSessionIdDigest: append.proof.claudeSessionIdDigest,
            touchOrdinal: 1,
            touchAttempt: touch.touchAttempt,
            touchMessageIdDigest: touch.messageIdDigest,
            transcriptTouchTextDigest:
              append.proof.transcriptTouchTextDigest,
            touchAt: touchAdmittedAt,
            touchDispatchedAt: touch.dispatchFenceAt,
            transcriptTouchAt: append.proof.transcriptTouchAt,
            transcriptAssistantAt: append.proof.transcriptAssistantAt,
            transcriptUserRows: append.proof.transcriptUserRows,
            transcriptProviderRequests: append.proof.transcriptProviderRequests,
            touchSettledAt,
            touchResultDigest: touch.resultDigest,
            transcriptAssistantChainFingerprint:
              append.proof.transcriptAssistantChainFingerprint,
            preterminalOwnerProofFingerprint,
            terminalLogicalSessionFingerprint,
          };
          return {
            usageCounters: null,
            touchesObserved: ordinalAgreement ? 1 : touches.length,
            deadlineApplied,
            clockAmbiguous: !ordinalAgreement,
            schedulerEvidence: {
              eligibilityAt: before.capturedAt,
              touchAt: touchAdmittedAt,
              expectedCadenceMs: 50 * 60 * 1000,
              cadenceToleranceMs: timing.cadenceToleranceMs,
              deadlineApplicationToleranceMs:
                timing.deadlineApplicationToleranceMs,
              ...append.proof,
              completedWakeCountSinceBaseline:
                completedWakesSinceBaseline.length,
              touchOrdinal: 1,
              touchAttempt: touch.touchAttempt,
              touchesUsed: 1,
              touchMessageIdDigest: touch.messageIdDigest,
              touchResultDigest: touch.resultDigest,
              touchDispatchedAt: touch.dispatchFenceAt,
              preterminalOwnerProofFingerprint,
              terminalLogicalSessionFingerprint,
              touchTranscriptBindingFingerprint:
                digestJson(bindingValues),
              touchSettledAt,
              deadlineReason: terminal.reason,
              deadlineAction: terminal.action,
              configuredDeadlineAt: session.touchPolicy.deadlineAt,
              deadlineAppliedAt: terminal.appliedAt,
            },
          };
        }
        await (config.schedulerDelay ?? referencedDelay)(
          config.schedulerPollIntervalMs ?? 30_000,
          signal
        );
      }
      throw new Error('scheduler_deadline_not_observed');
    },
    async revalidateIdentity({
      armId,
      identity,
      admissionBinding,
      observation,
    }) {
      await (config.revalidateCandidateState ?? verifyCandidateState)(
        identity,
        { capacity: false }
      );
      if (identity.policy.mode === 'auto') {
        const evidence = observation?.schedulerEvidence;
        const session = await listExactSession(identity);
        const baseline = schedulerSnapshots.get(armId);
        const preterminal = schedulerPreterminalProofs.get(armId);
        const terminalTouches = (session.wakes ?? []).filter(
          (wake) =>
            wake.kind === 'touch'
            && wake.outcome === 'completed'
        );
        const terminalTouch = terminalTouches[0];
        if (evidence === null || typeof evidence !== 'object') {
          throw new Error('scheduler_terminal_evidence_missing');
        }
        if (baseline === undefined) {
          throw new Error('scheduler_terminal_baseline_missing');
        }
        if (preterminal === undefined) {
          throw new Error('scheduler_terminal_preterminal_missing');
        }
        if (
          session.status !== 'retired'
          || session.owner !== undefined
          || session.claudeSessionId !== baseline.claudeSessionId
          || session.lifecycle?.reason !== evidence.deadlineReason
          || session.lifecycle?.retiredAt !== evidence.deadlineAppliedAt
          || session.touchPolicy?.deadlineAt
            !== evidence.configuredDeadlineAt
          || session.touchPolicy?.deadlineAction
            !== evidence.deadlineAction
          || session.touchPolicy?.touchesUsed !== 1
        ) {
          throw new Error('scheduler_terminal_projection_drift');
        }
        if (
          terminalTouches.length !== 1
          || terminalTouch?.touchOrdinal !== evidence.touchOrdinal
          || terminalTouch?.touchAttempt !== evidence.touchAttempt
          || terminalTouch?.messageIdDigest
            !== evidence.touchMessageIdDigest
          || terminalTouch?.resultDigest !== evidence.touchResultDigest
          || terminalTouch?.admittedAt !== evidence.touchAt
          || terminalTouch?.dispatchFenceAt
            !== evidence.touchDispatchedAt
          || terminalTouch?.settledAt !== evidence.touchSettledAt
        ) {
          throw new Error('scheduler_terminal_wake_drift');
        }
        if (
          digestJson(preterminal)
            !== evidence.preterminalOwnerProofFingerprint
        ) {
          throw new Error('scheduler_terminal_preterminal_drift');
        }
        if (
          digestJson({
            runId: identity.runId,
            sessionKey: identity.sessionKey,
            cwd: path.resolve(identity.cwd),
            claudeSessionId: baseline.claudeSessionId,
          }) !== evidence.terminalLogicalSessionFingerprint
        ) {
          throw new Error('scheduler_terminal_logical_identity_drift');
        }
        return;
      }
      const expected = admissionBinding ?? admissionBindings.get(armId);
      await requireOwnedProcessBinding(identity, expected);
    },
    async retireOrProveAbsent({ identity, admissionBinding }) {
      const existing = await listExactSession(identity, { allowAbsent: true });
      if (existing === null) return { state: 'absent' };
      if (existing.status === 'retired' && existing.owner === undefined) {
        return { state: 'retired' };
      }
      await requireOwnedProcessBinding(identity, admissionBinding);
      const response =
        typeof config.retireExactSession === 'function'
          ? await config.retireExactSession(
              identity,
              'candidate-superseded'
            )
          : await runSession(
              [
                'retire',
                '--run',
                identity.runId,
                '--session',
                identity.sessionKey,
                '--reason',
                'candidate-superseded',
              ],
              identity
            );
      if (
        response.ok !== true
        || response.session?.status !== 'retired'
        || response.session?.owner !== undefined
        || response.session?.lifecycle?.reason !== 'candidate-superseded'
        || path.resolve(response.session?.cwd ?? '')
          !== path.resolve(identity.cwd)
      ) {
        throw new Error('supersede_retirement_unproven');
      }
      const verified = await listExactSession(identity);
      if (
        verified.status !== 'retired'
        || verified.owner !== undefined
        || verified.lifecycle?.reason !== 'candidate-superseded'
      ) {
        throw new Error('supersede_retirement_unproven');
      }
      return { state: 'retired' };
    },
  };
}
