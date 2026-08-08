#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build freshness marker (`dist/.build-fingerprint.json`).
 *
 * `--if-stale` compiles only when the recorded fingerprint does not match the
 * current compiler inputs. Test harnesses use it so that starting a second
 * Vitest process cannot delete or half-overwrite the `dist/` a first process is
 * executing: with unchanged sources the second process touches nothing at all,
 * and when sources DID change the build lock below serializes the one rebuild.
 * A plain `node build.js` (CI, publish) always rebuilds, unchanged.
 */
const FINGERPRINT_FILENAME = '.build-fingerprint.json';
const FINGERPRINT_VERSION = 1;
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const LOCK_POLL_MS = 100;

const runTsc = (args = []) => {
  const tscPath = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscPath, ...args], { stdio: 'inherit', cwd: projectRoot });
};

function hashFileInto(hash, absolutePath, label) {
  hash.update(label);
  hash.update('\0');
  hash.update(createHash('sha256').update(readFileSync(absolutePath)).digest('hex'));
  hash.update('\n');
}

function collectSourceFiles(directory, relativePrefix, collected) {
  const entries = readdirSync(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolute, relative, collected);
    } else if (entry.isFile()) {
      collected.push({ relative, absolute });
    }
  }
  return collected;
}

/**
 * Hash of everything that can change the compiler's output: the `src/**` tree
 * that `tsconfig.json` includes, the tsconfig itself, the TypeScript version,
 * and this build script.
 */
function computeBuildFingerprint() {
  const hash = createHash('sha256');
  hash.update(`version:${FINGERPRINT_VERSION}\n`);
  const typescriptVersion = require('typescript/package.json').version;
  hash.update(`typescript:${typescriptVersion}\n`);
  hashFileInto(hash, path.join(projectRoot, 'tsconfig.json'), 'tsconfig.json');
  hashFileInto(hash, path.join(projectRoot, 'build.js'), 'build.js');
  for (const file of collectSourceFiles(path.join(projectRoot, 'src'), '', [])) {
    hashFileInto(hash, file.absolute, `src/${file.relative}`);
  }
  return hash.digest('hex');
}

function readRecordedFingerprint() {
  try {
    const recorded = JSON.parse(
      readFileSync(path.join(projectRoot, 'dist', FINGERPRINT_FILENAME), 'utf8')
    );
    return recorded.version === FINGERPRINT_VERSION && typeof recorded.fingerprint === 'string'
      ? recorded.fingerprint
      : null;
  } catch {
    return null;
  }
}

function distIsFresh(fingerprint) {
  return (
    existsSync(path.join(projectRoot, 'dist', 'cli', 'index.js')) &&
    readRecordedFingerprint() === fingerprint
  );
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function buildLockPath() {
  const key = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `rasen-build-${key}.lock`);
}

/**
 * Cross-process build lock. Only one process compiles at a time, so two
 * concurrent stale-check runs cannot clean and recompile `dist/` on top of each
 * other. The waiter re-checks the fingerprint afterwards and usually finds the
 * work already done.
 */
function acquireBuildLock(lockPath) {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      const descriptor = openSync(lockPath, 'wx');
      writeSync(descriptor, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(descriptor);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let held;
    try {
      held = statSync(lockPath);
    } catch {
      continue;
    }
    if (Date.now() - held.mtimeMs > LOCK_STALE_MS) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Another process won the takeover; loop and retry.
      }
      continue;
    }
    if (Date.now() > deadline) return false;
    sleep(LOCK_POLL_MS);
  }
}

function releaseBuildLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // Already removed by a stale-lock takeover.
  }
}

function compile(fingerprint) {
  console.log('🔨 Building Rasen...\n');

  // Clean dist directory
  if (existsSync(path.join(projectRoot, 'dist'))) {
    console.log('Cleaning dist directory...');
    rmSync(path.join(projectRoot, 'dist'), { recursive: true, force: true });
  }

  // Run TypeScript compiler (use local version explicitly)
  console.log('Compiling TypeScript...');
  try {
    runTsc(['--version']);
    runTsc();
  } catch (error) {
    console.error('\n❌ Build failed!');
    // Rethrown, not `process.exit()`: exiting here would skip the caller's
    // `finally` and leave the build lock held until it went stale.
    throw error;
  }

  // Written last: a partially compiled dist must never look fresh.
  mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
  writeFileSync(
    path.join(projectRoot, 'dist', FINGERPRINT_FILENAME),
    `${JSON.stringify({ version: FINGERPRINT_VERSION, fingerprint }, null, 2)}\n`,
    'utf8'
  );
  console.log('\n✅ Build completed successfully!');
}

function main() {
  const ifStale = process.argv.includes('--if-stale');
  const fingerprint = computeBuildFingerprint();

  if (!ifStale) {
    compile(fingerprint);
    return;
  }
  if (distIsFresh(fingerprint)) {
    console.log('dist/ matches the current sources; skipping build.');
    return;
  }
  const lockPath = buildLockPath();
  if (!acquireBuildLock(lockPath)) {
    throw new Error(`Timed out waiting for the build lock at ${lockPath}.`);
  }
  try {
    if (distIsFresh(fingerprint)) {
      console.log('dist/ was rebuilt by another process; skipping build.');
    } else {
      compile(fingerprint);
    }
  } finally {
    releaseBuildLock(lockPath);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof Error && !/^Command failed/u.test(error.message)) {
    console.error(`\n❌ ${error.message}`);
  }
  process.exit(1);
}
