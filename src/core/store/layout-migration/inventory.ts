/**
 * Per-ref flat inventory (design D2).
 *
 * Two levels, both read-only and both TOTAL: the ref survey classifies every
 * local ref from a Git blob read without checking anything out, and the
 * working-tree inventory enumerates the checked-out ref's flat content. An item
 * that cannot be read is recorded with its reason and never aborts the scan,
 * because the operator needs the whole picture to write one mapping file.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { parseStoreMetadataState } from '../foundation.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import {
  FLAT_RELATIVE,
  digestTree,
  flatStorePaths,
  listFlatActiveChangeNames,
  listFlatArchiveEntryNames,
  listFlatDesignDocNames,
  listFlatSpecNames,
  listFileNames,
  storeRelative,
} from './flat-source.js';
import type {
  FlatStoreInventory,
  InventoryReadFailure,
  RefLayoutClassification,
  SurveyedRef,
} from './types.js';

export interface InventoryContext {
  readonly storeId: string;
  readonly storeUid?: string;
  readonly storeRoot: string;
}

function classifyBlob(text: string | null): {
  classification: RefLayoutClassification;
  reason?: string;
} {
  if (text === null) return { classification: 'no-store-metadata' };
  try {
    const metadata = parseStoreMetadataState(text);
    return {
      classification: metadata.layoutVersion === 2 ? 'layout-v2' : 'flat',
    };
  } catch (error) {
    return {
      classification: 'unreadable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refCarriesFlatContent(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  ref: string
): Promise<boolean> {
  return (
    (await dependencies.git.treeHasEntries(storeRoot, ref, FLAT_RELATIVE.specs)) ||
    (await dependencies.git.treeHasEntries(storeRoot, ref, FLAT_RELATIVE.changes))
  );
}

/**
 * Level 1: classify every local and remote-tracking ref from `git show
 * <ref>:.rasen-store/store.yaml`. Remote-tracking refs are surveyed and
 * reported but are never migration candidates — migrating one would require
 * writing into a ref nobody has checked out.
 */
export async function surveyRefs(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  migrateCommandFor: (ref: string) => string
): Promise<{ refs: readonly SurveyedRef[]; checkedOutRef?: string; headOid?: string }> {
  if (!(await dependencies.git.isRepository(storeRoot))) {
    return { refs: [] };
  }
  const checkedOut = (await dependencies.git.currentRef(storeRoot)) ?? undefined;
  const headOid = (await dependencies.git.headOid(storeRoot)) ?? undefined;
  const entries = await dependencies.git.listRefs(storeRoot);

  const refs: SurveyedRef[] = [];
  for (const entry of entries) {
    const blob = await dependencies.git.showBlob(
      storeRoot,
      entry.ref,
      FLAT_RELATIVE.storeMetadata
    );
    const { classification, reason } = classifyBlob(blob);
    const isCheckedOut = entry.ref === checkedOut;
    const remote = entry.kind === 'remote-tracking';
    const carriesFlat =
      classification === 'flat' &&
      (await refCarriesFlatContent(dependencies, storeRoot, entry.ref));

    refs.push({
      ref: entry.ref,
      kind: entry.kind,
      classification,
      checkedOut: isCheckedOut,
      ...(reason === undefined ? {} : { reason }),
      ...(remote
        ? {
            notCandidateReason:
              'remote-tracking refs are reported for completeness and are never migration candidates',
          }
        : isCheckedOut
          ? {}
          : {
              notCandidateReason:
                'migration only ever touches the ref checked out in the invoking Store worktree',
            }),
      ...(carriesFlat && !isCheckedOut && !remote
        ? { migrateFrom: migrateCommandFor(entry.ref) }
        : {}),
    });
  }

  return {
    refs,
    ...(checkedOut === undefined ? {} : { checkedOutRef: checkedOut }),
    ...(headOid === undefined ? {} : { headOid }),
  };
}

interface EnumerationResult {
  readonly names: readonly string[];
  readonly failures: readonly InventoryReadFailure[];
  readonly digestParts: readonly string[];
}

