/**
 * Read-only layout-migration diagnostics (design D13).
 *
 * Git can bypass Rasen entirely, so these checks are what catch a manually
 * merged wrong layout. Every one of them REPORTS: nothing here writes a file,
 * creates a staging directory, touches a registry entry, or contacts a network,
 * and none of them repairs anything. Each finding carries a stable code, names
 * the affected ref, file, or item, and carries a copy-pasteable repair.
 */
import * as path from 'node:path';

import { makeStoreDiagnostic, type StoreDiagnostic } from '../errors.js';
import { readStoreLayoutState } from '../layout-write-guard.js';
import { listStoreMembership } from '../membership-layout.js';
import { resolveStorePlanningLayoutV2Path } from '../planning-layout-v2.js';
import {
  productionStoreLayoutMigrationDependencies,
  type StoreLayoutMigrationDependencies,
} from './dependencies.js';
import { collectEvidence, buildSpecProvenance, evidenceKey, reduceOwnership } from './evidence.js';
import { flatStorePaths, listDirectoryNames } from './flat-source.js';
import { inventoryStore } from './inventory.js';
import {
  manifestRelativePath,
  readRecoveryManifest,
  type RecoveryManifest,
} from './apply.js';
import { migrationReceiptsDir, readMigrationReceipt } from './receipt.js';

export interface LayoutMigrationDiagnosticsInput {
  readonly storeId: string;
  readonly storeUid?: string;
  readonly storeRoot: string;
  readonly globalDataDir?: string;
}

/**
 * Re-runs inventory and provenance in a strictly read-only mode. `inventory`
 * is already total and write-free, which is why doctor can reuse it verbatim
 * rather than growing a second, weaker implementation that could disagree.
 */
