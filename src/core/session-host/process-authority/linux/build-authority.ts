import type { LinuxAuthorityMode } from './provider.js';

export interface LinuxProcessAuthorityBuildIdentity {
  readonly artifactPath: string;
  readonly arch: 'x64' | 'arm64';
  readonly mode: LinuxAuthorityMode;
  readonly providerId: 'rasen.linux.user-pidns' | 'rasen.linux.broker-pidns-cgroupv2';
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
export const LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES:
readonly LinuxProcessAuthorityBuildIdentity[] = Object.freeze([]);
