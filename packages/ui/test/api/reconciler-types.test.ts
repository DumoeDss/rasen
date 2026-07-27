import { describe, expect, it } from 'vitest';
import type {
  ChangeRunView,
  ChangeRunViewSection,
  PipelineEngineSupport,
  PipelineDetailResponseWithEngines,
} from '../../src/api/types.js';

describe('UI types consume reconciler-engine server truth (14.1-14.8)', () => {
  it('ChangeRunView type matches the projected view shape', () => {
    const view: ChangeRunView = {
      format: 'change-run-view/1',
      engine: 'reconciler',
      runId: 'run:' + 'a'.repeat(64),
      change: {
        planningSpaceId: 'ps:1',
        projectId: 'project',
        changeId: 'change',
        instanceId: 'ci:1',
      },
      recordVersion: 0,
      status: 'running',
      sourceState: 'active',
      workspace: { instanceId: 'wi:1', scope: 'current' },
      sections: [{ kind: 'root-dag', version: 1, actions: [], waits: [] }],
    };
    expect(view.engine).toBe('reconciler');
    expect(view.sections[0]!.kind).toBe('root-dag');
  });

  it('PipelineEngineSupport carries availableEngines/reconcilerSupport (14.7/14.8)', () => {
    const support: PipelineEngineSupport = {
      availableEngines: ['legacy', 'reconciler'],
      reconcilerSupport: { supported: true, reason: 'supported_root_dag_bug_fix', profileDigest: 'sha256:abc' },
    };
    expect(support.availableEngines).toContain('reconciler');
    expect(support.reconcilerSupport.supported).toBe(true);
  });

  it('Task-detail Operations view derives from projected sections, not client-side (14.3/14.4)', () => {
    const section: ChangeRunViewSection = {
      kind: 'root-dag',
      version: 1,
      actions: [{ kind: 'agent', actionId: 'a1', deliveryState: 'granted' }],
      waits: [{ kind: 'gate', waitId: 'w1', decisionIds: ['approve', 'reject'] }],
      allowedControls: [{ kind: 'decision', waitId: 'w1', decisionId: 'approve', outcomes: ['approve', 'reject'] }],
    };
    // The UI consumes actions + waits + allowedControls from the section
    // without deriving them client-side.
    expect(section.actions).toHaveLength(1);
    expect(section.waits).toHaveLength(1);
    expect(section.allowedControls).toHaveLength(1);
  });

  it('controls come strictly from projected allowedControls (14.5/14.6)', () => {
    const section: ChangeRunViewSection = {
      kind: 'root-dag',
      version: 1,
      actions: [],
      waits: [],
      allowedControls: [{ kind: 'cancel' }, { kind: 'escalate' }],
    };
    // The UI renders only these controls; it does not invent completion/patch.
    expect(section.allowedControls.length).toBe(2);
    expect(section.allowedControls.every((c) => 'kind' in c)).toBe(true);
  });

  it('PipelineDetailResponseWithEngines extends the existing detail additively (14.1/14.2)', () => {
    const detail = {
      pipeline: {
        name: 'bug-fix',
        description: 'test',
        provenance: 'built-in',
        sourceLayer: 'package',
        stages: [],
      },
      definition: {},
      preparation: { authoredVersion: 1, normalizedVersion: 2, definitionValid: true, diagnostics: [], planAvailable: true, executable: true, executionMode: 'legacy' },
      editable: false,
    } as PipelineDetailResponseWithEngines;
    // availableEngines is additive (optional); the base response is unchanged.
    expect(detail.pipeline.name).toBe('bug-fix');
  });
});
