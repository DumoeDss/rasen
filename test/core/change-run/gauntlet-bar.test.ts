import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertGauntletBarInspectable,
  CodeRunnableBarAdapter,
  decodeGauntletInput,
  gauntletContractDigest,
  GAUNTLET_COMPARISON_EVIDENCE_SCHEMA,
  GauntletDomainError,
  referenceBarDigest,
  validateGauntletJudgment,
  type BarAdapter,
  type CodeInspectorPlumbing,
  type GauntletInput,
  type InspectionResult,
} from '../../../src/core/change-run/internal/gauntlet-bar.js';
import { buildEvidenceRef } from '../../../src/core/change-run/internal/evidence.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import { digestLaunchIntent } from '../../../src/core/change-run/internal/identity.js';
import {
  applyGoalCycleEvent,
  decodeGoalCycleResult,
  initialGoalCycleState,
  type GoalCycleEvent,
} from '../../../src/core/change-run/internal/goal-cycle.js';
import type {
  ActionId,
  ChangeInstanceId,
  Digest,
  EvidenceRef,
  PlanningSpaceId,
  RunId,
} from '../../../src/core/change-run/contracts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const projectRoot = path.resolve('temporary gauntlet workspace');

function asDigest(hex: string): Digest {
  return `sha256:${hex.padStart(64, '0')}` as Digest;
}

function validBar() {
  return {
    format: 'gauntlet-reference-bar/1' as const,
    domain: 'code/runnable',
    referenceTargets: ['reference/exemplar.ts'],
    comparisonAxis: 'observable-behavior/output',
  };
}

function validInput(): GauntletInput {
  return decodeGauntletInput(
    {
      format: 'gauntlet-loop-input/1',
      goal: 'Build a playable maze game.',
      artifactTargets: ['src/game.ts'],
      bar: validBar(),
      constraints: ['Do not change the public command tree.'],
    },
    {}
  );
}

function makeEvidence(opts?: {
  readonly content?: string;
  readonly actionId?: string;
  readonly schema?: string;
}): EvidenceRef {
  const content = opts?.content ?? 'gauntlet comparison evidence';
  return buildEvidenceRef({
    content: new TextEncoder().encode(content),
    mediaType: 'text/plain',
    observationKind: 'gauntlet-comparison',
    producer: {
      id: 'test-critic',
      version: '1.0.0',
      identityDigest: asDigest('aaaa'),
    },
    binding: {
      planningSpaceId:
        'planning-space:' + 'b'.repeat(64) as PlanningSpaceId,
      changeInstanceId:
        'change-instance:' + 'c'.repeat(64) as ChangeInstanceId,
      projectId: 'test-project',
      changeId: 'test-change',
      runId: 'run:' + 'd'.repeat(64) as RunId,
      actionId: (opts?.actionId ?? 'action:' + 'e'.repeat(64)) as ActionId,
      schema: opts?.schema ?? GAUNTLET_COMPARISON_EVIDENCE_SCHEMA,
    },
  });
}

