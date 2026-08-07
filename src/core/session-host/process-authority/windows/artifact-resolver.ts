import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID } from '../types.js';
import {
  WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
  WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION,
} from './contracts.js';
import {
  WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES,
  type WindowsAuthorityMode,
  type WindowsProcessAuthorityBuildIdentity,
} from './build-authority.js';

export const WINDOWS_PROCESS_AUTHORITY_ARTIFACT_SCHEMA =
  'rasen-windows-process-authority-artifact/1' as const;

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MANIFEST_KEYS = Object.freeze([
  'schema',
  'platform',
  'arch',
  'mode',
  'providerId',
  'capabilityId',
  'protocolVersion',
  'providerReferenceVersion',
  'artifactFile',
  'machine',
  'length',
  'sha256',
  'sourceSha256',
  'compiler',
] as const);

/** `IMAGE_FILE_HEADER.Machine` values this provider is allowed to resolve. */
const PE_MACHINE_BY_ARCH = Object.freeze({
  x64: 0x86_64,
  arm64: 0xaa_64,
} as const);

export interface WindowsProcessAuthorityArtifactManifest {
  readonly schema: typeof WINDOWS_PROCESS_AUTHORITY_ARTIFACT_SCHEMA;
  readonly platform: 'win32';
  readonly arch: 'x64' | 'arm64';
  readonly mode: WindowsAuthorityMode;
  readonly providerId: typeof WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID;
  readonly capabilityId: typeof RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID;
  readonly protocolVersion: typeof WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION;
  readonly providerReferenceVersion: typeof WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION;
  readonly artifactFile: string;
  readonly machine: number;
  readonly length: number;
  readonly sha256: string;
  readonly sourceSha256: string;
  readonly compiler: string;
}

export interface WindowsProcessAuthorityArtifactInspectionOptions {
  readonly packageRoot: string;
  readonly artifactPath: string;
  readonly arch: 'x64' | 'arm64';
}

export interface WindowsProcessAuthorityArtifactResolutionOptions {
  readonly packageRoot: string;
  readonly artifactPath: string;
}

export interface WindowsProcessAuthorityArtifactInspection {
  readonly evidenceClassification: 'package-integrity' | 'actual-windows-runtime';
  readonly helperPath: string;
  readonly manifestPath: string;
  readonly artifact: WindowsProcessAuthorityArtifactManifest;
}

export interface WindowsProcessAuthorityResolvedArtifact
  extends WindowsProcessAuthorityArtifactInspection {
  readonly evidenceClassification: 'actual-windows-runtime';
  readonly executableDevice: string;
  readonly executableInode: string;
}

function fail(message: string): never {
  throw new TypeError(`Windows process-authority artifact ${message}`);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function packageRoot(value: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    fail('package root is malformed.');
  }
  const resolved = path.resolve(value);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('package root provenance is invalid.');
  return fs.realpathSync.native(resolved);
}

function artifactCandidate(root: string, value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    fail('path is malformed.');
  }
  const segments = value.split(/[\\/]+/u);
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    fail('path is not a closed relative path.');
  }
  const candidate = path.resolve(root, path.join(...segments));
  if (!within(root, candidate)) fail('path escapes its package root.');
  return candidate;
}

/**
 * Node maps NTFS junctions and symlinks alike onto `isSymbolicLink()`, so the
 * type check rejects the common reparse shapes directly. Redirection introduced
 * higher in the chain is caught instead by requiring the resolved real path to
 * stay inside the package root.
 */
function regularNonReparse(candidate: string, name: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    fail(`${name} is missing.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${name} is not an exact regular file.`);
  return stat;
}

/**
 * A Windows helper is a PE image. Reading its machine field is the analogue of
 * the sibling provider's ELF class/machine check and is what makes "an arm64
 * artifact inspected on an x64 runtime is build evidence only" enforceable
 * rather than declared.
 */
