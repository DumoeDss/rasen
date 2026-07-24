/**
 * Strict Zod schemas for the closed candidate and manifest shapes. Strictness
 * is a deliberate part of the security boundary (design D8): an unknown field,
 * a malformed digest, or an out-of-range value fails validation before any
 * mutation, limiting the blast radius of untrusted candidate input.
 */

import { z } from 'zod';

import { LEARNED_SKILL_CANDIDATE_VERSION, LEARNED_SKILL_MANIFEST_VERSION } from './constants.js';

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

const CandidateContentFields = {
  version: z.literal(LEARNED_SKILL_CANDIDATE_VERSION),
  scope: z.enum(['project', 'global']),
  id: z.string().min(1),
  knowledgeKey: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  applicability: ApplicabilitySchema,
  evidence: z.array(EvidenceSchema),
};

const UpsertCandidateSchema = z
  .object({ ...CandidateContentFields, operation: z.literal('upsert') })
  .strict();
const PromoteCandidateSchema = z
  .object({ ...CandidateContentFields, operation: z.literal('promote') })
  .strict();
const RetireCandidateSchema = z
  .object({
    version: z.literal(LEARNED_SKILL_CANDIDATE_VERSION),
    operation: z.literal('retire'),
    scope: z.enum(['project', 'global']),
    id: z.string().min(1),
    retirementReason: z.string().optional(),
  })
  .strict();

export const LearnedSkillCandidateSchema = z.discriminatedUnion('operation', [
  UpsertCandidateSchema,
  PromoteCandidateSchema,
  RetireCandidateSchema,
]);

export const LearnedSkillManifestSchema = z
  .object({
    version: z.literal(LEARNED_SKILL_MANIFEST_VERSION),
    id: z.string().min(1),
    knowledgeKey: z.string().min(1),
    scope: z.enum(['project', 'global']),
    status: z.enum(['active', 'retired']),
    generatedBy: z.string().min(1),
    contentDigest: DigestSchema,
    description: z.string().min(1),
    applicability: ApplicabilitySchema,
    evidence: z.array(EvidenceSchema),
    evidenceOverflow: z
      .object({ count: z.number().int().nonnegative(), digest: DigestSchema })
      .strict()
      .optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    retiredAt: z.string().optional(),
    retirementReason: z.string().optional(),
  })
  .strict();

export type ParsedLearnedSkillCandidate = z.infer<typeof LearnedSkillCandidateSchema>;
export type ParsedLearnedSkillManifest = z.infer<typeof LearnedSkillManifestSchema>;
