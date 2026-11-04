import type { BoundedLoopLifecyclePolicyV1 } from '../../../src/core/pipeline-registry/definition.js';

export function fixtureLoopLifecycle(
  outcome = 'loop_exhausted'
): BoundedLoopLifecyclePolicyV1 {
  return {
    version: 1,
    thresholds: { stallIterations: 99, sameBlockerAttempts: 99 },
    strategy: { maxAttempts: 0, requireMaterialChange: true },
    exits: {
      iterationLimit: { action: 'escalate', outcome },
      actionLimit: { action: 'escalate', outcome: 'loop_action_limit' },
      budgetLimit: { action: 'escalate', outcome: 'loop_budget_limit' },
      stalled: { action: 'escalate', outcome: 'loop_stalled' },
      blocked: { action: 'escalate', outcome: 'loop_blocked' },
      strategyExhausted: {
        action: 'escalate',
        outcome: 'loop_strategy_exhausted',
      },
    },
  };
}

export function fixtureRuntimeLoop(
  maxIterations: number,
  maxActions = maxIterations * 16,
  outcome = 'loop_exhausted'
) {
  return {
    limits: { maxIterations, maxActions, budget: maxActions },
    lifecycle: fixtureLoopLifecycle(outcome),
  } as const;
}
