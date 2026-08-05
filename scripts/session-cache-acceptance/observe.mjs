import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  OBSERVATION_ARMS,
  readAttemptIntent,
  readJsonBounded,
} from './protocol.mjs';
import {
  ObservationInterruptedError,
  runObservationArm,
} from './observation-harness.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`Missing required ${name}`);
  }
  return process.argv[index + 1];
}

if (process.env.RASEN_SESSION_CACHE_REAL_OBSERVATION !== '1') {
  throw new Error(
    'Set RASEN_SESSION_CACHE_REAL_OBSERVATION=1 to opt into physical-time observation.'
  );
}

const configPath = path.resolve(option('--config'));
const attemptId = option('--attempt-id');
const config = readJsonBounded(configPath);
const exactKeys = [
  'actionFile',
  'admissionProofMode',
  'allArmIdentities',
  'armId',
  'binaryFiles',
  'candidate',
  'cadenceToleranceMs',
  'capacityObservedAt',
  'capacityProofPath',
  'claude',
  'daemon',
  'daemonStatePath',
  'driverModule',
  'deliveryManifestPath',
  'deadlineApplicationToleranceMs',
  'identity',
  'operationTimeoutMs',
  'rasenBin',
  'rasenHome',
  'supervisorModule',
  'workDir',
];
const unknown = Object.keys(config).filter((key) => !exactKeys.includes(key));
if (unknown.length > 0) throw new Error(`Unknown config fields: ${unknown.join(',')}`);

const workDir = path.resolve(config.workDir);
const intent = readAttemptIntent(workDir, attemptId);
if (
  JSON.stringify(intent.candidate) !== JSON.stringify({
    ...config.candidate,
    repositoryRoot: path.resolve(config.candidate.repositoryRoot),
    baselineSha: config.candidate.baselineSha ?? null,
    treeOid: config.candidate.treeOid ?? null,
    deliveryManifestFingerprint:
      config.candidate.deliveryManifestFingerprint ?? null,
  })
  || JSON.stringify(intent.arms[config.armId]) !== JSON.stringify({
    ...config.identity,
    cwd: path.resolve(config.identity.cwd),
  })
  || (
    OBSERVATION_ARMS[config.armId].automaticTouch
    && (
      config.cadenceToleranceMs
        !== OBSERVATION_ARMS[config.armId].cadenceToleranceMs
      || config.deadlineApplicationToleranceMs
        !== OBSERVATION_ARMS[config.armId].deadlineApplicationToleranceMs
    )
  )
) {
  throw new Error('observation_attempt_config_mismatch');
}
const driverPath = path.resolve(
  path.dirname(configPath),
  config.driverModule ?? './rasen-cli-driver.mjs'
);
const driverModule = await import(pathToFileURL(driverPath).href);
if (typeof driverModule.createObservationDriver !== 'function') {
  throw new Error('Observation driver must export createObservationDriver');
}
const controller = new AbortController();
if (
  config.admissionProofMode === true
  && process.env.RASEN_SESSION_CACHE_ADMISSION_PROOF !== '1'
) {
  throw new Error('admission_proof_opt_in_required');
}
const productDriver = driverModule.createObservationDriver(config);
const driver = config.admissionProofMode === true
  ? {
      ...productDriver,
      async bootstrap(input) {
        const admitted = await productDriver.bootstrap(input);
        controller.abort();
        return admitted;
      },
    }
  : productDriver;
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  const result = await runObservationArm({
    workDir,
    attemptId,
    armId: config.armId,
    candidate: config.candidate,
    identity: config.identity,
    signal: controller.signal,
    driver,
    requiredIsolatedSlots: 1,
  });
  process.stdout.write(
    `${JSON.stringify({
      schema: result.schema,
      attemptId,
      armId: result.armId,
      disposition: result.disposition,
      classification: result.classification,
      reasonCode: result.reasonCode,
    })}\n`
  );
} catch (error) {
  if (!(error instanceof ObservationInterruptedError)) throw error;
  process.stdout.write(
    `${JSON.stringify({
      schema: 'rasen-session-cache-observation-interrupted/1',
      attemptId,
      armId: config.armId,
      disposition: 'interrupted',
      checkpointed: true,
    })}\n`
  );
  process.exitCode = 130;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
