import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_PUBLICATION_VERSION,
  createProcessAuthorityPublicationAcknowledgement,
  type AuthorityOperationContext,
  type ProcessAuthorityPublicationBinding,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  encodeProcessAuthorityReference,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import {
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../../src/core/session-host/process-authority/linux/contracts.js';
import {
  createLinuxPrimaryPrivateAuthorityReference,
} from '../../../src/core/session-host/process-authority/linux/private-reference.js';
import {
  LinuxAuthorityPublicationLedger,
  createLinuxAuthorityPublicationLedger,
  createLinuxAuthorityPublicationPublisher,
} from '../../../src/core/session-host/process-authority/linux/publication-ledger.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const tempRoots: string[] = [];
const PREPARATION_OPERATION_ID = 'prepare-ledger-1';
const LAUNCH_DIGEST = 'a'.repeat(64);

function tempLedger(): { root: string; ledger: LinuxAuthorityPublicationLedger } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-ledger-'));
  tempRoots.push(parent);
  const root = path.join(parent, 'authority-publications');
  return { root, ledger: createLinuxAuthorityPublicationLedger({ root }) };
}

function privateReference() {
  return createLinuxPrimaryPrivateAuthorityReference({
    generation: 'A'.repeat(22),
    scopeCapability: `${'B'.repeat(42)}A`,
    controlCapability: `${'C'.repeat(42)}A`,
    preparationOperationId: PREPARATION_OPERATION_ID,
    launchDigest: LAUNCH_DIGEST,
    bootId: '11111111-2222-4333-8444-555555555555',
    guardianPid: 4444,
    guardianStartTicks: '12345678901234567',
    pidNamespaceDevice: '4',
    pidNamespaceInode: '4026533001',
    helperProtocolVersion: 1,
    artifactSha256: 'e'.repeat(64),
    sourceSha256: 'b'.repeat(64),
  });
}

function binding() {
  const providerReference = privateReference();
  const reference = encodeProcessAuthorityReference(
    LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
    providerReference
  );
  const value: ProcessAuthorityPublicationBinding = Object.freeze({
    reference,
    referenceDigest: createHash('sha256').update(String(reference)).digest('hex'),
    preparationOperationId: PREPARATION_OPERATION_ID,
    publicationVersion: PROCESS_AUTHORITY_PUBLICATION_VERSION,
  });
  return { providerReference, reference, binding: value };
}

function context(operationId = 'publish-ledger-1'): AuthorityOperationContext {
  return Object.freeze({
    phase: 'publish',
    operationId,
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) cleanupTempPath(root);
});

