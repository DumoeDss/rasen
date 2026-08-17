/**
 * The strict acceptance-content schemas — pure, no filesystem, no Git.
 *
 * Two artifacts, one discipline each side already proved:
 *
 *   - an acceptance-conditions REVISION is exactly an Execution Plan revision's
 *     shape of durability: ordinal-addressed, immutable, `supersedes`-linked,
 *     and digest-carrying over its own canonical body. It carries at least one
 *     condition — `{id, requirement, verification?}` — and nothing else;
 *   - the acceptance RECORD is one-per-Issue close evidence. It freezes WHAT
 *     was accepted (the conditions revision id and that revision's digest), the
 *     gate snapshot it was accepted under (counts, health, zero problems —
 *     portable facts only, D7), an optional note, and its own content digest.
 *
 * Every text field passes `assertPortableIssueText`: both artifacts become
 * committed Store content, so a machine path or an embedded credential is
 * refused at the schema rather than trimmed. A digest covers the canonical
 * serialization of every other field, so a hand-edited artifact is reported as
 * a mismatch on read and is never silently repaired or re-digested.
 */
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { canonicalJson } from '../../canonical-json.js';
import { formatZodIssues } from '../../zod-issues.js';
import {
  StorePlanningValidationError,
  isCanonicalIsoTimestamp,
  parseChangeId,
  parseExecutionPlanRevisionId,
  parseIssueId,
  parseSha256Digest,
  type ExecutionPlanRevisionId,
  type IssueId,
  type Sha256Digest,
} from '../planning-validation.js';
import { assertPortableIssueText } from './records.js';
import type {
  AcceptanceCondition,
  AcceptanceConditionInput,
  AcceptanceConditionsRevisionV1,
  AcceptanceGateSnapshot,
  IssueAcceptedRecordV1,
} from './types.js';

/**
 * The health values a gate snapshot may freeze. It is the projection's closed
 * vocabulary, restated as strings so this file stays free of an upward import
 * into `issue-status` — `store/issues` must not depend on it (design D2).
 */
const SNAPSHOT_HEALTH_VALUES: readonly string[] = [
  'healthy',
  'blocked',
  'failed',
  'waiting-human',
  'stale',
];

function conditionsError(
  field: string,
  message: string,
  cause?: unknown
): StorePlanningValidationError {
  return new StorePlanningValidationError('invalid_acceptance_conditions', field, message, cause);
}

function recordError(
  field: string,
  message: string,
  cause?: unknown
): StorePlanningValidationError {
  return new StorePlanningValidationError('invalid_acceptance_record', field, message, cause);
}

function rethrow<T>(field: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw conditionsError(field, error instanceof Error ? error.message : String(error), error);
  }
}

const ConditionSchema = z
  .object({
    id: z.string(),
    requirement: z.string().min(1).max(4000),
    verification: z.string().min(1).max(4000).optional(),
  })
  .strict();

const ConditionsRevisionSchema = z
  .object({
    version: z.literal(1),
    issueId: z.string(),
    revisionId: z.string(),
    supersedes: z.string().nullable(),
    createdAt: z.string().refine(isCanonicalIsoTimestamp, {
      message: 'createdAt must be a canonical ISO-8601 UTC timestamp',
    }),
    contentSha256: z.string(),
    conditions: z.array(ConditionSchema),
  })
  .strict();

const GateSnapshotSchema = z
  .object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    health: z.string().refine((value: string) => SNAPSHOT_HEALTH_VALUES.includes(value), {
      message: 'health must be a value of the tri-axis health vocabulary',
    }),
    problemsStanding: z.number().int().nonnegative(),
  })
  .strict();

const AcceptedRecordSchema = z
  .object({
    version: z.literal(1),
    issueId: z.string(),
    acceptedAt: z.string().refine(isCanonicalIsoTimestamp, {
      message: 'acceptedAt must be a canonical ISO-8601 UTC timestamp',
    }),
    conditionsRevisionId: z.string(),
    conditionsSha256: z.string(),
    gate: GateSnapshotSchema,
    note: z.string().max(4000).nullable(),
    contentSha256: z.string(),
  })
  .strict();

