#!/usr/bin/env node

// Builds and packs an @atelierai/* package from the current work tree WITHOUT
// touching its `package.json`. The local build is identified by a stamp file,
// `dist/build-info.json`, which the CLI renders in `rasen --version`:
//
//   0.1.7 (dev.local c915bf8e)
//
// Why not bump the version to `X.Y.Z-dev.local.N` (what this helper used to
// do): every equality check on the version string then reports a spurious
// mismatch on a locally built CLI — installed skills (`generatedBy`), the
// daemon handshake, `.rasenpkg` `minRasenVersion` preflight and the CLI/UI
// lockstep checks. The version-bump was justified by "npm would otherwise
// skip an unchanged version"; that is false for a local tarball install —
// `npm install -g ./pkg.tgz` re-extracts the tarball and replaces the
// contents even when name@version is identical (verified with npm 11.16.0).

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

function fail(message) {
  console.error(`rasen-npm-pack: ${message}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    force: false,
    packDestination: undefined,
    // Directory (relative to cwd) holding the target package.json. Defaults to
    // the repo root (the CLI package @atelierai/rasen); pass e.g.
    // `--package packages/ui` to pack a workspace package instead.
    packageDir: '.',
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
    if (argument === '--package') {
      const packageDir = args[index + 1];
      if (!packageDir || packageDir.startsWith('--')) {
        throw new Error('--package requires a directory');
      }
      options.packageDir = packageDir;
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

function run(command, args, { cwd = process.cwd(), captureStdout = false } = {}) {
  const stdio = captureStdout ? ['inherit', 'pipe', 'inherit'] : 'inherit';
  if (process.platform === 'win32') {
    // pnpm/npm ship as .cmd shims; Node refuses to spawn them directly
    // (EINVAL since CVE-2024-27980) and shell:true would concatenate args
    // unsafely (Node DEP0190). Route through cmd.exe instead.
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', commandName(command), ...args], {
      cwd,
      encoding: 'utf8',
      stdio,
    });
  }
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio,
  });
}

// Short commit for the stamp. A non-checkout, a missing git, or any other
// failure simply omits the field — provenance is informational and must never
// fail a pack.
function gitCommit(cwd) {
  try {
    const value = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
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

// Counters are keyed by `<name>@<version>` so two packages in the same
// workspace (e.g. @atelierai/rasen@0.1.7 and @atelierai/rasen-ui@0.1.7) keep
// independent monotonic indices even when they share a version number.
function counterKey(name, version) {
  return `${name}@${version}`;
}

// Next local build index for this package+version = max(persisted counter,
// index of any existing local tarball in the destination) + 1. The persisted
// counter keeps the number monotonic even if old tarballs are deleted, so two
// builds of the same source version are always distinguishable in
// `rasen --version` and in the artifact filename. Returns the counters object
// read from disk so the caller can persist it after a successful (non-dry-run)
// pack without a second read.
function nextBuildIndex(destination, name, version, nameStem) {
  const counters = readCounters();
  const key = counterKey(name, version);
  let max = Number(counters[key]) || 0;
  if (existsSync(destination)) {
    const prefix = `${nameStem}-${version}-local.`;
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

const packageDir = resolve(options.packageDir);
const packagePath = resolve(packageDir, 'package.json');
if (!existsSync(packagePath)) {
  fail(`package.json was not found at ${packagePath}; run this script from the Rasen repository root (use --package <dir> for a workspace package)`);
  process.exit();
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
} catch (error) {
  fail(`package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit();
}

// Allow any package under the @atelierai scope (the CLI @atelierai/rasen and
// the management UI @atelierai/rasen-ui today); refuse anything else so a stray
// --package never packs an unrelated manifest.
if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@atelierai/')) {
  fail(`expected an @atelierai/* package, found ${String(manifest.name)}`);
  process.exit();
}
if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  fail(`expected a stable SemVer version, found ${String(manifest.version)}`);
  process.exit();
}

