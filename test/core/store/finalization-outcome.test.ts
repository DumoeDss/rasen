/**
 * `store-finalization-outcomes-v2` task 3.8 — outcome resolution and its guards.
 *
 * Every refusal here is reachable with NO filesystem and NO Git access at all,
 * which is the property the contract asks for: a Store v2 archive that names no
 * outcome, or names a contradictory combination, never reads a planning file,
 * never runs Git, and never touches the destination. The suite asserts that
 * property by construction — it supplies no adapters whatsoever, so anything
 * that reached for one would throw a different error than the one asserted.
 */
import { describe, expect, it } from 'vitest';

import {
  resolveFinalizationOutcomeRequest,
  specSkipConflict,
  validateResolvedOutcome,
  type ChangeFinalizationError,
  type ResolvedOutcomeRequest,
} from '../../../src/core/store/finalization/index.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
} from '../../../src/core/store/planning-identity.js';

const STORE_UID = '6f7d4d70-3d2c-4a37-9f8a-0f4c1b2e3d55';
const OTHER_STORE_UID = '11111111-2222-4333-8444-555555555555';

function codeOf(error: unknown): string {
  return (error as ChangeFinalizationError).finalizationCode;
}

function refusalFor(request: Record<string, string | undefined>): ChangeFinalizationError {
  try {
    resolveFinalizationOutcomeRequest(request);
  } catch (error) {
    return error as ChangeFinalizationError;
  }
  throw new Error(`expected a refusal for ${JSON.stringify(request)}`);
}

function scopeFor(projectId: string, targetLineId: string, storeUid = STORE_UID) {
  const planningScopeId = derivePlanningScopeId({ storeUid, projectId, targetLineId });
  return {
    storeUid,
    projectId,
    targetLineId,
    changeInstanceId: deriveChangeInstanceId({
      planningScopeId,
      instanceSeed: 'a'.repeat(32),
    }) as string,
  };
}

const CURRENT = scopeFor('app-a', 'line-0.2');
const SAME_PROJECT_OTHER_LINE = {
  ...scopeFor('app-a', 'line-0.3'),
};
const OTHER_PROJECT = scopeFor('app-b', 'line-0.2');
const OTHER_STORE = scopeFor('app-a', 'line-0.2', OTHER_STORE_UID);

describe('the four outcomes', () => {
  it('resolves landed with no reason and no successor', () => {
    expect(resolveFinalizationOutcomeRequest({ outcome: 'landed' })).toEqual({
      outcome: 'landed',
      reason: null,
      supersededBy: null,
      byTargetLine: null,
      commit: null,
    } satisfies ResolvedOutcomeRequest);
  });

  it('resolves superseded with a reason and a successor', () => {
    expect(
      resolveFinalizationOutcomeRequest({
        outcome: 'superseded',
        reason: 'The work moved to 0.2.0.',
        by: SAME_PROJECT_OTHER_LINE.changeInstanceId,
      })
    ).toEqual({
      outcome: 'superseded',
      reason: 'The work moved to 0.2.0.',
      supersededBy: SAME_PROJECT_OTHER_LINE.changeInstanceId,
      byTargetLine: null,
      commit: null,
    });
  });

  it.each(['cancelled', 'abandoned'] as const)('resolves %s with a reason', outcome => {
    expect(
      resolveFinalizationOutcomeRequest({ outcome, reason: 'Not pursued.' })
    ).toMatchObject({ outcome, reason: 'Not pursued.', supersededBy: null });
  });

  it('trims surrounding whitespace rather than treating it as content', () => {
    expect(
      resolveFinalizationOutcomeRequest({ outcome: '  landed  ' })
    ).toMatchObject({ outcome: 'landed' });
  });
});

describe('the missing-outcome refusal', () => {
  it.each([{}, { outcome: '' }, { outcome: '   ' }])(
    'refuses %j with finalization_outcome_required',
    request => {
      const error = refusalFor(request);
      expect(codeOf(error)).toBe('finalization_outcome_required');
      // It names ALL FOUR outcomes, and which one needs a reason and which
      // needs a successor.
      for (const outcome of ['landed', 'superseded', 'cancelled', 'abandoned']) {
        expect(error.message).toContain(outcome);
      }
      expect(error.message).toContain('reason');
      expect(error.message).toContain('--by <changeInstanceId>');
      // And it states that nothing happened.
      expect(error.diagnostic.fix).toContain('Nothing was read or written.');
    }
  );

  it('refuses an outcome that is not one of the four, naming the four', () => {
    const error = refusalFor({ outcome: 'shipped' });
    expect(codeOf(error)).toBe('finalization_outcome_invalid');
    expect(error.actual).toBe('shipped');
    expect(error.expected).toBe('landed, superseded, cancelled, abandoned');
  });
});

