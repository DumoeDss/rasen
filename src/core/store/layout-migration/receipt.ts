/**
 * The committed migration receipt (design D10).
 *
 * `.rasen-store/migration/receipts/<planId>.json` is the durable explanation of
 * a migration: every item's source, destination, owner and evidence; the minted
 * identity and old-alias mapping; the adoption name lists the v2 catalog drops;
 * the legacy adoption manifest; relocated Archive entries marked
 * `recordSchema: legacy`; shared-spec resolutions with their contributors;
 * retained design docs; superseded evidence; and the publication and retirement
 * phases.
 *
 * It is a NEW committed artifact family beside `.rasen-store/projects/` and
 * `.rasen-store/target-lines/`; it changes none of the Foundation schemas.
 */
import * as path from 'node:path';
import { z } from 'zod';

import { formatZodIssues } from '../../zod-issues.js';
import { getStoreMetadataDir } from '../foundation.js';
import type {
  ImmutableMigrationPlan,
  MigrationItem,
  MigrationPhase,
} from './types.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import { storeRelative } from './flat-source.js';
import { hasTypicalMojibake } from './strict-text.js';
import { migrationItemStateLabel } from './types.js';

export const MIGRATION_RECEIPTS_DIR = 'migration/receipts';
export const MIGRATION_RECEIPT_SCHEMA_VERSION = 1;
export const MIGRATION_RECEIPT_SCHEMA_VERSION_V2 = 2;

export function migrationReceiptsDir(storeRoot: string): string {
  return path.join(getStoreMetadataDir(storeRoot), 'migration', 'receipts');
}

export function migrationReceiptPath(storeRoot: string, planId: string): string {
  return path.join(migrationReceiptsDir(storeRoot), `${planId}.json`);
}

export interface MigrationReceiptPhaseRecord {
  readonly phase: MigrationPhase;
  readonly at: string;
}

export interface MigrationReceipt {
  readonly schemaVersion: typeof MIGRATION_RECEIPT_SCHEMA_VERSION;
  readonly planId: string;
  readonly storeId: string;
  readonly storeUid?: string;
  readonly ref?: string;
  readonly headOid?: string;
  readonly inventoryFingerprint: string;
  readonly mapping?: { readonly path: string; readonly digest: string };
  readonly items: readonly {
    readonly kind: string;
    readonly name: string;
    readonly state: string;
    readonly source: string;
    readonly destination?: string;
    readonly owner?: string;
    readonly targetLineId?: string;
    readonly digest?: string;
    readonly evidence: readonly {
      readonly class: string;
      readonly source: string;
      readonly projectId: string;
      readonly nature: string;
    }[];
    readonly recordSchema?: 'legacy';
  }[];
  readonly changeInstances: readonly {
    readonly oldAlias: string;
    readonly changeId: string;
    readonly projectId: string;
    readonly targetLineId: string;
    readonly planningScopeId: string;
    readonly changeInstanceId: string;
    readonly minted: boolean;
  }[];
  readonly droppedAdoption: readonly {
    readonly projectId: string;
    readonly specs: readonly string[];
    readonly changes: readonly string[];
    readonly adoptedAt: string;
  }[];
  readonly legacyAdoptionsManifest?: string;
  readonly sharedSpecResolutions: readonly {
    readonly capability: string;
    readonly mode: string;
    readonly projects: readonly string[];
    readonly contributors: readonly string[];
  }[];
  readonly retainedDesignDocs: readonly string[];
  readonly supersededEvidence: readonly {
    readonly item: string;
    readonly class: string;
    readonly source: string;
    readonly projectId: string;
  }[];
  readonly targetLineCatalogs: readonly string[];
  readonly phases: readonly MigrationReceiptPhaseRecord[];
}

