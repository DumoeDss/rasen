import path from 'node:path';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  type ProcessAuthorityProviderDescriptor,
  type RecursiveProcessScopeSemantic,
} from './types.js';

export const PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA =
  'rasen-process-authority-providers/1' as const;

const MANIFEST_KEYS = Object.freeze(['schema', 'providers'] as const);
const ENTRY_KEYS = Object.freeze([
  'providerId',
  'capabilityId',
  'protocolVersion',
  'commonContractVersion',
  'providerReferenceVersion',
  'semantics',
  'artifactPath',
] as const);
const IDENTITY_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/;
const MAX_MANIFEST_PROVIDERS = 64;
const MAX_ARTIFACT_PATH_LENGTH = 512;

export interface ProcessAuthorityProviderManifestEntry
  extends ProcessAuthorityProviderDescriptor {
  readonly artifactPath: string;
}

export interface ProcessAuthorityProviderManifest {
  readonly schema: typeof PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA;
  readonly providers: readonly ProcessAuthorityProviderManifestEntry[];
}

export interface ValidatedProcessAuthorityProviderManifestEntry
  extends ProcessAuthorityProviderManifestEntry {
  readonly resolvedArtifactPath: string;
}

export interface ValidatedProcessAuthorityProviderManifest {
  readonly schema: typeof PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA;
  readonly providers: readonly ValidatedProcessAuthorityProviderManifestEntry[];
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}

function positiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function exactSemantics(value: unknown): value is readonly RecursiveProcessScopeSemantic[] {
  return Array.isArray(value) &&
    value.length === RECURSIVE_PROCESS_SCOPE_SEMANTICS.length &&
    value.every((semantic, index) => semantic === RECURSIVE_PROCESS_SCOPE_SEMANTICS[index]);
}

function resolveArtifactPath(manifestRoot: string, artifactPath: string): string {
  if (
    artifactPath.length === 0 ||
    artifactPath.length > MAX_ARTIFACT_PATH_LENGTH ||
    artifactPath.includes('\0') ||
    path.posix.isAbsolute(artifactPath) ||
    path.win32.isAbsolute(artifactPath)
  ) {
    throw new TypeError('Process-authority manifest artifact path is malformed.');
  }
  const segments = artifactPath.split(/[\\/]+/u);
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TypeError('Process-authority manifest artifact path is not a closed relative path.');
  }
  const root = path.resolve(manifestRoot);
  const resolved = path.resolve(root, path.join(...segments));
  const relative = path.relative(root, resolved);
  if (relative.length === 0 || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new TypeError('Process-authority manifest artifact path escapes its package root.');
  }
  return resolved;
}

export function validateProcessAuthorityProviderManifest(
  value: ProcessAuthorityProviderManifest,
  manifestRoot: string
): ValidatedProcessAuthorityProviderManifest {
  if (!value || typeof value !== 'object' || !hasExactKeys(value, MANIFEST_KEYS)) {
    throw new TypeError('Process-authority provider manifest has an unknown or missing field.');
  }
  if (value.schema !== PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA) {
    throw new TypeError('Process-authority provider manifest schema is unsupported.');
  }
  if (!Array.isArray(value.providers) || value.providers.length > MAX_MANIFEST_PROVIDERS) {
    throw new TypeError('Process-authority provider manifest entries exceed their bound.');
  }
  const providers: ValidatedProcessAuthorityProviderManifestEntry[] = [];
  const providerIds = new Set<string>();
  const tuples = new Set<string>();
  for (const candidate of value.providers) {
    if (!candidate || typeof candidate !== 'object' || !hasExactKeys(candidate, ENTRY_KEYS)) {
      throw new TypeError('Process-authority provider manifest entry has an unknown or missing field.');
    }
    if (!IDENTITY_PATTERN.test(candidate.providerId) ||
      !IDENTITY_PATTERN.test(candidate.capabilityId)) {
      throw new TypeError('Process-authority provider manifest identity is malformed.');
    }
    if (!positiveVersion(candidate.protocolVersion) ||
      !positiveVersion(candidate.providerReferenceVersion)) {
      throw new TypeError('Process-authority provider manifest version is malformed.');
    }
    if (candidate.commonContractVersion !== PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION) {
      throw new TypeError('Process-authority provider manifest common contract is unsupported.');
    }
    if (candidate.capabilityId !== RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID ||
      !exactSemantics(candidate.semantics)) {
      throw new TypeError('Process-authority provider manifest capability is incomplete.');
    }
    const tuple = JSON.stringify([
      candidate.providerId,
      candidate.capabilityId,
      candidate.protocolVersion,
    ]);
    if (providerIds.has(candidate.providerId) || tuples.has(tuple)) {
      throw new TypeError('Duplicate process-authority provider manifest entry.');
    }
    providerIds.add(candidate.providerId);
    tuples.add(tuple);
    providers.push(Object.freeze({
      providerId: candidate.providerId,
      capabilityId: candidate.capabilityId,
      protocolVersion: candidate.protocolVersion,
      commonContractVersion: candidate.commonContractVersion,
      providerReferenceVersion: candidate.providerReferenceVersion,
      semantics: Object.freeze([...candidate.semantics]),
      artifactPath: candidate.artifactPath,
      resolvedArtifactPath: resolveArtifactPath(manifestRoot, candidate.artifactPath),
    }));
  }
  return Object.freeze({
    schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
    providers: Object.freeze(providers),
  });
}

export function manifestEntryMatchesDescriptor(
  entry: ProcessAuthorityProviderManifestEntry,
  descriptor: ProcessAuthorityProviderDescriptor
): boolean {
  return entry.providerId === descriptor.providerId &&
    entry.capabilityId === descriptor.capabilityId &&
    entry.protocolVersion === descriptor.protocolVersion &&
    entry.commonContractVersion === descriptor.commonContractVersion &&
    entry.providerReferenceVersion === descriptor.providerReferenceVersion &&
    entry.semantics.length === descriptor.semantics.length &&
    entry.semantics.every((semantic, index) => semantic === descriptor.semantics[index]);
}
