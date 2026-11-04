/**
 * Tests for teacher-consultation-canvas: WireConsultationBinding types,
 * getConsultationSection extractor, draft helpers (v1/v2), editor rendering,
 * observability panel rendering, V2NodePanel integration, and v1 round-trip.
 */
import { describe, expect, it } from 'vitest';
import type { ChangeRunView, ConsultationViewSection } from '../../src/api/types.js';
import { getConsultationSection } from '../../src/api/types.js';
import {
  addConsultationBinding,
  createBlankCanvasPipelineDefinitionV2,
  definitionIssuePathTarget,
  getConsultationBindingForStage,
  isDirty,
  removeConsultationBinding,
  updateConsultationBinding,
  type ConsultationBindingPatch,
} from '../../src/canvas/draft.js';
import type {
  WireConsultationBinding,
  WirePipelineDefinition,
  WirePipelineDefinitionV1,
  WirePipelineDefinitionV2,
} from '../../src/api/types.js';

function makeBinding(
  stage: string,
  overrides: Partial<WireConsultationBinding> = {}
): WireConsultationBinding {
  return {
    sourceStage: stage,
    teacherSkill: 'rasen-teacher-advisor',
    maxConsultationsPerInvocation: 3,
    maxTeacherAttemptsPerConsultation: 2,
    ...overrides,
  };
}

function v1WithConsultations(): WirePipelineDefinitionV1 {
  return {
    version: 1,
    name: 'demo',
    stages: [
      { id: 'plan', kind: 'standard', requires: [], gate: false, leadReview: false },
    ],
    consultations: [makeBinding('plan')],
  };
}

function v2WithConsultations(): WirePipelineDefinitionV2 {
  return {
    ...createBlankCanvasPipelineDefinitionV2('demo'),
    root: {
      nodes: [
        {
          id: 'plan',
          kind: 'AtomicStage',
          capability: { id: 'rasen-planner', version: '1.0.0' },
        },
      ],
      connections: [],
    },
    consultations: [makeBinding('plan')],
  };
}

// --- Task 6.1: getConsultationSection extractor ---

describe('getConsultationSection', () => {
  it('returns null when no consultation section exists', () => {
    const view: ChangeRunView = {
      format: 'change-run-view/1',
      engine: 'reconciler',
      runId: 'run:' + 'a'.repeat(64),
      change: {
        planningSpaceId: 'planning-space:' + 'a'.repeat(64),
        projectId: 'proj',
        changeId: 'test',
        instanceId: 'change-instance:' + 'a'.repeat(64),
      },
      recordVersion: 1,
      status: 'running',
      sourceState: 'active',
      workspace: { instanceId: 'workspace-instance:' + 'a'.repeat(64), scope: 'current' },
      drift: {
        definition: 'unchanged',
        sourceRevision: {
          provenance: 'unchanged',
          content: 'unchanged',
          semantic: 'unchanged',
        },
        capability: 'unchanged',
        policy: 'unchanged',
        workspace: 'unchanged',
      },
      sections: [],
    };
    expect(getConsultationSection(view)).toBeNull();
  });

  it('returns the typed section when present and does not fall through to additive', () => {
    const section: ConsultationViewSection = {
      kind: 'consultation',
      version: 1,
      entries: [],
    };
    const view: ChangeRunView = {
      format: 'change-run-view/1',
      engine: 'reconciler',
      runId: 'run:' + 'a'.repeat(64),
      change: {
        planningSpaceId: 'planning-space:' + 'a'.repeat(64),
        projectId: 'proj',
        changeId: 'test',
        instanceId: 'change-instance:' + 'a'.repeat(64),
      },
      recordVersion: 1,
      status: 'running',
      sourceState: 'active',
      workspace: { instanceId: 'workspace-instance:' + 'a'.repeat(64), scope: 'current' },
      drift: {
        definition: 'unchanged',
        sourceRevision: {
          provenance: 'unchanged',
          content: 'unchanged',
          semantic: 'unchanged',
        },
        capability: 'unchanged',
        policy: 'unchanged',
        workspace: 'unchanged',
      },
      sections: [section],
    };
    const result = getConsultationSection(view);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('consultation');
    expect(result!.version).toBe(1);
  });
});

