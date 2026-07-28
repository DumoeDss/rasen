/**
 * Strict Zod schemas for the closed candidate and manifest shapes. Strictness
 * is a deliberate part of the security boundary (design D8): an unknown field,
 * a malformed digest, or an out-of-range value fails validation before any
 * mutation, limiting the blast radius of untrusted candidate input.
 */

import { z } from 'zod';

import {
  LEARNED_SKILL_CANDIDATE_VERSION,
  LEARNED_SKILL_CANDIDATE_V1_VERSION,
  LEARNED_SKILL_MANIFEST_VERSION,
  LEARNED_SKILL_MANIFEST_V1_VERSION,
} from './constants.js';

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, {
  message: 'digest must be a sha256:<64 hex> string',
});

const ApplicabilitySchema = z
  .object({
    mode: z.enum(['all', 'any']),
    markers: z.array(z.string()).min(1),
  })
  .strict();

const EvidenceSchema = z
  .object({
    projectId: z.string().min(1),
    change: z.string().min(1),
    artifact: z.string().min(1),
    digest: DigestSchema,
  })
  .strict();

/**
 * The SELECTOR/frozen owner shape: `id` is whatever the caller named. Left
 * exactly as it was, because a run-state file written by an earlier version
 * must keep parsing.
 */
export const KnowledgeOwnerRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('project'), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('store'), id: z.string().min(1) }).strict(),
]);

/**
 * The DURABLE owner shape a catalog record is keyed on. The Store arm requires
 * the permanent identity and treats the display alias as an optional
 * convenience — a record that names only an alias is not accepted, which is
 * what makes "renaming a Store changes nothing already recorded" enforceable
 * rather than aspirational.
 */
export const DurableKnowledgeOwnerRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z
    .object({
      type: z.literal('project'),
      projectId: z.string().min(1),
      id: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('store'),
      uid: z.string().min(1),
      id: z.string().min(1).optional(),
    })
    .strict(),
]);

/** Evidence and promotion sources are never owned by the global scope. */
export const DurableEvidenceOwnerRefSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('project'),
      projectId: z.string().min(1),
      id: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('store'),
      uid: z.string().min(1),
      id: z.string().min(1).optional(),
    })
    .strict(),
]);

const TypedEvidenceSchema = z
  .object({
    owner: DurableEvidenceOwnerRefSchema,
    change: z.string().min(1),
    artifact: z.string().min(1),
    digest: DigestSchema,
  })
  .strict();

const PromotionSourceLocatorSchema = z
  .object({
    owner: DurableEvidenceOwnerRefSchema,
    id: z.string().min(1),
    knowledgeKey: z.string().min(1),
  })
  .strict();

export const KnowledgePlanningRootRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project'), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('store'), id: z.string().min(1) }).strict(),
]);

export const FrozenExecutionRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('planning-only') }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1) }).strict(),
]);

/** A frozen planning root named by permanent identity (version 3). */
export const DurableKnowledgePlanningRootRefSchema = DurableEvidenceOwnerRefSchema;

/**
 * Every version parses. A version 1 record is a run frozen before execution
 * bindings existed and reads as "no execution binding recorded" — never an
 * error, which is what lets a resume of an older run keep working. Versions 1
 * and 2 name their owner by display alias; version 3, which is what new runs
 * write, names it by permanent identity.
 */
export const FrozenKnowledgeContextSchema = z.discriminatedUnion('version', [
  z
    .object({
      version: z.literal(1),
      planningRoot: KnowledgePlanningRootRefSchema,
      owner: KnowledgeOwnerRefSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(2),
      planningRoot: KnowledgePlanningRootRefSchema,
      owner: KnowledgeOwnerRefSchema,
      execution: FrozenExecutionRefSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(3),
      planningRoot: DurableKnowledgePlanningRootRefSchema,
      owner: DurableKnowledgeOwnerRefSchema,
      execution: FrozenExecutionRefSchema.optional(),
    })
    .strict(),
]);

const CandidateV1Fields = {
  version: z.literal(LEARNED_SKILL_CANDIDATE_V1_VERSION),
  scope: z.enum(['project', 'global']),
  id: z.string().min(1),
  knowledgeKey: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  applicability: ApplicabilitySchema,
  evidence: z.array(EvidenceSchema),
};

