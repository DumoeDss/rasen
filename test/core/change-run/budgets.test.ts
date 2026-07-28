import { describe, expect, it } from 'vitest';

import {
  BudgetError,
  assertRecordBudget,
  paginate,
  recordByteSize,
} from '../../../src/core/change-run/internal/budgets.js';
import { bugFixPlan, startRecord } from './reconciler-fixture.js';

describe('aggregate budgets (9.7/9.8)', () => {
  it('accepts a healthy Record within all budgets', () => {
    const record = startRecord(bugFixPlan());
    expect(() => assertRecordBudget(record)).not.toThrow();
    expect(recordByteSize(record)).toBeGreaterThan(0);
  });

  it('rejects a Record that exceeds the transition budget', () => {
    const record = startRecord(bugFixPlan());
    const oversized = {
      ...record,
      transitions: new Array(10).fill({ kind: 'RunStarted', transitionOrdinal: 0 }),
    };
    expect(() =>
      assertRecordBudget(oversized as never, {
        maxTransitions: 5,
        maxActions: 100,
        maxEvidenceRefsPerAction: 64,
        maxRecordBytes: 8 * 1024 * 1024,
        listSummaryLimit: 100,
        listCandidateLimit: 512,
      })
    ).toThrowError(BudgetError);
  });

  it('rejects a Record whose byte size exceeds the budget', () => {
    const record = startRecord(bugFixPlan());
    const oversized = { ...record, inputs: { blob: 'x'.repeat(10_000) } };
    expect(() =>
      assertRecordBudget(oversized as never, {
        maxTransitions: 50_000,
        maxActions: 10_000,
        maxEvidenceRefsPerAction: 64,
        maxRecordBytes: 100,
        listSummaryLimit: 100,
        listCandidateLimit: 512,
      })
    ).toThrowError(BudgetError);
  });

  it('paginates a list with a stable opaque cursor', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const page1 = paginate(items, 0, 100);
    expect(page1.page).toHaveLength(100);
    const page2 = paginate(items, page1.nextCursor, 100);
    expect(page2.page).toHaveLength(100);
    const page3 = paginate(items, page2.nextCursor, 100);
    expect(page3.page).toHaveLength(50);
    expect(page3.nextCursor).toBe(250);
    // Cursor past the end yields an empty page.
    expect(paginate(items, 9999, 100).page).toEqual([]);
  });
});
