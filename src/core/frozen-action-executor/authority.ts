/**
 * Frozen-action session executor: granted-Action consumption and authority
 * validation (design D1; requirement "The executor consumes only granted
 * frozen Actions and rebuilds no authority").
 *
 * The executor consumes ONLY committed, plan-frozen, currently-executable agent
 * Actions granted by the canonical Run Facade. Before any backend work it
 * validates Run id, Action id, invocation, effect, workspace, profile, adapter
 * authority, and Record version against the granted ActionView and the
 * committed Record. Authority is read from the granted ActionView and the
 * Record ONLY; it is never rebuilt from the live Definition, chat history, or
 * caller self-report (the function signature accepts neither).
 *
 * A duplicate dispatch, a stale Record version, a workspace that does not match
 * the granted ActionView, or an Action that is not currently executable all fail
 * closed with a typed outcome and execute no backend work.
 */

import type {
  ExactChangeRunRef,
  RunAction,
  WorkspaceRevision,
} from '../change-run/contracts.js';
import type { CanonicalRunRecord, CommittedAction } from '../change-run/internal/record.js';
import { canonicalJson } from '../change-run/internal/identity.js';

/**
 * The typed rejection codes. These map onto the Facade's existing error codes
 * (`record_version_conflict`, `receipt_conflict`, `workspace-scope-mismatch`)
 * so a failed dispatch has a typed home; `run-mismatch` and
 * `not-currently-executable` are executor-minted typed outcomes for the cases
 * the Facade error vocabulary does not name directly.
 */
export type AuthorityRejectionCode =
  | 'run-mismatch'
  | 'record_version_conflict'
  | 'receipt_conflict'
  | 'workspace-scope-mismatch'
  | 'not-currently-executable';

export type AuthorityValidationResult =
  | {
      readonly kind: 'dispatched';
      readonly action: RunAction;
      readonly committed: CommittedAction;
      readonly recordVersion: number;
    }
  | {
      readonly kind: 'duplicate';
      readonly reason: 'settled' | 'in-flight';
      readonly committed: CommittedAction;
      readonly message: string;
    }
  | {
      readonly kind: 'rejected';
      readonly code: AuthorityRejectionCode;
      readonly message: string;
    };

/**
 * The set of invocation ids the executor currently has in-flight on a backend.
 * The validator consults it ONLY to detect a duplicate dispatch of an Action
 * already being driven (the Record cannot know the executor's in-flight set).
 * It carries no authority and rebuilds nothing.
 */
export type InFlightDispatchLedger = ReadonlySet<string>;

export interface ValidateGrantedActionOptions {
  readonly runRef: ExactChangeRunRef;
  /**
   * The granted frozen Action, exactly as the Facade returned it in its receipt.
   * It is an untrusted transport copy until its complete canonical form matches
   * the Record-owned Action. No chat history, live Definition, or other caller
   * self-report is accepted as authority here.
   */
  readonly grantedAction: RunAction;
  readonly record: CanonicalRunRecord;
  readonly expectedRecordVersion: number;
  /**
   * The workspace revision the executor is actually running in. Must match the
   * granted Action's `expectedBeforeWorkspace` or the dispatch fails closed with
   * `workspace-scope-mismatch` before any backend process receives input.
   */
  readonly workspaceRevision: WorkspaceRevision;
  /**
   * The executor's own in-flight dispatch ledger (action ids currently being
   * driven on a backend). Used only for duplicate-dispatch detection; carries
   * no authority. Defaults to empty.
   */
  readonly inFlight?: InFlightDispatchLedger;
}

function sameCanonicalAction(
  granted: RunAction,
  committed: RunAction
): boolean {
  // Both values have already passed the same closed RunAction decoder. Compare
  // their complete canonical representation so every present and future Action
  // field is authority-bearing without maintaining a second field allowlist.
  return canonicalJson(granted) === canonicalJson(committed);
}

/**
 * Validate a granted frozen Action against the committed Record before any
 * backend work. Returns `dispatched` only when every authority field matches
 * the granted ActionView AND the Record version is current AND the Action is
 * currently executable; otherwise returns a typed `duplicate` or `rejected`
 * result and the caller performs no backend work.
 */
export function validateGrantedAction(
  options: ValidateGrantedActionOptions
): AuthorityValidationResult {
  const { runRef, grantedAction, record, expectedRecordVersion, workspaceRevision } = options;
  const inFlight = options.inFlight ?? new Set<string>();

  // (1) Run identity: the dispatch must address the exact Run and Change.
  if (
    runRef.runId !== record.runId ||
    runRef.change.changeId !== record.change.changeId
  ) {
    return {
      kind: 'rejected',
      code: 'run-mismatch',
      message: 'Dispatch must address the exact Run and Change identity.',
    };
  }

  // (2) Record version: stale version is a compare-and-swap conflict. The
  // caller's expected version must equal the current committed version.
  if (expectedRecordVersion !== record.recordVersion) {
    return {
      kind: 'rejected',
      code: 'record_version_conflict',
      message: `expectedRecordVersion ${expectedRecordVersion} does not match the committed Record version ${record.recordVersion}.`,
    };
  }

  // (3) The granted Action must be admitted in this Record.
  const committed = record.actions[grantedAction.actionId];
  if (committed === undefined) {
    return {
      kind: 'rejected',
      code: 'not-currently-executable',
      message: `Granted Action ${grantedAction.actionId} is not admitted in the canonical Record.`,
    };
  }

  // (4) Full canonical binding: the receipt must be byte-semantically equal to
  // the complete Action admitted by the Record. This binds all execution input,
  // route, runtime, session, completion, workspace, and future closed fields in
  // one comparison instead of maintaining a security-sensitive subset list.
  if (!sameCanonicalAction(grantedAction, committed.action)) {
    return {
      kind: 'rejected',
      code: 'receipt_conflict',
      message: 'Granted ActionView does not match the complete committed Action.',
    };
  }

  // (5) Workspace: the executor's actual workspace revision must match the
  // committed Action's expected-before-workspace tree digest. A wrong workspace
  // fails closed BEFORE any backend process receives input.
  if (
    workspaceRevision.treeDigest !==
    committed.action.expectedBeforeWorkspace.treeDigest
  ) {
    return {
      kind: 'rejected',
      code: 'workspace-scope-mismatch',
      message:
        'The executor workspace revision does not match the committed Action expectedBeforeWorkspace.',
    };
  }

  // (6) Duplicate dispatch: an Action that already settled (has a committed
  // result) returns the recorded state without resending input. No second
  // backend execution occurs.
  if (committed.result !== undefined) {
    return {
      kind: 'duplicate',
      reason: 'settled',
      committed,
      message: `Action ${grantedAction.actionId} already settled; returning the recorded state without resend.`,
    };
  }
  if (inFlight.has(grantedAction.actionId)) {
    return {
      kind: 'duplicate',
      reason: 'in-flight',
      committed,
      message: `Action ${grantedAction.actionId} is already in flight on a backend; returning the in-flight state without resend.`,
    };
  }

  // (7) Currently executable: the Action must be granted (not closed, not
  // merely admitted-undelivered). An admitted-undelivered or closed Action is
  // not currently executable and performs no backend work.
  if (committed.deliveryState !== 'granted') {
    return {
      kind: 'rejected',
      code: 'not-currently-executable',
      message: `Granted Action ${grantedAction.actionId} deliveryState is ${committed.deliveryState}, not 'granted'.`,
    };
  }

  return {
    kind: 'dispatched',
    action: committed.action,
    committed,
    recordVersion: record.recordVersion,
  };
}
