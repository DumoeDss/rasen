#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const crate = path.join(root, 'native', 'windows-process-authority');
const helperName = 'rasen-windows-process-authority-helper.exe';
const guardianName = 'rasen-windows-process-authority-guardian.exe';
const nativeHelperBinaryName = 'rasen-windows-process-authority.exe';
const nativeGuardianBinaryName = 'rasen-windows-process-authority-guardian.exe';
const pinnedRustc = 'rustc 1.88.0 (6b00bc388 2025-06-23)';
const pinnedCargo = 'cargo 1.88.0 (873a06493 2025-05-10)';
const releaseSchema = 'rasen-windows-process-authority-release-input/1';
const provenanceSchema = 'rasen-windows-process-authority-build-provenance/1';
const artifactSchema = 'rasen-windows-process-authority-artifact/1';
const providerId = 'rasen.windows.job-object';
const requiredSourceInputs = Object.freeze(['Cargo.lock', 'Cargo.toml']);
/** Included in the digest when present; its absence is reported, never ignored. */
const optionalSourceInputs = Object.freeze(['THIRD_PARTY.md']);
const artifactNames = Object.freeze([helperName, guardianName]);
const ownedArchitectureDirectories = Object.freeze(['win32-x64', 'win32-arm64']);
/**
 * `/Brepro` is load-bearing, not hygiene. Without it two builds of byte-identical
 * source produce byte-different artifacts of identical length: measured here as
 * 20 differing bytes — the COFF `TimeDateStamp`, its three copies in the debug
 * directory entries, and the 16-byte CodeView signature GUID that link.exe
 * regenerates per link. That is the same "equal length, different bytes" trap
 * recorded against the sibling helper, and it would make every rebuild-and-
 * compare verification fail spuriously. `/Brepro` replaces the timestamps with
 * a content-derived value so a shipped artifact can be verified by rebuilding.
 *
 * It is written into the isolated CARGO_HOME config rather than passed through
 * RUSTFLAGS, because build-affecting environment overrides are rejected.
 */
function cargoConfigFor(identity) {
  return [
    '[net]',
    'retry = 0',
    'git-fetch-with-cli = false',
    '',
    '[http]',
    'multiplexing = false',
    '',
    `[target.${identity.target}]`,
    'rustflags = ["-Clink-arg=/Brepro"]',
    '',
  ].join('\n');
}
const semantics = Object.freeze([
  'workload-non-escape',
  'publish-before-activate',
  'root-exit-distinct',
  'natural-exact-empty',
  'recursive-terminate',
  'recursive-abort',
  'replacement-recovery',
  'bounded-controls',
  'identity-drift-detection',
  'event-completeness',
]);
const peMachineByArch = Object.freeze({ x64: 0x8664, arm64: 0xaa64 });

function fail(message) {
  throw new Error(`Windows process-authority build: ${message}`);
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
  const present = optionalSourceInputs.filter((file) =>
    fs.existsSync(path.join(sourceRoot, file)));
  for (const file of requiredSourceInputs) {
    if (!fs.existsSync(path.join(sourceRoot, file))) {
      fail(`required source input is absent: ${file}`);
    }
  }
  return [
    ...requiredSourceInputs,
    ...present,
    ...relativeFiles(path.join(sourceRoot, 'src'), 'src'),
  ].sort();
}

/**
 * Same convention as the sibling build script, including the trailing NUL after
 * each file's contents. A recomputation that omits either NUL disagrees with
 * every digest this script has ever emitted.
 */
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

function thirdPartyAccountingPresent(sourceRoot = crate) {
  return optionalSourceInputs.every((file) => fs.existsSync(path.join(sourceRoot, file)));
}

function targetIdentity(target) {
  if (target === 'x86_64-pc-windows-msvc') {
    return Object.freeze({ target, arch: 'x64', directory: 'win32-x64', machine: 0x8664 });
  }
  if (target === 'aarch64-pc-windows-msvc') {
    return Object.freeze({ target, arch: 'arm64', directory: 'win32-arm64', machine: 0xaa64 });
  }
  fail(`target is not a supported explicit Windows target: ${target}`);
}

