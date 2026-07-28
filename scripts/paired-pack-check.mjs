import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { npmInvocationForPlatform } from './npm-command.mjs';
import { loadReleaseContract } from './release-contract.mjs';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function packJson(packageDir, destination) {
  const npm = npmInvocationForPlatform();
  const raw = run(npm.command, [...npm.argsPrefix, 'pack', '--json', '--silent', '--pack-destination', destination], {
    cwd: packageDir,
  });
  const result = JSON.parse(raw);
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0] !== 'object') {
    throw new Error(`npm pack returned an unexpected result for ${packageDir}`);
  }
  return result[0];
}

export function verifyUiPackMetadata(metadata, expectedVersion) {
  if (metadata.version !== expectedVersion) {
    throw new Error(
      `packed UI version mismatch: expected ${expectedVersion}, got ${metadata.version}`,
    );
  }
  const files = Array.isArray(metadata.files) ? metadata.files.map((entry) => entry.path) : [];
  if (!files.includes('dist/index.html')) {
    throw new Error('packed UI is missing dist/index.html');
  }
  if (!files.includes('package.json')) {
    throw new Error('packed UI is missing package.json');
  }
}

export function main() {
  const { version } = loadReleaseContract({ rootDir });
  run(process.execPath, [path.join(rootDir, 'scripts', 'pack-version-check.mjs')], { cwd: rootDir });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-paired-pack-'));
  try {
    const uiMetadata = packJson(path.join(rootDir, 'packages', 'ui'), workDir);
    verifyUiPackMetadata(uiMetadata, version);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`verified paired CLI/UI packages ${version}`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`paired-pack-check: ${error.message}`);
    process.exitCode = 1;
  }
}