/** Synthetic plumbing that returns predetermined content for targets. */
function syntheticPlumbing(
  files: Readonly<Record<string, string>>,
  outputs?: Readonly<Record<string, { stdout: string; stderr: string; exitCode: number }>>
): CodeInspectorPlumbing {
  return {
    readTarget(target: string): string | null {
      return files[target] ?? null;
    },
    runTarget(target: string) {
      return outputs?.[target] ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// 1.1 — BarAdapter interface, reference-bar record, gauntlet error codes
// ---------------------------------------------------------------------------

describe('gauntlet-bar input contract', () => {
  it('decodes and freezes a valid gauntlet-loop-input/1', () => {
    const contract = validInput();
    expect(contract.format).toBe('gauntlet-loop-input/1');
    expect(contract.goal).toBe('Build a playable maze game.');
    expect(contract.artifactTargets).toEqual(['src/game.ts']);
    expect(contract.bar.domain).toBe('code/runnable');
    expect(contract.bar.referenceTargets).toEqual(['reference/exemplar.ts']);
    expect(contract.bar.comparisonAxis).toBe('observable-behavior/output');
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.bar)).toBe(true);
    expect(Object.isFrozen(contract.bar.referenceTargets)).toBe(true);
  });

  it('throws gauntlet_input_missing when input is absent', () => {
    expect(() => decodeGauntletInput(undefined, {})).toThrow(
      GauntletDomainError
    );
    expect(() => decodeGauntletInput(undefined, {})).toThrow(
      /required before work/
    );
  });

  it.each([
    ['bad format', { format: 'wrong', goal: 'x', artifactTargets: ['a'], bar: validBar(), constraints: [] }],
    ['empty goal', { format: 'gauntlet-loop-input/1', goal: '', artifactTargets: ['a'], bar: validBar(), constraints: [] }],
    ['empty artifactTargets', { format: 'gauntlet-loop-input/1', goal: 'x', artifactTargets: [], bar: validBar(), constraints: [] }],
  ] as const)('throws gauntlet_input_invalid for %s', (_label, input) => {
    expect(() => decodeGauntletInput(input, {})).toThrow(
      GauntletDomainError
    );
  });

  it('throws gauntlet_input_invalid when referenceTargets is empty (schema-enforced)', () => {
    const bar = { ...validBar(), referenceTargets: [] };
    expect(() =>
      decodeGauntletInput(
        {
          format: 'gauntlet-loop-input/1',
          goal: 'x',
          artifactTargets: ['src/a.ts'],
          bar,
          constraints: [],
        },
        {}
      )
    ).toThrow(GauntletDomainError);
  });

  it('throws gauntlet_subjective_bar_rejected for subjective comparison axis', () => {
    const bar = { ...validBar(), comparisonAxis: 'clean code' };
    expect(() =>
      decodeGauntletInput(
        {
          format: 'gauntlet-loop-input/1',
          goal: 'x',
          artifactTargets: ['src/a.ts'],
          bar,
          constraints: [],
        },
        {}
      )
    ).toThrow(/subjective/);
  });

  it('rejects spec workflow fields (strictObject)', () => {
    expect(() =>
      decodeGauntletInput(
        {
          format: 'gauntlet-loop-input/1',
          goal: 'x',
          artifactTargets: ['src/a.ts'],
          bar: validBar(),
          constraints: [],
          proposal: 'should not be here',
          design: 'should not be here',
          specs: {},
          tasks: [],
        },
        {}
      )
    ).toThrow(GauntletDomainError);
  });
});

describe('gauntlet reference bar digest', () => {
  it('is deterministic for the same bar', () => {
    const bar = validBar();
    expect(referenceBarDigest(bar)).toBe(referenceBarDigest(bar));
  });

  it('differs for different reference targets', () => {
    const bar1 = validBar();
    const bar2 = { ...validBar(), referenceTargets: ['reference/other.ts'] };
    expect(referenceBarDigest(bar1)).not.toBe(referenceBarDigest(bar2));
  });

  it('differs for different comparison axes', () => {
    const bar1 = validBar();
    const bar2 = { ...validBar(), comparisonAxis: 'structural-completeness' };
    expect(referenceBarDigest(bar1)).not.toBe(referenceBarDigest(bar2));
  });
});

describe('gauntlet contract digest', () => {
  it('is deterministic for the same input', () => {
    const input = validInput();
    expect(gauntletContractDigest(input)).toBe(
      gauntletContractDigest(input)
    );
  });

  it('differs when goal changes', () => {
    const input1 = validInput();
    const input2 = decodeGauntletInput(
      { ...input1, goal: 'Build a platformer game.' },
      {}
    );
    expect(gauntletContractDigest(input1)).not.toBe(
      gauntletContractDigest(input2)
    );
  });

  it('differs when reference target changes', () => {
    const input1 = validInput();
    const input2 = decodeGauntletInput(
      {
        ...input1,
        bar: { ...validBar(), referenceTargets: ['reference/other.ts'] },
      },
      {}
    );
    expect(gauntletContractDigest(input1)).not.toBe(
      gauntletContractDigest(input2)
    );
  });
});

// ---------------------------------------------------------------------------
// 1.2 — Blind A/B judge contract + satisfaction source distinction
// ---------------------------------------------------------------------------

describe('gauntlet judge contract', () => {
  const contract = validInput();
  const targetRef = contract.artifactTargets[0]!;
  const evidenceContent = 'candidate output matches reference behavior';
  const evidence = makeEvidence({ content: evidenceContent });
  const evidenceDigest = evidence.evidenceDigest;

  function judgment(overrides?: Partial<Record<string, unknown>>): unknown {
    return {
      contract: 'goal-cycle/evaluate-judge/1',
      satisfied: false,
      verdict: 'reference',
      biggestGap: 'Candidate lacks maze rendering compared to reference.',
      gaps: ['Candidate lacks maze rendering compared to reference.'],
      criteria: [
        {
          id: 'blind-ab',
          satisfied: false,
          evidence: `Comparison on ${targetRef}: candidate output does not match reference behavior.`,
          evidenceDigests: [evidenceDigest],
        },
      ],
      ...overrides,
    };
  }

  function validate(result: unknown, opts?: {
    readonly priorCritics?: readonly string[];
    readonly criticSession?: string;
    readonly rawEvidence?: readonly EvidenceRef[];
  }) {
    return validateGauntletJudgment({
      contract,
      result,
      rawEvidence: opts?.rawEvidence ?? [evidence],
      criticSessionIdentity: opts?.criticSession ?? 'critic-session-1',
      priorCriticSessionIdentities: opts?.priorCritics ?? [],
    });
  }

  it('accepts an unsatisfied blind-A/B judgment (bar not reached)', () => {
    const result = validate(judgment());
    expect(result.satisfied).toBe(false);
    expect(result.verdict).toBe('reference');
    expect(result.satisfactionSource).toBeUndefined();
    expect(result.biggestGap).toBe(
      'Candidate lacks maze rendering compared to reference.'
    );
    expect(result.gaps).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('accepts a bar-reached satisfied judgment (verdict candidate)', () => {
    const result = validate(
      judgment({
        satisfied: true,
        satisfactionSource: 'bar-reached',
        verdict: 'candidate',
        biggestGap: undefined,
        gaps: [],
        criteria: [
          {
            id: 'blind-ab',
            satisfied: true,
            evidence: `Candidate matches reference on ${targetRef}.`,
            evidenceDigests: [evidenceDigest],
          },
        ],
      })
    );
    expect(result.satisfied).toBe(true);
    expect(result.satisfactionSource).toBe('bar-reached');
    expect(result.verdict).toBe('candidate');
  });

  it('accepts a bar-reached satisfied judgment (verdict tie)', () => {
    const result = validate(
      judgment({
        satisfied: true,
        satisfactionSource: 'bar-reached',
        verdict: 'tie',
        biggestGap: undefined,
        gaps: [],
        criteria: [
          {
            id: 'blind-ab',
            satisfied: true,
            evidence: `Candidate ties reference on ${targetRef}.`,
            evidenceDigests: [evidenceDigest],
          },
        ],
      })
    );
    expect(result.satisfactionSource).toBe('bar-reached');
    expect(result.verdict).toBe('tie');
  });

  it('accepts an attestation-evidenced judgment (convergence through judge)', () => {
    const attestationDigest = asDigest('abcd');
    const userActorDigest = asDigest('ef01');
    const result = validate(
      judgment({
        satisfied: true,
        satisfactionSource: 'attestation-evidenced',
        verdict: 'reference',
        biggestGap: 'Reference still ahead on rendering fidelity.',
        gaps: ['Reference still ahead on rendering fidelity.'],
        criteria: [
          {
            id: 'blind-ab',
            satisfied: false,
            evidence: `Reference still better on ${targetRef}.`,
            evidenceDigests: [evidenceDigest],
          },
        ],
        attestation: {
          attestationDigest,
          userActorDigest,
          issuedAt: '2026-08-02T12:00:00Z',
        },
      })
    );
    expect(result.satisfied).toBe(true);
    expect(result.satisfactionSource).toBe('attestation-evidenced');
    expect(result.attestation).toBeDefined();
    expect(result.attestation?.attestationDigest).toBe(attestationDigest);
    // The A/B verdict is still 'reference' — attestation overrides, not replaces.
    expect(result.verdict).toBe('reference');
  });

  it('distinguishes bar-reached from attestation-evidenced satisfaction sources', () => {
    const barReached = validate(
      judgment({
        satisfied: true,
        satisfactionSource: 'bar-reached',
        verdict: 'tie',
        biggestGap: undefined,
        gaps: [],
        criteria: [
          {
            id: 'blind-ab',
            satisfied: true,
            evidence: `Tie on ${targetRef}.`,
            evidenceDigests: [evidenceDigest],
          },
        ],
      })
    );
    const attestationEvidenced = validate(
      judgment({
        satisfied: true,
        satisfactionSource: 'attestation-evidenced',
        verdict: 'reference',
        biggestGap: 'Gap remains.',
        gaps: ['Gap remains.'],
        criteria: [
          {
            id: 'blind-ab',
            satisfied: false,
            evidence: `Gap on ${targetRef}.`,
            evidenceDigests: [evidenceDigest],
          },
        ],
        attestation: {
          attestationDigest: asDigest('1'),
          userActorDigest: asDigest('2'),
          issuedAt: '2026-08-02T12:00:00Z',
        },
      })
    );
    expect(barReached.satisfactionSource).toBe('bar-reached');
    expect(attestationEvidenced.satisfactionSource).toBe(
      'attestation-evidenced'
    );
    expect(barReached.satisfactionSource).not.toBe(
      attestationEvidenced.satisfactionSource
    );
    expect(barReached.attestation).toBeUndefined();
    expect(attestationEvidenced.attestation).toBeDefined();
  });

  it('throws gauntlet_false_satisfaction for satisfied without source', () => {
    expect(() =>
      validate(
        judgment({
          satisfied: true,
          verdict: 'candidate',
          gaps: [],
          biggestGap: undefined,
        })
      )
    ).toThrow(/satisfaction source/);
  });

  it('throws gauntlet_false_satisfaction for bar-reached with verdict reference', () => {
    expect(() =>
      validate(
        judgment({
          satisfied: true,
          satisfactionSource: 'bar-reached',
          verdict: 'reference',
        })
      )
    ).toThrow(/verdict 'candidate' or 'tie'/);
  });

  it('throws gauntlet_false_satisfaction for attestation-evidenced without attestation', () => {
    expect(() =>
      validate(
        judgment({
          satisfied: true,
          satisfactionSource: 'attestation-evidenced',
        })
      )
    ).toThrow(/convergence attestation/);
  });

  it('throws gauntlet_false_satisfaction for unsatisfied with satisfactionSource', () => {
    expect(() =>
      validate(
        judgment({
          satisfied: false,
          satisfactionSource: 'bar-reached',
        })
      )
    ).toThrow(/must not declare satisfactionSource/);
  });

  it('throws gauntlet_false_satisfaction for unsatisfied with wrong verdict', () => {
    expect(() =>
      validate(
        judgment({
          satisfied: false,
          verdict: 'candidate',
        })
      )
    ).toThrow(/verdict 'reference'/);
  });

  it('throws gauntlet_false_satisfaction for unsatisfied without biggestGap', () => {
    expect(() =>
      validate(
        judgment({
          satisfied: false,
          verdict: 'reference',
          biggestGap: undefined,
          gaps: [],
        })
      )
    ).toThrow(/exactly one largest gap/);
  });

  it('throws gauntlet_critic_reused when critic session is prior', () => {
    expect(() =>
      validate(judgment(), {
        priorCritics: ['critic-session-1'],
      })
    ).toThrow(GauntletDomainError);
  });

  it('throws gauntlet_evidence_missing for uncommitted evidence digest', () => {
    const otherDigest = asDigest('9999');
    expect(() =>
      validate(
        judgment({
          criteria: [
            {
              id: 'blind-ab',
              satisfied: false,
              evidence: `Gap on ${targetRef}.`,
              evidenceDigests: [otherDigest],
            },
          ],
        })
      )
    ).toThrow(/not committed/);
  });

  it('throws gauntlet_evidence_missing when evidence does not identify a target', () => {
    expect(() =>
      validate(
        judgment({
          criteria: [
            {
              id: 'blind-ab',
              satisfied: false,
              evidence: 'No target mentioned here.',
              evidenceDigests: [evidenceDigest],
            },
          ],
        })
      )
    ).toThrow(/frozen artifact or reference target/);
  });
});

// ---------------------------------------------------------------------------
// 1.3 — v1 Code/Runnable inspector (C4 resolution)
// ---------------------------------------------------------------------------

describe('CodeRunnableBarAdapter', () => {
  const sampleSource = [
    '// This is a comment',
    'import { foo } from "bar";',
    '',
    'function main() {',
    '  console.log("hello");',
    '}',
    '',
    'class Game {',
    '  start() {',
    '    return true;',
    '  }',
    '}',
  ].join('\n');

  describe('inspect', () => {
    it('produces an InspectionResult with anonymized observations', () => {
      const adapter = new CodeRunnableBarAdapter(
        syntheticPlumbing({ 'target.ts': sampleSource })
      );
      const result = adapter.inspect('target.ts');
      expect(result.format).toBe('gauntlet-inspection/1');
      expect(result.domain).toBe('code/runnable');
      expect(result.targetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.anonymizedDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.observations.length).toBeGreaterThanOrEqual(2);
      expect(result.observations.some((o) => o.kind === 'source')).toBe(true);
      expect(result.observations.some((o) => o.kind === 'structure')).toBe(
        true
      );
      expect(result.anonymizedLabels.length).toBe(result.observations.length);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('strips comments and imports from anonymized content', () => {
      const adapter = new CodeRunnableBarAdapter(
        syntheticPlumbing({ 'target.ts': sampleSource })
      );
      const result = adapter.inspect('target.ts');
      const sourceObs = result.observations.find((o) => o.kind === 'source')!;
      // The anonymized content is not directly exposed (only its digest),
      // but the observation count should reflect stripped content.
      expect(sourceObs.digest).not.toBe(result.targetDigest);
    });

    it('is deterministic (same content → same anonymized digest)', () => {
      const adapter = new CodeRunnableBarAdapter(
        syntheticPlumbing({ 'target.ts': sampleSource })
      );
      const result1 = adapter.inspect('target.ts');
      const result2 = adapter.inspect('target.ts');
      expect(result1.anonymizedDigest).toBe(result2.anonymizedDigest);
      expect(result1.targetDigest).toBe(result2.targetDigest);
    });

    it('throws gauntlet_bar_missing for missing reference target', () => {
      const adapter = new CodeRunnableBarAdapter(syntheticPlumbing({}));
      expect(() => adapter.inspect('nonexistent.ts')).toThrow(
        GauntletDomainError
      );
      expect(() => adapter.inspect('nonexistent.ts')).toThrow(
        /not found or not readable/
      );
    });

    it('captures output observation when target is runnable', () => {
      const adapter = new CodeRunnableBarAdapter(
        syntheticPlumbing(
          { 'game.ts': sampleSource },
          {
            'game.ts': {
              stdout: 'Game started!',
              stderr: '',
              exitCode: 0,
            },
          }
        )
      );
      const result = adapter.inspect('game.ts');
      const outputObs = result.observations.find((o) => o.kind === 'output');
      expect(outputObs).toBeDefined();
      expect(outputObs!.summary).toContain('exit=0');
    });

    it('degrades gracefully when target is non-runnable (no runTarget)', () => {
      const adapter = new CodeRunnableBarAdapter(
        syntheticPlumbing({ 'static.ts': sampleSource })
      );
      const result = adapter.inspect('static.ts');
      const outputObs = result.observations.find((o) => o.kind === 'output');
      expect(outputObs).toBeUndefined();
      // Structural observations still present.
      expect(result.observations.length).toBeGreaterThanOrEqual(2);
    });

    it('accepts workspaceTree for staleness tracking', () => {
      const adapter = new CodeRunnableBarAdapter(
        syntheticPlumbing({ 'target.ts': sampleSource })
      );
      const result = adapter.inspect('target.ts', 'sha256:abc');
      expect(result.targetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('compare', () => {
    function inspectWith(
      adapter: CodeRunnableBarAdapter,
      target: string
    ): InspectionResult {
      return adapter.inspect(target);
    }

    it('returns verdict tie when outputs match', () => {
      const plumbing = syntheticPlumbing(
        {
          'candidate.ts': sampleSource,
          'reference.ts': sampleSource,
        },
        {
          'candidate.ts': { stdout: 'same', stderr: '', exitCode: 0 },
          'reference.ts': { stdout: 'same', stderr: '', exitCode: 0 },
        }
      );
      const adapter = new CodeRunnableBarAdapter(plumbing);
      const candidate = inspectWith(adapter, 'candidate.ts');
      const reference = inspectWith(adapter, 'reference.ts');
      const comparison = adapter.compare(candidate, reference);
      expect(comparison.verdict).toBe('tie');
      expect(comparison.biggestGap).toBe('');
    });

    it('returns verdict reference when outputs differ', () => {
      const plumbing = syntheticPlumbing(
        {
          'candidate.ts': sampleSource,
          'reference.ts': sampleSource,
        },
        {
          'candidate.ts': { stdout: 'wrong', stderr: '', exitCode: 1 },
          'reference.ts': { stdout: 'right', stderr: '', exitCode: 0 },
        }
      );
      const adapter = new CodeRunnableBarAdapter(plumbing);
      const candidate = inspectWith(adapter, 'candidate.ts');
      const reference = inspectWith(adapter, 'reference.ts');
      const comparison = adapter.compare(candidate, reference);
      expect(comparison.verdict).toBe('reference');
      expect(comparison.biggestGap).toBeTruthy();
    });

    it('falls back to structural comparison when no output', () => {
      const plumbing = syntheticPlumbing({
        'candidate.ts': 'function a() {}\nfunction b() {}\n',
        'reference.ts': 'function a() {}\n',
      });
      const adapter = new CodeRunnableBarAdapter(plumbing);
      const candidate = inspectWith(adapter, 'candidate.ts');
      const reference = inspectWith(adapter, 'reference.ts');
      const comparison = adapter.compare(candidate, reference);
      // Candidate has 2 declarations, reference has 1 → candidate wins structurally.
      expect(comparison.verdict).toBe('candidate');
    });
  });
});

// ---------------------------------------------------------------------------
// 1.4 — Freeze bar in canonical launch inputs + digestLaunchIntent threading
// ---------------------------------------------------------------------------

describe('launch intent freezing and conflict detection', () => {
  it('same bar → same launch intent digest (idempotent)', () => {
    const input = validInput();
    const intent1 = {
      pipeline: 'gauntlet-loop',
      engine: 'reconciler' as const,
      inputs: { gauntlet: input },
    };
    const intent2 = {
      pipeline: 'gauntlet-loop',
      engine: 'reconciler' as const,
      inputs: { gauntlet: input },
    };
    expect(digestLaunchIntent(intent1)).toBe(digestLaunchIntent(intent2));
  });

  it('changed goal → different launch intent digest (conflict)', () => {
    const input1 = validInput();
    const input2 = decodeGauntletInput(
      { ...input1, goal: 'Build a platformer game.' },
      {}
    );
    const digest1 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input1 },
    });
    const digest2 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input2 },
    });
    expect(digest1).not.toBe(digest2);
  });

  it('changed reference target → different launch intent digest (conflict)', () => {
    const input1 = validInput();
    const input2 = decodeGauntletInput(
      {
        ...input1,
        bar: { ...validBar(), referenceTargets: ['reference/other.ts'] },
      },
      {}
    );
    const digest1 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input1 },
    });
    const digest2 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input2 },
    });
    expect(digest1).not.toBe(digest2);
  });

  it('changed pipeline → different launch intent digest (conflict)', () => {
    const input = validInput();
    const digest1 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input },
    });
    const digest2 = digestLaunchIntent({
      pipeline: 'task-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input },
    });
    expect(digest1).not.toBe(digest2);
  });

  it('changed comparison axis → different launch intent digest (conflict)', () => {
    const input1 = validInput();
    const input2 = decodeGauntletInput(
      {
        ...input1,
        bar: { ...validBar(), comparisonAxis: 'structural-completeness' },
      },
      {}
    );
    const digest1 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input1 },
    });
    const digest2 = digestLaunchIntent({
      pipeline: 'gauntlet-loop',
      engine: 'reconciler',
      inputs: { gauntlet: input2 },
    });
    expect(digest1).not.toBe(digest2);
  });
});

