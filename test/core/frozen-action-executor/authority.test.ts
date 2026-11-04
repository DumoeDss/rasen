import { describe, expect, it } from 'vitest';

import { validateGrantedAction } from '../../../src/core/frozen-action-executor/authority.js';
import type {
  CanonicalRunRecord,
  CommittedAction,
} from '../../../src/core/change-run/internal/record.js';
import {
  decodeRunAction,
  type ExactChangeRunRef,
  type RunAction,
} from '../../../src/core/change-run/contracts.js';
import {
  makeRecordAction,
  recordIds,
  recordRevision,
} from '../change-run/record-fixture.js';

const branded = <T>(value: string): T => value as T;

function grantedCommitted(overrides: Partial<CommittedAction> = {}): CommittedAction {
  return {
    action: makeRecordAction(),
    attemptOrdinal: 0,
    deliveryState: 'granted',
    state: 'active',
    effects: [],
    ...overrides,
  } as CommittedAction;
}

function recordWith(
  committed: CommittedAction,
  recordVersion = 3
): CanonicalRunRecord {
  return {
    runId: recordIds.runId,
    change: {
      planningSpaceId: recordIds.planningSpaceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: recordIds.changeInstanceId,
    },
    workspaceInstanceId: recordIds.workspaceInstanceId,
    recordVersion: branded(recordVersion),
    actions: { [committed.action.actionId]: committed },
  } as unknown as CanonicalRunRecord;
}

const runRef: ExactChangeRunRef = {
  change: { projectRoot: '/root', changeId: 'fixture-change' },
  runId: recordIds.runId,
};

function routedAuthorityAction(): RunAction {
  const action = makeRecordAction();
  if (action.kind !== 'agent') throw new Error('expected agent Action');
  return decodeRunAction({
    ...action,
    agent: {
      ...action.agent,
      workerContract: 'leaf',
      inference: {
        broker: 'omnicross',
        runtime: 'codex',
        upstream: { kind: 'provider', providerId: 'deepseek-api' },
        model: action.agent.model,
        connection: {
          endpoint: 'http://127.0.0.1:8765',
          controlTokenEnv: 'TEST_OMNICROSS_ADMIN',
          requestTimeoutMs: 1_000,
          leaseTtlSeconds: 60,
          configRevision: recordIds.digest,
        },
      },
    },
  });
}

function withPathMutation(
  source: unknown,
  path: readonly string[],
  replacement: unknown
): unknown {
  const candidate: unknown = structuredClone(source);
  let cursor = candidate;
  for (const segment of path.slice(0, -1)) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
      throw new Error(`Mutation path ${path.join('.')} is not an object path.`);
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new Error(`Mutation path ${path.join('.')} has no object parent.`);
  }
  (cursor as Record<string, unknown>)[path.at(-1)!] = replacement;
  return candidate;
}

const AGENT_EXECUTION_MUTATIONS = [
  ['role', ['agent', 'role'], 'reviewer'],
  ['model', ['agent', 'model'], 'retargeted-model'],
  ['reasoningEffort', ['agent', 'reasoningEffort'], 'low'],
  ['runtime', ['agent', 'runtime'], 'claude'],
  ['sandbox', ['agent', 'sandbox'], 'read-only'],
  ['workerContract', ['agent', 'workerContract'], 'evaluate'],
  ['inference upstream', ['agent', 'inference', 'upstream', 'providerId'], 'other-provider'],
  ['inference model', ['agent', 'inference', 'model'], 'other-route-model'],
  ['inference endpoint', ['agent', 'inference', 'connection', 'endpoint'], 'http://127.0.0.1:9876'],
  ['inference control-token identity', ['agent', 'inference', 'connection', 'controlTokenEnv'], 'OTHER_ADMIN'],
  ['inference timeout', ['agent', 'inference', 'connection', 'requestTimeoutMs'], 2_000],
  ['inference lease TTL', ['agent', 'inference', 'connection', 'leaseTtlSeconds'], 120],
  ['inference config revision', ['agent', 'inference', 'connection', 'configRevision'], `sha256:${'c'.repeat(64)}`],
  ['input', ['agent', 'input'], { change: 'retargeted-change' }],
  ['session reuse', ['agent', 'session', 'reuse'], 'same-invocation'],
  ['session authored scope', ['agent', 'session', 'sessionReuseAuthored'], 'stage'],
  ['session handoff limit', ['agent', 'session', 'handoffTokenLimit'], 20_000],
  ['session round limit', ['agent', 'session', 'reuseRoundLimit'], 2],
] as const;

