import { z } from 'zod';
import { isKebabId } from '../id.js';
import { isValidStoreUid, normalizeStoreUid } from '../store/identity-types.js';
import {
  derivePlanningScopeId,
  parseChangeInstanceSeed,
  verifyChangeInstanceId,
  type ChangeInstanceSeed,
  type VerifiedChangeInstanceId,
} from '../store/planning-identity.js';
import {
  parseProjectId,
  parseTargetLineId,
  type ProjectId,
  type TargetLineId,
} from '../store/planning-validation.js';

export { isKebabId } from '../id.js';

const KebabIdentifierSchema = (label: string): z.ZodString =>
  z.string().superRefine((value, ctx) => {
    if (!isKebabId(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} must be kebab-case with lowercase letters, numbers, and single hyphen separators`,
      });
    }
  });

export const InitiativeLinkSchema = z.object({
  store: KebabIdentifierSchema('Store id'),
  id: KebabIdentifierSchema('Initiative id'),
}).strict();

export type InitiativeLink = z.infer<typeof InitiativeLinkSchema>;

export interface ChangeMetadataIdentityV2 {
  readonly version: 2;
  readonly instanceSeed: ChangeInstanceSeed;
  readonly instanceId: VerifiedChangeInstanceId;
  readonly storeUid: string;
  readonly projectId: ProjectId;
  readonly targetLineId: TargetLineId;
}

const RawChangeMetadataIdentityV2Schema = z
  .object({
    version: z.literal(2),
    instanceSeed: z.string(),
    instanceId: z.string(),
    storeUid: z.string(),
    projectId: z.string(),
    targetLineId: z.string(),
  })
  .strict();

export const ChangeMetadataIdentityV2Schema = RawChangeMetadataIdentityV2Schema.transform(
  (value, ctx): ChangeMetadataIdentityV2 => {
    try {
      if (!isValidStoreUid(value.storeUid)) {
        throw new Error('storeUid must be a well-formed permanent Store UUID');
      }
      const storeUid = normalizeStoreUid(value.storeUid);
      const projectId = parseProjectId(value.projectId);
      const targetLineId = parseTargetLineId(value.targetLineId);
      const instanceSeed = parseChangeInstanceSeed(value.instanceSeed);
      const planningScopeId = derivePlanningScopeId({ storeUid, projectId, targetLineId });
      const instanceId = verifyChangeInstanceId(value.instanceId, {
        planningScopeId,
        instanceSeed,
      });
      return Object.freeze({
        version: 2 as const,
        instanceSeed,
        instanceId,
        storeUid,
        projectId,
        targetLineId,
      });
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error),
      });
      return z.NEVER;
    }
  }
);

// Per-change metadata schema. The schema field is validated against available
// workflow schemas when metadata is read or written.
export const ChangeMetadataSchema = z.object({
  schema: z.string().min(1, { message: 'schema is required' }),
  created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'created must be YYYY-MM-DD format',
    })
    .optional(),
  goal: z.string().min(1).optional(),
  affected_areas: z.array(z.string().min(1)).optional(),
  initiative: InitiativeLinkSchema.optional(),
  implementation: z.enum(['code', 'none']).optional(),
  identity: ChangeMetadataIdentityV2Schema.optional(),
}).strict();

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;
