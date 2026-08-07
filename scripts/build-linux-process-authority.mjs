#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const crate = path.join(root, 'native', 'linux-process-authority');
const helperName = 'rasen-linux-process-authority-helper';
const brokerClientName = 'rasen-linux-process-authority-broker-client';
const nativeHelperBinaryName = 'rasen-linux-process-authority';
const nativeBrokerClientBinaryName = brokerClientName;
const pinnedRustc = 'rustc 1.88.0 (6b00bc388 2025-06-23)';
const pinnedCargo = 'cargo 1.88.0 (873a06493 2025-05-10)';
const pinnedZig = '0.16.0';
const releaseSchema = 'rasen-linux-process-authority-release-input/1';
const provenanceSchema = 'rasen-linux-process-authority-build-provenance/2';
const sourceInputs = Object.freeze(['Cargo.lock', 'Cargo.toml', 'THIRD_PARTY.md']);
const artifactNames = Object.freeze([helperName, brokerClientName]);
const ownedArchitectureDirectories = Object.freeze(['linux-x64', 'linux-arm64']);
const cargoConfig = [
  '[net]',
  'retry = 0',
  'git-fetch-with-cli = false',
  '',
  '[http]',
  'multiplexing = false',
  '',
].join('\n');
// The private snapshot, cargo-home and target roots are `mkdtemp` paths, so they differ on every
// build. rustc embeds them in panic metadata, which made the emitted artifact differ per build even
// from identical source. Remapping each private root to a stable logical name keeps the mkdtemp
// isolation (still a fresh, unguessable, 0700 directory per build) while making the embedded strings
// deterministic. Deterministic directory *names* were rejected: they would reintroduce collision and
// TOCTOU risk between concurrent builds, which this script otherwise avoids by construction.
const remappedCrateRoot = '/rasen-linux-process-authority/crate';
const remappedCargoRoot = '/rasen-linux-process-authority/cargo';
const remappedTargetRoot = '/rasen-linux-process-authority/target';
const semantics = Object.freeze([
  'forked-descendant-non-escape',
  'root-exit-distinct',
  'natural-exact-empty',
  'recursive-terminate',
  'recursive-abort',
  'bounded-controls',
  'identity-drift-detection',
  'event-completeness',
]);

function fail(message) {
  throw new Error(`Linux process-authority build: ${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonical(value) {
  return `${JSON.stringify(value)}\n`;
}

function exactObject(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} is not an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])) {
    fail(`${name} has an unknown or missing field`);
  }
}

function exactHash(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    fail(`${name} is not an exact SHA-256 digest`);
  }
}

function boundedString(value, name, maximum = 1024) {
  if (typeof value !== 'string' || value.length === 0 ||
      value.length > maximum || value.includes('\0')) {
    fail(`${name} is malformed`);
  }
}

function relativeFiles(directory, prefix = '') {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      output.push(...relativeFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      output.push(relative.split(path.sep).join('/'));
    } else {
      fail(`tree input is not a regular file: ${relative}`);
    }
  }
  return output;
}

function sourceFileList(sourceRoot) {
  return [
    ...sourceInputs,
    ...relativeFiles(path.join(sourceRoot, 'src'), 'src'),
  ].sort();
}

function sourceDigest(sourceRoot = crate) {
  const hash = createHash('sha256');
  for (const file of sourceFileList(sourceRoot)) {
    const absolute = path.join(sourceRoot, ...file.split('/'));
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`source input is not an exact regular file: ${file}`);
    }
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function targetIdentity(target) {
  if (target === 'x86_64-unknown-linux-gnu' || target === 'x86_64-unknown-linux-musl') {
    return Object.freeze({
      target,
      arch: 'x64',
      directory: 'linux-x64',
      elfClass: 64,
      elfMachine: 62,
    });
  }
  if (target === 'aarch64-unknown-linux-gnu' || target === 'aarch64-unknown-linux-musl') {
    return Object.freeze({
      target,
      arch: 'arm64',
      directory: 'linux-arm64',
      elfClass: 64,
      elfMachine: 183,
    });
  }
  fail(`target is not a supported explicit Linux target: ${target}`);
}

function defaultTarget() {
  if (process.arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  fail(`host architecture is unsupported: ${process.arch}`);
}

function parseArguments(argv) {
  let mode = 'build';
  let target = defaultTarget();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--assemble-staged-only') {
      if (mode !== 'build') fail('only one operation may be selected');
      mode = 'assemble-staged-only';
    } else if (argument === '--check-only') {
      if (mode !== 'build') fail('only one operation may be selected');
      mode = 'check-only';
    } else if (argument === '--plan') {
      if (mode !== 'build') fail('only one operation may be selected');
      mode = 'plan';
    } else if (argument === '--target') {
      index += 1;
      if (index >= argv.length) fail('--target requires a value');
      target = argv[index];
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }
  return Object.freeze({ mode, ...targetIdentity(target) });
}

function planFor(identity) {
  return Object.freeze({
    platform: 'linux',
    arch: identity.arch,
    target: identity.target,
    artifactPath: `dist/native/${identity.directory}/${helperName}`,
    evidenceClassification: process.platform === 'linux'
      ? 'native-build-non-runtime'
      : 'cross-build-non-runtime',
    runtimeAccepted: false,
  });
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function exactRegularFile(parent, candidate, name) {
  const parentReal = fs.realpathSync.native(parent);
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    fail(`${name} is missing`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${name} is not an exact regular file`);
  const real = fs.realpathSync.native(candidate);
  if (!within(parentReal, real)) fail(`${name} escapes its trusted root`);
  return Object.freeze({ real, stat });
}

function exactDirectory(candidate, name, create = false) {
  if (create) fs.mkdirSync(candidate, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${name} is not an exact directory`);
  return fs.realpathSync.native(candidate);
}

function readCanonicalJson(file, maximum, name) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximum) {
    fail(`${name} is not a bounded exact regular file`);
  }
  const text = fs.readFileSync(file, 'utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${name} is malformed`);
  }
  if (canonical(value) !== text) fail(`${name} is not canonical`);
  return Object.freeze({ value, text });
}