async function enumerate(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  names: readonly string[],
  joinChild: (name: string) => string
): Promise<EnumerationResult> {
  const failures: InventoryReadFailure[] = [];
  const digestParts: string[] = [];
  const kept: string[] = [];
  for (const name of names) {
    const child = joinChild(name);
    try {
      const tree = await digestTree(dependencies.fs, child);
      digestParts.push(`${storeRelative(storeRoot, child)}\0${tree.digest}`);
      kept.push(name);
    } catch (error) {
      failures.push({
        path: storeRelative(storeRoot, child),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { names: kept, failures, digestParts };
}

/**
 * Level 2 plus the fingerprint. Everything the plan will be computed from is
 * enumerated here and folded into one digest, so `apply` can prove the Store
 * has not moved underneath the plan.
 */
export async function inventoryStore(
  dependencies: StoreLayoutMigrationDependencies,
  context: InventoryContext,
  migrateCommandFor: (ref: string) => string
): Promise<FlatStoreInventory> {
  const storeRoot = context.storeRoot;
  const paths = flatStorePaths(storeRoot);
  const failures: InventoryReadFailure[] = [];
  const digestParts: string[] = [];

  const survey = await surveyRefs(dependencies, storeRoot, migrateCommandFor);
  for (const ref of survey.refs) {
    digestParts.push(`ref\0${ref.ref}\0${ref.classification}`);
  }

  let declaredLayoutVersion: 2 | undefined;
  const metadataText = await dependencies.fs.readText(paths.storeMetadata);
  if (metadataText !== null) {
    digestParts.push(
      `${FLAT_RELATIVE.storeMetadata}\0${createHash('sha256').update(metadataText).digest('hex')}`
    );
    try {
      const metadata = parseStoreMetadataState(metadataText);
      if (metadata.layoutVersion === 2) declaredLayoutVersion = 2;
    } catch (error) {
      failures.push({
        path: FLAT_RELATIVE.storeMetadata,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    failures.push({
      path: FLAT_RELATIVE.storeMetadata,
      reason: 'Store metadata is absent in the invoking worktree',
    });
  }

  const specs = await enumerate(
    dependencies,
    storeRoot,
    await listFlatSpecNames(dependencies.fs, storeRoot),
    (name) => path.join(paths.specs, name)
  );
  const changes = await enumerate(
    dependencies,
    storeRoot,
    await listFlatActiveChangeNames(dependencies.fs, storeRoot),
    (name) => path.join(paths.changes, name)
  );
  const archiveEntries = await enumerate(
    dependencies,
    storeRoot,
    await listFlatArchiveEntryNames(dependencies.fs, storeRoot),
    (name) => path.join(paths.archive, name)
  );
  const designDocs = await enumerate(
    dependencies,
    storeRoot,
    await listFlatDesignDocNames(dependencies.fs, storeRoot),
    (name) => path.join(paths.designDocs, name)
  );
  const membershipRecords = await enumerate(
    dependencies,
    storeRoot,
    (await listFileNames(dependencies.fs, paths.projectRecords)).filter((name) =>
      name.endsWith('.yaml')
    ),
    (name) => path.join(paths.projectRecords, name)
  );

  for (const group of [specs, changes, archiveEntries, designDocs, membershipRecords]) {
    failures.push(...group.failures);
    digestParts.push(...group.digestParts);
  }

  const hasAdoptionsManifest =
    (await dependencies.fs.statKind(paths.adoptionsManifest)) === 'file';
  if (hasAdoptionsManifest) {
    const text = (await dependencies.fs.readText(paths.adoptionsManifest)) ?? '';
    digestParts.push(
      `${FLAT_RELATIVE.adoptionsManifest}\0${createHash('sha256').update(text).digest('hex')}`
    );
  }

  const fingerprint = createHash('sha256')
    .update(digestParts.slice().sort().join('\n'))
    .digest('hex');

  return Object.freeze({
    storeId: context.storeId,
    ...(context.storeUid === undefined ? {} : { storeUid: context.storeUid }),
    storeRoot,
    ...(survey.checkedOutRef === undefined ? {} : { checkedOutRef: survey.checkedOutRef }),
    ...(survey.headOid === undefined ? {} : { headOid: survey.headOid }),
    ...(declaredLayoutVersion === undefined ? {} : { declaredLayoutVersion }),
    refs: Object.freeze(survey.refs),
    specs: Object.freeze(specs.names),
    changes: Object.freeze(changes.names),
    archiveEntries: Object.freeze(archiveEntries.names),
    designDocs: Object.freeze(designDocs.names),
    membershipRecords: Object.freeze(membershipRecords.names),
    hasAdoptionsManifest,
    failures: Object.freeze(failures),
    fingerprint,
  });
}

function pathSeparator(): string {
  return '/';
}

function joinNative(base: string, name: string): string {
  return `${base}${base.endsWith('\\') || base.endsWith('/') ? '' : nativeSeparator(base)}${name}`;
}

function nativeSeparator(sample: string): string {
  return sample.includes('\\') ? '\\' : '/';
}
