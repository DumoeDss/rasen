import { StoreError } from '../store/errors.js';
import { StorePlanningValidationError } from '../store/planning-foundation.js';

export type PlanningScopeErrorCode =
  | 'invalid_start_path'
  | 'store_path_not_supported'
  | 'store_alias_ambiguous'
  | 'unknown_store'
  | 'unknown_project'
  | 'project_not_in_store'
  | 'planning_selection_conflict'
  | 'project_scope_required'
  | 'target_line_required'
  | 'planning_worktree_required'
  | 'split_planning_truth'
  | 'legacy_flat_store_requires_migration'
  | 'planning_scope_stale'
  | 'planning_address_not_available'
  | 'change_already_exists'
  | 'change_identity_mismatch'
  | 'change_publish_failed'
  | 'invalid_change_creation'
  | 'invalid_project_catalog'
  | 'invalid_target_line_catalog'
  | 'invalid_planning_identity'
  | 'invalid_store_layout_v2'
  | 'planning_path_escape'
  | 'invalid_store_metadata'
  | 'invalid_store_registry'
  | 'invalid_project_registry';

export interface PlanningDiagnostic {
  readonly severity: 'error';
  readonly code: PlanningScopeErrorCode | string;
  readonly message: string;
  readonly target?: string;
  readonly fix?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class PlanningScopeError extends Error {
  readonly diagnostic: PlanningDiagnostic;

  constructor(
    code: PlanningScopeErrorCode | string,
    message: string,
    options: {
      target?: string;
      fix?: string;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PlanningScopeError';
    this.diagnostic = Object.freeze({
      severity: 'error' as const,
      code,
      message,
      ...(options.target === undefined ? {} : { target: options.target }),
      ...(options.fix === undefined ? {} : { fix: options.fix }),
      ...(options.details === undefined ? {} : { details: options.details }),
    });
  }
}

export function isPlanningScopeError(error: unknown): error is PlanningScopeError {
  return error instanceof PlanningScopeError;
}

export function asPlanningScopeError(error: unknown): PlanningScopeError {
  if (error instanceof PlanningScopeError) return error;
  if (error instanceof StorePlanningValidationError) {
    return new PlanningScopeError(error.code, error.message, {
      target: error.field,
      cause: error,
    });
  }
  if (error instanceof StoreError) {
    return new PlanningScopeError(error.diagnostic.code, error.message, {
      ...(error.diagnostic.target === undefined ? {} : { target: error.diagnostic.target }),
      ...(error.diagnostic.fix === undefined ? {} : { fix: error.diagnostic.fix }),
      cause: error,
    });
  }
  return new PlanningScopeError(
    'planning_selection_conflict',
    error instanceof Error ? error.message : String(error),
    { cause: error }
  );
}
