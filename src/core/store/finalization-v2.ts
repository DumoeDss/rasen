import { z } from 'zod';

import { canonicalJson } from '../canonical-json.js';
import { formatZodIssues } from '../zod-issues.js';
import { isValidStoreUid, normalizeStoreUid } from './identity-types.js';
import {
  parseChangeInstanceId,
  parseWorkspacePairId,
  parseWorktreeInstanceId,
  verifyWorkspacePairId,
  type ChangeInstanceId,
  type VerifiedChangeInstanceId,
  type VerifiedWorkspacePairId,
  type WorkspacePairId,
  type WorktreeInstanceId,
} from './planning-identity.js';
import {
  StorePlanningValidationError,
  isCanonicalIsoTimestamp,
  parseChangeId,
  parseFullGitRef,
  parseGitOid,
  parsePortableRelativePath,
  parseProjectId,
  parseSha256Digest,
  parseTargetLineId,
  portablePathIdentity,
  type ChangeId,
  type FullGitRef,
  type GitOid,
  type PortableRelativePath,
  type ProjectId,
  type Sha256Digest,
  type TargetLineId,
} from './planning-validation.js';

function archiveError(field: string, message: string, cause?: unknown): StorePlanningValidationError {
  return new StorePlanningValidationError('invalid_archive_v2', field, message, cause);
}

function parsedString<T extends string>(
  parser: (value: string) => T
): z.ZodPipe<z.ZodString, z.ZodTransform<T, string>> {
  return z
    .string()
    .superRefine((value, ctx) => {
      try {
        parser(value);
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })
    .transform(value => parser(value));
}

const ProjectIdSchema = parsedString(value => parseProjectId(value));
const TargetLineIdSchema = parsedString(value => parseTargetLineId(value));
const ChangeIdSchema = parsedString(value => parseChangeId(value));
const FullGitRefSchema = parsedString(value => parseFullGitRef(value));
const GitOidSchema = parsedString(value => parseGitOid(value));
const Sha256DigestSchema = parsedString(value => parseSha256Digest(value));
const PortableRelativePathSchema = parsedString(value => parsePortableRelativePath(value));
// Archive JSON does not carry a Change seed/planning-scope preimage, so these
// schemas intentionally return format-valid wire ids rather than verified ids.
const ChangeInstanceIdSchema = parsedString(value => parseChangeInstanceId(value));
const WorktreeInstanceIdSchema = parsedString(value => parseWorktreeInstanceId(value));
const WorkspacePairIdSchema = parsedString(value => parseWorkspacePairId(value));

const StoreUidSchema = z
  .string()
  .refine(isValidStoreUid, { message: 'must be a well-formed permanent Store UUID' })
  .transform(normalizeStoreUid);

const CanonicalTimestampSchema = z.string().refine(isCanonicalIsoTimestamp, {
  message: 'must be a canonical ISO-8601 UTC timestamp',
});

const CanonicalNonEmptyStringSchema = z
  .string()
  .min(1)
  .refine(value => value === value.trim(), {
    message: 'must not contain surrounding whitespace',
  })
  .refine(value => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: 'must not contain control characters',
  });

export const FinalizationOutcomeSchema = z.union([
  z.object({ outcome: z.literal('landed') }).strict(),
  z
    .object({
      outcome: z.literal('superseded'),
      reason: z.string().trim().min(1),
      supersededBy: ChangeInstanceIdSchema,
    })
    .strict(),
  z.object({ outcome: z.literal('cancelled'), reason: z.string().trim().min(1) }).strict(),
  z.object({ outcome: z.literal('abandoned'), reason: z.string().trim().min(1) }).strict(),
]);

export type FinalizationOutcome = z.output<typeof FinalizationOutcomeSchema>;

export function parseFinalizationOutcome(value: unknown): FinalizationOutcome {
  const result = FinalizationOutcomeSchema.safeParse(value);
  if (!result.success) {
    throw archiveError('outcome', formatZodIssues(result.error), result.error);
  }
  return result.data;
}

export interface FinalizationScopeRecord {
  readonly storeUid: string;
  readonly projectId: string | ProjectId;
  readonly targetLineId: string | TargetLineId;
  readonly changeInstanceId: string | ChangeInstanceId;
}

export interface ValidatedFinalizationScopeRecord {
  readonly storeUid: string;
  readonly projectId: ProjectId;
  readonly targetLineId: TargetLineId;
  readonly changeInstanceId: ChangeInstanceId;
}

function validateScopeRecord(
  value: FinalizationScopeRecord,
  field: string
): ValidatedFinalizationScopeRecord {
  try {
    if (!isValidStoreUid(value.storeUid)) {
      throw new Error('storeUid must be a well-formed permanent Store UUID');
    }
    return Object.freeze({
      storeUid: normalizeStoreUid(value.storeUid),
      projectId: parseProjectId(value.projectId, `${field}.projectId`),
      targetLineId: parseTargetLineId(value.targetLineId, `${field}.targetLineId`),
      changeInstanceId: parseChangeInstanceId(
        value.changeInstanceId,
        `${field}.changeInstanceId`
      ),
    });
  } catch (error) {
    throw archiveError(field, error instanceof Error ? error.message : String(error), error);
  }
}