function inspectElf(bytes, identity, name) {
  if (bytes.byteLength < 64 ||
      bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    fail(`${name} is not an ELF executable`);
  }
  const elfClass = bytes[4] === 2 ? 64 : bytes[4] === 1 ? 32 : 0;
  const elfData = bytes[5] === 1 ? 'little-endian' : bytes[5] === 2 ? 'big-endian' : 'unknown';
  if (elfData !== 'little-endian' || bytes[6] !== 1) {
    fail(`${name} ELF encoding or version is unsupported`);
  }
  const type = bytes.readUInt16LE(16);
  const elfMachine = bytes.readUInt16LE(18);
  if (![2, 3].includes(type) || elfClass !== identity.elfClass ||
      elfMachine !== identity.elfMachine) {
    fail(`${name} ELF class or machine differs from target ${identity.target}`);
  }
  return Object.freeze({ elfClass, elfData, elfMachine });
}

function validateReleaseBuild(build, index) {
  exactObject(build, [
    'platform',
    'arch',
    'target',
    'directory',
    'evidenceClassification',
    'sourceSha256',
    'executableMode',
    'compiler',
    'cargo',
    'rustcExecutableSha256',
    'cargoExecutableSha256',
    'cargoConfigSha256',
    'environmentSha256',
    'linker',
    'artifacts',
  ], `trusted release build ${index}`);
  const identity = targetIdentity(build.target);
  if (build.platform !== 'linux' || build.arch !== identity.arch ||
      build.directory !== identity.directory ||
      build.evidenceClassification !== 'native-build-non-runtime' ||
      build.executableMode !== '0755' || build.compiler !== pinnedRustc ||
      build.cargo !== pinnedCargo || build.sourceSha256 !== sourceDigest()) {
    fail(`trusted release build ${index} does not bind the current pinned native source`);
  }
  for (const key of [
    'sourceSha256',
    'rustcExecutableSha256',
    'cargoExecutableSha256',
    'cargoConfigSha256',
    'environmentSha256',
  ]) {
    exactHash(build[key], `trusted release build ${index} ${key}`);
  }
  exactObject(build.linker, ['executableSha256', 'version'], `trusted release linker ${index}`);
  exactHash(build.linker.executableSha256, `trusted release linker ${index} executable`);
  boundedString(build.linker.version, `trusted release linker ${index} version`);
  if (!Array.isArray(build.artifacts) || build.artifacts.length !== artifactNames.length) {
    fail(`trusted release build ${index} artifact inventory is not exact`);
  }
  const seen = new Set();
  for (const artifact of build.artifacts) {
    exactObject(artifact, [
      'file',
      'length',
      'sha256',
      'elfClass',
      'elfData',
      'elfMachine',
    ], `trusted release build ${index} artifact`);
    if (!artifactNames.includes(artifact.file) || seen.has(artifact.file) ||
        !Number.isSafeInteger(artifact.length) || artifact.length <= 0 ||
        artifact.length > 256 * 1024 * 1024 || artifact.elfClass !== identity.elfClass ||
        artifact.elfData !== 'little-endian' || artifact.elfMachine !== identity.elfMachine) {
      fail(`trusted release build ${index} artifact identity or bounds differ`);
    }
    exactHash(artifact.sha256, `trusted release build ${index} artifact hash`);
    seen.add(artifact.file);
  }
  return Object.freeze({
    ...build,
    linker: Object.freeze({ ...build.linker }),
    artifacts: Object.freeze(build.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
  });
}

function validateReleaseInput(value, text) {
  exactObject(value, ['schema', 'builds'], 'trusted release input');
  if (value.schema !== releaseSchema || !Array.isArray(value.builds) ||
      value.builds.length === 0 || value.builds.length > ownedArchitectureDirectories.length) {
    fail('trusted release input schema or build count differs');
  }
  const builds = value.builds.map(validateReleaseBuild);
  if (new Set(builds.map((build) => build.directory)).size !== builds.length) {
    fail('trusted release input repeats an architecture');
  }
  return Object.freeze({
    value: Object.freeze({ schema: releaseSchema, builds: Object.freeze(builds) }),
    text,
    sha256: sha256(Buffer.from(text)),
    builds: new Map(builds.map((build) => [build.directory, build])),
  });
}

function trustedReleaseInput(stagingRoot) {
  const configured = process.env.RASEN_LINUX_PROCESS_AUTHORITY_RELEASE_INPUT;
  const pinnedDigest = process.env.RASEN_LINUX_PROCESS_AUTHORITY_RELEASE_INPUT_SHA256;
  if (!configured) fail('staged assembly requires a separate trusted release input');
  exactHash(pinnedDigest, 'trusted release input pinned SHA-256');
  const candidate = path.resolve(configured);
  const parent = exactDirectory(path.dirname(candidate), 'trusted release input parent');
  const releaseFile = exactRegularFile(parent, candidate, 'trusted release input');
  const stagingReal = fs.realpathSync.native(stagingRoot);
  if (within(stagingReal, releaseFile.real) || releaseFile.real === stagingReal) {
    fail('trusted release input must be outside the mutable staging tree');
  }
  const parsed = readCanonicalJson(releaseFile.real, 1024 * 1024, 'trusted release input');
  if (sha256(Buffer.from(parsed.text)) !== pinnedDigest) {
    fail('trusted release input hash differs from its externally pinned SHA-256');
  }
  return validateReleaseInput(parsed.value, parsed.text);
}

function provenanceFor(release, build) {
  return Object.freeze({
    schema: provenanceSchema,
    releaseInputSha256: release.sha256,
    build,
  });
}

function readStagedArtifact(stagingRoot, directory, release) {
  const build = release.builds.get(directory);
  if (!build) fail(`staging architecture is absent from trusted release input: ${directory}`);
  const rootReal = fs.realpathSync.native(stagingRoot);
  const artifactDirectory = path.join(rootReal, directory);
  const directoryReal = exactDirectory(artifactDirectory, `staged directory ${directory}`);
  if (!within(rootReal, directoryReal)) fail(`staged directory escapes: ${directory}`);
  const bytesByName = new Map();
  for (const name of artifactNames) {
    const binary = exactRegularFile(directoryReal, path.join(directoryReal, name), `staged ${name}`);
    if ((binary.stat.mode & 0o7777) !== 0o755) {
      fail(`staged ${name} mode is not exact 0755`);
    }
    const bytes = fs.readFileSync(binary.real);
    const expected = build.artifacts.find((artifact) => artifact.file === name);
    if (!expected || bytes.byteLength !== expected.length || sha256(bytes) !== expected.sha256) {
      fail(`staged ${name} differs from trusted release length or hash`);
    }
    const actualElf = inspectElf(bytes, targetIdentity(build.target), `staged ${name}`);
    if (actualElf.elfClass !== expected.elfClass || actualElf.elfData !== expected.elfData ||
        actualElf.elfMachine !== expected.elfMachine) {
      fail(`staged ${name} ELF identity differs from trusted release input`);
    }
    bytesByName.set(name, bytes);
  }
  const provenanceFile = exactRegularFile(
    directoryReal,
    path.join(directoryReal, 'provenance.json'),
    'staged provenance'
  );
  const parsed = readCanonicalJson(provenanceFile.real, 1024 * 1024, 'staged provenance');
  exactObject(parsed.value, ['schema', 'releaseInputSha256', 'build'], 'staged provenance');
  if (parsed.value.schema !== provenanceSchema ||
      parsed.value.releaseInputSha256 !== release.sha256 ||
      canonical(parsed.value.build) !== canonical(build)) {
    fail('staged provenance does not bind the separate trusted release input');
  }
  return Object.freeze({
    helperBytes: bytesByName.get(helperName),
    brokerClientBytes: bytesByName.get(brokerClientName),
    build,
  });
}

function stagedArtifacts(release, stagingRoot) {
  const artifacts = new Map();
  for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ownedArchitectureDirectories.includes(entry.name)) {
      fail(`staging root contains an unknown entry: ${entry.name}`);
    }
    artifacts.set(entry.name, readStagedArtifact(stagingRoot, entry.name, release));
  }
  if (artifacts.size !== release.builds.size ||
      [...release.builds.keys()].some((directory) => !artifacts.has(directory))) {
    fail('staging inventory differs from trusted release input');
  }
  return artifacts;
}

