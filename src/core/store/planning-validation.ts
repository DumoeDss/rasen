import { isKebabId } from '../id.js';

declare const projectIdBrand: unique symbol;
declare const targetLineIdBrand: unique symbol;
declare const changeIdBrand: unique symbol;
declare const issueIdBrand: unique symbol;
declare const executionPlanRevisionIdBrand: unique symbol;
declare const gitRefBrand: unique symbol;
declare const gitOidBrand: unique symbol;
declare const sha256DigestBrand: unique symbol;
declare const portableRelativePathBrand: unique symbol;

export type ProjectId = string & { readonly [projectIdBrand]: true };
export type TargetLineId = string & { readonly [targetLineIdBrand]: true };
export type ChangeId = string & { readonly [changeIdBrand]: true };
export type IssueId = string & { readonly [issueIdBrand]: true };
export type ExecutionPlanRevisionId = string & {
  readonly [executionPlanRevisionIdBrand]: true;
};
export type FullGitRef = string & { readonly [gitRefBrand]: true };
export type GitOid = string & { readonly [gitOidBrand]: true };
export type Sha256Digest = string & { readonly [sha256DigestBrand]: true };
export type PortableRelativePath = string & {
  readonly [portableRelativePathBrand]: true;
};

export type StorePlanningValidationErrorCode =
  | 'invalid_store_layout_v2'
  | 'invalid_project_catalog'
  | 'invalid_target_line_catalog'
  | 'invalid_planning_identity'
  | 'invalid_archive_v2'
  | 'invalid_issue_record'
  | 'invalid_execution_plan'
  | 'invalid_acceptance_conditions'
  | 'invalid_acceptance_record'
  | 'planning_path_escape';

export class StorePlanningValidationError extends Error {
  constructor(
    public readonly code: StorePlanningValidationErrorCode,
    public readonly field: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(`${field}: ${message}`);
    this.name = 'StorePlanningValidationError';
  }
}

/**
 * One portable Windows device-name list for every Store path contract.
 * A name stays reserved before any extension (`con.txt` is also reserved).
 */
