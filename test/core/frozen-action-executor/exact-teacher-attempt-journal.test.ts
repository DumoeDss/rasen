import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createExactTeacherAttemptJournal,
  type ExactTeacherAttemptJournalRecord,
} from '../../../src/core/frozen-action-executor/exact-teacher-attempt-journal.js';
import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  type ProcessAuthoritySelection,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  createProviderAuthorityReference,
  encodeProcessAuthorityReference,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const roots: string[] = [];

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-exact-teacher-journal-'));
  roots.push(value);
  return value;
}

const provider: ProcessAuthoritySelection = {
  providerId: 'test.exact-teacher',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
};

function processRef(
  selection: ProcessAuthoritySelection = provider,
  privateIdentity = 'teacher-authority-0001'
): string {
  return encodeProcessAuthorityReference(
    {
      ...selection,
      commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
      providerReferenceVersion: 1,
      semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
    },
    createProviderAuthorityReference(1, Buffer.from(privateIdentity))
  );
}

function record(
  overrides: Partial<ExactTeacherAttemptJournalRecord> = {}
): ExactTeacherAttemptJournalRecord {
  return {
    schema: 'rasen-exact-teacher-attempt-journal/1',
    recordVersion: 1,
    revision: 1,
    attemptId: 'teacher-attempt-0001',
    provider,
    processRef: processRef(),
    runId: 'run-0001',
    actionId: 'teacher-action-0001',
    invocationId: 'teacher-invocation-0001',
    attempt: 1,
    stableSessionId: '11111111-1111-4111-8111-111111111111',
    requestId: 'teacher-request-0001',
    hostedReceipt: {
      stableSessionId: '11111111-1111-4111-8111-111111111111',
      requestId: 'teacher-request-0001',
      resultRef: 'sha256:result-object-0001',
      resultDigest: 'a'.repeat(64),
    },
    baselineIdentity: 'manifest:baseline',
    quarantineIdentity: `quarantine:sha256:${'a'.repeat(64)}`,
    phase: 'result-quarantined',
    ...overrides,
  };
}

afterEach(() => {
  for (const value of roots.splice(0)) cleanupTempPath(value);
});

describe('durable exact Teacher attempt journal', () => {
  it('round-trips only bounded opaque authority and identity facts across restart', () => {
    const stateRoot = root();
    const first = createExactTeacherAttemptJournal({ root: stateRoot });
    const created = first.create(record());

    expect(created).toEqual(record());
    const files = fs.readdirSync(stateRoot);
    expect(files).toHaveLength(1);
    const bytes = fs.readFileSync(path.join(stateRoot, files[0]!), 'utf8');
    expect(bytes).toContain('rasen-process-authority/1:');
    expect(bytes).not.toMatch(/\bpid\b|processName|nativeHandle|resultBody/i);

    const restarted = createExactTeacherAttemptJournal({ root: stateRoot });
    expect(restarted.load('teacher-attempt-0001')).toEqual(created);
  });

  it('advances monotonically while keeping every authority identity immutable', () => {
    const journal = createExactTeacherAttemptJournal({ root: root() });
    journal.create(record({
      phase: 'authority-published-inert',
      hostedReceipt: undefined,
      quarantineIdentity: undefined,
    }));
    const activated = journal.advance('teacher-attempt-0001', 1, {
      revision: 2,
      phase: 'activated',
    });
    expect(activated).toMatchObject({ revision: 2, phase: 'activated' });
    expect(activated.processRef).toBe(record().processRef);

    expect(() => journal.advance('teacher-attempt-0001', 2, {
      revision: 3,
      phase: 'request-sent',
      processRef: processRef(provider, 'teacher-authority-0002'),
    })).toThrow(/identity|immutable/i);
    expect(() => journal.advance('teacher-attempt-0001', 2, {
      revision: 3,
      phase: 'canonical-settled',
    })).toThrow(/phase|transition/i);
  });

  it('rejects an opaque ProcessRef whose embedded provider tuple differs', () => {
    const journal = createExactTeacherAttemptJournal({ root: root() });
    expect(() => journal.create(record({
      provider: {
        ...provider,
        providerId: 'test.forged-provider',
      },
    }))).toThrow(/provider|tuple|reference|identity|malformed/i);
  });

  it('binds ProcessRef and hosted receipt only at their ordered phase frontiers', () => {
    const journal = createExactTeacherAttemptJournal({ root: root() });
    expect(() => journal.create(record({
      phase: 'canonical-preflight',
      hostedReceipt: undefined,
      baselineIdentity: undefined,
      quarantineIdentity: undefined,
    }))).toThrow(/phase|process|reference|malformed/i);
    expect(() => journal.create(record({
      phase: 'request-sent',
    }))).toThrow(/phase|receipt|malformed/i);
    expect(() => journal.create(record({
      phase: 'result-quarantined',
      hostedReceipt: undefined,
      quarantineIdentity: undefined,
    }))).toThrow(/phase|receipt|malformed/i);
  });

  it('fails closed on extra authority fields, future phases, and tampered durable bytes', () => {
    const stateRoot = root();
    const journal = createExactTeacherAttemptJournal({ root: stateRoot });
    expect(() => journal.create({
      ...record(),
      pid: 4242,
    } as ExactTeacherAttemptJournalRecord)).toThrow(/keys|field|malformed/i);
    expect(() => journal.create(record({ phase: 'future-authority-phase' as never })))
      .toThrow(/phase|malformed/i);

    journal.create(record());
    const target = path.join(stateRoot, fs.readdirSync(stateRoot)[0]!);
    const persisted = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
    persisted.processName = 'forged-workload.exe';
    fs.writeFileSync(target, `${JSON.stringify(persisted)}\n`, 'utf8');
    expect(() => createExactTeacherAttemptJournal({ root: stateRoot })
      .load('teacher-attempt-0001')).toThrow(/malformed|integrity|keys/i);
  });
});
