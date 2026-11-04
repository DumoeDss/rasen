import { createHash, randomBytes } from 'node:crypto';

import { canonicalBytes } from '../canonical-json.js';
import { isValidStoreUid, normalizeStoreUid } from './identity-types.js';
import {
  StorePlanningValidationError,
  parseProjectId,
  parseTargetLineId,
  type ProjectId,
  type TargetLineId,
} from './planning-validation.js';

declare const planningScopeIdBrand: unique symbol;
declare const changeInstanceIdBrand: unique symbol;
declare const verifiedChangeInstanceIdBrand: unique symbol;
declare const changeInstanceSeedBrand: unique symbol;
declare const worktreeInstanceIdBrand: unique symbol;
declare const workspacePairIdBrand: unique symbol;
declare const verifiedWorkspacePairIdBrand: unique symbol;
declare const canonicalLocalIdentityBrand: unique symbol;

export type PlanningScopeId = string & { readonly [planningScopeIdBrand]: true };
/** A format-valid wire identity. Relationship verification produces the subtype below. */
export type ChangeInstanceId = string & { readonly [changeInstanceIdBrand]: true };
export type VerifiedChangeInstanceId = ChangeInstanceId & {
  readonly [verifiedChangeInstanceIdBrand]: true;
};
export type ChangeInstanceSeed = string & { readonly [changeInstanceSeedBrand]: true };
export type WorktreeInstanceId = string & { readonly [worktreeInstanceIdBrand]: true };
/** A format-valid wire identity. Relationship verification produces the subtype below. */
export type WorkspacePairId = string & { readonly [workspacePairIdBrand]: true };
export type VerifiedWorkspacePairId = WorkspacePairId & {
  readonly [verifiedWorkspacePairIdBrand]: true;
};
export type CanonicalLocalIdentity = string & {
  readonly [canonicalLocalIdentityBrand]: true;
};

const HEX_64 = /^[0-9a-f]{64}$/u;
const SEED_PATTERN = /^[0-9a-f]{32}$/u;
const CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;

function identityError(field: string, message: string): StorePlanningValidationError {
  return new StorePlanningValidationError('invalid_planning_identity', field, message);
}

function reclassifyIdentityValidation<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof StorePlanningValidationError) {
      const fieldPrefix = `${error.field}: `;
      const message = error.message.startsWith(fieldPrefix)
        ? error.message.slice(fieldPrefix.length)
        : error.message;
      throw new StorePlanningValidationError(
        'invalid_planning_identity',
        error.field,
        message,
        error
      );
    }
    throw error;
  }
}

function parsePrefixedIdentity<T extends string>(
  value: string,
  prefix: 'ps_' | 'ci_' | 'wt_' | 'wp_',
  field: string
): T {
  if (!value.startsWith(prefix) || !HEX_64.test(value.slice(prefix.length))) {
    throw identityError(field, `must use ${prefix}<64 lowercase hex>`);
  }
  return value as T;
}

