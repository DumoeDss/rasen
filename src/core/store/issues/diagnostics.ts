/**
 * Refusals for the Store-level Issue Module.
 *
 * Same shape as the workspace and finalization taxonomies: every refusal names
 * the two disagreeing values and a repair, and no code has an override flag.
 * The escape hatch is to correct the disagreement or to publish a new revision,
 * both of which are inspectable.
 */
import { StoreError } from '../errors.js';
import type { IssuePublicationRecovery, StoreIssueErrorCode } from './types.js';

export interface IssueDisagreement {
  /** What the record/declaration says. */
  readonly expected?: string;
  /** What the committed evidence says. */
  readonly actual?: string;
  readonly target?: string;
  readonly fix?: string;
  readonly cause?: unknown;
  readonly recovery?: IssuePublicationRecovery;
}

export class StoreIssueError extends StoreError {
  readonly issueCode: StoreIssueErrorCode;
  readonly expected?: string;
  readonly actual?: string;
  readonly recovery?: IssuePublicationRecovery;

  constructor(
    code: StoreIssueErrorCode,
    message: string,
    disagreement: IssueDisagreement = {}
  ) {
    super(message, code, {
      ...(disagreement.target === undefined ? {} : { target: disagreement.target }),
      ...(disagreement.fix === undefined ? {} : { fix: disagreement.fix }),
      ...(disagreement.recovery === undefined ? {} : { recovery: disagreement.recovery }),
    });
    this.name = 'StoreIssueError';
    this.issueCode = code;
    if (disagreement.expected !== undefined) this.expected = disagreement.expected;
    if (disagreement.actual !== undefined) this.actual = disagreement.actual;
    if (disagreement.recovery !== undefined) this.recovery = disagreement.recovery;
    if (disagreement.cause !== undefined) {
      (this as { cause?: unknown }).cause = disagreement.cause;
    }
  }
}

export function isStoreIssueError(error: unknown): error is StoreIssueError {
  return error instanceof StoreIssueError;
}

export function issueError(
  code: StoreIssueErrorCode,
  message: string,
  disagreement: IssueDisagreement = {}
): StoreIssueError {
  return new StoreIssueError(code, message, disagreement);
}

/** A refusal whose message always ends with the two disagreeing values. */
export function issueRefusal(
  code: StoreIssueErrorCode,
  message: string,
  disagreement: IssueDisagreement & { readonly fix: string }
): StoreIssueError {
  const values =
    disagreement.expected === undefined && disagreement.actual === undefined
      ? ''
      : ` (expected: ${disagreement.expected ?? '(none)'}; actual: ${
          disagreement.actual ?? '(none)'
        })`;
  return new StoreIssueError(code, `${message}${values}`, disagreement);
}