export const WINDOWS_RESERVED_DEVICE_NAMES: readonly string[] = Object.freeze([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const RESERVED_DEVICE_NAME_SET = new Set(WINDOWS_RESERVED_DEVICE_NAMES);
const LOWERCASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TARGET_LINE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const LOWERCASE_HEX_40_OR_64 = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const LOWERCASE_HEX_64 = /^[0-9a-f]{64}$/u;
const CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;
const WINDOWS_INVALID_COMPONENT_PATTERN = /[<>:"|?*]/u;

function invalid(field: string, message: string): StorePlanningValidationError {
  return new StorePlanningValidationError('invalid_store_layout_v2', field, message);
}

export function isWindowsReservedDeviceName(value: string): boolean {
  const base = (value.toLowerCase().split('.', 1)[0] ?? '').replace(/[ .]+$/u, '');
  return RESERVED_DEVICE_NAME_SET.has(base);
}

function assertPortableSegment(value: string, field: string): void {
  if (value.length === 0) throw invalid(field, 'must not be empty');
  if (value === '.' || value === '..') throw invalid(field, 'must not be a traversal segment');
  if (value.includes('/') || value.includes('\\')) {
    throw invalid(field, 'must not contain path separators');
  }
  if (CONTROL_PATTERN.test(value)) throw invalid(field, 'must not contain control characters');
  if (WINDOWS_INVALID_COMPONENT_PATTERN.test(value)) {
    throw invalid(field, 'must not contain Windows-invalid filename characters');
  }
  if (value.endsWith('.') || value.endsWith(' ')) {
    throw invalid(field, 'must not end with a dot or space');
  }
  if (isWindowsReservedDeviceName(value)) {
    throw invalid(field, `'${value}' is reserved as a Windows device name`);
  }
}

export function parseProjectId(value: string, field = 'projectId'): ProjectId {
  assertPortableSegment(value, field);
  if (!LOWERCASE_UUID_PATTERN.test(value) && !isKebabId(value)) {
    throw invalid(field, 'must be a canonical lowercase UUID or lowercase kebab id');
  }
  return value as ProjectId;
}

export function isProjectId(value: unknown): value is ProjectId {
  if (typeof value !== 'string') return false;
  try {
    parseProjectId(value);
    return true;
  } catch {
    return false;
  }
}

export function parseTargetLineId(
  value: string,
  field = 'targetLineId'
): TargetLineId {
  assertPortableSegment(value, field);
  if (!TARGET_LINE_PATTERN.test(value)) {
    throw invalid(
      field,
      'must contain lowercase alphanumeric segments separated by single dots or hyphens'
    );
  }
  return value as TargetLineId;
}

export function isTargetLineId(value: unknown): value is TargetLineId {
  if (typeof value !== 'string') return false;
  try {
    parseTargetLineId(value);
    return true;
  } catch {
    return false;
  }
}

export function parseChangeId(value: string, field = 'changeId'): ChangeId {
  assertPortableSegment(value, field);
  if (!isKebabId(value)) {
    throw invalid(field, 'must be a canonical lowercase kebab id');
  }
  return value as ChangeId;
}

export function isChangeId(value: unknown): value is ChangeId {
  if (typeof value !== 'string') return false;
  try {
    parseChangeId(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A Store-level Issue identifier, on exactly the portable canonical-segment
 * contract a v2 project id satisfies. An Issue directory is a real path
 * segment on every platform this ships to, so it inherits the same rejections
 * — traversal, separators, control characters, trailing dot or space, Windows
 * device names, and non-canonical case — and NEVER sanitizes an invalid value
 * into a different identifier.
 */
export function parseIssueId(value: string, field = 'issueId'): IssueId {
  assertPortableSegment(value, field);
  if (!isKebabId(value)) {
    throw invalid(field, 'must be a canonical lowercase kebab id');
  }
  return value as IssueId;
}

export function isIssueId(value: unknown): value is IssueId {
  if (typeof value !== 'string') return false;
  try {
    parseIssueId(value);
    return true;
  } catch {
    return false;
  }
}

/** The fixed width of an Execution Plan revision ordinal. */
export const EXECUTION_PLAN_REVISION_WIDTH = 4;

const EXECUTION_PLAN_REVISION_PATTERN = /^[0-9]{4}$/u;

/**
 * An Execution Plan revision identifier: a canonical zero-padded decimal
 * ordinal of fixed width. An ordinal answers "which is latest" without opening
 * every file, which a content digest cannot. `0000` is rejected because there
 * is no zeroth revision, and any spelling that is not the canonical rendering
 * of its own number is rejected rather than normalized — two spellings of one
 * ordinal would be two addresses for one revision.
 */
export function parseExecutionPlanRevisionId(
  value: string,
  field = 'revisionId'
): ExecutionPlanRevisionId {
  assertPortableSegment(value, field);
  if (!EXECUTION_PLAN_REVISION_PATTERN.test(value)) {
    throw invalid(
      field,
      `must be a ${EXECUTION_PLAN_REVISION_WIDTH}-digit zero-padded decimal ordinal`
    );
  }
  const ordinal = Number.parseInt(value, 10);
  if (ordinal < 1) throw invalid(field, 'must be an ordinal of at least 1');
  if (formatExecutionPlanRevisionId(ordinal) !== value) {
    throw invalid(field, 'must be the canonical spelling of its own ordinal');
  }
  return value as ExecutionPlanRevisionId;
}

export function isExecutionPlanRevisionId(
  value: unknown
): value is ExecutionPlanRevisionId {
  if (typeof value !== 'string') return false;
  try {
    parseExecutionPlanRevisionId(value);
    return true;
  } catch {
    return false;
  }
}

/** The canonical rendering of an ordinal. The only way a revision id is minted. */
export function formatExecutionPlanRevisionId(ordinal: number): ExecutionPlanRevisionId {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw invalid('revisionOrdinal', 'must be a positive safe integer');
  }
  const rendered = String(ordinal).padStart(EXECUTION_PLAN_REVISION_WIDTH, '0');
  if (rendered.length > EXECUTION_PLAN_REVISION_WIDTH) {
    throw invalid(
      'revisionOrdinal',
      `exceeds the ${EXECUTION_PLAN_REVISION_WIDTH}-digit revision width`
    );
  }
  return rendered as ExecutionPlanRevisionId;
}

/** Conservative, pure subset of `git check-ref-format` for full refs. */
export function parseFullGitRef(value: string, field = 'ref'): FullGitRef {
  if (!value.startsWith('refs/') || value.length <= 'refs/'.length) {
    throw invalid(field, 'must be a full Git ref below refs/');
  }
  if (
    CONTROL_PATTERN.test(value) ||
    /[ ~^:?*[\\]/u.test(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    value.includes('//') ||
    value.endsWith('/') ||
    value.endsWith('.')
  ) {
    throw invalid(field, 'is not a portable full Git ref');
  }
  const components = value.split('/');
  if (
    components.some(
      component =>
        component.length === 0 || component.startsWith('.') || component.endsWith('.lock')
    )
  ) {
    throw invalid(field, 'contains an invalid Git ref component');
  }
  for (const [index, component] of components.entries()) {
    assertPortableSegment(component, `${field}[${index}]`);
  }
  return value as FullGitRef;
}

export function isFullGitRef(value: unknown): value is FullGitRef {
  if (typeof value !== 'string') return false;
  try {
    parseFullGitRef(value);
    return true;
  } catch {
    return false;
  }
}

/** Full lowercase SHA-1 or SHA-256 object id. */
export function parseGitOid(value: string, field = 'oid'): GitOid {
  if (!LOWERCASE_HEX_40_OR_64.test(value)) {
    throw invalid(field, 'must be a full lowercase 40- or 64-hex Git object id');
  }
  return value as GitOid;
}

export function isGitOid(value: unknown): value is GitOid {
  return typeof value === 'string' && LOWERCASE_HEX_40_OR_64.test(value);
}

export function parseSha256Digest(value: string, field = 'sha256'): Sha256Digest {
  if (!LOWERCASE_HEX_64.test(value)) {
    throw invalid(field, 'must be a lowercase 64-hex SHA-256 digest');
  }
  return value as Sha256Digest;
}

export function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && LOWERCASE_HEX_64.test(value);
}

export function parsePortableRelativePath(
  value: string,
  field = 'path'
): PortableRelativePath {
  if (value.length === 0) throw invalid(field, 'must not be empty');
  if (CONTROL_PATTERN.test(value)) throw invalid(field, 'must not contain control characters');
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/u.test(value)) {
    throw invalid(field, 'must be relative');
  }
  if (value.includes('\\')) throw invalid(field, 'must use portable forward slashes');

  const segments = value.split('/');
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw invalid(field, 'must be normalized and must not contain traversal segments');
  }
  for (const [index, segment] of segments.entries()) {
    assertPortableSegment(segment, `${field}[${index}]`);
  }
  return value as PortableRelativePath;
}

export function isPortableRelativePath(value: unknown): value is PortableRelativePath {
  if (typeof value !== 'string') return false;
  try {
    parsePortableRelativePath(value);
    return true;
  } catch {
    return false;
  }
}

export function portablePathIdentity(value: PortableRelativePath): string {
  return value.toLowerCase();
}

export function isCanonicalIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
