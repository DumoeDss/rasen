/**
 * Profile System
 *
 * Defines workflow profiles that control which workflows are installed.
 * Skills are the only delivery format — profiles determine which workflows
 * install, not how.
 */

import type { Profile } from './global-config.js';
import { readProjectConfig } from './project-config.js';
import {
  BUILT_IN_WORKFLOW_IDS,
  CORE_WORKFLOW_IDS,
  filterKnownWorkflowRoots,
  getBuiltInWorkflowDefinitions,
  getExpertSkillDefinitions,
  resolveWorkflowSelection,
  WorkflowCatalog,
  type BuiltInWorkflowId,
} from './workflow-registry/index.js';

/**
 * Core workflows included in the 'core' profile.
 * These provide the streamlined experience for new users.
 */
export const CORE_WORKFLOWS = CORE_WORKFLOW_IDS;

/**
 * All available workflows in the system.
 */
export const ALL_WORKFLOWS = BUILT_IN_WORKFLOW_IDS;

export type WorkflowId = BuiltInWorkflowId;
export type CoreWorkflowId = (typeof CORE_WORKFLOWS)[number];

/** Every built-in expert id (the `full` profile's default expert set). */
export const ALL_EXPERTS: readonly string[] = getExpertSkillDefinitions().map(
  (expert) => expert.id
);

/**
 * The six quality-floor experts the built-in pipelines fan out to
 * (`full-feature` dispatches all six; `benchmark` is floor-only-by-profile
 * since no workflow's `requires.skills` names it, so closure alone would
 * never install it). This is the `core` profile's default expert set.
 */
export const QUALITY_FLOOR_EXPERTS: readonly string[] = [
  'review',
  'cso',
  'qa',
  'qa-only',
  'benchmark',
  'design-review',
];

/**
 * The current built-in *workflow* ids — catalog entries with
 * `source === 'built-in'` and `kind !== 'expert'` (experts are a disjoint id
 * space, tracked by their own migration marker). This is the source of truth
 * for `GlobalConfig.knownBuiltInWorkflows`: the baseline written when a
 * selection is persisted, and the set `update` diffs against that baseline to
 * surface a genuinely new built-in workflow.
 */
export function getCurrentBuiltInWorkflowIds(): string[] {
  return getBuiltInWorkflowDefinitions()
    .filter((definition) => definition.source === 'built-in' && definition.kind !== 'expert')
    .map((definition) => definition.id);
}

export interface GetProfileWorkflowsOptions {
  /**
   * Machine-managed migration marker (`GlobalConfig.expertSelectionExplicit`).
   * `false`/absent (legacy — never explicitly re-selected through the
   * flipped picker): the expert dimension resolves to `ALL_EXPERTS`,
   * profile-independent, so every existing install keeps all 21 experts.
   * `true`: the profile's default expert set (below) governs.
   */
  expertSelectionExplicit?: boolean;
}

/**
 * Resolves which workflows AND experts should be active for a given profile
 * configuration. Workflow ids and expert ids share one id space in the
 * returned array (D1: unified storage, no parallel `config.experts` field).
 *
 * - 'full' profile always returns ALL_WORKFLOWS (+ ALL_EXPERTS once explicit)
 * - 'core' profile always returns CORE_WORKFLOWS (+ QUALITY_FLOOR_EXPERTS once explicit)
 * - 'custom' profile returns the provided customWorkflows verbatim (already
 *   includes whatever expert ids the user selected)
 *
 * Until `options.expertSelectionExplicit` is `true`, the expert dimension is
 * profile-independent (`ALL_EXPERTS` always) — the non-regressive migration
 * guarantee (design.md D4): an existing install never silently loses an
 * expert on the first `update` after this behavior lands.
 */
export function getProfileWorkflows(
  profile: Profile,
  customWorkflows?: string[],
  options: GetProfileWorkflowsOptions = {}
): readonly string[] {
  if (profile === 'custom') {
    const workflows = customWorkflows ?? [];
    if (options.expertSelectionExplicit) return workflows;
    return [...new Set([...workflows, ...ALL_EXPERTS])];
  }
  if (profile === 'core') {
    return options.expertSelectionExplicit
      ? [...CORE_WORKFLOWS, ...QUALITY_FLOOR_EXPERTS]
      : [...CORE_WORKFLOWS, ...ALL_EXPERTS];
  }
  return [...ALL_WORKFLOWS, ...ALL_EXPERTS];
}

export interface ResolveDesiredWorkflowSelectionResult {
  /** Fully resolved install-set ids (workflows + experts), in catalog order. */
  ids: string[];
  /** Stored ids the catalog no longer recognizes (e.g. a retired built-in). */
  unknown: string[];
}

/**
 * The single desired-set resolver shared by `init` and `update` (design.md
 * D3): resolves the profile's default workflow+expert ids, drops any the
 * catalog no longer recognizes, then closes over `requires.workflows` AND
 * (opt-in here) `requires.skills` so a lean profile still installs the
 * experts its selected workflows require. Threading one resolved array to
 * both the install path (`getSkillTemplates`) and the removal seam
 * (`removeUnselectedSkillDirs`/drift) keeps them from ever disagreeing.
 */
export function resolveDesiredWorkflowSelection(
  catalog: WorkflowCatalog,
  profile: Profile,
  customWorkflows: string[] | undefined,
  expertSelectionExplicit: boolean
): ResolveDesiredWorkflowSelectionResult {
  const base = getProfileWorkflows(profile, customWorkflows, { expertSelectionExplicit });
  const { known, unknown } = filterKnownWorkflowRoots(catalog, base);
  const ids = resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(
    (definition) => definition.id
  );
  return { ids, unknown };
}

/** Result of {@link resolveProjectWorkflowSelection}, naming which layer produced the set. */
export interface ResolveProjectWorkflowSelectionResult extends ResolveDesiredWorkflowSelectionResult {
  /** `'override'` when the project carries its own `workflows` selection; `'profile'` otherwise. */
  mode: 'profile' | 'override';
}

/**
 * The per-project entry point (design.md D1/D3, space-workflow-enablement):
 * when the project's own `rasen/config.yaml` carries a `workflows` override,
 * that list resolves verbatim plus dependency closure — bypassing the
 * `expertSelectionExplicit` migration entirely, since an override is always
 * an explicit, individually-authored list, never a legacy all-experts
 * install. When no override is present, resolution is unchanged: the
 * user-wide profile path (`resolveDesiredWorkflowSelection`) governs. Used
 * by both `update.ts` and `profile-sync-drift.ts` so install, removal, and
 * drift can never disagree about which space is following what.
 */
export function resolveProjectWorkflowSelection(
  catalog: WorkflowCatalog,
  projectRoot: string,
  profile: Profile,
  customWorkflows: string[] | undefined,
  expertSelectionExplicit: boolean
): ResolveProjectWorkflowSelectionResult {
  const projectConfig = readProjectConfig(projectRoot);
  const override = projectConfig?.workflows;

  if (override !== undefined) {
    const { known, unknown } = filterKnownWorkflowRoots(catalog, override);
    const ids = resolveWorkflowSelection(catalog, known, { includeSkillDependencies: true }).map(
      (definition) => definition.id
    );
    return { ids, unknown, mode: 'override' };
  }

  const result = resolveDesiredWorkflowSelection(catalog, profile, customWorkflows, expertSelectionExplicit);
  return { ...result, mode: 'profile' };
}
