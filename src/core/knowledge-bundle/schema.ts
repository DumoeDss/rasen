/**
 * Closed, versioned portable-project-knowledge bundle contract.
 *
 * The permitted-field constants are the authority for both readers and
 * writers. A writer selects only these names; a reader rejects every unknown
 * name. Adding a field therefore requires changing the closed contract here,
 * rather than silently widening export through object spreading.
 */

import * as fs from 'node:fs';

import { z } from 'zod';

import { digestContent } from '../learned-skills/catalog.js';
import { LearnedSkillManifestSchema } from '../learned-skills/schema.js';
import type { LearnedSkillManifest } from '../learned-skills/types.js';

export const KNOWLEDGE_BUNDLE_VERSION = 1 as const;

export const KNOWLEDGE_BUNDLE_PERMITTED_FIELDS = [
  'version',
  'bundleId',
  'projectId',
  'createdAt',
  'baseProjectCommit',
  'records',
] as const;

export const KNOWLEDGE_BUNDLE_RECORD_PERMITTED_FIELDS = [
  'id',
  'knowledgeKey',
  'contentDigest',
  'manifest',
  'content',
] as const;

export const KNOWLEDGE_BUNDLE_MANIFEST_V1_PERMITTED_FIELDS = [
  'version',
  'id',
  'knowledgeKey',
  'scope',
  'status',
  'generatedBy',
  'contentDigest',
  'description',
  'applicability',
  'evidence',
  'evidenceOverflow',
  'createdAt',
  'updatedAt',
  'retiredAt',
  'retirementReason',
] as const;

export const KNOWLEDGE_BUNDLE_MANIFEST_V2_PERMITTED_FIELDS = [
  ...KNOWLEDGE_BUNDLE_MANIFEST_V1_PERMITTED_FIELDS,
  'owner',
  'sources',
] as const;

type PermittedField = string;

function selectPermittedFields(
  value: Record<string, unknown>,
  permitted: readonly PermittedField[]
): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const field of permitted) {
    if (value[field] !== undefined) selected[field] = value[field];
  }
  return selected;
}

function assertOnlyPermittedFields(
  value: Record<string, unknown>,
  permitted: readonly PermittedField[],
  context: z.RefinementCtx
): void {
  const allowed = new Set(permitted);
  for (const field of Object.keys(value)) {
    if (allowed.has(field)) continue;
    context.addIssue({
      code: 'custom',
      path: [field],
      message: `unknown field "${field}"`,
    });
  }
}

const KnowledgeBundleRecordSchema = z
  .object({
    id: z.string().min(1),
    knowledgeKey: z.string().min(1),
    contentDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    manifest: LearnedSkillManifestSchema,
    content: z.string(),
  })
  .strict()
  .superRefine((record, context) => {
    assertOnlyPermittedFields(
      record as Record<string, unknown>,
      KNOWLEDGE_BUNDLE_RECORD_PERMITTED_FIELDS,
      context
    );
    if (record.id !== record.manifest.id) {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'id'],
        message: 'manifest id must match the bundle record id',
      });
    }
    if (record.knowledgeKey !== record.manifest.knowledgeKey) {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'knowledgeKey'],
        message: 'manifest knowledgeKey must match the bundle record knowledgeKey',
      });
    }
    if (record.contentDigest !== record.manifest.contentDigest) {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'contentDigest'],
        message: 'manifest contentDigest must match the bundle record contentDigest',
      });
    }
    if (digestContent(record.content) !== record.contentDigest) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'canonical content must match the recorded contentDigest',
      });
    }
    if (record.manifest.scope !== 'project') {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'scope'],
        message: 'a project bundle may contain only project-owned records',
      });
    }
  });

export const KnowledgeBundleSchema = z
  .object({
    version: z.literal(KNOWLEDGE_BUNDLE_VERSION),
    bundleId: z.string().uuid(),
    projectId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    baseProjectCommit: z.string().min(1).nullable(),
    records: z.array(KnowledgeBundleRecordSchema),
  })
  .strict()
  .superRefine((bundle, context) => {
    assertOnlyPermittedFields(
      bundle as Record<string, unknown>,
      KNOWLEDGE_BUNDLE_PERMITTED_FIELDS,
      context
    );
    for (const [index, record] of bundle.records.entries()) {
      if (
        record.manifest.version === 2 &&
        (record.manifest.owner.type !== 'project' ||
          record.manifest.owner.projectId !== bundle.projectId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['records', index, 'manifest', 'owner'],
          message: 'record owner must be the project identity named by the bundle',
        });
      }
    }
  });