const CandidateV2Fields = {
  version: z.literal(LEARNED_SKILL_CANDIDATE_VERSION),
  scope: z.enum(['project', 'store', 'global']),
  owner: DurableKnowledgeOwnerRefSchema,
  id: z.string().min(1),
  knowledgeKey: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  applicability: ApplicabilitySchema,
  evidence: z.array(TypedEvidenceSchema),
  sources: z.array(PromotionSourceLocatorSchema),
};

/**
 * A candidate's declared owner must be the same CLASS as its declared scope.
 * The candidate is untrusted input, so the two are checked against each other
 * here rather than one being believed on the other's behalf.
 */
function ownerMatchesScope(
  value: { owner: z.infer<typeof DurableKnowledgeOwnerRefSchema>; scope: string },
  context: z.RefinementCtx
): void {
  if (value.owner.type !== value.scope) {
    context.addIssue({
      code: 'custom',
      path: ['owner'],
      message: 'the declared owner must match the declared scope',
    });
  }
}

const V1Candidates = [
  z.object({ ...CandidateV1Fields, operation: z.literal('upsert') }).strict(),
  z.object({ ...CandidateV1Fields, operation: z.literal('promote') }).strict(),
  z
    .object({
      version: z.literal(LEARNED_SKILL_CANDIDATE_V1_VERSION),
      operation: z.literal('retire'),
      scope: z.enum(['project', 'global']),
      id: z.string().min(1),
      retirementReason: z.string().optional(),
    })
    .strict(),
] as const;

const V2Candidates = [
  z
    .object({ ...CandidateV2Fields, operation: z.literal('upsert') })
    .strict()
    .superRefine(ownerMatchesScope),
  z
    .object({ ...CandidateV2Fields, operation: z.literal('promote') })
    .strict()
    .superRefine((value, context) => {
      ownerMatchesScope(value, context);
      if (value.scope !== 'global') {
        context.addIssue({
          code: 'custom',
          path: ['scope'],
          message: 'a promotion target must be the global scope',
        });
      }
    }),
  z
    .object({
      version: z.literal(LEARNED_SKILL_CANDIDATE_VERSION),
      operation: z.literal('retire'),
      scope: z.enum(['project', 'store', 'global']),
      owner: DurableKnowledgeOwnerRefSchema,
      id: z.string().min(1),
      retirementReason: z.string().optional(),
    })
    .strict()
    .superRefine(ownerMatchesScope),
] as const;

export const LearnedSkillCandidateSchema = z.union([...V1Candidates, ...V2Candidates]);

/** Fields both manifest versions carry, kept in one place so they cannot drift. */
const ManifestCommonFields = {
  id: z.string().min(1),
  knowledgeKey: z.string().min(1),
  status: z.enum(['active', 'retired']),
  generatedBy: z.string().min(1),
  contentDigest: DigestSchema,
  description: z.string().min(1),
  applicability: ApplicabilitySchema,
  evidenceOverflow: z
    .object({ count: z.number().int().nonnegative(), digest: DigestSchema })
    .strict()
    .optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  retiredAt: z.string().optional(),
  retirementReason: z.string().optional(),
};

export const LearnedSkillManifestV1Schema = z
  .object({
    version: z.literal(LEARNED_SKILL_MANIFEST_V1_VERSION),
    ...ManifestCommonFields,
    scope: z.enum(['project', 'global']),
    evidence: z.array(EvidenceSchema),
  })
  .strict();

export const LearnedSkillManifestV2Schema = z
  .object({
    version: z.literal(LEARNED_SKILL_MANIFEST_VERSION),
    ...ManifestCommonFields,
    scope: z.enum(['project', 'store', 'global']),
    owner: DurableKnowledgeOwnerRefSchema,
    evidence: z.array(TypedEvidenceSchema),
    sources: z.array(PromotionSourceLocatorSchema),
  })
  .strict()
  .superRefine(ownerMatchesScope);

/** Both versions parse; a version 1 record is read and used, never rewritten. */
export const LearnedSkillManifestSchema = z.union([
  LearnedSkillManifestV1Schema,
  LearnedSkillManifestV2Schema,
]);

export type ParsedLearnedSkillCandidate = z.infer<typeof LearnedSkillCandidateSchema>;
export type ParsedLearnedSkillManifest = z.infer<typeof LearnedSkillManifestSchema>;
