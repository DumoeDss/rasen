/**
 * Workflow chain table (design.md D2/D3, Phase B).
 *
 * A single static data table mapping each canonical workflow id to its
 * next step(s), plus a pure resolver that filters those steps against the
 * caller's installed-workflow set and skips ahead to the nearest installed
 * node when a direct successor is absent. This is the CLI-runtime
 * replacement for the hardcoded `/rasen-verify-change` -> `/rasen-ship` steering
 * that used to live in skill bodies (child 3 deletes that steering once
 * this module ships).
 *
 * Every id used here (as a table key, a `to` target, or a `MAIN_LINE`
 * entry) must be a member of `BUILT_IN_WORKFLOW_IDS` — a typo is caught by
 * the `Chain nodes are real workflow ids` unit test, not at runtime.
 */

import { BUILT_IN_WORKFLOW_IDS, type BuiltInWorkflowId } from './workflow-registry/builtins.js';
import { getCommandFileId } from './shared/retired-command-paths.js';
import { getLocaleCatalog, formatLocaleMessage } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';
import { getGlobalConfig } from './global-config.js';
import { resolveDesiredWorkflowSelection } from './profiles.js';
import { loadWorkflowCatalog } from './workflow-registry/index.js';

/**
 * The interactive main line, in delivery order. Used only for skip-ahead:
 * when a resolved target isn't installed, walk forward from its position
 * to the first installed node on this list.
 */
export const MAIN_LINE: readonly BuiltInWorkflowId[] = [
  'propose',
  'apply',
  'verify',
  'ship-command',
  'archive',
] as const;

/**
 * The state vocabulary the two wired surfaces (apply-instructions, status)
 * can observe, plus `entry` for the latent entry-point/side-branch edges
 * (`new`/`continue` -> `apply`, `explore`/`office-hours-command` ->
 * `propose`) that no surface queries today (design D2 Open Question).
 */
export type ChainState = 'blocked' | 'all_done' | 'ready' | 'artifacts-pending' | 'artifacts-complete' | 'entry';

export interface ChainEdge {
  when: ChainState;
  to: BuiltInWorkflowId;
  /** Locale key under `workflowChain.reasons` used when `to` is installed directly. */
  reasonKey: string;
  /**
   * Explicit fallback candidates tried (in order) when `to` is not
   * installed and `to` is not itself on `MAIN_LINE` (so a forward walk
   * has no starting position). Currently only `apply`'s `blocked` edge
   * (target `continue`, not on `MAIN_LINE`) needs this.
   */
  fallback?: readonly BuiltInWorkflowId[];
}

/**
 * The chain table. Pure data: no runtime detection, filesystem access, or
 * profile logic lives here (spec `workflow-next-steps` / "Table is pure
 * data"). Ids missing from this map (e.g. `sync`, `archive`, `verify`,
 * `ship-command`) are standalone/terminal nodes with no further step.
 */
export const WORKFLOW_CHAIN: Partial<Record<BuiltInWorkflowId, ChainEdge[]>> = {
  propose: [{ when: 'artifacts-complete', to: 'apply', reasonKey: 'readyForApply' }],
  new: [{ when: 'entry', to: 'apply', reasonKey: 'entryToApply' }],
  continue: [{ when: 'entry', to: 'apply', reasonKey: 'entryToApply' }],
  apply: [
    { when: 'blocked', to: 'continue', reasonKey: 'continueAuthoring', fallback: ['propose'] },
    { when: 'all_done', to: 'verify', reasonKey: 'readyForVerify' },
  ],
  explore: [{ when: 'entry', to: 'propose', reasonKey: 'exploreToPropose' }],
  'office-hours-command': [{ when: 'entry', to: 'propose', reasonKey: 'officeHoursToPropose' }],
  sync: [],
};

export interface ResolvedNextStep {
  /** Raw canonical workflow id (e.g. `ship-command`); callers strip `-command` for display. */
  workflow: BuiltInWorkflowId;
  reason: string;
}

/**
 * Ordered list of candidates to try for an edge: the direct target, then
 * (if the target sits on `MAIN_LINE`) every node after it on `MAIN_LINE`,
 * or the edge's explicit `fallback` list when the target is off the main
 * line entirely.
 */
