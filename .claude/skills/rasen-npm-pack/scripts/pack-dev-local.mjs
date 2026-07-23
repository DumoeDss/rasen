#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) {
  console.error(`rasen-npm-pack: ${message}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    force: false,
    packDestination: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (argument === '--pack-destination') {
      const destination = args[index + 1];
      if (!destination || destination.startsWith('--')) {
        throw new Error('--pack-destination requires a directory');
      }
      options.packDestination = resolve(destination);
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }

  return options;
}

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const stdio = options.captureStdout ? ['inherit', 'pipe', 'inherit'] : 'inherit';
  if (process.platform === 'win32') {
    // pnpm/npm ship as .cmd shims; Node refuses to spawn them directly
    // (EINVAL since CVE-2024-27980) and shell:true would concatenate args
    // unsafely (Node DEP0190). Route through cmd.exe instead.
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', commandName(command), ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio,
    });
  }
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio,
  });
}

// Counters persist beside the skill (under the gitignored .claude/ tree) rather
// than in the pack destination, so the build index stays monotonic across
// destination changes or tarball cleanup without dirtying the work tree.
const countersPath = resolve(import.meta.dirname, '..', '.devlocal-counters.json');

function readCounters() {
  try {
    return JSON.parse(readFileSync(countersPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeCounters(counters) {
  writeFileSync(countersPath, `${JSON.stringify(counters, null, 2)}\n`, 'utf8');
}

// Next dev-local index for this base version = max(persisted counter, index of
// any existing dev-local tarball in the destination) + 1. The persisted counter
// keeps the number monotonic even if old tarballs are deleted, so reinstalling
// the new build always updates — npm would otherwise skip an unchanged version.
// Returns the counters object read from disk so the caller can persist it after
// a successful (non-dry-run) pack without a second read.
function nextDevIndex(destination, originalVersion, nameStem) {
  const counters = readCounters();
  let max = Number(counters[originalVersion]) || 0;
  if (existsSync(destination)) {
    const prefix = `${nameStem}-${originalVersion}-dev.local.`;
    for (const entry of readdirSync(destination)) {
      if (!entry.startsWith(prefix) || !entry.endsWith('.tgz')) continue;
      const middle = entry.slice(prefix.length, -'.tgz'.length);
      if (/^\d+$/.test(middle)) {
        max = Math.max(max, Number(middle));
      }
    }
  }
  return { index: max + 1, counters };
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.exit();
}

const packagePath = resolve('package.json');
if (!existsSync(packagePath)) {
  fail('package.json was not found; run this script from the Rasen repository root');
  process.exit();
}

const originalPackage = readFileSync(packagePath);
const originalText = originalPackage.toString('utf8');
let manifest;
try {
  manifest = JSON.parse(originalText);
} catch (error) {
  fail(`package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit();
}

if (manifest.name !== '@atelierai/rasen') {
  fail(`expected @atelierai/rasen, found ${String(manifest.name)}`);
  process.exit();
}
if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  fail(`expected a stable SemVer version, found ${String(manifest.version)}`);
  process.exit();
}

const originalVersion = manifest.version;
const nameStem = manifest.name.replace(/^@/, '').replace('/', '-');
const versionPattern = /("version"\s*:\s*")([^"]+)(")/;
const versionMatch = originalText.match(versionPattern);
if (!versionMatch || versionMatch[2] !== originalVersion) {
  fail('could not locate the package.json version field safely');
  process.exit();
}

const destination = options.packDestination ?? resolve('artifacts');
const { index: devIndex, counters: devCounters } = nextDevIndex(
  destination,
  originalVersion,
  nameStem,
);
const devVersion = `${originalVersion}-dev.local.${devIndex}`;
const expectedFilename = `${nameStem}-${devVersion}.tgz`;
const expectedArchive = options.dryRun ? undefined : resolve(destination, expectedFilename);
if (expectedArchive && existsSync(expectedArchive) && !options.force) {
  fail(`archive already exists: ${expectedArchive}; use --force to replace it`);
  process.exit();
}

const temporaryText = originalText.replace(
  versionPattern,
  `$1${devVersion}$3`
);
let temporaryVersionWritten = false;

try {
  writeFileSync(packagePath, temporaryText, 'utf8');
  temporaryVersionWritten = true;
  console.log(`rasen-npm-pack: temporary version ${originalVersion} -> ${devVersion}`);

  run('pnpm', ['run', 'build']);

  const packArgs = ['pack', '--ignore-scripts'];
  if (options.dryRun) {
    packArgs.push('--dry-run', '--json');
  } else {
    mkdirSync(destination, { recursive: true });
    packArgs.push('--pack-destination', destination);
  }

  const output = run('npm', packArgs, { captureStdout: true });
  if (output) process.stdout.write(output);
  if (!options.dryRun) {
    devCounters[originalVersion] = devIndex;
    writeCounters(devCounters);
    console.log(`rasen-npm-pack: archive ${expectedArchive}`);
  }
} catch (error) {
  process.exitCode = 1;
  console.error(
    `rasen-npm-pack: ${error instanceof Error ? error.message : String(error)}`
  );
} finally {
  if (temporaryVersionWritten) {
    writeFileSync(packagePath, originalPackage);
    const restored = readFileSync(packagePath).equals(originalPackage);
    if (!restored) {
      fail('package.json restoration could not be verified');
    } else {
      console.log(`rasen-npm-pack: restored package.json to ${originalVersion}`);
    }
  }
}