/** One condition, validated field by field, portable text included. */
function validateCondition(raw: z.output<typeof ConditionSchema>, index: number): AcceptanceCondition {
  const id = rethrow(`conditions[${index}].id`, () => parseChangeId(raw.id, 'id'));
  assertPortableIssueText(raw.requirement, `conditions[${index}].requirement`, 'invalid_acceptance_conditions');
  if (raw.verification !== undefined) {
    assertPortableIssueText(raw.verification, `conditions[${index}].verification`, 'invalid_acceptance_conditions');
  }
  return Object.freeze({
    id,
    requirement: raw.requirement,
    ...(raw.verification === undefined ? {} : { verification: raw.verification }),
  });
}

/** The canonical body a conditions revision's digest covers: every field except the digest. */
export function acceptanceConditionsDigestBody(
  revision: Omit<AcceptanceConditionsRevisionV1, 'contentSha256'>
): unknown {
  return {
    version: revision.version,
    issueId: revision.issueId,
    revisionId: revision.revisionId,
    supersedes: revision.supersedes,
    createdAt: revision.createdAt,
    conditions: revision.conditions.map(condition => ({
      id: condition.id,
      requirement: condition.requirement,
      ...(condition.verification === undefined ? {} : { verification: condition.verification }),
    })),
  };
}

export function acceptanceConditionsDigest(
  revision: Omit<AcceptanceConditionsRevisionV1, 'contentSha256'>
): Sha256Digest {
  return createHash('sha256')
    .update(canonicalJson(acceptanceConditionsDigestBody(revision)), 'utf8')
    .digest('hex') as Sha256Digest;
}

/** The canonical body an acceptance record's digest covers: every field except the digest. */
export function acceptedRecordDigestBody(
  record: Omit<IssueAcceptedRecordV1, 'contentSha256'>
): unknown {
  return {
    version: record.version,
    issueId: record.issueId,
    acceptedAt: record.acceptedAt,
    conditionsRevisionId: record.conditionsRevisionId,
    conditionsSha256: record.conditionsSha256,
    gate: {
      completed: record.gate.completed,
      total: record.gate.total,
      health: record.gate.health,
      problemsStanding: record.gate.problemsStanding,
    },
    note: record.note,
  };
}

export function acceptedRecordDigest(
  record: Omit<IssueAcceptedRecordV1, 'contentSha256'>
): Sha256Digest {
  return createHash('sha256')
    .update(canonicalJson(acceptedRecordDigestBody(record)), 'utf8')
    .digest('hex') as Sha256Digest;
}

export interface ValidateAcceptanceOptions {
  /**
   * Whether the recorded digest must match the body. Publication computes the
   * digest and so passes `false`; every READ passes `true`, which is what makes
   * a hand-edited artifact detectable.
   */
  readonly verifyDigest?: boolean;
}

export function validateAcceptanceConditionsRevision(
  value: unknown,
  options: ValidateAcceptanceOptions = {}
): AcceptanceConditionsRevisionV1 {
  const result = ConditionsRevisionSchema.safeParse(value);
  if (!result.success) {
    throw conditionsError('revision', formatZodIssues(result.error), result.error);
  }

  const issueId: IssueId = rethrow('issueId', () => parseIssueId(result.data.issueId));
  const revisionId: ExecutionPlanRevisionId = rethrow('revisionId', () =>
    parseExecutionPlanRevisionId(result.data.revisionId)
  );
  const supersedes =
    result.data.supersedes === null
      ? null
      : rethrow('supersedes', () =>
          parseExecutionPlanRevisionId(result.data.supersedes as string, 'supersedes')
        );
  if (supersedes !== null && supersedes >= revisionId) {
    throw conditionsError('supersedes', `must precede revision '${revisionId}'`);
  }
  const contentSha256 = rethrow('contentSha256', () =>
    parseSha256Digest(result.data.contentSha256, 'contentSha256')
  );

  if (result.data.conditions.length === 0) {
    throw conditionsError('conditions', 'must carry at least one condition');
  }
  const conditions = result.data.conditions.map((condition, index) =>
    validateCondition(condition, index)
  );
  const seen = new Set<string>();
  for (const condition of conditions) {
    if (seen.has(condition.id)) {
      throw conditionsError(
        'conditions',
        `condition identifier '${condition.id}' is declared more than once`
      );
    }
    seen.add(condition.id);
  }

  const revision: AcceptanceConditionsRevisionV1 = Object.freeze({
    version: 1 as const,
    issueId,
    revisionId,
    supersedes,
    createdAt: result.data.createdAt,
    contentSha256,
    conditions: Object.freeze(conditions),
  });

  if (options.verifyDigest === true) {
    const expected = acceptanceConditionsDigest(revision);
    if (expected !== contentSha256) {
      throw conditionsError(
        'contentSha256',
        `recorded digest '${contentSha256}' does not match the revision body '${expected}'`
      );
    }
  }
  return revision;
}