export function validateFinalizationOutcome(
  value: unknown,
  currentScope: FinalizationScopeRecord,
  successorScope?: FinalizationScopeRecord
): FinalizationOutcome {
  const outcome = parseFinalizationOutcome(value);
  const current = validateScopeRecord(currentScope, 'currentScope');
  if (outcome.outcome !== 'superseded') {
    if (successorScope !== undefined) {
      throw archiveError('successorScope', 'is only valid for a superseded outcome');
    }
    return outcome;
  }
  if (successorScope === undefined) {
    throw archiveError('successorScope', 'is required to verify a superseded outcome');
  }
  const successor = validateScopeRecord(successorScope, 'successorScope');
  if (successor.changeInstanceId !== outcome.supersededBy) {
    throw archiveError('supersededBy', 'does not match the resolved successor scope');
  }
  if (successor.storeUid !== current.storeUid || successor.projectId !== current.projectId) {
    throw archiveError(
      'supersededBy',
      'must resolve to the same permanent Store and project as the current Change'
    );
  }
  return outcome;
}

const ArchivePlanningFactsSchema = z
  .object({
    worktreeInstanceId: WorktreeInstanceIdSchema,
    sourceRef: FullGitRefSchema,
    sourceHead: GitOidSchema,
    targetRef: FullGitRefSchema,
  })
  .strict();

const ArchiveCodeMergeSchema = z
  .object({
    repoUid: CanonicalNonEmptyStringSchema,
    worktreeInstanceId: WorktreeInstanceIdSchema,
    targetRef: FullGitRefSchema,
    commit: GitOidSchema,
    reachable: z.literal(true),
  })
  .strict();

const CapabilityPathSchema = z.string().superRefine((value, context) => {
  const segments = value.split('/');
  if (
    value.length === 0 ||
    value.includes('\\') ||
    segments.some(
      segment =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        !ChangeIdSchema.safeParse(segment).success
    )
  ) {
    context.addIssue({
      code: 'custom',
      message:
        'Capability must be a slash-delimited path of canonical lowercase kebab-case ids',
    });
  }
});

export const ArchiveSpecActionSchema = z.union([
  z
    .object({
      action: z.literal('create'),
      capabilityId: CapabilityPathSchema,
      beforeSha256: z.null(),
      afterSha256: Sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      capabilityId: CapabilityPathSchema,
      beforeSha256: Sha256DigestSchema,
      afterSha256: Sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      capabilityId: CapabilityPathSchema,
      beforeSha256: Sha256DigestSchema,
      afterSha256: z.null(),
    })
    .strict(),
]);

export type ArchiveSpecAction = z.output<typeof ArchiveSpecActionSchema>;

const ArchiveEvidenceEntrySchema = z
  .object({
    path: PortableRelativePathSchema,
    sha256: Sha256DigestSchema,
  })
  .strict();

const ArchiveEvidenceSchema = z.array(ArchiveEvidenceEntrySchema).superRefine((entries, ctx) => {
  const paths = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const identity = portablePathIdentity(entry.path);
    if (paths.has(identity)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'path'],
        message: 'duplicates another portable case-insensitive evidence path',
      });
    }
    paths.add(identity);
  }
});

const MissingEvidenceSchema = z
  .array(CanonicalNonEmptyStringSchema)
  .superRefine((entries, ctx) => {
    const names = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      const identity = entry.toLowerCase();
      if (names.has(identity)) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: 'duplicates another missing-evidence name',
        });
      }
      names.add(identity);
    }
  });

const LandedSpecSyncSchema = z
  .object({
    applied: z.literal(true),
    actions: z.array(ArchiveSpecActionSchema),
  })
  .strict();

const PassiveSpecSyncSchema = z
  .object({
    applied: z.literal(false),
    actions: z.tuple([]),
  })
  .strict();

const ArchiveCommonShape = {
  schemaVersion: z.literal(2),
  implementation: z.enum(['code', 'none']),
  storeUid: StoreUidSchema,
  projectId: ProjectIdSchema,
  targetLineId: TargetLineIdSchema,
  changeId: ChangeIdSchema,
  changeInstanceId: ChangeInstanceIdSchema,
  workspacePairId: WorkspacePairIdSchema,
};

const ArchiveTailShape = {
  planning: ArchivePlanningFactsSchema,
  evidence: ArchiveEvidenceSchema,
  missing: MissingEvidenceSchema,
  archivedAt: CanonicalTimestampSchema,
};

