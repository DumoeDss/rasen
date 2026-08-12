/**
 * `rasen store migrate-layout <store-id>` — the consumer adapter for
 * `StoreLayoutMigrationModule`.
 *
 * It formats; it holds no resolution logic. The preview is the full item table
 * with states, reasons, destinations, other flat refs, retained design docs,
 * and untracked-file warnings, and the JSON form carries the same content as
 * the human form. Nothing here stages, commits, fetches, pulls, or pushes: the
 * command prints pathspec-scoped commit suggestions and stops.
 */
import { asErrorMessage, printJson } from './shared-output.js';
import { StoreError } from '../core/store/index.js';
import {
  StoreLayoutMigration,
  migrationItemDiagnosticCode,
  migrationItemStateLabel,
  type FlatStoreInventory,
  type ImmutableMigrationPlan,
  type MigrationResult,
  type MigrationRunStatus,
} from '../core/store/layout-migration/index.js';

export interface StoreMigrateLayoutOptions {
  mapping?: string;
  defaultTargetLine?: string;
  includeUntracked?: boolean;
  dryRun?: boolean;
  apply?: boolean;
  status?: boolean;
  resume?: boolean;
  rollback?: boolean;
  retireFlat?: boolean;
  json?: boolean;
}

function fail(json: boolean | undefined, error: unknown, code: string): void {
  const diagnostic =
    error instanceof StoreError
      ? error.diagnostic
      : { severity: 'error' as const, code, message: asErrorMessage(error) };
  if (json) {
    printJson({ status: [diagnostic] });
  } else {
    console.error(`${diagnostic.code}: ${asErrorMessage(diagnostic.message)}`);
    if (diagnostic.fix) console.error(`  fix: ${diagnostic.fix}`);
  }
  process.exitCode = 1;
}

function planPayload(plan: ImmutableMigrationPlan, inventory: FlatStoreInventory): unknown {
  return {
    planId: plan.planId,
    schemaVersion: plan.schemaVersion,
    mappingVersion: plan.mappingVersion,
    storeId: plan.storeId,
    ref: plan.ref,
    applicable: plan.applicable,
    token: plan.token,
    items: plan.items.map((item) => ({
      kind: item.kind,
      name: item.name,
      state: migrationItemStateLabel(item.state),
      code: migrationItemDiagnosticCode(item),
      reason: item.reason,
      repair: item.repair,
      source: item.sourceRelative,
      destination: item.destinationRelative,
      owner: item.owner,
      targetLine: item.targetLineId,
      evidence: item.evidence,
      supersededEvidence: item.supersededEvidence,
      contributors: item.contributors,
      untracked: item.untracked,
      sourceLifecycle: item.sourceLifecycle,
      disposition: item.disposition,
      materialization: item.materialization,
      planInput: item.planInput,
      continuation:
        item.disposition?.kind === 'store-issue' && item.planInput === undefined
          ? {
              code: 'migration_issue_plan_absent',
              message: 'no plan supplied; no nodes invented',
              command: `rasen store issue plan ${item.disposition.issueId} --store ${plan.storeId} --from-file <path>`,
            }
          : undefined,
    })),
    blockers: plan.blockers.map((item) => ({
      name: item.name,
      state: migrationItemStateLabel(item.state),
      code: migrationItemDiagnosticCode(item),
      reason: item.reason,
      repair: item.repair,
    })),
    retainedDesignDocs: plan.retainedDesignDocs.map((doc) => doc.relative),
    sharedSpecResolutions: plan.sharedSpecResolutions,
    catalogUpgrades: plan.catalogUpgrades.map((upgrade) => ({
      projectId: upgrade.projectId,
      record: upgrade.recordRelative,
      binding: upgrade.binding,
      droppedAdoption: upgrade.droppedAdoption,
    })),
    targetLineCatalogs: plan.targetLineCatalogs.map((entry) => entry.destinationRelative),
    changeInstances: plan.mintedIdentities,
    retirementSet: plan.retirementSet,
    otherFlatRefs: plan.otherFlatRefs,
    refs: inventory.refs,
    inventoryFailures: inventory.failures,
  };
}

