import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { npmInvocationForPlatform } from './npm-command.mjs';

const BANNED_LIVE_TOKENS = [
  'rasen-freeze',
  'rasen-guard',
  'rasen-unfreeze',
  'check-freeze.sh',
  'freeze-dir.txt',
  'rasen agent edit-boundary',
  'EDIT_BOUNDARY_GUIDANCE',
  'resolveEditBoundaryEnforcement',
];

const ALLOWED_MIGRATION_PAYLOADS = new Set([
  'dist/core/legacy-cleanup.d.ts',
  'dist/core/legacy-cleanup.js',
  'dist/core/retired-edit-boundary.d.ts',
  'dist/core/retired-edit-boundary.js',
]);

const REQUIRED_CLEANUP_PAYLOADS = [
  'dist/core/retired-edit-boundary.d.ts',
  'dist/core/retired-edit-boundary.js',
];

const RETIRED_LIVE_MODULES = [
  'dist/core/edit-boundary.d.ts',
  'dist/core/edit-boundary.js',
  'dist/core/edit-boundary-hooks.d.ts',
  'dist/core/edit-boundary-hooks.js',
];

const RETIRED_RUNTIME_SURFACE_PAYLOADS = new Set([
  'dist/cli/index.d.ts',
  'dist/cli/index.js',
  'dist/commands/agent.d.ts',
  'dist/commands/agent.js',
  'dist/core/completions/command-registry.d.ts',
  'dist/core/completions/command-registry.js',
  'dist/core/index.d.ts',
  'dist/core/index.js',
  'dist/core/runtime-adapters.d.ts',
  'dist/core/runtime-adapters.js',
]);

const BANNED_RUNTIME_SURFACE_TOKENS = [
  'edit-boundary',
  'EditBoundary',
];

const TEXT_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.css',
  '.d.ts',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);

function normalizedPackagePath(value) {
  return value.replaceAll('\\', '/');
}

function extensionForPackagePath(packagePath) {
  return packagePath.endsWith('.d.ts') ? '.d.ts' : path.posix.extname(packagePath);
}

export function verifyRetiredEditBoundaryPackage(metadata, rootDir = process.cwd()) {
  const packageFiles = Array.isArray(metadata?.files)
    ? metadata.files
        .map((entry) => normalizedPackagePath(String(entry?.path ?? '')))
        .filter(Boolean)
    : [];
  if (packageFiles.length === 0) {
    throw new Error('npm pack returned no package file metadata');
  }

  const fileSet = new Set(packageFiles);
  const missingCleanup = REQUIRED_CLEANUP_PAYLOADS.filter((file) => !fileSet.has(file));
  if (missingCleanup.length > 0) {
    throw new Error(`package is missing retirement cleanup: ${missingCleanup.join(', ')}`);
  }

  const liveModules = RETIRED_LIVE_MODULES.filter((file) => fileSet.has(file));
  if (liveModules.length > 0) {
    throw new Error(`package still contains live edit-boundary modules: ${liveModules.join(', ')}`);
  }

  const violations = [];
  for (const packageFile of packageFiles) {
    if (ALLOWED_MIGRATION_PAYLOADS.has(packageFile)) continue;
    if (!TEXT_EXTENSIONS.has(extensionForPackagePath(packageFile))) continue;

    const absolutePath = path.join(rootDir, ...packageFile.split('/'));
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`packed file is missing from the working tree: ${packageFile}`);
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    for (const token of BANNED_LIVE_TOKENS) {
      if (content.includes(token)) violations.push(`${packageFile}: ${token}`);
    }
    if (RETIRED_RUNTIME_SURFACE_PAYLOADS.has(packageFile)) {
      for (const token of BANNED_RUNTIME_SURFACE_TOKENS) {
        if (content.includes(token)) violations.push(`${packageFile}: ${token}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`package contains retired live vocabulary:\n${violations.join('\n')}`);
  }

  for (const lifecycleFile of ['dist/core/init.js', 'dist/core/update.js']) {
    if (!fileSet.has(lifecycleFile)) {
      throw new Error(`package is missing lifecycle payload: ${lifecycleFile}`);
    }
    const lifecycle = fs.readFileSync(path.join(rootDir, ...lifecycleFile.split('/')), 'utf8');
    if (!lifecycle.includes('cleanupRetiredEditBoundaryArtifacts')) {
      throw new Error(`${lifecycleFile} does not invoke retirement cleanup`);
    }
  }

  return {
    filesChecked: packageFiles.length,
    cleanupPayloads: [...REQUIRED_CLEANUP_PAYLOADS],
  };
}

export function readPackMetadata(rootDir, run = execFileSync) {
  const npm = npmInvocationForPlatform();
  const output = run(
    npm.command,
    [
      ...npm.argsPrefix,
      'pack',
      '--dry-run',
      '--ignore-scripts',
      '--foreground-scripts=false',
      '--json',
      '--silent',
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack returned an unexpected metadata shape');
  }
  return parsed.at(-1);
}

export function main(rootDir = process.cwd()) {
  const result = verifyRetiredEditBoundaryPackage(readPackMetadata(rootDir), rootDir);
  console.log(
    `retired-edit-boundary-package-check: OK (${result.filesChecked} package files checked)`
  );
  return result;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`retired-edit-boundary-package-check: ${error.message}`);
    process.exitCode = 1;
  }
}
