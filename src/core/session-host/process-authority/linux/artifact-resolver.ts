import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID } from '../types.js';
import {
  LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID,
  LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID,
  LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION,
} from './contracts.js';
import type { LinuxAuthorityMode } from './provider.js';
import {
  LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES,
  type LinuxProcessAuthorityBuildIdentity,
} from './build-authority.js';

export const LINUX_PROCESS_AUTHORITY_ARTIFACT_SCHEMA =
  'rasen-linux-process-authority-artifact/1' as const;
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
  'executableMode',
  'length',
  'sha256',
  'sourceSha256',
  'compiler',
] as const);

export interface LinuxProcessAuthorityArtifactManifest {
  readonly schema: typeof LINUX_PROCESS_AUTHORITY_ARTIFACT_SCHEMA;
  readonly platform: 'linux';
  readonly arch: 'x64' | 'arm64';
  readonly mode: LinuxAuthorityMode;
  readonly providerId:
    | typeof LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID
    | typeof LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID;
  readonly capabilityId: typeof RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID;
  readonly protocolVersion: typeof LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION;
  readonly providerReferenceVersion: typeof LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION;
  readonly artifactFile: string;
  readonly executableMode: '0755';
  readonly length: number;
  readonly sha256: string;
  readonly sourceSha256: string;
  readonly compiler: string;
}

export interface LinuxProcessAuthorityArtifactInspectionOptions {
  readonly packageRoot: string;
  readonly artifactPath: string;
  readonly mode: LinuxAuthorityMode;
  readonly arch: 'x64' | 'arm64';
}

export interface LinuxProcessAuthorityArtifactResolutionOptions {
  readonly packageRoot: string;
  readonly artifactPath: string;
  readonly mode: LinuxAuthorityMode;
}

export interface LinuxProcessAuthorityArtifactInspection {
  readonly evidenceClassification: 'package-integrity' | 'actual-linux-runtime';
  readonly helperPath: string;
  readonly manifestPath: string;
  readonly artifact: LinuxProcessAuthorityArtifactManifest;
}

export interface LinuxProcessAuthorityResolvedArtifact
  extends LinuxProcessAuthorityArtifactInspection {
  readonly evidenceClassification: 'actual-linux-runtime';
  readonly executableFd: number;
  readonly executableDevice: string;
  readonly executableInode: string;
}

