/**
 * The localized surface for learned-skill materialization reporting.
 *
 * Kept apart from the `rasen knowledge` command's own messages because these
 * lines are printed by `init` and `update`, which are not knowledge commands —
 * and because every one of them is a state a user has to act on: a conflict, a
 * Store that could not be reached, a deferred removal, a migration.
 */
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import { resolveCliLocale } from '../utils/locale.js';
import { describeDurableOwner } from './learned-skills/index.js';
import type { LearnedReconcileResult } from './learned-skill-materialization.js';

type LearnedMaterializationMessageKey =
  keyof ReturnType<typeof getLocaleCatalog>['learnedMaterialization'];

export function learnedMaterializationMessage(
  key: LearnedMaterializationMessageKey,
  values: Record<string, string | number> = {}
): string {
  return formatLocaleMessage(
    getLocaleCatalog(resolveCliLocale()).learnedMaterialization[key],
    values
  );
}

/** One reportable line, with the tone the caller should render it in. */
export interface LearnedReportLine {
  tone: 'info' | 'warn';
  text: string;
}

function describeStore(store: { uid?: string; id?: string }): string {
  if (store.id === undefined) return store.uid ?? '<unknown>';
  return store.uid === undefined ? store.id : `${store.id} (${store.uid})`;
}

/**
 * Everything the user needs to know about one reconciliation, in one place.
 *
 * `init` and `update` print the SAME report. Two copies of ninety lines of
 * formatting is how a conflict ends up being reported by one command and not
 * the other, and only one of them gets fixed.
 */
export function learnedMaterializationReport(
  result: LearnedReconcileResult
): LearnedReportLine[] {
  const lines: LearnedReportLine[] = [];

  if (result.noOp) {
    lines.push({ tone: 'info', text: learnedMaterializationMessage('noOp') });
  }
  if (result.migrated.length > 0) {
    // Stated as a MIGRATION, never as edited content: the identity scheme
    // changed, the knowledge did not, and a user told otherwise would go
    // looking for a change nobody made.
    lines.push({
      tone: 'info',
      text: learnedMaterializationMessage('identityMigrated', {
        count: result.migrated.length,
      }),
    });
  }
  if (result.deduplicated.length > 0) {
    lines.push({
      tone: 'info',
      text: learnedMaterializationMessage('deduplicated', { count: result.deduplicated.length }),
    });
  }
  for (const skip of result.skipped) {
    lines.push({ tone: 'warn', text: skip.message });
  }
  for (const conflict of result.conflicts) {
    lines.push({
      tone: 'warn',
      text: `${learnedMaterializationMessage('conflict', {
        kind: conflict.kind,
        id: conflict.id,
        sources: conflict.participants
          .map(
            (item) =>
              `${describeDurableOwner(item.source.owner)}/${item.source.id} (${item.knowledgeKey}, ${item.canonicalContentDigest})`
          )
          .join(', '),
      })} ${learnedMaterializationMessage('repairConflict')}`,
    });
  }
  for (const store of result.unavailableStores) {
    lines.push({
      tone: 'warn',
      text: `${learnedMaterializationMessage('unavailableStore', {
        id: describeStore(store.store),
        detail: store.diagnostic,
      })}${store.repair.length > 0 ? ` ${learnedMaterializationMessage('repairNext', { command: store.repair[0] as string })}` : ''}`,
    });
  }
  for (const deferred of result.deferred) {
    lines.push({
      tone: 'warn',
      text: learnedMaterializationMessage('deferred', {
        action: deferred.action,
        id: deferred.id,
      }),
    });
  }
  if (result.budgetFailure) {
    lines.push({
      tone: 'warn',
      text: learnedMaterializationMessage('budgetExceeded', {
        name: result.budgetFailure.name,
        actual: result.budgetFailure.actual,
        limit: result.budgetFailure.limit,
        ids: result.budgetFailure.ids.join(', '),
      }),
    });
  }
  for (const error of result.errors) {
    lines.push({
      tone: 'warn',
      text: `${learnedMaterializationMessage('incomplete', {
        code: error.code,
        message: error.message,
      })}${error.repair && error.repair.length > 0 ? ` ${learnedMaterializationMessage('repairNext', { command: error.repair[0] })}` : ''}`,
    });
  }
  return lines;
}
