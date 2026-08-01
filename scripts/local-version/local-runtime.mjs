#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_STALE_MS = 5 * 60_000;
const HASH_DIRECTORIES = [
  'bin',
  'src',
  'schemas',
  'skills',
  'pipelines',
  'viewer',
  'packages/ui/src',
  'packages/ui/public',
];
const HASH_FILES = [
  '.npmignore',
  'LICENSE',
  'README.md',
  'build.js',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/postinstall.js',
  'tsconfig.json',
  'packages/ui/index.html',
  'packages/ui/package.json',
  'packages/ui/pnpm-lock.yaml',
  'packages/ui/README.md',
  'packages/ui/tsconfig.json',
  'packages/ui/vite.config.ts',
];

class HarnessError extends Error {
  constructor(code, phase, message, details = {}) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.phase = phase;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        phase: this.phase,
        message: this.message,
        ...this.details,
      },
    };
  }
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  if (action !== 'prepare') {
    throw new HarnessError(
      'INVALID_ARGUMENTS',
      'resolve',
      'Usage: local-runtime.mjs prepare [--source PATH] [--project PATH] [--refresh] --json',
    );
  }

  const options = { json: false, refresh: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--refresh') {
      options.refresh = true;
    } else if (argument === '--source' || argument === '--project') {
      const value = rest[index + 1];
      if (!value) {
        throw new HarnessError('INVALID_ARGUMENTS', 'resolve', `${argument} requires a path`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new HarnessError('INVALID_ARGUMENTS', 'resolve', `Unknown argument: ${argument}`);
    }
  }

  if (!options.json) {
    throw new HarnessError('INVALID_ARGUMENTS', 'resolve', 'The prepare action requires --json');
  }
  return options;
}

function canonicalDirectory(input, label) {
  const resolved = path.resolve(input);
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new HarnessError(
      `${label.toUpperCase()}_NOT_FOUND`,
      'resolve',
      `${label} directory does not exist: ${resolved}`,
      { path: resolved },
    );
  }
  if (!stats.isDirectory()) {
    throw new HarnessError(
      `${label.toUpperCase()}_NOT_DIRECTORY`,
      'resolve',
      `${label} path is not a directory: ${resolved}`,
      { path: resolved },
    );
  }
  return fs.realpathSync.native(resolved);
}

function readManifest(filePath, label, phase = 'resolve') {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new HarnessError(
      'INVALID_MANIFEST',
      phase,
      `Cannot read ${label} manifest: ${filePath}`,
      { path: filePath },
    );
  }
}

function resolveSource(options) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sourceRoot = canonicalDirectory(options.source ?? repositoryRoot, 'source');
  const projectRoot = canonicalDirectory(options.project ?? process.cwd(), 'project');
  const cliManifestPath = path.join(sourceRoot, 'package.json');
  const uiManifestPath = path.join(sourceRoot, 'packages', 'ui', 'package.json');
  const cliManifest = readManifest(cliManifestPath, 'CLI');
  const uiManifest = readManifest(uiManifestPath, 'UI');

  if (cliManifest.name !== '@atelierai/rasen' || uiManifest.name !== '@atelierai/rasen-ui') {
    throw new HarnessError(
      'PACKAGE_NAME_MISMATCH',
      'resolve',
      'Source must contain @atelierai/rasen and @atelierai/rasen-ui packages',
      { cliName: cliManifest.name ?? null, uiName: uiManifest.name ?? null },
    );
  }
  if (!cliManifest.version || cliManifest.version !== uiManifest.version) {
    throw new HarnessError(
      'VERSION_MISMATCH',
      'resolve',
      `CLI version ${cliManifest.version ?? '<missing>'} does not match UI version ${uiManifest.version ?? '<missing>'}`,
      {
        cliVersion: cliManifest.version ?? null,
        uiVersion: uiManifest.version ?? null,
      },
    );
  }

  return { sourceRoot, projectRoot, cliManifest, uiManifest, version: cliManifest.version };
}