function manifestFor(artifact, mode) {
  const primary = mode === 'user-pidns';
  const bytes = primary ? artifact.helperBytes : artifact.brokerClientBytes;
  return Object.freeze({
    schema: 'rasen-linux-process-authority-artifact/1',
    platform: 'linux',
    arch: artifact.build.arch,
    mode,
    providerId: primary
      ? 'rasen.linux.user-pidns'
      : 'rasen.linux.broker-pidns-cgroupv2',
    capabilityId: 'rasen-recursive-process-scope/1',
    protocolVersion: 1,
    providerReferenceVersion: 1,
    artifactFile: primary ? helperName : brokerClientName,
    executableMode: '0755',
    length: bytes.byteLength,
    sha256: sha256(bytes),
    sourceSha256: artifact.build.sourceSha256,
    compiler: artifact.build.compiler,
  });
}

function providerManifest(directory) {
  const descriptor = Object.freeze({
    capabilityId: 'rasen-recursive-process-scope/1',
    protocolVersion: 1,
    commonContractVersion: 1,
    providerReferenceVersion: 1,
    semantics,
  });
  return Object.freeze({
    schema: 'rasen-process-authority-providers/1',
    providers: Object.freeze([
      Object.freeze({
        providerId: 'rasen.linux.user-pidns',
        ...descriptor,
        artifactPath: `dist/native/${directory}/${helperName}`,
      }),
      Object.freeze({
        providerId: 'rasen.linux.broker-pidns-cgroupv2',
        ...descriptor,
        artifactPath: `dist/native/${directory}/${brokerClientName}`,
      }),
    ]),
  });
}

function authorityModule(identities) {
  const ordered = [...identities].sort((left, right) =>
    left.artifactPath.localeCompare(right.artifactPath));
  return [
    '// Generated by scripts/build-linux-process-authority.mjs from pinned build inputs.',
    '// Do not edit this build output.',
    `export const LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES = Object.freeze(${JSON.stringify(ordered)}.map((identity) => Object.freeze(identity)));`,
    '',
  ].join('\n');
}

function outputRoot() {
  const configured = process.env.RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT;
  const candidate = configured ? path.resolve(configured) : root;
  return exactDirectory(candidate, 'Linux authority build root', true);
}

function buildTemporaryRoot() {
  const configured = process.env.RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT;
  const candidate = configured ? path.resolve(configured) : os.tmpdir();
  const resolved = exactDirectory(candidate, 'Linux authority temporary root', true);
  if (resolved === root || within(root, resolved)) {
    fail('Linux authority temporary root must be outside the source worktree');
  }
  return resolved;
}

function privateTemporaryDirectory(parent, prefix) {
  const parentReal = exactDirectory(parent, 'temporary parent', true);
  const temporary = fs.mkdtempSync(path.join(parentReal, prefix), { encoding: 'utf8' });
  fs.chmodSync(temporary, 0o700);
  return temporary;
}

function writeFile(destination, bytes, mode) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  fs.writeFileSync(destination, bytes, { mode });
  fs.chmodSync(destination, mode);
}

function writeJson(destination, value) {
  writeFile(destination, canonical(value), 0o644);
}