const version = manifest.version;
const nameStem = manifest.name.replace(/^@/, '').replace('/', '-');
const destination = options.packDestination ?? resolve('artifacts');
const { index: buildIndex, counters } = nextBuildIndex(
  destination,
  manifest.name,
  version,
  nameStem,
);

const localFilename = `${nameStem}-${version}-local.${buildIndex}.tgz`;
const finalArchive = options.dryRun ? undefined : resolve(destination, localFilename);
if (finalArchive && existsSync(finalArchive) && !options.force) {
  fail(`archive already exists: ${finalArchive}; use --force to replace it`);
  process.exit();
}

// The stamp is what `rasen --version` renders — channel plus the commit the
// build came from. The build index stays out of it: it exists to name the
// artifact file, and the commit is what identifies the code.
const stampPath = join(packageDir, 'dist', 'build-info.json');
const stamp = {
  channel: 'dev.local',
  commit: gitCommit(packageDir),
};

let stampWritten = false;
let stagingDir;

try {
  // The build wipes dist/, so the stamp must be written after it.
  run('pnpm', ['run', 'build'], { cwd: packageDir });
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  stampWritten = true;
  console.log(
    `rasen-npm-pack: ${manifest.name}@${version} stamped as` +
      ` "${stamp.channel}${stamp.commit ? ` ${stamp.commit}` : ''}" (build ${buildIndex})`
  );

  const packArgs = ['pack', '--ignore-scripts', '--json'];
  if (options.dryRun) {
    packArgs.push('--dry-run');
  } else {
    mkdirSync(destination, { recursive: true });
    // Pack into a staging directory INSIDE the destination (same filesystem,
    // so the rename below cannot hit EXDEV), then rename to the indexed local
    // filename. npm names its output `<stem>-<version>.tgz`, which would
    // collide across builds and could clobber an unrelated tarball already
    // sitting in the destination.
    stagingDir = mkdtempSync(join(destination, '.rasen-npm-pack-'));
    packArgs.push('--pack-destination', stagingDir);
  }

  const output = run('npm', packArgs, { cwd: packageDir, captureStdout: true });

  if (options.dryRun) {
    if (output) process.stdout.write(output);
    console.log(
      `rasen-npm-pack: dry run — no tarball written; next build index is ${buildIndex}` +
        ` (would write ${resolve(destination, localFilename)})`
    );
  } else {
    const [metadata] = JSON.parse(output);
    if (!metadata || typeof metadata.filename !== 'string') {
      throw new Error('npm pack --json returned no tarball metadata');
    }
    // npm reports the scoped filename with the scope directory stripped; take
    // whatever actually landed in the staging directory rather than guessing.
    const [produced] = readdirSync(stagingDir).filter((entry) => entry.endsWith('.tgz'));
    if (!produced) {
      throw new Error(`npm pack produced no .tgz in ${stagingDir}`);
    }
    renameSync(join(stagingDir, produced), finalArchive);

    counters[counterKey(manifest.name, version)] = buildIndex;
    writeCounters(counters);

    console.log(`rasen-npm-pack: archive ${finalArchive}`);
    console.log(
      `rasen-npm-pack: ${metadata.name}@${metadata.version} — ${metadata.entryCount} files,` +
        ` ${metadata.size} B packed, ${metadata.unpackedSize} B unpacked`
    );
    if (metadata.integrity) console.log(`rasen-npm-pack: integrity ${metadata.integrity}`);
    if (metadata.shasum) console.log(`rasen-npm-pack: shasum ${metadata.shasum}`);
  }
} catch (error) {
  process.exitCode = 1;
  console.error(
    `rasen-npm-pack: ${error instanceof Error ? error.message : String(error)}`
  );
} finally {
  if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
  // package.json is never modified by this helper; the only thing to undo is
  // the stamp, so the local dist/ keeps behaving exactly like a plain build.
  if (stampWritten) {
    rmSync(stampPath, { force: true });
    if (existsSync(stampPath)) {
      fail(`could not remove the local build stamp (${stampPath})`);
    } else {
      console.log(`rasen-npm-pack: removed ${stampPath}`);
    }
  }
}