function commandInvocation(command) {
  if (command === 'npm' && process.platform === 'win32') {
    return {
      command: process.execPath,
      argsPrefix: [
        path.win32.join(
          path.win32.dirname(process.execPath),
          'node_modules',
          'npm',
          'bin',
          'npm-cli.js',
        ),
      ],
    };
  }
  if (command === 'pnpm' && process.platform === 'win32') {
    const corepackPnpm = path.join(
      path.dirname(process.execPath),
      'node_modules',
      'corepack',
      'dist',
      'pnpm.js',
    );
    if (fs.existsSync(corepackPnpm)) {
      return { command: process.execPath, argsPrefix: [corepackPnpm] };
    }
    return {
      command: process.env.ComSpec || 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', 'pnpm'],
    };
  }
  return {
    command: process.platform === 'win32' ? `${command}.cmd` : command,
    argsPrefix: [],
  };
}

function runCommand(commandName, args, { cwd, phase, captureStdout = false }) {
  const invocation = commandInvocation(commandName);
  const display = [commandName, ...args].join(' ');
  process.stderr.write(`[local-version:${phase}] ${display}\n`);
  const result = spawnSync(invocation.command, [...invocation.argsPrefix, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', RASEN_TELEMETRY: '0' },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (!captureStdout && result.stdout) process.stderr.write(result.stdout);
  if (result.error || result.status !== 0) {
    throw new HarnessError(
      'COMMAND_FAILED',
      phase,
      `${display} failed${result.status === null ? '' : ` with exit code ${result.status}`}`,
      {
        command: display,
        exitCode: result.status,
        cause: result.error?.message,
      },
    );
  }
  return result.stdout ?? '';
}

function toolVersion(commandName) {
  return runCommand(commandName, ['--version'], {
    cwd: process.cwd(),
    phase: 'fingerprint',
    captureStdout: true,
  }).trim();
}

function npmVersion() {
  if (process.platform === 'win32') {
    const manifestPath = path.join(
      path.dirname(process.execPath),
      'node_modules',
      'npm',
      'package.json',
    );
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.version === 'string') return manifest.version;
    } catch {
      // Fall through to the executable probe for non-standard Node layouts.
    }
  }
  return toolVersion('npm');
}

function pnpmIdentity(source) {
  const declared = source.cliManifest.packageManager;
  const match = typeof declared === 'string' ? /^pnpm@(.+)$/.exec(declared) : null;
  if (match) return match[1];

  const packageRoots = [source.sourceRoot, path.join(source.sourceRoot, 'packages', 'ui')];
  const needsPnpm = packageRoots.some((packageRoot, index) => {
    const manifest = index === 0 ? source.cliManifest : source.uiManifest;
    return fs.existsSync(path.join(packageRoot, 'pnpm-lock.yaml')) || Boolean(manifest.scripts?.build);
  });
  return needsPnpm ? toolVersion('pnpm') : 'unused';
}

function collectFiles(sourceRoot) {
  const result = new Set();
  for (const relativePath of HASH_FILES) {
    const absolutePath = path.join(sourceRoot, ...relativePath.split('/'));
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      result.add(relativePath);
    }
  }

  const visit = (absoluteDirectory) => {
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        result.add(path.relative(sourceRoot, absolutePath).split(path.sep).join('/'));
      }
    }
  };

  for (const relativeDirectory of HASH_DIRECTORIES) {
    const absoluteDirectory = path.join(sourceRoot, ...relativeDirectory.split('/'));
    if (fs.existsSync(absoluteDirectory) && fs.statSync(absoluteDirectory).isDirectory()) {
      visit(absoluteDirectory);
    }
  }
  return [...result].sort();
}

