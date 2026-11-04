// @vitest-environment jsdom
/**
 * Task 6.5 — V2NodePanel integration: verify the consultation section appears
 * for AtomicStage nodes that have a consultation binding, does NOT appear for
 * other node kinds, and preserves all existing editors unchanged.
 */
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { V2NodePanel } from '../../src/canvas/V2NodePanel.js';
import type {
  PipelineCatalogResponse,
  WireAtomicStageNode,
  WireBoundedLoopNode,
  WireConsultationBinding,
  WireDefinitionNode,
  WireGateNode,
  WirePipelineDefinitionV2,
} from '../../src/api/types.js';

const NOOP = () => {};
const NOOP_RENAME = (_id: string) => {};

function makeCatalog(): PipelineCatalogResponse {
  return {
    roles: [],
    skills: [
      {
        id: 'rasen-teacher-advisor',
        skillName: 'rasen-teacher-advisor',
        description: 'Teacher advisor',
        enabled: true,
        capability: {
          id: 'rasen-teacher-advisor',
          version: '1.0.0',
          inputs: [],
          artifacts: [],
          outcomes: [],
        },
      },
    ],
    runtimes: [],
    stageKinds: [],
    loopKinds: [],
    verifyPolicies: [],
    conditionLabels: [],
    gate: { default: false },
    handoff: { fractionRange: [0, 1], remainingTokensGt: 0 },
  } as unknown as PipelineCatalogResponse;
}

function makeAtomicStage(): WireAtomicStageNode {
  return {
    id: 'plan',
    kind: 'AtomicStage',
    capability: { id: 'rasen-planner', version: '1.0.0' },
  };
}

function makeGate(): WireGateNode {
  return {
    id: 'approval',
    kind: 'Gate',
    target: 'plan',
    outcomes: ['approved', 'rejected'],
    dispositions: { approved: 'proceed', rejected: 'fail' },
  };
}

function makeBoundedLoop(): WireBoundedLoopNode {
  return {
    id: 'loop',
    kind: 'BoundedLoop',
    body: 'loop-body',
    exits: {},
    limits: { maxIterations: 3, maxActions: 10, budget: 100 },
    lifecycle: {
      thresholds: { stallIterations: 2, sameBlockerAttempts: 3 },
      strategy: { maxAttempts: 2, capability: null, requireMaterialChange: true },
      exits: {},
    },
  } as WireBoundedLoopNode;
}

const CONSULTATION_BINDING: WireConsultationBinding = {
  sourceStage: 'plan',
  teacherSkill: 'rasen-teacher-advisor',
  maxConsultationsPerInvocation: 3,
  maxTeacherAttemptsPerConsultation: 2,
};

function makeV2(nodes: WireDefinitionNode[]): WirePipelineDefinitionV2 {
  return {
    version: 2,
    id: 'pipeline:demo',
    sourceId: 'canvas:demo',
    name: 'demo',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations: [
      {
        id: 'loop-body',
        provenance: 'authored',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [{ id: 'work', kind: 'AtomicStage', capability: { id: 'rasen-worker', version: '1.0.0' } }],
          connections: [],
        },
      },
    ],
    root: { nodes, connections: [] },
    consultations: [CONSULTATION_BINDING],
  };
}

describe('V2NodePanel consultation integration', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('renders consultation section for AtomicStage node with a binding', () => {
    const def = makeV2([makeAtomicStage()]);
    render(
      <V2NodePanel
        node={makeAtomicStage()}
        catalog={makeCatalog()}
        definition={def}
        fullDefinition={def}
        fieldIssues={{}}
        onRename={NOOP_RENAME}
        onPatch={vi.fn()}
        onClose={NOOP}
      />,
      container
    );

    // Consultation editor appears for AtomicStage with a binding
    expect(
      container.querySelector('[data-testid="consultation-binding-editor"]')
    ).not.toBeNull();

    // Execution editor is still present (unchanged)
    expect(
      container.querySelector('[data-testid="v2-node-panel-capability"]')
    ).not.toBeNull();
  });

  it('does not render consultation section for non-AtomicStage nodes (Gate)', () => {
    const def = makeV2([makeAtomicStage(), makeGate()]);
    render(
      <V2NodePanel
        node={makeGate()}
        catalog={makeCatalog()}
        definition={def}
        fullDefinition={def}
        fieldIssues={{}}
        onRename={NOOP_RENAME}
        onPatch={vi.fn()}
        onClose={NOOP}
      />,
      container
    );

    // Consultation editor does NOT appear for Gate
    expect(
      container.querySelector('[data-testid="consultation-binding-editor"]')
    ).toBeNull();

    // Gate editor is still present (unchanged)
    expect(
      container.querySelector('[data-testid="v2-gate-editor"]')
    ).not.toBeNull();
  });

  it('does not render consultation section for non-AtomicStage nodes (BoundedLoop)', () => {
    const def = makeV2([makeAtomicStage(), makeBoundedLoop()]);
    render(
      <V2NodePanel
        node={makeBoundedLoop()}
        catalog={makeCatalog()}
        definition={def}
        fullDefinition={def}
        fieldIssues={{}}
        onRename={NOOP_RENAME}
        onPatch={vi.fn()}
        onClose={NOOP}
      />,
      container
    );

    // Consultation editor does NOT appear for BoundedLoop
    expect(
      container.querySelector('[data-testid="consultation-binding-editor"]')
    ).toBeNull();

    // BoundedLoop editor is still present (unchanged)
    expect(
      container.querySelector('[data-testid="v2-node-panel-bounded-loop"]')
    ).not.toBeNull();
  });

  it('does not render consultation section when fullDefinition is absent', () => {
    const def = makeV2([makeAtomicStage()]);
    render(
      <V2NodePanel
        node={makeAtomicStage()}
        catalog={makeCatalog()}
        definition={def}
        fieldIssues={{}}
        onRename={NOOP_RENAME}
        onPatch={vi.fn()}
        onClose={NOOP}
      />,
      container
    );

    // Without fullDefinition the consultation section is not rendered
    expect(
      container.querySelector('[data-testid="consultation-binding-editor"]')
    ).toBeNull();

    // Execution editor is still present (unchanged)
    expect(
      container.querySelector('[data-testid="v2-node-panel-capability"]')
    ).not.toBeNull();
  });
});