describe('trusted Linux authority publication ledger', () => {
  it('rejects subclassed ledger capabilities before an override can forge publication', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-ledger-subclass-'));
    tempRoots.push(parent);
    class ForgedLedger extends LinuxAuthorityPublicationLedger {
      override commit(): void {}
      override requirePublished(): { state: 'published-inert' } {
        return { state: 'published-inert' };
      }
    }

    expect(() => new ForgedLedger({ root: path.join(parent, 'authority-publications') }))
      .toThrow(/exact|subclass|provenance/i);
  });

  it('reports native inert as prepared when no publication record exists', () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    ledger.recordPrepared(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    );
    expect(ledger.lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({ state: 'prepared-inert' });
    expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({ state: 'prepared-inert' });
  });

  it('atomically commits and fsyncs the exact record before returning acknowledgement', async () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    const publisher = createLinuxAuthorityPublicationPublisher(ledger);

    await expect(publisher(exact.binding, context())).resolves.toEqual(
      createProcessAuthorityPublicationAcknowledgement(exact.binding)
    );
    expect(ledger.lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({ state: 'published-inert' });

    const entry = path.join(root, `${exact.binding.referenceDigest}.entry`);
    expect(fs.readdirSync(entry)).toEqual(['publication.json']);
    const record = JSON.parse(
      fs.readFileSync(path.join(entry, 'publication.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      schema: 'rasen-linux-authority-publication/1',
      referenceDigest: exact.binding.referenceDigest,
      preparationOperationId: PREPARATION_OPERATION_ID,
      publicationVersion: 1,
      providerId: 'rasen.linux.user-pidns',
      protocolVersion: 1,
      providerReferenceVersion: 1,
      generation: 'A'.repeat(22),
      launchDigest: LAUNCH_DIGEST,
      publicationOperationId: 'publish-ledger-1',
      integrityAlgorithm: 'sha256',
      integrityDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(record)).not.toContain(`${'B'.repeat(42)}A`);
    expect(JSON.stringify(record)).not.toContain(`${'C'.repeat(42)}A`);
  });

  it('recovers published inert after commit when acknowledgement delivery is lost', async () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    const durablePublisher = createLinuxAuthorityPublicationPublisher(ledger);
    await expect((async () => {
      await durablePublisher(exact.binding, context('publish-before-lost-ack'));
      throw new Error('simulated acknowledgement loss');
    })()).rejects.toThrow('simulated acknowledgement loss');

    const replacement = createLinuxAuthorityPublicationLedger({ root });
    expect(replacement.lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({ state: 'published-inert' });
  });

  it('never rolls a durably published generation back to prepared when its entry disappears', async () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    await createLinuxAuthorityPublicationPublisher(ledger)(
      exact.binding,
      context('publish-before-entry-loss')
    );
    fs.rmSync(path.join(root, `${exact.binding.referenceDigest}.entry`), {
      recursive: true,
      force: true,
    });

    expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-missing',
    });
  });

  it('retains recovery when every old publication file is removed instead of inventing fresh prepare', async () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    await createLinuxAuthorityPublicationPublisher(ledger)(
      exact.binding,
      context('publish-before-complete-publication-loss')
    );
    fs.rmSync(path.join(root, `${exact.binding.referenceDigest}.entry`), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(root, `${exact.binding.referenceDigest}.publication-head`), {
      force: true,
    });

    expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-missing',
    });

    fs.rmSync(path.join(root, `${exact.binding.referenceDigest}.phase-journal`), {
      force: true,
    });
    expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-missing',
    });
  });

  it('recovers from crashes before the atomic final-entry rename', async () => {
    for (const crashPoint of ['after-temp-entry-mkdir', 'after-temp-file-fsync'] as const) {
      const { root, ledger } = tempLedger();
      const exact = binding();
      const partial = path.join(
        root,
        `.${exact.binding.referenceDigest}.${crashPoint === 'after-temp-entry-mkdir'
          ? '00000000-0000-4000-8000-000000000001'
          : '00000000-0000-4000-8000-000000000002'}.tmp-entry`
      );
      fs.mkdirSync(partial, { mode: 0o700 });
      if (crashPoint === 'after-temp-file-fsync') {
        const fd = fs.openSync(path.join(partial, 'publication.json'), 'wx', 0o600);
        fs.writeFileSync(fd, '{uncommitted');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      }

      expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
        LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
        exact.providerReference
      )).toEqual({
        state: 'authority-uncertain',
        diagnosticCode: 'ledger-missing',
      });
      await createLinuxAuthorityPublicationPublisher(ledger)(
        exact.binding,
        context(`publish-retry-${crashPoint}`)
      );
      expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
        LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
        exact.providerReference
      )).toEqual({ state: 'published-inert' });
      expect(fs.existsSync(partial)).toBe(false);
    }
  });

  it('recovers the same published phase when the owner stops before activation', async () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    await createLinuxAuthorityPublicationPublisher(ledger)(
      exact.binding,
      context('publish-before-owner-exit')
    );

    const replacement = createLinuxAuthorityPublicationLedger({ root });
    expect(replacement.requirePublished(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({ state: 'published-inert' });
  });

  it('rejects structurally forged ledgers and mismatched exact bindings before commit', async () => {
    expect(() => createLinuxAuthorityPublicationPublisher({
      lookup() { return { state: 'published-inert' }; },
    } as never)).toThrow(/provenance|ledger/i);

    const { root, ledger } = tempLedger();
    const exact = binding();
    const publisher = createLinuxAuthorityPublicationPublisher(ledger);
    await expect(publisher({
      ...exact.binding,
      preparationOperationId: 'forged-operation',
    }, context())).rejects.toThrow(/binding|operation/i);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('rejects a symlinked ledger root and uses the internal canonical reference codec', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-ledger-root-'));
    tempRoots.push(parent);
    const target = path.join(parent, 'target');
    const linked = path.join(parent, 'linked');
    fs.mkdirSync(target, { mode: 0o700 });
    fs.symlinkSync(target, linked, 'junction');
    expect(() => createLinuxAuthorityPublicationLedger({ root: linked })).toThrow(
      /provenance|root/i
    );

    const source = fs.readFileSync(
      path.resolve('src/core/session-host/process-authority/linux/publication-ledger.ts'),
      'utf8'
    );
    expect(source).toContain('encodeProcessAuthorityReference');
    expect(source).toContain('decodeProcessAuthorityReferenceForDispatch');
    expect(source).toContain('reencodeProcessAuthorityReference');
    expect(source).not.toContain("'rasen-process-authority/1:'");
  });

  it('pins the exact ledger directory identity and rejects a pathname replacement', () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    const displaced = `${root}.displaced`;
    fs.renameSync(root, displaced);
    fs.mkdirSync(root, { mode: 0o700 });

    expect(ledger.lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-unavailable',
    });
  });

  it('requires an exact private mode for an existing ledger root', () => {
    if (process.platform === 'win32') return;
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-ledger-mode-'));
    tempRoots.push(parent);
    const root = path.join(parent, 'authority-publications');
    fs.mkdirSync(root, { mode: 0o755 });
    expect(() => createLinuxAuthorityPublicationLedger({ root })).toThrow(/mode|ownership/i);
  });

  it('retains canonical conflicting provenance and corrupt records without optimistic publication', async () => {
    const { root, ledger } = tempLedger();
    const exact = binding();
    await createLinuxAuthorityPublicationPublisher(ledger)(exact.binding, context());
    const recordPath = path.join(
      root,
      `${exact.binding.referenceDigest}.entry`,
      'publication.json'
    );
    const original = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
    const preimage = { ...original, generation: 'Q'.repeat(22) };
    delete preimage.integrityDigest;
    const conflicting = {
      ...preimage,
      integrityDigest: createHash('sha256').update(JSON.stringify(preimage)).digest('hex'),
    };
    fs.writeFileSync(recordPath, JSON.stringify(conflicting));
    expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({
      state: 'event-gap',
      diagnosticCode: 'ledger-conflict',
    });

    fs.writeFileSync(recordPath, '{truncated');
    expect(createLinuxAuthorityPublicationLedger({ root }).lookup(
      LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      exact.providerReference
    )).toEqual({
      state: 'authority-uncertain',
      diagnosticCode: 'ledger-malformed',
    });
  });
});