function computeFingerprint(sourceRoot, toolchain) {
  const hash = createHash('sha256');
  hash.update(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...toolchain })}\n`);
  for (const relativePath of collectFiles(sourceRoot)) {
    hash.update(`${relativePath}\0`);
    hash.update(fs.readFileSync(path.join(sourceRoot, ...relativePath.split('/'))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function defaultCacheRoot() {
  if (process.env.RASEN_LOCAL_HARNESS_ROOT) {
    return path.resolve(process.env.RASEN_LOCAL_HARNESS_ROOT);
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'Rasen', 'local-harness');
  }
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'rasen', 'local-harness');
}

function safeVersion(version) {
  return version.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isolationFor(cacheRoot, sourceRoot, projectRoot, version) {
  const identity = createHash('sha256')
    .update(JSON.stringify({
      sourceRoot: process.platform === 'win32' ? sourceRoot.toLowerCase() : sourceRoot,
      projectRoot: process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot,
      version,
    }))
    .digest('hex');
  const numeric = Number.parseInt(identity.slice(0, 8), 16);
  return {
    identity,
    rasenHome: path.join(cacheRoot, 'homes', identity, 'home'),
    daemonPort: 20_000 + (numeric % 40_000),
  };
}

function assertWithinCache(cacheRoot, candidate) {
  const relative = path.relative(path.resolve(cacheRoot), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HarnessError('UNSAFE_CACHE_PATH', 'cache', `Unsafe generated cache path: ${candidate}`);
  }
}

function removeGenerated(cacheRoot, candidate) {
  assertWithinCache(cacheRoot, candidate);
  fs.rmSync(candidate, { recursive: true, force: true });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(cacheRoot, fingerprint) {
  const locksRoot = path.join(cacheRoot, 'locks');
  fs.mkdirSync(locksRoot, { recursive: true });
  const lockPath = path.join(locksRoot, `${fingerprint}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(
        path.join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      );
      return lockPath;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) {
          removeGenerated(cacheRoot, lockPath);
          continue;
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new HarnessError(
          'LOCK_TIMEOUT',
          'cache',
          `Timed out waiting for local runtime lock: ${lockPath}`,
          { path: lockPath },
        );
      }
      await sleep(200);
    }
  }
}

function preparePackage(packageRoot, manifest) {
  if (fs.existsSync(path.join(packageRoot, 'pnpm-lock.yaml'))) {
    runCommand('pnpm', ['install', '--frozen-lockfile'], { cwd: packageRoot, phase: 'build' });
  }
  if (manifest.scripts?.build) {
    runCommand('pnpm', ['run', 'build'], { cwd: packageRoot, phase: 'build' });
  }
}

function npmPack(packageRoot, destination) {
  const raw = runCommand(
    'npm',
    ['pack', '--json', '--silent', '--ignore-scripts', '--pack-destination', destination],
    { cwd: packageRoot, phase: 'pack', captureStdout: true },
  );
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    throw new HarnessError('INVALID_PACK_OUTPUT', 'pack', `npm pack returned invalid JSON for ${packageRoot}`);
  }
  if (!Array.isArray(metadata) || metadata.length !== 1 || !metadata[0]?.filename) {
    throw new HarnessError('INVALID_PACK_OUTPUT', 'pack', `npm pack returned no tarball for ${packageRoot}`);
  }
  return { ...metadata[0], tarball: path.join(destination, metadata[0].filename) };
}

