/**
 * The runtime half of no-dual-write (design D12).
 *
 * Every Store planning mutation asserts the Store's DECLARED layout before it
 * writes. A layout v2 Store refuses flat destinations, a legacy flat Store
 * refuses project partitions and names the migration, and a Store found
 * holding both refuses either and names the recovery command. The structural
 * half is retirement (the flat directories stop existing) and the source half
 * is the bounded path guard; this is the one that catches everything in
 * between, including a Store whose layout was changed by a manual Git merge.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { StoreError } from './errors.js';
import {
  getStoreMetadataDir,
  readOptionalStoreMetadataState,
  resolveReadableStoreMetadataPath,
} from './foundation.js';
import { ARCHIVE_SUBDIR, CHANGES_SUBDIR, SPECS_SUBDIR } from './migration.js';

const fs = nodeFs.promises;

export type StorePlanningWriteIntent =
  | 'store-adopt'
  | 'store-eject'
  | 'archive-relocate'
  | 'membership-record'
  | 'layout-migration';

/**
 * Which layout the caller is about to write into.
 *
 * `metadata` is the third case and not a hedge: a membership file lives at
 * `.rasen-store/projects/<projectId>.yaml` in BOTH layouts and only its schema
 * follows the declared layout, so neither the flat nor the partition refusal
 * applies to it. What does apply is the mixed-state refusal, which is the whole
 * reason such a write must still meet this guard.
 */
export type StorePlanningWriteShape = 'flat' | 'partition' | 'metadata';

export interface StoreLayoutState {
  /** 2 when the Store declares layout v2; 1 otherwise (including no metadata). */
  readonly declared: 1 | 2;
  /** True when a v2 Store holds flat planning content it cannot account for. */
  readonly mixed: boolean;
  readonly flatContentPresent: boolean;
  /**
   * True only while a receipt records a completed publication whose RETIREMENT
   * has not run. That is the one window in which a v2 Store legitimately holds
   * the flat tree, so it is the only thing that may suppress `mixed`.
   */
  readonly publicationRecorded: boolean;
  /** True when a receipt records that the flat tree was retired for this Store. */
  readonly retirementRecorded: boolean;
}

async function hasEntries(target: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(target);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * What the committed receipts say about this Store's migration phases.
 *
 * The phase is read, not merely the receipt's existence. "A receipt exists"
 * stops being evidence of a legitimate pre-retirement window the moment
 * retirement runs: once a receipt records `retired`, flat planning content
 * appearing again is a re-introduction — a branch carrying the old layout
 * merged cleanly, because those paths no longer exist on the target — and
 * design D13 exists precisely to catch a manually merged wrong layout.
 *
 * A receipt that cannot be read or parsed proves nothing and is skipped, so an
 * unreadable receipt leaves the Store classified `mixed` rather than blessing
 * a publication nobody could verify.
 */
async function readReceiptPhases(
  storeRoot: string
): Promise<{ awaitingRetirement: boolean; retired: boolean }> {
  const dir = path.join(getStoreMetadataDir(storeRoot), 'migration', 'receipts');
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { awaitingRetirement: false, retired: false };
  }

  let awaitingRetirement = false;
  let retired = false;
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    let phases: string[];
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf-8')) as {
        phases?: { phase?: string }[];
      };
      phases = (parsed.phases ?? []).map((entry) => entry.phase ?? '');
    } catch {
      continue;
    }
    if (phases.includes('retired')) {
      retired = true;
      continue;
    }
    if (phases.includes('published')) awaitingRetirement = true;
  }
  return { awaitingRetirement, retired };
}

/**
 * Read-only classification of the Store's planning layout, including the
 * half-migrated state. `mixed` deliberately excludes the legitimate window
 * between publication and retirement: there a completed receipt exists, both
 * trees are on disk for exactly one commit, and readers already see v2.
 */
export async function readStoreLayoutState(storeRoot: string): Promise<StoreLayoutState> {
  const metadata = await readOptionalStoreMetadataState(storeRoot).catch(() => null);
  const declared: 1 | 2 = metadata?.layoutVersion === 2 ? 2 : 1;

  const planning = path.join(storeRoot, WORKSPACE_DIR_NAME);
  const flatSpecs = path.join(planning, SPECS_SUBDIR);
  const flatChanges = path.join(planning, CHANGES_SUBDIR);
  const flatContentPresent =
    (await hasEntries(flatSpecs)) ||
    (await flatChangesHoldContent(flatChanges));

  const receipts = await readReceiptPhases(storeRoot);

  return {
    declared,
    flatContentPresent,
    publicationRecorded: receipts.awaitingRetirement,
    retirementRecorded: receipts.retired,
    mixed: declared === 2 && flatContentPresent && !receipts.awaitingRetirement,
  };
}

