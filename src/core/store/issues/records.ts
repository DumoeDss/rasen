/**
 * The strict `issue.yaml` schema — pure, no filesystem, no Git.
 *
 * It follows child 1's catalog conventions exactly: versioned, strict, unknown
 * fields rejected, no machine paths, no credentials, and the containing
 * directory name must equal the record's id. That last rule is enforced the
 * same way `validateProjectCatalogFilename` enforces it, and a disagreement
 * fails naming BOTH values rather than preferring either side — preferring one
 * is how a rename silently becomes a fork.
 *
 * The record deliberately restates nothing derivable: no `storeUid` (the
 * containing Store is the Store), no project list and no node list (the plan's
 * nodes are), no `latestRevision` (the revisions directory is).
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { formatZodIssues } from '../../zod-issues.js';
import {
  StorePlanningValidationError,
  isCanonicalIsoTimestamp,
  parseIssueId,
  type IssueId,
} from '../planning-validation.js';
import type { IssueRecordV1, IssueState } from './types.js';

/** Every state an Issue record may declare, in lifecycle order. */
export const ISSUE_STATES: readonly IssueState[] = Object.freeze([
  'open',
  'resolved',
  'dropped',
]);

/** The two states from which no further transition is permitted. */
export const TERMINAL_ISSUE_STATES: readonly IssueState[] = Object.freeze([
  'resolved',
  'dropped',
]);

const CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;
const ABSOLUTE_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u;
const CREDENTIAL_PATTERN = /:\/\/[^/\s@]*:[^/\s@]*@/u;

function recordError(
  field: string,
  message: string,
  cause?: unknown
): StorePlanningValidationError {
  return new StorePlanningValidationError('invalid_issue_record', field, message, cause);
}

/**
 * Free text that becomes durable Store content. A machine filesystem path or an
 * embedded credential in a title, a reason, or a node summary would be
 * committed and pushed, so both are rejected at the schema rather than trimmed.
 *
 * Shared with the revision schema so there is ONE definition of "portable
 * durable text" across Issue content; two copies would drift.
 */
export function assertPortableIssueText(
  value: string,
  field: string,
  code:
    | 'invalid_issue_record'
    | 'invalid_execution_plan'
    | 'invalid_acceptance_conditions'
    | 'invalid_acceptance_record' = 'invalid_issue_record'
): void {
  const fail = (message: string): never => {
    throw new StorePlanningValidationError(code, field, message);
  };
  if (value.trim().length === 0) fail('must not be blank');
  if (value !== value.trim()) fail('must not carry surrounding whitespace');
  if (CONTROL_PATTERN.test(value)) fail('must not contain control characters');
  if (ABSOLUTE_PATH_PATTERN.test(value)) fail('must not be a machine filesystem path');
  if (CREDENTIAL_PATTERN.test(value)) fail('must not embed credentials');
}

function assertPortableText(value: string, field: string): void {
  assertPortableIssueText(value, field, 'invalid_issue_record');
}

const IssueRecordSchema = z
  .object({
    version: z.literal(1),
    id: z.string(),
    title: z.string().min(1).max(200),
    state: z.enum(['open', 'resolved', 'dropped']),
    reason: z.string().max(4000).nullable(),
    createdAt: z.string().refine(isCanonicalIsoTimestamp, {
      message: 'createdAt must be a canonical ISO-8601 UTC timestamp',
    }),
  })
  .strict();

export function validateIssueRecord(value: unknown, filePath?: string): IssueRecordV1 {
  const result = IssueRecordSchema.safeParse(value);
  if (!result.success) {
    throw recordError('record', formatZodIssues(result.error), result.error);
  }

  let id!: IssueId;
  try {
    id = parseIssueId(result.data.id, 'id');
  } catch (error) {
    throw recordError(
      'id',
      error instanceof Error ? error.message : String(error),
      error
    );
  }
  if (filePath !== undefined) validateIssueRecordLocation(id, filePath);

  assertPortableText(result.data.title, 'title');
  if (result.data.state === 'dropped') {
    if (result.data.reason === null) {
      throw recordError('reason', "is required when state is 'dropped'");
    }
    assertPortableText(result.data.reason, 'reason');
  } else if (result.data.reason !== null) {
    assertPortableText(result.data.reason, 'reason');
  }

  return Object.freeze({
    version: 1 as const,
    id,
    title: result.data.title,
    state: result.data.state,
    reason: result.data.reason,
    createdAt: result.data.createdAt,
  });
}

/**
 * The containing DIRECTORY name must equal the id — an Issue record's filename
 * is always `issue.yaml`, so unlike a project catalog the identity lives one
 * level up.
 */
export function validateIssueRecordLocation(issueId: IssueId, filePath: string): void {
  const segments = filePath.replace(/\\/gu, '/').split('/').filter(part => part.length > 0);
  const fileName = segments.at(-1);
  const directoryName = segments.at(-2);
  if (fileName !== 'issue.yaml') {
    throw recordError('filename', `must be named 'issue.yaml'; found '${fileName ?? ''}'`);
  }
  if (directoryName !== issueId) {
    throw recordError(
      'directory',
      `containing directory '${directoryName ?? ''}' must equal the record id '${issueId}'`
    );
  }
}

export function parseIssueRecord(content: string, filePath?: string): IssueRecordV1 {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw recordError('record', 'contains invalid YAML', error);
  }
  return validateIssueRecord(raw, filePath);
}

export function serializeIssueRecord(value: IssueRecordV1): string {
  const record = validateIssueRecord(value);
  return stringifyYaml({
    version: 1,
    id: record.id,
    title: record.title,
    state: record.state,
    reason: record.reason,
    createdAt: record.createdAt,
  });
}

/**
 * The declared-state lifecycle. `open` may become `resolved` or `dropped`;
 * a terminal state transitions nowhere, including to itself. Readiness derived
 * from a plan INFORMS this decision and never makes it — an Issue is not
 * auto-resolved by its graph.
 */
export function isPermittedIssueTransition(from: IssueState, to: IssueState): boolean {
  if (TERMINAL_ISSUE_STATES.includes(from)) return false;
  return to === 'resolved' || to === 'dropped';
}