async function validateRuntime(
  runtimeRoot,
  expectedVersion,
  expectedFingerprint,
  { requireReady = false } = {},
) {
  const cliRoot = path.join(runtimeRoot, 'node_modules', '@atelierai', 'rasen');
  const uiRoot = path.join(runtimeRoot, 'node_modules', '@atelierai', 'rasen-ui');
  const cliManifest = readManifest(path.join(cliRoot, 'package.json'), 'installed CLI', 'validate');
  const uiManifest = readManifest(path.join(uiRoot, 'package.json'), 'installed UI', 'validate');
  if (cliManifest.version !== expectedVersion || uiManifest.version !== expectedVersion) {
    throw new HarnessError(
      'INSTALLED_VERSION_MISMATCH',
      'validate',
      `Installed CLI/UI packages do not both match ${expectedVersion}`,
      { cliVersion: cliManifest.version, uiVersion: uiManifest.version },
    );
  }

  const uiAssetsDir = path.join(uiRoot, 'dist');
  const uiIndex = path.join(uiAssetsDir, 'index.html');
  if (!fs.existsSync(uiIndex)) {
    throw new HarnessError('UI_ASSETS_MISSING', 'validate', `Installed UI is missing ${uiIndex}`);
  }

  const cliEntry = path.join(cliRoot, 'bin', 'rasen.js');
  const versionResult = spawnSync(process.execPath, [cliEntry, '--version'], {
    cwd: runtimeRoot,
    encoding: 'utf8',
    env: { ...process.env, RASEN_TELEMETRY: '0' },
  });
  if (versionResult.status !== 0 || versionResult.stdout.trim() !== expectedVersion) {
    throw new HarnessError(
      'CLI_VERSION_MISMATCH',
      'validate',
      `Installed CLI did not report ${expectedVersion}`,
      { exitCode: versionResult.status, reportedVersion: versionResult.stdout.trim() },
    );
  }

  const resolverPath = path.join(cliRoot, 'dist', 'core', 'config-api', 'ui-package.js');
  let resolvedUiDir;
  try {
    const resolver = await import(`${pathToFileURL(resolverPath).href}?fingerprint=${expectedFingerprint}`);
    if (typeof resolver.resolveUiPackageDir !== 'function') {
      throw new Error('resolveUiPackageDir export is missing');
    }
    resolvedUiDir = resolver.resolveUiPackageDir();
  } catch (error) {
    throw new HarnessError(
      'UI_RESOLVER_FAILED',
      'validate',
      `Installed CLI UI resolver failed: ${error.message}`,
      { path: resolverPath },
    );
  }
  if (!resolvedUiDir
      || fs.realpathSync.native(resolvedUiDir) !== fs.realpathSync.native(uiAssetsDir)) {
    throw new HarnessError(
      'UI_RESOLVER_MISMATCH',
      'validate',
      'Installed CLI did not resolve its adjacent UI package',
      { resolvedUiDir: resolvedUiDir ?? null, expectedUiDir: uiAssetsDir },
    );
  }

  const readyPath = path.join(runtimeRoot, 'ready.json');
  if (requireReady && !fs.existsSync(readyPath)) {
    throw new HarnessError('CACHE_METADATA_MISSING', 'validate', 'Runtime cache metadata is missing');
  }
  if (fs.existsSync(readyPath)) {
    const ready = readManifest(readyPath, 'runtime metadata', 'validate');
    if (ready.schemaVersion !== SCHEMA_VERSION || ready.fingerprint !== expectedFingerprint) {
      throw new HarnessError('CACHE_METADATA_MISMATCH', 'validate', 'Runtime cache metadata is stale');
    }
  }

  return {
    runtimeRoot,
    binDir: path.join(runtimeRoot, 'node_modules', '.bin'),
    rasenExecutable: path.join(
      runtimeRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'rasen.cmd' : 'rasen',
    ),
    uiAssetsDir,
  };
}

function resultFor(source, fingerprint, cacheOutcome, runtime, isolation) {
  return {
    schemaVersion: SCHEMA_VERSION,
    version: source.version,
    fingerprint,
    cache: cacheOutcome,
    sourceRoot: source.sourceRoot,
    projectRoot: source.projectRoot,
    runtimeRoot: runtime.runtimeRoot,
    binDir: runtime.binDir,
    rasenExecutable: runtime.rasenExecutable,
    uiAssetsDir: runtime.uiAssetsDir,
    rasenHome: isolation.rasenHome,
    daemonPort: isolation.daemonPort,
  };
}

