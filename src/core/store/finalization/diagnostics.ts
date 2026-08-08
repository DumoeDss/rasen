/**
 * Refusals for the finalization Module.
 *
 * Every refusal names the disagreeing values and a repair. None of these codes
 * has an override flag: the escape hatch is to correct the disagreement, land
 * the code, declare the intent in the Change, or open a new Change instance —
 * all of which are inspectable and none of which is a flag on `archive`.
 */
import { StoreError } from '../errors.js';
import type { FinalizationBlocker, FinalizationErrorCode } from './types.js';

export interface FinalizationDisagreement {
  readonly expected?: string;
  readonly actual?: string;
  readonly target?: string;
  readonly fix?: string;
  readonly cause?: unknown;
}

export class ChangeFinalizationError extends StoreError {
  readonly finalizationCode: FinalizationErrorCode;
  readonly expected?: string;
  readonly actual?: string;

  constructor(
    code: FinalizationErrorCode,
    message: string,
    disagreement: FinalizationDisagreement = {}
  ) {
    super(message, code, {
      ...(disagreement.target === undefined ? {} : { target: disagreement.target }),
      ...(disagreement.fix === undefined ? {} : { fix: disagreement.fix }),
    });
    this.name = 'ChangeFinalizationError';
    this.finalizationCode = code;
    if (disagreement.expected !== undefined) this.expected = disagreement.expected;
    if (disagreement.actual !== undefined) this.actual = disagreement.actual;
    if (disagreement.cause !== undefined) {
      (this as { cause?: unknown }).cause = disagreement.cause;
    }
  }

  toBlocker(): FinalizationBlocker {
    return {
      code: this.finalizationCode,
      message: this.message,
      ...(this.expected === undefined ? {} : { expected: this.expected }),
      ...(this.actual === undefined ? {} : { actual: this.actual }),
      ...(this.diagnostic.fix === undefined ? {} : { fix: this.diagnostic.fix }),
    };
  }
}

export function isChangeFinalizationError(
  error: unknown
): error is ChangeFinalizationError {
  return error instanceof ChangeFinalizationError;
}

export function finalizationError(
  code: FinalizationErrorCode,
  message: string,
  disagreement: FinalizationDisagreement = {}
): ChangeFinalizationError {
  return new ChangeFinalizationError(code, message, disagreement);
}

/** A refusal whose message always ends with the two disagreeing values. */
export function finalizationRefusal(
  code: FinalizationErrorCode,
  message: string,
  disagreement: FinalizationDisagreement & { readonly fix: string }
): ChangeFinalizationError {
  const values =
    disagreement.expected === undefined && disagreement.actual === undefined
      ? ''
      : ` (expected: ${disagreement.expected ?? '(none)'}; actual: ${disagreement.actual ?? '(none)'})`;
  return new ChangeFinalizationError(code, `${message}${values}`, disagreement);
}

export function finalizationBlocker(
  code: FinalizationErrorCode,
  message: string,
  disagreement: FinalizationDisagreement = {}
): FinalizationBlocker {
  return {
    code,
    message,
    ...(disagreement.expected === undefined ? {} : { expected: disagreement.expected }),
    ...(disagreement.actual === undefined ? {} : { actual: disagreement.actual }),
    ...(disagreement.fix === undefined ? {} : { fix: disagreement.fix }),
  };
}
