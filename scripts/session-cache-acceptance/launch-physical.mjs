#!/usr/bin/env node

import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  OBSERVATION_ARMS,
  createObservationAttempt,
  readJsonBounded,
  writeAttemptSummary,
} from './protocol.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`Missing required ${name}`);
  }
  return process.argv[index + 1];
}

function optionalOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (index + 1 >= process.argv.length) {
    throw new Error(`Missing value for ${name}`);
  }
  return process.argv[index + 1];
}

if (process.env.RASEN_SESSION_CACHE_REAL_OBSERVATION !== '1') {
  throw new Error(
    'Set RASEN_SESSION_CACHE_REAL_OBSERVATION=1 to opt into concurrent physical-time observation.'
  );
}

const workDir = path.resolve(option('--work-dir'));
const selectedArm = optionalOption('--arm');
if (
  selectedArm !== undefined
  && !Object.hasOwn(OBSERVATION_ARMS, selectedArm)
) {
  throw new Error(`Unknown observation arm: ${selectedArm}`);
}
const observe = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'observe.mjs'
);
const configs = Object.keys(OBSERVATION_ARMS).map((armId) => {
  const configPath = path.join(
    workDir,
    'physical',
    armId,
    'observation-config.json'
  );
  const config = readJsonBounded(configPath);
  if (
    config.armId !== armId
    || path.resolve(config.workDir) !== workDir
  ) {
    throw new Error(`observation_config_identity_mismatch_${armId}`);
  }
  return { armId, configPath, config };
});

const candidate = configs[0].config.candidate;
if (
  configs.some(
    ({ config }) =>
      JSON.stringify(config.candidate) !== JSON.stringify(candidate)
  )
) {
  throw new Error('physical_launch_candidate_mismatch');
}
const intent = createObservationAttempt(workDir, {
  candidate,
  arms: Object.fromEntries(
    configs.map(({ armId, config }) => [armId, config.identity])
  ),
});

const children = configs
  .filter(({ armId }) => selectedArm === undefined || armId === selectedArm)
  .map(({ armId, configPath, config }) => {
  const child = spawn(
    process.execPath,
    [observe, '--config', configPath, '--attempt-id', intent.attemptId],
    {
      cwd: path.resolve(config.candidate.repositoryRoot),
      env: {
        ...process.env,
        RASEN_SESSION_CACHE_REAL_OBSERVATION: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${armId}] ${chunk.toString('utf8')}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${armId}] ${chunk.toString('utf8')}`);
  });
  return { armId, child };
  });

const interrupt = () => {
  for (const { child } of children) child.kill('SIGTERM');
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

const exits = await Promise.all(
  children.map(
    ({ armId, child }) =>
      new Promise((resolve) => {
        child.once('error', () => resolve({ armId, code: 1 }));
        child.once('close', (code) => resolve({ armId, code: code ?? 1 }));
      })
  )
);
process.removeListener('SIGINT', interrupt);
process.removeListener('SIGTERM', interrupt);
const summary = writeAttemptSummary(workDir, intent.attemptId, {
  launcherExits: exits,
});
if (exits.some((entry) => entry.code !== 0)) process.exitCode = 1;
process.stdout.write(
  `${JSON.stringify({
    schema: 'rasen-session-cache-physical-launch/2',
    attemptId: intent.attemptId,
    status: summary.status,
    exits,
  })}\n`
);
