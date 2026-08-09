import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  type ProcessAuthorityProviderDescriptor,
} from '../types.js';
import {
  PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
  type ProcessAuthorityProviderManifest,
} from '../manifest.js';

export const WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION = 1 as const;
export const WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION = 1 as const;

/**
 * Windows has exactly one provider tuple. Job Object creation, breakaway
 * control, completion-port association and TerminateJobObject are all reachable
 * from an ordinary interactive user token, so there is no policy-disabled
 * configuration a second privileged provider would rescue and therefore no
 * broker axis at all. A second Windows entry in this file would be a defect.
 */
export const WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID = 'rasen.windows.job-object' as const;

export const WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR:
ProcessAuthorityProviderDescriptor = Object.freeze({
  providerId: WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
});

export interface WindowsProcessAuthorityManifestPaths {
  readonly artifactPath: string;
}

function snapshotManifestPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw new TypeError('Windows process-authority artifact path is malformed.');
  }
  return value;
}

export function createWindowsProcessAuthorityProviderManifest(
  paths: WindowsProcessAuthorityManifestPaths
): ProcessAuthorityProviderManifest {
  if (
    !paths ||
    typeof paths !== 'object' ||
    Array.isArray(paths) ||
    Object.keys(paths).sort().join(',') !== 'artifactPath'
  ) {
    throw new TypeError('Windows process-authority manifest paths are malformed.');
  }
  return Object.freeze({
    schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
    providers: Object.freeze([
      Object.freeze({
        ...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
        artifactPath: snapshotManifestPath(paths.artifactPath),
      }),
    ]),
  });
}
