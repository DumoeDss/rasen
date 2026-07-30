import {
  decodeCanonicalRunRecord,
  digestCanonicalRunRecord,
  type CanonicalRunRecord,
} from './record.js';
import type { RunId } from '../contracts.js';

export type RunStoreErrorCode =
  | 'run_already_exists'
  | 'run_not_found'
  | 'run_record_predecessor_mismatch'
  | 'run_record_version_gap';

export class RunStoreError extends Error {
  constructor(
    readonly code: RunStoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'RunStoreError';
  }
}

export interface RunSummary {
  readonly runId: RunId;
  readonly recordVersion: number;
  readonly status: CanonicalRunRecord['status'];
  readonly terminal: CanonicalRunRecord['terminal'];
}

/**
 * An immutable, append-only Run Record ledger (task 9.1). Each committed
 * revision's predecessor digest must equal the digest of the current head and
 * its version must be exactly head+1 (no-gap full-chain validation). `load`
 * returns only the head; there is no earlier-revision fallback.
 */
export interface RunStore {
  readonly create: (runId: RunId, initial: CanonicalRunRecord) => void;
  readonly load: (runId: RunId) => CanonicalRunRecord;
  readonly commit: (runId: RunId, next: CanonicalRunRecord) => void;
  readonly has: (runId: RunId) => boolean;
  readonly list: () => readonly RunSummary[];
  /**
   * Persist the sealed RuntimePlan alongside the Record so read paths without
   * access to the launch context (management API, operations) can project the
   * review-cycle section. Called once at Run creation; the plan is immutable.
   */
  readonly writePlan?: (runId: RunId, plan: unknown) => void;
  /**
   * Load the sealed RuntimePlan for a Run. Returns null if no plan was
   * persisted (e.g. a Run created before plan persistence was added).
   */
  readonly loadPlan?: (runId: RunId) => unknown | null;
}

export function createInMemoryRunStore(): RunStore {
  const heads = new Map<string, CanonicalRunRecord>();
  const plans = new Map<string, unknown>();

  const decode = (record: CanonicalRunRecord): CanonicalRunRecord =>
    decodeCanonicalRunRecord(JSON.parse(JSON.stringify(record)));

  return Object.freeze({
    create(runId: RunId, initial: CanonicalRunRecord) {
      if (heads.has(runId)) {
        throw new RunStoreError(
          'run_already_exists',
          'A Run with this RunId already exists in the store.'
        );
      }
      heads.set(runId, decode(initial));
    },
    writePlan(runId: RunId, plan: unknown) {
      plans.set(runId, JSON.parse(JSON.stringify(plan)));
    },
    loadPlan(runId: RunId) {
      return plans.get(runId) ?? null;
    },
    load(runId: RunId) {
      const head = heads.get(runId);
      if (head === undefined) {
        throw new RunStoreError('run_not_found', 'No Run with this RunId.');
      }
      return head;
    },
    commit(runId: RunId, next: CanonicalRunRecord) {
      const head = heads.get(runId);
      if (head === undefined) {
        throw new RunStoreError('run_not_found', 'Cannot commit to an absent Run.');
      }
      if (next.recordVersion !== head.recordVersion + 1) {
        throw new RunStoreError(
          'run_record_version_gap',
          'Committed Record version must be exactly head + 1.'
        );
      }
      if (next.previousRecordDigest !== digestCanonicalRunRecord(head)) {
        throw new RunStoreError(
          'run_record_predecessor_mismatch',
          'Committed Record predecessor digest must equal the head digest.'
        );
      }
      heads.set(runId, decode(next));
    },
    has(runId: RunId) {
      return heads.has(runId);
    },
    list(): readonly RunSummary[] {
      return [...heads.values()].map((record) =>
        Object.freeze({
          runId: record.runId,
          recordVersion: record.recordVersion,
          status: record.status,
          terminal: record.terminal,
        })
      );
    },
  });
}