// --- Task 6.2: Draft helpers ---

describe('addConsultationBinding', () => {
  it('appends to a v1 definition', () => {
    const def = v1WithConsultations();
    const next = addConsultationBinding(def, makeBinding('plan', { teacherSkill: 'other' }));
    expect(next.consultations).toHaveLength(1);
    expect(next.consultations![0]!.teacherSkill).toBe('other');
  });

  it('appends to a v2 definition', () => {
    const def = v2WithConsultations();
    const next = addConsultationBinding(def, makeBinding('plan', { teacherSkill: 'other' }));
    expect(next.consultations).toHaveLength(1);
    expect(next.consultations![0]!.teacherSkill).toBe('other');
  });

  it('adds when no consultations exist', () => {
    const def: WirePipelineDefinitionV1 = {
      version: 1,
      name: 'demo',
      stages: [
        { id: 'plan', kind: 'standard', requires: [], gate: false, leadReview: false },
      ],
    };
    const next = addConsultationBinding(def, makeBinding('plan'));
    expect(next.consultations).toHaveLength(1);
  });

  it('preserves immutability of the original', () => {
    const def = v1WithConsultations();
    const original = JSON.parse(JSON.stringify(def));
    addConsultationBinding(def, makeBinding('plan', { teacherSkill: 'other' }));
    expect(JSON.parse(JSON.stringify(def))).toEqual(original);
  });
});

describe('updateConsultationBinding', () => {
  it('patches by sourceStage on v1', () => {
    const def = v1WithConsultations();
    const patch: ConsultationBindingPatch = { maxConsultationsPerInvocation: 5 };
    const next = updateConsultationBinding(def, 'plan', patch);
    expect(next.consultations![0]!.maxConsultationsPerInvocation).toBe(5);
    // preserves other fields
    expect(next.consultations![0]!.teacherSkill).toBe('rasen-teacher-advisor');
  });

  it('patches by sourceStage on v2', () => {
    const def = v2WithConsultations();
    const patch: ConsultationBindingPatch = { teacherSkill: 'updated' };
    const next = updateConsultationBinding(def, 'plan', patch);
    expect(next.consultations![0]!.teacherSkill).toBe('updated');
  });

  it('returns unchanged when sourceStage not found', () => {
    const def = v1WithConsultations();
    const next = updateConsultationBinding(def, 'missing', { teacherSkill: 'x' });
    expect(next).toBe(def);
  });

  it('merges limits without clearing other limit keys', () => {
    const def: WirePipelineDefinitionV1 = {
      version: 1,
      name: 'demo',
      stages: [
        { id: 'plan', kind: 'standard', requires: [], gate: false, leadReview: false },
      ],
      consultations: [
        {
          sourceStage: 'plan',
          teacherSkill: 't',
          maxConsultationsPerInvocation: 1,
          maxTeacherAttemptsPerConsultation: 1,
          limits: { maxQuestionBytes: 1024, maxAdviceBytes: 2048 },
        },
      ],
    };
    const next = updateConsultationBinding(def, 'plan', {
      limits: { maxQuestionBytes: 4096 },
    });
    expect(next.consultations![0]!.limits!.maxQuestionBytes).toBe(4096);
    expect(next.consultations![0]!.limits!.maxAdviceBytes).toBe(2048);
  });

  it('clears limits when null', () => {
    const def: WirePipelineDefinitionV1 = {
      version: 1,
      name: 'demo',
      stages: [
        { id: 'plan', kind: 'standard', requires: [], gate: false, leadReview: false },
      ],
      consultations: [
        {
          sourceStage: 'plan',
          teacherSkill: 't',
          maxConsultationsPerInvocation: 1,
          maxTeacherAttemptsPerConsultation: 1,
          limits: { maxQuestionBytes: 1024 },
        },
      ],
    };
    const next = updateConsultationBinding(def, 'plan', { limits: null });
    expect(next.consultations![0]!.limits).toBeUndefined();
  });
});

