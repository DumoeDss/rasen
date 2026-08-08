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

import { getStoreMetadataDir } from '../foundation.js';
import type {
  ImmutableMigrationPlan,
  MigrationItem,
  MigrationPhase,
} from './types.js';
import { migrationItemStateLabel } from './types.js';

export const MIGRATION_RECEIPTS_DIR = 'migration/receipts';
export const MIGRATION_RECEIPT_SCHEMA_VERSION = 1;

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

function relocatedLegacyArchive(item: MigrationItem): boolean {
  return item.kind === 'archive-entry';
}

export function buildMigrationReceipt(input: {
  readonly plan: ImmutableMigrationPlan;
  readonly legacyAdoptionsManifest?: string;
  readonly phases: readonly MigrationReceiptPhaseRecord[];
}): MigrationReceipt {
  const { plan } = input;
  return {
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
}

/** Deterministic UTF-8 without a BOM, two-space indent, one trailing newline. */
export function serializeMigrationReceipt(receipt: MigrationReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
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
  const receipt = JSON.parse(receiptText) as MigrationReceipt;
  if (receipt.phases.some((entry) => entry.phase === phase)) return receiptText;
  return serializeMigrationReceipt({
    ...receipt,
    phases: [...receipt.phases, { phase, at }],
  });
}