const LandedCodeArchiveSchema = z
  .object({
    ...ArchiveCommonShape,
    implementation: z.literal('code'),
    outcome: z.literal('landed'),
    reason: z.null(),
    supersededBy: z.null(),
    planning: ArchiveTailShape.planning,
    codeMerge: ArchiveCodeMergeSchema,
    specSync: LandedSpecSyncSchema,
    evidence: ArchiveTailShape.evidence,
    missing: ArchiveTailShape.missing,
    archivedAt: ArchiveTailShape.archivedAt,
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      verifyWorkspacePairId(value.workspacePairId, {
        changeInstanceId: value.changeInstanceId,
        planningWorktreeInstanceId: value.planning.worktreeInstanceId,
        executionWorktreeInstanceId: value.codeMerge.worktreeInstanceId,
      });
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['workspacePairId'],
        message:
          error instanceof Error
            ? error.message
            : 'does not match the supplied Change and ordered worktree identities',
      });
    }
  });

const LandedPlanningOnlyArchiveSchema = z
  .object({
    ...ArchiveCommonShape,
    implementation: z.literal('none'),
    outcome: z.literal('landed'),
    reason: z.null(),
    supersededBy: z.null(),
    planning: ArchiveTailShape.planning,
    codeMerge: z.null(),
    specSync: LandedSpecSyncSchema,
    evidence: ArchiveTailShape.evidence,
    missing: ArchiveTailShape.missing,
    archivedAt: ArchiveTailShape.archivedAt,
  })
  .strict();

function passiveArchiveSchema(outcome: 'cancelled' | 'abandoned') {
  return z
    .object({
      ...ArchiveCommonShape,
      outcome: z.literal(outcome),
      reason: z.string().trim().min(1),
      supersededBy: z.null(),
      planning: ArchiveTailShape.planning,
      codeMerge: z.null(),
      specSync: PassiveSpecSyncSchema,
      evidence: ArchiveTailShape.evidence,
      missing: ArchiveTailShape.missing,
      archivedAt: ArchiveTailShape.archivedAt,
    })
    .strict();
}

const SupersededArchiveSchema = z
  .object({
    ...ArchiveCommonShape,
    outcome: z.literal('superseded'),
    reason: z.string().trim().min(1),
    supersededBy: ChangeInstanceIdSchema,
    planning: ArchiveTailShape.planning,
    codeMerge: z.null(),
    specSync: PassiveSpecSyncSchema,
    evidence: ArchiveTailShape.evidence,
    missing: ArchiveTailShape.missing,
    archivedAt: ArchiveTailShape.archivedAt,
  })
  .strict();

export const ArchiveV2Schema = z.union([
  LandedCodeArchiveSchema,
  LandedPlanningOnlyArchiveSchema,
  SupersededArchiveSchema,
  passiveArchiveSchema('cancelled'),
  passiveArchiveSchema('abandoned'),
]);

/**
 * Strict Archive v2 wire shape. Identity fields are format-valid but remain
 * unverified unless their derivation preimages were available at this boundary.
 */
export type ArchiveV2Wire = z.output<typeof ArchiveV2Schema>;

/** Compatibility name for the Archive v2 wire contract. */
export type ArchiveV2 = ArchiveV2Wire;

/** Durable writers must obtain both identities from derivation/verification APIs. */
export interface ArchiveV2VerifiedIdentityInput {
  readonly changeInstanceId: VerifiedChangeInstanceId;
  readonly workspacePairId: VerifiedWorkspacePairId;
}

export function validateArchiveV2(value: unknown): ArchiveV2Wire {
  const result = ArchiveV2Schema.safeParse(value);
  if (!result.success) {
    throw archiveError('archive', formatZodIssues(result.error), result.error);
  }
  return result.data;
}

export function parseArchiveV2(content: string): ArchiveV2Wire {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw archiveError('archive', 'contains invalid JSON or a forbidden UTF-8 BOM', error);
  }
  return validateArchiveV2(raw);
}

export function serializeArchiveV2<T extends ArchiveV2VerifiedIdentityInput>(value: T): string {
  const validated = validateArchiveV2(value);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  const verified = parseArchiveV2(serialized);
  if (canonicalJson(verified) !== canonicalJson(validated)) {
    throw archiveError('archive', 'self-verification changed the validated record');
  }
  return serialized;
}

/** Verifies strict serialization/equality; it does not invent missing identity preimages. */
export function verifyArchiveV2(content: string, expected?: unknown): ArchiveV2Wire {
  const parsed = parseArchiveV2(content);
  if (expected !== undefined) {
    const validatedExpected = validateArchiveV2(expected);
    if (canonicalJson(parsed) !== canonicalJson(validatedExpected)) {
      throw archiveError('archive', 'parsed record differs from the expected validated record');
    }
  }
  return parsed;
}

export type ArchivePlanningFacts = z.output<typeof ArchivePlanningFactsSchema>;
export type ArchiveCodeMerge = z.output<typeof ArchiveCodeMergeSchema>;
export type ArchiveEvidenceEntry = z.output<typeof ArchiveEvidenceEntrySchema>;

// Public aliases make the branded contract vocabulary visible in generated d.ts.
export type {
  ChangeId,
  ChangeInstanceId,
  FullGitRef,
  GitOid,
  PortableRelativePath,
  ProjectId,
  Sha256Digest,
  TargetLineId,
  VerifiedChangeInstanceId,
  VerifiedWorkspacePairId,
  WorkspacePairId,
  WorktreeInstanceId,
};