function assertClosedInventory(tree, expectedFiles, executables = new Set()) {
  const actual = relativeFiles(tree).sort();
  const expected = [...expectedFiles].sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    fail(`private assembly inventory is not closed: ${actual.join(', ')}`);
  }
  for (const file of actual) {
    const absolute = path.join(tree, ...file.split('/'));
    const stat = fs.lstatSync(absolute);
    const expectedMode = executables.has(file) ? 0o755 : 0o644;
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== expectedMode) {
      fail(`private assembly mode or type differs: ${file}`);
    }
  }
}

function replacePathsAtomically(operations, backupRoot) {
  const staged = [];
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupRoot, 0o700);
  try {
    for (const [index, operation] of operations.entries()) {
      fs.mkdirSync(path.dirname(operation.destination), { recursive: true, mode: 0o755 });
      const backup = fs.existsSync(operation.destination)
        ? path.join(backupRoot, String(index))
        : undefined;
      if (backup) fs.renameSync(operation.destination, backup);
      staged.push({ ...operation, backup, installed: false });
    }
    for (const operation of staged) {
      if (operation.source) {
        fs.renameSync(operation.source, operation.destination);
        operation.installed = true;
      }
    }
  } catch (error) {
    for (const operation of [...staged].reverse()) {
      if (operation.installed && fs.existsSync(operation.destination)) {
        fs.rmSync(operation.destination, { recursive: true, force: true });
      }
      if (operation.backup && fs.existsSync(operation.backup)) {
        fs.renameSync(operation.backup, operation.destination);
      }
    }
    throw error;
  }
  for (const operation of staged) {
    if (operation.backup) fs.rmSync(operation.backup, { recursive: true, force: true });
  }
  fs.rmSync(backupRoot, { recursive: true, force: true });
}

