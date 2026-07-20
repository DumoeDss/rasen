import { z } from 'zod';

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

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

export const PackagedProfileSchema = z.strictObject({
  version: z.literal(1),
  delivery: z.enum(['both', 'skills']),
  workflows: z.array(z.string()),
});

const PackageFields = {
  format: z.literal('rasen-package'),
  formatVersion: z.literal(1),
  roots: z.array(z.string()),
  workflows: z.array(PackagedWorkflowSchema),
  packageDigest: DigestSchema,
};

export const WorkflowPackageSchema = z.strictObject({
  ...PackageFields,
  kind: z.literal('workflow'),
});

export const ProfilePackageSchema = z.strictObject({
  ...PackageFields,
  kind: z.literal('profile'),
  name: z.string(),
  profile: PackagedProfileSchema,
});

export const RasenPackageSchema = z.discriminatedUnion('kind', [
  WorkflowPackageSchema,
  ProfilePackageSchema,
]);

export type PackageFile = z.infer<typeof PackageFileSchema>;
export type PackagedWorkflow = z.infer<typeof PackagedWorkflowSchema>;
export type PackagedProfile = z.infer<typeof PackagedProfileSchema>;
export type WorkflowPackage = z.infer<typeof WorkflowPackageSchema>;
export type ProfilePackage = z.infer<typeof ProfilePackageSchema>;
export type RasenPackage = z.infer<typeof RasenPackageSchema>;
export type RasenPackageKind = RasenPackage['kind'];

export type PackageWithoutDigest =
  | Omit<WorkflowPackage, 'packageDigest'>
  | Omit<ProfilePackage, 'packageDigest'>;