function inspectPortableExecutable(bytes: Buffer, name: string): number {
  if (bytes.byteLength < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    fail(`${name} is not a portable executable.`);
  }
  const headerOffset = bytes.readUInt32LE(0x3c);
  if (headerOffset <= 0 || headerOffset + 24 > bytes.byteLength) {
    fail(`${name} portable-executable header offset is out of bounds.`);
  }
  if (
    bytes[headerOffset] !== 0x50 ||
    bytes[headerOffset + 1] !== 0x45 ||
    bytes[headerOffset + 2] !== 0x00 ||
    bytes[headerOffset + 3] !== 0x00
  ) {
    fail(`${name} portable-executable signature is absent.`);
  }
  const characteristics = bytes.readUInt16LE(headerOffset + 22);
  if ((characteristics & 0x0002) === 0 || (characteristics & 0x2000) !== 0) {
    fail(`${name} is not an executable image.`);
  }
  return bytes.readUInt16LE(headerOffset + 4);
}

function parseManifest(
  text: string,
  expected: Pick<WindowsProcessAuthorityArtifactInspectionOptions, 'arch'>,
  helperPath: string
): WindowsProcessAuthorityArtifactManifest {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail('manifest is malformed.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    `${JSON.stringify(value)}\n` !== text ||
    !exactKeys(value, MANIFEST_KEYS)
  ) {
    fail('manifest is not closed and canonical.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== WINDOWS_PROCESS_AUTHORITY_ARTIFACT_SCHEMA ||
    record.platform !== 'win32' ||
    record.arch !== expected.arch ||
    record.mode !== 'job-object' ||
    record.providerId !== WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID ||
    record.capabilityId !== RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID ||
    record.protocolVersion !== WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION ||
    record.providerReferenceVersion !== WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION ||
    record.artifactFile !== path.basename(helperPath) ||
    typeof record.artifactFile !== 'string' ||
    !record.artifactFile.endsWith('.exe') ||
    record.machine !== PE_MACHINE_BY_ARCH[expected.arch] ||
    !Number.isSafeInteger(record.length) ||
    Number(record.length) <= 0 ||
    Number(record.length) > MAX_ARTIFACT_BYTES ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    typeof record.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.sourceSha256) ||
    typeof record.compiler !== 'string' ||
    record.compiler.length === 0 ||
    record.compiler.length > 512 ||
    record.compiler.includes('\0')
  ) {
    fail('manifest identity or bounds differ.');
  }
  return Object.freeze({ ...record }) as unknown as WindowsProcessAuthorityArtifactManifest;
}

function requireBuildAuthority(
  authorities: readonly WindowsProcessAuthorityBuildIdentity[],
  artifactPath: string,
  artifact: WindowsProcessAuthorityArtifactManifest
): void {
  const normalizedPath = artifactPath.split(/[\\/]+/u).join('/');
  const matches = authorities.filter((candidate) =>
    candidate.artifactPath === normalizedPath &&
    candidate.arch === artifact.arch &&
    candidate.mode === artifact.mode &&
    candidate.providerId === artifact.providerId &&
    candidate.protocolVersion === artifact.protocolVersion &&
    candidate.providerReferenceVersion === artifact.providerReferenceVersion &&
    candidate.length === artifact.length &&
    candidate.sha256 === artifact.sha256 &&
    candidate.sourceSha256 === artifact.sourceSha256 &&
    candidate.compiler === artifact.compiler
  );
  if (matches.length !== 1) {
    fail('build-pinned authority does not bind the exact artifact identity.');
  }
}