function hashIdentity(prefix: 'ps_' | 'ci_' | 'wt_' | 'wp_', preimage: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalBytes(preimage)).digest('hex')}`;
}

export function parsePlanningScopeId(
  value: string,
  field = 'planningScopeId'
): PlanningScopeId {
  return parsePrefixedIdentity<PlanningScopeId>(value, 'ps_', field);
}

export function isPlanningScopeId(value: unknown): value is PlanningScopeId {
  if (typeof value !== 'string') return false;
  try {
    parsePlanningScopeId(value);
    return true;
  } catch {
    return false;
  }
}

export function parseChangeInstanceId(
  value: string,
  field = 'changeInstanceId'
): ChangeInstanceId {
  return parsePrefixedIdentity<ChangeInstanceId>(value, 'ci_', field);
}

export function isChangeInstanceId(value: unknown): value is ChangeInstanceId {
  if (typeof value !== 'string') return false;
  try {
    parseChangeInstanceId(value);
    return true;
  } catch {
    return false;
  }
}

export function parseWorktreeInstanceId(
  value: string,
  field = 'worktreeInstanceId'
): WorktreeInstanceId {
  return parsePrefixedIdentity<WorktreeInstanceId>(value, 'wt_', field);
}

export function isWorktreeInstanceId(value: unknown): value is WorktreeInstanceId {
  if (typeof value !== 'string') return false;
  try {
    parseWorktreeInstanceId(value);
    return true;
  } catch {
    return false;
  }
}

export function parseWorkspacePairId(
  value: string,
  field = 'workspacePairId'
): WorkspacePairId {
  return parsePrefixedIdentity<WorkspacePairId>(value, 'wp_', field);
}

export function isWorkspacePairId(value: unknown): value is WorkspacePairId {
  if (typeof value !== 'string') return false;
  try {
    parseWorkspacePairId(value);
    return true;
  } catch {
    return false;
  }
}

export function parseChangeInstanceSeed(
  value: string,
  field = 'instanceSeed'
): ChangeInstanceSeed {
  if (!SEED_PATTERN.test(value)) {
    throw identityError(field, 'must be exactly 16 bytes encoded as 32 lowercase hex characters');
  }
  return value as ChangeInstanceSeed;
}

export function isChangeInstanceSeed(value: unknown): value is ChangeInstanceSeed {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export function mintChangeInstanceSeed(): ChangeInstanceSeed {
  return randomBytes(16).toString('hex') as ChangeInstanceSeed;
}

export interface PlanningScopeIdentityInput {
  readonly storeUid: string;
  readonly projectId: string | ProjectId;
  readonly targetLineId: string | TargetLineId;
}

export function derivePlanningScopeId(input: PlanningScopeIdentityInput): PlanningScopeId {
  if (!isValidStoreUid(input.storeUid)) {
    throw identityError('storeUid', 'must be a well-formed permanent Store UUID');
  }
  const storeUid = normalizeStoreUid(input.storeUid);
  const projectId = reclassifyIdentityValidation(() => parseProjectId(input.projectId));
  const targetLineId = reclassifyIdentityValidation(() =>
    parseTargetLineId(input.targetLineId)
  );
  return hashIdentity('ps_', {
    domain: 'planning-scope/v2',
    storeUid,
    projectId,
    targetLineId,
  }) as PlanningScopeId;
}

export function verifyPlanningScopeId(
  value: string | PlanningScopeId,
  input: PlanningScopeIdentityInput
): PlanningScopeId {
  const parsed = parsePlanningScopeId(value);
  const expected = derivePlanningScopeId(input);
  if (parsed !== expected) {
    throw identityError('planningScopeId', 'does not match its Store/project/target-line scope');
  }
  return parsed;
}

export interface ChangeInstanceIdentityInput {
  readonly planningScopeId: string | PlanningScopeId;
  readonly instanceSeed: string | ChangeInstanceSeed;
}

export function deriveChangeInstanceId(
  input: ChangeInstanceIdentityInput
): VerifiedChangeInstanceId {
  const planningScopeId = parsePlanningScopeId(input.planningScopeId);
  const instanceSeed = parseChangeInstanceSeed(input.instanceSeed);
  return hashIdentity('ci_', {
    domain: 'change-instance/v2',
    planningScopeId,
    instanceSeed,
  }) as VerifiedChangeInstanceId;
}

export function verifyChangeInstanceId(
  value: string | ChangeInstanceId,
  input: ChangeInstanceIdentityInput
): VerifiedChangeInstanceId {
  const parsed = parseChangeInstanceId(value);
  const expected = deriveChangeInstanceId(input);
  if (parsed !== expected) {
    throw identityError('changeInstanceId', 'does not match its planning scope and instance seed');
  }
  return parsed as VerifiedChangeInstanceId;
}

export function parseCanonicalLocalIdentity(
  value: string,
  field = 'localIdentity'
): CanonicalLocalIdentity {
  if (value.length === 0 || value !== value.trim()) {
    throw identityError(field, 'must be a non-empty canonical string without surrounding space');
  }
  if (CONTROL_PATTERN.test(value)) {
    throw identityError(field, 'must not contain control characters');
  }
  return value as CanonicalLocalIdentity;
}

export interface WorktreeInstanceIdentityInput {
  readonly repositoryIdentity: string | CanonicalLocalIdentity;
  readonly worktreeIdentity: string | CanonicalLocalIdentity;
}

export function deriveWorktreeInstanceId(
  input: WorktreeInstanceIdentityInput
): WorktreeInstanceId {
  const repositoryIdentity = parseCanonicalLocalIdentity(
    input.repositoryIdentity,
    'repositoryIdentity'
  );
  const worktreeIdentity = parseCanonicalLocalIdentity(
    input.worktreeIdentity,
    'worktreeIdentity'
  );
  return hashIdentity('wt_', {
    domain: 'worktree-instance/v2',
    repositoryIdentity,
    worktreeIdentity,
  }) as WorktreeInstanceId;
}

export function verifyWorktreeInstanceId(
  value: string | WorktreeInstanceId,
  input: WorktreeInstanceIdentityInput
): WorktreeInstanceId {
  const parsed = parseWorktreeInstanceId(value);
  const expected = deriveWorktreeInstanceId(input);
  if (parsed !== expected) {
    throw identityError('worktreeInstanceId', 'does not match its repository/worktree inputs');
  }
  return parsed;
}

export interface WorkspacePairIdentityInput {
  readonly changeInstanceId: string | ChangeInstanceId;
  readonly planningWorktreeInstanceId: string | WorktreeInstanceId;
  readonly executionWorktreeInstanceId: string | WorktreeInstanceId;
}

export function deriveWorkspacePairId(
  input: WorkspacePairIdentityInput
): VerifiedWorkspacePairId {
  const changeInstanceId = parseChangeInstanceId(input.changeInstanceId);
  const planningWorktreeInstanceId = parseWorktreeInstanceId(
    input.planningWorktreeInstanceId,
    'planningWorktreeInstanceId'
  );
  const executionWorktreeInstanceId = parseWorktreeInstanceId(
    input.executionWorktreeInstanceId,
    'executionWorktreeInstanceId'
  );
  return hashIdentity('wp_', {
    domain: 'workspace-pair/v2',
    changeInstanceId,
    planningWorktreeInstanceId,
    executionWorktreeInstanceId,
  }) as VerifiedWorkspacePairId;
}

export function verifyWorkspacePairId(
  value: string | WorkspacePairId,
  input: WorkspacePairIdentityInput
): VerifiedWorkspacePairId {
  const parsed = parseWorkspacePairId(value);
  const expected = deriveWorkspacePairId(input);
  if (parsed !== expected) {
    throw identityError('workspacePairId', 'does not match its ordered Change/worktree inputs');
  }
  return parsed as VerifiedWorkspacePairId;
}

export function changeInstanceDigestPrefix(
  value: string | ChangeInstanceId,
  length = 12
): string {
  const parsed = parseChangeInstanceId(value);
  if (!Number.isSafeInteger(length) || length < 1 || length > 64) {
    throw identityError('length', 'must be an integer between 1 and 64');
  }
  return parsed.slice('ci_'.length, 'ci_'.length + length);
}