export function parseAcceptanceConditionsRevision(
  content: string,
  options: ValidateAcceptanceOptions = {}
): AcceptanceConditionsRevisionV1 {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw conditionsError('revision', 'contains invalid YAML', error);
  }
  return validateAcceptanceConditionsRevision(raw, options);
}

export function serializeAcceptanceConditionsRevision(
  value: AcceptanceConditionsRevisionV1
): string {
  const revision = validateAcceptanceConditionsRevision(value, { verifyDigest: true });
  return stringifyYaml({
    version: 1,
    issueId: revision.issueId,
    revisionId: revision.revisionId,
    supersedes: revision.supersedes,
    createdAt: revision.createdAt,
    contentSha256: revision.contentSha256,
    conditions: revision.conditions.map(condition => ({
      id: condition.id,
      requirement: condition.requirement,
      ...(condition.verification === undefined ? {} : { verification: condition.verification }),
    })),
  });
}

export function validateAcceptedRecord(
  value: unknown,
  options: ValidateAcceptanceOptions = {}
): IssueAcceptedRecordV1 {
  const result = AcceptedRecordSchema.safeParse(value);
  if (!result.success) {
    throw recordError('record', formatZodIssues(result.error), result.error);
  }

  const issueId: IssueId = recordRethrow('issueId', () => parseIssueId(result.data.issueId));
  const conditionsRevisionId: ExecutionPlanRevisionId = recordRethrow(
    'conditionsRevisionId',
    () => parseExecutionPlanRevisionId(result.data.conditionsRevisionId)
  );
  const conditionsSha256 = recordRethrow('conditionsSha256', () =>
    parseSha256Digest(result.data.conditionsSha256, 'conditionsSha256')
  );
  const contentSha256 = recordRethrow('contentSha256', () =>
    parseSha256Digest(result.data.contentSha256, 'contentSha256')
  );
  if (result.data.note !== null) {
    assertPortableIssueText(result.data.note, 'note', 'invalid_acceptance_record');
  }

  const record: IssueAcceptedRecordV1 = Object.freeze({
    version: 1 as const,
    issueId,
    acceptedAt: result.data.acceptedAt,
    conditionsRevisionId,
    conditionsSha256,
    gate: Object.freeze({
      completed: result.data.gate.completed,
      total: result.data.gate.total,
      health: result.data.gate.health as IssueAcceptedRecordV1['gate']['health'],
      problemsStanding: result.data.gate.problemsStanding,
    }),
    note: result.data.note,
    contentSha256,
  });

  // Close evidence is coherent by definition: the record's own body says the
  // counts add up, the health is a real vocabulary value, and no problem
  // stood. A hand-crafted record that re-digests over a contradiction is
  // refused here rather than presented as proof of an acceptance.
  assertCoherentGateSnapshot(record.gate);

  if (options.verifyDigest === true) {
    const expected = acceptedRecordDigest(record);
    if (expected !== contentSha256) {
      throw recordError(
        'contentSha256',
        `recorded digest '${contentSha256}' does not match the record body '${expected}'`
      );
    }
  }
  return record;
}

function recordRethrow<T>(field: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw recordError(field, error instanceof Error ? error.message : String(error), error);
  }
}