/** `rasen/changes` counts as content only when it holds more than an empty archive shell. */
async function flatChangesHoldContent(flatChanges: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fs.readdir(flatChanges);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry !== ARCHIVE_SUBDIR) return true;
  }
  return hasEntries(path.join(flatChanges, ARCHIVE_SUBDIR));
}

/** What a candidate planning root turns out to be, layout-wise. */
export type StoreRootLayoutClassification =
  | { readonly kind: 'not-a-store' }
  | { readonly kind: 'legacy-flat'; readonly storeId: string | null }
  | { readonly kind: 'layout-v2'; readonly storeId: string | null };

/**
 * Classify a resolved planning root that carries no planning scope.
 *
 * `assertStoreLayoutForWrite` above answers for a caller that already knows it
 * holds a Store. This answers the prior question — "is this root a Store at
 * all, and which layout does it declare?" — for the callers that receive a
 * root through the frozen compatibility adapter, which attaches no scope
 * description (see `resolveOpenSpecRoot`).
 *
 * Presence of the metadata file decides whether the path is a Store root; the
 * parse result never does. An unreadable declaration is not a layout v2
 * declaration, and answering `not-a-store` for one would fail OPEN into the
 * flat planning tree these guards exist to protect.
 */
export async function classifyStoreRootLayout(
  candidateRoot: string
): Promise<StoreRootLayoutClassification> {
  const metadataPath = await resolveReadableStoreMetadataPath(candidateRoot);
  try {
    if (!(await fs.stat(metadataPath)).isFile()) return { kind: 'not-a-store' };
  } catch {
    return { kind: 'not-a-store' };
  }

  const metadata = await readOptionalStoreMetadataState(candidateRoot).catch(() => null);
  const storeId = metadata?.id ?? null;
  return metadata?.layoutVersion === 2
    ? { kind: 'layout-v2', storeId }
    : { kind: 'legacy-flat', storeId };
}

export interface AssertStoreLayoutForWriteInput {
  readonly storeRoot: string;
  readonly storeId: string;
  readonly intent: StorePlanningWriteIntent;
  readonly writes: StorePlanningWriteShape;
}

/**
 * The one precondition in front of every Store planning mutation. Returns the
 * layout state so a caller that must branch does so on ONE reading rather than
 * re-deriving it.
 */
export async function assertStoreLayoutForWrite(
  input: AssertStoreLayoutForWriteInput
): Promise<StoreLayoutState> {
  const state = await readStoreLayoutState(input.storeRoot);

  if (state.mixed) {
    throw new StoreError(
      state.retirementRecorded
        ? `Store '${input.storeId}' retired its flat planning tree and is holding flat planning content again, so ${input.intent} cannot write either layout.`
        : `Store '${input.storeId}' declares planning layout version 2 but still holds flat planning content with no completed migration receipt, so ${input.intent} cannot write either layout.`,
      'store_layout_mixed_residue',
      {
        target: 'store.layout',
        // A retired Store has no interrupted run to resume, so `--status`
        // would send the operator to an answer that says nothing is wrong.
        // The flat content is a re-introduction, and Git is where it came from.
        fix: state.retirementRecorded
          ? `Inspect what re-introduced it ('git -C ${input.storeRoot} log -- ${WORKSPACE_DIR_NAME}/${SPECS_SUBDIR} ${WORKSPACE_DIR_NAME}/${CHANGES_SUBDIR}') and remove it from the Store worktree.`
          : `Run 'rasen store migrate-layout ${input.storeId} --status' and resume or roll back the interrupted run.`,
      }
    );
  }

  if (input.writes === 'flat' && state.declared === 2) {
    throw new StoreError(
      `Store '${input.storeId}' declares planning layout version 2, so ${input.intent} may not write a root-level store rasen/specs or rasen/changes path.`,
      'store_v2_flat_write_refused',
      {
        target: 'store.layout',
        fix: 'Write into the project partition instead; layout v2 has no writable flat Store namespace.',
      }
    );
  }

  if (input.writes === 'partition' && state.declared !== 2) {
    throw new StoreError(
      `Store '${input.storeId}' has not declared planning layout version 2, so ${input.intent} cannot write a project partition.`,
      'legacy_flat_store_requires_migration',
      {
        target: 'store.layout',
        fix: `Run 'rasen store migrate-layout ${input.storeId}' to migrate this Store, then retry.`,
      }
    );
  }

  return state;
}
