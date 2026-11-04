import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { HostedSessionRecord } from '../../../src/core/session-host/contracts.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  isExactScopeEmptyReceipt,
  type AuthorityOperationContext,
  type ExactScopeEmptyReceipt,
  type ProcessAuthorityProvider,
  type ProcessAuthorityProviderDescriptor,
  type ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import { createProviderAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import type { ProcessScope } from '../../../src/core/session-host/process-scope.js';
import {
  createSessionHostRegistry,
  digestSessionHostText,
} from '../../../src/core/session-host/registry.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const roots: string[] = [];

const descriptor: ProcessAuthorityProviderDescriptor = {
  providerId: 'test.exact-teacher-retirement',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
  commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  providerReferenceVersion: 1,
  semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
};

class RetirementProvider implements ProcessAuthorityProvider {
  readonly descriptor = descriptor;
  readonly reference: ProviderAuthorityReference = createProviderAuthorityReference(
    1,
    Buffer.from('exact-teacher-retirement')
  );

  async prepare() {
    return {
      reference: this.reference,
      async activate(_context: AuthorityOperationContext) {
        return { state: 'live' as const };
      },
    };
  }

  async inspect() { return { state: 'live' as const }; }
  async terminate() { return { state: 'exact-scope-empty' as const }; }
  async abort() { return { state: 'exact-scope-empty' as const }; }
}

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-exact-teacher-retirement-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

async function authenticatedReceipt(): Promise<ExactScopeEmptyReceipt> {
  const provider = new RetirementProvider();
  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry: createTestProcessAuthorityProviderRegistry([provider]),
    operationId: () => `teacher-retirement-${++operation}`,
  });
  const prepared = await coordinator.prepare(descriptor, {
    command: process.execPath,
    args: [],
    cwd: process.cwd(),
    env: {},
  });
  if (prepared.state !== 'prepared-inert') throw new Error('fixture prepare failed');
  const published = await prepared.publish(async (binding) =>
    createProcessAuthorityPublicationAcknowledgement(binding));
  if (published.state !== 'published-inert') throw new Error('fixture publish failed');
  const receipt = await published.abort('fixture-retirement');
  if (!isExactScopeEmptyReceipt(receipt)) throw new Error('fixture receipt was not authentic');
  return receipt;
}

function record(cwd: string, receipt: ExactScopeEmptyReceipt): HostedSessionRecord {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const requestId = '22222222-2222-4222-8222-222222222222';
  const now = '2026-08-10T00:00:00.000Z';
  return {
    sessionId,
    backend: 'replay',
    cwd,
    cwdDigest: digestSessionHostText(cwd),
    hostState: 'idle',
    generation: 1,
    createdAt: now,
    updatedAt: now,
    requests: [{
      requestId,
      inputDigest: 'a'.repeat(64),
      generation: 1,
      state: 'prepared',
      preparedAt: now,
    }],
    process: {
      generation: 1,
      ownerToken: 'exact-teacher-owner',
      runtimeRef: String(receipt.reference),
      preparedAt: now,
    },
    exactTeacherAttempt: {
      schema: 'rasen-exact-teacher-session-attempt/1',
      recordVersion: 1,
      attemptId: 'attempt:teacher-retirement',
      provider: {
        providerId: descriptor.providerId,
        capabilityId: descriptor.capabilityId,
        protocolVersion: descriptor.protocolVersion,
      },
      processRef: String(receipt.reference),
      runId: 'run:teacher-retirement',
      actionId: 'action:teacher-retirement',
      invocationId: 'invocation:teacher-retirement',
      attempt: 1,
      stableSessionId: sessionId,
      requestId,
      journalRevision: 3,
      phase: 'authority-prepared-inert',
      baselineIdentity: 'manifest:baseline',
    },
  };
}

async function hostFixture(exactScopeEmptyReceipt: ExactScopeEmptyReceipt) {
  const root = temporaryRoot();
  const cwd = path.join(root, 'checkout');
  fs.mkdirSync(cwd);
  const canonicalCwd = fs.realpathSync.native(cwd);
  const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
  const processScope: ProcessScope = {
    async prepare() { throw new Error('not used'); },
    async inspect() {
      return { state: 'closed', controllable: false, exactScopeEmptyReceipt };
    },
    async terminate() { throw new Error('not used'); },
  };
  const host = createSessionHost({
    registry,
    backends: [],
    processScope,
    exactRetirementAuthority: 'coordinator-authenticated',
  });
  await host.reconcileOnStart();
  const session = record(canonicalCwd, exactScopeEmptyReceipt);
  await registry.create(session);
  return { host, registry, session };
}

describe('exact Teacher SessionHost retirement authority', () => {
  it('releases only with the coordinator-authenticated receipt for the persisted ProcessRef', async () => {
    const receipt = await authenticatedReceipt();
    const { host, registry, session } = await hostFixture(receipt);

    const outcome = await host.dispatch({
      op: 'retire',
      sessionId: session.sessionId,
      reason: 'exact-teacher-settled',
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.exactScopeEmptyReceipt).toBe(receipt);
    expect(registry.get(session.sessionId)).toMatchObject({
      hostState: 'retired',
      process: undefined,
    });
  });

  it('retains authority when a structurally identical receipt was not minted by the coordinator', async () => {
    const receipt = await authenticatedReceipt();
    const forged = Object.freeze({ ...receipt }) as ExactScopeEmptyReceipt;
    const { host, registry, session } = await hostFixture(forged);

    const outcome = await host.dispatch({
      op: 'retire',
      sessionId: session.sessionId,
      reason: 'forged-retirement',
    });

    expect(outcome).toMatchObject({ ok: false, code: 'session-busy' });
    expect(registry.get(session.sessionId)?.process?.runtimeRef)
      .toBe(String(receipt.reference));
  });
});
