import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  createTrustedExecutionAdapterCatalog,
} from '../../../src/core/pipeline-registry/index.js';
import type { Digest } from '../../../src/core/change-run/contracts.js';
import {
  resolveRuntimeExecutionProfile,
  resolveDiscoveryReconcilerSupportProfile,
  resolveCapabilityBindings,
} from '../../../src/core/pipeline-registry/profile-resolver.js';
import {
  PipelineYamlSchema,
  ConsultationBindingYamlSchema,
  type ConsultationBindingYaml,
} from '../../../src/core/pipeline-registry/types.js';
import { getBuiltInExpertDefinitions } from '../../../src/core/workflow-registry/experts.js';
import { getTeacherAdvisorSkillTemplate } from '../../../src/core/templates/experts/teacher-advisor.js';
import { CONSULTATION_SERVER_LIMITS } from '../../../src/core/change-run/consultation-contracts.js';
import {
  TEST_ATTESTATION_AUTHORITY,
  trustedCatalogForBindings,
  trustedDescriptor,
} from '../../fixtures/trusted-completion.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEACHER_DIGEST = `sha256:${'7'.repeat(64)}`;

function descriptor(skill: string, digest: string) {
  return {
    id: `skill:${skill}`,
    version: digest,
    availability: 'enabled' as const,
    inputs: [],
    artifacts: [],
    outcomes: ['completed'],
    limits: {},
  };
}

const FIXTURE_PIPELINE = {
  version: 1,
  name: 'consultation-fixture',
  description: 'test pipeline',
  stages: [
    { id: 'propose', skill: 'rasen-propose', role: 'planner', requires: [], gate: true },
    { id: 'apply', skill: 'rasen-apply-change', role: 'implementer', requires: ['propose'] },
    { id: 'verify', skill: 'rasen-review', role: 'reviewer', requires: ['apply'] },
  ],
} as const;

const FIXTURE_CONSULTATIONS: readonly ConsultationBindingYaml[] = [
  {
    sourceStage: 'apply',
    teacherSkill: 'rasen-teacher-advisor',
    maxConsultationsPerInvocation: 4,
    maxTeacherAttemptsPerConsultation: 2,
  },
];

/** Build minimal policy stages for the fixture pipeline so consultation bindings find their source stage.
 *  The consultation runtime requires source stages to be same-invocation agent Actions. */
function fixturePolicyStages() {
  return FIXTURE_PIPELINE.stages.map((stage) => ({
    nodeId: `stage:${stage.id}`,
    role: stage.role ?? 'implementer',
    model: 'default',
    effort: 'default',
    runtime: 'codex',
    sandbox: stage.role === 'reviewer' ? 'read-only' as const : 'workspace-write' as const,
    gate: stage.gate ?? false,
    sessionReuse: 'same-invocation' as const,
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 1,
    provenance: {
      role: 'fixture', model: 'default', effort: 'default', runtime: 'fixture',
      sandbox: 'fixture', gate: 'fixture', sessionReuse: 'fixture',
      handoffTokenLimit: 'default', reuseRoundLimit: 'default',
    },
  }));
}

const sourceRevision = {
  layer: 'project' as const,
  kind: 'pipeline-yaml' as const,
  sourceId: 'project:consultation-fixture',
  authoredContentDigest: `sha256:${'a'.repeat(64)}` as const,
  semanticDigest: `sha256:${'b'.repeat(64)}` as const,
};

function makeCatalog(teacherDigest = TEACHER_DIGEST) {
  return createCapabilityCatalogSnapshot([
    descriptor('rasen-propose', `sha256:${'1'.repeat(64)}`),
    descriptor('rasen-apply-change', `sha256:${'2'.repeat(64)}`),
    descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
    descriptor('rasen-teacher-advisor', teacherDigest),
  ]);
}

function makePrepared(consultations?: readonly ConsultationBindingYaml[]) {
  const pipeline = {
    ...FIXTURE_PIPELINE,
    ...(consultations ? { consultations } : {}),
  };
  const catalog = makeCatalog();
  const result = EcpDefinitionModule.prepare(pipeline, catalog);
  if (!result.ok) throw result.error;
  return { prepared: result.value, catalog };
}

function makeTrustedAdapters(prepared: ReturnType<typeof makePrepared>['prepared']) {
  // Build provisional bindings to create a trusted catalog for the test authority.
  // Also include the Teacher adapter descriptor so Teacher capability bindings
  // can resolve their attestation authority.
  const provisional = resolveCapabilityBindings(prepared, makeCatalog());
  const baseCatalog = trustedCatalogForBindings(provisional, TEST_ATTESTATION_AUTHORITY);
  const teacherAdapter = trustedDescriptor(
    { id: 'adapter:rasen-teacher-advisor', version: '1', contentDigest: TEACHER_DIGEST as Digest },
    TEST_ATTESTATION_AUTHORITY
  );
  return createTrustedExecutionAdapterCatalog([
    ...baseCatalog.descriptors,
    teacherAdapter,
  ]);
}

