export type WindowsAuthorityMode = 'job-object';

export interface WindowsProcessAuthorityBuildIdentity {
  readonly artifactPath: string;
  readonly arch: 'x64' | 'arm64';
  readonly mode: WindowsAuthorityMode;
  readonly providerId: 'rasen.windows.job-object';
  readonly protocolVersion: 1;
  readonly providerReferenceVersion: 1;
  readonly length: number;
  readonly sha256: string;
  readonly sourceSha256: string;
  readonly compiler: string;
}

/**
 * Build-pinned authority is compiled into the shipped program, never loaded from
 * the mutable helper/manifest package tree. Packaging must generate this table
 * from authenticated release inputs. Until then production resolution is
 * deliberately unavailable.
 */
export const WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES:
readonly WindowsProcessAuthorityBuildIdentity[] = Object.freeze([]);
