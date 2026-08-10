// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationBindingEditor } from '../../src/canvas/ConsultationBindingEditor.js';
import type {
  PipelineCatalogResponse,
  WireConsultationBinding,
  WirePipelineDefinitionV2,
} from '../../src/api/types.js';

const NO_ERRORS: Readonly<Record<string, never>> = {};

function makeV2(): WirePipelineDefinitionV2 {
  return {
    version: 2,
    id: 'pipeline:demo',
    sourceId: 'canvas:demo',
    name: 'demo',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations: [],
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
  };
}

function makeCatalog(): PipelineCatalogResponse {
  return {
    skills: [
      {
        skillName: 'rasen-teacher-advisor',
        enabled: true,
        capability: { id: 'rasen-teacher-advisor', version: '1.0.0' },
      },
      {
        skillName: 'rasen-disabled-teacher-advisor',
        enabled: false,
        capability: { id: 'rasen-disabled-teacher-advisor', version: '1.0.0' },
      },
    ],
  } as unknown as PipelineCatalogResponse;
}

describe('ConsultationBindingEditor', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('shows add-binding action when no binding exists', () => {
    const onAdd = vi.fn();
    render(
      <ConsultationBindingEditor
        stageId="plan"
        definition={makeV2()}
        catalog={makeCatalog()}
        binding={undefined}
        draftErrors={NO_ERRORS}
        resetKey="demo\0plan"
        onAddBinding={onAdd}
        onPatchBinding={vi.fn()}
        onRemoveBinding={vi.fn()}
      />,
      container
    );
    const addButton = container.querySelector('[data-testid="consultation-add-binding"]');
    expect(addButton).not.toBeNull();
    expect(container.querySelector('[data-testid="consultation-remove-binding"]')).toBeNull();
  });

  it('shows remove action when binding exists', () => {
    const binding: WireConsultationBinding = {
      sourceStage: 'plan',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 3,
      maxTeacherAttemptsPerConsultation: 2,
    };
    const onRemove = vi.fn();
    render(
      <ConsultationBindingEditor
        stageId="plan"
        definition={makeV2()}
        catalog={makeCatalog()}
        binding={binding}
        draftErrors={NO_ERRORS}
        resetKey="demo\0plan"
        onAddBinding={vi.fn()}
        onPatchBinding={vi.fn()}
        onRemoveBinding={onRemove}
      />,
      container
    );
    expect(container.querySelector('[data-testid="consultation-remove-binding"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="consultation-add-binding"]')).toBeNull();
  });

  it('renders Teacher skill selector with enabled/disabled state', () => {
    const binding: WireConsultationBinding = {
      sourceStage: 'plan',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 3,
      maxTeacherAttemptsPerConsultation: 2,
    };
    render(
      <ConsultationBindingEditor
        stageId="plan"
        definition={makeV2()}
        catalog={makeCatalog()}
        binding={binding}
        draftErrors={NO_ERRORS}
        resetKey="demo\0plan"
        onAddBinding={vi.fn()}
        onPatchBinding={vi.fn()}
        onRemoveBinding={vi.fn()}
      />,
      container
    );
    const select = container.querySelector(
      '[data-testid="consultation-teacher-skill"]'
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const disabledOption = Array.from(select!.options).find(
      (o) => o.value === 'rasen-disabled-teacher-advisor'
    );
    expect(disabledOption).not.toBeUndefined();
    expect(disabledOption!.disabled).toBe(true);
    const enabledOption = Array.from(select!.options).find(
      (o) => o.value === 'rasen-teacher-advisor'
    );
    expect(enabledOption).not.toBeUndefined();
    expect(enabledOption!.disabled).toBe(false);
  });

  it('renders limit fields', () => {
    const binding: WireConsultationBinding = {
      sourceStage: 'plan',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 3,
      maxTeacherAttemptsPerConsultation: 2,
    };
    render(
      <ConsultationBindingEditor
        stageId="plan"
        definition={makeV2()}
        catalog={makeCatalog()}
        binding={binding}
        draftErrors={NO_ERRORS}
        resetKey="demo\0plan"
        onAddBinding={vi.fn()}
        onPatchBinding={vi.fn()}
        onRemoveBinding={vi.fn()}
      />,
      container
    );
    expect(
      container.querySelector('[data-testid="consultation-max-consultations"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="consultation-max-attempts"]')
    ).not.toBeNull();
  });

  it('does not claim Teacher runtime availability', () => {
    const binding: WireConsultationBinding = {
      sourceStage: 'plan',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 3,
      maxTeacherAttemptsPerConsultation: 2,
    };
    render(
      <ConsultationBindingEditor
        stageId="plan"
        definition={makeV2()}
        catalog={makeCatalog()}
        binding={binding}
        draftErrors={NO_ERRORS}
        resetKey="demo\0plan"
        onAddBinding={vi.fn()}
        onPatchBinding={vi.fn()}
        onRemoveBinding={vi.fn()}
      />,
      container
    );
    const muted = container.querySelectorAll('.stage-panel__muted');
    const texts = Array.from(muted).map((el) => el.textContent ?? '');
    expect(texts.some((t) => t.includes('platform-dependent'))).toBe(true);
    expect(texts.some((t) => t.includes('guaranteed'))).toBe(false);
  });

  it('has data-state="present" when binding exists and "absent" when not', () => {
    const binding: WireConsultationBinding = {
      sourceStage: 'plan',
      teacherSkill: 'rasen-teacher-advisor',
      maxConsultationsPerInvocation: 3,
      maxTeacherAttemptsPerConsultation: 2,
    };
    render(
      <ConsultationBindingEditor
        stageId="plan"
        definition={makeV2()}
        catalog={makeCatalog()}
        binding={binding}
        draftErrors={NO_ERRORS}
        resetKey="demo\0plan"
        onAddBinding={vi.fn()}
        onPatchBinding={vi.fn()}
        onRemoveBinding={vi.fn()}
      />,
      container
    );
    const sectionWith = container.querySelector(
      '[data-testid="consultation-binding-editor"]'
    );
    expect(sectionWith!.getAttribute('data-state')).toBe('present');

    render(
      <ConsultationBindingEditor
        stageId="plan"
        definition={makeV2()}
        catalog={makeCatalog()}
        binding={undefined}
        draftErrors={NO_ERRORS}
        resetKey="demo\0plan"
        onAddBinding={vi.fn()}
        onPatchBinding={vi.fn()}
        onRemoveBinding={vi.fn()}
      />,
      container
    );
    const sectionWithout = container.querySelector(
      '[data-testid="consultation-binding-editor"]'
    );
    expect(sectionWithout!.getAttribute('data-state')).toBe('absent');
  });
});