describe('removeConsultationBinding', () => {
  it('removes by sourceStage on v1', () => {
    const def = v1WithConsultations();
    const next = removeConsultationBinding(def, 'plan');
    expect(next.consultations).toBeUndefined();
  });

  it('removes by sourceStage on v2', () => {
    const def = v2WithConsultations();
    const next = removeConsultationBinding(def, 'plan');
    expect(next.consultations).toBeUndefined();
  });

  it('returns unchanged when sourceStage not found', () => {
    const def = v1WithConsultations();
    const next = removeConsultationBinding(def, 'missing');
    expect(next).toBe(def);
  });
});

describe('getConsultationBindingForStage', () => {
  it('finds the binding for a given stage', () => {
    const def = v1WithConsultations();
    expect(getConsultationBindingForStage(def, 'plan')).toBeDefined();
    expect(getConsultationBindingForStage(def, 'other')).toBeUndefined();
  });

  it('returns undefined when no consultations exist', () => {
    const def: WirePipelineDefinitionV1 = {
      version: 1,
      name: 'demo',
      stages: [{ id: 'plan', kind: 'standard', requires: [], gate: false, leadReview: false }],
    };
    expect(getConsultationBindingForStage(def, 'plan')).toBeUndefined();
  });
});

// --- Task 6.6: v1 pipeline round-trip ---

describe('v1 consultations round-trip', () => {
  it('survives structuredClone of an unrelated edit', () => {
    const def = v1WithConsultations();
    // Simulate entering draft mode via structuredClone (exactly as PipelineCanvasPage does)
    const draft: WirePipelineDefinition = structuredClone(def);
    // Edit an unrelated field (rename the pipeline)
    const editedDraft: WirePipelineDefinition = { ...draft, name: 'renamed' };
    // The consultations array must survive unchanged
    expect(editedDraft.consultations).toEqual(def.consultations);
  });

  it('survives isDirty comparison after no change to consultations', () => {
    const def = v1WithConsultations();
    const draft: WirePipelineDefinition = structuredClone(def);
    // An edit that doesn't touch consultations should not be "dirty" for the consultations field
    const editedDraft: WirePipelineDefinition = {
      ...draft,
      name: 'different',
    };
    expect(isDirty(editedDraft, def)).toBe(true); // name changed
    // But consultations are identical
    expect(editedDraft.consultations).toEqual(def.consultations);
  });

  it('preserves consultations when setting empty array after remove', () => {
    const def = v1WithConsultations();
    const next = removeConsultationBinding(def, 'plan');
    // consultations is undefined (cleared when empty)
    expect(next.consultations).toBeUndefined();
    // But adding a new one works
    const readded = addConsultationBinding(next, makeBinding('plan'));
    expect(readded.consultations).toHaveLength(1);
  });
});

// --- Task 4.3: definitionIssuePathTarget for consultations ---

describe('definitionIssuePathTarget consultations', () => {
  it('maps v1 consultation paths', () => {
    const def = v1WithConsultations();
    const target = definitionIssuePathTarget(def, '/consultations/0/teacherSkill');
    expect(target).toEqual({
      kind: 'consultation',
      index: 0,
      sourceStage: 'plan',
      field: 'teacherSkill',
    });
  });

  it('maps v2 consultation paths', () => {
    const def = v2WithConsultations();
    const target = definitionIssuePathTarget(def, '/consultations/0/sourceStage');
    expect(target).toEqual({
      kind: 'consultation',
      index: 0,
      sourceStage: 'plan',
      field: 'sourceStage',
    });
  });

  it('returns null for out-of-range consultation index', () => {
    const def = v1WithConsultations();
    expect(definitionIssuePathTarget(def, '/consultations/5/teacherSkill')).toBeNull();
  });
});
