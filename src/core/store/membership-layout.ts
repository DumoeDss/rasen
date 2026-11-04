/**
 * Layout-dispatching membership access (design D10, spec
 * `store-project-membership`).
 *
 * `.rasen-store/projects/<projectId>.yaml` is a v1 membership record in a flat
 * Store and a v2 project catalog in a layout v2 Store. The two schemas are
 * mutually exclusive, so readers choose from the Store's DECLARED layout
 * version and never from the file's own contents: a partially written file can
 * then never be read as the other schema. A v1 record found inside a v2 Store
 * is a diagnostic, not a tolerated second variant.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import { writeFileAtomically } from '../file-state.js';
import { makeStoreDiagnostic, StoreError, type StoreDiagnostic } from './errors.js';
import { readStoreLayoutState } from './layout-write-guard.js';
import {
  parseStoreProjectCatalogV2,
  serializeStoreProjectCatalogV2,
  type StoreProjectCatalogV2,
} from './planning-catalogs.js';
import {
  assertRecordableProjectIdentity,
  getStoreProjectRecordPath,
  getStoreProjectRecordsDir,
  listStoreProjectRecords,
  readStoreProjectRecord,
  STORE_PROJECT_RECORD_EXTENSION,
  type StoreProjectRecord,
} from './project-records.js';

const fs = nodeFs.promises;

export type StoreMembershipEntry =
  | { readonly layout: 1; readonly projectId: string; readonly record: StoreProjectRecord }
  | { readonly layout: 2; readonly projectId: string; readonly catalog: StoreProjectCatalogV2 };

export interface StoreMembershipRead {
  readonly layout: 1 | 2;
  readonly filePath: string;
  readonly entry: StoreMembershipEntry | null;
  readonly diagnostics: readonly StoreDiagnostic[];
}

export interface StoreMembershipListing {
  readonly layout: 1 | 2;
  readonly entries: readonly StoreMembershipEntry[];
  readonly diagnostics: readonly StoreDiagnostic[];
}

function legacyRecordInV2Diagnostic(filePath: string, storeId: string): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'store_layout_legacy_membership_record',
    `Membership record ${filePath} is still the legacy schema inside a Store declaring planning layout version 2.`,
    {
      target: 'store.membership',
      fix: `Run 'rasen store migrate-layout ${storeId}' to convert it into a v2 project catalog.`,
    }
  );
}

/** One member, read through the Store's declared layout. */
export async function readStoreMembership(
  storeRoot: string,
  projectId: string,
  storeId = 'the store'
): Promise<StoreMembershipRead> {
  const state = await readStoreLayoutState(storeRoot);
  const filePath = getStoreProjectRecordPath(storeRoot, projectId);

  if (state.declared !== 2) {
    const read = await readStoreProjectRecord(storeRoot, projectId);
    return {
      layout: 1,
      filePath: read.filePath,
      entry:
        read.record === null
          ? null
          : { layout: 1, projectId: read.record.projectId, record: read.record },
      diagnostics: read.diagnostics,
    };
  }

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return { layout: 2, filePath, entry: null, diagnostics: [] };
  }
  try {
    const catalog = parseStoreProjectCatalogV2(content, filePath);
    return {
      layout: 2,
      filePath,
      entry: { layout: 2, projectId: catalog.projectId, catalog },
      diagnostics: [],
    };
  } catch (error) {
    return {
      layout: 2,
      filePath,
      entry: null,
      diagnostics: [
        content.includes('version: 1')
          ? legacyRecordInV2Diagnostic(filePath, storeId)
          : makeStoreDiagnostic(
              'error',
              'invalid_project_catalog',
              `Project catalog ${filePath} is invalid: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { target: 'store.membership', fix: `Repair or remove ${filePath}.` }
            ),
      ],
    };
  }
}

/** Every member, read through the Store's declared layout. */
export async function listStoreMembership(
  storeRoot: string,
  storeId = 'the store'
): Promise<StoreMembershipListing> {
  const state = await readStoreLayoutState(storeRoot);
  if (state.declared !== 2) {
    const listing = await listStoreProjectRecords(storeRoot);
    return {
      layout: 1,
      entries: listing.records.map((record) => ({
        layout: 1 as const,
        projectId: record.projectId,
        record,
      })),
      diagnostics: listing.diagnostics,
    };
  }

  const dir = getStoreProjectRecordsDir(storeRoot);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { layout: 2, entries: [], diagnostics: [] };
  }

  const entries: StoreMembershipEntry[] = [];
  const diagnostics: StoreDiagnostic[] = [];
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name.toLowerCase().endsWith(STORE_PROJECT_RECORD_EXTENSION)) continue;
    const filePath = path.join(dir, name);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      continue;
    }
    try {
      const catalog = parseStoreProjectCatalogV2(content, filePath);
      entries.push({ layout: 2, projectId: catalog.projectId, catalog });
    } catch (error) {
      diagnostics.push(
        content.includes('version: 1')
          ? legacyRecordInV2Diagnostic(filePath, storeId)
          : makeStoreDiagnostic(
              'error',
              'invalid_project_catalog',
              `Project catalog ${filePath} is invalid: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { target: 'store.membership', fix: `Repair or remove ${filePath}.` }
            )
      );
    }
  }
  return { layout: 2, entries, diagnostics };
}

/**
 * Writes a v2 project catalog. Only migration converts an EXISTING record from
 * one schema to the other; this writer creates or updates a catalog in a Store
 * that already declares layout v2, which is what `add-project` and `adopt` need
 * after a Store has been migrated.
 */
export async function writeStoreProjectCatalog(
  storeRoot: string,
  catalog: StoreProjectCatalogV2
): Promise<string> {
  const filePath = getStoreProjectRecordPath(
    storeRoot,
    assertRecordableProjectIdentity(catalog.projectId)
  );
  const content = serializeStoreProjectCatalogV2(catalog);
  await FileSystemUtils.createDirectory(getStoreProjectRecordsDir(storeRoot));
  await writeFileAtomically(filePath, content);
  const verified = parseStoreProjectCatalogV2(
    await fs.readFile(filePath, 'utf-8'),
    filePath
  );
  if (verified.projectId !== catalog.projectId) {
    throw new StoreError(
      `Project catalog ${filePath} did not read back as the project it was written for.`,
      'invalid_project_catalog',
      { target: 'store.membership', fix: `Inspect ${filePath}.` }
    );
  }
  return filePath;
}