describe('granted-Action dispatch - authority validation against the Record', () => {
  it('dispatches a granted Action with every field validated against the Record', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('dispatched');
    if (result.kind === 'dispatched') {
      expect(result.recordVersion).toBe(3);
      expect(result.action.actionId).toBe(committed.action.actionId);
    }
  });
});

describe('the four illegal-dispatch cases fail closed with typed outcomes', () => {
  it('a stale Record version returns record_version_conflict and executes no backend work', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed, 3);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 2,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('record_version_conflict');
    }
  });

  it('a wrong workspace returns workspace-scope-mismatch before any backend process receives input', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const wrongWorkspace = {
      ...recordRevision,
      treeDigest: branded(`sha256:${'c'.repeat(64)}`),
    };
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: wrongWorkspace,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('workspace-scope-mismatch');
    }
  });

  it('a not-currently-executable Action (deliveryState closed) is rejected', () => {
    const committed = grantedCommitted({ deliveryState: 'closed', state: 'closed' });
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('not-currently-executable');
    }
  });

  it('a duplicate dispatch of a settled Action returns the recorded state without resend', () => {
    const committed = grantedCommitted({
      result: {
        status: 'succeeded',
        result: { ok: true },
        receiptDigest: branded(`sha256:${'d'.repeat(64)}`),
        actor: undefined as never,
        actorAttestation: undefined as never,
        evidence: [],
      },
    });
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('duplicate');
    if (result.kind === 'duplicate') {
      expect(result.reason).toBe('settled');
    }
  });

  it('a duplicate in-flight dispatch returns the in-flight state without resend', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      inFlight: new Set([committed.action.actionId]),
    });
    expect(result.kind).toBe('duplicate');
    if (result.kind === 'duplicate') {
      expect(result.reason).toBe('in-flight');
    }
  });

  it('a Run mismatch is rejected before any authority check', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef: {
        change: { projectRoot: '/root', changeId: 'other-change' },
        runId: recordIds.runId,
      },
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('run-mismatch');
    }
  });

  it('a granted ActionView whose authority differs from the Record is a receipt_conflict', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    // Rebuild the capability authority from a caller-supplied source (a
    // different contract digest) — exactly what the source-scan guard forbids.
    const rebuilt = makeRecordAction({
      capability: {
        ...makeRecordAction().capability,
        contractDigest: branded(`sha256:${'e'.repeat(64)}`),
      },
    });
    const result = validateGrantedAction({
      runRef,
      grantedAction: rebuilt,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('receipt_conflict');
    }
  });
});

