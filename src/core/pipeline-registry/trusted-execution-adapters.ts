import {
  createPrivateKey,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import {
  decodeAttestationAuthority,
  type RunAction,
  type AttestationAuthority,
  type Digest,
} from '../change-run/contracts.js';
import {
  computeAttestationAuthorityDigest,
  validateAttestationAuthority,
} from '../change-run/internal/attestation.js';
import {
  createTrustedCompletionProducer,
  TrustedCompletionProducerError,
  type TrustedCompletionProducer,
} from '../change-run/internal/trusted-completion-producer.js';
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
const CredentialWireSchema = z.strictObject({
  format: z.literal('trusted-execution-adapter-credential/1'),
  adapter: DescriptorWireSchema.shape.adapter,
  authorityDigest: DigestSchema,
  privateKey: z.strictObject({
    format: z.literal('pkcs8-der'),
    encoding: z.literal('base64'),
    value: z.string().min(1).max(64 * 1024),
  }),
});
const CredentialCatalogWireSchema = z.strictObject({
  format: z.literal('trusted-execution-adapter-credential-catalog/1'),
  credentials: z.array(CredentialWireSchema).max(4096),
});

export class TrustedExecutionAdapterError extends Error {
  constructor(
    readonly code:
      | 'trusted_adapter_catalog_invalid'
      | 'trusted_adapter_authority_missing'
      | 'trusted_adapter_authority_ambiguous'
      | 'trusted_adapter_artifact_mismatch'
      | 'trusted_adapter_credential_invalid'
      | 'trusted_adapter_credential_missing'
      | 'trusted_adapter_credential_ambiguous',
    message: string
  ) {
    super(message);
    this.name = 'TrustedExecutionAdapterError';
  }
}

const CATALOG_FILE = 'trusted-execution-adapters.json';
const PRIVATE_CREDENTIAL_DIRECTORY = 'trusted-execution-adapter-private';
const PRIVATE_CREDENTIAL_FILE = 'credentials.json';

export interface TrustedExecutionAdapterCredentialInput {
  readonly descriptor: TrustedExecutionAdapterDescriptor;
  readonly privateKey: KeyObject;
}

interface LoadedTrustedExecutionAdapterCredential {
  readonly adapter: TrustedExecutionAdapterDescriptor['adapter'];
  readonly authorityDigest: Digest;
  readonly privateKey: KeyObject;
}

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

/**
 * Machine-private signer material. This path is deliberately disjoint from
 * the public descriptor catalog consumed during planning/freezing.
 */
export function trustedExecutionAdapterCredentialPath(hostStateRoot: string): string {
  return path.join(
    path.resolve(hostStateRoot),
    PRIVATE_CREDENTIAL_DIRECTORY,
    PRIVATE_CREDENTIAL_FILE
  );
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

/**
 * Persist host-provided Ed25519 signer credentials. No private key is ever
 * generated or derived from a public authority: callers must provide the
 * exact private half, and producer construction proves it matches the public
 * descriptor before any bytes are written.
 */
export function provisionTrustedExecutionAdapterCredentials(
  hostStateRoot: string,
  inputs: readonly TrustedExecutionAdapterCredentialInput[]
): string {
  const publicCatalog = loadTrustedExecutionAdapterCatalog(hostStateRoot);
  if (publicCatalog === undefined) {
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_authority_missing',
      'Trusted execution Adapter credentials require an installed public descriptor catalog.'
    );
  }
  const seen = new Set<string>();
  const credentials = inputs.map((input) => {
    const descriptor = decodeDescriptor(input.descriptor);
    const authority = resolveTrustedExecutionAdapterAuthority(
      descriptor.adapter,
      publicCatalog
    );
    if (canonicalJson(authority) !== canonicalJson(descriptor.attestationAuthority)) {
      throw new TrustedExecutionAdapterError(
        'trusted_adapter_artifact_mismatch',
        `Credential authority does not match the installed public descriptor for ${descriptor.adapter.id}@${descriptor.adapter.version}.`
      );
    }
    createTrustedCompletionProducer({
      adapter: descriptor.adapter,
      authority,
      privateKey: input.privateKey,
    });
    const authorityDigest = computeAttestationAuthorityDigest(authority);
    const key = `${descriptor.adapter.id}\0${descriptor.adapter.version}\0${descriptor.adapter.contentDigest}\0${authorityDigest}`;
    if (seen.has(key)) {
      throw new TrustedExecutionAdapterError(
        'trusted_adapter_credential_ambiguous',
        `Duplicate private signer credential for ${descriptor.adapter.id}@${descriptor.adapter.version}.`
      );
    }
    seen.add(key);
    const der = input.privateKey.export({ format: 'der', type: 'pkcs8' });
    return {
      format: 'trusted-execution-adapter-credential/1' as const,
      adapter: descriptor.adapter,
      authorityDigest,
      privateKey: {
        format: 'pkcs8-der' as const,
        encoding: 'base64' as const,
        value: Buffer.from(der).toString('base64'),
      },
    };
  });
  const target = trustedExecutionAdapterCredentialPath(hostStateRoot);
  const root = path.dirname(target);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    chmodSync(root, 0o700);
  } catch {
    // Windows does not provide POSIX mode enforcement. The machine-private
    // data root ACL remains the authority there.
  }
  const staging = `${target}.${randomBytes(32).toString('hex')}.tmp`;
  writeFileSync(
    staging,
    `${canonicalJson({
      format: 'trusted-execution-adapter-credential-catalog/1',
      credentials,
    })}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' }
  );
  renameSync(staging, target);
  try {
    chmodSync(target, 0o600);
  } catch {
    // See the directory note above.
  }
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

function loadTrustedExecutionAdapterCredentials(
  hostStateRoot: string
): readonly LoadedTrustedExecutionAdapterCredential[] {
  const file = trustedExecutionAdapterCredentialPath(hostStateRoot);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_credential_invalid',
      'Trusted execution Adapter credentials could not be read.'
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_credential_invalid',
      'Trusted execution Adapter credentials are not valid JSON.'
    );
  }
  const parsed = CredentialCatalogWireSchema.safeParse(value);
  if (!parsed.success) {
    throw new TrustedExecutionAdapterError(
      'trusted_adapter_credential_invalid',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    );
  }
  const seen = new Set<string>();
  return Object.freeze(parsed.data.credentials.map((credential) => {
    const canonicalBase64 = Buffer.from(credential.privateKey.value, 'base64').toString('base64');
    if (canonicalBase64 !== credential.privateKey.value) {
      throw new TrustedExecutionAdapterError(
        'trusted_adapter_credential_invalid',
        'Trusted execution Adapter private key is not canonical base64.'
      );
    }
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey({
        key: Buffer.from(credential.privateKey.value, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
    } catch {
      throw new TrustedExecutionAdapterError(
        'trusted_adapter_credential_invalid',
        'Trusted execution Adapter private key is not canonical PKCS8 DER.'
      );
    }
    const key = `${credential.adapter.id}\0${credential.adapter.version}\0${credential.adapter.contentDigest}\0${credential.authorityDigest}`;
    if (seen.has(key)) {
      throw new TrustedExecutionAdapterError(
        'trusted_adapter_credential_ambiguous',
        `Multiple private signer credentials match ${credential.adapter.id}@${credential.adapter.version}.`
      );
    }
    seen.add(key);
    return Object.freeze({
      adapter: Object.freeze({
        ...credential.adapter,
        contentDigest: credential.adapter.contentDigest as Digest,
      }),
      authorityDigest: credential.authorityDigest as Digest,
      privateKey,
    });
  }));
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

/**
 * Build the daemon-owned Action -> producer resolver. Public descriptors and
 * private credentials are loaded independently, joined only by the exact
 * frozen Adapter identity plus authority digest, and verified again by
 * `createTrustedCompletionProducer` before use.
 */
export function createTrustedExecutionAdapterProducerResolver(
  hostStateRoot: string
): (action: RunAction) => TrustedCompletionProducer {
  const root = path.resolve(hostStateRoot);
  return (action: RunAction): TrustedCompletionProducer => {
    try {
      const frozenAuthority = action.completionAuthority?.attestationAuthority;
      if (frozenAuthority === undefined) {
        throw new TrustedCompletionProducerError(
          'attestation_signer_unavailable',
          'Frozen Action has no trusted attestation authority.'
        );
      }
      const catalog = loadTrustedExecutionAdapterCatalog(root);
      const adapter = {
        id: action.capability.artifact.id,
        version: action.capability.artifact.version,
        contentDigest: action.capability.artifact.contentDigest as Digest,
      };
      const authority = resolveTrustedExecutionAdapterAuthority(adapter, catalog);
      if (canonicalJson(authority) !== canonicalJson(frozenAuthority)) {
        throw new TrustedCompletionProducerError(
          'attestation_signer_mismatch',
          'Frozen Action authority does not match the installed public Adapter descriptor.'
        );
      }
      const authorityDigest = computeAttestationAuthorityDigest(authority);
      const matches = loadTrustedExecutionAdapterCredentials(root).filter(
        (credential) =>
          credential.adapter.id === adapter.id &&
          credential.adapter.version === adapter.version &&
          credential.adapter.contentDigest === adapter.contentDigest &&
          credential.authorityDigest === authorityDigest
      );
      if (matches.length === 0) {
        throw new TrustedCompletionProducerError(
          'attestation_signer_unavailable',
          'No machine-private signer credential matches the frozen Action authority.'
        );
      }
      if (matches.length !== 1) {
        throw new TrustedCompletionProducerError(
          'attestation_signer_mismatch',
          'Multiple machine-private signer credentials match the frozen Action authority.'
        );
      }
      return createTrustedCompletionProducer({
        adapter,
        authority,
        privateKey: matches[0]!.privateKey,
      });
    } catch (error) {
      if (error instanceof TrustedCompletionProducerError) throw error;
      throw new TrustedCompletionProducerError(
        error instanceof TrustedExecutionAdapterError &&
          error.code === 'trusted_adapter_credential_missing'
          ? 'attestation_signer_unavailable'
          : 'attestation_signer_mismatch',
        error instanceof TrustedExecutionAdapterError
          ? error.message
          : 'Trusted execution Adapter signer state is invalid.'
      );
    }
  };
}
