import { createHash } from 'node:crypto';

import { canonicalBytes } from './canonical.js';
import type { PackageFile, PackageWithoutDigest, RasenPackageKind } from './schema.js';

export function packageSha256(bytes: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function computeFileDigest(content: string): string {
  return packageSha256(Buffer.from(content, 'utf8'));
}

export function computePackagedWorkflowDigest(
  id: string,
  files: readonly Pick<PackageFile, 'path' | 'sha256'>[]
): string {
  return packageSha256(
    canonicalBytes({
      format: 'rasen-workflow-digest',
      version: 1,
      id,
      files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    })
  );
}

export function computePackagedPipelineDigest(
  name: string,
  files: readonly Pick<PackageFile, 'path' | 'sha256'>[]
): string {
  return packageSha256(
    canonicalBytes({
      format: 'rasen-pipeline-digest',
      version: 1,
      name,
      files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    })
  );
}

export function computePackageDigest(
  kind: RasenPackageKind,
  packageWithoutDigest: PackageWithoutDigest
): string {
  return packageSha256(
    canonicalBytes({
      format: 'rasen-package-digest',
      version: 1,
      kind,
      package: packageWithoutDigest,
    })
  );
}