describe('per-field completion-binding mismatch (task 5.4)', () => {
  // Each binding field is checked independently: mismatching exactly one field
  // fails closed with a typed outcome. These per-field tests are the
  // discrimination targets for the per-field mutation receipts (task 5.4 /
  // evidence/mutation-receipts.md receipt 9): mutating one field's comparison
  // in sameActionIdentity/sameAuthority makes exactly its test go RED.
  function validateWith(overrides: Partial<ReturnType<typeof makeRecordAction>>) {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    return validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(overrides),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
  }

  it('an actionId not admitted in the Record fails closed not-currently-executable (the actionId binding)', () => {
    // The actionId is bound by admission: a granted actionId that is not a key
    // in record.actions is not admitted, so the dispatch fails closed before
    // the identity check. (The other identity fields are bound by
    // sameActionIdentity -> receipt_conflict, covered below.)
    const result = validateWith({ actionId: branded(`action:${'b'.repeat(58)}bb`) });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.code).toBe('not-currently-executable');
  });

  it('an invocationId mismatch fails closed receipt_conflict', () => {
    const result = validateWith({ invocationId: branded(`invocation:${'b'.repeat(53)}bbb`) });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.code).toBe('receipt_conflict');
  });

  it('a runId mismatch fails closed receipt_conflict', () => {
    const result = validateWith({ runId: branded(`run:${'b'.repeat(64)}`) });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.code).toBe('receipt_conflict');
  });

  it('an expectedBeforeWorkspace (workspace-revision) mismatch fails closed receipt_conflict', () => {
    // The frozen workspace expectation on the granted ActionView must match the
    // committed Action's. (The executor's actual cwd vs the granted expectation
    // is the separate workspace-scope-mismatch check tested above.)
    const wrongRevision = {
      ...recordRevision,
      treeDigest: branded(`sha256:${'f'.repeat(64)}`),
    };
    const result = validateWith({ expectedBeforeWorkspace: wrongRevision });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.code).toBe('receipt_conflict');
  });

  it('a capability contractDigest mismatch fails closed receipt_conflict', () => {
    const base = makeRecordAction();
    const result = validateWith({
      capability: {
        ...base.capability,
        contractDigest: branded(`sha256:${'e'.repeat(64)}`),
      },
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.code).toBe('receipt_conflict');
  });

  it('a policyDigest mismatch fails closed receipt_conflict', () => {
    const result = validateWith({ policyDigest: branded(`sha256:${'d'.repeat(64)}`) });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.code).toBe('receipt_conflict');
  });

  it('a worker-contract mismatch fails closed receipt_conflict', () => {
    const committedAction = makeRecordAction();
    if (committedAction.kind !== 'agent') throw new Error('expected agent Action');
    const leafAction: RunAction = {
      ...committedAction,
      agent: { ...committedAction.agent, workerContract: 'leaf' },
    };
    const committed = grantedCommitted({ action: leafAction });
    const record = recordWith(committed);
    const granted: RunAction = {
      ...committedAction,
      agent: { ...committedAction.agent, workerContract: 'evaluate' },
    };
    const result = validateGrantedAction({
      runRef,
      grantedAction: granted,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') expect(result.code).toBe('receipt_conflict');
  });

  it.each(AGENT_EXECUTION_MUTATIONS)(
    'rejects an independently mutated %s field under complete Action authority',
    (_name, path, replacement) => {
      const committedAction = routedAuthorityAction();
      const grantedAction = decodeRunAction(
        withPathMutation(committedAction, path, replacement)
      );
      const result = validateGrantedAction({
        runRef,
        grantedAction,
        record: recordWith(grantedCommitted({ action: committedAction })),
        expectedRecordVersion: 3,
        workspaceRevision: recordRevision,
      });
      expect(result).toMatchObject({ kind: 'rejected', code: 'receipt_conflict' });
    }
  );

  it('returns the Record-owned Action object after complete canonical equality', () => {
    const committedAction = routedAuthorityAction();
    const receiptCopy = decodeRunAction(structuredClone(committedAction));
    const result = validateGrantedAction({
      runRef,
      grantedAction: receiptCopy,
      record: recordWith(grantedCommitted({ action: committedAction })),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('dispatched');
    if (result.kind === 'dispatched') {
      expect(result.action).toBe(committedAction);
      expect(result.action).not.toBe(receiptCopy);
    }
  });
});

describe('authority is rebuilt from no non-granted source (source-scan property)', () => {
  it('the validator accepts no chat / Definition / caller-authority parameter', () => {
    // The function signature is the guard: validateGrantedAction takes only the
    // granted ActionView, the committed Record, the expected version, the
    // workspace revision, and the in-flight ledger. There is no parameter for
    // chat history, the live Definition, or caller self-report, so authority
    // cannot be rebuilt from them. This test exists so a mutation that adds
    // such a parameter and reads it fails this contract.
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('dispatched');
  });
});
