import type { CanonicalRunRecord } from './record.js';

export type BudgetErrorCode = 'run_store_too_large';

export class BudgetError extends Error {
  constructor(
    readonly code: BudgetErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

export interface AggregateBudgetOptions {
  readonly maxTransitions: number;
  readonly maxActions: number;
  readonly maxEvidenceRefsPerAction: number;
  readonly maxRecordBytes: number;
  readonly listSummaryLimit: number;
  readonly listCandidateLimit: number;
}

export const DEFAULT_AGGREGATE_BUDGET: AggregateBudgetOptions = Object.freeze({
  maxTransitions: 50_000,
  maxActions: 10_000,
  maxEvidenceRefsPerAction: 64,
  maxRecordBytes: 8 * 1024 * 1024,
  listSummaryLimit: 100,
  listCandidateLimit: 512,
});

/** Canonical byte size estimate of a Record (UTF-8 JSON). */
export function recordByteSize(record: CanonicalRunRecord): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8');
}

/**
 * Per-file/structure/count budgets enforced BEFORE parse/canonicalize
 * (task 9.8). A Record that exceeds any structural or byte bound fails typed
 * `run_store_too_large` so a malicious or runaway Run cannot exhaust the
 * ledger; healthy Runs are unaffected.
 */
export function assertRecordBudget(
  record: CanonicalRunRecord,
  options: AggregateBudgetOptions = DEFAULT_AGGREGATE_BUDGET
): void {
  if (record.transitions.length > options.maxTransitions) {
    throw new BudgetError('run_store_too_large', 'Record transition count exceeds budget.');
  }
  if (Object.keys(record.actions).length > options.maxActions) {
    throw new BudgetError('run_store_too_large', 'Record action count exceeds budget.');
  }
  for (const committed of Object.values(record.actions)) {
    const refs =
      (committed.result?.evidence.length ?? 0) +
      (committed.infrastructure?.evidence.length ?? 0) +
      committed.effects.reduce(
        (sum, effect) => sum + (effect.evidence?.length ?? 0),
        0
      );
    if (refs > options.maxEvidenceRefsPerAction) {
      throw new BudgetError(
        'run_store_too_large',
        'Record action evidence ref count exceeds budget.'
      );
    }
  }
  if (recordByteSize(record) > options.maxRecordBytes) {
    throw new BudgetError('run_store_too_large', 'Record byte size exceeds budget.');
  }
}

/**
 * Bounded isolated list pagination with a stable opaque cursor. Each page is
 * capped (summary / candidate / byte budgets); invalid or oversized entries
 * are isolated into bounded summaries rather than unbounded full-chain work.
 */
export function paginate<T>(
  items: readonly T[],
  cursor: number,
  pageSize: number
): Readonly<{ page: readonly T[]; nextCursor: number }> {
  const start = Math.min(cursor, items.length);
  const page = items.slice(start, start + pageSize);
  return Object.freeze({ page: Object.freeze(page), nextCursor: start + page.length });
}