export function parseAcceptedRecord(
  content: string,
  options: ValidateAcceptanceOptions = {}
): IssueAcceptedRecordV1 {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw recordError('record', 'contains invalid YAML', error);
  }
  return validateAcceptedRecord(raw, options);
}

export function serializeAcceptedRecord(value: IssueAcceptedRecordV1): string {
  const record = validateAcceptedRecord(value, { verifyDigest: true });
  return stringifyYaml({
    version: 1,
    issueId: record.issueId,
    acceptedAt: record.acceptedAt,
    conditionsRevisionId: record.conditionsRevisionId,
    conditionsSha256: record.conditionsSha256,
    gate: {
      completed: record.gate.completed,
      total: record.gate.total,
      health: record.gate.health,
      problemsStanding: record.gate.problemsStanding,
    },
    note: record.note,
    contentSha256: record.contentSha256,
  });
}

/**
 * Ordering by code point, deliberately NOT `localeCompare` — the same rule
 * `plans.ts` states at length: the order this decides is a digest preimage, so
 * it must be the same on every machine that ever publishes.
 */
function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Normalizes authored conditions into the validated CANONICAL shape: the schema
 * per condition, the portable-text contract, no duplicate identifiers, and
 * conditions ordered by `id` — so two spellings of one checklist (conditions
 * listed in a different order) publish one digest instead of two revisions
 * that differ in nothing. Sited at the publication boundary
 * (`publishAcceptance`), never on the read path, for the same reason
 * `normalizePlanNodes` is.
 */
export function normalizeAcceptanceConditions(
  inputs: readonly AcceptanceConditionInput[]
): readonly AcceptanceCondition[] {
  const raw = z.array(ConditionSchema).safeParse(
    inputs.map(input => ({
      id: input.id,
      requirement: input.requirement,
      ...(input.verification === undefined ? {} : { verification: input.verification }),
    }))
  );
  if (!raw.success) {
    throw conditionsError('conditions', formatZodIssues(raw.error), raw.error);
  }
  const conditions = raw.data.map((condition, index) => validateCondition(condition, index));
  if (conditions.length === 0) {
    throw conditionsError('conditions', 'must carry at least one condition');
  }
  const seen = new Set<string>();
  for (const condition of conditions) {
    if (seen.has(condition.id)) {
      throw conditionsError(
        'conditions',
        `condition identifier '${condition.id}' is declared more than once`
      );
    }
    seen.add(condition.id);
  }
  return Object.freeze([...conditions].sort((left, right) => compareCodePoints(left.id, right.id)));
}

/**
 * The FULL set of invariants every genuine acceptance snapshot satisfies —
 * the ones an eligible gate evaluation itself guarantees (design D3): every
 * required node counted complete, health not failed, and no problem standing.
 * One definition, enforced both where a snapshot is accepted as mutation
 * input and where a stored record is read back, so a hand-crafted record
 * re-digested over ANY of these contradictions is refused rather than
 * presented as verified close evidence.
 */
export function assertCoherentGateSnapshot(snapshot: AcceptanceGateSnapshot): void {
  if (snapshot.completed < 0 || snapshot.total < 0) {
    throw recordError('gate', 'counts must be non-negative integers');
  }
  if (snapshot.completed > snapshot.total) {
    throw recordError('gate', `completed (${snapshot.completed}) exceeds total (${snapshot.total})`);
  }
  if (snapshot.completed !== snapshot.total) {
    throw recordError(
      'gate',
      `completed (${snapshot.completed}) must equal total (${snapshot.total}) at acceptance — the gate passes only when every required node is complete`
    );
  }
  if (!SNAPSHOT_HEALTH_VALUES.includes(snapshot.health)) {
    throw recordError('gate', 'health must be a value of the tri-axis health vocabulary');
  }
  if (snapshot.health === 'failed') {
    throw recordError('gate', 'health must not be failed at acceptance — a failed gate never passes');
  }
  if (snapshot.problemsStanding !== 0) {
    throw recordError(
      'gate',
      `problemsStanding must be zero at acceptance (found ${snapshot.problemsStanding})`
    );
  }
}
