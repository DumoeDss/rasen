/** Strict versioned learned-skill candidate and manifest schemas. */
import { z } from 'zod';

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, {
  message: 'digest must be a sha256:<64 hex> string',
});

const ApplicabilitySchema = z
  .object({ mode: z.enum(['all', 'any']), markers: z.array(z.string()).min(1) })
  .strict();

const EvidenceV1Schema = z
  .object({
    projectId: z.string().min(1),
    change: z.string().min(1),
    artifact: z.string().min(1),
    digest: DigestSchema,
  })
  .strict();

export const KnowledgeOwnerRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('project'), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('store'), id: z.string().min(1) }).strict(),
]);

const EvidenceOwnerRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project'), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('store'), id: z.string().min(1) }).strict(),
]);

const TypedEvidenceSchema = z
  .object({
    owner: EvidenceOwnerRefSchema,
    change: z.string().min(1),
    artifact: z.string().min(1),
    digest: DigestSchema,
  })
  .strict();

const PromotionSourceLocatorSchema = z
  .object({
    owner: EvidenceOwnerRefSchema,
    id: z.string().min(1),
    knowledgeKey: z.string().min(1),
  })
  .strict();

export const KnowledgePlanningRootRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project'), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal('store'), id: z.string().min(1) }).strict(),
]);

export const FrozenKnowledgeContextSchema = z
  .object({
    version: z.literal(1),
    planningRoot: KnowledgePlanningRootRefSchema,
    owner: KnowledgeOwnerRefSchema,
  })
  .strict();

const CandidateV1Fields = {
  version: z.literal(1),
  scope: z.enum(['project', 'global']),
  id: z.string().min(1),
  knowledgeKey: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  applicability: ApplicabilitySchema,
  evidence: z.array(EvidenceV1Schema),
};
const CandidateV2Fields = {
  version: z.literal(2),
  scope: z.enum(['project', 'store', 'global']),
  owner: KnowledgeOwnerRefSchema,
  id: z.string().min(1),
  knowledgeKey: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  applicability: ApplicabilitySchema,
  evidence: z.array(TypedEvidenceSchema),
  sources: z.array(PromotionSourceLocatorSchema),
};

const V1Candidates = [
  z.object({ ...CandidateV1Fields, operation: z.literal('upsert') }).strict(),
  z.object({ ...CandidateV1Fields, operation: z.literal('promote') }).strict(),
  z
    .object({
      version: z.literal(1),
      operation: z.literal('retire'),
      scope: z.enum(['project', 'global']),
      id: z.string().min(1),
      retirementReason: z.string().optional(),
    })
    .strict(),
] as const;

function ownerMatchesScope(
  value: { owner: z.infer<typeof KnowledgeOwnerRefSchema>; scope: string },
  context: z.RefinementCtx
): void {
  if (value.owner.type !== value.scope) {
    context.addIssue({
      code: 'custom',
      path: ['owner'],
      message: 'typed owner must match the declared scope',
    });
  }
}

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
          message: 'promotion target must be global',
        });
      }
    }),
  z
    .object({
      version: z.literal(2),
      operation: z.literal('retire'),
      scope: z.enum(['project', 'store', 'global']),
      owner: KnowledgeOwnerRefSchema,
      id: z.string().min(1),
      retirementReason: z.string().optional(),
    })
    .strict()
    .superRefine(ownerMatchesScope),
] as const;

export const LearnedSkillCandidateSchema = z.union([...V1Candidates, ...V2Candidates]);

const ManifestCommon = {
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

const LearnedSkillManifestV1Schema = z
  .object({
    version: z.literal(1),
    ...ManifestCommon,
    scope: z.enum(['project', 'global']),
    evidence: z.array(EvidenceV1Schema),
  })
  .strict();

const LearnedSkillManifestV2Schema = z
  .object({
    version: z.literal(2),
    ...ManifestCommon,
    scope: z.enum(['project', 'store', 'global']),
    owner: KnowledgeOwnerRefSchema,
    evidence: z.array(TypedEvidenceSchema),
    sources: z.array(PromotionSourceLocatorSchema),
  })
  .strict()
  .superRefine(ownerMatchesScope);

export const LearnedSkillManifestSchema = z.union([
  LearnedSkillManifestV1Schema,
  LearnedSkillManifestV2Schema,
]);

export type ParsedLearnedSkillCandidate = z.infer<typeof LearnedSkillCandidateSchema>;
export type ParsedLearnedSkillManifest = z.infer<typeof LearnedSkillManifestSchema>;