describe('the contradictory-combination refusals', () => {
  it('refuses --by on every non-superseded outcome', () => {
    for (const outcome of ['landed', 'cancelled', 'abandoned'] as const) {
      const error = refusalFor({
        outcome,
        ...(outcome === 'landed' ? {} : { reason: 'why' }),
        by: CURRENT.changeInstanceId,
      });
      expect(codeOf(error), outcome).toBe('finalization_outcome_invalid');
      expect(error.diagnostic.target, outcome).toBe('--by');
    }
  });

  it('refuses --by-target-line on every non-superseded outcome', () => {
    for (const outcome of ['landed', 'cancelled', 'abandoned'] as const) {
      const error = refusalFor({
        outcome,
        ...(outcome === 'landed' ? {} : { reason: 'why' }),
        byTargetLine: 'line-0.3',
      });
      expect(error.diagnostic.target, outcome).toBe('--by-target-line');
    }
  });

  it('refuses --reason on landed, because a landed record carries a proof', () => {
    const error = refusalFor({ outcome: 'landed', reason: 'we shipped it' });
    expect(codeOf(error)).toBe('finalization_outcome_invalid');
    expect(error.diagnostic.target).toBe('--reason');
    expect(error.message).toContain('it carries a proof');
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace only', '   \t  '],
  ])('refuses a %s reason on a non-landed outcome', (_label, reason) => {
    for (const outcome of ['superseded', 'cancelled', 'abandoned'] as const) {
      const error = refusalFor({
        outcome,
        ...(reason === undefined ? {} : { reason }),
        ...(outcome === 'superseded' ? { by: CURRENT.changeInstanceId } : {}),
      });
      expect(error.diagnostic.target, `${outcome}/${String(reason)}`).toBe('--reason');
      expect(error.actual).toBe(reason === undefined ? '(none)' : '(whitespace only)');
    }
  });

  it('refuses superseded with no successor', () => {
    const error = refusalFor({ outcome: 'superseded', reason: 'moved' });
    expect(error.diagnostic.target).toBe('--by');
    // An alias, a directory, or a branch name is never accepted in its place.
    expect(error.diagnostic.fix).toContain('a Change alias, a directory, or a branch name');
  });

  it('refuses --commit on every non-landed outcome', () => {
    for (const outcome of ['superseded', 'cancelled', 'abandoned'] as const) {
      const error = refusalFor({
        outcome,
        reason: 'why',
        ...(outcome === 'superseded' ? { by: CURRENT.changeInstanceId } : {}),
        commit: 'a'.repeat(40),
      });
      expect(error.diagnostic.target, outcome).toBe('--commit');
    }
  });
});

describe('the canonical validator decides scope, and this module adds no second one', () => {
  it('accepts a successor on another target line of the same project', () => {
    const resolved = resolveFinalizationOutcomeRequest({
      outcome: 'superseded',
      reason: 'The work moved to the next line.',
      by: SAME_PROJECT_OTHER_LINE.changeInstanceId,
    });
    expect(() =>
      validateResolvedOutcome(resolved, CURRENT, SAME_PROJECT_OTHER_LINE)
    ).not.toThrow();
  });

  it('refuses a cross-project successor', () => {
    const resolved = resolveFinalizationOutcomeRequest({
      outcome: 'superseded',
      reason: 'Another team took it.',
      by: OTHER_PROJECT.changeInstanceId,
    });
    let thrown: unknown;
    try {
      validateResolvedOutcome(resolved, CURRENT, OTHER_PROJECT);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_outcome_invalid');
  });

  it('refuses a cross-Store successor', () => {
    const resolved = resolveFinalizationOutcomeRequest({
      outcome: 'superseded',
      reason: 'Moved to another Store.',
      by: OTHER_STORE.changeInstanceId,
    });
    let thrown: unknown;
    try {
      validateResolvedOutcome(resolved, CURRENT, OTHER_STORE);
    } catch (error) {
      thrown = error;
    }
    // Pinned to the code AND the reason. A bare `.toThrow()` here accepted any
    // error at all — including a `TypeError` from a refactor — while the claim
    // is specifically that a successor in another STORE is refused as a scope
    // disagreement rather than, say, as a malformed id.
    expect(codeOf(thrown)).toBe('finalization_outcome_invalid');
    expect((thrown as Error).message).toMatch(/supersededBy: must resolve to the same/u);
  });

  it('validates a landed and a passive outcome with no successor scope at all', () => {
    for (const request of [
      { outcome: 'landed' },
      { outcome: 'cancelled', reason: 'Not pursued.' },
    ]) {
      expect(() =>
        validateResolvedOutcome(resolveFinalizationOutcomeRequest(request), CURRENT)
      ).not.toThrow();
    }
  });
});

describe('the --skip-specs conflict', () => {
  it('explains that a landed record asserts applied spec synchronization', () => {
    const error = specSkipConflict('redesign-routing') as ChangeFinalizationError;
    expect(codeOf(error)).toBe('finalization_spec_skip_conflict');
    expect(error.message).toContain('redesign-routing');
    expect(error.actual).toBe('--skip-specs');
    // Both repairs are named: land the deltas, or record a passive outcome.
    expect(error.diagnostic.fix).toContain('Drop --skip-specs');
    expect(error.diagnostic.fix).toContain('--outcome cancelled|abandoned|superseded');
  });
});