export interface MigrationReceiptConversionV2 {
  readonly source: {
    readonly lifecycle: 'active-change' | 'archive-entry';
    readonly alias: string;
    readonly path: string;
    readonly digest: string;
  };
  readonly classification: {
    readonly kind: 'store-issue';
    readonly nature: 'operator-asserted';
  };
  readonly issue: {
    readonly id: string;
    readonly state: 'open' | 'resolved' | 'dropped';
    readonly reason: string | null;
    readonly stateNature: 'migration-default-open' | 'operator-asserted';
    readonly acceptanceEvidence?: 'unproven';
  };
  readonly destination: string;
  readonly outputs: readonly {
    readonly role: 'issue-record' | 'execution-plan';
    readonly path: string;
    readonly schemaVersion: 1;
    readonly digest: string;
  }[];
  readonly planInput?: { readonly path: string; readonly digest: string };
}

export type MigrationReceiptV2 = Omit<
  MigrationReceipt,
  'schemaVersion' | 'mapping'
> & {
  readonly schemaVersion: typeof MIGRATION_RECEIPT_SCHEMA_VERSION_V2;
  readonly mapping?: {
    readonly schemaVersion: 2;
    readonly path: string;
    readonly digest: string;
  };
  readonly sourceRevision: {
    readonly repositoryKind: 'store';
    readonly role: 'planning-source';
    readonly storeUid: string;
    readonly ref: string;
    readonly headOid: string;
  };
  readonly conversions: readonly MigrationReceiptConversionV2[];
};

export type AnyMigrationReceipt = MigrationReceipt | MigrationReceiptV2;

function relocatedLegacyArchive(item: MigrationItem): boolean {
  return item.kind === 'archive-entry' && item.materialization?.kind !== 'generated-tree';
}