export async function diagnoseLayoutMigration(
  input: LayoutMigrationDiagnosticsInput,
  dependencies: StoreLayoutMigrationDependencies = productionStoreLayoutMigrationDependencies
): Promise<StoreDiagnostic[]> {
  const diagnostics: StoreDiagnostic[] = [];
  const migrateCommand = `rasen store migrate-layout ${input.storeId}`;

  const inventory = await inventoryStore(
    dependencies,
    {
      storeId: input.storeId,
      ...(input.storeUid === undefined ? {} : { storeUid: input.storeUid }),
      storeRoot: input.storeRoot,
    },
    (ref) => `${migrateCommand} --apply  # from a worktree with ${ref} checked out`
  );

  const flatRefs = inventory.refs.filter(
    (ref) => ref.classification === 'flat' && ref.kind === 'local-branch'
  );
  if (flatRefs.length > 0) {
    diagnostics.push(
      makeStoreDiagnostic(
        'warning',
        'store_layout_flat_requires_migration',
        `${flatRefs.length} local ref(s) still carry flat planning content: ${flatRefs
          .map((ref) => ref.ref)
          .join(', ')}. Migrating one ref does not migrate the others.`,
        { target: 'store.layout', fix: `${migrateCommand} --apply` }
      )
    );
  }

  const state = await readStoreLayoutState(input.storeRoot);
  if (state.declared === 2 && state.flatContentPresent) {
    // Three distinguishable states, and conflating the last two told the
    // operator that retirement "has not run yet" two commits after it did —
    // then pointed at `--retire-flat`, which deletes only what the ORIGINAL
    // plan's retirement set names and leaves everything else reported forever.
    const awaitingRetirement = state.publicationRecorded;
    const reIntroduced = !awaitingRetirement && state.retirementRecorded;
    diagnostics.push(
      makeStoreDiagnostic(
        awaitingRetirement ? 'info' : 'error',
        'store_layout_mixed_residue',
        awaitingRetirement
          ? 'This store declares planning layout version 2 and still holds the flat planning tree; retirement is a separate step and has not run yet.'
          : reIntroduced
            ? `This store retired its flat planning tree and is holding flat planning content again at ${flatPlanningTreePath(input.storeRoot)}; Git can add those paths back without conflict once they no longer exist here.`
            : 'This store declares planning layout version 2 but still holds flat planning content with no completed migration receipt.',
        {
          target: 'store.layout',
          fix: awaitingRetirement
            ? `${migrateCommand} --retire-flat`
            : reIntroduced
              ? `git -C ${input.storeRoot} log -- rasen/specs rasen/changes  # then remove the re-introduced flat planning content`
              : `${migrateCommand} --status`,
        }
      )
    );
  }

  const manifest = await readManifest(dependencies, input, inventory.checkedOutRef);
  if (
    manifest !== null &&
    manifest.phase !== 'published' &&
    manifest.phase !== 'retired' &&
    manifest.phase !== 'rolled-back'
  ) {
    diagnostics.push(
      makeStoreDiagnostic(
        'error',
        'store_layout_migration_incomplete',
        `A layout migration for ref ${manifest.ref} is recorded as '${manifest.phase}'${
          manifest.failure === undefined ? '' : ` (${manifest.failure})`
        }.`,
        {
          target: 'store.layout',
          fix: `${migrateCommand} --resume  (or ${migrateCommand} --rollback)`,
        }
      )
    );
  }

  // Ownership and shared-spec findings are only meaningful while flat content
  // still exists to be attributed.
  if (state.flatContentPresent) {
    const evidence = await collectEvidence(dependencies, {
      storeRoot: input.storeRoot,
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
      specs: inventory.specs,
      changes: inventory.changes,
      archiveEntries: inventory.archiveEntries,
    });

    const ownerByKey = new Map<string, string | undefined>();
    const unresolved: string[] = [];
    for (const [kind, names] of [
      ['change', inventory.changes],
      ['archive-entry', inventory.archiveEntries],
    ] as const) {
      for (const name of names) {
        const key = evidenceKey(kind, name);
        const decision = reduceOwnership(evidence.byItem.get(key) ?? [], evidence.members);
        ownerByKey.set(key, decision.owner);
        if (decision.owner === undefined) unresolved.push(`${kind}:${name} (${decision.reason})`);
      }
    }
    if (unresolved.length > 0) {
      diagnostics.push(
        makeStoreDiagnostic(
          'warning',
          'store_layout_unresolved_ownership',
          `${unresolved.length} item(s) have absent or conflicting ownership evidence: ${unresolved
            .slice(0, 10)
            .join(', ')}.`,
          {
            target: 'store.layout',
            fix: `${migrateCommand} --mapping <path>  # declare the owners in a committed mapping file`,
          }
        )
      );
    }

    const provenance = await buildSpecProvenance(dependencies, {
      storeRoot: input.storeRoot,
      changes: inventory.changes,
      archiveEntries: inventory.archiveEntries,
      ownerByKey,
    });
    const shared = [...provenance.values()].filter(
      (entry) => entry.contributors.length > 1 && !entry.hasUnknownContributor
    );
    if (shared.length > 0) {
      diagnostics.push(
        makeStoreDiagnostic(
          'warning',
          'store_layout_shared_spec_unresolved',
          `${shared.length} capability/capabilities have contributors from several projects: ${shared
            .map((entry) => `${entry.capability} (${entry.contributors.join(', ')})`)
            .join('; ')}.`,
          {
            target: 'store.layout',
            fix: `${migrateCommand} --mapping <path>  # declare specs.<capability>.owner or .split`,
          }
        )
      );
    }
  }

  if (state.declared === 2) {
    diagnostics.push(...(await partitionOrphans(dependencies, input, migrateCommand)));
    const membership = await listStoreMembership(input.storeRoot, input.storeId);
    diagnostics.push(...membership.diagnostics);
    diagnostics.push(...(await legacyArchiveRecords(dependencies, input)));
  }

  const designDocs = inventory.designDocs;
  if (designDocs.length > 0) {
    diagnostics.push(
      makeStoreDiagnostic(
        'info',
        'store_layout_design_doc_unclassified',
        `${designDocs.length} Store-level design doc(s) are retained without a project classification: ${designDocs
          .slice(0, 10)
          .join(', ')}.`,
        {
          target: 'store.layout',
          fix: `${migrateCommand} --mapping <path>  # assign them with designDocs.<name>`,
        }
      )
    );
  }

  return diagnostics;
}

