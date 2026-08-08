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
 * COUNT: the bounded tier is exactly EIGHTEEN ops (create-change + three
 * space ops + four workflow ops + five pipeline ops (incl. `save-pipeline`,
 * pipeline-definition-api) + the per-space workflow-enablement apply op
 * (space-workflow-enablement design D5) + `finalize-change`, the Store
 * change-finalization op, which store-finalization-outcomes-v2 adds and which
 * is bounded because it is a read-only plan followed by one bounded apply,
 * both spawned as the CLI, + the three Store-scoped ops
 * store-scoped-issues-management adds:
 *
 *   `create-issue`            one Store-level Issue record, one lock, no Git verb
 *   `publish-execution-plan`  one immutable revision after reference verification
 *   `create-scoped-change`    a Change whose COMPLETE scope is in the path
 *
 * `create-scoped-change` is a separate entry from `create-change` on purpose:
 * the older op takes its scope from the server's launch project, the newer one
 * requires Store, project, and target line in the path and must never complete a
 * missing segment from a filter. One entry could not express both authority
 * requirements.
 *
 * The merged table is whole here, so the exact-eighteen assertion below pins it
 * — the list is EXTENDED by enumerating each new op with its reason, never
 * relaxed to a prefix or a tier-wide exemption.
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

  it('pins the merged bounded-cli tier to exactly the eighteen enumerated ops', () => {
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
        'finalize-change',
        'create-issue',
        'publish-execution-plan',
        'create-scoped-change',
      ].sort(),
    );
  });

  it('registers finalize-change as a bounded-cli op and never as a supervised one', () => {
    const entry = getBoundedCliEntry('finalize-change');
    expect(entry?.tier).toBe('bounded-cli');
    expect(entry?.op).toBe('finalize-change');
    expect(getSupervisedEntry('finalize-change')).toBeUndefined();
  });

  it('registers each Store-scoped op as bounded and never as a supervised one', () => {
    for (const op of ['create-issue', 'publish-execution-plan', 'create-scoped-change']) {
      const entry = getBoundedCliEntry(op);
      expect(entry?.tier, op).toBe('bounded-cli');
      expect(entry?.op, op).toBe(op);
      expect(getSupervisedEntry(op), op).toBeUndefined();
    }
  });

  /**
   * `store-scoped-issues-management` task 11.6. The Store route family adds
   * three mutation surfaces and an aggregate query, any of which could become a
   * second way to finalize a Change by accident. `finalize-change` stays the
   * ONLY bounded-cli op that reaches the finalization Module, and the count
   * above plus this assertion is what would catch a fourth being added.
   */
  it('keeps finalize-change the only bounded op that reaches finalization', () => {
    const finalizationOps = boundedOps.filter((op) => /finali[sz]/u.test(op));
    expect(finalizationOps).toEqual(['finalize-change']);
    for (const op of ['create-issue', 'publish-execution-plan', 'create-scoped-change']) {
      expect(op).not.toMatch(/finali[sz]/u);
    }
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