export function buildMigrationReceipt(input: {
  readonly plan: ImmutableMigrationPlan;
  readonly legacyAdoptionsManifest?: string;
  readonly phases: readonly MigrationReceiptPhaseRecord[];
}): AnyMigrationReceipt {
  const { plan } = input;
  const legacy: MigrationReceipt = {
    schemaVersion: MIGRATION_RECEIPT_SCHEMA_VERSION,
    planId: plan.planId,
    storeId: plan.storeId,
    ...(plan.storeUid === undefined ? {} : { storeUid: plan.storeUid }),
    ...(plan.ref === undefined ? {} : { ref: plan.ref }),
    ...(plan.headOid === undefined ? {} : { headOid: plan.headOid }),
    inventoryFingerprint: plan.inventoryFingerprint,
    ...(plan.mappingPath === undefined || plan.mappingDigest === undefined
      ? {}
      : { mapping: { path: plan.mappingPath, digest: plan.mappingDigest } }),
    items: plan.items.map((item) => ({
      kind: item.kind,
      name: item.name,
      state: migrationItemStateLabel(item.state),
      source: item.sourceRelative,
      ...(item.destinationRelative === undefined
        ? {}
        : { destination: item.destinationRelative }),
      ...(item.owner === undefined ? {} : { owner: item.owner }),
      ...(item.targetLineId === undefined ? {} : { targetLineId: item.targetLineId }),
      ...(item.digest === undefined ? {} : { digest: item.digest }),
      evidence: item.evidence.map((entry) => ({
        class: entry.class,
        source: entry.source,
        projectId: entry.projectId,
        nature: entry.nature,
      })),
      // Legacy Archive entries are relocated byte-for-byte. Their records are
      // NOT upgraded, so the receipt says so and a diagnostic reports them.
      ...(relocatedLegacyArchive(item) ? { recordSchema: 'legacy' as const } : {}),
    })),
    changeInstances: plan.mintedIdentities.map((identity) => ({
      oldAlias: identity.oldAlias,
      changeId: identity.changeId,
      projectId: identity.projectId,
      targetLineId: identity.targetLineId,
      planningScopeId: identity.planningScopeId,
      changeInstanceId: identity.changeInstanceId,
      minted: identity.minted,
    })),
    droppedAdoption: plan.catalogUpgrades
      .filter((upgrade) => upgrade.droppedAdoption !== undefined)
      .map((upgrade) => ({
        projectId: upgrade.projectId,
        specs: upgrade.droppedAdoption?.specs ?? [],
        changes: upgrade.droppedAdoption?.changes ?? [],
        adoptedAt: upgrade.droppedAdoption?.adoptedAt ?? '',
      })),
    ...(input.legacyAdoptionsManifest === undefined
      ? {}
      : { legacyAdoptionsManifest: input.legacyAdoptionsManifest }),
    sharedSpecResolutions: plan.sharedSpecResolutions.map((entry) => ({
      capability: entry.capability,
      mode: entry.mode,
      projects: [...entry.projects],
      contributors: [...entry.contributors],
    })),
    retainedDesignDocs: plan.retainedDesignDocs.map((doc) => doc.relative),
    supersededEvidence: plan.items.flatMap((item) =>
      item.supersededEvidence.map((entry) => ({
        item: `${item.kind}:${item.name}`,
        class: entry.class,
        source: entry.source,
        projectId: entry.projectId,
      }))
    ),
    targetLineCatalogs: plan.targetLineCatalogs.map((entry) => entry.destinationRelative),
    phases: [...input.phases],
  };
  if (plan.schemaVersion === 1) return legacy;
  if (plan.storeUid === undefined || plan.ref === undefined || plan.headOid === undefined) {
    throw new Error('Receipt v2 requires Store identity, ref, and source HEAD.');
  }
  const conversions: MigrationReceiptConversionV2[] = plan.items.flatMap((item) => {
    if (
      item.disposition?.kind !== 'store-issue' ||
      item.materialization?.kind !== 'generated-tree' ||
      item.sourceLifecycle === undefined ||
      item.digest === undefined
    ) {
      return [];
    }
    const materialization = item.materialization;
    return [{
      source: {
        lifecycle: item.sourceLifecycle,
        alias: item.name,
        path: item.sourceRelative,
        digest: item.digest,
      },
      classification: { kind: 'store-issue', nature: 'operator-asserted' },
      issue: {
        id: item.disposition.issueId,
        state: item.disposition.state,
        reason: item.disposition.reason,
        stateNature:
          item.sourceLifecycle === 'active-change'
            ? 'migration-default-open'
            : 'operator-asserted',
        ...(item.disposition.state === 'open'
          ? {}
          : { acceptanceEvidence: 'unproven' as const }),
      },
      destination: materialization.destinationRelative,
      outputs: materialization.files.map((file) => ({
        role: file.role,
        path: `${materialization.destinationRelative}/${file.relativePath}`,
        schemaVersion: 1 as const,
        digest: file.digest,
      })),
      ...(item.planInput === undefined
        ? {}
        : { planInput: { path: item.planInput.relative, digest: item.planInput.digest } }),
    }];
  });
  return {
    ...legacy,
    schemaVersion: MIGRATION_RECEIPT_SCHEMA_VERSION_V2,
    ...(plan.mappingPath === undefined || plan.mappingDigest === undefined
      ? { mapping: undefined }
      : {
          mapping: {
            schemaVersion: 2,
            path: storeRelative(plan.storeRoot, plan.mappingPath),
            digest: plan.mappingDigest,
          },
        }),
    sourceRevision: {
      repositoryKind: 'store',
      role: 'planning-source',
      storeUid: plan.storeUid,
      ref: plan.ref,
      headOid: plan.headOid,
    },
    conversions,
  };
}

