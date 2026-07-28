import { describe, it, expect } from 'vitest';

import {
  WHITELIST,
  getBoundedCliEntry,
  getSupervisedEntry,
} from '../../../src/core/management-api/whitelist.js';

/**
 * Whitelist coverage for the workflow- and pipeline-library bounded-cli ops
 * (change-submission delta: "Whitelisted operations only, across the change,
 * space, workflow, and pipeline bounded-CLI operations").
 *
 * COUNT: the bounded tier is exactly FOURTEEN ops (create-change + three
 * space ops + four workflow ops + five pipeline ops (incl. `save-pipeline`,
 * pipeline-definition-api) + the per-space workflow-enablement apply op,
 * space-workflow-enablement design D5). The merged table is whole here, so
 * the exact-fourteen assertion below pins it.
 */
describe('workflow-library bounded-cli whitelist ops', () => {
  const WORKFLOW_OPS = ['import-workflow', 'init-workflow', 'export-workflow', 'delete-workflow'] as const;
  const PIPELINE_OPS = ['import-pipeline', 'init-pipeline', 'export-pipeline', 'delete-pipeline', 'save-pipeline'] as const;

  const boundedOps = Object.values(WHITELIST)
    .filter((entry) => entry.tier === 'bounded-cli')
    .map((entry) => entry.op);

  it('registers all four workflow ops in the bounded-cli tier alongside create-change', () => {
    for (const op of WORKFLOW_OPS) {
      expect(boundedOps, op).toContain(op);
    }
    expect(boundedOps).toContain('create-change');
  });

  it('registers all four pipeline ops in the bounded-cli tier', () => {
    for (const op of PIPELINE_OPS) {
      expect(boundedOps, op).toContain(op);
    }
  });

  it('pins the merged bounded-cli tier to exactly the fourteen enumerated ops', () => {
    expect([...boundedOps].sort()).toEqual(
      [
        'create-change',
        'create-project-space',
        'register-store-space',
        'setup-store-space',
        'import-workflow',
        'init-workflow',
        'export-workflow',
        'delete-workflow',
        'import-pipeline',
        'init-pipeline',
        'export-pipeline',
        'delete-pipeline',
        'save-pipeline',
        'workflow-enablement-update',
      ].sort(),
    );
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
