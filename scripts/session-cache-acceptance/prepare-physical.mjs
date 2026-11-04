import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  fingerprintSelectedExecutable,
  hashExactFileSet,
  inspectPhysicalCapacity,
} from './physical-preflight.mjs';
import {
  deriveDeliveryTree,
  readPathManifest,
} from './delivery-candidate.mjs';
import {
  OBSERVATION_ARMS,
  readJsonBounded,
  writeJsonAtomic,
} from './protocol.mjs';

export const PHYSICAL_OPERATION_TIMEOUT_MS = 30 * 60 * 1000;

export function derivePhysicalSchedulerDeadlineAt(
  preparedAt = Date.now()
) {
  const scheduler = OBSERVATION_ARMS['scheduler-cadence-deadline'];
  return new Date(
    preparedAt
      + PHYSICAL_OPERATION_TIMEOUT_MS
      + scheduler.expectedCadenceMs
      + scheduler.cadenceToleranceMs
      + scheduler.deadlineApplicationToleranceMs
  ).toISOString();
}

export function assertPhysicalSchedulerDeadlineFresh(
  deadlineAt,
  launchedAt = Date.now(),
  operationTimeoutMs = PHYSICAL_OPERATION_TIMEOUT_MS
) {
  const deadline = new Date(deadlineAt).valueOf();
  const scheduler = OBSERVATION_ARMS['scheduler-cadence-deadline'];
  const latestValidFirstTouchMs =
    operationTimeoutMs
    + scheduler.expectedCadenceMs
    + scheduler.cadenceToleranceMs;
  if (
    !Number.isFinite(deadline)
    || !Number.isFinite(launchedAt)
    || !Number.isInteger(operationTimeoutMs)
    || operationTimeoutMs <= 0
    || deadline - launchedAt <= latestValidFirstTouchMs
  ) {
    throw new Error('physical_scheduler_deadline_budget_stale');
  }
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required ${name}`);
  }
  if (index + 1 >= process.argv.length) throw new Error(`Missing value for ${name}`);
  return process.argv[index + 1];
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

function commandVersion(binaryPath, cwd) {
  if (
    process.platform === 'win32'
    && ['.cmd', '.bat'].includes(path.extname(binaryPath).toLowerCase())
  ) {
    if (/["\r\n]/u.test(binaryPath)) throw new Error('claude_binary_path_invalid');
    return run(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `""${binaryPath}" "--version""`],
      cwd
    ).trim();
  }
  return run(binaryPath, ['--version'], cwd).trim();
}

function resolvedClaudeSelection(repositoryRoot) {
  if (process.env.RASEN_CLAUDE_BIN) {
    return fs.realpathSync.native(path.resolve(process.env.RASEN_CLAUDE_BIN));
  }
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const selected = run(command, ['claude'], repositoryRoot)
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (selected === undefined) throw new Error('claude_binary_unavailable');
  return fs.realpathSync.native(path.resolve(selected));
}

function binaryFiles(repositoryRoot) {
  const files = ['bin/rasen.js', 'package.json'];
  const root = path.join(repositoryRoot, 'dist');
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.relative(repositoryRoot, absolute).replace(/\\/gu, '/'));
      }
    }
  };
  walk(root);
  return files.sort();
}

function safeDaemonIdentity(rasenHome) {
  const statePath = path.join(rasenHome, 'daemon', 'daemon.json');
  const stat = fs.lstatSync(statePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new Error('daemon_state_invalid');
  }
  const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (
    typeof value?.version !== 'string'
    || !Number.isSafeInteger(value?.pid)
    || !Number.isSafeInteger(value?.port)
  ) {
    throw new Error('daemon_state_invalid');
  }
  return {
    statePath,
    daemon: {
      version: value.version,
      pid: value.pid,
      port: value.port,
    },
  };
}

function digest(label) {
  return createHash('sha256').update(label).digest('hex');
}

function initializeWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  if (!fs.existsSync(path.join(workspace, '.git'))) {
    run('git', ['init', '--quiet'], workspace);
  }
  return fs.realpathSync.native(workspace);
}

export async function createAdmittedAction(input) {
  const dist = (...segments) =>
    pathToFileURL(path.join(input.repositoryRoot, 'dist', ...segments)).href;
  const [
    registryModule,
    profileModule,
    executionProfileModule,
    runtimeModule,
    identityModule,
  ] = await Promise.all([
    import(dist('core', 'pipeline-registry', 'prepared-registry.js')),
    import(dist('core', 'pipeline-registry', 'profile-resolver.js')),
    import(dist('core', 'pipeline-registry', 'execution-plan-internal.js')),
    import(dist('core', 'change-run', 'internal', 'runtime-context.js')),
    import(dist('core', 'change-run', 'internal', 'identity.js')),
  ]);
  const registry = await registryModule.freezeProductionPreparedPipelineRegistry(
    input.repositoryRoot,
    { reporter: false }
  );
  const resolution = registry.load('bug-fix');
  const prepared = resolution.prepared;
  const authored = prepared.authoredSource;
  const isV2Authored = prepared.authoredVersion === 2;
  const sourceDisplayName = isV2Authored
    ? prepared.definition.name
    : authored.name;
  const sourceDigest = `sha256:${prepared.digests.source}`;
  const sourceRevision = {
    layer: resolution.source,
    kind: 'pipeline-yaml',
    sourceId: `${resolution.source}:${sourceDisplayName}`,
    authoredContentDigest: sourceDigest,
    semanticDigest: sourceDigest,
  };
  const policyStages = isV2Authored ? [] : authored.stages.map((stage) => ({
    nodeId: `stage:${stage.id}`,
    role: stage.role ?? 'implementer',
    model: stage.model ?? 'default',
    effort: 'medium',
    runtime: 'claude',
    sandbox:
      stage.verifyPolicy === 'adaptive' || stage.id === 'verify'
        ? 'read-only'
        : 'workspace-write',
    gate: stage.gate ?? false,
    sessionReuse: 'same-invocation',
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 8,
    provenance: {
      role: 'stage',
      model: stage.model ? 'stage' : 'default',
      effort: 'acceptance',
      runtime: 'acceptance',
      sandbox: 'default',
      gate: 'stage',
      sessionReuse: 'acceptance',
      handoffTokenLimit: 'acceptance',
      reuseRoundLimit: 'acceptance',
    },
  }));
  const resolvedProfile = profileModule.resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    policyStages,
    sourceRevision,
    { maxAttempts: 32, maxActions: 128 }
  );
  // The physical cache portfolio deliberately exercises reusable turns. The
  // old v1 helper supplied this acceptance policy through policyStages; native
  // v2 profiles resolve authored stages internally, so recreate the sealed
  // profile with the same test-only policy and fresh canonical digests.
  const profile = isV2Authored
    ? executionProfileModule.createRuntimeExecutionProfile({
        sourceRevision: resolvedProfile.sourceRevision,
        capabilities: resolvedProfile.capabilities,
        policy: {
          ...resolvedProfile.policy,
          stages: resolvedProfile.policy.stages.map((stage) => ({
            ...stage,
            sessionReuse: 'same-invocation',
            handoffTokenLimit: 10_000,
            reuseRoundLimit: 8,
            provenance: {
              ...stage.provenance,
              sessionReuse: 'acceptance',
              handoffTokenLimit: 'acceptance',
              reuseRoundLimit: 'acceptance',
            },
          })),
        },
      })
    : resolvedProfile;
  // The workspace belongs in the Run identity, not just in the launch request.
  // Deriving the Run from candidate+arm alone made two isolated workspaces
  // collide on one Run id while their launch digests differed, which the
  // product correctly rejects as launch_request_conflict. Including the
  // workspace keeps the id deterministic per evidence directory and stops
  // unrelated stores from ever sharing a Run.
  const suffix = digest(`${input.armId}:${input.workspace}`);
  const runId = `run:${digest(
    `physical:${input.candidate.contentFingerprint}:${input.armId}:${suffix}`
  )}`;
  // The launch intent must be the product's own derivation, not a value the
  // harness invents. verifyLaunchIntent recomputes it from the normalized
  // pipeline, engine, and inputs and refuses anything else, so the same inputs
  // have to reach both the initial record and start().
  const inputs = { acceptanceArm: input.armId };
  const launchIntent = { pipeline: 'bug-fix', engine: 'reconciler', inputs };
  const context = runtimeModule.prepareRuntimeContext({
    projectRoot: input.workspace,
    prepared,
    profile,
    runId,
    planningSpaceId: `planning-space:${digest('physical-acceptance')}`,
    workspaceInstanceId: `workspace-instance:${suffix}`,
    changeInstanceId: `change-instance:${digest(`change:${suffix}`)}`,
    changeId: `cache-${input.armId.replace(/[^a-z0-9]+/gu, '-')}`,
    projectId: 'session-cache-physical-acceptance',
    launchRequestDigest: identityModule.digestLaunchIntent(launchIntent),
    storeRoot: path.join(input.rasenHome, 'runs'),
    inputs,
  });
  const change = {
    projectRoot: input.workspace,
    changeId: `cache-${input.armId.replace(/[^a-z0-9]+/gu, '-')}`,
  };
  const admitPreview = async (preview) => {
    if (preview.candidates.length === 0) return preview;
    const pending = new Set(preview.candidates.map((candidate) => candidate.candidateId));
    return context.facade.admit(
      { change, runId },
      {
        deliveryMode: 'grant',
        resolveAgentTurnInput: (candidate) => {
          if (!pending.delete(candidate.candidateId)) {
            throw new Error('canonical_agent_candidate_not_previewed');
          }
          return [
            'rasen trusted physical acceptance driver turn input',
            `candidate=${candidate.candidateId}`,
            `node=${candidate.nodeId}`,
            `occurrence=${candidate.occurrence}`,
            `input=${JSON.stringify(candidate.input ?? null)}`,
          ].join('\n');
        },
        finalizeAgentTurnInputs: () => {
          if (pending.size !== 0) throw new Error('canonical_agent_candidate_unused');
        },
      }
    );
  };
  let receipt = await admitPreview(await context.facade.start(
    {
      change,
      pipeline: 'bug-fix',
      launchRequestId: `physical-${input.armId}`,
      engine: 'reconciler',
      inputs,
    },
    { deliveryMode: 'grant' }
  ));
  let action;
  for (let step = 0; step < 32 && action === undefined; step += 1) {
    action = receipt.actions.find(
      (entry) => entry.kind === 'agent' && entry.agent.runtime === 'claude'
    );
    if (action !== undefined) break;
    const record = context.store.load(runId);
    action = Object.values(record.actions)
      .map((entry) => entry.action)
      .find((entry) => entry.kind === 'agent' && entry.agent.runtime === 'claude');
    if (action !== undefined) break;
    const gate = record.waits.find((wait) => wait.kind === 'gate');
    if (gate === undefined || gate.decisionIds.length === 0) break;
    const decisionId = gate.decisionIds[0];
    await context.facade.control(
      {
        format: 'change-run-control/1',
        ref: { change, runId },
        expectedRecordVersion: record.recordVersion,
        command: {
          kind: 'decision',
          waitId: gate.waitId,
          decisionId,
          outcome: decisionId,
        },
      },
      { deliveryMode: 'grant' }
    );
    receipt = await admitPreview(await context.facade.resume(
      { change, runId },
      { deliveryMode: 'grant' }
    ));
  }
  if (action === undefined) throw new Error('canonical_agent_action_not_admitted');
  return { runId, action };
}

export async function preparePhysicalObservation(input) {
  const repositoryRoot = fs.realpathSync.native(path.resolve(input.repositoryRoot));
  fs.mkdirSync(path.resolve(input.workDir), { recursive: true });
  const workDir = fs.realpathSync.native(path.resolve(input.workDir));
  const rasenHome = fs.realpathSync.native(path.resolve(input.rasenHome));
  const deliveryManifestPath = fs.realpathSync.native(
    path.resolve(
      input.deliveryManifestPath
      ?? path.join(
        repositoryRoot,
        'rasen',
        'changes',
        'session-cache-optimization-acceptance-evidence',
        'delivery-manifest.json'
      )
    )
  );
  const delivery = deriveDeliveryTree({
    repositoryRoot,
    baselineRef: input.baselineRef ?? 'HEAD',
    changedPaths: readPathManifest(deliveryManifestPath),
  });
  const listedBinaryFiles = binaryFiles(repositoryRoot);
  let candidate = {
    contentFingerprint: delivery.contentFingerprint,
    binaryFingerprint: hashExactFileSet(repositoryRoot, listedBinaryFiles),
    repositoryRoot,
    createdAt: new Date().toISOString(),
    baselineSha: delivery.baselineSha,
    treeOid: delivery.treeOid,
    deliveryManifestFingerprint: delivery.deliveryManifestFingerprint,
  };
  const freezePath = path.join(workDir, 'delivery-freeze.json');
  if (fs.existsSync(freezePath)) {
    const frozen = readJsonBounded(freezePath, 1024 * 1024);
    if (
      frozen?.schema !== 'rasen-session-cache-delivery-freeze/1'
      || frozen.candidate?.contentFingerprint
        !== candidate.contentFingerprint
      || frozen.candidate?.binaryFingerprint
        !== candidate.binaryFingerprint
      || path.resolve(frozen.candidate?.repositoryRoot ?? '')
        !== candidate.repositoryRoot
      || frozen.candidate?.baselineSha !== candidate.baselineSha
      || frozen.candidate?.treeOid !== candidate.treeOid
      || frozen.candidate?.deliveryManifestFingerprint
        !== candidate.deliveryManifestFingerprint
    ) {
      throw new Error('physical_preparation_freeze_mismatch');
    }
    candidate = frozen.candidate;
  }
  const claudeBinary = fs.realpathSync.native(path.resolve(input.claudeBinary));
  if (claudeBinary !== resolvedClaudeSelection(repositoryRoot)) {
    throw new Error('claude_binary_selection_mismatch');
  }
  const claude = {
    binaryPath: claudeBinary,
    binaryFingerprint: fingerprintSelectedExecutable(claudeBinary),
    version: commandVersion(claudeBinary, repositoryRoot),
    home: path.resolve(input.claudeHome),
  };
  if (claude.version.length === 0 || claude.version.length > 512) {
    throw new Error('claude_version_invalid');
  }
  const { statePath, daemon } = safeDaemonIdentity(rasenHome);
  const supervisorModule = path.join(
    repositoryRoot,
    'dist',
    'core',
    'management-api',
    'supervisor.js'
  );
  const armIds = Object.keys(OBSERVATION_ARMS);
  const sessionKeys = armIds.map((armId) => `physical-${armId}`);
  const capacity = await inspectPhysicalCapacity({
    daemonStatePath: statePath,
    daemon,
    rasenBin: path.join(repositoryRoot, 'bin', 'rasen.js'),
    repositoryRoot,
    binaryFiles: listedBinaryFiles,
    binaryFingerprint: candidate.binaryFingerprint,
    candidate,
    supervisorModule,
    armIds,
    sessionKeys,
    requiredAvailableSlots: 3,
  });
  const capacityProofPath = path.join(workDir, 'capacity-proof.json');
  writeJsonAtomic(capacityProofPath, capacity);

  const configs = [];
  const allArmIdentities = Object.fromEntries(
    armIds.map((armId, index) => [armId, sessionKeys[index]])
  );
  for (const [index, armId] of armIds.entries()) {
    const armRoot = path.join(workDir, 'physical', armId);
    const workspace = initializeWorkspace(path.join(armRoot, 'workspace'));
    const admitted = await createAdmittedAction({
      repositoryRoot,
      rasenHome,
      candidate,
      armId,
      workspace,
    });
    const actionFile = path.join(armRoot, 'action.json');
    writeJsonAtomic(actionFile, admitted.action);
    const automatic = OBSERVATION_ARMS[armId].automaticTouch;
    const deadlineAt = automatic
      ? derivePhysicalSchedulerDeadlineAt()
      : null;
    const config = {
      actionFile,
      armId,
      allArmIdentities,
      binaryFiles: listedBinaryFiles,
      candidate,
      cadenceToleranceMs: automatic
        ? OBSERVATION_ARMS[armId].cadenceToleranceMs
        : null,
      capacityObservedAt: capacity.observedAt,
      capacityProofPath,
      claude,
      daemon: capacity.daemon,
      daemonStatePath: statePath,
      driverModule: path.join(
        repositoryRoot,
        'scripts',
        'session-cache-acceptance',
        'rasen-cli-driver.mjs'
      ),
      deliveryManifestPath,
      deadlineApplicationToleranceMs: automatic
        ? OBSERVATION_ARMS[armId].deadlineApplicationToleranceMs
        : null,
      identity: {
        runId: admitted.runId,
        sessionKey: sessionKeys[index],
        cwd: workspace,
        policy: {
          mode: automatic ? 'auto' : 'never',
          deadlineAt,
          maxTouches: automatic ? 1 : 0,
          deadlineAction: 'retire-silent',
        },
      },
      operationTimeoutMs: PHYSICAL_OPERATION_TIMEOUT_MS,
      rasenBin: path.join(repositoryRoot, 'bin', 'rasen.js'),
      rasenHome,
      supervisorModule,
      workDir,
    };
    const configPath = path.join(armRoot, 'observation-config.json');
    writeJsonAtomic(configPath, config);
    configs.push(configPath);
  }
  return { candidate, capacity, configs };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await preparePhysicalObservation({
    repositoryRoot: option('--repository-root', process.cwd()),
    workDir: option('--work-dir'),
    rasenHome: option('--rasen-home'),
    claudeBinary: option('--claude-bin'),
    claudeHome: option('--claude-home', process.env.USERPROFILE ?? process.env.HOME),
    deliveryManifestPath: option(
      '--delivery-manifest',
      path.join(
        option('--repository-root', process.cwd()),
        'rasen',
        'changes',
        'session-cache-optimization-acceptance-evidence',
        'delivery-manifest.json'
      )
    ),
    baselineRef: option('--baseline-ref', 'HEAD'),
  });
  process.stdout.write(
    `${JSON.stringify({
      schema: 'rasen-session-cache-physical-preparation/1',
      candidate: result.candidate,
      capacity: result.capacity,
      configs: result.configs,
    })}\n`
  );
}