export type KnowledgeBundle = z.infer<typeof KnowledgeBundleSchema>;
export type KnowledgeBundleRecord = z.infer<typeof KnowledgeBundleRecordSchema>;

export class UnsupportedKnowledgeBundleVersionError extends Error {
  readonly code = 'knowledge_bundle_version_unsupported';
  readonly found: number;
  readonly supported = KNOWLEDGE_BUNDLE_VERSION;

  constructor(found: number) {
    super(
      `Knowledge bundle version ${found} is newer than supported version ${KNOWLEDGE_BUNDLE_VERSION}.`
    );
    this.name = 'UnsupportedKnowledgeBundleVersionError';
    this.found = found;
  }
}

export class KnowledgeBundleMachinePathError extends Error {
  readonly code = 'knowledge_bundle_machine_path';
  readonly recordId: string;
  readonly field: string;
  readonly value: string;

  constructor(recordId: string, field: string, value: string) {
    super(`Record "${recordId}" field "${field}" contains an absolute machine path.`);
    this.name = 'KnowledgeBundleMachinePathError';
    this.recordId = recordId;
    this.field = field;
    this.value = value;
  }
}

function exactAbsoluteMachinePath(value: string): string | null {
  const candidate = value.trim();
  if (/^[A-Za-z]:[\\/]/u.test(candidate)) return readPathToken(candidate, 0);
  if (/^(?:\\\\|\/\/)[^\\/\s]+[\\/][^\\/\s]+/u.test(candidate)) {
    return readPathToken(candidate, 0);
  }
  if (/^\/+/u.test(candidate)) return readPathToken(candidate, 0);
  return null;
}

