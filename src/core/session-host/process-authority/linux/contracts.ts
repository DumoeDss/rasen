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

export const LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION = 1 as const;
export const LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION = 1 as const;
export const LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID =
  'rasen.linux.user-pidns' as const;
export const LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID =
  'rasen.linux.broker-pidns-cgroupv2' as const;

export const LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR:
ProcessAuthorityProviderDescriptor = Object.freeze({
  providerId: LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID,
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
});

export const LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR:
ProcessAuthorityProviderDescriptor = Object.freeze({
  ...LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
  providerId: LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID,
});

export interface LinuxProcessAuthorityManifestPaths {
  readonly primaryArtifactPath: string;
  readonly brokerArtifactPath: string;
}

function snapshotManifestPath(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw new TypeError(`Linux process-authority ${name} artifact path is malformed.`);
  }
  return value;
}

export function createLinuxProcessAuthorityProviderManifest(
  paths: LinuxProcessAuthorityManifestPaths
): ProcessAuthorityProviderManifest {
  if (
    !paths ||
    typeof paths !== 'object' ||
    Array.isArray(paths) ||
    Object.keys(paths).sort().join(',') !== 'brokerArtifactPath,primaryArtifactPath'
  ) {
    throw new TypeError('Linux process-authority manifest paths are malformed.');
  }
  const primaryArtifactPath = snapshotManifestPath(
    paths.primaryArtifactPath,
    'primary'
  );
  const brokerArtifactPath = snapshotManifestPath(
    paths.brokerArtifactPath,
    'broker'
  );
  return Object.freeze({
    schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
    providers: Object.freeze([
      Object.freeze({
        ...LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
        artifactPath: primaryArtifactPath,
      }),
      Object.freeze({
        ...LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
        artifactPath: brokerArtifactPath,
      }),
    ]),
  });
}