function defaultTarget() {
  if (process.arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (process.arch === 'arm64') return 'aarch64-pc-windows-msvc';
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
  const nativeArchitecture = process.platform === 'win32' && process.arch === identity.arch;
  return Object.freeze({
    platform: 'win32',
    arch: identity.arch,
    target: identity.target,
    artifactPath: `dist/native/${identity.directory}/${helperName}`,
    evidenceClassification: nativeArchitecture
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
  if (create) fs.mkdirSync(candidate, { recursive: true });
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

/** The PE analogue of the sibling's ELF check: signature, machine, image kind. */
function inspectPortableExecutable(bytes, identity, name) {
  if (bytes.byteLength < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    fail(`${name} is not a portable executable`);
  }
  const headerOffset = bytes.readUInt32LE(0x3c);
  if (headerOffset <= 0 || headerOffset + 24 > bytes.byteLength) {
    fail(`${name} portable-executable header offset is out of bounds`);
  }
  if (bytes.readUInt32LE(headerOffset) !== 0x0000_4550) {
    fail(`${name} portable-executable signature is absent`);
  }
  const machine = bytes.readUInt16LE(headerOffset + 4);
  const characteristics = bytes.readUInt16LE(headerOffset + 22);
  if (machine !== identity.machine) {
    fail(`${name} machine differs from target ${identity.target}`);
  }
  if ((characteristics & 0x0002) === 0 || (characteristics & 0x2000) !== 0) {
    fail(`${name} is not an executable image`);
  }
  return Object.freeze({ machine, characteristics });
}

function validateReleaseBuild(build, index) {
  exactObject(build, [
    'platform',
    'arch',
    'target',
    'directory',
    'evidenceClassification',
    'sourceSha256',
    'thirdPartyAccounting',
    'compiler',
    'cargo',
    'rustcExecutableSha256',
    'cargoExecutableSha256',
    'cargoConfigSha256',
    'environmentSha256',
    'artifacts',
  ], `trusted release build ${index}`);
  const identity = targetIdentity(build.target);
  if (build.platform !== 'win32' || build.arch !== identity.arch ||
      build.directory !== identity.directory ||
      !['native-build-non-runtime', 'cross-build-non-runtime'].includes(
        build.evidenceClassification) ||
      build.compiler !== pinnedRustc || build.cargo !== pinnedCargo ||
      typeof build.thirdPartyAccounting !== 'boolean' ||
      build.sourceSha256 !== sourceDigest()) {
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
  if (!Array.isArray(build.artifacts) || build.artifacts.length !== artifactNames.length) {
    fail(`trusted release build ${index} artifact inventory is not exact`);
  }
  const seen = new Set();
  for (const artifact of build.artifacts) {
    exactObject(artifact, ['file', 'length', 'sha256', 'machine'],
      `trusted release build ${index} artifact`);
    if (!artifactNames.includes(artifact.file) || seen.has(artifact.file) ||
        !Number.isSafeInteger(artifact.length) || artifact.length <= 0 ||
        artifact.length > 256 * 1024 * 1024 || artifact.machine !== identity.machine) {
      fail(`trusted release build ${index} artifact identity or bounds differ`);
    }
    exactHash(artifact.sha256, `trusted release build ${index} artifact hash`);
    seen.add(artifact.file);
  }
  return Object.freeze({
    ...build,
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
  const configured = process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_RELEASE_INPUT;
  const pinnedDigest = process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_RELEASE_INPUT_SHA256;
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
  const directoryReal = exactDirectory(path.join(rootReal, directory), `staged ${directory}`);
  if (!within(rootReal, directoryReal)) fail(`staged directory escapes: ${directory}`);
  const bytesByName = new Map();
  for (const name of artifactNames) {
    const binary = exactRegularFile(directoryReal, path.join(directoryReal, name), `staged ${name}`);
    const bytes = fs.readFileSync(binary.real);
    const expected = build.artifacts.find((artifact) => artifact.file === name);
    if (!expected || bytes.byteLength !== expected.length || sha256(bytes) !== expected.sha256) {
      fail(`staged ${name} differs from trusted release length or hash`);
    }
    const actual = inspectPortableExecutable(bytes, targetIdentity(build.target), `staged ${name}`);
    if (actual.machine !== expected.machine) {
      fail(`staged ${name} machine differs from trusted release input`);
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
    guardianBytes: bytesByName.get(guardianName),
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

function manifestFor(artifact, file) {
  const bytes = file === helperName ? artifact.helperBytes : artifact.guardianBytes;
  return Object.freeze({
    schema: artifactSchema,
    platform: 'win32',
    arch: artifact.build.arch,
    mode: 'job-object',
    providerId,
    capabilityId: 'rasen-recursive-process-scope/1',
    protocolVersion: 1,
    providerReferenceVersion: 1,
    artifactFile: file,
    machine: peMachineByArch[artifact.build.arch],
    length: bytes.byteLength,
    sha256: sha256(bytes),
    sourceSha256: artifact.build.sourceSha256,
    compiler: artifact.build.compiler,
  });
}

/** Exactly one Windows provider entry: there is no broker axis on this platform. */
function providerManifest(directory) {
  return Object.freeze({
    schema: 'rasen-process-authority-providers/1',
    providers: Object.freeze([
      Object.freeze({
        providerId,
        capabilityId: 'rasen-recursive-process-scope/1',
        protocolVersion: 1,
        commonContractVersion: 1,
        providerReferenceVersion: 1,
        semantics,
        artifactPath: `dist/native/${directory}/${helperName}`,
      }),
    ]),
  });
}

function authorityModule(identities) {
  const ordered = [...identities].sort((left, right) =>
    left.artifactPath.localeCompare(right.artifactPath));
  return [
    '// Generated by scripts/build-windows-process-authority.mjs from pinned build inputs.',
    '// Do not edit this build output.',
    `export const WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES = Object.freeze(${JSON.stringify(ordered)}.map((identity) => Object.freeze(identity)));`,
    '',
  ].join('\n');
}

function outputRoot() {
  const configured = process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_BUILD_ROOT;
  const candidate = configured ? path.resolve(configured) : root;
  return exactDirectory(candidate, 'Windows authority build root', true);
}

function buildTemporaryRoot() {
  const configured = process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_TEMP_ROOT;
  const candidate = configured ? path.resolve(configured) : os.tmpdir();
  const resolved = exactDirectory(candidate, 'Windows authority temporary root', true);
  if (resolved === root || within(root, resolved)) {
    fail('Windows authority temporary root must be outside the source worktree');
  }
  return resolved;
}

function writeFile(destination, bytes) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

function writeJson(destination, value) {
  writeFile(destination, canonical(value));
}

function assertClosedInventory(tree, expectedFiles) {
  const actual = relativeFiles(tree).sort();
  const expected = [...expectedFiles].sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    fail(`private assembly inventory is not closed: ${actual.join(', ')}`);
  }
  for (const file of actual) {
    const stat = fs.lstatSync(path.join(tree, ...file.split('/')));
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`private assembly type differs: ${file}`);
    }
  }
}

function replacePathsAtomically(operations, backupRoot) {
  const staged = [];
  fs.mkdirSync(backupRoot, { recursive: true });
  try {
    for (const [index, operation] of operations.entries()) {
      fs.mkdirSync(path.dirname(operation.destination), { recursive: true });
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

function assemblePackageTree(tree, artifacts) {
  const identities = [];
  const expected = [];
  for (const directory of [...artifacts.keys()].sort()) {
    const artifact = artifacts.get(directory);
    for (const file of artifactNames) {
      const relative = `dist/native/${directory}/${file}`;
      const bytes = file === helperName ? artifact.helperBytes : artifact.guardianBytes;
      const manifest = manifestFor(artifact, file);
      writeFile(path.join(tree, ...relative.split('/')), bytes);
      writeJson(path.join(tree, ...`${relative}.manifest.json`.split('/')), manifest);
      expected.push(relative, `${relative}.manifest.json`);
      if (file !== helperName) continue;
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
    const providerRelative =
      `dist/native/windows-process-authority/providers-${directory}.json`;
    writeJson(path.join(tree, ...providerRelative.split('/')), providerManifest(directory));
    expected.push(providerRelative);
  }
  const moduleRelative = 'dist/core/session-host/process-authority/windows/build-authority.js';
  writeFile(path.join(tree, ...moduleRelative.split('/')), authorityModule(identities));
  expected.push(moduleRelative);
  assertClosedInventory(tree, expected);
  return identities;
}

function installPackageTree(buildRoot, tree, artifacts) {
  const nativeRoot = path.join(buildRoot, 'dist', 'native');
  const operations = [];
  for (const directory of ownedArchitectureDirectories) {
    operations.push({
      source: artifacts.has(directory)
        ? path.join(tree, 'dist', 'native', directory)
        : undefined,
      destination: path.join(nativeRoot, directory),
    });
  }
  operations.push({
    source: path.join(tree, 'dist', 'native', 'windows-process-authority'),
    destination: path.join(nativeRoot, 'windows-process-authority'),
  }, {
    source: path.join(
      tree, 'dist', 'core', 'session-host', 'process-authority', 'windows', 'build-authority.js'
    ),
    destination: path.join(
      buildRoot,
      'dist', 'core', 'session-host', 'process-authority', 'windows', 'build-authority.js'
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
  const container = fs.mkdtempSync(path.join(parent, `.${path.basename(resolved)}.tmp-`));
  const tree = path.join(container, 'new');
  fs.mkdirSync(tree, { recursive: true });
  const expected = ['release-input.json'];
  try {
    writeFile(path.join(tree, 'release-input.json'), release.text);
    for (const directory of [...artifacts.keys()].sort()) {
      const artifact = artifacts.get(directory);
      for (const [name, bytes] of [
        [helperName, artifact.helperBytes],
        [guardianName, artifact.guardianBytes],
      ]) {
        const relative = `staging/${directory}/${name}`;
        writeFile(path.join(tree, ...relative.split('/')), bytes);
        expected.push(relative);
      }
      const provenanceRelative = `staging/${directory}/provenance.json`;
      writeJson(
        path.join(tree, ...provenanceRelative.split('/')),
        provenanceFor(release, artifact.build)
      );
      expected.push(provenanceRelative);
    }
    assertClosedInventory(tree, expected);
    replacePathsAtomically(
      [{ source: tree, destination: resolved }],
      path.join(container, 'replacement-backups')
    );
  } finally {
    if (fs.existsSync(container)) fs.rmSync(container, { recursive: true, force: true });
  }
}

function assemble(artifacts, release) {
  if (artifacts.size === 0) fail('no native Windows artifact was supplied');
  const buildRoot = outputRoot();
  const tree = fs.mkdtempSync(path.join(buildRoot, '.rasen-windows-authority-assembly-'));
  let identities;
  try {
    identities = assemblePackageTree(tree, artifacts);
    installPackageTree(buildRoot, tree, artifacts);
  } finally {
    if (fs.existsSync(tree)) fs.rmSync(tree, { recursive: true, force: true });
  }
  const exportRoot = process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_EXPORT_DIR;
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
    // A caller-supplied value here would compile a false provenance claim into
    // the artifact. This build computes it and refuses to accept one.
    'RASEN_WPA_SOURCE_SHA256',
    'CC',
    'CFLAGS',
    'CXX',
    'CXXFLAGS',
    'LINK',
    'AR',
  ]);
  const overrides = Object.keys(process.env).filter((key) =>
    process.env[key] && (exact.has(key) ||
      /^CARGO_TARGET_.*_(?:LINKER|RUNNER|RUSTFLAGS)$/u.test(key))
  );
  if (overrides.length > 0) {
    fail(`build-affecting environment override is forbidden: ${overrides.sort().join(', ')}`);
  }
}

function resolveExecutable(name) {
  const output = execFileSync('where.exe', [name], { encoding: 'utf8' }).trim();
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

function firstLine(output) {
  return output.trim().split(/\r?\n/u)[0];
}

function toolchainIdentity() {
  const rustcProxy = resolveExecutable('rustc');
  const sysrootText = execFileSync(rustcProxy, ['--print', 'sysroot'], { encoding: 'utf8' }).trim();
  boundedString(sysrootText, 'pinned Rust sysroot', 4096);
  if (!path.isAbsolute(sysrootText)) fail('pinned Rust sysroot is not absolute');
  const sysroot = exactDirectory(path.resolve(sysrootText), 'pinned Rust sysroot');
  const toolBin = exactDirectory(path.join(sysroot, 'bin'), 'pinned Rust tool bin');
  const rustcPath = exactRegularFile(toolBin, path.join(toolBin, 'rustc.exe'), 'pinned rustc').real;
  const cargoPath = exactRegularFile(toolBin, path.join(toolBin, 'cargo.exe'), 'pinned cargo').real;
  const compiler = firstLine(
    execFileSync(rustcPath, ['--version', '--verbose'], { encoding: 'utf8' })
  );
  const cargo = firstLine(execFileSync(cargoPath, ['--version'], { encoding: 'utf8' }));
  if (compiler !== pinnedRustc || cargo !== pinnedCargo) {
    fail(`toolchain differs: ${compiler}; ${cargo}`);
  }
  return Object.freeze({
    compiler,
    cargo,
    rustcPath,
    cargoPath,
    rustcExecutableSha256: sha256(fs.readFileSync(rustcPath)),
    cargoExecutableSha256: sha256(fs.readFileSync(cargoPath)),
  });
}

/**
 * The snapshot directory name is derived from the source digest rather than
 * randomised. rustc embeds the build path in panic metadata, so a random name
 * would make two builds of identical source differ byte-for-byte at identical
 * length — the exact trap recorded against the sibling helper as F-L2-15.
 */
function createSourceSnapshot() {
  const sourceSha256Before = sourceDigest(crate);
  const container = path.join(
    buildTemporaryRoot(),
    `rasen-windows-authority-src-${sourceSha256Before.slice(0, 16)}`
  );
  removeBuildTemporary(container);
  try {
    const snapshotRoot = path.join(container, 'crate');
    fs.mkdirSync(snapshotRoot, { recursive: true });
    for (const file of sourceFileList(crate)) {
      const destination = path.join(snapshotRoot, ...file.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(crate, ...file.split('/')), destination,
        fs.constants.COPYFILE_EXCL);
    }
    if (sourceDigest(snapshotRoot) !== sourceSha256Before) {
      fail('source changed while the immutable source snapshot was created');
    }
    return Object.freeze({ container, snapshotRoot, sourceSha256Before });
  } catch (error) {
    removeBuildTemporary(container);
    throw error;
  }
}

function assertCargoConfigIsolation(snapshotRoot) {
  let directory = path.resolve(snapshotRoot);
  for (;;) {
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

function removeBuildTemporary(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return;
  fs.rmSync(candidate, { recursive: true, force: true });
}

/**
 * The crate compiles its own source digest in from `RASEN_WPA_SOURCE_SHA256`,
 * and omits the attestation key entirely when the variable is absent — which
 * makes the provider's codec fail closed at prepare. So this build must supply
 * it, and must supply *its own* computed digest: a caller-supplied value would
 * let a binary claim provenance it does not have, which is why the name is also
 * rejected as a build-environment override.
 */
function isolatedEnvironment(toolchain, cargoHome, sourceSha256) {
  exactHash(sourceSha256, 'compiled-in source digest');
  const allowed = [
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'SystemRoot',
    'SystemDrive',
    'WINDIR',
    'TEMP',
    'TMP',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'PROCESSOR_ARCHITECTURE',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ];
  const env = {};
  for (const key of allowed) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.PATH = [...new Set([
    path.dirname(toolchain.cargoPath),
    path.dirname(toolchain.rustcPath),
    ...(process.env.SystemRoot
      ? [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot]
      : []),
  ])].join(path.delimiter);
  env.CARGO_HOME = cargoHome;
  env.RUSTC = toolchain.rustcPath;
  env.CARGO_INCREMENTAL = '0';
  env.CARGO_TERM_COLOR = 'never';
  env.SOURCE_DATE_EPOCH = '0';
  env.RASEN_WPA_SOURCE_SHA256 = sourceSha256;
  const recorded = Object.freeze({
    toolchainSelection: 'exact-sysroot-binaries',
    rustcPath: toolchain.rustcPath,
    cargoPath: toolchain.cargoPath,
    cargoHomePolicy: 'fresh-private-cargo-home',
    sourceDateEpoch: env.SOURCE_DATE_EPOCH,
    cargoIncremental: env.CARGO_INCREMENTAL,
    compiledInSourceDigest: sourceSha256,
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
    'rasen-windows-process-authority',
    '--bin',
    'rasen-windows-process-authority-guardian',
    ...(command === 'build' ? ['--release'] : []),
  ];
}

function isolatedBuildInputs(identity) {
  rejectBuildEnvironmentOverrides();
  const cargoConfig = cargoConfigFor(identity);
  let snapshot;
  let cargoHome;
  let targetRoot;
  try {
    snapshot = createSourceSnapshot();
    cargoHome = fs.mkdtempSync(path.join(buildTemporaryRoot(), 'rasen-windows-cargo-home-'));
    writeFile(path.join(cargoHome, 'config.toml'), cargoConfig);
    targetRoot = fs.mkdtempSync(path.join(buildTemporaryRoot(), 'rasen-windows-target-'));
    assertCargoConfigIsolation(snapshot.snapshotRoot);
    const toolchain = toolchainIdentity();
    const environment = isolatedEnvironment(
      toolchain,
      cargoHome,
      snapshot.sourceSha256Before
    );
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
  const inputs = isolatedBuildInputs(identity);
  try {
    execFileSync(inputs.toolchain.cargoPath, cargoArguments(
      'check', identity, inputs.targetRoot,
      path.join(inputs.snapshot.snapshotRoot, 'Cargo.toml')
    ), { cwd: inputs.snapshot.snapshotRoot, env: inputs.environment.env, stdio: 'inherit' });
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
      sourceSha256After,
      thirdPartyAccounting: thirdPartyAccountingPresent(),
    }));
  } finally {
    cleanupBuildInputs(inputs);
  }
}

function buildNative(identity) {
  if (process.platform !== 'win32') {
    fail('Windows packaging build requires Windows; use --check-only for cross-target evidence');
  }
  const inputs = isolatedBuildInputs(identity);
  try {
    execFileSync(inputs.toolchain.cargoPath, cargoArguments(
      'build', identity, inputs.targetRoot,
      path.join(inputs.snapshot.snapshotRoot, 'Cargo.toml')
    ), { cwd: inputs.snapshot.snapshotRoot, env: inputs.environment.env, stdio: 'inherit' });
    const releaseRoot = path.join(inputs.targetRoot, identity.target, 'release');
    const helper = exactRegularFile(
      releaseRoot, path.join(releaseRoot, nativeHelperBinaryName), 'cargo helper output');
    const guardian = exactRegularFile(
      releaseRoot, path.join(releaseRoot, nativeGuardianBinaryName), 'cargo guardian output');
    const helperBytes = fs.readFileSync(helper.real);
    const guardianBytes = fs.readFileSync(guardian.real);
    const helperPe = inspectPortableExecutable(helperBytes, identity, 'cargo helper output');
    const guardianPe = inspectPortableExecutable(guardianBytes, identity, 'cargo guardian output');
    const sourceSha256After = verifySourceStability(inputs);
    const build = Object.freeze({
      platform: 'win32',
      arch: identity.arch,
      target: identity.target,
      directory: identity.directory,
      evidenceClassification: process.arch === identity.arch
        ? 'native-build-non-runtime'
        : 'cross-build-non-runtime',
      sourceSha256: inputs.snapshot.sourceSha256Before,
      thirdPartyAccounting: thirdPartyAccountingPresent(),
      compiler: inputs.toolchain.compiler,
      cargo: inputs.toolchain.cargo,
      rustcExecutableSha256: inputs.toolchain.rustcExecutableSha256,
      cargoExecutableSha256: inputs.toolchain.cargoExecutableSha256,
      cargoConfigSha256: inputs.cargoConfigSha256,
      environmentSha256: inputs.environment.environmentSha256,
      artifacts: Object.freeze([
        Object.freeze({
          file: helperName,
          length: helperBytes.byteLength,
          sha256: sha256(helperBytes),
          machine: helperPe.machine,
        }),
        Object.freeze({
          file: guardianName,
          length: guardianBytes.byteLength,
          sha256: sha256(guardianBytes),
          machine: guardianPe.machine,
        }),
      ]),
    });
    if (sourceSha256After !== build.sourceSha256) fail('native build source receipt differs');
    return Object.freeze({ helperBytes, guardianBytes, build });
  } finally {
    cleanupBuildInputs(inputs);
  }
}

function releaseFromBuilds(builds) {
  const value = Object.freeze({
    schema: releaseSchema,
    builds: Object.freeze(builds.map((build) => build)),
  });
  return validateReleaseInput(value, canonical(value));
}

function main() {
  const identity = parseArguments(process.argv.slice(2));
  if (identity.mode === 'plan') {
    process.stdout.write(canonical({
      ...planFor(identity),
      sourceSha256: sourceDigest(),
      thirdPartyAccounting: thirdPartyAccountingPresent(),
    }));
    return;
  }
  if (identity.mode === 'check-only') {
    checkOnly(identity);
    return;
  }
  let release;
  let artifacts;
  if (identity.mode === 'assemble-staged-only') {
    const configured = process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_STAGING_DIR;
    if (!configured) fail('staged-only assembly requires an explicit staging directory');
    const stagingRoot = exactDirectory(path.resolve(configured), 'staging root');
    release = trustedReleaseInput(stagingRoot);
    artifacts = stagedArtifacts(release, stagingRoot);
  } else {
    if (process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_STAGING_DIR ||
        process.env.RASEN_WINDOWS_PROCESS_AUTHORITY_RELEASE_INPUT) {
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
    thirdPartyAccounting: release.value.builds[0].thirdPartyAccounting,
    artifacts: identities,
  }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