// ---------------------------------------------------------------------------
// 6.1 Pipeline YAML consultation parsing
// ---------------------------------------------------------------------------

describe('6.1 Pipeline YAML consultation parsing', () => {
  it('accepts a valid consultation binding', () => {
    const parsed = PipelineYamlSchema.safeParse({
      ...FIXTURE_PIPELINE,
      consultations: [
        {
          sourceStage: 'apply',
          teacherSkill: 'rasen-teacher-advisor',
          maxConsultationsPerInvocation: 4,
          maxTeacherAttemptsPerConsultation: 2,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.consultations).toHaveLength(1);
      expect(parsed.data.consultations![0]!.sourceStage).toBe('apply');
      expect(parsed.data.consultations![0]!.teacherSkill).toBe('rasen-teacher-advisor');
    }
  });

  it('rejects unknown sourceStage', () => {
    const parsed = PipelineYamlSchema.safeParse({
      ...FIXTURE_PIPELINE,
      consultations: [
        {
          sourceStage: 'nonexistent-stage',
          teacherSkill: 'rasen-teacher-advisor',
          maxConsultationsPerInvocation: 4,
          maxTeacherAttemptsPerConsultation: 2,
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('nonexistent-stage'))).toBe(true);
    }
  });

  it('rejects maxConsultationsPerInvocation exceeding server maxima', () => {
    const parsed = ConsultationBindingYamlSchema.safeParse({
      sourceStage: 'apply',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: CONSULTATION_SERVER_LIMITS.maxConsultationsPerInvocation + 1,
      maxTeacherAttemptsPerConsultation: 2,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects maxTeacherAttemptsPerConsultation exceeding server maxima', () => {
    const parsed = ConsultationBindingYamlSchema.safeParse({
      sourceStage: 'apply',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 4,
      maxTeacherAttemptsPerConsultation: CONSULTATION_SERVER_LIMITS.maxTeacherAttemptsPerConsultation + 1,
    });
    expect(parsed.success).toBe(false);
  });

  it('produces no consultations field when omitted', () => {
    const parsed = PipelineYamlSchema.safeParse(FIXTURE_PIPELINE);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.consultations).toBeUndefined();
    }
  });

  it('accepts optional content limits', () => {
    const parsed = ConsultationBindingYamlSchema.safeParse({
      sourceStage: 'apply',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 4,
      maxTeacherAttemptsPerConsultation: 2,
      limits: {
        maxQuestionBytes: 4096,
        maxAdviceBytes: 8192,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limits?.maxQuestionBytes).toBe(4096);
      expect(parsed.data.limits?.maxAdviceBytes).toBe(8192);
    }
  });

  it('rejects content limits exceeding server maxima', () => {
    const parsed = ConsultationBindingYamlSchema.safeParse({
      sourceStage: 'apply',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 4,
      maxTeacherAttemptsPerConsultation: 2,
      limits: {
        maxQuestionBytes: CONSULTATION_SERVER_LIMITS.maxQuestionBytes + 1,
      },
    });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6.2 Profile resolver consultation test
// ---------------------------------------------------------------------------

describe('6.2 Profile resolver: single consultation binding', () => {
  it('produces a Teacher capability binding and a consultation binding', () => {
    const { prepared, catalog } = makePrepared();
    const trustedAdapters = makeTrustedAdapters(prepared);

    const profile = resolveRuntimeExecutionProfile(
      prepared,
      catalog,
      fixturePolicyStages(),
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      trustedAdapters,
      FIXTURE_CONSULTATIONS
    );

    // Teacher capability binding at teacher:<skill>
    const teacherBinding = profile.capabilities.find(
      (c) => c.nodeId === 'teacher:rasen-teacher-advisor'
    );
    expect(teacherBinding).toBeDefined();
    expect(teacherBinding!.workspace.access).toBe('none');
    expect(teacherBinding!.workspace.resources).toEqual([]);
    expect(teacherBinding!.effects).toEqual([]);

    // Consultation binding
    expect(profile.consultations).toBeDefined();
    expect(profile.consultations).toHaveLength(1);
    const consultation = profile.consultations![0]!;
    expect(consultation.sourceProfilePath).toBe('stage:apply');
    expect(consultation.teacherProfilePath).toBe('teacher:rasen-teacher-advisor');
    expect(consultation.maxConsultationsPerInvocation).toBe(4);
    expect(consultation.maxTeacherAttemptsPerConsultation).toBe(2);
    // Content limits should be filled with server defaults
    expect(consultation.limits.maxQuestionBytes).toBe(CONSULTATION_SERVER_LIMITS.maxQuestionBytes);
    expect(consultation.limits.maxAdviceBytes).toBe(CONSULTATION_SERVER_LIMITS.maxAdviceBytes);
  });
});

// ---------------------------------------------------------------------------
// 6.3 Profile resolver multi-source test
// ---------------------------------------------------------------------------

describe('6.3 Profile resolver: multiple sources, one Teacher', () => {
  it('produces one Teacher capability binding and two consultation entries', () => {
    const { prepared, catalog } = makePrepared();
    const trustedAdapters = makeTrustedAdapters(prepared);

    const multiConsultations: readonly ConsultationBindingYaml[] = [
      {
        sourceStage: 'apply',
        teacherSkill: 'rasen-teacher-advisor',
        maxConsultationsPerInvocation: 4,
        maxTeacherAttemptsPerConsultation: 2,
      },
      {
        sourceStage: 'verify',
        teacherSkill: 'rasen-teacher-advisor',
        maxConsultationsPerInvocation: 2,
        maxTeacherAttemptsPerConsultation: 1,
      },
    ];

    const profile = resolveRuntimeExecutionProfile(
      prepared,
      catalog,
      fixturePolicyStages(),
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      trustedAdapters,
      multiConsultations
    );

    // One Teacher capability binding
    const teacherBindings = profile.capabilities.filter(
      (c) => c.nodeId === 'teacher:rasen-teacher-advisor'
    );
    expect(teacherBindings).toHaveLength(1);

    // Two consultation entries
    expect(profile.consultations).toHaveLength(2);
    const sourcePaths = profile.consultations!.map((c) => c.sourceProfilePath).sort();
    expect(sourcePaths).toEqual(['stage:apply', 'stage:verify']);
    // Both point to the same Teacher path
    for (const c of profile.consultations!) {
      expect(c.teacherProfilePath).toBe('teacher:rasen-teacher-advisor');
    }
  });
});

// ---------------------------------------------------------------------------
// 6.4 Profile resolver preservation test (byte-identity)
// ---------------------------------------------------------------------------

describe('6.4 Profile resolver: byte-identical preservation without consultations', () => {
  it('produces identical capabilities, policy stages, and digest with and without consultations param', () => {
    const { prepared, catalog } = makePrepared();
    const trustedAdapters = makeTrustedAdapters(prepared);

    // Resolve WITHOUT consultations parameter (the legacy call)
    const legacyProfile = resolveRuntimeExecutionProfile(
      prepared,
      catalog,
      fixturePolicyStages(),
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      trustedAdapters
    );

    // Resolve WITH undefined consultations parameter
    const undefinedProfile = resolveRuntimeExecutionProfile(
      prepared,
      catalog,
      fixturePolicyStages(),
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      trustedAdapters,
      undefined
    );

    // Resolve WITH empty consultations array
    const emptyProfile = resolveRuntimeExecutionProfile(
      prepared,
      catalog,
      fixturePolicyStages(),
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      trustedAdapters,
      []
    );

    // All three must be byte-identical
    expect(undefinedProfile.profileDigest).toBe(legacyProfile.profileDigest);
    expect(emptyProfile.profileDigest).toBe(legacyProfile.profileDigest);
    expect(undefinedProfile.capabilityProfileDigest).toBe(legacyProfile.capabilityProfileDigest);
    expect(emptyProfile.capabilityProfileDigest).toBe(legacyProfile.capabilityProfileDigest);
    expect(undefinedProfile.policyDigest).toBe(legacyProfile.policyDigest);
    expect(emptyProfile.policyDigest).toBe(legacyProfile.policyDigest);

    // Capabilities arrays identical
    expect(undefinedProfile.capabilities).toEqual(legacyProfile.capabilities);
    expect(emptyProfile.capabilities).toEqual(legacyProfile.capabilities);

    // No consultations field on any of them
    expect('consultations' in legacyProfile).toBe(false);
    expect('consultations' in undefinedProfile).toBe(false);
    expect('consultations' in emptyProfile).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6.5 Teacher catalog resolution test
// ---------------------------------------------------------------------------

describe('6.5 Profile resolver: missing Teacher skill fails', () => {
  it('fails with a typed error when the Teacher skill is not in the catalog', () => {
    // Catalog without the teacher-advisor skill
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-propose', `sha256:${'1'.repeat(64)}`),
      descriptor('rasen-apply-change', `sha256:${'2'.repeat(64)}`),
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
      // NO rasen-teacher-advisor descriptor
    ]);
    const result = EcpDefinitionModule.prepare(FIXTURE_PIPELINE, catalog);
    if (!result.ok) throw result.error;
    const trustedAdapters = makeTrustedAdapters(result.value);

    expect(() =>
      resolveRuntimeExecutionProfile(
        result.value,
        catalog,
        [],
        sourceRevision,
        { maxAttempts: 3, maxActions: 64 },
        undefined,
        trustedAdapters,
        FIXTURE_CONSULTATIONS
      )
    ).toThrow(/not in the production catalog/i);
  });
});

// ---------------------------------------------------------------------------
// 6.6 Built-in workflow registration test
// ---------------------------------------------------------------------------

describe('6.6 Built-in workflow registration: teacher-advisor expert', () => {
  it('appears in the built-in expert catalog with correct metadata', () => {
    const experts = getBuiltInExpertDefinitions();
    const entry = experts.find((e) => e.id === 'teacher-advisor');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('expert');
    expect(entry!.skill.dirName).toBe('rasen-teacher-advisor');
    expect(entry!.digest).toBeTruthy();
    expect(entry!.digest.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6.7 Skill template content conformance test
// ---------------------------------------------------------------------------

describe('6.7 Teacher Advisor skill template content', () => {
  const template = getTeacherAdvisorSkillTemplate();

  it('has the correct name and description', () => {
    expect(template.name).toBe('rasen-teacher-advisor');
    expect(template.description.toLowerCase()).toContain('read-only');
    expect(template.description).toContain('teacher-consultation');
  });

  it('names the advice contract and its required fields', () => {
    expect(template.instructions).toContain('teacher-consultation/advice/1');
    expect(template.instructions).toContain('consultationId');
    expect(template.instructions).toContain('teacherAttempt');
    expect(template.instructions).toContain('decision');
    expect(template.instructions).toContain('rationale');
    expect(template.instructions).toContain('steps');
    expect(template.instructions).toContain('cautions');
    expect(template.instructions).toContain('evidenceNotes');
  });

  it('names the three allowed decisions', () => {
    expect(template.instructions).toContain('plan');
    expect(template.instructions).toContain('correction');
    expect(template.instructions).toContain('stop');
  });

  it('states that stop is advisory only', () => {
    expect(template.instructions).toContain('advisory only');
    expect(template.instructions).toContain('does NOT constitute Run authority');
  });

  it('enforces read-only posture', () => {
    expect(template.instructions).toMatch(/read-only/i);
    expect(template.instructions).toContain('MUST NOT');
    expect(template.instructions).toMatch(/modify files/i);
  });

  it('names the invocation contract', () => {
    expect(template.instructions).toContain('teacher-consultation/invocation/1');
  });
});

// ---------------------------------------------------------------------------
// 6.8 Cross-platform path test
// ---------------------------------------------------------------------------

describe('6.8 Cross-platform: teacher path has no backslash', () => {
  it('uses no platform-specific separator in the synthetic path', () => {
    const { prepared, catalog } = makePrepared();
    const trustedAdapters = makeTrustedAdapters(prepared);

    const profile = resolveRuntimeExecutionProfile(
      prepared,
      catalog,
      fixturePolicyStages(),
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      trustedAdapters,
      FIXTURE_CONSULTATIONS
    );

    // The Teacher path must not contain backslash
    const teacherBinding = profile.capabilities.find(
      (c) => c.nodeId.startsWith('teacher:')
    );
    expect(teacherBinding).toBeDefined();
    expect(teacherBinding!.nodeId).not.toContain('\\');

    // Consultation binding paths must not contain backslash either
    for (const c of profile.consultations!) {
      expect(c.sourceProfilePath).not.toContain('\\');
      expect(c.teacherProfilePath).not.toContain('\\');
    }
  });
});

// ---------------------------------------------------------------------------
// Discovery profile consistency (task 5.3)
// ---------------------------------------------------------------------------

describe('Discovery profile: Teacher bindings included when consultations declared', () => {
  it('includes Teacher capability bindings in the discovery profile', () => {
    const { prepared, catalog } = makePrepared();
    const support = resolveDiscoveryReconcilerSupportProfile(
      prepared,
      catalog,
      undefined,
      FIXTURE_CONSULTATIONS
    );
    expect(support).not.toBeNull();
    const teacherBinding = support!.capabilities.find(
      (c) => c.nodeId === 'teacher:rasen-teacher-advisor'
    );
    expect(teacherBinding).toBeDefined();
    expect(teacherBinding!.workspace.access).toBe('none');
    expect(teacherBinding!.effects).toEqual([]);
  });

  it('excludes Teacher capability bindings when consultations are omitted', () => {
    const { prepared, catalog } = makePrepared();
    const support = resolveDiscoveryReconcilerSupportProfile(prepared, catalog);
    expect(support).not.toBeNull();
    const teacherBinding = support!.capabilities.find(
      (c) => c.nodeId.startsWith('teacher:')
    );
    expect(teacherBinding).toBeUndefined();
  });
});
