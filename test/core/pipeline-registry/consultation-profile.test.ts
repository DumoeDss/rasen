import { describe, expect, it } from 'vitest';

import { TEST_ATTESTATION_AUTHORITY } from '../../fixtures/trusted-completion.js';
import {
  createRuntimeExecutionProfile,
  openRuntimeExecutionProfile,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';

const DIGEST = (char: string) => `sha256:${char.repeat(64)}` as const;

function capability(nodeId: string, access: 'none' | 'read' | 'write', effects: boolean) {
  return {
    nodeId,
    authoredCapability: { id: `skill:${nodeId}`, version: '1' },
    contract: { id: nodeId, version: '1', digest: DIGEST('3') },
    actionKind: 'agent' as const,
    resultContract: { id: `${nodeId}-result`, version: '1', digest: DIGEST('4') },
    evidenceContract: { id: `${nodeId}-evidence`, version: '1', digest: DIGEST('5') },
    recovery: 'suspend-if-ambiguous' as const,
    workspace: { access, resources: access === 'none' ? [] : ['worktree'] },
    effects: effects
      ? [{ slot: 'workspace', kind: 'workspace' as const, resource: 'worktree', recovery: 'suspend-if-ambiguous' as const }]
      : [],
    adapter: {
      id: `adapter:${nodeId}`,
      version: '1',
      contentDigest: DIGEST('6'),
      attestationAuthority: TEST_ATTESTATION_AUTHORITY,
    },
  };
}

function stage(nodeId: string, sandbox: 'read-only' | 'workspace-write') {
  return {
    nodeId,
    role: nodeId === 'teacher' ? 'teacher' : 'implementer',
    model: 'default',
    effort: 'high',
    runtime: 'codex',
    sandbox,
    gate: false,
    sessionReuse: 'same-invocation' as const,
    handoffTokenLimit: 0,
    reuseRoundLimit: 0,
    provenance: {
      role: 'fixture', model: 'fixture', effort: 'fixture', runtime: 'fixture',
      sandbox: 'fixture', gate: 'fixture', sessionReuse: 'fixture',
      handoffTokenLimit: 'fixture', reuseRoundLimit: 'fixture',
    },
  };
}

function input() {
  return {
    sourceRevision: {
      layer: 'package' as const,
      kind: 'pipeline-yaml' as const,
      sourceId: 'package:fixture',
      authoredContentDigest: DIGEST('1'),
      semanticDigest: DIGEST('2'),
    },
    capabilities: [
      capability('source', 'write', true),
      capability('teacher', 'read', false),
    ],
    policy: {
      format: 'effective-run-policy/1' as const,
      maxAttempts: 8,
      maxActions: 8,
      stages: [stage('source', 'workspace-write'), stage('teacher', 'read-only')],
    },
  };
}

const binding = {
  sourceProfilePath: 'source',
  teacherProfilePath: 'teacher',
  maxConsultationsPerInvocation: 3,
  maxTeacherAttemptsPerConsultation: 2,
  limits: {
    maxQuestionBytes: 4096,
    maxAdviceBytes: 8192,
    maxAttemptedApproaches: 8,
    maxConstraints: 8,
    maxEvidencePointers: 8,
    maxAdviceSteps: 16,
    maxCautions: 8,
    maxEvidenceNotes: 8,
  },
} as const;

describe('frozen consultation execution profile binding', () => {
  it('preserves legacy shape and digest when the optional binding is absent', () => {
    const legacy = createRuntimeExecutionProfile(input());
    expect('consultations' in legacy).toBe(false);
    expect(openRuntimeExecutionProfile(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
    expect(createRuntimeExecutionProfile(input()).profileDigest).toBe(legacy.profileDigest);
  });

  it('opens a valid exact read-only Teacher binding', () => {
    const profile = createRuntimeExecutionProfile({ ...input(), consultations: [binding] });
    expect(profile.consultations).toEqual([binding]);
    expect(openRuntimeExecutionProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });

  it.each([
    ['write workspace access', capability('teacher', 'write', false), stage('teacher', 'read-only')],
    ['workspace-write sandbox', capability('teacher', 'read', false), stage('teacher', 'workspace-write')],
    ['declared effects', capability('teacher', 'read', true), stage('teacher', 'read-only')],
  ])('rejects a Teacher with %s before execution', (_label, teacher, teacherStage) => {
    const base = input();
    expect(() =>
      createRuntimeExecutionProfile({
        ...base,
        capabilities: [base.capabilities[0], teacher],
        policy: { ...base.policy, stages: [base.policy.stages[0], teacherStage] },
        consultations: [binding],
      })
    ).toThrow(/effect-free read-only agent/i);
  });

  it('rejects duplicate source bindings and non-positive limits', () => {
    expect(() =>
      createRuntimeExecutionProfile({ ...input(), consultations: [binding, binding] })
    ).toThrow(/bound more than once/i);
    expect(() =>
      createRuntimeExecutionProfile({
        ...input(),
        consultations: [{ ...binding, maxConsultationsPerInvocation: 0 }],
      })
    ).toThrow();
  });
});
