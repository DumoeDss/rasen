import { createHash, generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AttestationAuthority,
  Digest,
  RunAction,
} from '../../../src/core/change-run/contracts.js';
import { TrustedCompletionProducerError } from '../../../src/core/change-run/internal/trusted-completion-producer.js';
import {
  createTrustedExecutionAdapterProducerResolver,
  provisionTrustedExecutionAdapterCatalog,
  provisionTrustedExecutionAdapterCredentials,
  trustedExecutionAdapterCatalogPath,
  trustedExecutionAdapterCredentialPath,
  type TrustedExecutionAdapterDescriptor,
} from '../../../src/core/pipeline-registry/trusted-execution-adapters.js';
import { authoritativeConsultationAction } from '../change-run/consultation-fixture.js';
import { makeRecordAction, recordIds } from '../change-run/record-fixture.js';

function authorityFor(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): AttestationAuthority {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return {
    format: 'change-run-attestation-authority/1',
    algorithm: 'ed25519',
    keyId: 'host-private-test',
    keyVersion: '1',
    publicKey: {
      format: 'spki-der',
      encoding: 'base64',
      value: Buffer.from(der).toString('base64'),
      digest: `sha256:${createHash('sha256').update(der).digest('hex')}` as Digest,
    },
  };
}

function descriptor(authority: AttestationAuthority): TrustedExecutionAdapterDescriptor {
  return {
    format: 'trusted-execution-adapter/1',
    adapter: {
      id: 'fixture-adapter',
      version: '1',
      contentDigest: recordIds.digest,
    },
    attestationAuthority: authority,
  };
}

function actionFor(authority: AttestationAuthority): RunAction {
  const base = authoritativeConsultationAction(makeRecordAction());
  return {
    ...base,
    capability: {
      ...base.capability,
      artifact: {
        id: 'fixture-adapter',
        version: '1',
        contentDigest: recordIds.digest,
      },
    },
    completionAuthority: {
      ...base.completionAuthority!,
      attestationAuthority: authority,
    },
  };
}

describe('machine-private trusted execution Adapter credentials', () => {
  it('keeps private bytes outside the public catalog and resolves the exact frozen Action', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-adapter-credential-'));
    try {
      const pair = generateKeyPairSync('ed25519');
      const authority = authorityFor(pair.publicKey);
      const installed = descriptor(authority);
      provisionTrustedExecutionAdapterCatalog(root, [installed]);
      provisionTrustedExecutionAdapterCredentials(root, [
        { descriptor: installed, privateKey: pair.privateKey },
      ]);

      const publicBytes = fs.readFileSync(
        trustedExecutionAdapterCatalogPath(root),
        'utf8'
      );
      const privateBytes = fs.readFileSync(
        trustedExecutionAdapterCredentialPath(root),
        'utf8'
      );
      const privateDer = Buffer.from(
        pair.privateKey.export({ format: 'der', type: 'pkcs8' })
      ).toString('base64');
      expect(trustedExecutionAdapterCredentialPath(root)).not.toBe(
        trustedExecutionAdapterCatalogPath(root)
      );
      expect(publicBytes).not.toContain(privateDer);
      expect(privateBytes).toContain(privateDer);

      const producer = createTrustedExecutionAdapterProducerResolver(root)(
        actionFor(authority)
      );
      expect(producer.adapter).toEqual(installed.adapter);
      expect(producer.authority).toEqual(authority);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('never derives a private half from public authority and rejects a mismatched credential', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-adapter-credential-'));
    try {
      const pair = generateKeyPairSync('ed25519');
      const wrong = generateKeyPairSync('ed25519');
      const authority = authorityFor(pair.publicKey);
      const installed = descriptor(authority);
      provisionTrustedExecutionAdapterCatalog(root, [installed]);
      expect(() =>
        createTrustedExecutionAdapterProducerResolver(root)(actionFor(authority))
      ).toThrowError(
        expect.objectContaining<Partial<TrustedCompletionProducerError>>({
          code: 'attestation_signer_unavailable',
        })
      );
      expect(() =>
        provisionTrustedExecutionAdapterCredentials(root, [
          { descriptor: installed, privateKey: wrong.privateKey },
        ])
      ).toThrowError(
        expect.objectContaining<Partial<TrustedCompletionProducerError>>({
          code: 'attestation_signer_mismatch',
        })
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
