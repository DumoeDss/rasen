import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import {
  decodeAttestationAuthority,
  type AttestationAuthority,
  type Digest,
} from '../change-run/contracts.js';
import { validateAttestationAuthority } from '../change-run/internal/attestation.js';
import { canonicalJson } from '../change-run/internal/identity.js';

export interface TrustedExecutionAdapterDescriptor {
  readonly format: 'trusted-execution-adapter/1';
  readonly adapter: {
    readonly id: string;
    readonly version: string;
    readonly contentDigest: Digest;
  };
  readonly attestationAuthority: AttestationAuthority;
}

export interface TrustedExecutionAdapterCatalog {
  readonly format: 'trusted-execution-adapter-catalog/1';
  readonly descriptors: readonly TrustedExecutionAdapterDescriptor[];
  readonly provenance: 'host-state' | 'package-unavailable';
}

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const DescriptorWireSchema = z.strictObject({
  format: z.literal('trusted-execution-adapter/1'),
  adapter: z.strictObject({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    contentDigest: DigestSchema,
  }),
  attestationAuthority: z.unknown(),
});
const CatalogWireSchema = z.strictObject({
  format: z.literal('trusted-execution-adapter-catalog/1'),
  descriptors: z.array(DescriptorWireSchema).max(4096),
});

export class TrustedExecutionAdapterError extends Error {
  constructor(
    readonly code:
      | 'trusted_adapter_catalog_invalid'
      | 'trusted_adapter_authority_missing'
      | 'trusted_adapter_authority_ambiguous'
      | 'trusted_adapter_artifact_mismatch',
    message: string
  ) {
    super(message);
    this.name = 'TrustedExecutionAdapterError';
  }
}

const CATALOG_FILE = 'trusted-execution-adapters.json';

/**
 * Public-only package fallback. Its private half was discarded at generation
 * time, so an Action may be planned/inspected but no host can sign with it.
 * ECP-7 replaces this unavailable producer with an installed host descriptor.
 */
export const PACKAGE_UNAVAILABLE_AUTHORITY: AttestationAuthority = Object.freeze({
  format: 'change-run-attestation-authority/1',
  algorithm: 'ed25519',
  keyId: 'rasen-package-unavailable',
  keyVersion: '1',
  publicKey: Object.freeze({
    format: 'spki-der',
    encoding: 'base64',
    value: 'MCowBQYDK2VwAyEA6dKKX1L+1NBg6aFsMTLsf34nQt/o5h5NSSgdXhTGy0Q=',
    digest: 'sha256:c80d43b711847c299dd5395fc9d9cbbb0f56295aa5d2e4d95f9b10246afbabde' as Digest,
  }),
});

function decodeDescriptor(value: unknown): TrustedExecutionAdapterDescriptor {
  const parsed = DescriptorWireSchema.safeParse(value);
  if (!parsed.success) {
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_catalog_invalid',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    );
  }
  const authority = decodeAttestationAuthority(parsed.data.attestationAuthority);
  validateAttestationAuthority(authority);
  return Object.freeze({
    format: 'trusted-execution-adapter/1',
    adapter: Object.freeze({
      ...parsed.data.adapter,
      contentDigest: parsed.data.adapter.contentDigest as Digest,
    }),
    attestationAuthority: authority,
  });
}

export function createTrustedExecutionAdapterCatalog(
  descriptors: readonly TrustedExecutionAdapterDescriptor[],
  provenance: TrustedExecutionAdapterCatalog['provenance'] = 'host-state'
): TrustedExecutionAdapterCatalog {
  return Object.freeze({
    format: 'trusted-execution-adapter-catalog/1',
    descriptors: Object.freeze(descriptors.map(decodeDescriptor)),
    provenance,
  });
}

export function trustedExecutionAdapterCatalogPath(hostStateRoot: string): string {
  return path.join(path.resolve(hostStateRoot), CATALOG_FILE);
}

/** Internal host bootstrap seam. Only public descriptors are persisted. */
export function provisionTrustedExecutionAdapterCatalog(
  hostStateRoot: string,
  descriptors: readonly TrustedExecutionAdapterDescriptor[]
): string {
  const catalog = createTrustedExecutionAdapterCatalog(descriptors);
  const root = path.resolve(hostStateRoot);
  mkdirSync(root, { recursive: true });
  const target = trustedExecutionAdapterCatalogPath(root);
  const token = randomBytes(32).toString('hex');
  const staging = `${target}.${token}.tmp`;
  writeFileSync(
    staging,
    `${canonicalJson({ format: catalog.format, descriptors: catalog.descriptors })}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' }
  );
  renameSync(staging, target);
  return target;
}

export function loadTrustedExecutionAdapterCatalog(
  hostStateRoot: string
): TrustedExecutionAdapterCatalog | undefined {
  const file = trustedExecutionAdapterCatalogPath(hostStateRoot);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_catalog_invalid',
      `Trusted execution Adapter catalog could not be read: ${(error as Error).message}`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_catalog_invalid',
      'Trusted execution Adapter catalog is not valid JSON.'
    );
  }
  const parsed = CatalogWireSchema.safeParse(value);
  if (!parsed.success) {
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_catalog_invalid',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    );
  }
  return createTrustedExecutionAdapterCatalog(
    parsed.data.descriptors.map(decodeDescriptor),
    'host-state'
  );
}

export function resolveTrustedExecutionAdapterAuthority(
  adapter: Readonly<{ id: string; version: string; contentDigest: Digest }>,
  catalog: TrustedExecutionAdapterCatalog | undefined
): AttestationAuthority {
  if (catalog === undefined) {
    validateAttestationAuthority(PACKAGE_UNAVAILABLE_AUTHORITY);
    return PACKAGE_UNAVAILABLE_AUTHORITY;
  }
  const byIdentity = catalog.descriptors.filter(
    (descriptor) =>
      descriptor.adapter.id === adapter.id &&
      descriptor.adapter.version === adapter.version
  );
  const matches = byIdentity.filter(
    (descriptor) => descriptor.adapter.contentDigest === adapter.contentDigest
  );
  if (matches.length === 0) {
    throw new TrustedExecutionAdapterError(
      byIdentity.length === 0
        ? 'trusted_adapter_authority_missing'
        : 'trusted_adapter_artifact_mismatch',
      `No host-owned attestation authority exactly matches ${adapter.id}@${adapter.version} ${adapter.contentDigest}.`
    );
  }
  if (matches.length !== 1) {
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_authority_ambiguous',
      `Multiple host-owned attestation authorities match ${adapter.id}@${adapter.version} ${adapter.contentDigest}.`
    );
  }
  validateAttestationAuthority(matches[0]!.attestationAuthority);
  return matches[0]!.attestationAuthority;
}