function candidatesFor(edge: ChainEdge): readonly BuiltInWorkflowId[] {
  const mainLineIndex = MAIN_LINE.indexOf(edge.to);
  if (mainLineIndex !== -1) {
    return [edge.to, ...MAIN_LINE.slice(mainLineIndex + 1)];
  }
  return [edge.to, ...(edge.fallback ?? [])];
}

/**
 * Resolves the canonical next step(s) for `workflowId` in `state`, filtered
 * to `installedWorkflows`. When an edge's direct target is not installed,
 * resolution walks forward to the nearest installed candidate and
 * substitutes it, noting the skip in the reason; when nothing downstream is
 * installed, the step is dropped. Results are deduped by workflow id,
 * preserving edge order (design D3).
 */
export function resolveNextSteps(
  workflowId: string,
  state: ChainState,
  installedWorkflows: readonly string[],
  locale: CliLocale = 'en'
): ResolvedNextStep[] {
  const edges = WORKFLOW_CHAIN[workflowId as BuiltInWorkflowId] ?? [];
  const catalog = getLocaleCatalog(locale);
  const reasons = catalog.workflowChain.reasons as Record<string, string>;
  const installed = new Set(installedWorkflows);

  const results: ResolvedNextStep[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    if (edge.when !== state) continue;

    const candidates = candidatesFor(edge);
    const resolved = candidates.find((candidate) => installed.has(candidate));
    if (!resolved) continue; // nothing downstream is installed - drop the step
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const displayWorkflow = getCommandFileId(resolved);
    const reason =
      resolved === edge.to
        ? formatLocaleMessage(reasons[edge.reasonKey] ?? reasons.readyForApply, { workflow: displayWorkflow })
        : formatLocaleMessage(reasons.skipAhead, {
            original: getCommandFileId(edge.to),
            workflow: displayWorkflow,
          });

    results.push({ workflow: resolved, reason });
  }

  return results;
}

/** Regression/typo guard: every table id is a current built-in workflow id. */
export function chainNodeIds(): string[] {
  const ids = new Set<string>();
  for (const [key, edges] of Object.entries(WORKFLOW_CHAIN)) {
    ids.add(key);
    for (const edge of edges ?? []) {
      ids.add(edge.to);
      for (const fallback of edge.fallback ?? []) {
        ids.add(fallback);
      }
    }
  }
  for (const id of MAIN_LINE) {
    ids.add(id);
  }
  return [...ids];
}

/**
 * Formats the trailing `Next: <workflow> — <reason>` hint line for
 * human-readable surfaces (design D6 / spec "Human-readable Next hint"),
 * stripping the internal `-command` suffix from the displayed workflow id.
 */
export function formatNextWorkflowHint(step: ResolvedNextStep, locale: CliLocale = 'en'): string {
  const catalog = getLocaleCatalog(locale);
  return formatLocaleMessage(catalog.workflowChain.hint, {
    workflow: getCommandFileId(step.workflow),
    reason: step.reason,
  });
}

export function isBuiltInWorkflowId(id: string): id is BuiltInWorkflowId {
  return (BUILT_IN_WORKFLOW_IDS as readonly string[]).includes(id);
}

/**
 * Resolves the workflow ids currently selected for install, mirroring
 * `update.ts:140-181`'s desired-set computation: `getGlobalConfig()` for
 * the profile/custom-workflow-list, `loadWorkflowCatalog()`, then
 * `resolveDesiredWorkflowSelection(...).ids`.
 *
 * This is the ONLY sanctioned source for the installed-workflow set that
 * feeds `resolveNextSteps` (design D5 / spec "Installed set derives from
 * the profile/config selection"). It deliberately does NOT read the
 * workflow artifact ledger: the ledger only records `source === 'user'`
 * entries and never contains built-in chain workflows, so using it would
 * report every built-in next step as uninstalled.
 */
export function resolveInstalledWorkflowIds(): string[] {
  const globalConfig = getGlobalConfig();
  const profile = globalConfig.profile ?? 'full';
  const expertSelectionExplicit = globalConfig.expertSelectionExplicit === true;
  const catalog = loadWorkflowCatalog();
  const { ids } = resolveDesiredWorkflowSelection(
    catalog,
    profile,
    globalConfig.workflows,
    expertSelectionExplicit
  );
  return ids;
}