async function materializeRuntime(source, cacheRoot, runtimeRoot, fingerprint, toolchain) {
  const stagingRoot = path.join(
    cacheRoot,
    'staging',
    `${fingerprint}-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  const packsRoot = path.join(stagingRoot, 'packs');
  const packageRoot = path.join(stagingRoot, 'runtime');
  fs.mkdirSync(packsRoot, { recursive: true });
  fs.mkdirSync(packageRoot, { recursive: true });

  try {
    preparePackage(source.sourceRoot, source.cliManifest);
    preparePackage(path.join(source.sourceRoot, 'packages', 'ui'), source.uiManifest);
    const cliPack = npmPack(source.sourceRoot, packsRoot);
    const uiPack = npmPack(path.join(source.sourceRoot, 'packages', 'ui'), packsRoot);
    if (cliPack.version !== source.version || uiPack.version !== source.version) {
      throw new HarnessError(
        'PACKED_VERSION_MISMATCH',
        'pack',
        `Packed CLI/UI versions must both match ${source.version}`,
        { cliVersion: cliPack.version, uiVersion: uiPack.version },
      );
    }

    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: 'rasen-local-runtime', private: true })}\n`,
    );
    runCommand(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        cliPack.tarball,
        uiPack.tarball,
      ],
      { cwd: packageRoot, phase: 'install' },
    );

    const currentFingerprint = computeFingerprint(source.sourceRoot, toolchain);
    if (currentFingerprint !== fingerprint) {
      throw new HarnessError(
        'SOURCE_CHANGED',
        'fingerprint',
        'Rasen source changed while the local runtime was being built',
        { before: fingerprint, after: currentFingerprint },
      );
    }

    await validateRuntime(packageRoot, source.version, fingerprint);
    fs.writeFileSync(
      path.join(packageRoot, 'ready.json'),
      `${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        fingerprint,
        version: source.version,
        toolchain,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`,
    );

    fs.mkdirSync(path.dirname(runtimeRoot), { recursive: true });
    if (fs.existsSync(runtimeRoot)) removeGenerated(cacheRoot, runtimeRoot);
    fs.renameSync(packageRoot, runtimeRoot);
    removeGenerated(cacheRoot, stagingRoot);
    return validateRuntime(runtimeRoot, source.version, fingerprint, { requireReady: true });
  } catch (error) {
    if (fs.existsSync(stagingRoot)) removeGenerated(cacheRoot, stagingRoot);
    throw error;
  }
}

async function prepare(options) {
  const source = resolveSource(options);
  const cacheRoot = defaultCacheRoot();
  const isolation = isolationFor(
    cacheRoot,
    source.sourceRoot,
    source.projectRoot,
    source.version,
  );
  const toolchain = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    modules: process.versions.modules,
    npm: npmVersion(),
    pnpm: pnpmIdentity(source),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fingerprint = computeFingerprint(source.sourceRoot, toolchain);
    const runtimeRoot = path.join(
      cacheRoot,
      'runtimes',
      `${safeVersion(source.version)}-${fingerprint}`,
    );
    if (!options.refresh && fs.existsSync(runtimeRoot)) {
      try {
        const runtime = await validateRuntime(
          runtimeRoot,
          source.version,
          fingerprint,
          { requireReady: true },
        );
        fs.mkdirSync(isolation.rasenHome, { recursive: true });
        return resultFor(source, fingerprint, 'hit', runtime, isolation);
      } catch (error) {
        process.stderr.write(`[local-version:cache] ignoring invalid runtime: ${error.message}\n`);
      }
    }

    fs.mkdirSync(cacheRoot, { recursive: true });
    const lockPath = await acquireLock(cacheRoot, fingerprint);
    try {
      if (!options.refresh && fs.existsSync(runtimeRoot)) {
        try {
          const runtime = await validateRuntime(
            runtimeRoot,
            source.version,
            fingerprint,
            { requireReady: true },
          );
          fs.mkdirSync(isolation.rasenHome, { recursive: true });
          return resultFor(source, fingerprint, 'hit', runtime, isolation);
        } catch {
          removeGenerated(cacheRoot, runtimeRoot);
        }
      }
      const runtime = await materializeRuntime(
        source,
        cacheRoot,
        runtimeRoot,
        fingerprint,
        toolchain,
      );
      fs.mkdirSync(isolation.rasenHome, { recursive: true });
      return resultFor(source, fingerprint, 'built', runtime, isolation);
    } catch (error) {
      if (error instanceof HarnessError && error.code === 'SOURCE_CHANGED' && attempt === 0) {
        process.stderr.write('[local-version:fingerprint] source changed; retrying once\n');
        continue;
      }
      throw error;
    } finally {
      if (fs.existsSync(lockPath)) removeGenerated(cacheRoot, lockPath);
    }
  }

  throw new HarnessError('SOURCE_UNSTABLE', 'fingerprint', 'Source changed during both build attempts');
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await prepare(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const diagnostic = error instanceof HarnessError
      ? error.toJSON()
      : new HarnessError('UNEXPECTED', 'resolve', error?.message ?? String(error)).toJSON();
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    process.exitCode = 1;
  }
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  await main();
}

export { HarnessError, prepare };
