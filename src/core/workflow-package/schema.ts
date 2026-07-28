import { z } from 'zod';

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

// Loose but shape-enforced semver: major.minor.patch, optional -prerelease
// and/or +build metadata. Rejects garbage like "banana" at the schema level
// rather than silently letting it through to the version-gate preflight
// (which only compares parseable major.minor.patch and fails OPEN — does not
// block — when a side is unparseable; see version-gate.ts).
const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/, {
    error: 'minRasenVersion must be a semver string (e.g. "1.2.3")',
  });

export const PackageFileSchema = z.strictObject({
  path: z.string(),
  encoding: z.literal('utf8'),
  sha256: DigestSchema,
  content: z.string(),
});

export const PackagedWorkflowSchema = z.strictObject({
  id: z.string(),
  digest: DigestSchema,
  files: z.array(PackageFileSchema),
});

// A version-1 packaged profile (no retention). The `delivery` dimension is
// retired (skills are the only delivery surface now): accepted-but-ignored so
// a `.rasenpkg` produced by an older rasen release still decodes without error.
// A package created going forward is always version 2.
const PackagedProfileV1Schema = z.strictObject({
  version: z.literal(1),
  delivery: z.unknown().optional(),
  workflows: z.array(z.string()),
});

// The current version-2 packaged profile: workflow/expert selection plus
// exactly one retention mode, so retention survives an export/import round trip.
const PackagedProfileV2Schema = z.strictObject({
  version: z.literal(2),
  workflows: z.array(z.string()),
  retention: z.enum(['off', 'report', 'codify']),
});

export const PackagedProfileSchema = z.discriminatedUnion('version', [
  PackagedProfileV1Schema,
  PackagedProfileV2Schema,
]);

export const PackagedPipelineSchema = z.strictObject({
  name: z.string(),
  digest: DigestSchema,
  files: z.array(PackageFileSchema),
});

const PackageFields = {
  format: z.literal('rasen-package'),
  formatVersion: z.literal(1),
  roots: z.array(z.string()),
  workflows: z.array(PackagedWorkflowSchema),
  packageDigest: DigestSchema,
  // Optional forward-compat gate (D5): the minimum rasen CLI version able to
  // decode this package, stamped from package.json at pack time. Absent on
  // packages created before this field existed.
  minRasenVersion: SemverSchema.optional(),
};

export const WorkflowPackageSchema = z.strictObject({
  ...PackageFields,
  kind: z.literal('workflow'),
});

export const ProfilePackageSchema = z.strictObject({
  ...PackageFields,
  kind: z.literal('profile'),
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  profile: PackagedProfileSchema,
});

export const PipelinePackageSchema = z.strictObject({
  ...PackageFields,
  kind: z.literal('pipeline'),
  pipelines: z.array(PackagedPipelineSchema),
});

export const RasenPackageSchema = z.discriminatedUnion('kind', [
  WorkflowPackageSchema,
  ProfilePackageSchema,
  PipelinePackageSchema,
]);

export type PackageFile = z.infer<typeof PackageFileSchema>;
export type PackagedWorkflow = z.infer<typeof PackagedWorkflowSchema>;
export type PackagedProfile = z.infer<typeof PackagedProfileSchema>;
export type PackagedPipeline = z.infer<typeof PackagedPipelineSchema>;
export type WorkflowPackage = z.infer<typeof WorkflowPackageSchema>;
export type ProfilePackage = z.infer<typeof ProfilePackageSchema>;
export type PipelinePackage = z.infer<typeof PipelinePackageSchema>;
export type RasenPackage = z.infer<typeof RasenPackageSchema>;
export type RasenPackageKind = RasenPackage['kind'];

export type PackageWithoutDigest =
  | Omit<WorkflowPackage, 'packageDigest'>
  | Omit<ProfilePackage, 'packageDigest'>
  | Omit<PipelinePackage, 'packageDigest'>;