// ---------------------------------------------------------------------------
// 1.5 — Reject uninspectable/missing bar before work
// ---------------------------------------------------------------------------

describe('assertGauntletBarInspectable', () => {
  it('passes for an inspectable bar with matching adapter', () => {
    const input = decodeGauntletInput(
      {
        format: 'gauntlet-loop-input/1',
        goal: 'Build a maze game.',
        artifactTargets: ['src/game.ts'],
        bar: {
          format: 'gauntlet-reference-bar/1',
          domain: 'code/runnable',
          referenceTargets: ['reference/exemplar.ts'],
          comparisonAxis: 'observable-behavior/output',
        },
        constraints: [],
      },
      {}
    );
    const adapter = new CodeRunnableBarAdapter(
      syntheticPlumbing({
        'reference/exemplar.ts': 'function exemplar() { return true; }',
      })
    );
    expect(() => assertGauntletBarInspectable(input, adapter)).not.toThrow();
  });

  it('throws gauntlet_bar_unprovable when adapter domain mismatches', () => {
    const input = validInput();
    const wrongAdapter: BarAdapter = {
      domain: 'visual',
      inspect: () => {
        throw new Error('not code');
      },
      compare: () => ({
        verdict: 'reference',
        biggestGap: '',
        evidenceDigests: [],
      }),
    };
    expect(() => assertGauntletBarInspectable(input, wrongAdapter)).toThrow(
      /domain .* does not match/
    );
  });

  it('throws gauntlet_bar_unprovable when reference target is missing', () => {
    const input = validInput();
    const adapter = new CodeRunnableBarAdapter(syntheticPlumbing({}));
    expect(() => assertGauntletBarInspectable(input, adapter)).toThrow(
      /not inspectable/
    );
  });

  it('throws gauntlet_subjective_bar_rejected for subjective axis (no substitution)', () => {
    const input = decodeGauntletInput(
      {
        format: 'gauntlet-loop-input/1',
        goal: 'x',
        artifactTargets: ['src/a.ts'],
        bar: {
          format: 'gauntlet-reference-bar/1',
          domain: 'code/runnable',
          referenceTargets: ['reference/a.ts'],
          comparisonAxis: 'observable-behavior/output',
        },
        constraints: [],
      },
      {}
    );
    // Manually corrupt the axis post-decode to simulate a bypass attempt.
    const corrupted = {
      ...input,
      bar: { ...input.bar, comparisonAxis: 'quality' },
    };
    expect(() => assertGauntletBarInspectable(corrupted)).toThrow(
      /subjective/
    );
  });

  it('does not start a spec workflow (input has no proposal/design/specs/tasks)', () => {
    const input = validInput();
    // GauntletInput has no spec-related fields; the schema is strictObject.
    expect('proposal' in input).toBe(false);
    expect('design' in input).toBe(false);
    expect('specs' in input).toBe(false);
    expect('tasks' in input).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GoalCycle integration — gauntlet mode parses judge results
// ---------------------------------------------------------------------------

describe('GoalCycle gauntlet mode', () => {
  it('decodes a gauntlet judge result through the evaluate variant', () => {
    const judgeResult = {
      contract: 'goal-cycle/evaluate-judge/1',
      satisfied: false,
      verdict: 'reference',
      biggestGap: 'Gap A.',
      gaps: ['Gap A.'],
      satisfactionSource: undefined,
      criteria: [
        {
          id: 'blind-ab',
          satisfied: false,
          evidence: 'Evidence on target.',
          evidenceDigests: [asDigest('1234')],
        },
      ],
    };
    // The gauntlet mode should strip extra fields and parse via evaluate schema.
    const decoded = decodeGoalCycleResult(
      'judge',
      'evaluate',
      judgeResult as never,
      'gauntlet'
    );
    expect(decoded).toBeDefined();
  });

  it('applyGoalCycleEvent advances round in gauntlet mode (unsatisfied)', () => {
    const initialState = initialGoalCycleState('evaluate');
    const capabilityDigest = asDigest('4444');
    const workActor = buildAgentActor({
      role: 'implementer',
      provider: 'test',
      runtime: 'claude',
      principalIdentityDigest: asDigest('2222'),
      sessionIdentityDigest: asDigest('3333'),
      adapter: {
        id: 'test-adapter',
        version: '1.0.0',
        artifactDigest: capabilityDigest,
      },
    });
    const workEvent: GoalCycleEvent = {
      round: 1,
      phase: 'work',
      actor: workActor,
      result: {
        contract: 'goal-cycle/work-result/1',
        workDescription: 'Built the maze rendering.',
        beforeTree: asDigest('aaaa'),
        afterTree: asDigest('bbbb'),
        delta: makeEvidence({ content: 'work delta' }),
      },
      evidence: [],
    };
    const afterWork = applyGoalCycleEvent(
      initialState,
      workEvent,
      5,
      'gauntlet'
    );
    expect(afterWork.phase).toBe('judge');
    expect(afterWork.round).toBe(1);
  });
});
