import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_PUBLICATION_VERSION,
  type AuthorityOperationContext,
  type ProcessAuthorityPublicationBinding,
  type ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import { encodeProcessAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import {
  WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../../src/core/session-host/process-authority/windows/contracts.js';
import {
  createWindowsPrivateAuthorityReference,
  decodeWindowsPrivateAuthorityReference,
  WINDOWS_EXPECTED_JOB_LIMIT_MASK,
  type WindowsPrivateAuthorityReferenceInput,
} from '../../../src/core/session-host/process-authority/windows/private-reference.js';
import {
  WINDOWS_PUBLICATION_DURABILITY_BARRIER,
  createWindowsAuthorityPublicationLedger,
  createWindowsAuthorityPublicationPublisher,
} from '../../../src/core/session-host/process-authority/windows/publication-ledger.js';
import {
  WINDOWS_FIXTURE_BOOT_IDENTITY,
  WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
  WINDOWS_FIXTURE_GUARDIAN_PID,
  WINDOWS_FIXTURE_OWNER_SID,
} from '../../helpers/windows-process-authority-provider-fixture.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-windows-ledger-'));
  roots.push(root);
  return path.join(root, 'publication-ledger');
}

function reference(seed: number, operationId: string): ProviderAuthorityReference {
  const input: WindowsPrivateAuthorityReferenceInput = {
    scopeId: Buffer.alloc(16, seed).toString('base64url'),
    generation: Buffer.alloc(16, seed + 64).toString('base64url'),
    scopeCapability: Buffer.alloc(32, seed + 16).toString('base64url'),
    controlCapability: Buffer.alloc(32, seed + 32).toString('base64url'),
    preparationOperationId: operationId,
    launchDigest: `${seed}`.padStart(64, 'a'),
    bootIdentity: WINDOWS_FIXTURE_BOOT_IDENTITY,
    bootIdentitySource: 'nt-system-boot-environment-information',
    guardianProcessId: WINDOWS_FIXTURE_GUARDIAN_PID,
    guardianCreationTime: WINDOWS_FIXTURE_GUARDIAN_CREATION_TIME,
    endpointOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
    stateRootOwnerSid: WINDOWS_FIXTURE_OWNER_SID,
    jobLimitMask: WINDOWS_EXPECTED_JOB_LIMIT_MASK,
    activeProcessCountAtPortAssociation: 0,
    soleHandleAttestation: Buffer.alloc(32, seed + 96).toString('base64url'),
    helperProtocolVersion: 1,
    artifactSha256: 'b'.repeat(64),
    sourceSha256: 'c'.repeat(64),
  };
  return createWindowsPrivateAuthorityReference(input);
}

function binding(providerReference: ProviderAuthorityReference): ProcessAuthorityPublicationBinding {
  const full = encodeProcessAuthorityReference(
    WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
    providerReference
  );
  return {
    reference: full,
    referenceDigest: createHash('sha256').update(String(full), 'utf8').digest('hex'),
    preparationOperationId:
      decodeWindowsPrivateAuthorityReference(providerReference).preparationOperationId,
    publicationVersion: PROCESS_AUTHORITY_PUBLICATION_VERSION,
  };
}

function publishContext(operationId: string): AuthorityOperationContext {
  return {
    phase: 'publish',
    operationId,
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
  };
}