/** Deterministic UTF-8 without a BOM, two-space indent, one trailing newline. */
export function serializeMigrationReceipt(receipt: AnyMigrationReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export type MigrationReceiptReadResult =
  | { readonly ok: true; readonly receipt: AnyMigrationReceipt }
  | { readonly ok: false; readonly reason: string };

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const PhaseSchema = z
  .object({
    phase: z.enum([
      'staged',
      'verified',
      'publishing',
      'published',
      'retired',
      'rolled-back',
      'failed',
    ]),
    at: z.string(),
  })
  .strict();
const ReceiptItemSchema = z
  .object({
    kind: z.string(),
    name: z.string(),
    state: z.string(),
    source: z.string(),
    destination: z.string().optional(),
    owner: z.string().optional(),
    targetLineId: z.string().optional(),
    digest: DigestSchema.optional(),
    evidence: z.array(
      z
        .object({
          class: z.string(),
          source: z.string(),
          projectId: z.string(),
          nature: z.string(),
        })
        .strict()
    ),
    recordSchema: z.literal('legacy').optional(),
  })
  .strict();
const ChangeInstanceSchema = z
  .object({
    oldAlias: z.string(),
    changeId: z.string(),
    projectId: z.string(),
    targetLineId: z.string(),
    planningScopeId: z.string(),
    changeInstanceId: z.string(),
    minted: z.boolean(),
  })
  .strict();
const DroppedAdoptionSchema = z
  .object({
    projectId: z.string(),
    specs: z.array(z.string()),
    changes: z.array(z.string()),
    adoptedAt: z.string(),
  })
  .strict();
const SharedSpecSchema = z
  .object({
    capability: z.string(),
    mode: z.string(),
    projects: z.array(z.string()),
    contributors: z.array(z.string()),
  })
  .strict();
const SupersededEvidenceSchema = z
  .object({
    item: z.string(),
    class: z.string(),
    source: z.string(),
    projectId: z.string(),
  })
  .strict();
const ReceiptCommonShape = {
  planId: DigestSchema,
  storeId: z.string(),
  storeUid: z.string().optional(),
  ref: z.string().optional(),
  headOid: z.string().optional(),
  inventoryFingerprint: DigestSchema,
  items: z.array(ReceiptItemSchema),
  changeInstances: z.array(ChangeInstanceSchema),
  droppedAdoption: z.array(DroppedAdoptionSchema),
  legacyAdoptionsManifest: z.string().optional(),
  sharedSpecResolutions: z.array(SharedSpecSchema),
  retainedDesignDocs: z.array(z.string()),
  supersededEvidence: z.array(SupersededEvidenceSchema),
  targetLineCatalogs: z.array(z.string()),
  phases: z.array(PhaseSchema),
};
const MigrationReceiptV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ...ReceiptCommonShape,
    mapping: z
      .object({ path: z.string(), digest: DigestSchema })
      .strict()
      .optional(),
  })
  .strict();
const ConversionSchema = z
  .object({
    source: z
      .object({
        lifecycle: z.enum(['active-change', 'archive-entry']),
        alias: z.string(),
        path: z.string(),
        digest: DigestSchema,
      })
      .strict(),
    classification: z
      .object({
        kind: z.literal('store-issue'),
        nature: z.literal('operator-asserted'),
      })
      .strict(),
    issue: z
      .object({
        id: z.string(),
        state: z.enum(['open', 'resolved', 'dropped']),
        reason: z.string().nullable(),
        stateNature: z.enum(['migration-default-open', 'operator-asserted']),
        acceptanceEvidence: z.literal('unproven').optional(),
      })
      .strict()
      .superRefine((issue, context) => {
        if (issue.state === 'open') {
          if (issue.reason !== null || issue.acceptanceEvidence !== undefined) {
            context.addIssue({
              code: 'custom',
              message: 'open conversion requires null reason and no acceptance evidence',
            });
          }
        } else if (
          issue.reason === null ||
          issue.reason.trim().length === 0 ||
          issue.acceptanceEvidence !== 'unproven'
        ) {
          context.addIssue({
            code: 'custom',
            message: 'terminal conversion requires reason and unproven acceptance evidence',
          });
        }
      }),
    destination: z.string(),
    outputs: z.array(
      z
        .object({
          role: z.enum(['issue-record', 'execution-plan']),
          path: z.string(),
          schemaVersion: z.literal(1),
          digest: DigestSchema,
        })
        .strict()
    ),
    planInput: z
      .object({ path: z.string(), digest: DigestSchema })
      .strict()
      .optional(),
  })
  .strict();
const MigrationReceiptV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...ReceiptCommonShape,
    mapping: z
      .object({ schemaVersion: z.literal(2), path: z.string(), digest: DigestSchema })
      .strict()
      .optional(),
    sourceRevision: z
      .object({
        repositoryKind: z.literal('store'),
        role: z.literal('planning-source'),
        storeUid: z.string(),
        ref: z.string(),
        headOid: z.string(),
      })
      .strict(),
    conversions: z.array(ConversionSchema),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.storeUid !== receipt.sourceRevision.storeUid ||
      receipt.ref !== receipt.sourceRevision.ref ||
      receipt.headOid !== receipt.sourceRevision.headOid
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRevision'],
        message: 'Store planning-source revision disagrees with receipt scope',
      });
    }
  });

