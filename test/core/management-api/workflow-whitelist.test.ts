import { describe, it, expect } from 'vitest';

import {
  WHITELIST,
  getBoundedCliEntry,
  getSupervisedEntry,
} from '../../../src/core/management-api/whitelist.js';

/**
 * Whitelist coverage for the workflow-library bounded-cli ops (change-submission
 * delta: "Whitelisted operations only, across the change, space, and workflow
 * bounded-CLI operations").
 *
 * NOTE ON COUNT: the change-submission delta enumerates the bounded tier as
 * exactly EIGHT ops (create-change + three space ops + four workflow ops).
 * The three space ops (`create-project-space`, `register-store-space`,
 * `setup-store-space`) are added by the sibling spaces-page change, which lands
 * in a separate worktree; the LEAD reconciles the merged table (and can then
 * add the exact-eight assertion). This worktree's base carries only
 * `create-change`, so these tests assert THIS change's contribution — the four
 * workflow ops are present, bounded, and never cross-admitted with the
 * supervised (agent-session) tier — without pinning a count that is not yet
 * whole here.
 */
describe('workflow-library bounded-cli whitelist ops', () => {
  const WORKFLOW_OPS = ['import-workflow', 'init-workflow', 'export-workflow', 'delete-workflow'] as const;

  const boundedOps = Object.values(WHITELIST)
    .filter((entry) => entry.tier === 'bounded-cli')
    .map((entry) => entry.op);

  it('registers all four workflow ops in the bounded-cli tier alongside create-change', () => {
    for (const op of WORKFLOW_OPS) {
      expect(boundedOps, op).toContain(op);
    }
    expect(boundedOps).toContain('create-change');
  });

  it('admits each workflow op through getBoundedCliEntry only', () => {
    for (const op of WORKFLOW_OPS) {
      const entry = getBoundedCliEntry(op);
      expect(entry, op).toBeDefined();
      expect(entry?.tier).toBe('bounded-cli');
      expect(entry?.op).toBe(op);
      // A bounded op is never a supervised entry.
      expect(getSupervisedEntry(op), op).toBeUndefined();
    }
  });

  it('keeps agent-session ops out of the bounded tier (no cross-admission)', () => {
    // auto/goal are supervised long-runners, never bounded-cli.
    expect(boundedOps).not.toContain('auto');
    expect(boundedOps).not.toContain('goal');
    expect(getBoundedCliEntry('auto')).toBeUndefined();
    expect(getBoundedCliEntry('goal')).toBeUndefined();
    expect(getSupervisedEntry('auto')).toBeDefined();
    expect(getSupervisedEntry('goal')).toBeDefined();
  });

  it('does not admit an unknown op through either tier', () => {
    expect(getBoundedCliEntry('not-an-op')).toBeUndefined();
    expect(getSupervisedEntry('not-an-op')).toBeUndefined();
    expect(getBoundedCliEntry(undefined)).toBeUndefined();
  });
});