async function readManifest(
  dependencies: StoreLayoutMigrationDependencies,
  input: LayoutMigrationDiagnosticsInput,
  ref: string | undefined
): Promise<RecoveryManifest | null> {
  if (input.storeUid === undefined || ref === undefined) return null;
  const value = await dependencies
    .coordination(input.globalDataDir)
    .readJson(manifestRelativePath(input.storeUid, ref));
  return value === null ? null : readRecoveryManifest(value);
}

async function partitionOrphans(
  dependencies: StoreLayoutMigrationDependencies,
  input: LayoutMigrationDiagnosticsInput,
  migrateCommand: string
): Promise<StoreDiagnostic[]> {
  const diagnostics: StoreDiagnostic[] = [];
  const membership = await listStoreMembership(input.storeRoot, input.storeId);
  const catalogued = new Map(
    membership.entries
      .filter((entry) => entry.layout === 2)
      .map((entry) => [entry.projectId, entry] as const)
  );

  const projectsRoot = path.dirname(
    resolveStorePlanningLayoutV2Path(input.storeRoot, {
      kind: 'project-home',
      projectId: 'placeholder',
    })
  );
  for (const projectId of await listDirectoryNames(dependencies.fs, projectsRoot)) {
    if (!catalogued.has(projectId)) {
      diagnostics.push(
        makeStoreDiagnostic(
          'warning',
          'store_layout_partition_orphan',
          `Partition rasen/projects/${projectId} has no project catalog.`,
          {
            target: 'store.layout',
            fix: `Add the project (rasen store add-project <path> --to ${input.storeId}), or remove the orphan partition after inspecting the store's git history.`,
          }
        )
      );
    }
  }

  for (const [projectId, entry] of catalogued) {
    if (entry.layout !== 2) continue;
    if (entry.catalog.planningBinding.state !== 'bound') continue;
    const home = resolveStorePlanningLayoutV2Path(input.storeRoot, {
      kind: 'project-home',
      projectId,
    });
    if ((await dependencies.fs.statKind(home)) !== 'directory') {
      diagnostics.push(
        makeStoreDiagnostic(
          'warning',
          'store_layout_partition_orphan',
          `Project '${projectId}' declares a bound planning binding but has no partition at rasen/projects/${projectId}.`,
          { target: 'store.layout', fix: `${migrateCommand} --status` }
        )
      );
    }
  }

  return diagnostics;
}

/**
 * Informational: a relocated legacy Archive entry keeps its own record, and no
 * Archive v2 record, outcome, reachability fact, or workspace pair is ever
 * synthesized for it. Reported so the finalization owner can decide what, if
 * anything, to do with them.
 */
async function legacyArchiveRecords(
  dependencies: StoreLayoutMigrationDependencies,
  input: LayoutMigrationDiagnosticsInput
): Promise<StoreDiagnostic[]> {
  const receipts = migrationReceiptsDir(input.storeRoot);
  const entries = await dependencies.fs.listEntries(receipts);
  let legacy = 0;
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    const text = await dependencies.fs.readText(path.join(receipts, entry.name));
    if (text === null) continue;
    try {
      const read = readMigrationReceipt(text);
      if (!read.ok) continue;
      legacy += read.receipt.items.filter((item) => item.recordSchema === 'legacy').length;
    } catch {
      continue;
    }
  }
  if (legacy === 0) return [];
  return [
    makeStoreDiagnostic(
      'info',
      'store_layout_legacy_archive_record',
      `${legacy} relocated Archive entry/entries carry a legacy record rather than an Archive v2 record.`,
      {
        target: 'store.layout',
        fix: 'No action: legacy evidence cannot prove an outcome, reachability, or a workspace pair, so migration never synthesized one.',
      }
    ),
  ];
}

/** Absolute path of the Store's flat planning tree, for messages only. */
export function flatPlanningTreePath(storeRoot: string): string {
  return flatStorePaths(storeRoot).planning;
}