function renderPlan(plan: ImmutableMigrationPlan, inventory: FlatStoreInventory): void {
  console.log(`Store ${plan.storeId} — planning layout migration preview`);
  console.log(`  plan id: ${plan.planId}`);
  console.log(`  ref:     ${plan.ref ?? '(no ref checked out)'}`);
  console.log('');

  if (plan.items.length === 0) {
    console.log('  No flat planning content was inventoried for this ref.');
  } else {
    console.log('  Items');
    for (const item of plan.items) {
      const state = migrationItemStateLabel(item.state);
      console.log(
        `    [${state}] ${item.kind} ${item.name}${item.owner ? ` -> ${item.owner}` : ''}`
      );
      const code = migrationItemDiagnosticCode(item);
      if (code !== undefined) console.log(`        code:        ${code}`);
      console.log(`        source:      ${item.sourceRelative}`);
      if (item.destinationRelative !== undefined) {
        console.log(`        destination: ${item.destinationRelative}`);
      }
      if (item.targetLineId !== undefined) {
        console.log(`        target line: ${item.targetLineId}`);
      }
      console.log(`        reason:      ${item.reason}`);
      if (item.repair.length > 0) console.log(`        repair:      ${item.repair}`);
      for (const evidence of item.evidence) {
        console.log(
          `        evidence:    ${evidence.class} (${evidence.nature}) ${evidence.projectId} <- ${evidence.source}`
        );
      }
      for (const evidence of item.supersededEvidence) {
        console.log(
          `        superseded:  ${evidence.class} ${evidence.projectId} <- ${evidence.source}`
        );
      }
      if (item.untracked !== undefined && item.untracked.length > 0) {
        console.log(
          `        non-Git:     ${item.untracked.length} file(s)${item.materialization?.kind === 'generated-tree' ? ' block generated conversion' : ' will move with the copied tree'} — ${item.untracked
            .slice(0, 5)
            .join(', ')}`
        );
      }
      if (item.disposition?.kind === 'store-issue') {
        console.log(
          `        Issue:       ${item.disposition.issueId} (${item.disposition.state})`
        );
        if (item.planInput === undefined) {
          console.log(
            '        info:        migration_issue_plan_absent — no plan supplied; no nodes invented'
          );
          console.log(
            `        continue:    rasen store issue plan ${item.disposition.issueId} --store ${plan.storeId} --from-file <path>`
          );
        }
      }
    }
  }

  if (plan.retainedDesignDocs.length > 0) {
    console.log('');
    console.log('  Retained Store-level design docs (unclassified by decision, not omission)');
    for (const doc of plan.retainedDesignDocs) console.log(`    ${doc.relative}`);
  }

  if (plan.otherFlatRefs.length > 0) {
    console.log('');
    console.log('  Other local refs that still carry flat planning content');
    for (const ref of plan.otherFlatRefs) {
      console.log(`    ${ref.ref}${ref.migrateFrom ? ` — ${ref.migrateFrom}` : ''}`);
    }
    console.log('    Migrating this ref does not migrate the others.');
  }

  if (inventory.failures.length > 0) {
    console.log('');
    console.log('  Unreadable items (recorded, never fatal to the scan)');
    for (const failure of inventory.failures) {
      console.log(`    ${failure.path}: ${failure.reason}`);
    }
  }

  console.log('');
  console.log(
    plan.applicable
      ? `  Ready to apply. Re-run with --apply.`
      : `  Not applicable: ${plan.blockers.length} item(s) unresolved or blocked. There is no --force and no partial migration; the mapping file is the escape hatch.`
  );
}

function renderResult(result: MigrationResult): void {
  console.log(`Store ${result.storeId} — migration ${result.phase}`);
  for (const published of result.published) console.log(`  published: ${published}`);
  for (const removed of result.removed) console.log(`  removed:   ${removed}`);
  if (result.receiptPath) console.log(`  receipt:   ${result.receiptPath}`);
  if (result.suggestedCommits.length > 0) {
    console.log('');
    console.log('Suggested commits (not executed — Rasen never writes your git index):');
    for (const commit of result.suggestedCommits) {
      console.log(`  ${commit.rationale}`);
      console.log(`    ${commit.command}`);
    }
  }
}

function renderStatus(status: MigrationRunStatus): void {
  console.log(`Store ${status.storeId} — migration status`);
  console.log(`  ref:   ${status.ref ?? '(no ref checked out)'}`);
  console.log(`  phase: ${status.phase ?? '(no run recorded)'}`);
  if (status.planId) console.log(`  plan:  ${status.planId}`);
  if (status.failure) console.log(`  failure: ${status.failure}`);
  if (status.createdPaths.length > 0) {
    console.log('  paths created by this run:');
    for (const created of status.createdPaths) console.log(`    ${created}`);
  }
  console.log(`  publication recorded: ${status.publicationComplete ? 'yes' : 'no'}`);
}

export async function runStoreMigrateLayout(
  storeId: string,
  options: StoreMigrateLayoutOptions
): Promise<void> {
  const migration = new StoreLayoutMigration();
  const base = {
    storeSelector: storeId,
    startPath: process.cwd(),
  };

  try {
    if (options.status) {
      const status = await migration.status(base);
      if (options.json) printJson(status);
      else renderStatus(status);
      return;
    }

    if (options.rollback || options.resume || options.retireFlat) {
      const action = options.rollback
        ? ('rollback' as const)
        : options.retireFlat
          ? ('retire-flat' as const)
          : ('resume' as const);
      const result = await migration.recover({ ...base, action });
      if (options.json) printJson(result);
      else renderResult(result);
      return;
    }

    const inventory = await migration.inventory(base);
    const plan = await migration.plan({
      ...base,
      ...(options.mapping === undefined ? {} : { mappingPath: options.mapping }),
      ...(options.defaultTargetLine === undefined
        ? {}
        : { defaultTargetLine: options.defaultTargetLine }),
      ...(options.includeUntracked ? { includeUntracked: true } : {}),
    });

    // `--dry-run` is the default: the command previews unless `--apply` is
    // passed, and a preview writes nothing into either repository.
    if (!options.apply) {
      if (options.json) printJson(planPayload(plan, inventory));
      else renderPlan(plan, inventory);
      if (!plan.applicable) process.exitCode = 1;
      return;
    }

    if (plan.token === undefined) {
      if (options.json) printJson(planPayload(plan, inventory));
      else renderPlan(plan, inventory);
      process.exitCode = 1;
      return;
    }

    const result = await migration.apply(plan.token);
    if (options.json) printJson(result);
    else renderResult(result);
  } catch (error) {
    fail(options.json, error, 'store_migrate_layout_error');
  }
}