function inspectWithBuildAuthority(
  options: WindowsProcessAuthorityArtifactInspectionOptions,
  authorities: readonly WindowsProcessAuthorityBuildIdentity[]
): WindowsProcessAuthorityArtifactInspection {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactKeys(options, ['packageRoot', 'artifactPath', 'arch']) ||
    !['x64', 'arm64'].includes(options.arch)
  ) {
    fail('inspection options are malformed.');
  }
  const root = packageRoot(options.packageRoot);
  const candidate = artifactCandidate(root, options.artifactPath);
  const helperStat = regularNonReparse(candidate, 'helper');
  const helperPath = fs.realpathSync.native(candidate);
  if (!within(root, helperPath)) fail('helper real path escapes its package root.');
  if (helperStat.size === 0 || helperStat.size > MAX_ARTIFACT_BYTES) {
    fail('helper length exceeds its bound.');
  }

  const manifestCandidate = `${candidate}.manifest.json`;
  const manifestStat = regularNonReparse(manifestCandidate, 'manifest');
  const manifestPath = fs.realpathSync.native(manifestCandidate);
  if (!within(root, manifestPath) || path.dirname(manifestPath) !== path.dirname(helperPath)) {
    fail('manifest is not adjacent to its helper.');
  }
  if (manifestStat.size === 0 || manifestStat.size > MAX_MANIFEST_BYTES) {
    fail('manifest length exceeds its bound.');
  }
  const artifact = parseManifest(fs.readFileSync(manifestPath, 'utf8'), options, helperPath);
  if (artifact.length !== helperStat.size) fail('helper length differs from its manifest.');
  const bytes = fs.readFileSync(helperPath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (artifact.sha256 !== digest) fail('helper hash differs from its manifest.');
  const machine = inspectPortableExecutable(bytes, 'helper');
  if (machine !== artifact.machine) fail('helper machine differs from its manifest.');
  requireBuildAuthority(authorities, options.artifactPath, artifact);

  return Object.freeze({
    evidenceClassification: 'package-integrity',
    helperPath,
    manifestPath,
    artifact,
  });
}

export function inspectWindowsProcessAuthorityArtifact(
  options: WindowsProcessAuthorityArtifactInspectionOptions
): WindowsProcessAuthorityArtifactInspection {
  return inspectWithBuildAuthority(options, WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES);
}

/** @internal Test-only build-authority seam; absent from the Windows public index. */
export function inspectWindowsProcessAuthorityArtifactForTesting(
  options: WindowsProcessAuthorityArtifactInspectionOptions,
  authority: WindowsProcessAuthorityBuildIdentity
): WindowsProcessAuthorityArtifactInspection {
  return inspectWithBuildAuthority(options, Object.freeze([Object.freeze({ ...authority })]));
}

function resolveWithBuildAuthority(
  options: WindowsProcessAuthorityArtifactResolutionOptions,
  authorities: readonly WindowsProcessAuthorityBuildIdentity[]
): WindowsProcessAuthorityResolvedArtifact {
  if (process.platform !== 'win32') {
    fail('cannot become authority outside an actual Windows runtime.');
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    fail('runtime architecture is unsupported.');
  }
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactKeys(options, ['packageRoot', 'artifactPath'])
  ) {
    fail('resolution options are malformed.');
  }
  const inspected = inspectWithBuildAuthority({ ...options, arch: process.arch }, authorities);
  const before = fs.statSync(inspected.helperPath, { bigint: true });
  if (!before.isFile() || before.size !== BigInt(inspected.artifact.length)) {
    fail('opened helper length differs from package trust.');
  }
  const digest = createHash('sha256')
    .update(fs.readFileSync(inspected.helperPath))
    .digest('hex');
  const after = fs.statSync(inspected.helperPath, { bigint: true });
  if (
    digest !== inspected.artifact.sha256 ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.size !== before.size
  ) {
    fail('opened helper identity changed during verification.');
  }
  return Object.freeze({
    ...inspected,
    evidenceClassification: 'actual-windows-runtime',
    executableDevice: before.dev.toString(10),
    executableInode: before.ino.toString(10),
  });
}

export function resolveWindowsProcessAuthorityArtifact(
  options: WindowsProcessAuthorityArtifactResolutionOptions
): WindowsProcessAuthorityResolvedArtifact {
  return resolveWithBuildAuthority(options, WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES);
}

/** @internal Test-only build-authority seam; absent from the Windows public index. */
export function resolveWindowsProcessAuthorityArtifactForTesting(
  options: WindowsProcessAuthorityArtifactResolutionOptions,
  authority: WindowsProcessAuthorityBuildIdentity
): WindowsProcessAuthorityResolvedArtifact {
  return resolveWithBuildAuthority(options, Object.freeze([Object.freeze({ ...authority })]));
}