function fail(message: string): never {
  throw new TypeError(`Linux process-authority artifact ${message}`);
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
  validateOwnedPath(stat, 'package root');
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

function regularNonSymlink(candidate: string, name: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    fail(`${name} is missing.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${name} is not an exact regular file.`);
  validateOwnedPath(stat, name);
  return stat;
}

function validateOwnedPath(stat: fs.Stats, name: string): void {
  if (process.platform === 'win32') return;
  const uid = process.getuid?.();
  if (
    (uid !== undefined && stat.uid !== uid && stat.uid !== 0) ||
    (stat.mode & 0o022) !== 0
  ) {
    fail(`${name} ownership or mode is not trusted.`);
  }
}

function parseManifest(
  text: string,
  expected: Pick<LinuxProcessAuthorityArtifactInspectionOptions, 'mode' | 'arch'>,
  helperPath: string
): LinuxProcessAuthorityArtifactManifest {
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
  const expectedProvider = expected.mode === 'user-pidns'
    ? LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID
    : LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID;
  if (
    record.schema !== LINUX_PROCESS_AUTHORITY_ARTIFACT_SCHEMA ||
    record.platform !== 'linux' ||
    record.arch !== expected.arch ||
    record.mode !== expected.mode ||
    record.providerId !== expectedProvider ||
    record.capabilityId !== RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID ||
    record.protocolVersion !== LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION ||
    record.providerReferenceVersion !== LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION ||
    record.artifactFile !== path.basename(helperPath) ||
    record.executableMode !== '0755' ||
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
  return Object.freeze({ ...record }) as unknown as LinuxProcessAuthorityArtifactManifest;
}

function requireBuildAuthority(
  authorities: readonly LinuxProcessAuthorityBuildIdentity[],
  artifactPath: string,
  artifact: LinuxProcessAuthorityArtifactManifest
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
  options: LinuxProcessAuthorityArtifactInspectionOptions,
  authorities: readonly LinuxProcessAuthorityBuildIdentity[]
): LinuxProcessAuthorityArtifactInspection {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactKeys(options, ['packageRoot', 'artifactPath', 'mode', 'arch']) ||
    !['user-pidns', 'broker-pidns-cgroupv2'].includes(options.mode) ||
    !['x64', 'arm64'].includes(options.arch)
  ) {
    fail('inspection options are malformed.');
  }
  const root = packageRoot(options.packageRoot);
  const candidate = artifactCandidate(root, options.artifactPath);
  const helperStat = regularNonSymlink(candidate, 'helper');
  const helperPath = fs.realpathSync.native(candidate);
  if (!within(root, helperPath)) fail('helper real path escapes its package root.');
  if (helperStat.size === 0 || helperStat.size > MAX_ARTIFACT_BYTES) {
    fail('helper length exceeds its bound.');
  }

  const manifestCandidate = `${candidate}.manifest.json`;
  const manifestStat = regularNonSymlink(manifestCandidate, 'manifest');
  const manifestPath = fs.realpathSync.native(manifestCandidate);
  if (!within(root, manifestPath) || path.dirname(manifestPath) !== path.dirname(helperPath)) {
    fail('manifest is not adjacent to its helper.');
  }
  if (manifestStat.size === 0 || manifestStat.size > MAX_MANIFEST_BYTES) {
    fail('manifest length exceeds its bound.');
  }
  const artifact = parseManifest(
    fs.readFileSync(manifestPath, 'utf8'),
    options,
    helperPath
  );
  if (artifact.length !== helperStat.size) fail('helper length differs from its manifest.');
  const digest = createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex');
  if (artifact.sha256 !== digest) fail('helper hash differs from its manifest.');
  requireBuildAuthority(authorities, options.artifactPath, artifact);

  return Object.freeze({
    evidenceClassification: 'package-integrity',
    helperPath,
    manifestPath,
    artifact,
  });
}

export function inspectLinuxProcessAuthorityArtifact(
  options: LinuxProcessAuthorityArtifactInspectionOptions
): LinuxProcessAuthorityArtifactInspection {
  return inspectWithBuildAuthority(options, LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES);
}

/** @internal Test-only build-authority seam; absent from the Linux public index. */
export function inspectLinuxProcessAuthorityArtifactForTesting(
  options: LinuxProcessAuthorityArtifactInspectionOptions,
  authority: LinuxProcessAuthorityBuildIdentity
): LinuxProcessAuthorityArtifactInspection {
  return inspectWithBuildAuthority(options, Object.freeze([Object.freeze({ ...authority })]));
}

function resolveWithBuildAuthority(
  options: LinuxProcessAuthorityArtifactResolutionOptions,
  authorities: readonly LinuxProcessAuthorityBuildIdentity[]
): LinuxProcessAuthorityResolvedArtifact {
  if (process.platform !== 'linux') {
    fail('cannot become authority outside an actual Linux runtime.');
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    fail('runtime architecture is unsupported.');
  }
  const inspected = inspectWithBuildAuthority({
    ...options,
    arch: process.arch,
  }, authorities);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(inspected.helperPath, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || (before.mode & 0o7777n) !== 0o755n) {
      fail('helper executable mode differs from exact 0755.');
    }
    const uid = process.getuid?.();
    if (uid !== undefined && before.uid !== BigInt(uid) && before.uid !== 0n) {
      fail('helper executable owner is not trusted.');
    }
    if (before.size !== BigInt(inspected.artifact.length)) {
      fail('opened helper length differs from package trust.');
    }
    const digest = createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      digest !== inspected.artifact.sha256 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mode !== before.mode
    ) {
      fail('opened helper identity changed during verification.');
    }
    return Object.freeze({
      ...inspected,
      evidenceClassification: 'actual-linux-runtime',
      executableFd: fd,
      executableDevice: before.dev.toString(10),
      executableInode: before.ino.toString(10),
    });
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

export function resolveLinuxProcessAuthorityArtifact(
  options: LinuxProcessAuthorityArtifactResolutionOptions
): LinuxProcessAuthorityResolvedArtifact {
  return resolveWithBuildAuthority(options, LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES);
}

/** @internal Test-only build-authority seam; absent from the Linux public index. */
export function resolveLinuxProcessAuthorityArtifactForTesting(
  options: LinuxProcessAuthorityArtifactResolutionOptions,
  authority: LinuxProcessAuthorityBuildIdentity
): LinuxProcessAuthorityResolvedArtifact {
  return resolveWithBuildAuthority(
    options,
    Object.freeze([Object.freeze({ ...authority })])
  );
}