function entryFile(root: string, digest: string): string {
  return path.join(root, `${digest}.entry`);
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

describe('Windows durable publication ledger', () => {
  it('reports prepared-inert only when no publication record exists', () => {
    const root = temporaryRoot();
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    const providerReference = reference(1, 'prepare-1');
    expect(ledger.lookup(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference)).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-missing',
    });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    expect(ledger.lookup(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference)).toEqual({
      state: 'prepared-inert',
    });
    expect(ledger.requirePublished(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference))
      .toEqual({ state: 'authority-uncertain', diagnosticCode: 'ledger-missing' });
  });

  it('commits durably before returning the acknowledgement', async () => {
    const root = temporaryRoot();
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    const providerReference = reference(2, 'prepare-2');
    const publisher = createWindowsAuthorityPublicationPublisher(ledger);
    const bound = binding(providerReference);
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    expect(fs.existsSync(entryFile(root, bound.referenceDigest))).toBe(false);
    const acknowledgement = await publisher(bound, publishContext('publish-2'));
    expect(fs.existsSync(entryFile(root, bound.referenceDigest))).toBe(true);
    expect(acknowledgement).toMatchObject({
      referenceDigest: bound.referenceDigest,
      preparationOperationId: 'prepare-2',
      publicationVersion: PROCESS_AUTHORITY_PUBLICATION_VERSION,
    });
  });

  it('produces no acknowledgement at all when the commit cannot be made durable', async () => {
    const root = temporaryRoot();
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    const providerReference = reference(3, 'prepare-3');
    const publisher = createWindowsAuthorityPublicationPublisher(ledger);
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    // Removing the root makes the commit fail. If an acknowledgement could be
    // produced anyway, publication truth would exist only in memory.
    fs.rmSync(root, { recursive: true, force: true });
    await expect(publisher(binding(providerReference), publishContext('publish-3')))
      .rejects.toThrow();
    expect(fs.existsSync(root)).toBe(false);
  });

  it('recovers published-inert after a crash between commit and acknowledgement', () => {
    const root = temporaryRoot();
    const providerReference = reference(4, 'prepare-4');
    const committing = createWindowsAuthorityPublicationLedger({ root });
    committing.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    // Commit directly, never producing an acknowledgement: the exact shape of a
    // process that died after the record was durable.
    committing.commit(binding(providerReference), publishContext('publish-4'));

    const replacement = createWindowsAuthorityPublicationLedger({ root });
    expect(replacement.lookup(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference)).toEqual({
      state: 'published-inert',
    });
  });

  it('recovers published-inert after a crash between acknowledgement and activate', async () => {
    const root = temporaryRoot();
    const providerReference = reference(5, 'prepare-5');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    await createWindowsAuthorityPublicationPublisher(ledger)(
      binding(providerReference),
      publishContext('publish-5')
    );
    const replacement = createWindowsAuthorityPublicationLedger({ root });
    expect(replacement.requirePublished(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference))
      .toEqual({ state: 'published-inert' });
  });

  it('is idempotent for a repeated exact commit', () => {
    const root = temporaryRoot();
    const providerReference = reference(6, 'prepare-6');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    ledger.commit(binding(providerReference), publishContext('publish-6'));
    ledger.commit(binding(providerReference), publishContext('publish-6'));
    expect(ledger.lookup(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference)).toEqual({
      state: 'published-inert',
    });
  });

  it('rejects a second commit under a different publication operation', () => {
    const root = temporaryRoot();
    const providerReference = reference(7, 'prepare-7');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    ledger.commit(binding(providerReference), publishContext('publish-7a'));
    expect(() => ledger.commit(binding(providerReference), publishContext('publish-7b')))
      .toThrow(/conflicting provenance/u);
  });

  it('classifies a forged record as uncertain and never as published', () => {
    const root = temporaryRoot();
    const providerReference = reference(8, 'prepare-8');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    const bound = binding(providerReference);
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    ledger.commit(bound, publishContext('publish-8'));
    fs.writeFileSync(entryFile(root, bound.referenceDigest), '{"forged":true}');
    expect(ledger.lookup(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference)).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-malformed',
    });
  });

  it('classifies a record bound to another authority as an event gap', () => {
    const root = temporaryRoot();
    const first = reference(9, 'prepare-9');
    const second = reference(10, 'prepare-10');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    for (const providerReference of [first, second]) {
      ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
      ledger.commit(binding(providerReference), publishContext('publish-cross'));
    }
    // A structurally valid, integrity-bound record for a *different* authority
    // must not be read as this authority's publication.
    fs.copyFileSync(
      entryFile(root, binding(first).referenceDigest),
      entryFile(root, binding(second).referenceDigest)
    );
    expect(ledger.lookup(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, second)).toEqual({
      state: 'event-gap',
      diagnosticCode: 'ledger-conflict',
    });
  });

  it('refuses a binding whose digest, operation or version does not match', () => {
    const root = temporaryRoot();
    const providerReference = reference(11, 'prepare-11');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    const bound = binding(providerReference);
    for (const mutated of [
      { ...bound, referenceDigest: '0'.repeat(64) },
      { ...bound, preparationOperationId: 'prepare-elsewhere' },
      { ...bound, publicationVersion: 2 as typeof PROCESS_AUTHORITY_PUBLICATION_VERSION },
      { ...bound, extra: 1 } as unknown as ProcessAuthorityPublicationBinding,
    ]) {
      expect(() => ledger.commit(mutated, publishContext('publish-11'))).toThrow();
    }
  });

  it('refuses a publish context that is cancelled or in the wrong phase', () => {
    const root = temporaryRoot();
    const providerReference = reference(12, 'prepare-12');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    const cancelled = new AbortController();
    cancelled.abort();
    expect(() => ledger.commit(binding(providerReference), {
      ...publishContext('publish-12'),
      signal: cancelled.signal,
    })).toThrow(/malformed or cancelled/u);
    expect(() => ledger.commit(binding(providerReference), {
      ...publishContext('publish-12'),
      phase: 'activate',
    })).toThrow(/malformed or cancelled/u);
  });

  it('refuses a ledger root whose identity changed after construction', () => {
    const root = temporaryRoot();
    const providerReference = reference(13, 'prepare-13');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    expect(ledger.lookup(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference)).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-unavailable',
    });
  });

  it('refuses a foreign descriptor and a foreign provider reference', () => {
    const root = temporaryRoot();
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    expect(ledger.lookup(
      { ...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerId: 'rasen.linux.user-pidns' },
      reference(14, 'prepare-14')
    )).toEqual({ state: 'authority-uncertain', diagnosticCode: 'ledger-unavailable' });
    expect(ledger.lookup(
      WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
      'rasen-provider-authority/1:aGVsbG8' as ProviderAuthorityReference
    )).toEqual({ state: 'authority-uncertain', diagnosticCode: 'ledger-unavailable' });
  });

  it('rejects a ledger instance that did not come from the exact capability constructor', () => {
    const root = temporaryRoot();
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    const impostor = Object.create(Object.getPrototypeOf(ledger)) as typeof ledger;
    expect(() => createWindowsAuthorityPublicationPublisher(impostor))
      .toThrow(/provenance is invalid/u);
  });

  it('records exactly which Win32 durability steps this layer reaches', () => {
    // Recorded rather than argued: `MOVEFILE_WRITE_THROUGH` and a directory
    // `FlushFileBuffers` are unreachable from Node, so the shortfall must be
    // visible in receipts instead of implied by the ledger's existence.
    expect(WINDOWS_PUBLICATION_DURABILITY_BARRIER).toEqual({
      temporaryInSameDirectory: true,
      flushFileBuffersOnFileHandle: true,
      moveFileExReplaceExisting: true,
      moveFileExWriteThrough: false,
      flushFileBuffersOnDirectoryHandle: false,
      postRenameReopenAndFlush: true,
    });
  });

  it('leaves no uncommitted temporary behind after a successful commit', () => {
    const root = temporaryRoot();
    const providerReference = reference(15, 'prepare-15');
    const ledger = createWindowsAuthorityPublicationLedger({ root });
    ledger.recordPrepared(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerReference);
    ledger.commit(binding(providerReference), publishContext('publish-15'));
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.'))).toEqual([]);
  });
});