/** Typed, non-throwing receipt reader shared by diagnostics and compatibility. */
export function readMigrationReceipt(text: string): MigrationReceiptReadResult {
  if (text.startsWith('\ufeff')) {
    return { ok: false, reason: 'receipt JSON has a UTF-8 BOM' };
  }
  if (text.includes('\ufffd')) {
    return { ok: false, reason: 'receipt JSON is not strict UTF-8' };
  }
  if (hasTypicalMojibake(text)) {
    return { ok: false, reason: 'receipt JSON contains a mojibake sentinel' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'receipt is not an object' };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) {
    return { ok: false, reason: `unsupported receipt schemaVersion '${String(candidate.schemaVersion)}'` };
  }
  const parsed = candidate.schemaVersion === 1
    ? MigrationReceiptV1Schema.safeParse(raw)
    : MigrationReceiptV2Schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `receipt schema v${candidate.schemaVersion} is invalid: ${formatZodIssues(parsed.error)}`,
    };
  }
  return { ok: true, receipt: parsed.data as AnyMigrationReceipt };
}

export type LegacyCoordinatorConversionQuery =
  | {
      readonly status: 'found';
      readonly issueId: string;
      readonly receipt: string;
    }
  | {
      readonly status: 'absent' | 'ambiguous' | 'incomplete-evidence';
      readonly receipts: readonly string[];
    };

/**
 * Exact historical query for the ordinary archive not-found seam. It returns
 * no live Issue state and never writes or upgrades a receipt.
 */
export async function queryLegacyCoordinatorConversion(
  dependencies: StoreLayoutMigrationDependencies,
  input: {
    readonly storeRoot: string;
    readonly storeUid: string;
    readonly ref: string;
    readonly alias: string;
  }
): Promise<LegacyCoordinatorConversionQuery> {
  const dir = migrationReceiptsDir(input.storeRoot);
  const entries = await dependencies.fs.listEntries(dir);
  const matches: { issueId: string; receipt: string }[] = [];
  const incomplete: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    const target = path.join(dir, entry.name);
    const text = await dependencies.fs.readText(target);
    if (text === null) {
      incomplete.push(entry.name);
      continue;
    }
    const read = readMigrationReceipt(text);
    if (!read.ok) {
      incomplete.push(entry.name);
      continue;
    }
    if (read.receipt.schemaVersion !== 2) continue;
    if (
      read.receipt.sourceRevision.storeUid !== input.storeUid ||
      read.receipt.sourceRevision.ref !== input.ref
    ) {
      continue;
    }
    for (const conversion of read.receipt.conversions) {
      if (
        conversion.source.lifecycle === 'active-change' &&
        conversion.source.alias === input.alias
      ) {
        matches.push({ issueId: conversion.issue.id, receipt: entry.name });
      }
    }
  }
  // An unreadable receipt could contain a second matching conversion, so it
  // prevents the exact query from proving uniqueness even when one readable
  // match exists. Incomplete evidence never becomes a redirect.
  if (incomplete.length > 0) {
    return { status: 'incomplete-evidence', receipts: incomplete.sort() };
  }
  if (matches.length === 1) {
    return { status: 'found', ...matches[0]! };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', receipts: matches.map((entry) => entry.receipt).sort() };
  }
  return { status: 'absent', receipts: [] };
}

/**
 * Append a phase record, idempotently, returning the re-serialized receipt.
 *
 * The receipt is built during staging, so on its own it can only ever say
 * `staged` — and a committed audit record that cannot distinguish a published
 * migration from an abandoned staging run is not the record design D10 and task
 * 7.5 describe. Publication and retirement each stamp their own phase, in the
 * commit that performs them.
 */
export function withMigrationReceiptPhase(
  receiptText: string,
  phase: MigrationPhase,
  at: string
): string {
  const read = readMigrationReceipt(receiptText);
  if (!read.ok) throw new Error(`Invalid migration receipt: ${read.reason}`);
  const receipt = read.receipt;
  if (receipt.phases.some((entry) => entry.phase === phase)) return receiptText;
  return serializeMigrationReceipt({
    ...receipt,
    phases: [...receipt.phases, { phase, at }],
  });
}
