import { describe, expect, it } from 'vitest';

import {
  CompletionError,
  computeCompletionReceiptDigest,
  verifyCompletion,
} from '../../../src/core/change-run/internal/completion.js';
import { buildAgentAction } from '../../../src/core/change-run/internal/actions.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import type {
  CompleteRunAction,
  Digest,
  EvidenceRef,
  JsonValue,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const digest = (c: string) => branded<Digest>(`sha256:${c.repeat(64)}`);

function action() {
  return buildAgentAction(
    {
      capability: {
        nodeId: 'stage:apply',
        authoredCapability: { id: 'skill:a', version: 'legacy' },
        contract: { id: 'apply', version: '1', digest: digest('1') },
        actionKind: 'agent',
        resultContract: { id: 'r', version: '1', digest: digest('2') },
        evidenceContract: { id: 'e', version: '1', digest: digest('3') },
        recovery: 'suspend-if-ambiguous',
        workspace: { access: 'write', resources: ['worktree'] },
        effects: [
          { slot: 'workspace', kind: 'workspace', resource: 'worktree', recovery: 'suspend-if-ambiguous' },
        ],
        adapter: { id: 'adapter:a', version: '1', contentDigest: digest('4') },
      } as never,
      stage: {
        nodeId: 'stage:apply',
        role: 'implementer',
        model: 'sonnet',
        effort: 'medium',
        runtime: 'codex',
        sandbox: 'workspace-write',
        gate: false,
        sessionReuse: 'never',
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
        provenance: {
          role: 'stage', model: 'default', effort: 'default', runtime: 'stage',
          sandbox: 'stage', gate: 'stage', sessionReuse: 'default',
          handoffTokenLimit: 'default', reuseRoundLimit: 'default',
        },
      } as never,
      executionProfileDigest: digest('5'),
      policyDigest: digest('6'),
    },
    {
      runId: branded(`run:${'a'.repeat(64)}`),
      nodeId: branded(`node:${'a'.repeat(60)}aaaa`),
      occurrence: 0,
      attemptOrdinal: 0,
      expectedBeforeWorkspace: {
        format: 'workspace-revision/1',
        head: { kind: 'commit', digest: digest('c'), detached: false },
        treeDigest: digest('c'),
        dirtyWorktreeDigest: digest('c'),
      },
    },
    { input: {} as JsonValue }
  );
}

function actor() {
  return buildAgentActor({
    role: 'implementer',
    provider: 'anthropic',
    runtime: 'claude',
    principalIdentityDigest: digest('b'),
    sessionIdentityDigest: digest('c'),
    adapter: { id: 'adapter:a', version: '1', artifactDigest: digest('a') },
  });
}

function evidence(actionId: string): EvidenceRef {
  return {
    format: 'change-run-evidence-ref/1',
    store: 'change-run',
    evidenceDigest: digest('e'),
    contentDigest: digest('e'),
    mediaType: 'application/json',
    size: 4,
    observationKind: 'completion-test',
    producer: { id: 'fixture', version: '1', identityDigest: digest('e') },
    binding: {
      planningSpaceId: branded('planning-space:' + '1'.repeat(64)),
      changeInstanceId: branded('change-instance:' + '2'.repeat(64)),
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      runId: branded(`run:${'a'.repeat(64)}`),
      actionId: branded(actionId),
      schema: 'fixture/1',
    },
  } as EvidenceRef;
}

function domainCompletion(
  status: 'succeeded' | 'failed' | 'blocked',
  result: JsonValue,
  receiptOverride?: Digest
): CompleteRunAction {
  const a = action();
  const base = {
    format: 'change-run-completion/1' as const,
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    runId: a.runId,
    actionId: a.actionId,
    invocationId: a.invocationId,
    actor: actor(),
    actorAttestation: evidence(a.actionId),
    evidence: [evidence(a.actionId)],
    kind: 'domain-action-result' as const,
    status,
    result,
  };
  const receipt = receiptOverride ?? computeCompletionReceiptDigest(base as CompleteRunAction);
  return { ...base, receiptDigest: receipt } as CompleteRunAction;
}

describe('completion receipt + binding (6.7/6.8)', () => {
  it('computes a deterministic canonical receipt digest from the payload', () => {
    const c1 = domainCompletion('succeeded', { ok: true });
    const c2 = domainCompletion('succeeded', { ok: true });
    expect(c1.receiptDigest).toBe(c2.receiptDigest);
    expect(c1.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Different payload -> different receipt.
    const different = domainCompletion('succeeded', { ok: false });
    expect(different.receiptDigest).not.toBe(c1.receiptDigest);
  });

  it('verifies a completion that binds to its exact action and carries a matching receipt', () => {
    const a = action();
    const completion = domainCompletion('succeeded', { ok: true });
    expect(() => verifyCompletion(completion, a)).not.toThrow();
  });

  it('rejects a completion whose receiptDigest does not match its payload (anti-tamper)', () => {
    const a = action();
    const tampered = domainCompletion('succeeded', { ok: true }, digest('z'));
    expect(() => verifyCompletion(tampered, a)).toThrowError(CompletionError);
  });

  it('rejects a completion that does not bind to the action (wrong actionId/invocationId/runId)', () => {
    const a = action();
    const completion = domainCompletion('succeeded', { ok: true });
    const wrong = { ...a, actionId: branded(`action:${'f'.repeat(60)}ffff`) };
    expect(() => verifyCompletion(completion, wrong as never)).toThrowError(
      CompletionError
    );
  });

  it('distinguishes the three completion variants in the receipt digest', () => {
    const domain = domainCompletion('succeeded', { ok: true }).receiptDigest;
    const a = action();
    const effectBase = {
      format: 'change-run-completion/1' as const,
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: a.runId,
      actionId: a.actionId,
      invocationId: a.invocationId,
      actor: actor(),
      actorAttestation: evidence(a.actionId),
      evidence: [evidence(a.actionId)],
      kind: 'effect-observation' as const,
      effectId: a.effects[0]!.effectId,
      status: 'succeeded' as const,
      observation: { ok: true } as JsonValue,
    };
    const effectReceipt = computeCompletionReceiptDigest(effectBase as CompleteRunAction);
    expect(effectReceipt).not.toBe(domain);
    expect(effectReceipt).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