function assertAuthoritativeModeSupport(buildRoot) {
  if (process.platform === 'win32') {
    fail('authoritative assembly requires a POSIX filesystem that preserves exact 0755 mode');
  }
  const probeRoot = privateTemporaryDirectory(buildRoot, '.rasen-linux-authority-mode-probe-');
  try {
    const probe = path.join(probeRoot, 'probe');
    writeFile(probe, 'mode-probe', 0o755);
    if ((fs.statSync(probe).mode & 0o7777) !== 0o755) {
      fail('authoritative assembly filesystem does not preserve exact 0755 mode');
    }
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

function assemblePackageTree(tree, artifacts) {
  const identities = [];
  const expected = [];
  const executables = new Set();
  for (const directory of [...artifacts.keys()].sort()) {
    const artifact = artifacts.get(directory);
    for (const mode of ['user-pidns', 'broker-pidns-cgroupv2']) {
      const primary = mode === 'user-pidns';
      const name = primary ? helperName : brokerClientName;
      const bytes = primary ? artifact.helperBytes : artifact.brokerClientBytes;
      const relative = `dist/native/${directory}/${name}`;
      writeFile(path.join(tree, ...relative.split('/')), bytes, 0o755);
      writeJson(path.join(tree, ...`${relative}.manifest.json`.split('/')), manifestFor(artifact, mode));
      expected.push(relative, `${relative}.manifest.json`);
      executables.add(relative);
      const manifest = manifestFor(artifact, mode);
      identities.push(Object.freeze({
        artifactPath: relative,
        arch: manifest.arch,
        mode: manifest.mode,
        providerId: manifest.providerId,
        protocolVersion: manifest.protocolVersion,
        providerReferenceVersion: manifest.providerReferenceVersion,
        length: manifest.length,
        sha256: manifest.sha256,
        sourceSha256: manifest.sourceSha256,
        compiler: manifest.compiler,
      }));
    }
    const providerRelative = `dist/native/linux-process-authority/providers-${directory}.json`;
    writeJson(path.join(tree, ...providerRelative.split('/')), providerManifest(directory));
    expected.push(providerRelative);
  }
  const moduleRelative = 'dist/core/session-host/process-authority/linux/build-authority.js';
  writeFile(
    path.join(tree, ...moduleRelative.split('/')),
    authorityModule(identities),
    0o644
  );
  expected.push(moduleRelative);
  assertClosedInventory(tree, expected, executables);
  return identities;
}

function installPackageTree(buildRoot, tree, artifacts) {
  const nativeRoot = path.join(buildRoot, 'dist', 'native');
  const operations = [];
  if (fs.existsSync(nativeRoot)) {
    const nativeRootReal = exactDirectory(nativeRoot, 'native package output root');
    for (const entry of fs.readdirSync(nativeRootReal, { withFileTypes: true })) {
      if (entry.name.startsWith('linux-') &&
          entry.name !== 'linux-process-authority' &&
          !ownedArchitectureDirectories.includes(entry.name)) {
        operations.push({
          source: undefined,
          destination: path.join(nativeRootReal, entry.name),
        });
      }
    }
  }
  for (const directory of ownedArchitectureDirectories) {
    const source = path.join(tree, 'dist', 'native', directory);
    const destination = path.join(nativeRoot, directory);
    operations.push({ source: artifacts.has(directory) ? source : undefined, destination });
  }
  operations.push({
    source: path.join(tree, 'dist', 'native', 'linux-process-authority'),
    destination: path.join(nativeRoot, 'linux-process-authority'),
  }, {
    source: path.join(
      tree,
      'dist',
      'core',
      'session-host',
      'process-authority',
      'linux',
      'build-authority.js'
    ),
    destination: path.join(
      buildRoot,
      'dist',
      'core',
      'session-host',
      'process-authority',
      'linux',
      'build-authority.js'
    ),
  });
  replacePathsAtomically(operations, path.join(tree, '.replacement-backups'));
}

function writeExportTree(exportRoot, release, artifacts) {
  const resolved = path.resolve(exportRoot);
  if (resolved === path.parse(resolved).root || resolved === root || resolved === crate) {
    fail('export root is too broad');
  }
  const parent = exactDirectory(path.dirname(resolved), 'export parent', true);
  const container = privateTemporaryDirectory(parent, `.${path.basename(resolved)}.tmp-`);
  const tree = path.join(container, 'new');
  fs.mkdirSync(tree, { recursive: true, mode: 0o700 });
  const expected = ['release-input.json'];
  const executables = new Set();
  try {
    writeFile(path.join(tree, 'release-input.json'), release.text, 0o644);
    for (const directory of [...artifacts.keys()].sort()) {
      const artifact = artifacts.get(directory);
      for (const [name, bytes] of [
        [helperName, artifact.helperBytes],
        [brokerClientName, artifact.brokerClientBytes],
      ]) {
        const relative = `staging/${directory}/${name}`;
        writeFile(path.join(tree, ...relative.split('/')), bytes, 0o755);
        expected.push(relative);
        executables.add(relative);
      }
      const provenanceRelative = `staging/${directory}/provenance.json`;
      writeJson(
        path.join(tree, ...provenanceRelative.split('/')),
        provenanceFor(release, artifact.build)
      );
      expected.push(provenanceRelative);
    }
    assertClosedInventory(tree, expected, executables);
    replacePathsAtomically(
      [{ source: tree, destination: resolved }],
      path.join(container, 'replacement-backups')
    );
  } finally {
    if (fs.existsSync(container)) fs.rmSync(container, { recursive: true, force: true });
  }
}

function assemble(artifacts, release) {
  if (artifacts.size === 0) fail('no native Linux artifact was supplied');
  const buildRoot = outputRoot();
  assertAuthoritativeModeSupport(buildRoot);
  const tree = privateTemporaryDirectory(buildRoot, '.rasen-linux-authority-assembly-');
  let identities;
  try {
    identities = assemblePackageTree(tree, artifacts);
    installPackageTree(buildRoot, tree, artifacts);
  } finally {
    if (fs.existsSync(tree)) fs.rmSync(tree, { recursive: true, force: true });
  }
  const exportRoot = process.env.RASEN_LINUX_PROCESS_AUTHORITY_EXPORT_DIR;
  if (exportRoot) writeExportTree(exportRoot, release, artifacts);
  return identities;
}

function rejectBuildEnvironmentOverrides() {
  const exact = new Set([
    'RUSTC',
    'RUSTC_WRAPPER',
    'RUSTFLAGS',
    'CARGO_ENCODED_RUSTFLAGS',
    'CARGO_BUILD_RUSTC',
    'CARGO_BUILD_RUSTC_WRAPPER',
    'CARGO_BUILD_RUSTFLAGS',
    'CARGO_TARGET_DIR',
    'CC',
    'CFLAGS',
    'CXX',
    'CXXFLAGS',
    'LD',
    'LDFLAGS',
    'AR',
  ]);
  const overrides = Object.keys(process.env).filter((key) =>
    process.env[key] && (exact.has(key) || /^CARGO_TARGET_.*_(?:LINKER|RUNNER|RUSTFLAGS)$/u.test(key))
  );
  if (overrides.length > 0) {
    fail(`build-affecting environment override is forbidden: ${overrides.sort().join(', ')}`);
  }
}

function resolveExecutable(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const output = execFileSync(command, [name], { encoding: 'utf8' }).trim();
  const first = output.split(/\r?\n/u).find((line) => line.trim().length > 0);
  if (!first) fail(`pinned tool is unavailable: ${name}`);
  const candidate = path.resolve(first.trim());
  const invocationStat = fs.lstatSync(candidate);
  const resolved = fs.realpathSync.native(candidate);
  const binaryStat = fs.lstatSync(resolved);
  if ((!invocationStat.isFile() && !invocationStat.isSymbolicLink()) ||
      !binaryStat.isFile() || binaryStat.isSymbolicLink()) {
    fail(`pinned tool path is not an exact executable or rustup proxy: ${name}`);
  }
  return candidate;
}

function optionalExecutable(name) {
  try {
    return resolveExecutable(name);
  } catch {
    return undefined;
  }
}

function firstLine(output) {
  return output.trim().split(/\r?\n/u)[0];
}

function toolchainIdentity(identity, includeLinker) {
  const rustcProxy = resolveExecutable('rustc');
  const sysrootText = execFileSync(rustcProxy, ['--print', 'sysroot'], { encoding: 'utf8' }).trim();
  boundedString(sysrootText, 'pinned Rust sysroot', 4096);
  if (!path.isAbsolute(sysrootText)) fail('pinned Rust sysroot is not absolute');
  const sysroot = exactDirectory(path.resolve(sysrootText), 'pinned Rust sysroot');
  const toolBin = exactDirectory(path.join(sysroot, 'bin'), 'pinned Rust tool bin');
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const rustcPath = exactRegularFile(
    toolBin,
    path.join(toolBin, `rustc${executableSuffix}`),
    'pinned rustc binary'
  ).real;
  const cargoPath = exactRegularFile(
    toolBin,
    path.join(toolBin, `cargo${executableSuffix}`),
    'pinned cargo binary'
  ).real;
  const compilerReport = execFileSync(rustcPath, ['--version', '--verbose'], { encoding: 'utf8' }).trim();
  const compiler = firstLine(compilerReport);
  const cargo = firstLine(execFileSync(cargoPath, ['--version'], { encoding: 'utf8' }));
  if (compiler !== pinnedRustc || cargo !== pinnedCargo) {
    fail(`toolchain differs: ${compiler}; ${cargo}`);
  }
  let linker;
  let hostLinkerPath;
  let hostLinkerKind;
  let targetLinkerPath;
  if (includeLinker) {
    if (identity.arch !== process.arch) {
      fail('native packaging build cannot claim a foreign host architecture');
    }
    hostLinkerPath = optionalExecutable('cc');
    if (hostLinkerPath) {
      hostLinkerKind = 'cc';
    } else {
      const configuredZig = process.env.RASEN_LINUX_PROCESS_AUTHORITY_ZIG;
      if (!configuredZig) {
        fail('native packaging build requires host cc or explicit pinned Zig');
      }
      const zigCandidate = path.resolve(configuredZig);
      const zigParent = exactDirectory(path.dirname(zigCandidate), 'pinned Zig parent');
      hostLinkerPath = exactRegularFile(zigParent, zigCandidate, 'pinned Zig binary').real;
      const zigVersion = execFileSync(hostLinkerPath, ['version'], { encoding: 'utf8' }).trim();
      if (zigVersion !== pinnedZig) fail(`Zig differs: ${zigVersion}`);
      hostLinkerKind = 'zig-cc';
    }
    if (identity.target.endsWith('-musl')) {
      const host = compilerReport.match(/^host:\s*(\S+)$/mu)?.[1];
      if (!host) fail('pinned compiler report omits its exact host identity');
      const linkerDirectory = exactDirectory(
        path.join(sysroot, 'lib', 'rustlib', host, 'bin'),
        'pinned Rust linker directory'
      );
      targetLinkerPath = exactRegularFile(
        linkerDirectory,
        path.join(linkerDirectory, 'rust-lld'),
        'pinned rust-lld binary'
      ).real;
    } else {
      targetLinkerPath = hostLinkerPath;
    }
    const hostLinkerVersion = hostLinkerKind === 'zig-cc'
      ? `zig cc ${pinnedZig}`
      : execFileSync(hostLinkerPath, ['--version'], { encoding: 'utf8' }).trim();
    const targetLinkerVersion = identity.target.endsWith('-musl')
      ? execFileSync(targetLinkerPath, ['-flavor', 'gnu', '--version'], { encoding: 'utf8' }).trim()
      : hostLinkerVersion;
    boundedString(hostLinkerVersion, 'host linker version', 4096);
    boundedString(targetLinkerVersion, 'target linker version', 4096);
    linker = Object.freeze({
      executableSha256: sha256(fs.readFileSync(hostLinkerPath)),
      version: hostLinkerVersion,
    });
  }
  return Object.freeze({
    compiler,
    cargo,
    rustcPath,
    cargoPath,
    rustcExecutableSha256: sha256(fs.readFileSync(rustcPath)),
    cargoExecutableSha256: sha256(fs.readFileSync(cargoPath)),
    linker,
    hostLinkerPath,
    hostLinkerKind,
    targetLinkerPath,
  });
}

function createSourceSnapshot() {
  const container = fs.mkdtempSync(path.join(
    buildTemporaryRoot(),
    'rasen-linux-authority-source-snapshot-'
  ));
  try {
    const snapshotRoot = path.join(container, 'crate');
    fs.mkdirSync(snapshotRoot, { recursive: true, mode: 0o700 });
    const sourceSha256Before = sourceDigest(crate);
    for (const file of sourceFileList(crate)) {
      const source = path.join(crate, ...file.split('/'));
      const destination = path.join(snapshotRoot, ...file.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
    const snapshotDigest = sourceDigest(snapshotRoot);
    if (snapshotDigest !== sourceSha256Before) {
      fail('source changed while the immutable source snapshot was created');
    }
    for (const file of sourceFileList(snapshotRoot)) {
      fs.chmodSync(path.join(snapshotRoot, ...file.split('/')), 0o444);
    }
    const directories = [snapshotRoot];
    for (const file of sourceFileList(snapshotRoot)) {
      let directory = path.dirname(path.join(snapshotRoot, ...file.split('/')));
      while (directory !== snapshotRoot && within(snapshotRoot, directory)) {
        directories.push(directory);
        directory = path.dirname(directory);
      }
    }
    for (const directory of [...new Set(directories)].sort((a, b) => b.length - a.length)) {
      fs.chmodSync(directory, 0o555);
    }
    return Object.freeze({ container, snapshotRoot, sourceSha256Before });
  } catch (error) {
    removeBuildTemporary(container);
    throw error;
  }
}

function assertCargoConfigIsolation(snapshotRoot) {
  let directory = path.resolve(snapshotRoot);
  while (true) {
    for (const relative of [path.join('.cargo', 'config.toml'), path.join('.cargo', 'config')]) {
      if (fs.existsSync(path.join(directory, relative))) {
        fail(`source snapshot has an untrusted ancestor Cargo config: ${directory}`);
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

function makeBuildTemporaryWritable(candidate) {
  if (!fs.existsSync(candidate)) return;
  const stat = fs.lstatSync(candidate);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.chmodSync(candidate, 0o700);
    for (const entry of fs.readdirSync(candidate)) {
      makeBuildTemporaryWritable(path.join(candidate, entry));
    }
  } else if (!stat.isSymbolicLink()) {
    fs.chmodSync(candidate, 0o600);
  }
}

function removeBuildTemporary(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return;
  makeBuildTemporaryWritable(candidate);
  fs.rmSync(candidate, { recursive: true, force: true });
}

function hostLinkerCommand(toolchain, cargoHome) {
  if (!toolchain.hostLinkerPath) return undefined;
  if (toolchain.hostLinkerKind !== 'zig-cc') return toolchain.hostLinkerPath;
  if (/[\r\n]/u.test(toolchain.hostLinkerPath)) {
    fail('pinned Zig path contains a line break');
  }
  const commandDirectory = path.join(cargoHome, 'host-linker-bin');
  fs.mkdirSync(commandDirectory, { mode: 0o700 });
  fs.chmodSync(commandDirectory, 0o700);
  const escaped = toolchain.hostLinkerPath
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`');
  const command = path.join(commandDirectory, 'cc');
  writeFile(command, `#!/bin/sh\nexec "${escaped}" cc "$@"\n`, 0o755);
  return command;
}

function isolatedEnvironment(toolchain, identity, cargoHome, privateRoots) {
  const allowed = [
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ];
  const env = {};
  for (const key of allowed) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const hostLinkerCommandPath = hostLinkerCommand(toolchain, cargoHome);
  const pathDirectories = [
    path.dirname(toolchain.cargoPath),
    path.dirname(toolchain.rustcPath),
    ...(hostLinkerCommandPath ? [path.dirname(hostLinkerCommandPath)] : []),
    ...(toolchain.targetLinkerPath ? [path.dirname(toolchain.targetLinkerPath)] : []),
    ...(process.platform === 'win32' && process.env.SystemRoot
      ? [path.join(process.env.SystemRoot, 'System32')]
      : ['/usr/bin', '/bin']),
  ];
  env.PATH = [...new Set(pathDirectories)].join(path.delimiter);
  env.CARGO_HOME = cargoHome;
  env.RUSTC = toolchain.rustcPath;
  env.CARGO_INCREMENTAL = '0';
  env.CARGO_TERM_COLOR = 'never';
  env.SOURCE_DATE_EPOCH = '0';
  // Set by this script, never by a caller: `rejectBuildEnvironmentOverrides()` still refuses an
  // inherited RUSTFLAGS/CARGO_ENCODED_RUSTFLAGS, and that guard is unchanged. The encoded form is
  // used rather than RUSTFLAGS because it is separator-delimited and therefore safe for private
  // roots containing spaces (a real case under a Windows TEMP).
  env.CARGO_ENCODED_RUSTFLAGS = [
    `--remap-path-prefix=${privateRoots.snapshotRoot}=${remappedCrateRoot}`,
    `--remap-path-prefix=${privateRoots.cargoHome}=${remappedCargoRoot}`,
    `--remap-path-prefix=${privateRoots.targetRoot}=${remappedTargetRoot}`,
  ].join('\u001f');
  if (toolchain.targetLinkerPath) {
    const targetKey = `CARGO_TARGET_${identity.target.toUpperCase().replaceAll('-', '_')}_LINKER`;
    env[targetKey] = toolchain.targetLinkerPath;
  }
  const recorded = Object.freeze({
    target: identity.target,
    toolchainSelection: 'exact-sysroot-binaries',
    rustcPath: toolchain.rustcPath,
    cargoPath: toolchain.cargoPath,
    hostLinkerPath: toolchain.hostLinkerPath ?? null,
    hostLinkerKind: toolchain.hostLinkerKind ?? null,
    hostLinkerCommandSha256: hostLinkerCommandPath
      ? sha256(fs.readFileSync(hostLinkerCommandPath))
      : null,
    targetLinkerPath: toolchain.targetLinkerPath ?? null,
    targetLinkerSha256: toolchain.targetLinkerPath
      ? sha256(fs.readFileSync(toolchain.targetLinkerPath))
      : null,
    cargoHomePolicy: 'fresh-private-cargo-home',
    sourceDateEpoch: env.SOURCE_DATE_EPOCH,
    cargoIncremental: env.CARGO_INCREMENTAL,
    // The logical targets, deliberately, not the per-build private roots they replace: recording the
    // variable source paths here would make `environmentSha256` (and therefore
    // `releaseInputSha256`) vary per build for the very inputs this remapping exists to stabilise.
    pathRemapPolicy: 'private-roots-remapped-to-logical-names',
    remappedPrefixes: Object.freeze([remappedCrateRoot, remappedCargoRoot, remappedTargetRoot]),
  });
  return Object.freeze({ env, environmentSha256: sha256(Buffer.from(canonical(recorded))) });
}

function cargoArguments(command, identity, targetRoot, manifestPath) {
  return [
    command,
    '--locked',
    '--manifest-path',
    manifestPath,
    '--target',
    identity.target,
    '--target-dir',
    targetRoot,
    '--bin',
    'rasen-linux-process-authority',
    '--bin',
    'rasen-linux-process-authority-broker-client',
    ...(command === 'build' ? ['--release'] : []),
  ];
}

function isolatedBuildInputs(identity, includeLinker) {
  rejectBuildEnvironmentOverrides();
  let snapshot;
  let cargoHome;
  let targetRoot;
  try {
    snapshot = createSourceSnapshot();
    cargoHome = fs.mkdtempSync(path.join(
      buildTemporaryRoot(),
      'rasen-linux-authority-cargo-home-'
    ));
    fs.chmodSync(cargoHome, 0o700);
    writeFile(path.join(cargoHome, 'config.toml'), cargoConfig, 0o600);
    targetRoot = fs.mkdtempSync(path.join(
      buildTemporaryRoot(),
      'rasen-linux-authority-target-'
    ));
    fs.chmodSync(targetRoot, 0o700);
    assertCargoConfigIsolation(snapshot.snapshotRoot);
    const toolchain = toolchainIdentity(identity, includeLinker);
    const environment = isolatedEnvironment(toolchain, identity, cargoHome, Object.freeze({
      snapshotRoot: snapshot.snapshotRoot,
      cargoHome,
      targetRoot,
    }));
    return Object.freeze({
      snapshot,
      cargoHome,
      targetRoot,
      toolchain,
      environment,
      cargoConfigSha256: sha256(Buffer.from(cargoConfig)),
    });
  } catch (error) {
    for (const candidate of [targetRoot, cargoHome, snapshot?.container]) {
      removeBuildTemporary(candidate);
    }
    throw error;
  }
}

function verifySourceStability(inputs) {
  const sourceSha256After = sourceDigest(inputs.snapshot.snapshotRoot);
  const liveSourceSha256After = sourceDigest(crate);
  if (sourceSha256After !== inputs.snapshot.sourceSha256Before ||
      liveSourceSha256After !== inputs.snapshot.sourceSha256Before) {
    fail('source digest changed before/after the isolated build');
  }
  return sourceSha256After;
}

function cleanupBuildInputs(inputs) {
  for (const candidate of [inputs.targetRoot, inputs.cargoHome, inputs.snapshot.container]) {
    removeBuildTemporary(candidate);
  }
}

function checkOnly(identity) {
  const inputs = isolatedBuildInputs(identity, false);
  try {
    execFileSync(inputs.toolchain.cargoPath, cargoArguments(
      'check',
      identity,
      inputs.targetRoot,
      path.join(inputs.snapshot.snapshotRoot, 'Cargo.toml')
    ), {
      cwd: inputs.snapshot.snapshotRoot,
      env: inputs.environment.env,
      stdio: 'inherit',
    });
    const sourceSha256After = verifySourceStability(inputs);
    process.stdout.write(canonical({
      ...planFor(identity),
      compiler: inputs.toolchain.compiler,
      cargo: inputs.toolchain.cargo,
      rustcExecutableSha256: inputs.toolchain.rustcExecutableSha256,
      cargoExecutableSha256: inputs.toolchain.cargoExecutableSha256,
      cargoConfigSha256: inputs.cargoConfigSha256,
      environmentSha256: inputs.environment.environmentSha256,
      sourceSha256: inputs.snapshot.sourceSha256Before,
      sourceSha256Before: inputs.snapshot.sourceSha256Before,
      sourceSha256After,
    }));
  } finally {
    cleanupBuildInputs(inputs);
  }
}

function buildNative(identity) {
  if (process.platform !== 'linux') {
    fail('native packaging build requires Linux; use --check-only for cross-target evidence');
  }
  const inputs = isolatedBuildInputs(identity, true);
  try {
    execFileSync(inputs.toolchain.cargoPath, cargoArguments(
      'build',
      identity,
      inputs.targetRoot,
      path.join(inputs.snapshot.snapshotRoot, 'Cargo.toml')
    ), {
      cwd: inputs.snapshot.snapshotRoot,
      env: inputs.environment.env,
      stdio: 'inherit',
    });
    const helperBinary = path.join(
      inputs.targetRoot,
      identity.target,
      'release',
      nativeHelperBinaryName
    );
    const brokerClientBinary = path.join(
      inputs.targetRoot,
      identity.target,
      'release',
      nativeBrokerClientBinaryName
    );
    const helper = exactRegularFile(path.dirname(helperBinary), helperBinary, 'cargo helper output');
    const brokerClient = exactRegularFile(
      path.dirname(brokerClientBinary),
      brokerClientBinary,
      'cargo broker client output'
    );
    const helperBytes = fs.readFileSync(helper.real);
    const brokerClientBytes = fs.readFileSync(brokerClient.real);
    const helperElf = inspectElf(helperBytes, identity, 'cargo helper output');
    const brokerClientElf = inspectElf(brokerClientBytes, identity, 'cargo broker client output');
    const sourceSha256After = verifySourceStability(inputs);
    const build = Object.freeze({
      platform: 'linux',
      arch: identity.arch,
      target: identity.target,
      directory: identity.directory,
      evidenceClassification: 'native-build-non-runtime',
      sourceSha256: inputs.snapshot.sourceSha256Before,
      executableMode: '0755',
      compiler: inputs.toolchain.compiler,
      cargo: inputs.toolchain.cargo,
      rustcExecutableSha256: inputs.toolchain.rustcExecutableSha256,
      cargoExecutableSha256: inputs.toolchain.cargoExecutableSha256,
      cargoConfigSha256: inputs.cargoConfigSha256,
      environmentSha256: inputs.environment.environmentSha256,
      linker: inputs.toolchain.linker,
      artifacts: Object.freeze([
        Object.freeze({
          file: helperName,
          length: helperBytes.byteLength,
          sha256: sha256(helperBytes),
          ...helperElf,
        }),
        Object.freeze({
          file: brokerClientName,
          length: brokerClientBytes.byteLength,
          sha256: sha256(brokerClientBytes),
          ...brokerClientElf,
        }),
      ]),
    });
    if (sourceSha256After !== build.sourceSha256) fail('native build source receipt differs');
    return Object.freeze({ helperBytes, brokerClientBytes, build });
  } finally {
    cleanupBuildInputs(inputs);
  }
}

function releaseFromBuilds(builds) {
  const value = Object.freeze({
    schema: releaseSchema,
    builds: Object.freeze(builds.map((build) => build)),
  });
  const text = canonical(value);
  return validateReleaseInput(value, text);
}

function main() {
  const identity = parseArguments(process.argv.slice(2));
  if (identity.mode === 'plan') {
    process.stdout.write(canonical(planFor(identity)));
    return;
  }
  if (identity.mode === 'check-only') {
    checkOnly(identity);
    return;
  }
  const buildRoot = outputRoot();
  assertAuthoritativeModeSupport(buildRoot);
  let release;
  let artifacts;
  if (identity.mode === 'assemble-staged-only') {
    const configured = process.env.RASEN_LINUX_PROCESS_AUTHORITY_STAGING_DIR;
    if (!configured) fail('staged-only assembly requires an explicit staging directory');
    const stagingRoot = exactDirectory(path.resolve(configured), 'staging root');
    release = trustedReleaseInput(stagingRoot);
    artifacts = stagedArtifacts(release, stagingRoot);
  } else {
    if (process.env.RASEN_LINUX_PROCESS_AUTHORITY_STAGING_DIR ||
        process.env.RASEN_LINUX_PROCESS_AUTHORITY_RELEASE_INPUT) {
      fail('native build cannot mix mutable staged input with its source-owned release input');
    }
    const artifact = buildNative(identity);
    release = releaseFromBuilds([artifact.build]);
    artifacts = new Map([[identity.directory, artifact]]);
  }
  const identities = assemble(artifacts, release);
  process.stdout.write(canonical({
    evidenceClassification: 'package-integrity-non-runtime',
    sourceSha256: release.value.builds[0].sourceSha256,
    releaseInputSha256: release.sha256,
    artifacts: identities,
    privilegedBrokerIncluded: false,
  }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
