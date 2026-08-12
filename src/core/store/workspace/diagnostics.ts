/**
 * Refusals for the workspace Module.
 *
 * Every refusal in the closed taxonomy carries the SAME three things: the two
 * disagreeing values, and a repair hint. That is what makes the taxonomy
 * useful — a code with no values is a category, not a diagnostic — so the
 * constructor takes them positionally rather than leaving each call site to
 * remember.
 *
 * None of these codes has an override flag. The escape hatch is to correct the
 * disagreement, which is inspectable, or to prepare a new pair, which is
 * explicit.
 */
import { StoreError } from '../errors.js';
import type { StoreWorkspaceErrorCode, WorkspaceErrorCode } from './types.js';

export interface WorkspaceDisagreement {
  /** What the recorded/expected side says. */
  readonly expected?: string;
  /** What the live side says. */
  readonly actual?: string;
  /** The path, ref, or identifier the disagreement is about. */
  readonly target?: string;
  readonly fix?: string;
  readonly cause?: unknown;
}

export class StoreWorkspaceError extends StoreError {
  readonly workspaceCode: WorkspaceErrorCode;
  readonly expected?: string;
  readonly actual?: string;

  constructor(
    code: WorkspaceErrorCode,
    message: string,
    disagreement: WorkspaceDisagreement = {}
  ) {
    super(message, code, {
      ...(disagreement.target === undefined ? {} : { target: disagreement.target }),
      ...(disagreement.fix === undefined ? {} : { fix: disagreement.fix }),
    });
    this.name = 'StoreWorkspaceError';
    this.workspaceCode = code;
    if (disagreement.expected !== undefined) this.expected = disagreement.expected;
    if (disagreement.actual !== undefined) this.actual = disagreement.actual;
    if (disagreement.cause !== undefined) {
      (this as { cause?: unknown }).cause = disagreement.cause;
    }
  }
}

export function isStoreWorkspaceError(error: unknown): error is StoreWorkspaceError {
  return error instanceof StoreWorkspaceError;
}

/**
 * A refusal in the closed taxonomy. The message always ends with the two
 * disagreeing values, so a caller that only prints `error.message` still shows
 * them.
 */
export function workspaceRefusal(
  code: StoreWorkspaceErrorCode,
  message: string,
  disagreement: WorkspaceDisagreement & { readonly fix: string }
): StoreWorkspaceError {
  const values =
    disagreement.expected === undefined && disagreement.actual === undefined
      ? ''
      : ` (recorded: ${disagreement.expected ?? '(none)'}; live: ${disagreement.actual ?? '(none)'})`;
  return new StoreWorkspaceError(code, `${message}${values}`, disagreement);
}

export function workspaceError(
  code: WorkspaceErrorCode,
  message: string,
  options: { readonly target?: string; readonly fix?: string; readonly cause?: unknown } = {}
): StoreWorkspaceError {
  return new StoreWorkspaceError(code, message, options);
}