const EMBEDDED_PATH_CONTINUATION = /[A-Za-z0-9._~+\/\\#]/u;
const PATH_TOKEN_TERMINATOR = /[\s"'\x60<>|)\]},;]/u;

function isEmbeddedPathBoundary(value: string, index: number): boolean {
  return index === 0 || !EMBEDDED_PATH_CONTINUATION.test(value[index - 1]!);
}

function readPathToken(value: string, start: number): string {
  let end = start;
  while (end < value.length && !PATH_TOKEN_TERMINATOR.test(value[end]!)) end += 1;
  return value.slice(start, end);
}

function isUrlAuthorityStart(value: string, index: number): boolean {
  if (!value.startsWith('//', index) || value.startsWith('///', index)) return false;
  return /[A-Za-z][A-Za-z0-9+.-]*:$/u.test(value.slice(0, index));
}

function isInsideOrdinaryUrl(value: string, index: number): boolean {
  const prefix = value.slice(0, index);
  const match =
    /(?:^|[\s"'\x60(<[{=,;])([A-Za-z][A-Za-z0-9+.-]*):\/\/[^\s"'\x60<>]*$/u.exec(
      prefix
    );
  return match !== null && match[1]!.toLocaleLowerCase() !== 'file';
}

function embeddedAbsoluteMachinePath(value: string): string | null {
  for (let index = 0; index + 2 < value.length; index += 1) {
    if (!isEmbeddedPathBoundary(value, index)) continue;
    if (
      /[A-Za-z]/u.test(value[index]!) &&
      value[index + 1] === ':' &&
      (value[index + 2] === '\\' || value[index + 2] === '/')
    ) {
      return readPathToken(value, index);
    }
  }

  for (let index = 0; index + 1 < value.length; index += 1) {
    if (!isEmbeddedPathBoundary(value, index)) continue;
    const hasNetworkPrefix =
      (value[index] === '\\' && value[index + 1] === '\\') ||
      (value[index] === '/' && value[index + 1] === '/');
    if (!hasNetworkPrefix || isUrlAuthorityStart(value, index)) continue;
    const candidate = readPathToken(value, index);
    if (/^(?:\\\\|\/\/)[^\\/\s]+[\\/][^\\/\s]+/u.test(candidate)) {
      return candidate;
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] !== '/' ||
      !isEmbeddedPathBoundary(value, index) ||
      isUrlAuthorityStart(value, index) ||
      isInsideOrdinaryUrl(value, index)
    ) {
      continue;
    }
    let firstSegment = index;
    while (value[firstSegment] === '/') firstSegment += 1;
    if (
      firstSegment < value.length &&
      !PATH_TOKEN_TERMINATOR.test(value[firstSegment]!)
    ) {
      return readPathToken(value, index);
    }
  }

  return null;
}

/** Finds Windows drive, Windows network-share, and POSIX absolute forms on every host. */
export function findAbsoluteMachinePath(value: string): string | null {
  return exactAbsoluteMachinePath(value) ?? embeddedAbsoluteMachinePath(value);
}

/**
 * Walks a complete serialized bundle and refuses a machine path before any
 * writer may create a destination-side file. The field path and owning record
 * are preserved for a localized, actionable refusal.
 */
export function assertNoMachinePath(value: unknown): void {
  const walk = (current: unknown, field: string, recordId: string): void => {
    if (typeof current === 'string') {
      const machinePath = findAbsoluteMachinePath(current);
      if (machinePath !== null) {
        throw new KnowledgeBundleMachinePathError(recordId, field, machinePath);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => {
        const nextRecordId =
          field === 'records' &&
          typeof (entry as { id?: unknown } | null)?.id === 'string'
            ? String((entry as { id: string }).id)
            : recordId;
        walk(entry, `${field}[${index}]`, nextRecordId);
      });
      return;
    }
    if (typeof current !== 'object' || current === null) return;
    for (const [key, entry] of Object.entries(current)) {
      const nextField = field ? `${field}.${key}` : key;
      walk(entry, nextField, recordId);
    }
  };
  walk(value, '', '<bundle>');
}

/**
 * Explicit manifest projection. A future managed-record field is omitted until
 * this bundle contract names it and the bundle version changes accordingly.
 */
export function selectPortableManifest(manifest: LearnedSkillManifest): LearnedSkillManifest {
  const permitted =
    manifest.version === 1
      ? KNOWLEDGE_BUNDLE_MANIFEST_V1_PERMITTED_FIELDS
      : KNOWLEDGE_BUNDLE_MANIFEST_V2_PERMITTED_FIELDS;
  return selectPermittedFields(
    manifest as unknown as Record<string, unknown>,
    permitted
  ) as unknown as LearnedSkillManifest;
}

export function createKnowledgeBundleRecord(input: {
  id: string;
  knowledgeKey: string;
  contentDigest: string;
  manifest: LearnedSkillManifest;
  content: string;
}): KnowledgeBundleRecord {
  const selected = selectPermittedFields(
    {
      id: input.id,
      knowledgeKey: input.knowledgeKey,
      contentDigest: input.contentDigest,
      manifest: selectPortableManifest(input.manifest),
      content: input.content,
    },
    KNOWLEDGE_BUNDLE_RECORD_PERMITTED_FIELDS
  );
  return KnowledgeBundleRecordSchema.parse(selected);
}

export function createKnowledgeBundle(input: {
  bundleId: string;
  projectId: string;
  createdAt: string;
  baseProjectCommit: string | null;
  records: KnowledgeBundleRecord[];
}): KnowledgeBundle {
  const selected = selectPermittedFields(
    {
      version: KNOWLEDGE_BUNDLE_VERSION,
      bundleId: input.bundleId,
      projectId: input.projectId,
      createdAt: input.createdAt,
      baseProjectCommit: input.baseProjectCommit,
      records: input.records,
    },
    KNOWLEDGE_BUNDLE_PERMITTED_FIELDS
  );
  const bundle = KnowledgeBundleSchema.parse(selected);
  assertNoMachinePath(bundle);
  return bundle;
}

/** Parses untrusted JSON and validates the complete bundle without writing anything. */
export function parseKnowledgeBundleJson(content: string): KnowledgeBundle {
  const raw: unknown = JSON.parse(content);
  if (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { version?: unknown }).version === 'number' &&
    (raw as { version: number }).version > KNOWLEDGE_BUNDLE_VERSION
  ) {
    throw new UnsupportedKnowledgeBundleVersionError((raw as { version: number }).version);
  }
  const bundle = KnowledgeBundleSchema.parse(raw);
  assertNoMachinePath(bundle);
  return bundle;
}

/** Non-writing reader: this module has no mutation, migration, or catalog dependency. */
export function readKnowledgeBundle(filePath: string): KnowledgeBundle {
  return parseKnowledgeBundleJson(fs.readFileSync(filePath, 'utf8'));
}
