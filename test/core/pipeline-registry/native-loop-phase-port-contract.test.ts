import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/index.js';

const VERSION = `sha256:${'a'.repeat(64)}`;
const execution = (role: 'reviewer' | 'fixer', access: 'read' | 'write') => ({
  version: 1 as const,
  role,
  workspace: { access },
});

const catalog = createCapabilityCatalogSnapshot([
  {
    id: 'skill:review', version: VERSION, availability: 'enabled',
    inputs: [], artifacts: [], outcomes: ['done'], limits: {},
    phaseContracts: [
      'review-cycle/review',
      'review-cycle/triage',
      'review-cycle/re-review',
    ],
  },
  {
    id: 'skill:review-fix', version: VERSION, availability: 'enabled',
    inputs: [], artifacts: [], outcomes: ['done'], limits: {},
    phaseContracts: ['review-cycle/fix'],
  },
  {
    id: 'skill:strategy', version: VERSION, availability: 'enabled',
    inputs: [], artifacts: [], outcomes: ['done'], limits: {},
  },
]);

const source: DefinitionSourceV2 = {
  version: 2,
  id: 'native-review-phase-contract',
  sourceId: 'fixture:native-review-phase-contract',
  name: 'native-review-phase-contract',
  inputs: [],
  artifacts: [],
  outcomes: ['completed'],
  declarations: [{
    id: 'review-body', kind: 'Composite', provenance: 'built-in',
    inputs: [{ name: 'start', type: 'ecp/control' }], artifacts: [],
    outcomes: ['clean', 'needs_fix'],
    graph: {
      nodes: [
        { id: 'review', kind: 'AtomicStage', capability: { id: 'skill:review', version: VERSION }, execution: execution('reviewer', 'read'), reviewCyclePhase: 'review' },
        { id: 'triage', kind: 'AtomicStage', capability: { id: 'skill:review', version: VERSION }, execution: execution('reviewer', 'read'), reviewCyclePhase: 'triage' },
        { id: 'fix', kind: 'AtomicStage', capability: { id: 'skill:review-fix', version: VERSION }, execution: execution('fixer', 'write'), reviewCyclePhase: 'fix' },
        { id: 're-review', kind: 'AtomicStage', capability: { id: 'skill:review', version: VERSION }, execution: execution('reviewer', 'read'), reviewCyclePhase: 're-review' },
      ],
      connections: [
        { id: 'review-triage', from: { node: 'review', port: 'findings' }, to: { node: 'triage', port: 'start' } },
        { id: 'triage-fix', from: { node: 'triage', port: 'ready' }, to: { node: 'fix', port: 'start' } },
        { id: 'fix-rereview', from: { node: 'fix', port: 'fixed' }, to: { node: 're-review', port: 'start' } },
      ],
    },
  }],
  root: {
    nodes: [
      {
        id: 'review-loop', kind: 'BoundedLoop', body: 'review-body',
        limits: { maxIterations: 3, maxActions: 48, budget: 48 },
        lifecycle: {
          version: 1,
          thresholds: { stallIterations: 2, sameBlockerAttempts: 3 },
          strategy: { maxAttempts: 1, requireMaterialChange: true, capability: { id: 'skill:strategy', version: VERSION } },
          exits: {
            iterationLimit: { action: 'strategy' },
            actionLimit: { action: 'fail', outcome: 'action-limit' },
            budgetLimit: { action: 'fail', outcome: 'budget-limit' },
            stalled: { action: 'strategy' },
            blocked: { action: 'human-required', outcome: 'human-required' },
            strategyExhausted: { action: 'fail', outcome: 'strategy-exhausted' },
          },
        },
        exits: { clean: { action: 'exit', outcome: 'review-clean' }, needs_fix: { action: 'continue' } },
      },
      { id: 'finish', kind: 'Finish', outcome: 'completed' },
    ],
    connections: [
      { id: 'loop-finish', from: { node: 'review-loop', port: 'review-clean' }, to: { node: 'finish', port: 'start' } },
    ],
  },
};

describe('native loop phase port contract', () => {
  it('closes ReviewCycle phase outcomes independently of a generic skill done outcome', () => {
    const prepared = EcpDefinitionModule.prepare(source, catalog);
    expect(prepared.ok ? [] : prepared.error.diagnostics).toEqual([]);
    expect(prepared.ok).toBe(true);
  });
});
